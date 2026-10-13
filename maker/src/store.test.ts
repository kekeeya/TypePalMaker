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
