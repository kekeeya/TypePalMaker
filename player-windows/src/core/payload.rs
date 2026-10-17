//! Where a pet's data comes from.
//!
//! A generated pet is one file: the template `TypePal.exe` with the pet (its
//! `manifest.json` and `frames/*.png`, as an uncompressed zip) appended after
//! the end of the executable image, followed by a 16-byte trailer:
//!
//! ```text
//! [ exe image ][ zip ][ zip length: u64 LE ][ "TYPEPAL1" ]
//! ```
//!
//! Windows ignores bytes after the image, so the exe runs as it is; the pet
//! reads itself. Entries are only located here, and read from the file when a
//! frame is needed, so the pictures are not held in memory twice.
//!
//! While developing, a plain folder can stand in (`--pet <dir>`).

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

pub const MAGIC: &[u8; 8] = b"TYPEPAL1";

pub enum PetSource {
    /// Entries of the stored zip inside `file`: name → (offset, length).
    Packed { file: PathBuf, entries: HashMap<String, (u64, u64)> },
    Folder(PathBuf),
}

impl PetSource {
    /// The pet appended to `exe`, if there is one.
    pub fn packed(exe: &Path) -> std::io::Result<Option<PetSource>> {
        let mut file = File::open(exe)?;
        let size = file.seek(SeekFrom::End(0))?;
        if size < 16 {
            return Ok(None);
        }
        let mut trailer = [0u8; 16];
        file.seek(SeekFrom::Start(size - 16))?;
        file.read_exact(&mut trailer)?;
        if &trailer[8..] != MAGIC {
            return Ok(None);
        }
        let zip_len = u64::from_le_bytes(trailer[..8].try_into().unwrap());
        if zip_len > size - 16 {
            return Err(invalid("pet data length is out of range"));
        }
        let zip_start = size - 16 - zip_len;
        let mut zip = vec![0u8; 0];
        // Only the end of the zip (its central directory) is read here.
        let tail = zip_len.min(1 << 20);
        file.seek(SeekFrom::Start(zip_start + zip_len - tail))?;
        zip.resize(tail as usize, 0);
        file.read_exact(&mut zip)?;
        let entries = read_central_directory(&mut file, zip_start, zip_len, &zip, zip_len - tail)?;
        Ok(Some(PetSource::Packed { file: exe.to_path_buf(), entries }))
    }

    pub fn read(&self, name: &str) -> std::io::Result<Vec<u8>> {
        match self {
            PetSource::Folder(dir) => std::fs::read(dir.join(name)),
            PetSource::Packed { file, entries } => {
                let &(offset, len) = entries.get(name).ok_or_else(|| {
                    std::io::Error::new(std::io::ErrorKind::NotFound, format!("{name} is not in the pet data"))
                })?;
                let mut f = File::open(file)?;
                f.seek(SeekFrom::Start(offset))?;
                let mut data = vec![0u8; len as usize];
                f.read_exact(&mut data)?;
                Ok(data)
            }
        }
    }

    /// Reads just the start of an entry: enough for a PNG header.
    pub fn read_head(&self, name: &str, max: usize) -> std::io::Result<Vec<u8>> {
        match self {
            PetSource::Folder(dir) => {
                let mut f = File::open(dir.join(name))?;
                let mut data = Vec::with_capacity(max);
                f.by_ref().take(max as u64).read_to_end(&mut data)?;
                Ok(data)
            }
            PetSource::Packed { file, entries } => {
                let &(offset, len) = entries.get(name).ok_or_else(|| {
                    std::io::Error::new(std::io::ErrorKind::NotFound, format!("{name} is not in the pet data"))
                })?;
                let mut f = File::open(file)?;
                f.seek(SeekFrom::Start(offset))?;
                let mut data = vec![0u8; (len as usize).min(max)];
                f.read_exact(&mut data)?;
                Ok(data)
            }
        }
    }
}

fn invalid(message: &str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message.to_string())
}

fn u16_at(b: &[u8], i: usize) -> u16 {
    u16::from_le_bytes([b[i], b[i + 1]])
}

fn u32_at(b: &[u8], i: usize) -> u32 {
    u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]])
}

/// Finds every stored entry's data. `tail` is the last bytes of the zip,
/// starting at zip offset `tail_start`.
fn read_central_directory(
    file: &mut File,
    zip_start: u64,
    zip_len: u64,
    tail: &[u8],
    tail_start: u64,
) -> std::io::Result<HashMap<String, (u64, u64)>> {
    // End of central directory: the last "PK\x05\x06".
    let eocd = (0..tail.len().saturating_sub(21))
        .rev()
        .find(|&i| tail[i..i + 4] == [0x50, 0x4b, 0x05, 0x06])
        .ok_or_else(|| invalid("pet data is not a zip"))?;
    let count = u16_at(tail, eocd + 10) as usize;
    let cd_size = u32_at(tail, eocd + 12) as u64;
    let cd_offset = u32_at(tail, eocd + 16) as u64;
    if cd_offset + cd_size > zip_len {
        return Err(invalid("pet data directory is out of range"));
    }

    let mut cd = vec![0u8; cd_size as usize];
    if cd_offset >= tail_start {
        let from = (cd_offset - tail_start) as usize;
        cd.copy_from_slice(&tail[from..from + cd_size as usize]);
    } else {
        file.seek(SeekFrom::Start(zip_start + cd_offset))?;
        file.read_exact(&mut cd)?;
    }

    let mut entries = HashMap::new();
    let mut at = 0usize;
    for _ in 0..count {
        if at + 46 > cd.len() || cd[at..at + 4] != [0x50, 0x4b, 0x01, 0x02] {
            return Err(invalid("pet data directory is damaged"));
        }
        let method = u16_at(&cd, at + 10);
        let compressed = u32_at(&cd, at + 20) as u64;
        let name_len = u16_at(&cd, at + 28) as usize;
        let extra_len = u16_at(&cd, at + 30) as usize;
        let comment_len = u16_at(&cd, at + 32) as usize;
        let local = u32_at(&cd, at + 42) as u64;
        let name = String::from_utf8_lossy(&cd[at + 46..at + 46 + name_len]).into_owned();
        at += 46 + name_len + extra_len + comment_len;
        if name.ends_with('/') {
            continue;
        }
        if method != 0 {
            return Err(invalid(&format!("{name} is compressed; the pet data must be stored")));
        }
        // The local header repeats the name and may carry its own extra field.
        let mut header = [0u8; 30];
        file.seek(SeekFrom::Start(zip_start + local))?;
        file.read_exact(&mut header)?;
        if header[..4] != [0x50, 0x4b, 0x03, 0x04] {
            return Err(invalid("pet data entry is damaged"));
        }
        let data = local + 30 + u16_at(&header, 26) as u64 + u16_at(&header, 28) as u64;
        if data + compressed > zip_len {
            return Err(invalid("pet data entry is out of range"));
        }
        entries.insert(name, (zip_start + data, compressed));
    }
    Ok(entries)
}

/// Appends `zip` to `exe` with the trailer. What the Maker's generator does;
/// used here by tests and the development packer.
pub fn append(exe: &[u8], zip: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(exe.len() + zip.len() + 16);
    out.extend_from_slice(exe);
    out.extend_from_slice(zip);
    out.extend_from_slice(&(zip.len() as u64).to_le_bytes());
    out.extend_from_slice(MAGIC);
    out
}

/// A stored (uncompressed) zip of `files`, as the generator writes it.
pub fn stored_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut central = Vec::new();
    for (name, data) in files {
        let offset = out.len() as u32;
        let crc = crc32(data);
        let mut header = Vec::new();
        header.extend_from_slice(&[0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0x08, 0, 0, 0, 0, 0, 0]);
        header.extend_from_slice(&crc.to_le_bytes());
        header.extend_from_slice(&(data.len() as u32).to_le_bytes());
        header.extend_from_slice(&(data.len() as u32).to_le_bytes());
        header.extend_from_slice(&(name.len() as u16).to_le_bytes());
        header.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&header);
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(data);

        central.extend_from_slice(&[0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0x08, 0, 0, 0, 0, 0, 0]);
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&(data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(name.len() as u16).to_le_bytes());
        central.extend_from_slice(&[0; 12]);
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(name.as_bytes());
    }
    let cd_offset = out.len() as u32;
    out.extend_from_slice(&central);
    out.extend_from_slice(&[0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]);
    out.extend_from_slice(&(files.len() as u16).to_le_bytes());
    out.extend_from_slice(&(files.len() as u16).to_le_bytes());
    out.extend_from_slice(&(central.len() as u32).to_le_bytes());
    out.extend_from_slice(&cd_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xedb8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_back_what_was_appended() {
        let dir = std::env::temp_dir().join(format!("typepal-payload-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("Pet.exe");
        let zip = stored_zip(&[("manifest.json", b"{}"), ("frames/a.png", &[1, 2, 3, 4, 5])]);
        std::fs::write(&exe, append(b"MZ pretend executable", &zip)).unwrap();

        let source = PetSource::packed(&exe).unwrap().unwrap();
        assert_eq!(source.read("manifest.json").unwrap(), b"{}");
        assert_eq!(source.read("frames/a.png").unwrap(), [1, 2, 3, 4, 5]);
        assert_eq!(source.read_head("frames/a.png", 2).unwrap(), [1, 2]);
        assert!(source.read("frames/b.png").is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_bare_template_has_no_pet() {
        let dir = std::env::temp_dir().join(format!("typepal-bare-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("TypePal.exe");
        std::fs::write(&exe, b"MZ just the runtime, nothing appended").unwrap();
        assert!(PetSource::packed(&exe).unwrap().is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn crc_matches_the_zip_standard() {
        assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
    }
}
