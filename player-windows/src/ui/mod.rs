//! The custom-drawn interface: the settings window, the pet's menu, the
//! language dropdown and the privacy policy, drawn to look as they do on
//! macOS. Pure drawing and hit testing; the Windows shell hosts it.

pub mod canvas;
pub mod icons;
pub mod popups;
pub mod settings;
pub mod theme;
pub mod wrap;

#[cfg(test)]
mod previews;
