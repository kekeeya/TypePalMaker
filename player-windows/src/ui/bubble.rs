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
    let size = (width + 2.0 * PADDING.0 + 2.0 * MARGIN, lines.len() as f32 * LINE + 2.0 * PADDING.1 + TAIL + 2.0 * MARGIN);
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
    let tx = tail_x.clamp(body.x + 18.0, body.max_x() - 18.0);
    let tail = {
        let mut p = PathBuilder::new();
        let (base, tip) = if below { (body.y + 1.0, body.y - TAIL) } else { (body.max_y() - 1.0, body.max_y() + TAIL) };
        p.move_to(tx - 8.0, base);
        p.line_to(tx, tip);
        p.line_to(tx + 8.0, base);
        p.finish().unwrap()
    };
    let paper = rgb(0xFFFDF7);
    let outline = rgb(0xE6DFD6);

    c.shadow(body, 14.0, 9.0, 3.0, rgba(0x333333, 0.12));
    c.fill_rrect(body, 14.0, paper);
    c.stroke_rrect(body, 14.0, 1.0, outline);
    // The tail over the outline at its base, then its own two edges.
    c.fill_path(&tail, paper);
    c.stroke_path(&tail, 1.0, outline);

    for (i, text) in l.lines.iter().enumerate() {
        let mid = body.y + PADDING.1 + LINE * (i as f32 + 0.5);
        c.text(text, body.x + PADDING.0, baseline_for_center(mid, SIZE, Weight::Semibold), SIZE, Weight::Semibold, rgb(0x353754));
    }
}
