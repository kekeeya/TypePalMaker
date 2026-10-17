//! Decoding frames and scaling them to the size they are shown at.
//!
//! Frames come out as premultiplied BGRA, the layout a Windows layered window
//! takes as it is. Scaling is done in premultiplied space (straight alpha
//! would bleed the colour of transparent pixels into the edges) with a tent
//! filter widened to the scale factor, so a large picture shrunk to a small
//! pet is averaged, not sampled.

/// Premultiplied BGRA, rows top to bottom, no padding.
#[derive(Clone)]
pub struct Bitmap {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

impl Bitmap {
    pub fn new(width: u32, height: u32) -> Bitmap {
        Bitmap { width, height, data: vec![0; width as usize * height as usize * 4] }
    }

    pub fn alpha(&self, x: u32, y: u32) -> u8 {
        self.data[(y as usize * self.width as usize + x as usize) * 4 + 3]
    }

    /// Copies `src` into this bitmap at (`x`, `y`), clipped.
    pub fn blit(&mut self, src: &Bitmap, x: i32, y: i32) {
        for sy in 0..src.height as i32 {
            let dy = y + sy;
            if dy < 0 || dy >= self.height as i32 {
                continue;
            }
            let sx0 = (-x).max(0);
            let sx1 = (src.width as i32).min(self.width as i32 - x);
            if sx1 <= sx0 {
                continue;
            }
            let s = (sy as usize * src.width as usize + sx0 as usize) * 4;
            let d = (dy as usize * self.width as usize + (x + sx0) as usize) * 4;
            let n = (sx1 - sx0) as usize * 4;
            self.data[d..d + n].copy_from_slice(&src.data[s..s + n]);
        }
    }
}

/// Width and height from a PNG's header, without decoding it.
pub fn png_size(head: &[u8]) -> Option<(u32, u32)> {
    if head.len() < 24 || head[..8] != [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a] || &head[12..16] != b"IHDR" {
        return None;
    }
    let w = u32::from_be_bytes(head[16..20].try_into().ok()?);
    let h = u32::from_be_bytes(head[20..24].try_into().ok()?);
    (w > 0 && h > 0).then_some((w, h))
}

/// Decodes a PNG of any colour type to premultiplied BGRA.
pub fn decode_png(bytes: &[u8]) -> Result<Bitmap, String> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let size = reader.output_buffer_size().ok_or("image too large")?;
    let mut buf = vec![0; size];
    let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    let (w, h) = (info.width, info.height);
    let mut out = Bitmap::new(w, h);
    let px = w as usize * h as usize;
    let stride = info.line_size;
    let channels = match info.color_type {
        png::ColorType::Grayscale => 1,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        png::ColorType::Indexed => return Err("indexed PNG was not expanded".into()),
    };
    for i in 0..px {
        let (row, col) = (i / w as usize, i % w as usize);
        let p = &buf[row * stride + col * channels..];
        let (r, g, b, a) = match channels {
            1 => (p[0], p[0], p[0], 255),
            2 => (p[0], p[0], p[0], p[1]),
            3 => (p[0], p[1], p[2], 255),
            _ => (p[0], p[1], p[2], p[3]),
        };
        let pm = |c: u8| ((c as u32 * a as u32 + 127) / 255) as u8;
        out.data[i * 4..i * 4 + 4].copy_from_slice(&[pm(b), pm(g), pm(r), a]);
    }
    Ok(out)
}

/// One axis of a resample: for each output position, its source taps.
fn weights(src: u32, dst: u32) -> Vec<(usize, Vec<f32>)> {
    let scale = dst as f64 / src as f64;
    // Shrinking widens the filter to cover every source pixel; growing keeps
    // it at one pixel (bilinear).
    let radius = if scale < 1.0 { 1.0 / scale } else { 1.0 };
    (0..dst)
        .map(|o| {
            let center = (o as f64 + 0.5) / scale - 0.5;
            let lo = (center - radius).floor().max(0.0) as usize;
            let hi = ((center + radius).ceil() as usize).min(src as usize - 1);
            let mut taps: Vec<f32> = (lo..=hi)
                .map(|i| (1.0 - ((i as f64 - center).abs() / radius)).max(0.0) as f32)
                .collect();
            let sum: f32 = taps.iter().sum();
            if sum > 0.0 {
                taps.iter_mut().for_each(|t| *t /= sum);
            } else {
                // The nearest pixel, when the filter falls between taps.
                let nearest = (center.round().clamp(0.0, (src - 1) as f64) as usize).clamp(lo, hi);
                taps.iter_mut().enumerate().for_each(|(i, t)| *t = if lo + i == nearest { 1.0 } else { 0.0 });
            }
            (lo, taps)
        })
        .collect()
}

/// Scales `src` to exactly `w` × `h`.
pub fn resize(src: &Bitmap, w: u32, h: u32) -> Bitmap {
    let (w, h) = (w.max(1), h.max(1));
    if src.width == w && src.height == h {
        return src.clone();
    }
    // Horizontal pass into floats, then vertical into bytes.
    let xw = weights(src.width, w);
    let mut mid = vec![0f32; w as usize * src.height as usize * 4];
    for y in 0..src.height as usize {
        let row = &src.data[y * src.width as usize * 4..];
        for (x, (lo, taps)) in xw.iter().enumerate() {
            let mut acc = [0f32; 4];
            for (i, t) in taps.iter().enumerate() {
                let p = &row[(lo + i) * 4..];
                for c in 0..4 {
                    acc[c] += p[c] as f32 * t;
                }
            }
            mid[(y * w as usize + x) * 4..][..4].copy_from_slice(&acc);
        }
    }
    let yw = weights(src.height, h);
    let mut out = Bitmap::new(w, h);
    for (y, (lo, taps)) in yw.iter().enumerate() {
        for x in 0..w as usize {
            let mut acc = [0f32; 4];
            for (i, t) in taps.iter().enumerate() {
                let p = &mid[((lo + i) * w as usize + x) * 4..];
                for c in 0..4 {
                    acc[c] += p[c] * t;
                }
            }
            let a = acc[3].round().clamp(0.0, 255.0);
            let o = &mut out.data[(y * w as usize + x) * 4..][..4];
            for c in 0..3 {
                // Premultiplied: colour never exceeds alpha.
                o[c] = acc[c].round().clamp(0.0, a) as u8;
            }
            o[3] = a as u8;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode(w: u32, h: u32, rgba: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.write_header().unwrap().write_image_data(rgba).unwrap();
        out
    }

    #[test]
    fn decodes_to_premultiplied_bgra_and_reads_the_header() {
        let bytes = encode(2, 1, &[255, 0, 0, 255, 0, 0, 255, 128]);
        assert_eq!(png_size(&bytes), Some((2, 1)));
        let bmp = decode_png(&bytes).unwrap();
        assert_eq!(bmp.data, vec![0, 0, 255, 255, 128, 0, 0, 128]);
    }

    #[test]
    fn shrinking_averages_and_keeps_edges_clean() {
        // Opaque white beside fully transparent red: the halved pixel is
        // half-covered white, with no red bleeding in.
        let mut src = Bitmap::new(4, 2);
        for y in 0..2 {
            for x in 0..2 {
                src.data[(y * 4 + x) * 4..][..4].copy_from_slice(&[255, 255, 255, 255]);
            }
        }
        let out = resize(&src, 1, 1);
        let p = &out.data[..4];
        assert!((p[3] as i32 - 128).abs() <= 2, "{p:?}");
        assert!(p[0] == p[1] && p[1] == p[2] && p[2] == p[3], "{p:?}");
    }

    #[test]
    fn same_size_is_a_copy_and_tiny_targets_work() {
        let src = Bitmap::new(3, 3);
        assert_eq!(resize(&src, 3, 3).data, src.data);
        assert_eq!(resize(&src, 1, 7).data.len(), 7 * 4);
    }

    #[test]
    fn blit_clips() {
        let mut dst = Bitmap::new(2, 2);
        let mut src = Bitmap::new(2, 2);
        src.data.fill(9);
        dst.blit(&src, 1, -1);
        assert_eq!(dst.data, vec![0, 0, 0, 0, 9, 9, 9, 9, 0, 0, 0, 0, 0, 0, 0, 0]);
    }
}
