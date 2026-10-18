import type { PetState, StateSpec } from "./types";
import { stateCells } from "./timeline";

/**
 * The pet's rules, ported line for line from the Swift runtime
 * (`player/Sources/TypePalCore/PetBehavior.swift` and `StrokeRecognizer.swift`)
 * so the editor's preview reacts exactly as the generated app will. The unit
 * tests mirror the Swift ones; change both together.
 */

/**
 * Every reaction but idle plays its frames once per trigger, never cut short
 * by time running out. Touches (tap, pet) cut in on anything; typing and
 * mouseClick only start from idle. A round that ends goes on into another if
 * the reaction is still going on in its second half; otherwise idle loops.
 * See the Swift `PetBehavior` for the reasoning.
 */
export class PetBehavior {
  current: PetState = "idle";
  /** Bumped whenever a reaction starts: a new round plays from the top. */
  round = 0;
  private roundStart = 0;
  private roundLength = 0;
  private isStroking = false;
  private lastKeyAt = -Infinity;
  private lastStrokeAt = -Infinity;
  private lastActivityAt: number | null = null;

  constructor(private readonly playable: (state: PetState) => StateSpec | null) {}

  tapped(time: number) {
    this.activity(time);
    if (this.current !== "tap") this.start("tap", time);
  }

  /** Fed on every pointer move: whether the pet is being stroked right now. */
  setStroking(stroking: boolean, time: number) {
    this.isStroking = stroking;
    if (!stroking) return;
    this.lastStrokeAt = Math.max(this.lastStrokeAt, time);
    if (this.current !== "tap" && this.current !== "pet") this.start("pet", time);
  }

  keyPressed(time: number) {
    this.activity(time);
    this.lastKeyAt = Math.max(this.lastKeyAt, time);
    if (this.current === "idle") this.start("typing", time);
  }

  mouseClicked(time: number) {
    this.activity(time);
    if (this.current === "idle") this.start("mouseClick", time);
  }

  activity(time: number) {
    this.lastActivityAt = Math.max(this.lastActivityAt ?? -Infinity, time);
    if (this.current === "sleep") {
      this.current = "idle";
      this.round += 1;
    }
  }

  checkInactivity(time: number) {
    const sleep = this.playable("sleep");
    if (!sleep || this.current !== "idle" || this.lastActivityAt === null) return;
    if (time - this.lastActivityAt >= (sleep.sleepAfterMinutes ?? 15) * 60) this.start("sleep", time);
  }

  nextSleepDeadline(time: number): number | null {
    const sleep = this.playable("sleep");
    if (!sleep || this.current !== "idle" || this.lastActivityAt === null) return null;
    const deadline = this.lastActivityAt + (sleep.sleepAfterMinutes ?? 15) * 60;
    return deadline > time ? deadline : time;
  }

  /** The reaction showing has played its last frame through. */
  roundFinished(time: number) {
    if (this.current === "idle") return;
    const secondHalf = this.roundStart + this.roundLength / 2;
    const ended = this.current;
    this.current = "idle";
    if (this.isStroking && (ended !== "pet" || this.lastStrokeAt >= secondHalf)) this.start("pet", time);
    if (this.current === "idle" && this.lastKeyAt >= secondHalf) this.start("typing", time);
    this.checkInactivity(time);
  }

  private start(state: PetState, time: number) {
    const spec = this.playable(state);
    if (!spec) return;
    this.current = state;
    this.round += 1;
    this.roundStart = time;
    this.roundLength = stateCells(spec) / spec.fps;
  }
}

/** How a state is played, whatever its file says: idle loops, every
 *  reaction plays once per trigger. */
export function playedAs(spec: StateSpec, state: PetState): StateSpec {
  return { ...spec, loop: state === "idle" || state === "sleep" };
}

export const StrokeTuning = {
  strokeTravel: 8,
  maxSampleTravel: 150,
  requiredReversals: 2,
  strokeWindow: 0.9,
  entryGrace: 0.2,
  maxNetTravelShare: 0.5,
  strokeLapse: 0.7,
};

interface Pass {
  direction: number;
  length: number;
  at: number;
}

/** Back-and-forth over the pet, with no button held, is stroking. */
export class StrokeRecognizer {
  isStroking = false;
  private lastX: number | null = null;
  private travel = 0;
  private passes: Pass[] = [];
  private lastPassAt: number | null = null;
  private onPetSince: number | null = null;

  track(x: number, onPet: boolean, time: number) {
    if (!onPet) {
      this.reset();
      return;
    }
    const lastX = this.lastX;
    this.lastX = x;
    if (this.onPetSince === null) this.onPetSince = time;
    if (lastX === null) return;
    if (time - this.onPetSince < StrokeTuning.entryGrace) {
      this.travel = 0;
      return;
    }
    const delta = x - lastX;
    if (Math.abs(delta) > StrokeTuning.maxSampleTravel) {
      this.travel = 0;
      return;
    }
    if (this.travel === 0 || delta < 0 === this.travel < 0) this.travel += delta;
    else this.travel = delta;

    let committed = false;
    if (Math.abs(this.travel) >= StrokeTuning.strokeTravel) {
      this.passes.push({ direction: this.travel < 0 ? -1 : 1, length: Math.abs(this.travel), at: time });
      this.travel = 0;
      this.lastPassAt = time;
      committed = true;
    }
    this.evaluate(time, committed);
  }

  settle(time: number) {
    this.evaluate(time, false);
  }

  reset() {
    this.lastX = null;
    this.travel = 0;
    this.passes = [];
    this.lastPassAt = null;
    this.onPetSince = null;
    this.isStroking = false;
  }

  get heldPassCount() {
    return this.passes.length;
  }

  private evaluate(time: number, committed: boolean) {
    this.passes = this.passes.filter((p) => time - p.at <= StrokeTuning.strokeWindow);
    if (!this.isStroking) {
      if (!committed) return;
      let reversals = 0;
      for (let i = 1; i < this.passes.length; i++) {
        if (this.passes[i].direction !== this.passes[i - 1].direction) reversals++;
      }
      const path = this.passes.reduce((s, p) => s + p.length, 0);
      const net = Math.abs(this.passes.reduce((s, p) => s + p.direction * p.length, 0));
      if (reversals >= StrokeTuning.requiredReversals && net <= path * StrokeTuning.maxNetTravelShare) {
        this.isStroking = true;
      }
    } else if (this.lastPassAt === null || time - this.lastPassAt > StrokeTuning.strokeLapse) {
      this.isStroking = false;
    }
  }
}
