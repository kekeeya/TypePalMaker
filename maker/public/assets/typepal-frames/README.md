# TypePal playback frames

These PNGs are ready to play without per-frame transforms.

- Canvas: 384 × 384 px, transparent RGBA.
- Body anchor: horizontal center x=192, bottom baseline y=290.
- Playback rate: 8 fps.
- `idle`: 16 frames, two-second seamless loop with one blink.
- `typing`, `mouseClick`, `tap`, `pet`: four frames each.
- Load the exact filenames and order from `animation.json`.
- `typing` and `pet` keep the exact idle body footprint. `mouseClick` and `tap` match idle on their entry/exit frames; only frames 2–3 contain intentional squash, stretch, or bounce motion.

Do not crop transparent padding, normalize bounds, resize individual frames, or add frame-specific offsets. Render every frame into the same destination rectangle.

Transition previews for every pair of states are under `Design/generate/pet-animation-previews/transitions/`.
