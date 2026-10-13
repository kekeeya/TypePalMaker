<div align="center">

# TypePal Maker

[![Pet Platform](https://img.shields.io/badge/pet%20platform-macOS%2013%2B-black)](#usage)
[![Maker Platform](https://img.shields.io/badge/maker%20platform-Web%20%7C%20Mac-blue)](#usage)
[![License](https://img.shields.io/badge/license-GPL--3.0-green)](LICENSE)

[![简体中文](https://img.shields.io/badge/%E8%AF%AD%E8%A8%80-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-lightgrey)](README.md)
[![English](https://img.shields.io/badge/lang-English-3b3b5c)](README.en.md)

**No coding required! Make your own Mac desktop pet from your own pictures!**

</div>

<p align="center"><img src=".github/readme/banner-en.jpg" alt="TypePal Maker" width="70%"></p>

<div align="center">

| Version | How to get it |
|:---:|:---:|
| Web | Head to [kekeeya.github.io/TypePalMaker](https://kekeeya.github.io/TypePalMaker/) to build your pet in the browser and download it in one click |
| Desktop | Download the latest `.dmg` from [Releases](https://github.com/kekeeya/TypePalMaker/releases) to build your pet offline |

</div>

## Features

| Feature | What you get |
|---|---|
| 5 reactions to bring to life | Idle, Typing, Mouse Click, Tap Pet and Petting. Animate the ones you want and switch off the rest |
| Animation editing | Pick your frame rate, then fine-tune every frame on the timeline: how long it shows, where it sits in the order, its position, scale and rotation. Undo / redo and a live animation preview keep you in control |
| Live pet preview | Type, click and pet your creation right inside the Maker to see exactly how it will behave |
| Custom app icon | Your pet's own icon: an Idle picture by default, or any image you like |
| Built-in template | Not sure where to start? Remix the ready-made template pet. Projects autosave, and you can export `.typepalproj` backups anytime |
| Pet settings | Your pet can launch at login, and you can resize it, keep it Always on Top, Lock its Position, make it Click-Through and more |
| Privacy-friendly | No system permissions (no Accessibility, no Input Monitoring), no internet, and it never records what you type |

## Usage

1. Open the Maker (web or desktop), upload your pictures, shape your pet, and hit "Generate App".
2. On the web, you get a zip: unzip it and drag your pet into the Applications folder. The desktop Maker saves the app straight to a folder you choose.
3. Double-click to say hello. The first time, macOS will block a pet downloaded from the web. That's expected. Click "Done", open System Settings › Privacy & Security, scroll down to "… was blocked" and click "Open Anyway". From then on, it opens like any other app.

The desktop TypePal Maker needs the same one-time "Open Anyway" the first time you open it.

## Building from source

Want to hack on it? You'll need macOS, the Xcode Command Line Tools (`xcode-select --install`), Node.js and Rust.

```bash
player/build-app.sh            # build the blank pet template first
cd maker && npm install
npm run dev                    # web Maker, local preview
npm run tauri build            # desktop TypePalMaker.app
```

## Notes

Your pets and the Maker run entirely on your own computer. Your pictures and projects never leave it or touch a server (see the privacy policy in the Maker). The apps aren't notarized by Apple, which is why macOS asks you to allow them once by hand. The code is open source under [GPL-3.0](LICENSE).
