import { loops, variantRows, type PetState, type StateSpec, type StateVariant } from "./types";
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
  /** The random action the round plays, if it is one. */
  variant: string | null = null;
  private roundStart = 0;
  private roundLength = 0;
  private isStroking = false;
  private lastKeyAt = -Infinity;
  private lastStrokeAt = -Infinity;
  private lastActivityAt: number | null = null;
  /** When each of a looping reaction's actions is next due. */
  private due = new Map<string, number>();

  constructor(
    private readonly playable: (state: PetState) => StateSpec | null,
    /** A number in 0..1, uniformly; replaced in tests. */
    private readonly random: () => number = Math.random,
  ) {}

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
    // The pet starts out idle without entering it: its actions are timed
    // from the first sign of life.
    if (this.lastActivityAt === null && this.current === "idle") this.enter("idle", time);
    this.lastActivityAt = Math.max(this.lastActivityAt ?? -Infinity, time);
    if (this.current === "sleep") {
      this.enter("idle", time);
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

  /** When the soonest of the looping reaction's actions is due, if one can
   *  play now (the reaction is playing as usual). */
  nextVariantDeadline(time: number): number | null {
    if (!loops(this.current) || this.variant) return null;
    const times = (this.playable(this.current)?.variants ?? []).flatMap((v) => (this.due.has(v.id) ? [this.due.get(v.id)!] : []));
    return times.length ? Math.max(time, Math.min(...times)) : null;
  }

  /** Plays the looping reaction's action that is due, if one is, as one round. */
  checkVariants(time: number) {
    const spec = this.playable(this.current);
    if (!loops(this.current) || this.variant || !spec) return;
    const ready = (spec.variants ?? [])
      .filter((v) => (this.due.get(v.id) ?? Infinity) <= time)
      .sort((a, b) => this.due.get(a.id)! - this.due.get(b.id)!)[0];
    if (!ready) return;
    this.variant = ready.id;
    this.round += 1;
    this.roundStart = time;
    this.roundLength = cellsOf(spec, ready) / spec.fps;
  }

  /** The reaction showing has played its last frame through. */
  roundFinished(time: number) {
    if (loops(this.current)) {
      // A looping reaction ends a round only when it was an action: back to
      // the usual loop, and the action is due again later.
      const spec = this.playable(this.current);
      const action = spec?.variants?.find((v) => v.id === this.variant);
      if (!this.variant) return;
      this.variant = null;
      this.round += 1;
      if (action) this.schedule(action, time);
      this.checkInactivity(time);
      return;
    }
    const secondHalf = this.roundStart + this.roundLength / 2;
    const ended = this.current;
    this.enter("idle", time);
    if (this.isStroking && (ended !== "pet" || this.lastStrokeAt >= secondHalf)) this.start("pet", time);
    if (this.current === "idle" && this.lastKeyAt >= secondHalf) this.start("typing", time);
    this.checkInactivity(time);
  }

  /** Begins a round of `state`, if the pet has it. A triggered reaction
   *  rolls for its random actions here. */
  private start(state: PetState, time: number) {
    const spec = this.playable(state);
    if (!spec) return;
    if (loops(state)) {
      this.enter(state, time);
      this.round += 1;
      return;
    }
    this.current = state;
    this.variant = this.roll(spec.variants ?? []);
    this.round += 1;
    this.roundStart = time;
    const action = spec.variants?.find((v) => v.id === this.variant);
    this.roundLength = (action ? cellsOf(spec, action) : stateCells(spec)) / spec.fps;
  }

  /** Goes to a looping reaction, playing as usual. Sleep's actions are timed
   *  from now; idle's keep the times they had. */
  private enter(state: PetState, time: number) {
    const spec = this.playable(state);
    this.current = state;
    this.variant = null;
    this.roundStart = time;
    this.roundLength = spec ? stateCells(spec) / spec.fps : 0;
    for (const v of spec?.variants ?? []) if (state === "sleep" || !this.due.has(v.id)) this.schedule(v, time);
  }

  private schedule(v: StateVariant, time: number) {
    const range = v.every;
    if (!range || !(range[0] > 0) || range[0] > range[1]) {
      this.due.delete(v.id);
      return;
    }
    this.due.set(v.id, time + range[0] + this.random() * (range[1] - range[0]));
  }

  /** One action by the chances, or none: a chance of 1 is always taken;
   *  chances adding up to more than 1 are shared out in proportion. */
  private roll(variants: StateVariant[]): string | null {
    const chances = variants.map((v) => Math.max(0, v.chance ?? 0));
    const total = chances.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    let draw = this.random() * Math.max(1, total);
    for (const [i, v] of variants.entries()) {
      if (draw < chances[i]) return v.id;
      draw -= chances[i];
    }
    return null;
  }
}

/** Cells in one round of a random action, as it plays. */
function cellsOf(spec: StateSpec, action: StateVariant): number {
  return stateCells({ ...spec, frames: [], tracks: variantRows(spec, action) });
}

/**
 * What the pet says, and when: one bubble at a time, up for a while that
 * grows with the line, then at least `SPEECH_GAP` seconds of quiet. A line
 * due in the quiet is not said at all. A pool does not give the same line
 * twice running. Port of `PetSpeech.swift`.
 */
export const SPEECH_GAP = 10;

export class PetSpeech {
  private quietUntil = -Infinity;
  private lastLine: string | null = null;

  constructor(private readonly random: () => number = Math.random) {}

  /** Seconds a line stays up: longer for longer lines, 2.5 to 6. */
  static duration(line: string): number {
    return Math.min(6, Math.max(2.5, 1.6 + 0.16 * Array.from(line).length));
  }

  /** The lines a round may say. An action says its own; the usual animation
   *  says its reaction's on every round of a triggered reaction, and only on
   *  coming to a looping one. */
  static pool(state: PetState, spec: StateSpec, variant: StateVariant | undefined, entered: boolean): string[] {
    if (variant) return variant.lines;
    return loops(state) && !entered ? [] : (spec.lines ?? []);
  }

  /** A line to say now, or null: nothing to say, or too soon after the last. */
  say(pool: string[], time: number): string | null {
    const lines = pool.filter(Boolean);
    if (!lines.length || time < this.quietUntil) return null;
    const choices = lines.length > 1 ? lines.filter((l) => l !== this.lastLine) : lines;
    const line = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))];
    this.lastLine = line;
    this.quietUntil = time + PetSpeech.duration(line) + SPEECH_GAP;
    return line;
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
