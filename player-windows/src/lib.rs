//! TypePal for Windows.
//!
//! The pet reads the same `manifest.json` and frames as the macOS runtime and
//! behaves by the same rules (`core`). Everything here except `app` is plain
//! Rust that builds and is tested on any machine, including the settings
//! window's drawing (`ui`), which can be rendered to a picture and compared
//! with the Mac's.

pub mod core {
    pub mod behavior;
    pub mod frames;
    pub mod image;
    pub mod layout;
    pub mod manifest;
    pub mod payload;
    pub mod speech;
    pub mod stroke;
    pub mod timeline;
}
pub mod prefs;
pub mod privacy;
pub mod strings;
pub mod ui;

#[cfg(windows)]
pub mod app;
