//! The settings window: a normal window whose client area is the custom-drawn
//! form (`ui::settings`), so it looks as it does on macOS. The title bar is
//! Windows' own, tinted to the form's background.

use std::cell::{Cell, RefCell};
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute;
use windows_sys::Win32::Graphics::Gdi::*;
use windows_sys::Win32::UI::HiDpi::AdjustWindowRectExForDpi;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{ReleaseCapture, SetCapture};
use windows_sys::Win32::UI::WindowsAndMessaging::*;

use super::{App, popup, policy, system, with_app};
use super::win32::*;
use crate::strings;
use crate::ui::canvas::Canvas;
use crate::ui::settings::{SettingsView, Target, WIDTH};
use crate::ui::theme::Theme;

const CLASS: &str = "TypePalSettings";
const GITHUB: &str = "https://github.com/kekeeya/TypePalMaker";

pub struct SettingsWindow {
    pub hwnd: HWND,
    view: SettingsView,
    scale: f32,
    slider_dragging: bool,
    /// Shown under Launch at Login until the next try.
    pub login_failure: Option<String>,
}

thread_local! {
    /// The rendered form, painted on WM_PAINT without touching the app.
    static BITMAP: RefCell<Option<(i32, i32, Vec<u8>)>> = const { RefCell::new(None) };
    /// Where the window was when last closed, so reopening puts it back.
    static LAST_POS: Cell<Option<(i32, i32)>> = const { Cell::new(None) };
}

pub fn register() {
    register_class(CLASS, proc_, true);
}

fn style() -> (u32, u32) {
    (WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU, WS_EX_TOPMOST)
}

pub fn open(app: &mut App) {
    if let Some(s) = app.settings.as_ref() {
        unsafe {
            ShowWindow(s.hwnd, SW_SHOWNORMAL);
            SetForegroundWindow(s.hwnd);
        }
        refresh(app);
        return;
    }
    let title = wide(&strings::settings_title(&app.manifest.name));
    let class = wide(CLASS);
    let (style, ex) = style();
    let hwnd = unsafe {
        CreateWindowExW(ex, class.as_ptr(), title.as_ptr(), style, CW_USEDEFAULT, CW_USEDEFAULT, 100, 100, app.host, null_mut(), instance(), null())
    };
    if hwnd.is_null() {
        return;
    }
    // Above the pet, which floats: otherwise a pet parked mid-screen can sit
    // on top of its own settings.
    let scale = dpi_scale(hwnd);
    let view = SettingsView::new(app.settings_model());
    app.settings = Some(SettingsWindow { hwnd, view, scale, slider_dragging: false, login_failure: None });
    apply_frame_colors(hwnd);
    place(app, true);
    render(app);
    unsafe {
        ShowWindow(hwnd, SW_SHOWNORMAL);
        SetForegroundWindow(hwnd);
    }
}

/// Re-reads every value (the login item included: it can change elsewhere)
/// and redraws, keeping the window's top edge where it is.
pub fn refresh(app: &mut App) {
    let model = app.settings_model();
    let Some(s) = app.settings.as_mut() else { return };
    let title = wide(&strings::settings_title(&app.manifest.name));
    unsafe { SetWindowTextW(s.hwnd, title.as_ptr()) };
    s.view.set_model(model);
    apply_frame_colors(s.hwnd);
    place(app, false);
    render(app);
}

/// Sizes the window to the form; first placed centred on the pet's screen.
/// Placed on a monitor scaled differently from where it was, it is sized
/// again for that one.
fn place(app: &mut App, first: bool) {
    let pet = RECT { left: app.pos.0, top: app.pos.1, right: app.pos.0 + app.size.0, bottom: app.pos.1 + app.size.1 };
    let Some(s) = app.settings.as_mut() else { return };
    let (style, ex) = style();
    let mut origin: Option<(i32, i32)> = None;
    for _ in 0..2 {
        let w = (WIDTH * s.scale).ceil() as i32;
        let h = (s.view.height() * s.scale).ceil() as i32;
        let mut r = RECT { left: 0, top: 0, right: w, bottom: h };
        unsafe { AdjustWindowRectExForDpi(&mut r, style, 0, ex, (s.scale * 96.0) as u32) };
        let (ow, oh) = (r.right - r.left, r.bottom - r.top);
        let (x, y) = *origin.get_or_insert_with(|| {
            if first {
                LAST_POS.get().unwrap_or_else(|| {
                    let work = work_area_near(&pet);
                    ((work.left + work.right - ow) / 2, (work.top + work.bottom - oh) / 2)
                })
            } else {
                let cur = window_rect(s.hwnd);
                (cur.left, cur.top)
            }
        });
        unsafe { SetWindowPos(s.hwnd, HWND_TOPMOST, x, y, ow, oh, SWP_NOACTIVATE) };
        let scale = monitor_scale(s.hwnd);
        if (scale - s.scale).abs() < 0.001 {
            break;
        }
        s.scale = scale;
    }
}

fn render(app: &mut App) {
    let Some(s) = app.settings.as_ref() else { return };
    let theme = Theme::new(system::is_dark_mode());
    let mut canvas = Canvas::new(WIDTH, s.view.height(), s.scale);
    s.view.paint(&mut canvas, &theme);
    let (w, h) = (canvas.pixmap.width() as i32, canvas.pixmap.height() as i32);
    BITMAP.with(|b| *b.borrow_mut() = Some((w, h, canvas.to_bgra())));
    unsafe { InvalidateRect(s.hwnd, null(), 0) };
}

/// Windows 11 tints the title bar to match; earlier versions keep theirs.
fn apply_frame_colors(hwnd: HWND) {
    let theme = Theme::new(system::is_dark_mode());
    let colorref = |c: crate::ui::canvas::Color| (c.r as u32) | (c.g as u32) << 8 | (c.b as u32) << 16;
    let dark: u32 = theme.dark as u32;
    let caption = colorref(theme.background);
    let text = if theme.dark { 0x00F0F0F0u32 } else { 0x00202020u32 };
    unsafe {
        DwmSetWindowAttribute(hwnd, 20, &dark as *const u32 as _, 4);
        DwmSetWindowAttribute(hwnd, 35, &caption as *const u32 as _, 4);
        DwmSetWindowAttribute(hwnd, 36, &text as *const u32 as _, 4);
    }
}

impl SettingsWindow {
    fn point(&self, l: LPARAM) -> (f32, f32) {
        let (x, y) = point_from_lparam(l);
        (x as f32 / self.scale, y as f32 / self.scale)
    }

    /// Whether a screen point is on the language picker, whose own click
    /// toggles the dropdown.
    pub fn is_on_language_picker(&self, p: POINT) -> bool {
        let mut c = p;
        unsafe { ScreenToClient(self.hwnd, &mut c) };
        self.view.language_frame().contains(c.x as f32 / self.scale, c.y as f32 / self.scale)
    }

    /// The language picker, in screen pixels.
    fn language_screen_rect(&self) -> RECT {
        let f = self.view.language_frame();
        let mut tl = POINT { x: (f.x * self.scale).round() as i32, y: (f.y * self.scale).round() as i32 };
        let mut br = POINT { x: (f.max_x() * self.scale).round() as i32, y: (f.max_y() * self.scale).round() as i32 };
        unsafe {
            ClientToScreen(self.hwnd, &mut tl);
            ClientToScreen(self.hwnd, &mut br);
        }
        RECT { left: tl.x, top: tl.y, right: br.x, bottom: br.y }
    }
}

fn act(app: &mut App, target: Target) {
    match target {
        Target::Slider => {}
        Target::AlwaysOnTop => app.set_always_on_top(!app.prefs.always_on_top),
        Target::LockPosition => {
            app.prefs.lock_position = !app.prefs.lock_position;
            app.save_prefs();
        }
        Target::ClickThrough => app.set_click_through(!app.prefs.click_through),
        Target::LaunchAtLogin => {
            let wanted = system::login_status(&app.manifest.id) != system::LoginStatus::On;
            let result = system::set_launch_at_login(&app.manifest.id, wanted);
            if let Some(s) = app.settings.as_mut() {
                // Read back rather than assumed when the form is rebuilt.
                s.login_failure = result.err().map(|e| strings::launch_failed(&e));
            }
        }
        Target::OpenStartupApps => open_url("ms-settings:startupapps"),
        Target::IconTaskbar => app.set_use_tray(false),
        Target::IconTray => app.set_use_tray(true),
        Target::Language => {
            if app.dropdown.is_some() {
                app.close_dropdown();
            } else if let Some(s) = app.settings.as_ref() {
                app.dropdown = popup::Popup::dropdown(s.language_screen_rect(), strings::language());
            }
            return;
        }
        Target::MakerLink => {
            open_url(GITHUB);
            return;
        }
        Target::PrivacyLink => {
            policy::open(app);
            return;
        }
    }
    refresh(app);
}

/// The slider moved to `x` (points): the pet resizes notch by notch as it is
/// dragged, as on macOS.
fn slide(app: &mut App, x: f32) {
    let Some(s) = app.settings.as_ref() else { return };
    let value = s.view.slider_value_at(x);
    if (value - app.prefs.scale()).abs() > 1e-4 {
        app.set_scale(value);
        refresh(app);
    }
}

unsafe extern "system" fn proc_(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_PAINT => {
                let mut ps: PAINTSTRUCT = std::mem::zeroed();
                let dc = BeginPaint(hwnd, &mut ps);
                BITMAP.with(|b| {
                    if let Some((w, h, data)) = b.borrow().as_ref() {
                        blit_to_dc(dc, data, *w, *h);
                    }
                });
                EndPaint(hwnd, &ps);
                return 0;
            }
            WM_ERASEBKGND => return 1,
            WM_LBUTTONDOWN => {
                with_app(|app| {
                    let Some(s) = app.settings.as_mut() else { return };
                    let (x, y) = s.point(lparam);
                    let target = s.view.hit(x, y);
                    if target != Some(Target::Language) {
                        app.close_dropdown();
                    }
                    let Some(s) = app.settings.as_mut() else { return };
                    s.view.pressed = target;
                    if target == Some(Target::Slider) {
                        s.slider_dragging = true;
                        SetCapture(hwnd);
                        slide(app, x);
                    }
                });
                return 0;
            }
            WM_MOUSEMOVE => {
                with_app(|app| {
                    let Some(s) = app.settings.as_mut() else { return };
                    let (x, y) = s.point(lparam);
                    if s.slider_dragging {
                        slide(app, x);
                    } else {
                        s.view.hover = s.view.hit(x, y);
                    }
                });
                return 0;
            }
            WM_LBUTTONUP => {
                with_app(|app| {
                    let Some(s) = app.settings.as_mut() else { return };
                    let (x, y) = s.point(lparam);
                    if s.slider_dragging {
                        s.slider_dragging = false;
                        ReleaseCapture();
                        return;
                    }
                    let pressed = s.view.pressed.take();
                    if let Some(target) = pressed.filter(|t| s.view.hit(x, y) == Some(*t)) {
                        act(app, target);
                    }
                });
                return 0;
            }
            WM_SETCURSOR => {
                let link = with_app(|app| app.settings.as_ref().and_then(|s| s.view.hover).is_some_and(|t| t.is_link()));
                if loword(lparam as usize) as u32 == HTCLIENT {
                    SetCursor(LoadCursorW(null_mut(), if link == Some(true) { IDC_HAND } else { IDC_ARROW }));
                    return 1;
                }
            }
            WM_ACTIVATE => {
                if loword(wparam) as u32 == WA_INACTIVE {
                    with_app(|app| app.close_dropdown());
                }
            }
            WM_DPICHANGED => {
                let suggested = &*(lparam as *const RECT);
                SetWindowPos(
                    hwnd,
                    null_mut(),
                    suggested.left,
                    suggested.top,
                    suggested.right - suggested.left,
                    suggested.bottom - suggested.top,
                    SWP_NOZORDER | SWP_NOACTIVATE,
                );
                with_app(|app| {
                    if let Some(s) = app.settings.as_mut() {
                        s.scale = hiword(wparam) as f32 / 96.0;
                    }
                    place(app, false);
                    render(app);
                });
                return 0;
            }
            WM_CLOSE => {
                let r = window_rect(hwnd);
                LAST_POS.set(Some((r.left, r.top)));
                with_app(|app| app.ignore_activation_until = app.now() + 0.5);
                DestroyWindow(hwnd);
                return 0;
            }
            WM_DESTROY => {
                with_app(|app| {
                    app.close_dropdown();
                    if let Some(p) = app.policy.take() {
                        p.destroy();
                    }
                    app.settings = None;
                    // What the window drew is freed; hand it back.
                    app.trim_soon();
                });
                BITMAP.with(|b| *b.borrow_mut() = None);
                return 0;
            }
            _ => {}
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}
