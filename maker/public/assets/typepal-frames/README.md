# TypePal playback frames

These PNGs are ready to play without per-frame transforms.

- Canvas: 384 × 384 px, transparent RGBA.
- Body anchor: horizontal center x=192, bottom baseline y=290.
- Playback rate: 8 fps.
- `idle`: a two-second seamless loop of 16 frames with one blink, from two pictures: `idle-01` (eyes open) seven times, `idle-02` (blink), `idle-01` eight times. `animation.json` lists each frame; a picture shown several frames running is one file.
- `typing`, `mouseClick`, `tap`, `pet`: four frames each.
- Load the exact filenames and order from `animation.json`.
- `sleep` (the template's, not in `animation.json`): `sleep-base-01` held for four frames, under a Z row of `sleep-z-01`…`03`, one frame each.
- Built-in effects, drawn over the pet one frame each: `sleep-z` (Zzz, three frames) and `heart`, `sweat`, `anger`, `raincloud`, `question`, `exclamation`, `music`, `sparkle` (four frames each). Their icons are `../<effect>-effect-icon.png` (Zzz: `../zzz-effect-icon.png`), 174 × 162 px. The list is `BUILT_IN_EFFECTS` in `maker/src/model/template.ts`.
- `typing` and `pet` keep the exact idle body footprint. `mouseClick` and `tap` match idle on their entry/exit frames; only frames 2–3 contain intentional squash, stretch, or bounce motion.

Do not crop transparent padding, normalize bounds, resize individual frames, or add frame-specific offsets. Render every frame into the same destination rectangle.

Transition previews for every pair of states are under `Design/generate/pet-animation-previews/transitions/`.
