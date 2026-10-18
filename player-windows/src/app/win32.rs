//! Small helpers over the raw Win32 calls.

use std::ffi::c_void;
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Graphics::Gdi::*;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

/// From the common controls headers, which are otherwise not needed.
pub const WM_MOUSELEAVE: u32 = 0x02A3;

/// A NUL-terminated UTF-16 copy of `s`.
pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn instance() -> HINSTANCE {
    unsafe { GetModuleHandleW(null()) }
}

pub type WndProc = unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT;

/// Registers a window class; `icon` is the executable's own icon.
pub fn register_class(name: &str, proc_: WndProc, icon: bool) -> Vec<u16> {
    let class = wide(name);
    unsafe {
        let wc = WNDCLASSEXW {
            cbSize: size_of::<WNDCLASSEXW>() as u32,
            style: 0,
            lpfnWndProc: Some(proc_),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance(),
            hIcon: if icon { app_icon(32) } else { null_mut() },
            hCursor: LoadCursorW(null_mut(), IDC_ARROW),
            hbrBackground: null_mut(),
            lpszMenuName: null(),
            lpszClassName: class.as_ptr(),
            hIconSm: if icon { app_icon(16) } else { null_mut() },
        };
        RegisterClassExW(&wc);
    }
    class
}

/// The pet's icon, resource 1 of this executable: the template's, or the one
/// the Maker put in.
pub fn app_icon(size: i32) -> HICON {
    unsafe { LoadImageW(instance(), 1 as _, IMAGE_ICON, size, size, LR_DEFAULTCOLOR) as HICON }
}

pub fn dpi_scale(hwnd: HWND) -> f32 {
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi == 0 { 1.0 } else { dpi as f32 / 96.0 }
}

/// The scale of the monitor a window is on now. Read directly, because the
/// WM_DPICHANGED that a move sends can arrive while the app is busy with the
/// move itself, and be passed over.
pub fn monitor_scale(hwnd: HWND) -> f32 {
    use windows_sys::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
    let (mut x, mut y) = (0u32, 0u32);
    let ok = unsafe { GetDpiForMonitor(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), MDT_EFFECTIVE_DPI, &mut x, &mut y) };
    if ok != 0 || y == 0 { dpi_scale(hwnd) } else { y as f32 / 96.0 }
}

pub fn loword(v: usize) -> u16 {
    (v & 0xffff) as u16
}

pub fn hiword(v: usize) -> u16 {
    ((v >> 16) & 0xffff) as u16
}

/// Signed client coordinates from a mouse message's `lParam`.
pub fn point_from_lparam(l: LPARAM) -> (i32, i32) {
    ((l & 0xffff) as i16 as i32, ((l >> 16) & 0xffff) as i16 as i32)
}

pub fn cursor_pos() -> POINT {
    let mut p = POINT { x: 0, y: 0 };
    unsafe { GetCursorPos(&mut p) };
    p
}

pub fn window_rect(hwnd: HWND) -> RECT {
    let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    unsafe { GetWindowRect(hwnd, &mut r) };
    r
}

/// The work area (screen minus taskbar) of the monitor nearest `r`.
pub fn work_area_near(r: &RECT) -> RECT {
    unsafe {
        let monitor = MonitorFromRect(r, MONITOR_DEFAULTTONEAREST);
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = size_of::<MONITORINFO>() as u32;
        GetMonitorInfoW(monitor, &mut info);
        info.rcWork
    }
}

pub fn primary_work_area() -> RECT {
    let r = RECT { left: 0, top: 0, right: 1, bottom: 1 };
    work_area_near(&r)
}

/// A top-down 32-bit DIB section, for a layered window's content.
pub struct Dib {
    pub dc: HDC,
    bitmap: HBITMAP,
    old: HGDIOBJ,
    pub bits: *mut u8,
    pub width: i32,
    pub height: i32,
}

impl Dib {
    pub fn new(width: i32, height: i32) -> Option<Dib> {
        unsafe {
            let screen = GetDC(null_mut());
            let dc = CreateCompatibleDC(screen);
            ReleaseDC(null_mut(), screen);
            let mut info: BITMAPINFO = std::mem::zeroed();
            info.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
            info.bmiHeader.biWidth = width;
            info.bmiHeader.biHeight = -height;
            info.bmiHeader.biPlanes = 1;
            info.bmiHeader.biBitCount = 32;
            info.bmiHeader.biCompression = BI_RGB;
            let mut bits: *mut c_void = null_mut();
            let bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &mut bits, null_mut(), 0);
            if bitmap.is_null() || bits.is_null() {
                DeleteDC(dc);
                return None;
            }
            let old = SelectObject(dc, bitmap as HGDIOBJ);
            Some(Dib { dc, bitmap, old, bits: bits as *mut u8, width, height })
        }
    }

    pub fn pixels(&mut self) -> &mut [u8] {
        unsafe { std::slice::from_raw_parts_mut(self.bits, (self.width * self.height * 4) as usize) }
    }

    /// Shows the DIB (premultiplied BGRA) as `hwnd`'s content at `x`, `y`.
    pub fn present(&self, hwnd: HWND, x: i32, y: i32) {
        self.present_faded(hwnd, x, y, 255);
    }

    /// As `present`, the whole window at `alpha` (0 to 255).
    pub fn present_faded(&self, hwnd: HWND, x: i32, y: i32, alpha: u8) {
        unsafe {
            let blend = BLENDFUNCTION { BlendOp: AC_SRC_OVER as u8, BlendFlags: 0, SourceConstantAlpha: alpha, AlphaFormat: AC_SRC_ALPHA as u8 };
            let pos = POINT { x, y };
            let size = SIZE { cx: self.width, cy: self.height };
            let src = POINT { x: 0, y: 0 };
            UpdateLayeredWindow(hwnd, null_mut(), &pos, &size, self.dc, &src, 0, &blend, ULW_ALPHA);
        }
    }
}

impl Drop for Dib {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.dc, self.old);
            DeleteObject(self.bitmap as HGDIOBJ);
            DeleteDC(self.dc);
        }
    }
}

/// Shows `bgra` (premultiplied, `w` × `h`) as a layered window's content.
pub fn present_layered(hwnd: HWND, bgra: &[u8], w: i32, h: i32, x: i32, y: i32) {
    if let Some(mut dib) = Dib::new(w, h) {
        dib.pixels().copy_from_slice(&bgra[..(w * h * 4) as usize]);
        dib.present(hwnd, x, y);
    }
}

/// Paints an opaque BGRA buffer into a window's client area.
pub fn blit_to_dc(dc: HDC, bgra: &[u8], w: i32, h: i32) {
    unsafe {
        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = w;
        info.bmiHeader.biHeight = -h;
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB;
        SetDIBitsToDevice(dc, 0, 0, w as u32, h as u32, 0, 0, 0, h as u32, bgra.as_ptr() as *const c_void, &info, DIB_RGB_COLORS);
    }
}

pub fn message_box(title: &str, text: &str) {
    let (t, m) = (wide(title), wide(text));
    unsafe { MessageBoxW(null_mut(), m.as_ptr(), t.as_ptr(), MB_OK | MB_ICONWARNING | MB_SETFOREGROUND) };
}

pub fn open_url(url: &str) {
    let (verb, target) = (wide("open"), wide(url));
    unsafe {
        windows_sys::Win32::UI::Shell::ShellExecuteW(null_mut(), verb.as_ptr(), target.as_ptr(), null(), null(), SW_SHOWNORMAL);
    }
}
