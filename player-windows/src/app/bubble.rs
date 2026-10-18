//! The pet's speech bubble window (`SpeechBubble.swift` on macOS): a layered
//! window owned by the pet, so it stays just above it, that never takes the
//! mouse or the focus. Created to show a line and destroyed when it hides;
//! nothing is kept while the pet is quiet.

use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

use super::win32::*;
use crate::ui::bubble::{BubbleLayout, layout, paint};
use crate::ui::canvas::Canvas;

const CLASS: &str = "TypePalBubble";

pub fn register() {
    register_class(CLASS, proc_, false);
}

pub struct Bubble {
    hwnd: HWND,
    layout: BubbleLayout,
    scale: f32,
    /// The last drawing, and where its tail was: moving the bubble with the
    /// pet reuses it rather than drawing again.
    drawn: Option<(i32, bool, Vec<u8>, i32, i32)>,
}

impl Bubble {
    /// A bubble for `line`, owned by the pet; placed with `place`.
    pub fn new(pet: HWND, line: &str, scale: f32) -> Option<Bubble> {
        let class = wide(CLASS);
        let hwnd = unsafe {
            CreateWindowExW(
                WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                class.as_ptr(),
                null(),
                WS_POPUP,
                0,
                0,
                1,
                1,
                pet,
                null_mut(),
                instance(),
                null(),
            )
        };
        (!hwnd.is_null()).then(|| Bubble { hwnd, layout: layout(line), scale, drawn: None })
    }

    /// Points the tail at `tip` (screen pixels): above it, or below the pet
    /// (`pet_bottom`) when the screen's top is in the way; inside the work
    /// area either way.
    pub fn place(&mut self, tip: (i32, i32), pet_bottom: i32) {
        let s = self.scale;
        let (w, h) = ((self.layout.size.0 * s).round() as i32, (self.layout.size.1 * s).round() as i32);
        let near = RECT { left: tip.0, top: tip.1, right: tip.0 + 1, bottom: tip.1 + 1 };
        let work = work_area_near(&near);
        let mut below = tip.1 - h < work.top;
        let mut y = if below { pet_bottom } else { tip.1 - h };
        if y + h > work.bottom {
            below = false;
            y = work.top;
        }
        let x = (tip.0 - (w as f32 * 0.75) as i32).min(work.right - w).max(work.left);
        let tail = tip.0 - x;
        if !self.drawn.as_ref().is_some_and(|d| d.0 == tail && d.1 == below) {
            let mut canvas = Canvas::new(self.layout.size.0, self.layout.size.1, s);
            paint(&mut canvas, &self.layout, tail as f32 / s, below);
            let (pw, ph) = (canvas.pixmap.width() as i32, canvas.pixmap.height() as i32);
            self.drawn = Some((tail, below, canvas.to_bgra(), pw, ph));
        }
        if let Some((_, _, bgra, pw, ph)) = &self.drawn {
            present_layered(self.hwnd, bgra, *pw, *ph, x, y);
        }
        unsafe { ShowWindow(self.hwnd, SW_SHOWNOACTIVATE) };
    }

    pub fn destroy(self) {
        unsafe { DestroyWindow(self.hwnd) };
    }
}

unsafe extern "system" fn proc_(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_MOUSEACTIVATE => MA_NOACTIVATE as LRESULT,
            WM_NCHITTEST => HTTRANSPARENT as LRESULT,
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }
}
