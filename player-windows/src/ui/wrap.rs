//! Line breaking for mixed Chinese and English: Chinese may break between any
//! two characters, English only at spaces, and closing punctuation never
//! starts a line nor opening punctuation ends one.

use super::canvas::{Weight, measure};

fn is_cjk(c: char) -> bool {
    matches!(c as u32, 0x2E80..=0x9FFF | 0xF900..=0xFAFF | 0xFF00..=0xFFEF)
}

fn closes(c: char) -> bool {
    "，。、；：！？）」』》〉】”’,.;:!?)…".contains(c)
}

fn opens(c: char) -> bool {
    "（「『《〈【“‘(".contains(c)
}

/// Splits a paragraph into unbreakable pieces.
fn units(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut word = String::new();
    let mut pending_open = String::new();
    let flush = |word: &mut String, out: &mut Vec<String>| {
        if !word.is_empty() {
            out.push(std::mem::take(word));
        }
    };
    for c in text.chars() {
        if closes(c) {
            if !word.is_empty() {
                word.push(c);
            } else if let Some(last) = out.last_mut() {
                last.push(c);
            } else {
                word.push(c);
            }
            continue;
        }
        if opens(c) {
            flush(&mut word, &mut out);
            pending_open.push(c);
            continue;
        }
        if is_cjk(c) {
            flush(&mut word, &mut out);
            out.push(format!("{}{c}", std::mem::take(&mut pending_open)));
        } else if c == ' ' {
            word.push(c);
            flush(&mut word, &mut out);
        } else {
            if word.is_empty() && !pending_open.is_empty() {
                word.push_str(&std::mem::take(&mut pending_open));
            }
            word.push(c);
        }
    }
    flush(&mut word, &mut out);
    if !pending_open.is_empty() {
        out.push(pending_open);
    }
    out
}

/// Lines no wider than `max_width` points (a single unit may exceed it).
pub fn wrap(text: &str, size: f32, weight: Weight, max_width: f32) -> Vec<String> {
    let mut lines = Vec::new();
    for paragraph in text.split('\n') {
        let mut line = String::new();
        for unit in units(paragraph) {
            let candidate = format!("{line}{unit}");
            if line.is_empty() || measure(candidate.trim_end(), size, weight) <= max_width {
                line = candidate;
            } else {
                lines.push(line.trim_end().to_string());
                line = unit.trim_start().to_string();
            }
        }
        lines.push(line.trim_end().to_string());
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chinese_breaks_anywhere_but_not_before_closing_punctuation() {
        let u = units("你好，世界「天」");
        assert_eq!(u, vec!["你", "好，", "世", "界", "「天」"]);
    }

    #[test]
    fn english_breaks_at_spaces() {
        assert_eq!(units("Hello big world"), vec!["Hello ", "big ", "world"]);
        assert_eq!(units("TypePal 不会"), vec!["TypePal ", "不", "会"]);
    }
}
