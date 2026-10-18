//! The pet's speech bubble, as `SpeechBubble.swift` draws it on macOS: warm
//! white, a light outline and a soft shadow, at most two lines, with a tail
//! pointing at the pet's head (or up at it, when the bubble sits below).

use tiny_skia::PathBuilder;

use super::canvas::{Canvas, Frame, Weight, baseline_for_center, measure, rgb, rgba};
use super::wrap::wrap;

/// Room for the shadow around the bubble.
pub const MARGIN: f32 = 12.0;
pub const TAIL: f32 = 8.0;
const PADDING: (f32, f32) = (14.0, 9.0);
const MAX_TEXT: f32 = 200.0;
const SIZE: f32 = 13.0;
const LINE: f32 = 18.0;
/// Never narrower than this, so the tail always leaves from the flat of the
/// bottom edge, clear of the corners, however short the line ("1").
const MIN_BODY: f32 = 76.0;

pub struct BubbleLayout {
    pub lines: Vec<String>,
    /// The whole window's size in points: margins and tail included.
    pub size: (f32, f32),
}

/// Two lines at most; a longer line ends in an ellipsis.
pub fn layout(line: &str) -> BubbleLayout {
    let mut lines = wrap(line, SIZE, Weight::Semibold, MAX_TEXT);
    if lines.len() > 2 {
        let mut second: String = lines[1].clone();
        while !second.is_empty() && measure(&format!("{second}…"), SIZE, Weight::Semibold) > MAX_TEXT {
            second.pop();
        }
        lines.truncate(1);
        lines.push(format!("{}…", second.trim_end()));
    }
    let width = lines.iter().map(|l| measure(l, SIZE, Weight::Semibold)).fold(0.0, f32::max).ceil();
    let size = ((width + 2.0 * PADDING.0).max(MIN_BODY) + 2.0 * MARGIN, lines.len() as f32 * LINE + 2.0 * PADDING.1 + TAIL + 2.0 * MARGIN);
    BubbleLayout { lines, size }
}

/// Draws the bubble filling the canvas; the tail's tip `tail_x` points in
/// from the left edge, under the bubble or (`below`) over it.
pub fn paint(c: &mut Canvas, l: &BubbleLayout, tail_x: f32, below: bool) {
    let (w, h) = l.size;
    let body = if below {
        Frame::new(MARGIN, MARGIN + TAIL, w - 2.0 * MARGIN, h - 2.0 * MARGIN - TAIL)
    } else {
        Frame::new(MARGIN, MARGIN, w - 2.0 * MARGIN, h - 2.0 * MARGIN - TAIL)
    };
    let shape = outline(body, 14.0, tail_x.min(body.max_x() - 22.0).max(body.x + 22.0), below);

    // One shape, bubble and tail: one fill and one outline.
    c.shadow(body, 14.0, 9.0, 3.0, rgba(0x333333, 0.12));
    c.fill_path(&shape, rgb(0xFFFDF7));
    c.stroke_path(&shape, 1.0, rgb(0xE6DFD6));

    for (i, text) in l.lines.iter().enumerate() {
        let mid = body.y + PADDING.1 + LINE * (i as f32 + 0.5);
        // Centred: a short line sits in the middle of the narrowest bubble.
        let x = body.mid_x() - measure(text, SIZE, Weight::Semibold) / 2.0;
        c.text(text, x, baseline_for_center(mid, SIZE, Weight::Semibold), SIZE, Weight::Semibold, rgb(0x353754));
    }
}

/// The rounded body with the tail in its outline, under it (or over it,
/// `tail_up`), 16 wide at its base, its tip at `tx`.
fn outline(body: Frame, r: f32, tx: f32, tail_up: bool) -> tiny_skia::Path {
    let (x0, x1, y0, y1) = (body.x, body.max_x(), body.y, body.max_y());
    // A quarter circle as a cubic: the control points sit this far along.
    let k = r * 0.552_284_8;
    let mut p = PathBuilder::new();
    p.move_to(x0 + r, y0);
    if tail_up {
        p.line_to(tx - 8.0, y0);
        p.line_to(tx, y0 - TAIL);
        p.line_to(tx + 8.0, y0);
    }
    p.line_to(x1 - r, y0);
    p.cubic_to(x1 - r + k, y0, x1, y0 + r - k, x1, y0 + r);
    p.line_to(x1, y1 - r);
    p.cubic_to(x1, y1 - r + k, x1 - r + k, y1, x1 - r, y1);
    if !tail_up {
        p.line_to(tx + 8.0, y1);
        p.line_to(tx, y1 + TAIL);
        p.line_to(tx - 8.0, y1);
    }
    p.line_to(x0 + r, y1);
    p.cubic_to(x0 + r - k, y1, x0, y1 - r + k, x0, y1 - r);
    p.line_to(x0, y0 + r);
    p.cubic_to(x0, y0 + r - k, x0 + r - k, y0, x0 + r, y0);
    p.close();
    p.finish().unwrap()
}
