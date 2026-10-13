import { PET_STATES, type PetState, type Project, type StateSpec } from "./types";

/** A spec the pet may show: switched on and with at least one frame. Same
 *  rule as `PetManifest.playable` in the runtime. */
export function playable(project: Project, state: PetState): StateSpec | null {
  const spec = project.states[state];
  return spec.enabled && spec.frames.length > 0 ? spec : null;
}

export type Issue = { kind: "noName" } | { kind: "idleEmpty" } | { kind: "stateEmpty"; state: PetState };

/** Everything that would stop the pet from being generated, mirroring
 *  `PetManifest.validate` in the runtime. */
export function validate(project: Project): Issue[] {
  const issues: Issue[] = [];
  if (!project.name.trim()) issues.push({ kind: "noName" });
  if (!playable(project, "idle")) issues.push({ kind: "idleEmpty" });
  for (const state of PET_STATES) {
    const spec = project.states[state];
    if (state !== "idle" && spec.enabled && spec.frames.length === 0) issues.push({ kind: "stateEmpty", state });
  }
  return issues;
}
