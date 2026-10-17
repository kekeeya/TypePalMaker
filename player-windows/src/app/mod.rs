//! The Windows shell: windows, input, the taskbar and tray, and the settings
//! window around the shared core. It mirrors the macOS pet's `AppDelegate` and
//! `PetController`, file for file where it can.
//!
//! Everything runs on one thread, in one message loop. Window procedures reach
//! the app through `with_app`; a message that arrives while the app is already
//! busy (sent back synchronously by one of its own calls) is left to Windows,
//! so state is never borrowed twice.

mod policy;
mod popup;
mod settings_window;
mod system;
mod win32;

use std::cell::Cell;
use std::path::PathBuf;
use std::ptr::{null, null_mut};
use std::rc::Rc;
use std::time::Instant;

use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::System::SystemInformation::GetTickCount;
use windows_sys::Win32::System::Threading::CreateMutexW;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
use windows_sys::Win32::UI::Input::*;
use windows_sys::Win32::UI::Shell::*;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

use crate::core::behavior::PetBehavior;
use crate::core::frames::{DecodedFrame, FrameStore};
use crate::core::manifest::{PetManifest, PetState, StateSpec};
use crate::core::payload::PetSource;
use crate::core::stroke::{STROKE_LAPSE, StrokeRecognizer};
use crate::prefs::{Position, Preferences, settings_path};
use crate::strings;
use win32::*;

const WM_APP_REOPEN: u32 = WM_APP + 1;
const WM_APP_TRAY: u32 = WM_APP + 2;

const TIMER_FRAME: usize = 1;
const TIMER_STROKE: usize = 2;
const TIMER_KEYS: usize = 3;
const TIMER_FULL_SCREEN: usize = 4;

/// How often to look at the keyboard. What is read is a timestamp, so polling
/// only adds latency to noticing, never error to when (as on macOS).
const KEY_POLL_MS: u32 = 100;
/// Movement below this between press and release is a click, not a drag.
const DRAG_THRESHOLD: f32 = 4.0;

thread_local! {
    static APP: Cell<*mut App> = const { Cell::new(null_mut()) };
    static BUSY: Cell<bool> = const { Cell::new(false) };
}

/// Runs `f` on the app, unless it is already running something.
fn with_app<R>(f: impl FnOnce(&mut App) -> R) -> Option<R> {
    let app = APP.get();
    if app.is_null() || BUSY.get() {
        return None;
    }
    BUSY.set(true);
    let result = f(unsafe { &mut *app });
    BUSY.set(false);
    Some(result)
}

struct Animation {
    state: Option<PetState>,
    spec: Option<StateSpec>,
    index: usize,
    paused: bool,
}

struct Drag {
    press: POINT,
    origin: (i32, i32),
    dragging: bool,
    moved_past_threshold: bool,
}

pub struct App {
    manifest: PetManifest,
    source: PetSource,
    store: FrameStore,
    behavior: PetBehavior,
    shown_round: u64,
    stroke: StrokeRecognizer,
    prefs: Preferences,
    prefs_path: PathBuf,
    start: Instant,

    host: HWND,
    pet: HWND,
    /// Pixels per point on the pet's monitor.
    scale: f32,
    /// The pet window's top-left and size, in screen pixels.
    pos: (i32, i32),
    size: (i32, i32),
    dib: Option<Dib>,
    animation: Animation,
    current: Option<Rc<DecodedFrame>>,
    drag: Option<Drag>,
    tracking_leave: bool,

    input_active: bool,
    last_mouse_tick: u32,
    last_input_tick: u32,
    full_screen_hidden: bool,
    tray_added: bool,
    taskbar_created: u32,
    /// Closing a window hands activation back to the invisible host; that is
    /// not a click on the taskbar button.
    ignore_activation_until: f64,

    settings: Option<settings_window::SettingsWindow>,
    menu: Option<popup::Popup>,
    dropdown: Option<popup::Popup>,
    policy: Option<policy::PolicyWindow>,
}

pub fn run() {
    unsafe {
        // Also declared in the manifest; this covers a manifest-less build.
        windows_sys::Win32::UI::HiDpi::SetProcessDpiAwarenessContext(
            windows_sys::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        );
    }

    let appdata = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    // The language is needed before the pet is known, for its error messages.
    strings::set_language(Preferences::default().language(system::system_prefers_chinese()));

    let Some(source) = pet_source() else {
        fail(&strings::pet_data_missing());
        return;
    };
    let manifest = match source.read("manifest.json").map_err(|e| e.to_string()).and_then(|b| {
        PetManifest::load(&b).map_err(|e| e.text())
    }) {
        Ok(m) => m,
        Err(e) => {
            fail(&strings::pet_data_invalid(&e));
            return;
        }
    };

    let prefs_path = settings_path(&appdata, &manifest.id);
    let prefs = Preferences::load(&prefs_path);
    strings::set_language(prefs.language(system::system_prefers_chinese()));

    // One copy per pet: a second launch brings the first one forward, as
    // opening a running Mac app does.
    let host_class_name = format!("TypePalHost-{}", manifest.id);
    let mutex_name = wide(&format!("Local\\TypePal-{}", manifest.id));
    unsafe {
        CreateMutexW(null(), 0, mutex_name.as_ptr());
        if GetLastError() == ERROR_ALREADY_EXISTS {
            let class = wide(&host_class_name);
            let other = FindWindowW(class.as_ptr(), null());
            if !other.is_null() {
                PostMessageW(other, WM_APP_REOPEN, 0, 0);
            }
            return;
        }
    }

    let store = FrameStore::new(&manifest, &source);
    let missing = store.unreadable_frame_ids();
    if !missing.is_empty() {
        fail(&strings::frames_unreadable(&missing.join(", ")));
        return;
    }

    let host_class = register_class(&host_class_name, host_proc, true);
    let pet_class = register_class("TypePalPet", pet_proc, false);
    settings_window::register();
    popup::register();
    policy::register();

    let name = wide(&manifest.name);
    let (host, pet) = unsafe {
        let host = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TRANSPARENT,
            host_class.as_ptr(),
            name.as_ptr(),
            WS_POPUP,
            0,
            0,
            1,
            1,
            null_mut(),
            null_mut(),
            instance(),
            null(),
        );
        // Invisible: it exists for the taskbar button, tray icon and input.
        SetLayeredWindowAttributes(host, 0, 0, LWA_ALPHA);
        let pet = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            pet_class.as_ptr(),
            name.as_ptr(),
            WS_POPUP,
            0,
            0,
            1,
            1,
            null_mut(),
            null_mut(),
            instance(),
            null(),
        );
        (host, pet)
    };

    let taskbar_created = unsafe { RegisterWindowMessageW(wide("TaskbarCreated").as_ptr()) };
    let app = Box::new(App {
        behavior: PetBehavior::new(&manifest),
        manifest,
        source,
        store,
        shown_round: u64::MAX,
        stroke: StrokeRecognizer::default(),
        prefs,
        prefs_path,
        start: Instant::now(),
        host,
        pet,
        scale: 1.0,
        pos: (0, 0),
        size: (1, 1),
        dib: None,
        animation: Animation { state: None, spec: None, index: 0, paused: true },
        current: None,
        drag: None,
        tracking_leave: false,
        input_active: false,
        last_mouse_tick: 0,
        last_input_tick: 0,
        full_screen_hidden: false,
        tray_added: false,
        taskbar_created,
        ignore_activation_until: 0.0,
        settings: None,
        menu: None,
        dropdown: None,
        policy: None,
    });
    APP.set(Box::into_raw(app));

    with_app(|app| app.start());

    unsafe {
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

/// `--pet <dir>`, then `TYPEPAL_PET_DIR`, then the pet packed into this exe —
/// which is what a generated pet uses.
fn pet_source() -> Option<PetSource> {
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--pet") {
        return args.get(i + 1).map(|d| PetSource::Folder(PathBuf::from(d)));
    }
    if let Some(dir) = std::env::var_os("TYPEPAL_PET_DIR").filter(|d| !d.is_empty()) {
        return Some(PetSource::Folder(PathBuf::from(dir)));
    }
    let exe = std::env::current_exe().ok()?;
    PetSource::packed(&exe).ok().flatten()
}

fn fail(message: &str) {
    eprintln!("[TypePal] {message}");
    message_box(&strings::cannot_start(), message);
}

impl App {
    fn now(&self) -> f64 {
        self.start.elapsed().as_secs_f64()
    }

    fn save_prefs(&self) {
        let _ = self.prefs.save(&self.prefs_path);
    }

    fn start(&mut self) {
        self.scale = dpi_scale(self.pet);
        self.configure_size();
        self.restore_position();
        self.apply_always_on_top();
        self.apply_click_through();
        self.apply_icon_mode();
        unsafe { SetTimer(self.host, TIMER_FULL_SCREEN, 1000, None) };
        self.refresh();
        self.update_visibility();
    }

    // MARK: Visibility

    fn set_visible(&mut self, visible: bool) {
        self.prefs.visible = visible;
        self.save_prefs();
        self.update_visibility();
    }

    fn is_shown(&self) -> bool {
        self.prefs.visible && !self.full_screen_hidden
    }

    fn update_visibility(&mut self) {
        if self.is_shown() {
            self.clamp_to_screen();
            self.render();
            unsafe { ShowWindow(self.pet, SW_SHOWNOACTIVATE) };
            self.apply_always_on_top();
        } else {
            unsafe { ShowWindow(self.pet, SW_HIDE) };
            self.close_menu();
            self.end_stroke();
        }
        self.update_activity();
    }

    /// Animation and input run only while the pet can be seen.
    fn update_activity(&mut self) {
        let active = self.is_shown();
        if active == self.input_active && active != self.animation.paused {
            return;
        }
        if active {
            self.start_input();
            self.animation.paused = false;
            self.show_frame();
        } else {
            self.stop_input();
            self.animation.paused = true;
            unsafe { KillTimer(self.pet, TIMER_FRAME) };
        }
    }

    fn check_full_screen(&mut self) {
        let ours = [self.pet, self.host];
        let full = system::full_screen_app_over(self.pet, &ours);
        if full != self.full_screen_hidden {
            self.full_screen_hidden = full;
            self.update_visibility();
        }
    }

    /// A click on the taskbar button or a second launch: brings a hidden pet
    /// back, and otherwise opens the settings, as a click on the Dock icon does.
    fn reopen(&mut self) {
        if !self.prefs.visible {
            self.set_visible(true);
        } else {
            self.open_settings();
        }
    }

    // MARK: Settings actions

    fn set_scale(&mut self, scale: f64) {
        if (self.prefs.scale() - scale).abs() < 1e-4 {
            return;
        }
        self.prefs.scale = scale;
        self.save_prefs();
        self.resize();
    }

    fn set_always_on_top(&mut self, on: bool) {
        self.prefs.always_on_top = on;
        self.save_prefs();
        self.apply_always_on_top();
    }

    fn apply_always_on_top(&self) {
        let after = if self.prefs.always_on_top { HWND_TOPMOST } else { HWND_NOTOPMOST };
        unsafe { SetWindowPos(self.pet, after, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) };
    }

    fn set_click_through(&mut self, on: bool) {
        self.prefs.click_through = on;
        self.save_prefs();
        if on {
            self.end_stroke();
        }
        self.apply_click_through();
    }

    fn apply_click_through(&self) {
        unsafe {
            let ex = GetWindowLongPtrW(self.pet, GWL_EXSTYLE) as u32;
            let ex = if self.prefs.click_through { ex | WS_EX_TRANSPARENT } else { ex & !WS_EX_TRANSPARENT };
            SetWindowLongPtrW(self.pet, GWL_EXSTYLE, ex as isize);
        }
    }

    fn set_use_tray(&mut self, tray: bool) {
        if tray == self.prefs.use_tray_icon {
            return;
        }
        self.prefs.use_tray_icon = tray;
        self.save_prefs();
        self.apply_icon_mode();
    }

    fn set_language(&mut self, language: strings::Language) {
        self.prefs.language = Some(language.code().to_string());
        self.save_prefs();
        strings::set_language(language);
        let title = wide(&self.manifest.name);
        unsafe { SetWindowTextW(self.host, title.as_ptr()) };
        if self.tray_added {
            self.update_tray();
        }
    }

    // MARK: Taskbar and tray

    /// A taskbar button by default, like any app (the Dock on macOS); or only
    /// a tray icon (the menu bar). Exactly one of the two is ever present, so
    /// the pet can always be reached.
    fn apply_icon_mode(&mut self) {
        unsafe {
            let ex = GetWindowLongPtrW(self.host, GWL_EXSTYLE) as u32;
            if self.prefs.use_tray_icon {
                ShowWindow(self.host, SW_HIDE);
                SetWindowLongPtrW(self.host, GWL_EXSTYLE, (ex & !WS_EX_APPWINDOW) as isize);
                self.add_tray();
            } else {
                self.remove_tray();
                SetWindowLongPtrW(self.host, GWL_EXSTYLE, (ex | WS_EX_APPWINDOW) as isize);
                ShowWindow(self.host, SW_SHOWNOACTIVATE);
            }
        }
    }

    fn tray_data(&self) -> NOTIFYICONDATAW {
        let mut data: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
        data.cbSize = size_of::<NOTIFYICONDATAW>() as u32;
        data.hWnd = self.host;
        data.uID = 1;
        data.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
        data.uCallbackMessage = WM_APP_TRAY;
        data.hIcon = app_icon(unsafe { GetSystemMetrics(SM_CXSMICON) });
        let tip: Vec<u16> = self.manifest.name.encode_utf16().take(127).collect();
        data.szTip[..tip.len()].copy_from_slice(&tip);
        data
    }

    fn add_tray(&mut self) {
        let data = self.tray_data();
        self.tray_added = unsafe { Shell_NotifyIconW(NIM_ADD, &data) } != 0;
    }

    fn update_tray(&mut self) {
        let data = self.tray_data();
        unsafe { Shell_NotifyIconW(NIM_MODIFY, &data) };
    }

    fn remove_tray(&mut self) {
        if self.tray_added {
            let data = self.tray_data();
            unsafe { Shell_NotifyIconW(NIM_DELETE, &data) };
            self.tray_added = false;
        }
    }

    /// The tray icon's menu: the way back once the pet is hidden or ignores
    /// the mouse, and the place to quit from — the menu-bar menu on macOS.
    fn show_tray_menu(&mut self) {
        const SHOW_HIDE: usize = 1;
        const SETTINGS: usize = 2;
        const QUIT: usize = 3;
        let show_hide = wide(&if self.prefs.visible { strings::hide_pet() } else { strings::show_pet() });
        let settings = wide(&strings::settings_ellipsis());
        let quit = wide(&strings::quit(&self.manifest.name));
        let chosen = unsafe {
            let menu = CreatePopupMenu();
            AppendMenuW(menu, MF_STRING, SHOW_HIDE, show_hide.as_ptr());
            AppendMenuW(menu, MF_STRING, SETTINGS, settings.as_ptr());
            AppendMenuW(menu, MF_SEPARATOR, 0, null());
            AppendMenuW(menu, MF_STRING, QUIT, quit.as_ptr());
            let p = cursor_pos();
            // Without this the menu does not close when clicking elsewhere.
            SetForegroundWindow(self.host);
            let chosen = TrackPopupMenu(menu, TPM_RETURNCMD | TPM_RIGHTBUTTON | TPM_NONOTIFY, p.x, p.y, 0, self.host, null());
            PostMessageW(self.host, WM_NULL, 0, 0);
            DestroyMenu(menu);
            chosen as usize
        };
        match chosen {
            SHOW_HIDE => self.set_visible(!self.prefs.visible),
            SETTINGS => self.open_settings(),
            QUIT => self.quit(),
            _ => {}
        }
    }

    fn quit(&mut self) {
        self.save_prefs();
        self.remove_tray();
        unsafe { PostQuitMessage(0) };
    }

    // MARK: Input

    /// Clicks and pointer travel come as raw mouse input, delivered even while
    /// another app is in front. No hooks, and nothing from the keyboard: typing
    /// is told from the system's "last input" time, as on macOS.
    fn start_input(&mut self) {
        if self.input_active {
            return;
        }
        let device = RAWINPUTDEVICE { usUsagePage: 0x01, usUsage: 0x02, dwFlags: RIDEV_INPUTSINK, hwndTarget: self.host };
        unsafe {
            RegisterRawInputDevices(&device, 1, size_of::<RAWINPUTDEVICE>() as u32);
            SetTimer(self.host, TIMER_KEYS, KEY_POLL_MS, None);
        }
        // Only input from now on counts.
        self.last_input_tick = last_input_tick();
        self.input_active = true;
    }

    fn stop_input(&mut self) {
        if !self.input_active {
            return;
        }
        let device = RAWINPUTDEVICE { usUsagePage: 0x01, usUsage: 0x02, dwFlags: RIDEV_REMOVE, hwndTarget: null_mut() };
        unsafe {
            RegisterRawInputDevices(&device, 1, size_of::<RAWINPUTDEVICE>() as u32);
            KillTimer(self.host, TIMER_KEYS);
        }
        self.input_active = false;
    }

    /// The last input happened, and was not the mouse: a key.
    fn poll_keyboard(&mut self) {
        let tick = last_input_tick();
        if tick == self.last_input_tick {
            return;
        }
        self.last_input_tick = tick;
        // Raw mouse input arrives as the mouse moves; input well after the
        // last of it is the keyboard.
        if (tick.wrapping_sub(self.last_mouse_tick) as i32) <= 60 {
            return;
        }
        let age = unsafe { GetTickCount() }.wrapping_sub(tick) as f64 / 1000.0;
        let now = self.now();
        let at = (now - age).min(now);
        self.behavior.key_pressed(at);
        self.refresh();
    }

    fn on_raw_input(&mut self, lparam: LPARAM, message_time: u32) {
        let mut raw: RAWINPUT = unsafe { std::mem::zeroed() };
        let mut size = size_of::<RAWINPUT>() as u32;
        let read = unsafe {
            GetRawInputData(lparam as HRAWINPUT, RID_INPUT, &mut raw as *mut RAWINPUT as _, &mut size, size_of::<RAWINPUTHEADER>() as u32)
        };
        if read == u32::MAX || raw.header.dwType != RIM_TYPEMOUSE {
            return;
        }
        self.last_mouse_tick = message_time;
        let flags = unsafe { raw.data.mouse.Anonymous.Anonymous.usButtonFlags } as u32;
        let downs = RI_MOUSE_LEFT_BUTTON_DOWN
            | RI_MOUSE_RIGHT_BUTTON_DOWN
            | RI_MOUSE_MIDDLE_BUTTON_DOWN
            | RI_MOUSE_BUTTON_4_DOWN
            | RI_MOUSE_BUTTON_5_DOWN;
        if flags & downs != 0 {
            self.on_global_click();
        }
    }

    /// A mouse button went down anywhere. Clicks on the pet and on its own
    /// little menus are a tap or a choice, not "a click".
    fn on_global_click(&mut self) {
        let p = cursor_pos();
        let root = unsafe { GetAncestor(WindowFromPoint(p), GA_ROOT) };
        let menu = self.menu.as_ref().map(|m| m.hwnd);
        let dropdown = self.dropdown.as_ref().map(|d| d.hwnd);
        if menu.is_some() && Some(root) != menu {
            self.close_menu();
        }
        if dropdown.is_some() && Some(root) != dropdown && !self.is_on_language_picker(root, p) {
            self.close_dropdown();
        }
        if root == self.pet || Some(root) == menu || Some(root) == dropdown {
            return;
        }
        let now = self.now();
        self.behavior.mouse_clicked(now);
        self.refresh();
    }

    // MARK: Behaviour and animation

    /// Shows what the behaviour has decided: a new round starts from its first
    /// frame; the round already playing carries on untouched.
    fn refresh(&mut self) {
        let state = self.behavior.current;
        let Some(spec) = self.manifest.playable(state).cloned() else { return };
        let new_round = self.behavior.round != self.shown_round;
        self.shown_round = self.behavior.round;
        let restart = new_round && state != PetState::Idle;
        if Some(state) == self.animation.state && !restart {
            return;
        }
        self.animation.state = Some(state);
        self.animation.spec = Some(spec.played_as(state));
        self.animation.index = 0;
        self.show_frame();
    }

    /// Shows the current frame and arms one timer for exactly its duration. A
    /// single looping frame arms none, which keeps an idle pet at ~0% CPU.
    fn show_frame(&mut self) {
        unsafe { KillTimer(self.pet, TIMER_FRAME) };
        let Some(spec) = self.animation.spec.clone() else { return };
        let Some(entry) = spec.frames.get(self.animation.index) else { return };
        if let Some(frame) = self.store.frame(&entry.id, &self.source) {
            self.current = Some(frame);
            self.render();
        }
        if self.animation.paused || (spec.frames.len() == 1 && spec.looping) {
            return;
        }
        let seconds = spec.durations()[self.animation.index].max(1.0 / 60.0);
        unsafe { SetTimer(self.pet, TIMER_FRAME, (seconds * 1000.0).round() as u32, None) };
    }

    fn advance(&mut self) {
        let Some(spec) = self.animation.spec.clone() else { return };
        if self.animation.index + 1 >= spec.frames.len() {
            if spec.looping {
                self.animation.index = 0;
                self.show_frame();
            } else {
                // Hold the last frame until the behaviour moves on.
                unsafe { KillTimer(self.pet, TIMER_FRAME) };
                let now = self.now();
                self.behavior.round_finished(now);
                self.refresh();
            }
        } else {
            self.animation.index += 1;
            self.show_frame();
        }
    }

    fn render(&mut self) {
        let (w, h) = self.size;
        if self.dib.as_ref().is_none_or(|d| d.width != w || d.height != h) {
            self.dib = Dib::new(w, h);
        }
        let (Some(dib), Some(frame)) = (self.dib.as_mut(), self.current.as_ref()) else { return };
        let pixels = dib.pixels();
        pixels.fill(0);
        let bmp = &frame.bitmap;
        for y in 0..bmp.height as i32 {
            let dy = frame.y + y;
            if dy < 0 || dy >= h {
                continue;
            }
            let x0 = frame.x.max(0);
            let x1 = (frame.x + bmp.width as i32).min(w);
            if x1 <= x0 {
                continue;
            }
            let src = ((y as usize * bmp.width as usize) + (x0 - frame.x) as usize) * 4;
            let dst = (dy as usize * w as usize + x0 as usize) * 4;
            let n = (x1 - x0) as usize * 4;
            pixels[dst..dst + n].copy_from_slice(&bmp.data[src..src + n]);
        }
        dib.present(self.pet, self.pos.0, self.pos.1);
    }

    // MARK: Size and position

    fn configure_size(&mut self) {
        let height = self.manifest.display.height * self.prefs.scale() * self.scale as f64;
        self.store.configure(height);
        let (w, h) = self.store.box_px;
        self.size = (w as i32, h as i32);
    }

    /// Grows and shrinks about the bottom centre, where the pet stands.
    fn resize(&mut self) {
        let (old_w, old_h) = self.size;
        let (bottom, center) = (self.pos.1 + old_h, self.pos.0 + old_w / 2);
        self.configure_size();
        self.pos = (center - self.size.0 / 2, bottom - self.size.1);
        self.clamp_to_screen();
        self.show_frame();
        self.save_position();
    }

    fn restore_position(&mut self) {
        if let Some(Position { x, y }) = self.prefs.position {
            self.pos = (x, y);
        } else {
            let work = primary_work_area();
            let s = self.scale;
            self.pos = (work.right - self.size.0 - (48.0 * s) as i32, work.bottom - self.size.1 - (24.0 * s) as i32);
        }
        self.clamp_to_screen();
    }

    /// Keeps the pet inside the work area of the monitor it is mostly on.
    fn clamp_to_screen(&mut self) {
        let (w, h) = self.size;
        let r = RECT { left: self.pos.0, top: self.pos.1, right: self.pos.0 + w, bottom: self.pos.1 + h };
        let work = work_area_near(&r);
        let x = self.pos.0.min(work.right - w).max(work.left);
        let y = self.pos.1.min(work.bottom - h).max(work.top);
        self.pos = (x, y);
    }

    fn save_position(&mut self) {
        self.prefs.position = Some(Position { x: self.pos.0, y: self.pos.1 });
        self.save_prefs();
    }

    fn on_dpi_changed(&mut self) {
        let scale = dpi_scale(self.pet);
        if (scale - self.scale).abs() > 0.001 {
            self.scale = scale;
            self.resize();
        }
    }

    // MARK: Pointer on the pet

    fn local_px(&self, p: POINT) -> (i32, i32) {
        (p.x - self.pos.0, p.y - self.pos.1)
    }

    fn cursor_on_pet(&self, p: POINT) -> bool {
        let (x, y) = self.local_px(p);
        self.current.as_ref().is_some_and(|f| f.is_opaque(x, y))
    }

    fn on_button_down(&mut self) {
        let press = cursor_pos();
        self.drag = Some(Drag { press, origin: self.pos, dragging: false, moved_past_threshold: false });
        self.end_stroke();
        unsafe { SetCapture(self.pet) };
    }

    fn on_mouse_move(&mut self) {
        let p = cursor_pos();
        if let Some(drag) = self.drag.as_mut() {
            let (dx, dy) = (p.x - drag.press.x, p.y - drag.press.y);
            if !drag.dragging {
                if ((dx * dx + dy * dy) as f32).sqrt() < DRAG_THRESHOLD * self.scale {
                    return;
                }
                drag.moved_past_threshold = true;
                if self.prefs.lock_position {
                    return;
                }
                drag.dragging = true;
            }
            self.pos = (drag.origin.0 + dx, drag.origin.1 + dy);
            if let Some(dib) = self.dib.as_ref() {
                dib.present(self.pet, self.pos.0, self.pos.1);
            }
            return;
        }
        if !self.tracking_leave {
            let mut track = TRACKMOUSEEVENT { cbSize: size_of::<TRACKMOUSEEVENT>() as u32, dwFlags: TME_LEAVE, hwndTrack: self.pet, dwHoverTime: 0 };
            unsafe { TrackMouseEvent(&mut track) };
            self.tracking_leave = true;
        }
        self.track_stroke(p);
    }

    fn on_button_up(&mut self) {
        let Some(drag) = self.drag.take() else { return };
        unsafe { ReleaseCapture() };
        if drag.dragging {
            self.clamp_to_screen();
            self.render();
            self.save_position();
            self.apply_always_on_top();
        } else if !drag.moved_past_threshold {
            let now = self.now();
            self.behavior.tapped(now);
            self.refresh();
        }
    }

    fn track_stroke(&mut self, p: POINT) {
        if self.prefs.click_through || self.drag.is_some() {
            self.end_stroke();
            return;
        }
        let on_pet = self.cursor_on_pet(p);
        let now = self.now();
        // In points, so the hand-tuned distances feel the same at any DPI.
        self.stroke.track(p.x as f64 / self.scale as f64, on_pet, now);
        self.publish_stroke();
        unsafe { SetTimer(self.pet, TIMER_STROKE, ((STROKE_LAPSE + 0.05) * 1000.0) as u32, None) };
    }

    fn end_stroke(&mut self) {
        self.stroke.reset();
        self.publish_stroke();
    }

    fn publish_stroke(&mut self) {
        let before = self.behavior.current;
        let now = self.now();
        self.behavior.set_stroking(self.stroke.is_stroking, now);
        if self.behavior.current != before {
            self.refresh();
        }
    }

    // MARK: Windows owned by the app

    fn open_settings(&mut self) {
        settings_window::open(self);
    }

    fn settings_model(&self) -> crate::ui::settings::SettingsModel {
        use crate::ui::settings::{LoginNote, SettingsModel};
        let status = system::login_status(&self.manifest.id);
        let mut notes = Vec::new();
        if status == system::LoginStatus::NeedsApproval {
            notes.push(LoginNote::NeedsApproval);
        }
        if let Some(failure) = self.settings.as_ref().and_then(|s| s.login_failure.clone()) {
            notes.push(LoginNote::Failed(failure));
        }
        SettingsModel {
            name: self.manifest.name.clone(),
            scale: self.prefs.scale(),
            always_on_top: self.prefs.always_on_top,
            lock_position: self.prefs.lock_position,
            click_through: self.prefs.click_through,
            launch_at_login: status != system::LoginStatus::Off,
            login_notes: notes,
            use_tray: self.prefs.use_tray_icon,
            language: strings::language(),
        }
    }

    fn show_menu(&mut self) {
        let p = cursor_pos();
        self.close_menu();
        self.menu = popup::Popup::menu(p);
    }

    fn close_menu(&mut self) {
        if let Some(menu) = self.menu.take() {
            menu.destroy();
        }
    }

    fn close_dropdown(&mut self) {
        if let Some(d) = self.dropdown.take() {
            d.destroy();
        }
    }

    fn is_on_language_picker(&self, root: HWND, p: POINT) -> bool {
        self.settings.as_ref().is_some_and(|s| s.hwnd == root && s.is_on_language_picker(p))
    }

    fn on_menu_choice(&mut self, item: crate::ui::popups::MenuItem) {
        self.close_menu();
        match item {
            crate::ui::popups::MenuItem::Hide => self.set_visible(false),
            crate::ui::popups::MenuItem::Settings => self.open_settings(),
        }
    }

    fn on_theme_changed(&mut self) {
        settings_window::refresh(self);
        if let Some(p) = self.policy.as_mut() {
            p.repaint();
        }
    }
}

fn last_input_tick() -> u32 {
    let mut info = LASTINPUTINFO { cbSize: size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    unsafe { GetLastInputInfo(&mut info) };
    info.dwTime
}

unsafe extern "system" fn host_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_INPUT => {
                let time = GetMessageTime() as u32;
                with_app(|app| app.on_raw_input(lparam, time));
                return DefWindowProcW(hwnd, msg, wparam, lparam);
            }
            WM_TIMER => {
                match wparam {
                    TIMER_KEYS => {
                        with_app(|app| app.poll_keyboard());
                    }
                    TIMER_FULL_SCREEN => {
                        with_app(|app| app.check_full_screen());
                    }
                    _ => {}
                }
                return 0;
            }
            WM_APP_REOPEN => {
                with_app(|app| app.reopen());
                return 0;
            }
            WM_APP_TRAY => {
                let event = loword(lparam as usize) as u32;
                if event == WM_LBUTTONUP || event == WM_RBUTTONUP {
                    with_app(|app| app.show_tray_menu());
                }
                return 0;
            }
            WM_ACTIVATE => {
                // The taskbar button was clicked (or Alt+Tab chose the pet).
                if loword(wparam) as u32 != WA_INACTIVE {
                    with_app(|app| {
                        if !app.prefs.use_tray_icon && app.now() >= app.ignore_activation_until {
                            app.reopen();
                        }
                    });
                }
                return 0;
            }
            WM_SYSCOMMAND => {
                // A second click on the button would minimise the invisible
                // window; it means "open" too.
                let command = (wparam & 0xfff0) as u32;
                if command == SC_MINIMIZE || command == SC_RESTORE {
                    with_app(|app| app.reopen());
                    return 0;
                }
            }
            WM_CLOSE => {
                // "Close window" on the taskbar button: quit, as Quit on the Dock does.
                with_app(|app| app.quit());
                return 0;
            }
            WM_SETTINGCHANGE => {
                with_app(|app| app.on_theme_changed());
            }
            WM_DISPLAYCHANGE => {
                with_app(|app| {
                    app.on_dpi_changed();
                    app.clamp_to_screen();
                    app.render();
                });
            }
            WM_POWERBROADCAST => {
                with_app(|app| app.update_visibility());
            }
            _ => {
                let created = with_app(|app| app.taskbar_created).unwrap_or(0);
                if msg == created && created != 0 {
                    with_app(|app| {
                        if app.prefs.use_tray_icon {
                            app.tray_added = false;
                            app.add_tray();
                        }
                    });
                    return 0;
                }
            }
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}

unsafe extern "system" fn pet_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            // Clicking, dragging and stroking never take the focus from the
            // app being typed in.
            WM_MOUSEACTIVATE => return MA_NOACTIVATE as LRESULT,
            WM_LBUTTONDOWN => {
                with_app(|app| app.on_button_down());
                return 0;
            }
            WM_MOUSEMOVE => {
                with_app(|app| app.on_mouse_move());
                return 0;
            }
            WM_LBUTTONUP => {
                with_app(|app| app.on_button_up());
                return 0;
            }
            WM_CAPTURECHANGED => {
                with_app(|app| {
                    if app.drag.is_some() {
                        app.on_button_up();
                    }
                });
                return 0;
            }
            WM_RBUTTONDOWN => {
                with_app(|app| app.show_menu());
                return 0;
            }
            WM_MOUSELEAVE => {
                with_app(|app| {
                    app.tracking_leave = false;
                    app.end_stroke();
                });
                return 0;
            }
            WM_TIMER => {
                match wparam {
                    TIMER_FRAME => {
                        with_app(|app| app.advance());
                    }
                    TIMER_STROKE => {
                        KillTimer(hwnd, TIMER_STROKE);
                        with_app(|app| {
                            let now = app.now();
                            app.stroke.settle(now);
                            app.publish_stroke();
                        });
                    }
                    _ => {}
                }
                return 0;
            }
            WM_DPICHANGED => {
                with_app(|app| app.on_dpi_changed());
                return 0;
            }
            _ => {}
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}
