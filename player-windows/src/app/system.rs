//! What the pet asks of Windows: the language and colour scheme, launching at
//! login, and whether a full-screen app is showing.

use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Globalization::GetUserDefaultUILanguage;
use windows_sys::Win32::System::Registry::*;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

use super::win32::{wide, window_rect};

pub fn system_prefers_chinese() -> bool {
    // LANG_CHINESE, whatever the sublanguage.
    unsafe { GetUserDefaultUILanguage() & 0x3ff == 0x04 }
}

fn read_dword(root: HKEY, key: &str, value: &str) -> Option<u32> {
    let (k, v) = (wide(key), wide(value));
    let mut data: u32 = 0;
    let mut size = 4u32;
    let status = unsafe {
        RegGetValueW(root, k.as_ptr(), v.as_ptr(), RRF_RT_REG_DWORD, null_mut(), &mut data as *mut u32 as _, &mut size)
    };
    (status == ERROR_SUCCESS).then_some(data)
}

/// Apps in dark mode, as chosen in Settings › Personalisation › Colours.
pub fn is_dark_mode() -> bool {
    read_dword(HKEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "AppsUseLightTheme")
        == Some(0)
}

// MARK: Launch at login

const RUN: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const APPROVED: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoginStatus {
    Off,
    On,
    /// Registered, but switched off in Settings › Apps › Startup: the
    /// counterpart of macOS's "requires approval".
    NeedsApproval,
}

fn value_name(pet_id: &str) -> String {
    format!("TypePal-{pet_id}")
}

fn exe_path() -> String {
    std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default()
}

fn read_string(root: HKEY, key: &str, value: &str) -> Option<String> {
    let (k, v) = (wide(key), wide(value));
    let mut size = 0u32;
    unsafe {
        if RegGetValueW(root, k.as_ptr(), v.as_ptr(), RRF_RT_REG_SZ, null_mut(), null_mut(), &mut size) != ERROR_SUCCESS {
            return None;
        }
        let mut buf = vec![0u16; size as usize / 2 + 1];
        if RegGetValueW(root, k.as_ptr(), v.as_ptr(), RRF_RT_REG_SZ, null_mut(), buf.as_mut_ptr() as _, &mut size) != ERROR_SUCCESS {
            return None;
        }
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..len]))
    }
}

/// Read from the registry each time, never assumed: the entry can be removed
/// or switched off elsewhere, and the exe may have moved since.
pub fn login_status(pet_id: &str) -> LoginStatus {
    let name = value_name(pet_id);
    let Some(command) = read_string(HKEY_CURRENT_USER, RUN, &name) else { return LoginStatus::Off };
    let expected = format!("\"{}\"", exe_path());
    if !command.eq_ignore_ascii_case(&expected) {
        return LoginStatus::Off;
    }
    // StartupApproved: the first byte is odd when the user switched it off.
    let (k, v) = (wide(APPROVED), wide(&name));
    let mut data = [0u8; 12];
    let mut size = data.len() as u32;
    let status = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, k.as_ptr(), v.as_ptr(), RRF_RT_REG_BINARY, null_mut(), data.as_mut_ptr() as _, &mut size)
    };
    if status == ERROR_SUCCESS && size > 0 && data[0] & 1 == 1 {
        return LoginStatus::NeedsApproval;
    }
    LoginStatus::On
}

pub fn set_launch_at_login(pet_id: &str, on: bool) -> Result<(), String> {
    let (k, name) = (wide(RUN), wide(&value_name(pet_id)));
    unsafe {
        let mut key: HKEY = null_mut();
        let status = RegCreateKeyExW(HKEY_CURRENT_USER, k.as_ptr(), 0, null(), 0, KEY_SET_VALUE, null(), &mut key, null_mut());
        if status != ERROR_SUCCESS {
            return Err(format!("{status}"));
        }
        let status = if on {
            let command = wide(&format!("\"{}\"", exe_path()));
            RegSetValueExW(key, name.as_ptr(), 0, REG_SZ, command.as_ptr() as *const u8, (command.len() * 2) as u32)
        } else {
            match RegDeleteValueW(key, name.as_ptr()) {
                ERROR_FILE_NOT_FOUND => ERROR_SUCCESS,
                s => s,
            }
        };
        RegCloseKey(key);
        if status == ERROR_SUCCESS { Ok(()) } else { Err(format!("{status}")) }
    }
}

// MARK: Full screen

/// Whether the foreground window fills the monitor `hwnd` is on: a video, a
/// game, a presentation. The pet stays out of the way of those, as on macOS
/// it stays out of full-screen Spaces. The desktop itself does not count.
pub fn full_screen_app_over(hwnd: HWND, ours: &[HWND]) -> bool {
    unsafe {
        let fg = GetForegroundWindow();
        if fg.is_null() || ours.contains(&fg) || fg == GetDesktopWindow() || fg == GetShellWindow() {
            return false;
        }
        let mut class = [0u16; 64];
        let n = GetClassNameW(fg, class.as_mut_ptr(), class.len() as i32);
        let class = String::from_utf16_lossy(&class[..n.max(0) as usize]);
        if class == "Progman" || class == "WorkerW" || class == "Shell_TrayWnd" {
            return false;
        }
        let monitor_fg = windows_sys::Win32::Graphics::Gdi::MonitorFromWindow(fg, 0);
        let monitor_pet = windows_sys::Win32::Graphics::Gdi::MonitorFromWindow(hwnd, 2);
        if monitor_fg != monitor_pet {
            return false;
        }
        let mut info: windows_sys::Win32::Graphics::Gdi::MONITORINFO = std::mem::zeroed();
        info.cbSize = size_of::<windows_sys::Win32::Graphics::Gdi::MONITORINFO>() as u32;
        windows_sys::Win32::Graphics::Gdi::GetMonitorInfoW(monitor_fg, &mut info);
        let r = window_rect(fg);
        let m = info.rcMonitor;
        r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom
    }
}
