//! The settings window's content, drawn to match the macOS pet's grouped form
//! (`SettingsWindow.swift`): the same cards, rows, measurements and colours.

use super::canvas::{Canvas, Color, Frame, Weight, baseline_for_center, measure};
use super::icons::{self, Icon};
use super::theme::Theme;
use super::wrap::wrap;
use crate::prefs::{SCALE_MAX, SCALE_MIN};
use crate::strings::{self, Language};

/// `SettingsLayout` on macOS.
pub const WIDTH: f32 = 520.0;
const BOX_WIDTH: f32 = 472.0;
const ROW_INSET: f32 = 16.0;
const ROW_HEIGHT: f32 = 52.0;
const HEADER_HEIGHT: f32 = 60.0;
const ICON_SIDE: f32 = 34.0;
const HEADER_ICON_SIDE: f32 = 38.0;
const SLIDER_WIDTH: f32 = 210.0;
pub const LANGUAGE_WIDTH: f32 = 136.0;
pub const LANGUAGE_HEIGHT: f32 = 34.0;
const CORNER_RADIUS: f32 = 18.0;
const TOP_INSET: f32 = 26.0;
const CARD_SPACING: f32 = 18.0;
const BOX_TO_FOOTER: f32 = 22.0;
const BOTTOM_INSET: f32 = 20.0;
const FOOTER_HEIGHT: f32 = 15.0;
/// 0.5×–2× in 16 notches of 10%.
pub const NOTCHES: usize = 16;

const SWITCH: (f32, f32) = (36.0, 16.0);
/// Each segment is as wide as its label plus this, as AppKit fits them.
const SEGMENT_PADDING: f32 = 20.5;
const SEGMENT_HEIGHT: f32 = 24.0;
const KNOB: (f32, f32) = (20.0, 16.5);

#[derive(Clone, Debug, PartialEq)]
pub enum LoginNote {
    /// Registered, but switched off in Windows' Startup apps.
    NeedsApproval,
    Failed(String),
}

/// The values shown.
#[derive(Clone, Debug, PartialEq)]
pub struct SettingsModel {
    pub name: String,
    pub scale: f64,
    pub always_on_top: bool,
    pub lock_position: bool,
    pub click_through: bool,
    pub launch_at_login: bool,
    pub login_notes: Vec<LoginNote>,
    pub use_tray: bool,
    pub language: Language,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    Slider,
    AlwaysOnTop,
    LockPosition,
    ClickThrough,
    LaunchAtLogin,
    OpenStartupApps,
    IconTaskbar,
    IconTray,
    Language,
    MakerLink,
    PrivacyLink,
}

impl Target {
    /// Links show the pointing hand, as on macOS.
    pub fn is_link(self) -> bool {
        matches!(self, Target::MakerLink | Target::PrivacyLink)
    }
}

struct Note {
    icon: Icon,
    lines: Vec<String>,
    button: bool,
}

struct Row {
    label: String,
    icon: Icon,
    badge: fn(&Theme) -> Color,
    /// The 52-point line itself.
    line: Frame,
    notes: Vec<(Frame, Note)>,
    control: Control,
}

#[derive(Clone, Copy)]
enum Control {
    Slider,
    Switch(Target, bool),
    Segmented,
    Language,
}

struct Card {
    frame: Frame,
    title: String,
    icon: Icon,
    badge: fn(&Theme) -> Color,
    rows: Vec<Row>,
}

pub struct SettingsView {
    pub model: SettingsModel,
    pub hover: Option<Target>,
    pub pressed: Option<Target>,
    cards: Vec<Card>,
    height: f32,
    footer_y: f32,
}

const NOTE_SIZE: f32 = 11.0;
const NOTE_LINE: f32 = 14.0;
const NOTE_BUTTON_HEIGHT: f32 = 22.0;

impl SettingsView {
    pub fn new(model: SettingsModel) -> SettingsView {
        let mut view = SettingsView { model, hover: None, pressed: None, cards: Vec::new(), height: 0.0, footer_y: 0.0 };
        view.layout();
        view
    }

    pub fn set_model(&mut self, model: SettingsModel) {
        self.model = model;
        self.layout();
    }

    pub fn height(&self) -> f32 {
        self.height
    }

    fn layout(&mut self) {
        let m = &self.model;
        let x = (WIDTH - BOX_WIDTH) / 2.0;
        let mut y = TOP_INSET;
        let mut cards = Vec::new();

        let mut card = |title: String, icon: Icon, badge: fn(&Theme) -> Color, rows: Vec<(String, Icon, fn(&Theme) -> Color, Control, Vec<Note>)>, y: &mut f32| {
            let top = *y;
            let mut cy = top + HEADER_HEIGHT + 1.0;
            let mut out = Vec::new();
            for (i, (label, icon, badge, control, notes)) in rows.into_iter().enumerate() {
                if i > 0 {
                    cy += 1.0;
                }
                let line = Frame::new(x, cy, BOX_WIDTH, ROW_HEIGHT);
                cy += ROW_HEIGHT;
                let mut placed = Vec::new();
                for note in notes {
                    let h = if note.button { NOTE_BUTTON_HEIGHT } else { note.lines.len() as f32 * NOTE_LINE };
                    placed.push((Frame::new(x + ROW_INSET, cy, BOX_WIDTH - 2.0 * ROW_INSET, h), note));
                    cy += h + 4.0;
                }
                if !placed.is_empty() {
                    // The stack's spacing after the last note becomes its
                    // 10-point bottom inset.
                    cy += 10.0 - 4.0;
                }
                out.push(Row { label, icon, badge, line, notes: placed, control });
            }
            cards.push(Card { frame: Frame::new(x, top, BOX_WIDTH, cy - top), title, icon, badge, rows: out });
            *y = cy;
        };

        card(
            strings::section_display(),
            Icon::SunMax,
            |t| t.badge_yellow,
            vec![
                (strings::pet_size(), Icon::Display, |t| t.badge_blue, Control::Slider, vec![]),
                (strings::always_on_top(), Icon::Pin, |t| t.badge_pink, Control::Switch(Target::AlwaysOnTop, m.always_on_top), vec![]),
                (strings::lock_position(), Icon::Lock, |t| t.badge_mint, Control::Switch(Target::LockPosition, m.lock_position), vec![]),
                (strings::click_through(), Icon::CursorClick, |t| t.badge_peach, Control::Switch(Target::ClickThrough, m.click_through), vec![]),
            ],
            &mut y,
        );
        y += CARD_SPACING;

        let width = BOX_WIDTH - 2.0 * ROW_INSET - 20.0;
        let mut notes = Vec::new();
        for note in &m.login_notes {
            match note {
                LoginNote::NeedsApproval => {
                    notes.push(Note {
                        icon: Icon::Warning,
                        lines: wrap(&strings::login_needs_approval(&m.name), NOTE_SIZE, Weight::Regular, width),
                        button: false,
                    });
                    notes.push(Note { icon: Icon::Warning, lines: vec![strings::open_startup_apps()], button: true });
                }
                LoginNote::Failed(text) => notes.push(Note {
                    icon: Icon::XmarkCircle,
                    lines: wrap(text, NOTE_SIZE, Weight::Regular, width),
                    button: false,
                }),
            }
        }
        card(
            strings::section_general(),
            Icon::Gear,
            |t| t.badge_blue,
            vec![
                (strings::launch_at_login(), Icon::Power, |t| t.badge_yellow, Control::Switch(Target::LaunchAtLogin, m.launch_at_login), notes),
                (strings::icon_placement(), Icon::Dock, |t| t.badge_lavender, Control::Segmented, vec![]),
                (strings::language_label(), Icon::CharacterBubble, |t| t.badge_mint, Control::Language, vec![]),
            ],
            &mut y,
        );

        self.footer_y = y + BOX_TO_FOOTER;
        self.height = self.footer_y + FOOTER_HEIGHT + BOTTOM_INSET;
        self.cards = cards;
    }

    // MARK: Geometry

    fn trailing(line: Frame, w: f32, h: f32) -> Frame {
        Frame::new(line.max_x() - ROW_INSET - w, line.mid_y() - h / 2.0, w, h)
    }

    fn row_with(&self, pred: impl Fn(&Control) -> bool) -> Option<&Row> {
        self.cards.iter().flat_map(|c| c.rows.iter()).find(|r| pred(&r.control))
    }

    /// The slider's track and the range its knob centre travels.
    fn slider_geometry(&self) -> Option<(Frame, f32, f32)> {
        let row = self.row_with(|c| matches!(c, Control::Slider))?;
        let large = measure(&strings::size_large(), 11.0, Weight::Regular);
        let right = row.line.max_x() - ROW_INSET - large - 6.0;
        let track = Frame::new(right - SLIDER_WIDTH, row.line.mid_y() - 3.0, SLIDER_WIDTH, 6.0);
        Some((track, track.x + KNOB.0 / 2.0, track.max_x() - KNOB.0 / 2.0))
    }

    /// The scale a pointer at `x` picks, snapped to a notch.
    pub fn slider_value_at(&self, x: f32) -> f64 {
        let Some((_, lo, hi)) = self.slider_geometry() else { return self.model.scale };
        let t = ((x - lo) / (hi - lo)).clamp(0.0, 1.0) as f64;
        let notch = (t * (NOTCHES - 1) as f64).round();
        SCALE_MIN + (SCALE_MAX - SCALE_MIN) * notch / (NOTCHES - 1) as f64
    }

    /// The language picker, which its dropdown opens from.
    pub fn language_frame(&self) -> Frame {
        self.row_with(|c| matches!(c, Control::Language))
            .map(|r| Self::trailing(r.line, LANGUAGE_WIDTH, LANGUAGE_HEIGHT))
            .unwrap_or_default()
    }

    fn footer_parts(&self) -> [(String, Option<Target>, f32); 4] {
        let size = 12.0;
        let parts = [
            ("Powered by ".to_string(), None),
            ("TypePalMaker".to_string(), Some(Target::MakerLink)),
            ("\u{a0}\u{a0}|\u{a0}\u{a0}".to_string(), None),
            ("Privacy Policy".to_string(), Some(Target::PrivacyLink)),
        ];
        parts.map(|(s, t)| {
            let w = measure(&s, size, Weight::Regular);
            (s, t, w)
        })
    }

    pub fn hit(&self, x: f32, y: f32) -> Option<Target> {
        for card in &self.cards {
            for row in &card.rows {
                for (frame, note) in &row.notes {
                    if note.button {
                        let w = measure(&note.lines[0], NOTE_SIZE, Weight::Regular) + 20.0;
                        if Frame::new(frame.x, frame.y, w, frame.h).contains(x, y) {
                            return Some(Target::OpenStartupApps);
                        }
                    }
                }
                let target = match row.control {
                    Control::Slider => {
                        let (track, _, _) = self.slider_geometry()?;
                        let zone = Frame::new(track.x - 4.0, row.line.y + 8.0, track.w + 8.0, row.line.h - 16.0);
                        zone.contains(x, y).then_some(Target::Slider)
                    }
                    Control::Switch(t, _) => Self::trailing(row.line, SWITCH.0, SWITCH.1).inset(-4.0, -6.0).contains(x, y).then_some(t),
                    Control::Segmented => {
                        let [a, b] = segments(row.line);
                        if a.contains(x, y) {
                            Some(Target::IconTaskbar)
                        } else if b.contains(x, y) {
                            Some(Target::IconTray)
                        } else {
                            None
                        }
                    }
                    Control::Language => self.language_frame().contains(x, y).then_some(Target::Language),
                };
                if target.is_some() {
                    return target;
                }
            }
        }
        let parts = self.footer_parts();
        let total: f32 = parts.iter().map(|p| p.2).sum();
        let mut fx = (WIDTH - total) / 2.0;
        for (_, target, w) in parts {
            if let Some(t) = target {
                if Frame::new(fx, self.footer_y - 2.0, w, FOOTER_HEIGHT + 4.0).contains(x, y) {
                    return Some(t);
                }
            }
            fx += w;
        }
        None
    }

    // MARK: Drawing

    pub fn paint(&self, c: &mut Canvas, t: &Theme) {
        c.clear(t.background);
        for card in &self.cards {
            c.fill_rrect(card.frame, CORNER_RADIUS, t.box_fill);
            c.stroke_rrect(card.frame, CORNER_RADIUS, 1.0, t.border);

            let header = Frame::new(card.frame.x, card.frame.y, card.frame.w, HEADER_HEIGHT);
            let badge = Frame::new(header.x + ROW_INSET, header.mid_y() - HEADER_ICON_SIDE / 2.0, HEADER_ICON_SIDE, HEADER_ICON_SIDE);
            draw_badge(c, t, badge, card.icon, (card.badge)(t));
            let base = baseline_for_center(header.mid_y(), 17.0, Weight::Bold);
            c.text(&card.title, badge.max_x() + 12.0, base, 17.0, Weight::Bold, t.text);
            self.separator(c, t, header.max_y());

            for (i, row) in card.rows.iter().enumerate() {
                if i > 0 {
                    self.separator(c, t, row.line.y - 1.0);
                }
                let badge = Frame::new(row.line.x + ROW_INSET, row.line.mid_y() - ICON_SIDE / 2.0, ICON_SIDE, ICON_SIDE);
                draw_badge(c, t, badge, row.icon, (row.badge)(t));
                let base = baseline_for_center(row.line.mid_y(), 14.0, Weight::Medium);
                c.text(&row.label, badge.max_x() + 12.0, base, 14.0, Weight::Medium, t.text);
                match row.control {
                    Control::Slider => self.draw_slider(c, t, row.line),
                    Control::Switch(_, on) => draw_switch(c, t, Self::trailing(row.line, SWITCH.0, SWITCH.1), on),
                    Control::Segmented => self.draw_segmented(c, t, row.line),
                    Control::Language => self.draw_language(c, t, self.language_frame()),
                }
                for (frame, note) in &row.notes {
                    self.draw_note(c, t, *frame, note);
                }
            }
        }
        self.draw_footer(c, t);
    }

    fn separator(&self, c: &mut Canvas, t: &Theme, y: f32) {
        let x = (WIDTH - BOX_WIDTH) / 2.0 + ROW_INSET;
        c.fill_rect(Frame::new(x, y, BOX_WIDTH - 2.0 * ROW_INSET, 1.0), t.separator);
    }

    fn draw_slider(&self, c: &mut Canvas, t: &Theme, line: Frame) {
        let Some((track, lo, hi)) = self.slider_geometry() else { return };
        let mid = line.mid_y();
        let small = strings::size_small();
        let small_w = measure(&small, 11.0, Weight::Regular);
        let base = baseline_for_center(mid, 11.0, Weight::Regular);
        c.text(&small, track.x - 6.0 - small_w, base, 11.0, Weight::Regular, t.secondary);
        c.text(&strings::size_large(), track.max_x() + 6.0, base, 11.0, Weight::Regular, t.secondary);

        let frac = ((self.model.scale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)).clamp(0.0, 1.0) as f32;
        let knob_x = lo + (hi - lo) * frac;
        c.fill_rrect(track, 3.0, t.slider_track);
        c.fill_rrect(Frame::new(track.x, track.y, knob_x - track.x, track.h), 3.0, t.control_on);

        // One tick per notch under the track; the original size has a larger dot.
        let tick_y = mid + 6.5;
        for i in 0..NOTCHES {
            let x = lo + (hi - lo) * i as f32 / (NOTCHES - 1) as f32;
            c.fill_circle(x, tick_y, 2.0, t.tick);
        }
        let one = lo + (hi - lo) * ((1.0 - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) as f32;
        c.fill_circle(one, line.mid_y() + 7.5, 4.5, t.secondary.with_alpha(0.7));

        let knob = Frame::new(knob_x - KNOB.0 / 2.0, mid - KNOB.1 / 2.0, KNOB.0, KNOB.1);
        c.shadow(knob, KNOB.1 / 2.0, 1.5, 0.5, t.shadow.with_alpha(0.5));
        c.fill_rrect(knob, KNOB.1 / 2.0, t.knob);
        c.stroke_rrect(knob, KNOB.1 / 2.0, 0.5, Color { r: 0, g: 0, b: 0, a: 0.08 });
    }

    fn draw_segmented(&self, c: &mut Canvas, t: &Theme, line: Frame) {
        let parts = segments(line);
        let whole = Frame::new(parts[0].x, parts[0].y, parts[1].max_x() - parts[0].x, SEGMENT_HEIGHT);
        c.fill_rrect(whole, 7.0, t.segment_track);
        c.fill_rrect(parts[self.model.use_tray as usize], 7.0, t.segment_selected);
        for (f, label) in parts.iter().zip([strings::taskbar(), strings::tray()]) {
            let w = measure(&label, 13.0, Weight::Regular);
            let base = baseline_for_center(f.mid_y(), 13.0, Weight::Regular);
            c.text(&label, f.mid_x() - w / 2.0, base, 13.0, Weight::Regular, t.segment_text);
        }
    }

    fn draw_language(&self, c: &mut Canvas, t: &Theme, f: Frame) {
        c.fill_rrect(f, 11.0, t.picker_control);
        c.stroke_rrect(f, 11.0, 1.25, t.accent.with_alpha(0.78));
        let base = baseline_for_center(f.mid_y(), 13.0, Weight::Medium);
        c.text(self.model.language.display_name(), f.x + 14.0, base, 13.0, Weight::Medium, t.text);
        icons::draw(c, Icon::ChevronDown, f.max_x() - 13.0 - 5.0, f.mid_y(), 10.5, 2.6, t.accent);
    }

    fn draw_note(&self, c: &mut Canvas, t: &Theme, f: Frame, note: &Note) {
        if note.button {
            let w = measure(&note.lines[0], NOTE_SIZE, Weight::Regular) + 20.0;
            let b = Frame::new(f.x, f.y, w, f.h);
            c.shadow(b, 5.0, 0.8, 0.5, t.shadow.with_alpha(0.35));
            c.fill_rrect(b, 5.0, t.button_fill);
            c.stroke_rrect(b, 5.0, 0.5, Color { r: 0, g: 0, b: 0, a: 0.12 });
            let base = baseline_for_center(b.mid_y(), NOTE_SIZE, Weight::Regular);
            c.text(&note.lines[0], b.x + 10.0, base, NOTE_SIZE, Weight::Regular, t.text);
            return;
        }
        icons::draw(c, note.icon, f.x + 6.0, f.y + NOTE_LINE / 2.0, 11.0, 2.0, t.orange);
        for (i, line) in note.lines.iter().enumerate() {
            let base = baseline_for_center(f.y + NOTE_LINE * (i as f32 + 0.5), NOTE_SIZE, Weight::Regular);
            c.text(line, f.x + 16.0, base, NOTE_SIZE, Weight::Regular, t.orange);
        }
    }

    fn draw_footer(&self, c: &mut Canvas, t: &Theme) {
        let parts = self.footer_parts();
        let total: f32 = parts.iter().map(|p| p.2).sum();
        let mut x = (WIDTH - total) / 2.0;
        let base = baseline_for_center(self.footer_y + FOOTER_HEIGHT / 2.0, 12.0, Weight::Regular);
        for (s, target, w) in parts {
            c.text(&s, x, base, 12.0, Weight::Regular, t.secondary);
            if target.is_some() {
                c.fill_rect(Frame::new(x, base + 1.5, w, 0.8), t.secondary);
            }
            x += w;
        }
    }
}

/// The two segments of the icon-placement control, right-aligned in `line`.
fn segments(line: Frame) -> [Frame; 2] {
    let wa = measure(&strings::taskbar(), 13.0, Weight::Regular) + SEGMENT_PADDING;
    let wb = measure(&strings::tray(), 13.0, Weight::Regular) + SEGMENT_PADDING;
    let right = line.max_x() - ROW_INSET;
    let y = line.mid_y() - SEGMENT_HEIGHT / 2.0;
    [Frame::new(right - wb - wa, y, wa, SEGMENT_HEIGHT), Frame::new(right - wb, y, wb, SEGMENT_HEIGHT)]
}

/// A rounded square of colour with a symbol in the ink colour.
pub fn draw_badge(c: &mut Canvas, t: &Theme, f: Frame, icon: Icon, color: Color) {
    c.fill_rrect(f, f.w * 0.45, color);
    icons::draw(c, icon, f.mid_x(), f.mid_y(), f.w * 0.53, 1.9, t.icon_ink);
}

pub fn draw_switch(c: &mut Canvas, t: &Theme, f: Frame, on: bool) {
    c.fill_rrect(f, f.h / 2.0, if on { t.control_on } else { t.switch_off });
    let (kw, kh) = (21.0, 13.5);
    let inset = (f.h - kh) / 2.0;
    let kx = if on { f.max_x() - inset - kw } else { f.x + inset };
    let knob = Frame::new(kx, f.y + inset, kw, kh);
    c.shadow(knob, kh / 2.0, 1.0, 0.4, t.shadow.with_alpha(0.4));
    c.fill_rrect(knob, kh / 2.0, t.knob);
}
