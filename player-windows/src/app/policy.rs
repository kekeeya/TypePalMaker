//! The privacy policy, shown over the settings window like the macOS sheet:
//! title, close button top-right, scrolling text. Esc closes it; Ctrl+C copies
//! the whole policy. The settings window waits while it is open.

use std::cell::RefCell;
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute;
use windows_sys::Win32::Graphics::Gdi::*;
use windows_sys::Win32::System::DataExchange::*;
use windows_sys::Win32::System::Memory::*;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

use super::win32::*;
use super::{App, system, with_app};
use crate::privacy;
use crate::ui::canvas::Canvas;
use crate::ui::popups::*;
use crate::ui::theme::Theme;

const CLASS: &str = "TypePalPolicy";

pub struct PolicyWindow {
    pub hwnd: HWND,
    owner: HWND,
    layout: PolicyLayout,
    scroll: f32,
    scale: f32,
    hovering: bool,
}

thread_local! {
    static BITMAP: RefCell<Option<(i32, i32, Vec<u8>)>> = const { RefCell::new(None) };
}

pub fn register() {
    let class = wide(CLASS);
    unsafe {
        let wc = WNDCLASSEXW {
            cbSize: size_of::<WNDCLASSEXW>() as u32,
            // A shadow, as a sheet has.
            style: CS_DROPSHADOW,
            lpfnWndProc: Some(proc_),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance(),
            hIcon: null_mut(),
            hCursor: LoadCursorW(null_mut(), IDC_ARROW),
            hbrBackground: null_mut(),
            lpszMenuName: null(),
            lpszClassName: class.as_ptr(),
            hIconSm: null_mut(),
        };
        RegisterClassExW(&wc);
    }
}

pub fn open(app: &mut App) {
    if app.policy.is_some() {
        return;
    }
    let Some(settings) = app.settings.as_ref() else { return };
    let owner = settings.hwnd;
    let class = wide(CLASS);
    let hwnd = unsafe {
        CreateWindowExW(WS_EX_TOPMOST, class.as_ptr(), null(), WS_POPUP, 0, 0, 1, 1, owner, null_mut(), instance(), null())
    };
    if hwnd.is_null() {
        return;
    }
    let scale = dpi_scale(owner);
    // Centred over the settings window, its top at the top of the form.
    let (w, h) = ((POLICY_SIZE.0 * scale).round() as i32, (POLICY_SIZE.1 * scale).round() as i32);
    let mut origin = POINT { x: 0, y: 0 };
    let mut client = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    unsafe {
        ClientToScreen(owner, &mut origin);
        GetClientRect(owner, &mut client);
        let rounded: u32 = 2;
        DwmSetWindowAttribute(hwnd, 33, &rounded as *const u32 as _, 4);
        SetWindowPos(hwnd, HWND_TOPMOST, origin.x + (client.right - w) / 2, origin.y, w, h, 0);
    }
    let window = PolicyWindow { hwnd, owner, layout: policy_layout(&privacy::sections()), scroll: 0.0, scale, hovering: false };
    window.render();
    app.policy = Some(window);
    unsafe {
        EnableWindow(owner, 0);
        ShowWindow(hwnd, SW_SHOW);
        SetForegroundWindow(hwnd);
        SetFocus(hwnd);
    }
}

impl PolicyWindow {
    fn render(&self) {
        let theme = Theme::new(system::is_dark_mode());
        let mut canvas = Canvas::new(POLICY_SIZE.0, POLICY_SIZE.1, self.scale);
        paint_policy(&mut canvas, &theme, privacy::title(), &self.layout, self.scroll, self.hovering);
        let (w, h) = (canvas.pixmap.width() as i32, canvas.pixmap.height() as i32);
        BITMAP.with(|b| *b.borrow_mut() = Some((w, h, canvas.to_bgra())));
        unsafe { InvalidateRect(self.hwnd, null(), 0) };
    }

    pub fn repaint(&mut self) {
        self.render();
    }

    pub fn destroy(self) {
        unsafe {
            EnableWindow(self.owner, 1);
            DestroyWindow(self.hwnd);
            SetForegroundWindow(self.owner);
        }
        BITMAP.with(|b| *b.borrow_mut() = None);
    }

    fn scroll_by(&mut self, points: f32) {
        let max = policy_max_scroll(&self.layout);
        self.scroll = (self.scroll + points).clamp(0.0, max);
        self.render();
    }
}

fn close(app: &mut App) {
    if let Some(p) = app.policy.take() {
        p.destroy();
    }
}

/// The whole policy as plain text, onto the clipboard.
fn copy_all(hwnd: HWND) {
    let mut text = String::from(privacy::title());
    for (heading, body) in privacy::sections() {
        text.push_str("\r\n\r\n");
        if let Some(h) = heading {
            text.push_str(&h);
            text.push_str("\r\n");
        }
        text.push_str(&body.replace('\n', "\r\n"));
    }
    let data = wide(&text);
    unsafe {
        if OpenClipboard(hwnd) == 0 {
            return;
        }
        EmptyClipboard();
        let bytes = data.len() * 2;
        let mem = GlobalAlloc(GMEM_MOVEABLE, bytes);
        if !mem.is_null() {
            let dst = GlobalLock(mem) as *mut u16;
            std::ptr::copy_nonoverlapping(data.as_ptr(), dst, data.len());
            GlobalUnlock(mem);
            // CF_UNICODETEXT
            SetClipboardData(13, mem as HANDLE);
        }
        CloseClipboard();
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
            WM_MOUSEWHEEL => {
                let delta = hiword(wparam) as i16 as f32 / 120.0;
                with_app(|app| {
                    if let Some(p) = app.policy.as_mut() {
                        p.scroll_by(-delta * 60.0);
                    }
                });
                return 0;
            }
            WM_MOUSEMOVE => {
                with_app(|app| {
                    if let Some(p) = app.policy.as_mut() {
                        if !p.hovering {
                            p.hovering = true;
                            let mut t = TRACKMOUSEEVENT { cbSize: size_of::<TRACKMOUSEEVENT>() as u32, dwFlags: TME_LEAVE, hwndTrack: hwnd, dwHoverTime: 0 };
                            TrackMouseEvent(&mut t);
                            p.render();
                        }
                    }
                });
                return 0;
            }
            WM_MOUSELEAVE => {
                with_app(|app| {
                    if let Some(p) = app.policy.as_mut() {
                        p.hovering = false;
                        p.render();
                    }
                });
                return 0;
            }
            WM_LBUTTONDOWN => {
                let (x, y) = point_from_lparam(lparam);
                with_app(|app| {
                    let Some(p) = app.policy.as_ref() else { return };
                    let f = policy_close_frame().inset(-8.0, -8.0);
                    if f.contains(x as f32 / p.scale, y as f32 / p.scale) {
                        close(app);
                    }
                });
                return 0;
            }
            WM_KEYDOWN => {
                let key = wparam as u32;
                let ctrl = GetKeyState(VK_CONTROL as i32) < 0;
                if key == VK_ESCAPE as u32 {
                    with_app(close);
                } else if ctrl && (key == 'C' as u32 || key == 'A' as u32) {
                    copy_all(hwnd);
                } else if key == VK_DOWN as u32 || key == VK_NEXT as u32 || key == VK_UP as u32 || key == VK_PRIOR as u32 {
                    let step = if key == VK_DOWN as u32 { 40.0 } else if key == VK_UP as u32 { -40.0 } else if key == VK_NEXT as u32 { 300.0 } else { -300.0 };
                    with_app(|app| {
                        if let Some(p) = app.policy.as_mut() {
                            p.scroll_by(step);
                        }
                    });
                }
                return 0;
            }
            _ => {}
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}
