//! The pet's right-click menu and the language dropdown: small layered
//! windows, drawn with their rounded corners and shadow, that never take the
//! focus. A click anywhere else closes them (see `App::on_global_click`).

use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{TME_LEAVE, TRACKMOUSEEVENT, TrackMouseEvent};
use windows_sys::Win32::UI::WindowsAndMessaging::*;

use super::win32::*;
use super::{settings_window, system, with_app};
use crate::strings::Language;
use crate::ui::canvas::Canvas;
use crate::ui::popups::*;
use crate::ui::theme::Theme;

const CLASS: &str = "TypePalPopup";

#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    Menu,
    Dropdown(Language),
}

pub struct Popup {
    pub hwnd: HWND,
    kind: Kind,
    hover: Option<usize>,
    scale: f32,
    /// The window's top-left, in screen pixels.
    origin: (i32, i32),
    tracking: bool,
}

pub fn register() {
    register_class(CLASS, proc_, false);
}

fn body_size(kind: Kind) -> (f32, f32) {
    match kind {
        Kind::Menu => MENU_SIZE,
        Kind::Dropdown(_) => DROPDOWN_SIZE,
    }
}

impl Popup {
    /// The menu, its top-left just right of and above the pointer, as on macOS.
    pub fn menu(at: POINT) -> Option<Popup> {
        Popup::create(Kind::Menu, |s, (w, h)| {
            let r = RECT { left: at.x, top: at.y, right: at.x + 1, bottom: at.y + 1 };
            clamp_body(at.x + (7.0 * s) as i32, at.y - (8.0 * s) as i32, w, h, s, &work_area_near(&r))
        }, at)
    }

    /// The dropdown, right-aligned with the picker and just above it.
    pub fn dropdown(anchor: RECT, selected: Language) -> Option<Popup> {
        let at = POINT { x: anchor.right, y: anchor.top };
        Popup::create(Kind::Dropdown(selected), |s, (w, h)| {
            clamp_body(anchor.right - w, anchor.top - (6.0 * s) as i32 - h, w, h, s, &work_area_near(&anchor))
        }, at)
    }

    fn create(kind: Kind, place: impl Fn(f32, (i32, i32)) -> (i32, i32), near: POINT) -> Option<Popup> {
        let class = wide(CLASS);
        let hwnd = unsafe {
            CreateWindowExW(
                WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE,
                class.as_ptr(),
                null(),
                WS_POPUP,
                near.x,
                near.y,
                1,
                1,
                null_mut(),
                null_mut(),
                instance(),
                null(),
            )
        };
        if hwnd.is_null() {
            return None;
        }
        let scale = dpi_scale(hwnd);
        let (bw, bh) = body_size(kind);
        let body = ((bw * scale).round() as i32, (bh * scale).round() as i32);
        let (bx, by) = place(scale, body);
        let m = (MARGIN * scale).round() as i32;
        let popup = Popup { hwnd, kind, hover: None, scale, origin: (bx - m, by - m), tracking: false };
        popup.render();
        unsafe { ShowWindow(hwnd, SW_SHOWNOACTIVATE) };
        Some(popup)
    }

    fn render(&self) {
        let (bw, bh) = body_size(self.kind);
        let mut canvas = Canvas::new(bw + 2.0 * MARGIN, bh + 2.0 * MARGIN, self.scale);
        let theme = Theme::new(system::is_dark_mode());
        match self.kind {
            Kind::Menu => {
                let hover = self.hover.map(|i| if i == 0 { MenuItem::Hide } else { MenuItem::Settings });
                paint_menu(&mut canvas, &theme, hover);
            }
            Kind::Dropdown(selected) => {
                let hover = self.hover.map(|i| Language::ALL[i]);
                paint_dropdown(&mut canvas, &theme, selected, hover);
            }
        }
        let (w, h) = (canvas.pixmap.width() as i32, canvas.pixmap.height() as i32);
        present_layered(self.hwnd, &canvas.to_bgra(), w, h, self.origin.0, self.origin.1);
    }

    pub fn destroy(self) {
        unsafe { DestroyWindow(self.hwnd) };
    }

    fn item_at(&self, l: LPARAM) -> Option<usize> {
        let (x, y) = point_from_lparam(l);
        let (x, y) = (x as f32 / self.scale, y as f32 / self.scale);
        match self.kind {
            Kind::Menu => menu_hit(x, y).map(|i| if i == MenuItem::Hide { 0 } else { 1 }),
            Kind::Dropdown(_) => dropdown_hit(x, y).map(|l| Language::ALL.iter().position(|a| *a == l).unwrap()),
        }
    }
}

/// Keeps a popup's body 6 points inside the work area.
fn clamp_body(x: i32, y: i32, w: i32, h: i32, s: f32, work: &RECT) -> (i32, i32) {
    let inset = (6.0 * s) as i32;
    (x.min(work.right - w - inset).max(work.left + inset), y.min(work.bottom - h - inset).max(work.top + inset))
}

/// The popup a window procedure call is for.
fn find(app: &mut super::App, hwnd: HWND) -> Option<&mut Popup> {
    if app.menu.as_ref().is_some_and(|p| p.hwnd == hwnd) {
        return app.menu.as_mut();
    }
    if app.dropdown.as_ref().is_some_and(|p| p.hwnd == hwnd) {
        return app.dropdown.as_mut();
    }
    None
}

unsafe extern "system" fn proc_(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_MOUSEACTIVATE => return MA_NOACTIVATE as LRESULT,
            WM_MOUSEMOVE => {
                with_app(|app| {
                    let Some(p) = find(app, hwnd) else { return };
                    if !p.tracking {
                        let mut t = TRACKMOUSEEVENT { cbSize: size_of::<TRACKMOUSEEVENT>() as u32, dwFlags: TME_LEAVE, hwndTrack: hwnd, dwHoverTime: 0 };
                        TrackMouseEvent(&mut t);
                        p.tracking = true;
                    }
                    let hover = p.item_at(lparam);
                    if hover != p.hover {
                        p.hover = hover;
                        p.render();
                    }
                });
                return 0;
            }
            WM_MOUSELEAVE => {
                with_app(|app| {
                    let Some(p) = find(app, hwnd) else { return };
                    p.tracking = false;
                    if p.hover.take().is_some() {
                        p.render();
                    }
                });
                return 0;
            }
            WM_LBUTTONDOWN => {
                with_app(|app| {
                    let Some(p) = find(app, hwnd) else { return };
                    let (kind, item) = (p.kind, p.item_at(lparam));
                    let Some(item) = item else { return };
                    match kind {
                        Kind::Menu => app.on_menu_choice(if item == 0 { MenuItem::Hide } else { MenuItem::Settings }),
                        Kind::Dropdown(selected) => {
                            app.close_dropdown();
                            let chosen = Language::ALL[item];
                            if chosen != selected {
                                app.set_language(chosen);
                                // Every label changes: the form is laid out again.
                                settings_window::refresh(app);
                            }
                        }
                    }
                });
                return 0;
            }
            _ => {}
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}
