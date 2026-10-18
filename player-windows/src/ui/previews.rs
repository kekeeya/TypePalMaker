//! Renders every screen to PNG when `TYPEPAL_UI_OUT` names a folder, for
//! comparing side by side with the macOS pet. Without it, the drawing still
//! runs, so a panic or an empty layout fails the tests.

use super::canvas::Canvas;
use super::popups::*;
use super::settings::{LoginNote, SettingsModel, SettingsView, WIDTH};
use super::theme::Theme;
use crate::strings::{Language, set_language};

fn save(c: &Canvas, name: &str) {
    if let Ok(dir) = std::env::var("TYPEPAL_UI_OUT") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(std::path::Path::new(&dir).join(format!("{name}.png")), c.to_png()).unwrap();
    }
}

fn model(language: Language, notes: Vec<LoginNote>) -> SettingsModel {
    SettingsModel {
        name: "TypePal 小团子".into(),
        scale: 1.0,
        always_on_top: true,
        lock_position: false,
        click_through: false,
        launch_at_login: false,
        login_notes: notes,
        use_tray: false,
        language,
    }
}

#[test]
fn renders_every_screen() {
    // One test, so the global language is never switched under another.
    for language in [Language::Chinese, Language::English] {
        set_language(language);
        let tag = if language == Language::Chinese { "zh" } else { "en" };
        for dark in [false, true] {
            let t = Theme::new(dark);
            let mode = if dark { "dark" } else { "light" };

            let view = SettingsView::new(model(language, vec![]));
            assert!((view.height() - 592.0).abs() < 0.5, "settings height {}", view.height());
            let mut c = Canvas::new(WIDTH, view.height(), 2.0);
            view.paint(&mut c, &t);
            save(&c, &format!("settings-{tag}-{mode}"));

            let noted = SettingsView::new(model(language, vec![LoginNote::NeedsApproval]));
            let mut c = Canvas::new(WIDTH, noted.height(), 2.0);
            noted.paint(&mut c, &t);
            save(&c, &format!("settings-notes-{tag}-{mode}"));

            let mut c = Canvas::new(MENU_SIZE.0 + 2.0 * MARGIN, MENU_SIZE.1 + 2.0 * MARGIN, 2.0);
            paint_menu(&mut c, &t, Some(MenuItem::Settings));
            save(&c, &format!("menu-{tag}-{mode}"));

            let mut c = Canvas::new(DROPDOWN_SIZE.0 + 2.0 * MARGIN, DROPDOWN_SIZE.1 + 2.0 * MARGIN, 2.0);
            paint_dropdown(&mut c, &t, language, None);
            save(&c, &format!("dropdown-{tag}-{mode}"));

            let layout = policy_layout(&crate::privacy::sections());
            assert!(longest_line(&layout) <= POLICY_SIZE.0 - 48.0 + 1.0);
            let mut c = Canvas::new(POLICY_SIZE.0, POLICY_SIZE.1, 2.0);
            paint_policy(&mut c, &t, crate::privacy::title(), &layout, 0.0, false);
            save(&c, &format!("policy-{tag}-{mode}"));
        }
    }
    set_language(Language::Chinese);

    // Speech bubbles: one line, two, a long one cut short, and one below.
    for (name, line, below) in [
        ("bubble-short", "今天也要加油哦", false),
        ("bubble-two-lines", "今天也要加油哦，做累了就休息一下…再坚持一会儿", false),
        ("bubble-long", "Keep going today, and take a break when you are tired, then keep going", false),
        ("bubble-below", "被你发现啦！", true),
        ("bubble-one", "1", false),
        ("bubble-123", "123", false),
    ] {
        let l = super::bubble::layout(line);
        assert!(l.lines.len() <= 2, "{name}: {} lines", l.lines.len());
        let mut c = Canvas::new(l.size.0, l.size.1, 2.0);
        super::bubble::paint(&mut c, &l, l.size.0 * 0.75, below);
        save(&c, name);
    }
}

#[test]
fn hit_testing_finds_the_controls() {
    use super::settings::Target;
    let view = SettingsView::new(model(Language::Chinese, vec![]));
    // The always-on-top switch: the second row's right end.
    assert_eq!(view.hit(480.0 - 18.0, 26.0 + 60.0 + 1.0 + 52.0 + 1.0 + 26.0), Some(Target::AlwaysOnTop));
    let lang = view.language_frame();
    assert_eq!(view.hit(lang.mid_x(), lang.mid_y()), Some(Target::Language));
    assert_eq!(view.hit(10.0, 10.0), None);
    // The slider snaps to notches: the far left is the smallest size.
    assert_eq!(view.slider_value_at(0.0), crate::prefs::SCALE_MIN);
    assert_eq!(view.slider_value_at(10_000.0), crate::prefs::SCALE_MAX);
    assert_eq!(menu_hit(MARGIN + 50.0, MARGIN + 20.0), Some(MenuItem::Hide));
    assert_eq!(dropdown_hit(MARGIN + 50.0, MARGIN + 60.0), Some(Language::English));
}
