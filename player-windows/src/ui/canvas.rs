//! Drawing primitives for the custom-drawn interface: rounded shapes with
//! tiny-skia, text with fontdue. Everything is laid out in points (DIPs) and
//! drawn at the window's scale, so one layout serves every DPI.

use std::collections::HashMap;
use std::sync::OnceLock;
use tiny_skia::{FillRule, Paint, Path, PathBuilder, Pixmap, Rect, Stroke, Transform};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Color {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: f32,
}

pub const fn rgb(hex: u32) -> Color {
    Color { r: (hex >> 16) as u8, g: (hex >> 8) as u8, b: hex as u8, a: 1.0 }
}

pub const fn rgba(hex: u32, a: f32) -> Color {
    Color { r: (hex >> 16) as u8, g: (hex >> 8) as u8, b: hex as u8, a }
}

impl Color {
    pub fn with_alpha(self, a: f32) -> Color {
        Color { a: self.a * a, ..self }
    }

    fn paint(self) -> Paint<'static> {
        let mut paint = Paint::default();
        paint.set_color_rgba8(self.r, self.g, self.b, (self.a.clamp(0.0, 1.0) * 255.0).round() as u8);
        paint.anti_alias = true;
        paint
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Frame {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Frame {
    pub const fn new(x: f32, y: f32, w: f32, h: f32) -> Frame {
        Frame { x, y, w, h }
    }
    pub fn contains(&self, x: f32, y: f32) -> bool {
        x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h
    }
    pub fn max_x(&self) -> f32 {
        self.x + self.w
    }
    pub fn max_y(&self) -> f32 {
        self.y + self.h
    }
    pub fn mid_y(&self) -> f32 {
        self.y + self.h / 2.0
    }
    pub fn mid_x(&self) -> f32 {
        self.x + self.w / 2.0
    }
    pub fn inset(&self, dx: f32, dy: f32) -> Frame {
        Frame::new(self.x + dx, self.y + dy, self.w - 2.0 * dx, self.h - 2.0 * dy)
    }
}

/// A path in points: the canvas scales it.
pub fn rounded_rect(f: Frame, r: f32) -> Option<Path> {
    let r = r.min(f.w / 2.0).min(f.h / 2.0).max(0.0);
    // Circular arcs as cubic Béziers.
    let k = 0.552_284_8 * r;
    let (x0, y0, x1, y1) = (f.x, f.y, f.x + f.w, f.y + f.h);
    let mut pb = PathBuilder::new();
    pb.move_to(x0 + r, y0);
    pb.line_to(x1 - r, y0);
    pb.cubic_to(x1 - r + k, y0, x1, y0 + r - k, x1, y0 + r);
    pb.line_to(x1, y1 - r);
    pb.cubic_to(x1, y1 - r + k, x1 - r + k, y1, x1 - r, y1);
    pb.line_to(x0 + r, y1);
    pb.cubic_to(x0 + r - k, y1, x0, y1 - r + k, x0, y1 - r);
    pb.line_to(x0, y0 + r);
    pb.cubic_to(x0, y0 + r - k, x0 + r - k, y0, x0 + r, y0);
    pb.close();
    pb.finish()
}

pub struct Canvas {
    pub pixmap: Pixmap,
    pub scale: f32,
}

impl Canvas {
    /// A transparent canvas of `w` × `h` points at `scale` pixels per point.
    pub fn new(w: f32, h: f32, scale: f32) -> Canvas {
        let pw = (w * scale).ceil().max(1.0) as u32;
        let ph = (h * scale).ceil().max(1.0) as u32;
        Canvas { pixmap: Pixmap::new(pw, ph).unwrap(), scale }
    }

    fn transform(&self) -> Transform {
        Transform::from_scale(self.scale, self.scale)
    }

    pub fn clear(&mut self, color: Color) {
        let c = tiny_skia::Color::from_rgba8(color.r, color.g, color.b, (color.a * 255.0) as u8);
        self.pixmap.fill(c);
    }

    pub fn fill_path(&mut self, path: &Path, color: Color) {
        let t = self.transform();
        self.pixmap.fill_path(path, &color.paint(), FillRule::Winding, t, None);
    }

    pub fn stroke_path(&mut self, path: &Path, width: f32, color: Color) {
        let t = self.transform();
        let stroke = Stroke { width, line_cap: tiny_skia::LineCap::Round, line_join: tiny_skia::LineJoin::Round, ..Stroke::default() };
        self.pixmap.stroke_path(path, &color.paint(), &stroke, t, None);
    }

    pub fn stroke_path_with(&mut self, path: &Path, stroke: &Stroke, color: Color) {
        let t = self.transform();
        self.pixmap.stroke_path(path, &color.paint(), stroke, t, None);
    }

    pub fn fill_rrect(&mut self, f: Frame, r: f32, color: Color) {
        if let Some(p) = rounded_rect(f, r) {
            self.fill_path(&p, color);
        }
    }

    /// A border drawn inside the frame, as a layer's border is.
    pub fn stroke_rrect(&mut self, f: Frame, r: f32, width: f32, color: Color) {
        let half = width / 2.0;
        if let Some(p) = rounded_rect(f.inset(half, half), (r - half).max(0.0)) {
            let t = self.transform();
            let stroke = Stroke { width, ..Stroke::default() };
            self.pixmap.stroke_path(&p, &color.paint(), &stroke, t, None);
        }
    }

    pub fn fill_rect(&mut self, f: Frame, color: Color) {
        if let Some(r) = Rect::from_xywh(f.x, f.y, f.w, f.h) {
            let t = self.transform();
            self.pixmap.fill_rect(r, &color.paint(), t, None);
        }
    }

    pub fn fill_circle(&mut self, cx: f32, cy: f32, d: f32, color: Color) {
        if let Some(p) = PathBuilder::from_circle(cx, cy, d / 2.0) {
            self.fill_path(&p, color);
        }
    }

    /// A soft drop shadow under a rounded shape, like a macOS panel's.
    pub fn shadow(&mut self, f: Frame, r: f32, blur: f32, dy: f32, color: Color) {
        let steps = 10;
        for i in 0..steps {
            let t = i as f32 / steps as f32;
            let spread = blur * (1.0 - t);
            let a = color.a / steps as f32 * (0.4 + t);
            self.fill_rrect(
                Frame::new(f.x - spread, f.y - spread + dy, f.w + 2.0 * spread, f.h + 2.0 * spread),
                r + spread,
                color.with_alpha(a / color.a.max(0.001)),
            );
        }
    }

    /// Text with its baseline at `baseline`, starting at `x`. Returns the
    /// advance, in points.
    pub fn text(&mut self, s: &str, x: f32, baseline: f32, size: f32, weight: Weight, color: Color) -> f32 {
        let fonts = fonts();
        let px = size * self.scale;
        let font = fonts.get(weight);
        let mut pen = x * self.scale;
        let base = baseline * self.scale;
        let mut prev: Option<char> = None;
        for ch in s.chars() {
            if let Some(p) = prev {
                pen += font.horizontal_kern(p, ch, px).unwrap_or(0.0);
            }
            let glyph = fonts.glyph(weight, ch, px);
            let left = (pen + glyph.xmin as f32).round() as i32;
            let top = (base - glyph.ymin as f32 - glyph.height as f32).round() as i32;
            self.blend_coverage(&glyph.coverage, glyph.width, glyph.height, left, top, color);
            pen += glyph.advance;
            prev = Some(ch);
        }
        pen / self.scale - x
    }

    /// Draws `color` into the pixmap through a glyph's coverage.
    fn blend_coverage(&mut self, coverage: &[u8], w: usize, h: usize, left: i32, top: i32, color: Color) {
        let (pw, ph) = (self.pixmap.width() as i32, self.pixmap.height() as i32);
        let data = self.pixmap.data_mut();
        for gy in 0..h as i32 {
            let y = top + gy;
            if y < 0 || y >= ph {
                continue;
            }
            for gx in 0..w as i32 {
                let x = left + gx;
                if x < 0 || x >= pw {
                    continue;
                }
                let cov = coverage[(gy * w as i32 + gx) as usize] as f32 / 255.0;
                if cov <= 0.0 {
                    continue;
                }
                let a = cov * color.a;
                let i = ((y * pw + x) * 4) as usize;
                // Source-over in premultiplied RGBA.
                let src = [color.r as f32 * a, color.g as f32 * a, color.b as f32 * a, 255.0 * a];
                for c in 0..4 {
                    let d = data[i + c] as f32;
                    data[i + c] = (src[c] + d * (1.0 - a)).round().clamp(0.0, 255.0) as u8;
                }
            }
        }
    }

    /// RGBA, straight alpha, for saving as PNG in tests.
    pub fn to_png(&self) -> Vec<u8> {
        let mut rgba = self.pixmap.data().to_vec();
        for px in rgba.chunks_exact_mut(4) {
            let a = px[3] as u32;
            if a > 0 && a < 255 {
                for c in &mut px[..3] {
                    *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
                }
            }
        }
        let mut out = Vec::new();
        let mut enc = png::Encoder::new(&mut out, self.pixmap.width(), self.pixmap.height());
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.write_header().unwrap().write_image_data(&rgba).unwrap();
        out
    }

    /// Premultiplied BGRA, as a Windows DIB takes it.
    pub fn to_bgra(&self) -> Vec<u8> {
        let mut out = self.pixmap.data().to_vec();
        for px in out.chunks_exact_mut(4) {
            px.swap(0, 2);
        }
        out
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Weight {
    Regular,
    Medium,
    Semibold,
    Bold,
}

pub fn measure(s: &str, size: f32, weight: Weight) -> f32 {
    let fonts = fonts();
    let font = fonts.get(weight);
    let px = size * 4.0;
    let mut w = 0.0;
    let mut prev = None;
    for ch in s.chars() {
        if let Some(p) = prev {
            w += font.horizontal_kern(p, ch, px).unwrap_or(0.0);
        }
        w += font.metrics(ch, px).advance_width;
        prev = Some(ch);
    }
    w / 4.0
}

/// Where the baseline goes for text vertically centred on `mid_y`, centring
/// the ascent and descent of the font as a text field's line does.
pub fn baseline_for_center(mid_y: f32, size: f32, weight: Weight) -> f32 {
    let fonts = fonts();
    let lm = fonts.get(weight).horizontal_line_metrics(size).unwrap();
    // The CJK-heavy fonts carry tall ascents; centre on the glyph body.
    let ascent = lm.ascent.min(size * 0.92);
    let descent = lm.descent.max(-size * 0.24);
    mid_y + (ascent + descent) / 2.0
}

struct Glyph {
    xmin: i32,
    ymin: i32,
    width: usize,
    height: usize,
    advance: f32,
    coverage: Vec<u8>,
}

pub struct Fonts {
    regular: fontdue::Font,
    bold: fontdue::Font,
    cache: std::sync::Mutex<HashMap<(Weight, char, u32), std::sync::Arc<Glyph>>>,
}

impl Fonts {
    fn get(&self, weight: Weight) -> &fontdue::Font {
        match weight {
            // YaHei has no medium: the bold reads closest to PingFang's
            // medium at these sizes.
            Weight::Regular => &self.regular,
            Weight::Medium | Weight::Semibold | Weight::Bold => &self.bold,
        }
    }

    fn glyph(&self, weight: Weight, ch: char, px: f32) -> std::sync::Arc<Glyph> {
        let key = (weight, ch, (px * 16.0) as u32);
        if let Some(g) = self.cache.lock().unwrap().get(&key) {
            return g.clone();
        }
        let (m, coverage) = self.get(weight).rasterize(ch, px);
        let g = std::sync::Arc::new(Glyph {
            xmin: m.xmin,
            ymin: m.ymin,
            width: m.width,
            height: m.height,
            advance: m.advance_width,
            coverage,
        });
        self.cache.lock().unwrap().insert(key, g.clone());
        g
    }
}

/// The interface font, found on this system: Microsoft YaHei UI on Windows
/// (Apple's fonts may not be used there). Elsewhere, for previews, a similar
/// sans; `TYPEPAL_FONT_REGULAR` / `TYPEPAL_FONT_BOLD` (`path` or
/// `path#index`) override.
pub fn fonts() -> &'static Fonts {
    static FONTS: OnceLock<Fonts> = OnceLock::new();
    FONTS.get_or_init(|| {
        let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
        let regular = [
            std::env::var("TYPEPAL_FONT_REGULAR").unwrap_or_default(),
            format!("{windir}\\Fonts\\msyh.ttc#1"),
            format!("{windir}\\Fonts\\msyh.ttf"),
            format!("{windir}\\Fonts\\simsun.ttc#0"),
            format!("{windir}\\Fonts\\segoeui.ttf"),
            "/System/Library/Fonts/Hiragino Sans GB.ttc#0".into(),
            "/System/Library/Fonts/STHeiti Light.ttc#0".into(),
        ];
        let bold = [
            std::env::var("TYPEPAL_FONT_BOLD").unwrap_or_default(),
            format!("{windir}\\Fonts\\msyhbd.ttc#1"),
            format!("{windir}\\Fonts\\msyhbd.ttf"),
            format!("{windir}\\Fonts\\segoeuib.ttf"),
            "/System/Library/Fonts/Hiragino Sans GB.ttc#2".into(),
        ];
        let regular = load_first(&regular).expect("no interface font found");
        let bold = load_first(&bold).unwrap_or_else(|| regular.clone());
        Fonts { regular, bold, cache: Default::default() }
    })
}

fn load_first(candidates: &[String]) -> Option<fontdue::Font> {
    for spec in candidates.iter().filter(|s| !s.is_empty()) {
        let (path, index) = match spec.rsplit_once('#') {
            Some((p, i)) => (p, i.parse().unwrap_or(0)),
            None => (spec.as_str(), 0),
        };
        let Ok(bytes) = std::fs::read(path) else { continue };
        let settings = fontdue::FontSettings { collection_index: index, scale: 40.0, ..Default::default() };
        if let Ok(font) = fontdue::Font::from_bytes(bytes, settings) {
            return Some(font);
        }
    }
    None
}
