// The per-rig owner of the shapeshift form adornments. CharacterVisual holds
// one (lazily, only once a form flag first turns on) and forwards the form and
// ghost edges it already receives every frame from the renderer
// (`setMoonkin`, `setShadowform`, `setGhost`), its per-frame tick and its
// teardown; everything else lives here and in the pieces this composes:
//   form_adornment_core.ts   what a rig wears, and how it moves (pure)
//   moonwing_adornment.ts    antlers, crescent and wings (THREE)
//   gloamveil_veil.ts        the veil and burning eyes (THREE)
//
// A set's FIRST mount on this rig rides the visual's injected compile gate
// (the renderer's gateSwapFlagOnCompile, the same one that stages the tint's
// transparent clones): the pieces mount hidden and show once their programs
// have linked, while the tinted body stands in. The boot prewarm
// (ABILITY_MATERIAL_SOURCES) normally links them long before, so the hold is a
// frame; it is what covers a constrained device whose manifest deferred that
// entry to the resume lane. Hidden pieces hide only themselves.
import type * as THREE from 'three';
import {
  type AdornmentBody,
  createMoonwingPose,
  formAdornmentPlan,
  gloamveilEyeGlow,
  moonwingPoseInto,
} from './form_adornment_core';
import { GloamveilVeil } from './gloamveil_veil';
import { MoonwingAdornment } from './moonwing_adornment';
import type { FarBakeGate } from './visual';

/** A mounted piece set: the groups it parented into the rig, and its teardown. */
interface AdornmentSet {
  readonly roots: readonly THREE.Object3D[];
  dispose(): void;
}

/** One mounted set and its compile hold. */
interface Mounted<T extends AdornmentSet> {
  piece: T;
  /** Hidden until the gate settles. */
  held: boolean;
  /** The gate settled; the per-frame path reveals (never the gate callback). */
  settled: boolean;
}

export class FormAdornments {
  private moonwing: Mounted<MoonwingAdornment> | null = null;
  private veil: Mounted<GloamveilVeil> | null = null;
  private moonwingElapsed = 0;
  private veilElapsed = 0;
  private readonly pose = createMoonwingPose();
  /** Sets whose programs this rig has seen link: later shifts show at once. */
  private moonwingLinked = false;
  private veilLinked = false;
  /** Ghost or stealth: the body goes see-through, so the pieces hide rather
   *  than glow on over it (a glowing crescent must never mark a stealther). */
  private suppressed = false;
  private disposed = false;

  /** `model` holds the rig's bones; `body` decides the antlers and veil
   *  (form_adornment_core.formAdornmentPlan); `gate` reads the visual's
   *  current compile gate, null in previews and tests (no hold). */
  constructor(
    private readonly model: THREE.Object3D,
    private readonly body: AdornmentBody,
    private readonly gate: () => FarBakeGate | null,
  ) {}

  /** Mount, unmount, or hide the pieces for the current form and ghost flags.
   *  Idempotent: the caller forwards only edges, but a repeat is a no-op. */
  sync(moonkin: boolean, shadowform: boolean, ghosted: boolean): void {
    if (this.disposed) return;
    this.suppressed = ghosted;
    const plan = formAdornmentPlan(moonkin, shadowform, this.body);
    if (plan.moonwing && !this.moonwing) {
      const piece = new MoonwingAdornment(this.model, plan.antlers);
      this.moonwingElapsed = 0;
      // Every shift starts folded: the pose still holds the LAST form's
      // unfurled wings, which would pop the new pair open on its first frame.
      piece.apply(Object.assign(this.pose, createMoonwingPose()));
      this.moonwing = this.mount(piece, this.moonwingLinked);
    } else if (!plan.moonwing && this.moonwing) {
      this.moonwing.piece.dispose();
      this.moonwing = null;
    }
    if (plan.gloamveil && !this.veil) {
      this.veilElapsed = 0;
      this.veil = this.mount(new GloamveilVeil(this.model), this.veilLinked);
    } else if (!plan.gloamveil && this.veil) {
      this.veil.piece.dispose();
      this.veil = null;
    }
    if (this.moonwing) this.show(this.moonwing);
    if (this.veil) this.show(this.veil);
  }

  /** Hold a new set hidden behind the gate unless this rig already linked it. */
  private mount<T extends AdornmentSet>(piece: T, linked: boolean): Mounted<T> {
    const mounted: Mounted<T> = { piece, held: false, settled: false };
    const gate = linked ? null : this.gate();
    if (!gate || piece.roots.length === 0) return mounted;
    mounted.held = true;
    let pending = piece.roots.length;
    for (const root of piece.roots) {
      root.visible = false;
      gate(root, () => {
        // Flag only: the per-frame update reveals. A settle for a set this rig
        // has since dropped, or for a disposed rig, reveals nothing.
        pending -= 1;
        if (pending === 0 && !this.disposed) mounted.settled = true;
      });
    }
    return mounted;
  }

  private show(mounted: Mounted<AdornmentSet>): void {
    const visible = !mounted.held && !this.suppressed;
    for (const root of mounted.piece.roots) root.visible = visible;
  }

  /** Reveal a set whose gate settled since the last frame. */
  private release(mounted: Mounted<AdornmentSet> | null): boolean {
    if (!mounted?.held || !mounted.settled) return false;
    mounted.held = false;
    this.show(mounted);
    return true;
  }

  /** Advance the pieces one frame. `visible` false (a culled or far-LOD rig,
   *  whose subtree is hidden anyway) skips the pose work and holds the clock;
   *  so does a set still held behind its gate, so it unfurls on screen. */
  update(
    dt: number,
    moving: boolean,
    casting: boolean,
    reducedMotion: boolean,
    visible: boolean,
  ): void {
    if (this.disposed) return;
    if (this.release(this.moonwing)) this.moonwingLinked = true;
    if (this.release(this.veil)) this.veilLinked = true;
    if (!visible) return;
    if (this.moonwing && !this.moonwing.held) {
      this.moonwingElapsed += dt;
      this.moonwing.piece.apply(
        moonwingPoseInto(this.moonwingElapsed, moving, casting, reducedMotion, this.pose),
      );
    }
    if (this.veil && !this.veil.held) {
      this.veilElapsed += dt;
      this.veil.piece.apply(gloamveilEyeGlow(this.veilElapsed, reducedMotion));
    }
  }

  /** Detach everything; the owner is inert afterwards (a late edge on a
   *  disposed rig mounts nothing). */
  dispose(): void {
    this.disposed = true;
    this.moonwing?.piece.dispose();
    this.moonwing = null;
    this.veil?.piece.dispose();
    this.veil = null;
  }
}
