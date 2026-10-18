//! The custom-drawn interface: the settings window, the pet's menu, the
//! language dropdown, the privacy policy and the speech bubble, drawn to
//! look as they do on macOS. Pure drawing and hit testing; the Windows shell
//! hosts it.

pub mod bubble;
pub mod canvas;
pub mod icons;
pub mod popups;
pub mod settings;
pub mod theme;
pub mod wrap;

#[cfg(test)]
mod previews;
