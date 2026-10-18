import { describe, expect, it } from "vitest";
import { PetBehavior, PetSpeech, playedAs, StrokeRecognizer, StrokeTuning } from "./behavior";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { fitRect } from "./placement";
import { decodeProject, encodeProject } from "./projectFile";
import { baseTrack, displayHeight, emptyProject, frameSpan, PET_STATES, spanDuration, type FrameEntry, type PetState, type StateSpec } from "./types";
import { validate } from "./validate";
import { BUILT_IN_EFFECTS, EFFECT_KINDS, effectOfRow, effectRowId } from "./template";

/** A reaction showing `frames` as its pet's row, as the editor keeps it. */
const withFrames = (spec: StateSpec, frames: FrameEntry[]): StateSpec => {
  const base = spec.tracks && baseTrack(spec.tracks);
  return { ...spec, frames, tracks: spec.tracks?.map((track) => (track === base ? { ...track, frames } : track)) };
};

// Mirrors player/Tests/TypePalTests/TypePalCoreTests.swift — keep in step.

describe("PetBehavior (same cases as the Swift runtime)", () => {
  /** Four frames at 10 fps: every round lasts 0.4 s, its second half
   *  starting 0.2 s in. */
  const spec = (): StateSpec => ({ enabled: true, fps: 10, loop: false, frames: [0, 1, 2, 3].map((i) => ({ id: `f${i}` })) });
  const behavior = (disabled: PetState[] = []) => new PetBehavior((s) => (disabled.includes(s) ? null : spec()));

  it("is idle by default", () => {
    expect(behavior().current).toBe("idle");
  });

  it("plays typing once for a key, then idles", () => {
    const b = behavior();
    b.keyPressed(10);
    expect(b.current).toBe("typing");
    b.roundFinished(10.4);
    expect(b.current).toBe("idle");
  });

  it("plays another round for keys in the second half", () => {
    const b = behavior();
    b.keyPressed(10);
    const first = b.round;
    b.keyPressed(10.3);
    expect(b.round).toBe(first);
    b.roundFinished(10.4);
    expect(b.current).toBe("typing");
    expect(b.round).toBe(first + 1);
    b.roundFinished(10.8);
    expect(b.current).toBe("idle");
  });

  it("answers keys in the first half with the round already playing", () => {
    const b = behavior();
    b.keyPressed(10);
    b.keyPressed(10.1);
    b.roundFinished(10.4);
    expect(b.current).toBe("idle");
  });

  it("ignores clicks during a click", () => {
    const b = behavior();
    b.mouseClicked(10);
    const round = b.round;
    b.mouseClicked(10.1);
    b.mouseClicked(10.35);
    expect(b.round).toBe(round);
    b.roundFinished(10.4);
    expect(b.current).toBe("idle");
  });

  it("keeps typing and clicking from cutting each other off", () => {
    const b = behavior();
    b.keyPressed(10);
    b.mouseClicked(10.1);
    expect(b.current).toBe("typing");
    b.roundFinished(10.4);
    expect(b.current).toBe("idle");
    b.mouseClicked(11);
    b.keyPressed(11.3);
    expect(b.current).toBe("mouseClick");
    b.roundFinished(11.4);
    expect(b.current).toBe("typing");
  });

  it("lets touches cut in, and never restarts a tap", () => {
    const b = behavior();
    b.keyPressed(10);
    b.setStroking(true, 10.1);
    expect(b.current).toBe("pet");
    b.tapped(10.2);
    expect(b.current).toBe("tap");
    const round = b.round;
    b.tapped(10.3);
    b.setStroking(true, 10.35);
    expect(b.round).toBe(round);
    b.roundFinished(10.6);
    expect(b.current).toBe("pet");
  });

  it("goes on petting while the hand keeps moving", () => {
    const b = behavior();
    b.setStroking(true, 10);
    b.setStroking(true, 10.3);
    b.roundFinished(10.4);
    expect(b.current).toBe("pet");
    b.setStroking(false, 10.5);
    b.roundFinished(10.8);
    expect(b.current).toBe("idle");
  });

  it("never starts disabled states", () => {
    const b = behavior(["typing", "tap"]);
    b.keyPressed(10);
    b.tapped(10);
    expect(b.current).toBe("idle");
  });

  it("loops resting states", () => {
    for (const state of PET_STATES) expect(playedAs(spec(), state).loop).toBe(state === "idle" || state === "sleep");
  });

  it("sleeps after inactivity and wakes on activity", () => {
    const b = new PetBehavior((state) => state === "sleep" ? { ...spec(), sleepAfterMinutes: 1 / 60 } : spec());
    b.activity(0);
    b.checkInactivity(0.9);
    expect(b.current).toBe("idle");
    b.checkInactivity(1);
    expect(b.current).toBe("sleep");
    b.activity(1.1);
    expect(b.current).toBe("idle");
  });
});

describe("StrokeRecognizer (same cases as the Swift runtime)", () => {
  function rub(r: StrokeRecognizer, start: number, passes: number, width = 30) {
    let t = start;
    let x = 100;
    for (let p = 0; p < passes; p++) {
      const dir = p % 2 === 0 ? 1 : -1;
      for (let i = 0; i < 6; i++) {
        x += (dir * width) / 6;
        t += 0.016;
        r.track(x, true, t);
      }
    }
    return t;
  }
  function primed() {
    const r = new StrokeRecognizer();
    r.track(100, true, 0);
    r.track(100, true, 0.25);
    return r;
  }

  it("starts on back-and-forth", () => {
    const r = primed();
    rub(r, 0.25, 4);
    expect(r.isStroking).toBe(true);
  });

  it("ignores crossing over", () => {
    const r = new StrokeRecognizer();
    let t = 0;
    for (let i = 0; i < 40; i++) r.track(i * 6, true, (t += 0.016));
    expect(r.isStroking).toBe(false);
  });

  it("lapses when the hand stops", () => {
    const r = primed();
    const end = rub(r, 0.25, 4);
    r.settle(end + StrokeTuning.strokeLapse + 0.1);
    expect(r.isStroking).toBe(false);
  });

  it("ends when leaving the pet", () => {
    const r = primed();
    const end = rub(r, 0.25, 4);
    r.track(500, false, end + 0.016);
    expect(r.isStroking).toBe(false);
  });
});

describe("project file", () => {
  it("round-trips canvas, frame rate, timing, placement and names", async () => {
    const p = emptyProject("小咪", { width: 600, height: 400, dpi: 144 }, 12);
    const png = new Uint8Array([137, 80, 78, 71]);
    p.frames.a = { id: "a", name: "站立", png, width: 10, height: 10, url: "" };
    p.frameOrder = ["a"];
    p.states.idle = withFrames(p.states.idle, [{ id: "a" }, { id: "a", duration: 250, scale: 1.5, offsetX: 8, offsetY: -16, rotation: 10 }]);
    p.states.tap = { enabled: true, fps: 12, loop: true, frames: [{ id: "a" }] };
    p.states.sleep = {
      enabled: true,
      fps: 12,
      loop: true,
      frames: [{ id: "a", duration: 500 }],
      sleepAfterMinutes: 12,
      tracks: [
        { id: "effects", name: "Z", frames: [{ id: "a" }] },
        { id: "base", name: "Base", frames: [{ id: "a", duration: 500 }] },
      ],
    };

    const back = await decodeProject(encodeProject(p));
    expect(back.name).toBe("小咪");
    expect(back.id).toBe(p.id);
    expect(back.fps).toBe(12);
    expect(back.canvas).toEqual({ width: 600, height: 400, dpi: 144 });
    expect(back.frames.a.name).toBe("站立");
    expect(Array.from(back.frames.a.png)).toEqual(Array.from(png));
    expect(back.states.idle.frames).toEqual([
      { id: "a", duration: undefined },
      { id: "a", duration: 250, scale: 1.5, offsetX: 8, offsetY: -16, rotation: 10 },
    ]);
    expect(back.states.tap.enabled).toBe(true);
    expect(back.states.typing.enabled).toBe(false);
    expect(back.states.sleep.sleepAfterMinutes).toBe(12);
    expect(back.states.sleep.tracks?.map((track) => track.frames.length)).toEqual([1, 1]);
  });

  it("writes what the runtime reads", () => {
    const p = emptyProject("x", { width: 800, height: 800, dpi: 144 }, 8);
    p.frames.a = { id: "a", name: "a", png: new Uint8Array([1]), width: 1, height: 1, url: "" };
    p.frameOrder = ["a"];
    p.states.idle = withFrames(p.states.idle, [{ id: "a" }, { id: "a", duration: spanDuration(5, 8) }]);
    const manifest = JSON.parse(strFromU8(unzipSync(encodeProject(p))["manifest.json"]));
    expect(manifest.display.height).toBe(displayHeight(p.canvas));
    expect(manifest.display.height).toBe(400);
    expect(manifest.states.idle).toEqual({ enabled: true, fps: 8, loop: true, frames: ["a", { id: "a", duration: 625 }] });
  });

  it("keeps random actions and lines", async () => {
    const p = emptyProject("x");
    p.frames.a = { id: "a", name: "a", png: new Uint8Array([1]), width: 1, height: 1, url: "" };
    p.frameOrder = ["a"];
    p.states.idle = withFrames(p.states.idle, [{ id: "a" }]);
    p.states.idle.lines = ["不该存下"];
    p.states.typing.lines = ["被你发现啦！"];
    p.states.idle.variants = [
      { id: "v-1", name: "伸懒腰", tracks: [{ id: "main", name: "", frames: [{ id: "a", duration: 250 }] }], lines: ["好困…"], every: [60, 180] },
    ];
    p.states.typing.variants = [{ id: "v-2", name: "飞快", tracks: [{ id: "main", name: "", frames: [] }], lines: [], chance: 0.4 }];
    const back = await decodeProject(encodeProject(p));
    // Idle speaks only in its random actions.
    expect(back.states.idle.lines).toBeUndefined();
    expect(back.states.typing.lines).toEqual(["被你发现啦！"]);
    expect(back.states.idle.variants).toEqual(p.states.idle.variants);
    expect(back.states.typing.variants).toEqual(p.states.typing.variants);
  });

  it("reads random actions as the editor allows them", async () => {
    const p = emptyProject("x");
    p.states.idle.variants = [{ id: "v-1", name: "n", tracks: [], lines: [], every: [90, 30] }];
    p.states.typing.variants = [{ id: "v-2", name: "n", tracks: [], lines: ["  ", "x".repeat(40)], chance: 3 }];
    const back = await decodeProject(encodeProject(p));
    expect(back.states.idle.variants?.[0].every).toEqual([300, 600]);
    expect(back.states.typing.variants?.[0].chance).toBe(1);
    expect(back.states.typing.variants?.[0].lines).toEqual(["x".repeat(30)]);
  });

  it("keeps an intentionally empty sleep timeline empty", async () => {
    const p = emptyProject("x");
    p.states.sleep.tracks = [];
    p.states.sleep.frames = [];
    const back = await decodeProject(encodeProject(p));
    expect(back.states.sleep.tracks).toEqual([]);
  });

  it("brings older projects onto one frame rate without changing their timing", async () => {
    const files = {
      "manifest.json": strToU8(
        JSON.stringify({
          schemaVersion: 1,
          name: "old",
          id: "old",
          display: { height: 160 },
          frames: { a: { file: "frames/a.png" } },
          states: {
            idle: { enabled: true, fps: 4, loop: true, frames: ["a", { id: "a", duration: 500 }] },
            tap: { enabled: true, fps: 8, loop: false, frames: ["a"] },
          },
        }),
      ),
      "frames/a.png": new Uint8Array([1]),
    };
    const back = await decodeProject(zipSync(files));
    expect(back.fps).toBe(8);
    expect(back.canvas).toEqual({ width: 320, height: 320, dpi: 144 });
    expect(back.states.idle.frames.map((f) => frameSpan(f, back.fps))).toEqual([2, 4]);
    expect(back.states.tap.frames.map((f) => frameSpan(f, back.fps))).toEqual([1]);
    // Click reactions play once per click; the rest loop.
    expect(back.states.tap.loop).toBe(false);
    expect(back.states.idle.loop).toBe(true);
  });

  it("gives a project with an unusable id a fresh one", async () => {
    const p = emptyProject("x");
    p.id = "Not Valid!";
    const back = await decodeProject(encodeProject(p));
    expect(back.id).toMatch(/^[a-z0-9-]{1,40}$/);
  });

  it("rejects files that are not projects", async () => {
    await expect(decodeProject(new Uint8Array([1, 2, 3]))).rejects.toThrow("not-a-project");
  });

  it("validates like the runtime", () => {
    const p = emptyProject("");
    expect(validate(p).map((i) => i.kind)).toEqual(["noName", "idleEmpty"]);
    p.name = "x";
    p.frames.a = { id: "a", name: "a", png: new Uint8Array(), width: 1, height: 1, url: "" };
    p.frameOrder = ["a"];
    p.states.idle = withFrames(p.states.idle, [{ id: "a" }]);
    p.states.typing.enabled = true;
    expect(validate(p)).toEqual([{ kind: "stateEmpty", state: "typing" }]);
  });
});

describe("timeline frames", () => {
  it("stores spans as whole frames", () => {
    expect(spanDuration(1, 8)).toBeUndefined();
    expect(spanDuration(5, 8)).toBe(625);
    expect(frameSpan({ id: "a" }, 8)).toBe(1);
    expect(frameSpan({ id: "a", duration: 625 }, 8)).toBe(5);
    expect(frameSpan({ id: "a", duration: 10 }, 8)).toBe(1);
  });

  it("places pictures standing on the canvas floor", () => {
    expect(fitRect({ width: 100, height: 50 }, { width: 200, height: 200 })).toEqual({ left: 0, top: 100, width: 200, height: 100 });
    expect(fitRect({ width: 50, height: 100 }, { width: 200, height: 200 })).toEqual({ left: 50, top: 0, width: 100, height: 200 });
  });
});

describe("built-in effects", () => {
  it("has every picture and icon it lists", async () => {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const assets = join(__dirname, "../../public/assets");
    for (const effect of EFFECT_KINDS) {
      expect(existsSync(join(assets, `${effect}-effect-icon.png`)), effect).toBe(true);
      for (const file of BUILT_IN_EFFECTS[effect]) expect(existsSync(join(assets, "typepal-frames", file)), file).toBe(true);
    }
  });

  it("knows a row by the effect it was added as", () => {
    expect(effectOfRow(effectRowId("zzz"))).toBe("zzz");
    expect(effectOfRow("effect-heart")).toBe("heart");
    expect(effectOfRow("effect-heart-k3x9")).toBe("heart");
    expect(effectOfRow("main")).toBeUndefined();
    expect(effectOfRow("track-1a2b")).toBeUndefined();
  });
});

describe("random actions and speech (as the Swift tests)", () => {
  const f = [{ id: "f" }];
  const spec = (state: PetState): StateSpec | null =>
    state === "idle"
      ? { enabled: true, fps: 10, loop: true, frames: f, tracks: [{ id: "main", name: "", frames: f }],
          variants: [{ id: "stretch", name: "", tracks: [{ id: "main", name: "", frames: [...f, ...f] }], lines: ["好困…"], every: [60, 120] }] }
      : state === "typing"
        ? { enabled: true, fps: 10, loop: false, frames: f, tracks: [{ id: "main", name: "", frames: f }],
            variants: [{ id: "fast", name: "", tracks: [], lines: [], chance: 0.25 }] }
        : null;

  it("idle plays its action when due, then loops as usual", () => {
    const b = new PetBehavior(spec, () => 0.5);
    b.activity(0);
    b.keyPressed(1);
    b.roundFinished(1.1);
    expect(b.nextVariantDeadline(2)).toBe(90);
    b.checkVariants(50);
    expect(b.variant).toBeNull();
    b.checkVariants(90);
    expect(b.variant).toBe("stretch");
    expect(b.nextVariantDeadline(91)).toBeNull();
    b.roundFinished(90.2);
    expect([b.current, b.variant]).toEqual(["idle", null]);
    expect(b.nextVariantDeadline(91)).toBeCloseTo(180.2);
  });

  it("typing rolls for its action", () => {
    const low = new PetBehavior(spec, () => 0.2);
    low.keyPressed(0);
    expect(low.variant).toBe("fast");
    const high = new PetBehavior(spec, () => 0.3);
    high.keyPressed(0);
    expect([high.current, high.variant]).toEqual(["typing", null]);
  });

  it("speech keeps quiet and does not repeat", () => {
    const speech = new PetSpeech(() => 0);
    expect(speech.say(["a", "b"], 0)).toBe("a");
    expect(speech.say(["a", "b"], 12)).toBeNull();
    expect(speech.say(["a", "b"], 12.5)).toBe("b");
    expect(PetSpeech.duration("字".repeat(30))).toBe(6);
  });
});
