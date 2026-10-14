<p align="center">
  <img src=".github/readme/typepal-idle.gif" alt="TypePal, the built-in template pet" width="200">
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/tagline-dark.png">
    <img src=".github/readme/tagline-light.png" alt="Create your own desktop pet." width="360">
  </picture>
</p>

<h1 align="center">TypePal Maker</h1>

<p align="center"><strong>An open-source desktop pet maker. Turn your own pictures into a Mac pet that reacts as you type.</strong></p>

<p align="center">
  <b>English</b> | <a href="./README.md">中文</a>
</p>

<p align="center">
  <a href="#usage"><img src="https://img.shields.io/badge/pet%20platform-macOS%2013%2B-black" alt="Pet Platform"></a>
  <a href="#usage"><img src="https://img.shields.io/badge/maker%20platform-Web%20%7C%20Mac-blue" alt="Maker Platform"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-green" alt="License"></a>
</p>

<p align="center">
  <a href="https://kekeeya.github.io/TypePalMaker/"><img src="https://img.shields.io/badge/Try%20it-in%20your%20browser-8c84e4?style=for-the-badge" alt="Try it in your browser"></a>
  <a href="https://github.com/kekeeya/TypePalMaker/releases/latest"><img src="https://img.shields.io/badge/Download-for%20Mac-46405f?style=for-the-badge&logo=apple&logoColor=white" alt="Download for Mac"></a>
</p>

## Features

<table>
  <tr><th nowrap>Feature</th><th>What you get</th></tr>
  <tr><td nowrap>5 reactions</td><td>Idle, Typing, Mouse Click, Tap Pet and Petting. Animate the ones you want and leave the rest off</td></tr>
  <tr><td nowrap>Animation editing</td><td>Set your own frame rate, then adjust each frame's length and order on the timeline, plus its position, scale and rotation. Undo / redo and a live animation preview included</td></tr>
  <tr><td nowrap>Live pet preview</td><td>Try your pet right inside the Maker and fine-tune it as you go</td></tr>
  <tr><td nowrap>Custom app icon</td><td>Uses the Idle picture by default, or upload any image you like</td></tr>
  <tr><td nowrap>Built-in template</td><td>Start from the ready-made template pet. Projects autosave, and you can export <code>.typepalproj</code> backups anytime</td></tr>
  <tr><td nowrap>Pet settings</td><td>Launch at Login, size, Always on Top, Lock Position, Click-Through and more</td></tr>
  <tr><td nowrap>Privacy-friendly</td><td>No system permissions (no Accessibility, no Input Monitoring), no internet, and it never records what you type</td></tr>
</table>

## Usage

1. Open the Maker (web or desktop), upload your pictures, make your pet and click **Generate App**.
2. The web Maker downloads a zip: unzip it and drag your pet into the Applications folder. The desktop Maker saves the app straight to a folder you choose.
3. Double-click to open. The first time, macOS blocks a pet downloaded from the web: click **Done**, open **System Settings › Privacy & Security**, find "… was blocked" near the bottom and click **Open Anyway**. After that, it opens like any other app.

The desktop TypePal Maker also needs one **Open Anyway** in Privacy & Security the first time you open it.

## Build From Source

To build or develop it yourself, you'll need macOS, the Xcode Command Line Tools (`xcode-select --install`), Node.js and Rust.

```bash
player/build-app.sh            # build the blank pet template first
cd maker && npm install
npm run dev                    # web Maker, local preview
npm run tauri build            # desktop TypePalMaker.app
```

## Notes

Your pets and the Maker run entirely on your own computer. Your pictures and projects are never uploaded to any server (see the privacy policy in the Maker). The apps aren't notarized by Apple, so macOS asks you to allow them by hand the first time. The code is open source under [GPL-3.0](LICENSE).
