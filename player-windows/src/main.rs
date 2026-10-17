// No console window behind the pet in a release build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
fn main() {
    typepal::app::run();
}

#[cfg(not(windows))]
fn main() {
    eprintln!("TypePal for Windows runs on Windows; on this system only its library and tests build.");
}
