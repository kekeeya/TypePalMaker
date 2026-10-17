//! Every user-facing string, as a Chinese/English pair, matching the macOS
//! runtime's `Localization.swift` wherever the two systems say the same thing.

use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Language {
    Chinese,
    English,
}

impl Language {
    pub const ALL: [Language; 2] = [Language::Chinese, Language::English];

    /// Stored in the settings file; the same values as on macOS.
    pub fn code(self) -> &'static str {
        match self {
            Language::Chinese => "zh-Hans",
            Language::English => "en",
        }
    }

    pub fn from_code(code: &str) -> Option<Language> {
        Language::ALL.into_iter().find(|l| l.code() == code)
    }

    /// Each language names itself, so the picker reads whichever is showing.
    pub fn display_name(self) -> &'static str {
        match self {
            Language::Chinese => "简体中文",
            Language::English => "English",
        }
    }
}

static CHINESE: AtomicBool = AtomicBool::new(true);

pub fn set_language(language: Language) {
    CHINESE.store(language == Language::Chinese, Ordering::Relaxed);
}

pub fn language() -> Language {
    if CHINESE.load(Ordering::Relaxed) { Language::Chinese } else { Language::English }
}

fn pick(zh: &str, en: &str) -> String {
    if CHINESE.load(Ordering::Relaxed) { zh.to_string() } else { en.to_string() }
}

/// A message worded in both languages; shown in the one the interface uses.
#[derive(Clone, Debug, PartialEq)]
pub struct Bilingual {
    pub chinese: String,
    pub english: String,
}

impl Bilingual {
    pub fn new(chinese: impl Into<String>, english: impl Into<String>) -> Bilingual {
        Bilingual { chinese: chinese.into(), english: english.into() }
    }

    pub fn text(&self) -> String {
        pick(&self.chinese, &self.english)
    }
}

impl std::fmt::Display for Bilingual {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.text())
    }
}

// Menus

pub fn hide_pet() -> String { pick("隐藏桌宠", "Hide Pet") }
pub fn show_pet() -> String { pick("显示桌宠", "Show Pet") }
pub fn settings_ellipsis() -> String { pick("设置…", "Settings…") }
pub fn quit(name: &str) -> String { pick(&format!("退出 {name}"), &format!("Quit {name}")) }

// Settings

pub fn settings_title(name: &str) -> String { pick(&format!("{name} 设置"), &format!("{name} Settings")) }
pub fn section_display() -> String { pick("显示", "Display") }
pub fn pet_size() -> String { pick("桌宠大小", "Pet Size") }
pub fn size_small() -> String { pick("小", "S") }
pub fn size_large() -> String { pick("大", "L") }
pub fn always_on_top() -> String { pick("永远置顶", "Always on Top") }
pub fn lock_position() -> String { pick("锁定位置", "Lock Position") }
pub fn click_through() -> String { pick("鼠标穿透", "Click-Through") }
pub fn section_general() -> String { pick("通用", "General") }
pub fn launch_at_login() -> String { pick("开机时自动启动", "Launch at Login") }
pub fn icon_placement() -> String { pick("图标常驻", "Show Icon In") }
/// The Windows counterparts of macOS's 程序坞 / 菜单栏.
pub fn taskbar() -> String { pick("任务栏", "Taskbar") }
pub fn tray() -> String { pick("通知区域", "System Tray") }
pub fn language_label() -> String { pick("语言", "Language") }
/// macOS's "still needs approval in Login Items", on Windows: the entry is
/// there but switched off in Settings › Apps › Startup.
pub fn login_needs_approval(name: &str) -> String {
    pick(
        &format!("还需要在 Windows「设置 › 应用 › 启动」里把 {name} 打开。"),
        &format!("Turn on {name} in Windows Settings › Apps › Startup to finish."),
    )
}
pub fn open_startup_apps() -> String { pick("打开启动应用设置", "Open Startup Apps Settings") }
pub fn launch_failed(detail: &str) -> String {
    pick(&format!("无法设置开机启动：{detail}"), &format!("Couldn't change Launch at Login: {detail}"))
}

// Startup failures

pub fn cannot_start() -> String { pick("TypePal 无法启动", "TypePal Can't Start") }
pub fn pet_data_missing() -> String {
    pick(
        "找不到桌宠数据。\n\n开发时可用 --pet <目录> 或环境变量 TYPEPAL_PET_DIR 指定。",
        "Pet data not found.\n\nDuring development, pass --pet <dir> or set TYPEPAL_PET_DIR.",
    )
}
pub fn pet_data_invalid(detail: &str) -> String {
    pick(&format!("桌宠数据有误：{detail}"), &format!("The pet data is invalid: {detail}"))
}
pub fn frames_unreadable(ids: &str) -> String {
    pick(&format!("以下帧的图片无法读取：{ids}"), &format!("These frame images can't be read: {ids}"))
}
