// Embeds the application manifest (per-monitor DPI awareness, UTF-8), the
// version information and the template's icon into the Windows executable.
// The Maker replaces the icon and the names for each pet.
fn main() {
    println!("cargo:rerun-if-changed=resources/TypePal.rc");
    println!("cargo:rerun-if-changed=resources/TypePal.manifest");
    println!("cargo:rerun-if-changed=resources/TypePal.ico");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("HOST").is_ok_and(|h| h.contains("windows"))
    {
        embed_resource::compile("resources/TypePal.rc", embed_resource::NONE).manifest_required().unwrap();
    }
}
