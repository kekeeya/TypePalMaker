//! The palette of the macOS pet's settings and menus (`SettingsColors`,
//! `PetMenuColors`, `LanguagePickerColors`), plus the system colours its
//! standard controls take there, read off the Mac versions.

use super::canvas::{Color, rgb, rgba};

#[derive(Clone, Copy)]
pub struct Theme {
    pub dark: bool,
    pub background: Color,
    pub box_fill: Color,
    pub separator: Color,
    pub border: Color,
    pub accent: Color,
    pub icon_ink: Color,
    pub text: Color,
    pub secondary: Color,
    pub orange: Color,
    pub badge_yellow: Color,
    pub badge_blue: Color,
    pub badge_mint: Color,
    pub badge_pink: Color,
    pub badge_peach: Color,
    pub badge_lavender: Color,
    // Standard controls.
    pub control_on: Color,
    pub switch_off: Color,
    pub knob: Color,
    pub slider_track: Color,
    pub tick: Color,
    pub segment_track: Color,
    pub segment_selected: Color,
    pub segment_text: Color,
    pub button_fill: Color,
    // Language picker.
    pub picker_control: Color,
    pub picker_menu: Color,
    pub picker_selected: Color,
    pub picker_hover: Color,
    // The pet's right-click menu.
    pub menu_background: Color,
    pub menu_border: Color,
    pub menu_separator: Color,
    pub menu_hover: Color,
    pub menu_text: Color,
    pub menu_icon: Color,
    pub menu_blue: Color,
    pub menu_yellow: Color,
    pub shadow: Color,
}

impl Theme {
    pub fn new(dark: bool) -> Theme {
        let d = |light: u32, dark_value: u32| rgb(if dark { dark_value } else { light });
        Theme {
            dark,
            background: d(0xFFFCF6, 0x23242B),
            box_fill: d(0xFFFEFC, 0x2D2F38),
            separator: d(0xECE6DE, 0x454753),
            border: d(0xE4DDD4, 0x4B4D59),
            accent: d(0x756FD8, 0x9289F0),
            icon_ink: d(0x353754, 0x292A43),
            text: if dark { rgba(0xFFFFFF, 0.95) } else { rgba(0x000000, 0.92) },
            secondary: if dark { rgba(0xFFFFFF, 0.78) } else { rgba(0x000000, 0.72) },
            orange: d(0xFF8D28, 0xFF9230),
            badge_yellow: d(0xF9D77E, 0xD8B969),
            badge_blue: d(0xBCDDF3, 0x8EB5D4),
            badge_mint: d(0xBCE3D7, 0x89C4B2),
            badge_pink: d(0xF8C7C7, 0xD79B9F),
            badge_peach: d(0xFFD3BE, 0xDCA58D),
            badge_lavender: d(0xD5D0FA, 0xA7A0DC),
            control_on: rgb(0x007AFF),
            switch_off: d(0xE6E5E3, 0x41434B),
            knob: d(0xFFFFFF, 0xE2E2E4),
            slider_track: d(0xE6E5E3, 0x42434C),
            tick: d(0xC5C4C2, 0x5A5C63),
            segment_track: d(0xEBEAE8, 0x3C3E46),
            segment_selected: d(0xCCCCCA, 0x54555D),
            segment_text: if dark { rgba(0xFFFFFF, 0.9) } else { rgb(0x1F1F1F) },
            button_fill: d(0xFFFFFF, 0x4A4C55),
            picker_control: d(0xFFFEFC, 0x32343E),
            picker_menu: d(0xFFFEFC, 0x24252D),
            picker_selected: d(0xF0EDFF, 0x4B4569),
            picker_hover: d(0xF7F5FF, 0x3C394D),
            menu_background: if dark { rgba(0x292B34, 0.98) } else { rgba(0xFFFEF9, 0.98) },
            menu_border: if dark { rgba(0x626078, 0.98) } else { rgba(0xCFC9F0, 0.98) },
            menu_separator: if dark { rgba(0x454753, 0.98) } else { rgba(0xE8E2DD, 0.98) },
            menu_hover: if dark { rgba(0x47435F, 0.98) } else { rgba(0xF0EDFF, 0.98) },
            menu_text: d(0x353754, 0xF4F1FA),
            menu_icon: d(0x353754, 0x292A43),
            menu_blue: d(0xC7E6F7, 0x8EB5D4),
            menu_yellow: d(0xFFE49B, 0xD8B969),
            shadow: rgba(0x000000, if dark { 0.45 } else { 0.22 }),
        }
    }
}
