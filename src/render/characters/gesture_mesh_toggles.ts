// Gesture mesh toggles (VisualDef.meshToggles): whole mesh nodes of a rig a
// presentation gesture hides or shows, sent through the renderer's
// triggerAttack seam (the route bone dials and boss stances take). The Great
// Saurian's howdah and its rider are the reference: the HowdahBreak clip
// throws every piece and scales it away, but every OTHER clip keys the howdah
// bones at rest, so once the clip is over the meshes themselves must stay
// hidden for the rest of the fight (and on the corpse).
//
// Three gesture shapes per toggle:
//  - `hideAfter`: the gesture still plays its own clip (attackByAbility); the
//    nodes hide `seconds` later, or at once if that clip is cut short (a cast
//    taking over mid-break would otherwise snap the pieces back on its back);
//  - `hideNow` / `showNow`: consumed (no clip), idempotent; the driving fx
//    module re-sends them so a view rebuilt mid-fight shows the right state.
//
// The decisions are pure (meshToggleActions, stepMeshToggle) so tests import
// them directly; the class only flips `visible` on the named nodes.

import type * as THREE from 'three';

export interface MeshToggleDef {
  /** GLB node names the toggle hides and shows ('*': the whole model). */
  nodes: readonly string[];
  /** Hide `seconds` after this gesture (its clip plays the nodes out). */
  hideAfter?: { gesture: string; seconds: number; clip: string };
  /** Hide at once (consumed: no clip plays). */
  hideNow?: string;
  /** Show at once (consumed: no clip plays). */
  showNow?: string;
}

/** One toggle's live state: shown, or counting down to a hide. */
export interface MeshToggleState {
  shown: boolean;
  /** Seconds to the scheduled hide; null when none is pending. */
  hideIn: number | null;
  /** The scheduled hide's clip has been seen playing (so a later frame on a
   *  different clip means it was cut short). */
  clipSeen: boolean;
}

export type MeshToggleAction = 'schedule' | 'hide' | 'show';

export type MeshToggleHidden = 'none' | 'partial' | 'whole';

/** What a rig's toggles hide right now (see GestureMeshToggles.hidden). */
export function meshToggleHidden(
  defs: readonly MeshToggleDef[],
  states: readonly MeshToggleState[],
): MeshToggleHidden {
  let out: MeshToggleHidden = 'none';
  for (let i = 0; i < defs.length; i++) {
    if (states[i].shown) continue;
    if (defs[i].nodes.includes('*')) return 'whole';
    out = 'partial';
  }
  return out;
}

/** What a gesture does to each toggle: [toggle index, action]. */
export function meshToggleActions(
  defs: readonly MeshToggleDef[],
  gesture: string,
): [number, MeshToggleAction][] {
  const out: [number, MeshToggleAction][] = [];
  defs.forEach((d, i) => {
    if (d.hideAfter?.gesture === gesture) out.push([i, 'schedule']);
    else if (d.hideNow === gesture) out.push([i, 'hide']);
    else if (d.showNow === gesture) out.push([i, 'show']);
  });
  return out;
}

/** Apply one action to a state. */
export function applyMeshToggleAction(
  def: MeshToggleDef,
  state: MeshToggleState,
  action: MeshToggleAction,
): void {
  if (action === 'show') {
    state.shown = true;
    state.hideIn = null;
  } else if (action === 'hide') {
    state.shown = false;
    state.hideIn = null;
  } else if (state.shown && state.hideIn === null) {
    state.hideIn = def.hideAfter?.seconds ?? 0;
    state.clipSeen = false;
  }
}

/** Advance a pending hide by `dt`; `clip` is the rig's current clip name.
 *  True when the nodes' visibility changed this step. */
export function stepMeshToggle(
  def: MeshToggleDef,
  state: MeshToggleState,
  dt: number,
  clip: string | null,
): boolean {
  if (state.hideIn === null) return false;
  const own = def.hideAfter?.clip;
  if (own && clip === own) state.clipSeen = true;
  const cut = own !== undefined && state.clipSeen && clip !== own;
  state.hideIn -= Math.max(0, dt);
  if (state.hideIn > 0 && !cut) return false;
  state.hideIn = null;
  state.shown = false;
  return true;
}

/** The toggles of one live rig. */
export class GestureMeshToggles {
  private readonly nodes: THREE.Object3D[][];
  private readonly states: MeshToggleState[];

  constructor(
    model: THREE.Object3D,
    private readonly defs: readonly MeshToggleDef[],
  ) {
    this.nodes = defs.map((d) => {
      // '*' names the whole model (a body that vanishes outright).
      if (d.nodes.includes('*')) return [model];
      const found: THREE.Object3D[] = [];
      model.traverse((n) => {
        if (d.nodes.includes(n.name)) found.push(n);
      });
      return found;
    });
    this.states = defs.map(() => ({ shown: true, hideIn: null, clipSeen: false }));
  }

  /** A presentation gesture. Returns true when it is CONSUMED (a hide or show
   *  with no clip of its own); a scheduling gesture returns false so its clip
   *  still plays. */
  handle(gesture: string): boolean {
    let consumed = false;
    for (const [i, action] of meshToggleActions(this.defs, gesture)) {
      applyMeshToggleAction(this.defs[i], this.states[i], action);
      if (action !== 'schedule') {
        consumed = true;
        this.paint(i);
      }
    }
    return consumed;
  }

  /** After the mixer: count pending hides down against the current clip. */
  update(dt: number, clip: string | null): boolean {
    let changed = false;
    for (let i = 0; i < this.defs.length; i++)
      if (stepMeshToggle(this.defs[i], this.states[i], dt, clip)) {
        this.paint(i);
        changed = true;
      }
    return changed;
  }

  /** What is hidden now: nothing, some nodes, or the whole model. The far
   *  mesh and the shadow proxy are baked from the whole idle pose, so the
   *  visual keeps the articulated rig while a part is hidden and hides both
   *  while the whole model is. */
  hidden(): MeshToggleHidden {
    return meshToggleHidden(this.defs, this.states);
  }

  /** A revived rig shows everything again. */
  reset(): void {
    for (let i = 0; i < this.defs.length; i++) {
      this.states[i] = { shown: true, hideIn: null, clipSeen: false };
      this.paint(i);
    }
  }

  private paint(i: number): void {
    const shown = this.states[i].shown;
    for (const n of this.nodes[i]) n.visible = shown;
  }
}
