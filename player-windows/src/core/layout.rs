//! Where frames sit inside the pet window, as on macOS (`SpriteLayout.swift`):
//! one box as wide as the widest frame needs, each frame aspect-fitted into it
//! and stood on the bottom edge, so the pet keeps its feet on the ground when
//! a state swaps in a differently shaped image.
//!
//! Rects here are top-left origin, y down, as Windows draws.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub fn box_size(height: f64, image_sizes: &[(u32, u32)]) -> (f64, f64) {
    let widest = image_sizes
        .iter()
        .filter(|(w, h)| *w > 0 && *h > 0)
        .map(|(w, h)| *w as f64 / *h as f64)
        .fold(None, |max: Option<f64>, a| Some(max.map_or(a, |m| m.max(a))))
        .unwrap_or(1.0);
    ((height * widest).ceil(), height)
}

pub fn fit_rect(image: (u32, u32), box_size: (f64, f64)) -> Rect {
    let (bw, bh) = box_size;
    if image.0 == 0 || image.1 == 0 {
        return Rect { x: 0.0, y: 0.0, w: bw, h: bh };
    }
    let (iw, ih) = (image.0 as f64, image.1 as f64);
    let scale = (bw / iw).min(bh / ih);
    let (w, h) = (iw * scale, ih * scale);
    Rect { x: (bw - w) / 2.0, y: bh - h, w, h }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn box_fits_widest_frame_and_frames_stand_on_the_bottom() {
        let b = box_size(100.0, &[(100, 100), (200, 100)]);
        assert_eq!(b, (200.0, 100.0));
        assert_eq!(fit_rect((1254, 1254), b), Rect { x: 50.0, y: 0.0, w: 100.0, h: 100.0 });
        // Half as tall as the box: it stands on the bottom edge.
        assert_eq!(fit_rect((400, 100), b), Rect { x: 0.0, y: 50.0, w: 200.0, h: 50.0 });
    }
}
