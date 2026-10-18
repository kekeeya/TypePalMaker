//! The pet's speech bubble window (`SpeechBubble.swift` on macOS): a layered
//! window owned by the pet, so it stays just above it, that never takes the
//! mouse or the focus. Created to show a line and destroyed when it hides;
//! nothing is kept while the pet is quiet. It comes in floating up a little,
//! quickly.

use std::ptr::{null, null_mut};
use std::time::Instant;
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

use super::win32::*;
use crate::ui::bubble::{BubbleLayout, layout, paint};
use crate::ui::canvas::Canvas;

const CLASS: &str = "TypePalBubble";
/// The rise: how long, and from how far below, in points.
const RISE_SECONDS: f32 = 0.18;
const RISE_FROM: f32 = 6.0;

pub fn register() {
    register_class(CLASS, proc_, false);
}

pub struct Bubble {
    hwnd: HWND,
    layout: BubbleLayout,
    scale: f32,
    /// The last drawing, and where its tail was: moving the bubble with the
    /// pet reuses it rather than drawing again.
    drawn: Option<(i32, bool, Dib)>,
    /// Where the bubble sits once risen, in screen pixels.
    origin: (i32, i32),
    shown: Instant,
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
        (!hwnd.is_null()).then(|| Bubble { hwnd, layout: layout(line), scale, drawn: None, origin: (0, 0), shown: Instant::now() })
    }

    /// Takes a new line in place of the one up, rising again; the window is
    /// kept, as a fast typist changes the line often. Placed with `place`.
    pub fn set_line(&mut self, line: &str, scale: f32) {
        self.layout = layout(line);
        // The pet may have moved to a monitor scaled differently.
        self.scale = scale;
        self.drawn = None;
        self.shown = Instant::now();
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
        // Centred on the head.
        let x = (tip.0 - w / 2).min(work.right - w).max(work.left);
        let tail = tip.0 - x;
        if !self.drawn.as_ref().is_some_and(|d| d.0 == tail && d.1 == below) {
            let mut canvas = Canvas::new(self.layout.size.0, self.layout.size.1, s);
            paint(&mut canvas, &self.layout, tail as f32 / s, below);
            let (pw, ph) = (canvas.pixmap.width() as i32, canvas.pixmap.height() as i32);
            self.drawn = Dib::new(pw, ph).map(|mut dib| {
                dib.pixels().copy_from_slice(&canvas.to_bgra());
                (tail, below, dib)
            });
        }
        self.origin = (x, y);
        self.present();
        unsafe { ShowWindow(self.hwnd, SW_SHOWNOACTIVATE) };
    }

    /// Moves the rise on; false once the bubble has risen.
    pub fn rise(&mut self) -> bool {
        self.present();
        self.progress() < 1.0
    }

    fn progress(&self) -> f32 {
        (self.shown.elapsed().as_secs_f32() / RISE_SECONDS).min(1.0)
    }

    /// Draws the bubble where the rise has got to: easing out (cubic, as on
    /// macOS), fading in.
    fn present(&self) {
        let Some((_, _, dib)) = &self.drawn else { return };
        let eased = 1.0 - (1.0 - self.progress()).powi(3);
        let drop = ((1.0 - eased) * RISE_FROM * self.scale).round() as i32;
        dib.present_faded(self.hwnd, self.origin.0, self.origin.1 + drop, (eased * 255.0).round() as u8);
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
