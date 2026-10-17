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

<p align="center"><strong>An open-source desktop pet maker. Turn your own pictures into a desktop pet that reacts as you type.</strong></p>

<p align="center">
  <b>English</b> | <a href="./README.md">中文</a>
</p>

<p align="center">
  <a href="#usage"><img src="https://img.shields.io/badge/platform-Web%20%7C%20Mac%20%7C%20Windows-blue" alt="Platform"></a>
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

1. Open the Maker (web or desktop), upload your pictures and make your pet. On the web, click **Make Mac Pet** or **Make Windows Pet**; in the desktop Maker, click **Make Pet**: the Mac version makes Mac pets, the Windows version Windows pets.
2. The web Maker downloads a zip: for a Mac pet, unzip it and drag the app into your Applications folder; for a Windows pet, unzip it and put the exe in any folder. The desktop Maker saves your pet straight to a folder you choose.
3. Double-click to open. The first time, the system blocks a pet downloaded from the web:
   - Mac: click **Done**, open **System Settings › Privacy & Security**, find "… was blocked" near the bottom and click **Open Anyway**.
   - Windows: click **More info**, then **Run anyway**. If your browser says the file isn't safe, choose **Keep** in its downloads list.

   After that, it opens like any other app.

The desktop TypePal Maker also needs to be allowed once the first time you open it (**Open Anyway** in Privacy & Security on a Mac, **More info › Run anyway** on Windows). On Windows, just unzip it and run it; there's nothing to install.

## Build From Source

To build or develop it yourself, you'll need macOS, the Xcode Command Line Tools (`xcode-select --install`), Node.js and Rust.

```bash
player/build-app.sh            # build the blank pet template first
cd maker && npm install
npm run dev                    # web Maker, local preview
npm run tauri build            # desktop TypePalMaker.app
```

Developing on Windows doesn't use `player/build-app.sh` (it builds the Mac pet template, on a Mac only). You'll need Node.js, Rust and the Visual Studio Build Tools (with "Desktop development with C++"):

```bash
cd player-windows && cargo build --release      # build the Windows pet template first
cd ../maker && npm install
npm run dev                    # web Maker, local preview (makes Windows pets only)
npm run tauri build            # desktop src-tauri/target/release/typepal-maker.exe
```

## Notes

Your pets and the Maker run entirely on your own computer. Your pictures and projects are never uploaded to any server (see the privacy policy in the Maker). The Mac apps aren't notarized by Apple and the Windows programs aren't code-signed, so the system asks you to allow them by hand the first time. The code is open source under [GPL-3.0](LICENSE).
