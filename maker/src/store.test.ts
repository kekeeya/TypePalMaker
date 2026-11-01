import { beforeEach, describe, expect, it } from "vitest";
import { emptyProject } from "./model/types";
import { HISTORY_LIMIT, useEditor } from "./store";

const editor = () => useEditor.getState();
const asset = (id: string) => ({ asset: { id, name: id, png: new Uint8Array([1]), width: 1, height: 1, url: "" } });

describe("undo and redo", () => {
  beforeEach(() => editor().loadProject(emptyProject("a")));

  it("steps back and forth through edits", () => {
    editor().addFrames("idle", [asset("x")]);
    editor().setEnabled("typing", true);
    expect(editor().project.states.typing.enabled).toBe(true);
    editor().undo();
    expect(editor().project.states.typing.enabled).toBe(false);
    editor().undo();
    expect(editor().project.states.idle.frames).toEqual([]);
    expect(editor().selectedIndex).toBeNull();
    editor().redo();
    expect(editor().project.states.idle.frames.map((f) => f.id)).toEqual(["x"]);
    expect(editor().project.frames.x).toBeDefined();
  });

  it("brings back a picture that an edit removed", () => {
    editor().addFrames("idle", [asset("x")]);
    editor().removeFrame("idle", 0);
    expect(editor().project.frames.x).toBeUndefined();
    editor().undo();
    expect(editor().project.frames.x).toBeDefined();
  });

  it("forgets the redo steps after a new edit", () => {
    editor().setEnabled("typing", true);
    editor().undo();
    editor().setEnabled("tap", true);
    expect(editor().future).toEqual([]);
  });

  it("counts a burst of the same change as one step", () => {
    editor().setName("ab");
    editor().setName("abc");
    editor().setName("abcd");
    editor().undo();
    expect(editor().project.name).toBe("a");
  });

  it("keeps at most the last steps", () => {
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) editor().setEnabled("typing", i % 2 === 0);
    expect(editor().past.length).toBe(HISTORY_LIMIT);
  });

  it("starts each project with no history", () => {
    editor().setEnabled("typing", true);
    editor().loadProject(emptyProject("b"));
    expect(editor().past).toEqual([]);
  });
});

describe("timeline tracks", () => {
  beforeEach(() => editor().loadProject(emptyProject("a")));

  it("deletes every track and can add one again", () => {
    editor().selectState("sleep");
    editor().removeTrack("sleep", "sleep-effects");
    expect(editor().project.states.sleep.tracks?.map((track) => track.id)).toEqual(["sleep-base"]);
    expect(editor().selectedTrackId).toBe("sleep-base");

    editor().removeTrack("sleep", "sleep-base");
    expect(editor().project.states.sleep.tracks).toEqual([]);
    expect(editor().selectedTrackId).toBeNull();

    editor().addTrack("sleep", "Zzz 睡眠特效");
    expect(editor().project.states.sleep.tracks).toHaveLength(1);
    expect(editor().selectedTrackId).toBe(editor().project.states.sleep.tracks?.[0].id);
    expect(editor().project.states.sleep.tracks?.[0].name).toBe("Zzz 睡眠特效");
  });
});

describe("frames placed with gaps", () => {
  beforeEach(() => editor().loadProject(emptyProject("a")));

  it("moves an effect's frame later, and what follows a deleted one stays put", () => {
    editor().selectState("pet");
    editor().addFrames("pet", [asset("base")]);
    editor().setSpan("pet", 0, 8);
    editor().addTrack("pet", "", "effect-heart", true);
    editor().addFrames("pet", [asset("h1"), asset("h2")], "effect-heart");
    editor().moveFrameTo("pet", "effect-heart", 1, "effect-heart", 5);
    const row = (id: string) => editor().project.states.pet.tracks?.find((track) => track.id === id)?.frames;
    expect(row("effect-heart")).toEqual([{ id: "h1" }, { id: "h2", delay: 500 }]);
    expect(editor().selectedIndex).toBe(1);
    // Onto a frame already there: it stays where it was.
    editor().moveFrameTo("pet", "effect-heart", 1, "effect-heart", 0);
    expect(row("effect-heart")).toEqual([{ id: "h1" }, { id: "h2", delay: 500 }]);
    editor().removeFrame("pet", 0, "effect-heart");
    expect(row("effect-heart")).toEqual([{ id: "h2", delay: 625 }]);
  });

  it("lengthens an effect's frame into the gap after it, the next one staying put", () => {
    editor().selectState("pet");
    editor().addFrames("pet", [asset("base")]);
    editor().setSpan("pet", 0, 8);
    editor().addTrack("pet", "", "effect-heart", true);
    editor().addFrames("pet", [asset("h1"), asset("h2")], "effect-heart");
    editor().moveFrameTo("pet", "effect-heart", 1, "effect-heart", 5);
    const row = () => editor().project.states.pet.tracks?.find((track) => track.id === "effect-heart")?.frames;
    editor().setSpan("pet", 0, 3, "effect-heart");
    expect(row()).toEqual([{ id: "h1", duration: 375 }, { id: "h2", delay: 250 }]);
    // Past the gap: the next frame is pushed along.
    editor().setSpan("pet", 0, 7, "effect-heart");
    expect(row()).toEqual([{ id: "h1", duration: 875 }, { id: "h2" }]);
    // With the pet's row gone, the effect's row becomes the pet's own: no gaps.
    editor().moveFrameTo("pet", "effect-heart", 1, "effect-heart", 9);
    expect(row()?.[1].delay).toBeGreaterThan(0);
    editor().removeTrack("pet", "main");
    expect(row()).toEqual([{ id: "h1", duration: 875 }, { id: "h2" }]);
    expect(editor().project.states.pet.frames).toEqual(row());
  });

  it("copies a frame and pastes it after the selected one, on any row", () => {
    editor().selectState("pet");
    editor().addFrames("pet", [asset("b1"), asset("b2")]);
    editor().setPlacement("pet", 0, { scale: 2 });
    editor().addTrack("pet", "", "effect-heart", true);
    editor().addFrames("pet", [asset("h1")], "effect-heart");
    const row = (id: string) => editor().project.states.pet.tracks?.find((track) => track.id === id)?.frames;
    editor().selectTrack("main");
    editor().selectFrame(0);
    editor().copyFrame("pet");
    // Same row: right after it, the rest moving along.
    editor().pasteFrame("pet");
    expect(row("main")?.map((f) => f.id)).toEqual(["b1", "b1", "b2"]);
    expect(row("main")?.[1]).toEqual({ id: "b1", scale: 2 });
    expect(editor().selectedIndex).toBe(1);
    // An effect's row: in the cell after the selected frame.
    editor().selectTrack("effect-heart");
    editor().selectFrame(0);
    editor().pasteFrame("pet");
    expect(row("effect-heart")).toEqual([{ id: "h1" }, { id: "b1", scale: 2 }]);
    editor().undo();
    expect(row("effect-heart")).toEqual([{ id: "h1" }]);
  });

  it("moves frames between rows, as one step", () => {
    editor().selectState("pet");
    editor().addFrames("pet", [asset("b1"), asset("b2")]);
    editor().addTrack("pet", "", "effect-heart", true);
    editor().addFrames("pet", [asset("h1"), asset("h2")], "effect-heart");
    const row = (id: string) => editor().project.states.pet.tracks?.find((track) => track.id === id)?.frames.map((f) => f.id);
    // An effect's frame onto the pet's row, at its 2nd cell: between b1 and b2.
    editor().moveFrameTo("pet", "effect-heart", 1, "main", 1);
    expect(row("main")).toEqual(["b1", "h2", "b2"]);
    expect(row("effect-heart")).toEqual(["h1"]);
    expect(editor().selectedTrackId).toBe("main");
    expect(editor().selectedIndex).toBe(1);
    // The pet's frame onto the effect's row, at its 3rd cell, a gap before it.
    editor().moveFrameTo("pet", "main", 0, "effect-heart", 2);
    expect(editor().project.states.pet.tracks?.find((track) => track.id === "effect-heart")?.frames).toEqual([{ id: "h1" }, { id: "b1", delay: 125 }]);
    expect(row("main")).toEqual(["h2", "b2"]);
    editor().undo();
    expect(row("main")).toEqual(["b1", "h2", "b2"]);
    expect(row("effect-heart")).toEqual(["h1"]);
  });
});

describe("rows on every reaction", () => {
  beforeEach(() => editor().loadProject(emptyProject("a")));

  it("edits the pet's own row, with effects over it", () => {
    editor().addFrames("idle", [asset("x")]);
    expect(editor().project.states.idle.tracks?.map((track) => track.frames.map((f) => f.id))).toEqual([["x"]]);
    expect(editor().project.states.idle.frames.map((f) => f.id)).toEqual(["x"]);

    editor().addTrack("idle", "", "sleep-effects", true);
    editor().addFrames("idle", [asset("z")]);
    expect(editor().project.states.idle.tracks?.map((track) => track.id)).toEqual(["sleep-effects", "main"]);
    // The pet's row is still the one older readers see.
    expect(editor().project.states.idle.frames.map((f) => f.id)).toEqual(["x"]);

    editor().addTrack("idle");
    expect(editor().project.states.idle.tracks?.at(-1)?.frames).toEqual([]);
    expect(editor().project.states.idle.frames.map((f) => f.id)).toEqual(["x"]);
  });

  it("adds an effect as one step", () => {
    editor().batch(() => {
      editor().addTrack("idle", "", "sleep-effects", true);
      editor().addFrames("idle", [asset("z")]);
    });
    expect(editor().project.states.idle.tracks?.map((track) => track.id)).toEqual(["sleep-effects", "main"]);
    editor().undo();
    expect(editor().project.states.idle.tracks?.map((track) => track.id)).toEqual(["main"]);
    expect(editor().project.frames.z).toBeUndefined();
  });

  it("moves a row, keeping the pet's own row as the one older readers see", () => {
    editor().addFrames("idle", [asset("x")]);
    editor().addTrack("idle", "", "sleep-effects", true);
    editor().moveTrack("idle", 0, 1);
    expect(editor().project.states.idle.tracks?.map((track) => track.id)).toEqual(["main", "sleep-effects"]);
    expect(editor().project.states.idle.frames.map((f) => f.id)).toEqual(["x"]);
    editor().undo();
    expect(editor().project.states.idle.tracks?.map((track) => track.id)).toEqual(["sleep-effects", "main"]);
  });
});

describe("random actions", () => {
  beforeEach(() => editor().loadProject(emptyProject("a")));

  it("edits the selected action's rows, not the usual animation's", () => {
    editor().addFrames("idle", [asset("x")]);
    editor().addVariant("idle", "小动作 1");
    const id = editor().selectedVariantId!;
    expect(editor().project.states.idle.variants?.[0]).toMatchObject({ name: "小动作 1", every: [60, 180], lines: [] });
    editor().addFrames("idle", [asset("y")]);
    editor().addTrack("idle", "", "sleep-effects", true);
    expect(editor().project.states.idle.variants?.[0].tracks.map((t) => [t.id, t.frames.map((f) => f.id)])).toEqual([
      ["sleep-effects", []],
      ["main", ["y"]],
    ]);
    expect(editor().project.states.idle.tracks?.map((t) => t.frames.map((f) => f.id))).toEqual([["x"]]);
    expect(editor().project.frames.y).toBeDefined();

    editor().selectVariant(null);
    expect(editor().selectedTrackId).toBe("main");
    editor().removeVariant("idle", id);
    expect(editor().project.frames.y).toBeUndefined();
    editor().undo();
    expect(editor().project.states.idle.variants).toHaveLength(1);
    expect(editor().project.frames.y).toBeDefined();
  });

  it("rolls for actions of a triggered reaction, and keeps lines per tab", () => {
    editor().selectState("typing");
    editor().addVariant("typing", "小动作 1");
    const id = editor().selectedVariantId!;
    expect(editor().project.states.typing.variants?.[0].chance).toBe(0.2);
    editor().setVariantFrequency("typing", id, { chance: 0.4 });
    editor().setLines("typing", id, ["敲得飞快"]);
    editor().setLines("typing", null, ["加油"]);
    expect(editor().project.states.typing.variants?.[0]).toMatchObject({ chance: 0.4, lines: ["敲得飞快"] });
    expect(editor().project.states.typing.lines).toEqual(["加油"]);
  });

  it("goes back to the usual animation when undo takes the shown action away", () => {
    editor().addVariant("idle", "小动作 1");
    editor().undo();
    expect(editor().selectedVariantId).toBeNull();
  });
});

describe("the speech bubble's look", () => {
  beforeEach(() => editor().loadProject(emptyProject("a")));

  it("keeps offsets within the pet's reach, and a change to the same is no step", () => {
    const steps = () => editor().past.length;
    editor().setSpeech({ offsetX: 1e6, offsetY: -1e6 });
    const reach = 2 * editor().project.canvas.height;
    expect(editor().project.speech).toMatchObject({ offsetX: reach, offsetY: -reach });
    const before = steps();
    editor().setSpeech({ offsetX: reach });
    expect(steps()).toBe(before);
  });
});
