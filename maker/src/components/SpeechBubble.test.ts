import { describe, expect, it } from "vitest";
import { backdropFor } from "./SpeechBubble";

describe("what a bubble is shown on", () => {
  it("is cream, unless the bubble hardly shows on it", () => {
    expect(backdropFor("#fffdf7")).toBe("#dfe5ee");
    expect(backdropFor("#ffffff")).toBe("#dfe5ee");
    expect(backdropFor("#fde4ea")).toBe("#fefaf1");
    expect(backdropFor("#353754")).toBe("#fefaf1");
    expect(backdropFor("#dfe5ee")).toBe("#fefaf1");
    // Like neither cream nor the blue-grey: the mid grey.
    expect(backdropFor("#eef0f0")).not.toBe("#fefaf1");
  });
});
