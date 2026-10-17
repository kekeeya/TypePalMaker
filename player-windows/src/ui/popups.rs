//! The small custom-drawn windows: the pet's right-click menu
//! (`PetContextMenu.swift`), the language dropdown (`LanguageSelector.swift`)
//! and the privacy policy (`PrivacyPolicy.swift`).
//!
//! Popups are drawn with a margin around them for their shadow; `MARGIN` is
//! where the shape itself starts.

use super::canvas::{Canvas, Frame, Weight, baseline_for_center, measure};
use super::icons::{self, Icon};
use super::theme::Theme;
use super::wrap::wrap;
use crate::strings::{self, Language};

/// Room for the drop shadow around a popup.
pub const MARGIN: f32 = 16.0;

// MARK: The pet's menu

pub const MENU_SIZE: (f32, f32) = (224.0, 94.0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MenuItem {
    Hide,
    Settings,
}

fn menu_rows() -> [(MenuItem, Frame); 2] {
    [
        (MenuItem::Hide, Frame::new(MARGIN + 6.0, MARGIN + 6.0, MENU_SIZE.0 - 12.0, 40.0)),
        (MenuItem::Settings, Frame::new(MARGIN + 6.0, MARGIN + 47.0, MENU_SIZE.0 - 12.0, 40.0)),
    ]
}

pub fn menu_hit(x: f32, y: f32) -> Option<MenuItem> {
    menu_rows().into_iter().find(|(_, f)| f.contains(x, y)).map(|(i, _)| i)
}

pub fn paint_menu(c: &mut Canvas, t: &Theme, hover: Option<MenuItem>) {
    let body = Frame::new(MARGIN, MARGIN, MENU_SIZE.0, MENU_SIZE.1);
    c.shadow(body, 18.0, 10.0, 4.0, t.shadow.with_alpha(0.6));
    c.fill_rrect(body, 18.0, t.menu_background);
    c.stroke_rrect(body, 18.0, 1.5, t.menu_border);
    c.fill_rect(Frame::new(MARGIN + 16.0, MARGIN + 46.0, MENU_SIZE.0 - 32.0, 1.0), t.menu_separator);
    for (item, f) in menu_rows() {
        if hover == Some(item) {
            c.fill_rrect(f, 12.0, t.menu_hover);
        }
        let (title, icon, badge) = match item {
            MenuItem::Hide => (strings::hide_pet(), Icon::RectangleDashed, t.menu_blue),
            MenuItem::Settings => (strings::settings_ellipsis(), Icon::Gear, t.menu_yellow),
        };
        let b = Frame::new(f.x + 8.0, f.mid_y() - 14.0, 28.0, 28.0);
        c.fill_rrect(b, 12.0, badge);
        icons::draw(c, icon, b.mid_x(), b.mid_y(), 16.0, 2.2, t.menu_icon);
        let base = baseline_for_center(f.mid_y(), 15.0, Weight::Semibold);
        c.text(&title, b.max_x() + 10.0, base, 15.0, Weight::Semibold, t.menu_text);
    }
}

// MARK: Language dropdown

pub const DROPDOWN_SIZE: (f32, f32) = (174.0, 94.0);

fn dropdown_rows() -> [(Language, Frame); 2] {
    let x = MARGIN + 7.0;
    let w = DROPDOWN_SIZE.0 - 14.0;
    [
        (Language::Chinese, Frame::new(x, MARGIN + 7.0, w, 39.0)),
        (Language::English, Frame::new(x, MARGIN + 48.0, w, 39.0)),
    ]
}

pub fn dropdown_hit(x: f32, y: f32) -> Option<Language> {
    dropdown_rows().into_iter().find(|(_, f)| f.contains(x, y)).map(|(l, _)| l)
}

pub fn paint_dropdown(c: &mut Canvas, t: &Theme, selected: Language, hover: Option<Language>) {
    let body = Frame::new(MARGIN, MARGIN, DROPDOWN_SIZE.0, DROPDOWN_SIZE.1);
    c.shadow(body, 15.0, 10.0, 4.0, t.shadow.with_alpha(0.6));
    c.fill_rrect(body, 15.0, t.picker_menu);
    c.stroke_rrect(body, 15.0, 1.5, t.accent.with_alpha(0.86));
    for (language, f) in dropdown_rows() {
        let is_selected = language == selected;
        if is_selected {
            c.fill_rrect(f, 10.0, t.picker_selected);
        } else if hover == Some(language) {
            c.fill_rrect(f, 10.0, t.picker_hover);
        }
        let weight = if is_selected { Weight::Semibold } else { Weight::Medium };
        let base = baseline_for_center(f.mid_y(), 13.0, weight);
        c.text(language.display_name(), f.x + 12.0, base, 13.0, weight, t.text);
        if is_selected {
            icons::draw(c, Icon::Checkmark, f.max_x() - 12.0 - 6.0, f.mid_y(), 12.5, 2.8, t.accent);
        }
    }
}

// MARK: Privacy policy

pub const POLICY_SIZE: (f32, f32) = (420.0, 440.0);
const POLICY_TEXT_TOP: f32 = 55.0;
const POLICY_TEXT_BOTTOM: f32 = 20.0;
const POLICY_TEXT_X: f32 = 24.0;
const BODY_SIZE: f32 = 13.0;
const LINE_HEIGHT: f32 = 20.0;

/// The policy, laid out: each line with its weight and where it sits from the
/// top of the text.
pub struct PolicyLayout {
    lines: Vec<(String, Weight, f32)>,
    pub height: f32,
}

pub fn policy_layout(sections: &[(Option<String>, String)]) -> PolicyLayout {
    let width = POLICY_SIZE.0 - 2.0 * POLICY_TEXT_X;
    let mut lines = Vec::new();
    let mut y = 0.0;
    for (i, (heading, body)) in sections.iter().enumerate() {
        let last = i == sections.len() - 1;
        if last {
            // A blank line of its own above the closing note.
            y += LINE_HEIGHT;
        }
        if let Some(h) = heading {
            for l in wrap(h, BODY_SIZE, Weight::Bold, width) {
                lines.push((l, Weight::Bold, y));
                y += LINE_HEIGHT;
            }
        }
        for paragraph in body.split('\n') {
            for l in wrap(paragraph, BODY_SIZE, Weight::Regular, width) {
                lines.push((l, Weight::Regular, y));
                y += LINE_HEIGHT;
            }
            y += 2.0;
        }
        // The gap that separates this section from the next.
        y += 8.0;
    }
    PolicyLayout { lines, height: y }
}

/// The largest scroll offset for a policy of `content` height.
pub fn policy_max_scroll(layout: &PolicyLayout) -> f32 {
    (layout.height - (POLICY_SIZE.1 - POLICY_TEXT_TOP - POLICY_TEXT_BOTTOM)).max(0.0)
}

pub fn policy_close_frame() -> Frame {
    Frame::new(POLICY_SIZE.0 - 24.0 - 16.0, 24.0, 16.0, 19.0)
}

pub fn paint_policy(c: &mut Canvas, t: &Theme, title: &str, layout: &PolicyLayout, scroll: f32, show_scroller: bool) {
    c.clear(t.background);
    let title_mid = 24.0 + 9.5;
    let base = baseline_for_center(title_mid, 16.0, Weight::Bold);
    c.text(title, 24.0, base, 16.0, Weight::Bold, t.text);
    let close = policy_close_frame();
    icons::draw(c, Icon::Xmark, close.mid_x(), title_mid, 12.5, 1.9, t.secondary.with_alpha(0.75));

    // The text, clipped to its area by drawing only lines inside it.
    let top = POLICY_TEXT_TOP;
    let bottom = POLICY_SIZE.1 - POLICY_TEXT_BOTTOM;
    let mut text = Canvas::new(POLICY_SIZE.0, bottom - top, c.scale);
    for (line, weight, y) in &layout.lines {
        let ly = y - scroll;
        if ly + LINE_HEIGHT < 0.0 || ly > bottom - top {
            continue;
        }
        let base = baseline_for_center(ly + LINE_HEIGHT / 2.0, BODY_SIZE, *weight);
        text.text(line, POLICY_TEXT_X, base, BODY_SIZE, *weight, t.text.with_alpha(0.93));
    }
    let max = policy_max_scroll(layout);
    if show_scroller && max > 0.0 {
        let area = bottom - top;
        let knob_h = (area * area / layout.height).max(24.0);
        let knob_y = (area - knob_h) * (scroll / max);
        text.fill_rrect(Frame::new(POLICY_SIZE.0 - 9.0, knob_y + 2.0, 5.0, knob_h - 4.0), 2.5, t.secondary.with_alpha(0.5));
    }
    c.pixmap.draw_pixmap(
        0,
        (top * c.scale).round() as i32,
        text.pixmap.as_ref(),
        &tiny_skia::PixmapPaint::default(),
        tiny_skia::Transform::identity(),
        None,
    );
}

/// Width of the whole text, for tests.
pub fn longest_line(layout: &PolicyLayout) -> f32 {
    layout.lines.iter().map(|(l, w, _)| measure(l, BODY_SIZE, *w)).fold(0.0, f32::max)
}
