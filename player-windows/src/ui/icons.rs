//! The interface's symbols, redrawn as vectors. The macOS pet uses SF Symbols,
//! which may only be used on Apple platforms; these follow their shapes so the
//! two versions look alike. Each is drawn on a 24 × 24 grid.

use tiny_skia::{PathBuilder, Stroke, StrokeDash};

use super::canvas::{Canvas, Color};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Icon {
    SunMax,
    Display,
    Pin,
    Lock,
    CursorClick,
    Gear,
    Dock,
    CharacterBubble,
    Power,
    RectangleDashed,
    Warning,
    XmarkCircle,
    ChevronDown,
    Checkmark,
    Xmark,
}

/// Draws `icon` centred on (`cx`, `cy`), `size` points across, with strokes
/// `weight` grid units wide.
pub fn draw(canvas: &mut Canvas, icon: Icon, cx: f32, cy: f32, size: f32, weight: f32, color: Color) {
    let s = size / 24.0;
    // Grid → points.
    let p = |x: f32, y: f32| (cx + (x - 12.0) * s, cy + (y - 12.0) * s);
    let w = weight * s;

    let line = |pb: &mut PathBuilder, pts: &[(f32, f32)]| {
        let (x, y) = p(pts[0].0, pts[0].1);
        pb.move_to(x, y);
        for &(gx, gy) in &pts[1..] {
            let (x, y) = p(gx, gy);
            pb.line_to(x, y);
        }
    };
    let circle = |pb: &mut PathBuilder, gx: f32, gy: f32, r: f32| {
        let (x, y) = p(gx, gy);
        pb.push_circle(x, y, r * s);
    };
    let rrect = |pb: &mut PathBuilder, x0: f32, y0: f32, x1: f32, y1: f32, r: f32| {
        let (ax, ay) = p(x0, y0);
        let (bx, by) = p(x1, y1);
        if let Some(path) = super::canvas::rounded_rect(super::canvas::Frame::new(ax, ay, bx - ax, by - ay), r * s) {
            pb.push_path(&path);
        }
    };
    // An arc of a circle, from `a0` to `a1` degrees (0° = right, clockwise).
    let arc = |pb: &mut PathBuilder, gx: f32, gy: f32, r: f32, a0: f32, a1: f32| {
        let steps = 48;
        for i in 0..=steps {
            let a = (a0 + (a1 - a0) * i as f32 / steps as f32).to_radians();
            let (x, y) = p(gx + r * a.cos(), gy + r * a.sin());
            if i == 0 { pb.move_to(x, y) } else { pb.line_to(x, y) }
        }
    };

    let mut stroke = PathBuilder::new();
    let mut fill = PathBuilder::new();
    let mut faint = PathBuilder::new();
    let mut dashed = false;

    match icon {
        Icon::SunMax => {
            circle(&mut stroke, 12.0, 12.0, 4.2);
            for i in 0..8 {
                let a = (i as f32 * 45.0).to_radians();
                line(&mut stroke, &[(12.0 + 7.4 * a.cos(), 12.0 + 7.4 * a.sin()), (12.0 + 9.6 * a.cos(), 12.0 + 9.6 * a.sin())]);
            }
        }
        Icon::Display => {
            rrect(&mut faint, 3.2, 4.2, 20.8, 16.3, 1.2);
            rrect(&mut stroke, 3.2, 4.2, 20.8, 16.3, 1.6);
            rrect(&mut fill, 10.3, 16.0, 13.7, 18.6, 0.2);
            rrect(&mut fill, 7.6, 18.4, 16.4, 20.0, 0.8);
        }
        Icon::Pin => {
            line(&mut stroke, &[(8.2, 3.0), (15.8, 3.0)]);
            line(&mut stroke, &[(9.6, 3.2), (9.6, 8.6)]);
            line(&mut stroke, &[(14.4, 3.2), (14.4, 8.6)]);
            let (x, y) = p(9.6, 8.6);
            stroke.move_to(x, y);
            let (c1x, c1y) = p(8.6, 10.6);
            let (ex, ey) = p(6.2, 12.6);
            stroke.quad_to(c1x, c1y, ex, ey);
            line(&mut stroke, &[(6.2, 12.6), (17.8, 12.6)]);
            let (x, y) = p(14.4, 8.6);
            stroke.move_to(x, y);
            let (c1x, c1y) = p(15.4, 10.6);
            let (ex, ey) = p(17.8, 12.6);
            stroke.quad_to(c1x, c1y, ex, ey);
            line(&mut stroke, &[(12.0, 12.8), (12.0, 21.2)]);
        }
        Icon::Lock => {
            rrect(&mut stroke, 6.6, 10.6, 17.4, 20.6, 2.0);
            line(&mut stroke, &[(9.0, 10.6), (9.0, 7.6)]);
            arc(&mut stroke, 12.0, 7.6, 3.0, 180.0, 360.0);
            line(&mut stroke, &[(15.0, 7.6), (15.0, 10.6)]);
        }
        Icon::CursorClick => {
            arc(&mut stroke, 11.6, 11.8, 7.8, 75.0, 365.0);
            let pts = [(12.4, 11.6), (12.4, 21.2), (14.6, 18.9), (16.2, 22.2), (17.8, 21.5), (16.3, 18.3), (19.3, 17.9)];
            line(&mut fill, &pts);
            fill.close();
        }
        Icon::Gear => {
            let teeth = 8;
            let (ro, ri) = (9.6, 7.2);
            let mut first = true;
            for i in 0..teeth {
                let base = i as f32 * 360.0 / teeth as f32;
                for (da, r) in [(-14.0, ri), (-9.0, ro), (9.0, ro), (14.0, ri)] {
                    let a = (base + da).to_radians();
                    let (x, y) = p(12.0 + r * a.cos(), 12.0 + r * a.sin());
                    if first {
                        stroke.move_to(x, y);
                        first = false;
                    } else {
                        stroke.line_to(x, y);
                    }
                }
                // The rim between teeth.
                let next = base + 360.0 / teeth as f32 - 14.0;
                for k in 1..6 {
                    let a = (base + 14.0 + (next - base - 14.0) * k as f32 / 6.0).to_radians();
                    let (x, y) = p(12.0 + ri * a.cos(), 12.0 + ri * a.sin());
                    stroke.line_to(x, y);
                }
            }
            stroke.close();
            circle(&mut stroke, 12.0, 12.0, 3.0);
        }
        Icon::Dock => {
            rrect(&mut stroke, 3.0, 5.0, 21.0, 19.0, 2.6);
            rrect(&mut fill, 6.4, 14.4, 17.6, 16.6, 0.6);
        }
        Icon::CharacterBubble => {
            // Bubble with its tail at the bottom left.
            let (x0, y0, x1, y1, r) = (3.0, 3.4, 21.0, 16.8, 2.4);
            let pts = [
                (x0 + r, y0),
                (x1 - r, y0),
            ];
            line(&mut stroke, &pts);
            arc(&mut stroke, x1 - r, y0 + r, r, 270.0, 360.0);
            line(&mut stroke, &[(x1, y0 + r), (x1, y1 - r)]);
            arc(&mut stroke, x1 - r, y1 - r, r, 0.0, 90.0);
            line(&mut stroke, &[(x1 - r, y1), (11.4, y1), (7.6, 20.8), (8.0, y1), (x0 + r, y1)]);
            arc(&mut stroke, x0 + r, y1 - r, r, 90.0, 180.0);
            line(&mut stroke, &[(x0, y1 - r), (x0, y0 + r)]);
            arc(&mut stroke, x0 + r, y0 + r, r, 180.0, 270.0);
            line(&mut stroke, &[(8.6, 14.0), (12.0, 6.2), (15.4, 14.0)]);
            line(&mut stroke, &[(9.8, 11.4), (14.2, 11.4)]);
        }
        Icon::Power => {
            arc(&mut stroke, 12.0, 12.8, 8.0, -50.0, 230.0);
            line(&mut stroke, &[(12.0, 2.8), (12.0, 11.4)]);
        }
        Icon::RectangleDashed => {
            rrect(&mut stroke, 3.4, 5.4, 20.6, 18.6, 2.0);
            dashed = true;
        }
        Icon::Warning => {
            line(&mut stroke, &[(12.0, 3.2), (21.6, 20.2), (2.4, 20.2)]);
            stroke.close();
            line(&mut stroke, &[(12.0, 9.2), (12.0, 14.2)]);
            circle(&mut fill, 12.0, 17.2, 1.2);
        }
        Icon::XmarkCircle => {
            circle(&mut stroke, 12.0, 12.0, 9.2);
            line(&mut stroke, &[(8.6, 8.6), (15.4, 15.4)]);
            line(&mut stroke, &[(15.4, 8.6), (8.6, 15.4)]);
        }
        Icon::ChevronDown => line(&mut stroke, &[(5.0, 8.6), (12.0, 15.6), (19.0, 8.6)]),
        Icon::Checkmark => line(&mut stroke, &[(4.6, 12.8), (9.6, 18.0), (19.6, 6.0)]),
        Icon::Xmark => {
            line(&mut stroke, &[(5.4, 5.4), (18.6, 18.6)]);
            line(&mut stroke, &[(18.6, 5.4), (5.4, 18.6)]);
        }
    }

    if let Some(path) = faint.finish() {
        canvas.fill_path(&path, color.with_alpha(0.42));
    }
    if let Some(path) = fill.finish() {
        canvas.fill_path(&path, color);
    }
    if let Some(path) = stroke.finish() {
        if dashed {
            let style = Stroke {
                width: w,
                line_cap: tiny_skia::LineCap::Butt,
                line_join: tiny_skia::LineJoin::Round,
                dash: StrokeDash::new(vec![3.6 * s, 2.6 * s], 1.0 * s),
                ..Stroke::default()
            };
            canvas.stroke_path_with(&path, &style, color);
        } else {
            canvas.stroke_path(&path, w, color);
        }
    }
}
