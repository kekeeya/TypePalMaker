//! Per-pet settings, kept in `%APPDATA%\TypePal\<pet id>\settings.json` so
//! that several pets run side by side without sharing anything, as each
//! macOS pet has its own preferences domain. Same keys and defaults as
//! `Preferences.swift`.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::strings::Language;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    /// Multiplier on the pet's designed height (`display.height`).
    pub scale: f64,
    pub always_on_top: bool,
    pub click_through: bool,
    pub lock_position: bool,
    pub visible: bool,
    /// Off: a taskbar button, like any app (macOS: the Dock). On: a tray
    /// icon only (macOS: the menu bar).
    pub use_tray_icon: bool,
    /// Unset until chosen, so it follows the system language by default.
    pub language: Option<String>,
    /// Where the pet was left: the window's top-left, in screen pixels.
    pub position: Option<Position>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct Position {
    pub x: i32,
    pub y: i32,
}

pub const SCALE_MIN: f64 = 0.5;
pub const SCALE_MAX: f64 = 2.0;

impl Default for Preferences {
    fn default() -> Self {
        Preferences {
            scale: 1.0,
            always_on_top: true,
            click_through: false,
            lock_position: false,
            visible: true,
            use_tray_icon: false,
            language: None,
            position: None,
        }
    }
}

impl Preferences {
    pub fn scale(&self) -> f64 {
        if self.scale.is_finite() { self.scale.clamp(SCALE_MIN, SCALE_MAX) } else { 1.0 }
    }

    pub fn language(&self, system_prefers_chinese: bool) -> Language {
        self.language.as_deref().and_then(Language::from_code).unwrap_or(if system_prefers_chinese {
            Language::Chinese
        } else {
            Language::English
        })
    }

    /// Missing or unreadable is the defaults: a damaged file must never keep
    /// the pet from starting.
    pub fn load(path: &Path) -> Preferences {
        std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    /// The whole file at once, written beside and renamed over the old one,
    /// so a crash mid-write leaves the previous settings rather than half.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self).map_err(std::io::Error::other)?)?;
        std::fs::rename(&tmp, path)
    }
}

/// `%APPDATA%\TypePal\<id>\settings.json`.
pub fn settings_path(appdata: &Path, pet_id: &str) -> PathBuf {
    let safe: String = pet_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    appdata.join("TypePal").join(if safe.is_empty() { "pet".to_string() } else { safe }).join("settings.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_macos_and_damage_is_survived() {
        let dir = std::env::temp_dir().join(format!("typepal-prefs-{}", std::process::id()));
        let path = settings_path(&dir, "my-pet");
        assert!(path.ends_with("TypePal/my-pet/settings.json") || path.ends_with("TypePal\\my-pet\\settings.json"));
        assert_eq!(Preferences::load(&path), Preferences::default());

        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"{ not json").unwrap();
        assert_eq!(Preferences::load(&path), Preferences::default());

        let mut p = Preferences::default();
        p.scale = 9.0;
        p.position = Some(Position { x: -40, y: 300 });
        p.save(&path).unwrap();
        let back = Preferences::load(&path);
        assert_eq!(back, p);
        assert_eq!(back.scale(), SCALE_MAX);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn language_follows_the_system_until_chosen() {
        let mut p = Preferences::default();
        assert_eq!(p.language(true), Language::Chinese);
        assert_eq!(p.language(false), Language::English);
        p.language = Some("en".into());
        assert_eq!(p.language(true), Language::English);
    }

    #[test]
    fn unknown_keys_and_missing_keys_are_fine() {
        let p: Preferences = serde_json::from_str(r#"{ "scale": 1.5, "futureThing": 3 }"#).unwrap();
        assert_eq!(p.scale, 1.5);
        assert!(p.always_on_top);
    }
}
