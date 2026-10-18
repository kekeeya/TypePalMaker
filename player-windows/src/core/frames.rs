//! Decodes frames on demand at the size they are shown at, and keeps a
//! bounded cache, as `FrameStore.swift` does on macOS: idle's frames stay,
//! the others are dropped beyond the budget, least recently used first.

use std::collections::HashMap;
use std::rc::Rc;

use super::image::{Bitmap, decode_png, png_size, resize};
use super::layout::{Rect, box_size, fit_rect};
use super::manifest::{PetManifest, PetState};
use super::payload::PetSource;

/// One frame, scaled to its place in the pet box (pixels).
pub struct DecodedFrame {
    pub bitmap: Bitmap,
    /// Where it sits in the box, in whole pixels.
    pub x: i32,
    pub y: i32,
}

impl DecodedFrame {
    /// The top row of visible artwork, in box pixels: where a speech bubble
    /// points. `None` for a frame with nothing visible.
    pub fn artwork_top(&self) -> Option<i32> {
        let w = self.bitmap.width;
        (0..self.bitmap.height).find(|&y| (0..w).any(|x| self.bitmap.alpha(x, y) > 24)).map(|row| self.y + row as i32)
    }

    /// Whether a box-space pixel lands on visible artwork. A one-pixel ring
    /// of slack keeps antialiased edges from feeling slippery.
    pub fn is_opaque(&self, px: i32, py: i32) -> bool {
        let (lx, ly) = (px - self.x, py - self.y);
        for dy in -1..=1 {
            for dx in -1..=1 {
                let (x, y) = (lx + dx, ly + dy);
                if x >= 0 && y >= 0 && (x as u32) < self.bitmap.width && (y as u32) < self.bitmap.height {
                    if self.bitmap.alpha(x as u32, y as u32) > 24 {
                        return true;
                    }
                }
            }
        }
        false
    }
}

pub struct FrameStore {
    source_sizes: HashMap<String, (u32, u32)>,
    files: HashMap<String, String>,
    used: Vec<String>,
    pinned: Vec<String>,
    /// The box, in pixels.
    pub box_px: (u32, u32),
    box_exact: (f64, f64),
    cache: HashMap<String, Rc<DecodedFrame>>,
    recency: Vec<String>,
}

/// Frames outside the idle state are evicted beyond this.
const BUDGET_BYTES: usize = 24 * 1024 * 1024;

impl FrameStore {
    /// Reads every used frame's header; nothing is decoded yet.
    pub fn new(manifest: &PetManifest, source: &PetSource) -> FrameStore {
        let used: Vec<String> = manifest.used_frame_ids().into_iter().collect();
        let mut source_sizes = HashMap::new();
        let mut files = HashMap::new();
        for id in &used {
            let Some(r) = manifest.frames.get(id) else { continue };
            files.insert(id.clone(), r.file.clone());
            if let Some(size) = source.read_head(&r.file, 32).ok().and_then(|h| png_size(&h)) {
                source_sizes.insert(id.clone(), size);
            }
        }
        let pinned = manifest
            .playable(PetState::Idle)
            .map(|s| s.all_frames().into_iter().map(|f| f.id).collect())
            .unwrap_or_default();
        FrameStore {
            source_sizes,
            files,
            used,
            pinned,
            box_px: (1, 1),
            box_exact: (1.0, 1.0),
            cache: HashMap::new(),
            recency: Vec::new(),
        }
    }

    /// Frame ids whose image file is missing or unreadable.
    pub fn unreadable_frame_ids(&self) -> Vec<String> {
        self.used.iter().filter(|id| !self.source_sizes.contains_key(*id)).cloned().collect()
    }

    /// Sets the drawn height in pixels. Throws away frames sized for the old one.
    pub fn configure(&mut self, height_px: f64) {
        let sizes: Vec<(u32, u32)> = self.source_sizes.values().copied().collect();
        let (w, h) = box_size(height_px.round().max(1.0), &sizes);
        self.box_exact = (w, h);
        self.box_px = (w as u32, h as u32);
        self.cache.clear();
        self.recency.clear();
    }

    pub fn frame(&mut self, id: &str, source: &PetSource) -> Option<Rc<DecodedFrame>> {
        if let Some(hit) = self.cache.get(id).cloned() {
            self.touch(id);
            return Some(hit);
        }
        let decoded = Rc::new(self.decode(id, source)?);
        self.cache.insert(id.to_string(), decoded.clone());
        self.touch(id);
        self.evict();
        Some(decoded)
    }

    /// Lets go of every frame but idle's, which keeps playing; the rest are
    /// decoded again when a reaction next needs them.
    pub fn release_unpinned(&mut self) {
        let pinned = &self.pinned;
        self.cache.retain(|id, _| pinned.contains(id));
        self.recency.retain(|id| pinned.contains(id));
    }

    pub fn cached_bytes(&self) -> usize {
        self.cache.values().map(|f| f.bitmap.data.len()).sum()
    }

    fn decode(&self, id: &str, source: &PetSource) -> Option<DecodedFrame> {
        let size = *self.source_sizes.get(id)?;
        let bytes = source.read(self.files.get(id)?).ok()?;
        let full = decode_png(&bytes).ok()?;
        let Rect { x, y, w, h } = fit_rect(size, self.box_exact);
        // Whole pixels, keeping the bottom edge on the box's bottom edge.
        let (pw, ph) = (w.round().max(1.0) as u32, h.round().max(1.0) as u32);
        let px = x.round() as i32;
        let py = (y + h).round() as i32 - ph as i32;
        Some(DecodedFrame { bitmap: resize(&full, pw, ph), x: px, y: py })
    }

    fn touch(&mut self, id: &str) {
        self.recency.retain(|r| r != id);
        self.recency.push(id.to_string());
    }

    fn evict(&mut self) {
        let mut total = self.cached_bytes();
        let mut i = 0;
        while total > BUDGET_BYTES && i < self.recency.len() {
            let id = self.recency[i].clone();
            if self.pinned.contains(&id) {
                i += 1;
                continue;
            }
            total -= self.cache.remove(&id).map_or(0, |f| f.bitmap.data.len());
            self.recency.remove(i);
        }
    }
}
