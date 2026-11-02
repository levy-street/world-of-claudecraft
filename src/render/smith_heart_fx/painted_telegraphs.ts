// The Guardian of the Breath's and the Hammer Council's painted telegraphs:
// the shared floor telegraph's pooled fans (../floor_telegraph) dressed in
// their element's paint (painted_telegraph_core.ts; shaders
// breath_telegraph_glsl.ts and council_telegraph_glsl.ts).
//
// As heat_telegraph.ts and final_telegraphs.ts do, the kit keeps everything a
// player reads the area and the timing off (the drape at the sim's exact
// radius, the fill, the front, the warning, the fade, the threat colour);
// the dressing swaps the paint only: the fan's own mesh draws the CHAR pass (a
// multiply) on its own rung, a child mesh on the same draped geometry draws
// the GLOW pass (additive; the charged ground's a MAX, so stacked patches never
// sum to white) on the owner's glow rung (above every char rung of the owner,
// so the owner's marks blend commutatively whatever their order),
// both reading the kit's own uniform objects, so every drape and paint call
// reaches them. A fan wears one paint for life (its program is fixed at the
// build); `setLook` moves it between that paint's kinds with uniform writes
// only (a bar's fan turning from Leaping Bolt's reach to the cradle's).
//
// Built in the owner's constructor under its gated root (every program links
// at the gate: no program-key change after it); the materials go to the
// owner's list for its dispose.

import * as THREE from 'three';
import type { TelegraphFan, TelegraphLane } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { BREATH_TELEGRAPH_FRAG, BREATH_TELEGRAPH_VERT } from './breath_telegraph_glsl';
import { COUNCIL_TELEGRAPH_FRAG } from './council_telegraph_glsl';
import { applyCharBlend } from './heat_molten_decal';
import {
  BREATH_TELEGRAPH_LOOKS,
  type BreathTelegraphKind,
  COUNCIL_TELEGRAPH_LOOKS,
  type CouncilTelegraphKind,
  type PaintedTelegraphLook,
  type TelegraphPaintKind,
  telegraphSeed,
} from './painted_telegraph_core';

/** Each paint's shader source and its define. */
const PAINT_SOURCE: Readonly<Record<TelegraphPaintKind, { frag: string; define: string }>> = {
  bolt: { frag: BREATH_TELEGRAPH_FRAG, define: 'BT_BOLT' },
  charged: { frag: BREATH_TELEGRAPH_FRAG, define: 'BT_CHARGED' },
  wind: { frag: BREATH_TELEGRAPH_FRAG, define: 'BT_WIND' },
  calm: { frag: BREATH_TELEGRAPH_FRAG, define: 'BT_CALM' },
  quake: { frag: COUNCIL_TELEGRAPH_FRAG, define: 'CT_QUAKE' },
  rubble: { frag: COUNCIL_TELEGRAPH_FRAG, define: 'CT_RUBBLE' },
};

/** A dressed fan. */
export interface PaintedFan<K extends string> {
  fan: TelegraphFan | TelegraphLane;
  paint: TelegraphPaintKind;
  /** The look's uniforms (both passes read these objects). */
  look: Record<string, THREE.IUniform<number>>;
  kind: K;
  /** The glow pass's mesh (a child of the fan's floor). */
  glow: THREE.Mesh;
}

class PaintedTelegraphs<K extends string> {
  private dressed = 0;

  constructor(
    private readonly looks: Readonly<Record<K, PaintedTelegraphLook>>,
    private readonly glowStep: number,
    private readonly materials: THREE.Material[],
    private readonly prefix: string,
  ) {}

  /** Dress a pooled fan or lane (already built on its char rung) in `kind`'s
   *  paint. */
  dress(f: TelegraphFan | TelegraphLane, kind: K): PaintedFan<K> {
    const L = this.looks[kind];
    const src = PAINT_SOURCE[L.paint];
    const look: Record<string, THREE.IUniform<number>> = {
      uChar: { value: L.char },
      uBody: { value: L.body },
      uCells: { value: L.cells },
      uCrack: { value: L.crack },
      uRimK: { value: L.rim },
      uSpin: { value: L.spin },
      uFlow: { value: L.flow },
      uSeed: { value: telegraphSeed(this.dressed++) },
      // The live dressing an owner writes a frame (zero: none): the stone's
      // heat (a rock's crescendo, a crater cooling), the rock's shadow (its
      // radius share and its approach).
      uHeat: { value: 0 },
      uShadow: { value: 0 },
      uShadowK: { value: 0 },
    };
    // The kit's own uniform objects (the spread copies the references), so
    // its drape and paint calls drive both passes.
    const uniforms: Record<string, THREE.IUniform> = {
      ...(f.floorMat.uniforms as unknown as Record<string, THREE.IUniform>),
      ...look,
    };
    const common = {
      uniforms,
      vertexShader: BREATH_TELEGRAPH_VERT,
      fragmentShader: src.frag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    };
    const charMat = new THREE.ShaderMaterial({
      ...common,
      name: `${this.prefix}TelegraphChar_${L.paint}`,
      defines: { [src.define]: '', PT_CHAR: '' },
    });
    applyCharBlend(charMat);
    const glowMat = new THREE.ShaderMaterial({
      ...common,
      name: `${this.prefix}TelegraphGlow_${L.paint}`,
      defines: { [src.define]: '' },
      blending: THREE.AdditiveBlending,
    });
    if (L.paint === 'charged') {
      // The charged ground's light takes the brightest of what lies under it
      // (a MAX blend, the program unchanged): patches the storm lays over one
      // another stay one live blue net over their scorch instead of summing
      // into a milky white disc. Its own char pass (a lower rung) has darkened
      // the stone first, so the net still reads at full strength.
      glowMat.blending = THREE.CustomBlending;
      glowMat.blendEquation = THREE.MaxEquation;
      glowMat.blendSrc = THREE.OneFactor;
      glowMat.blendDst = THREE.OneFactor;
    }
    this.materials.push(charMat, glowMat);
    f.floor.material = charMat;
    f.floor.name = `${this.prefix}Telegraph`;
    const glow = new THREE.Mesh(f.floor.geometry, glowMat);
    glow.name = `${this.prefix}TelegraphGlow`;
    glow.frustumCulled = false;
    glow.renderOrder = floorVfxRenderOrder('encounter', this.glowStep);
    f.floor.add(glow);
    if (f.curtain) f.curtain.visible = L.curtain;
    return { fan: f, paint: L.paint, look, kind, glow };
  }

  /** Move a dressed fan to another kind of its own paint (uniforms only; a
   *  kind of another paint keeps the fan's own, never relinks). */
  setLook(d: PaintedFan<K>, kind: K): void {
    if (d.kind === kind) return;
    const L = this.looks[kind];
    if (L.paint !== d.paint) return;
    d.kind = kind;
    d.look.uChar.value = L.char;
    d.look.uBody.value = L.body;
    d.look.uCells.value = L.cells;
    d.look.uCrack.value = L.crack;
    d.look.uRimK.value = L.rim;
    d.look.uSpin.value = L.spin;
    d.look.uFlow.value = L.flow;
    d.look.uHeat.value = 0;
    d.look.uShadow.value = 0;
    d.look.uShadowK.value = 0;
    if (d.fan.curtain) d.fan.curtain.visible = L.curtain;
  }

  /** The live dressing: the stone's `heat` 0..1, the rock's shadow (`share`
   *  of the radius, 0 for none; `near` its approach 0..1). Uniform writes. */
  live(d: PaintedFan<K>, heat: number, share = 0, near = 0): void {
    d.look.uHeat.value = heat;
    d.look.uShadow.value = share;
    d.look.uShadowK.value = near;
  }
}

/** The Breath's storm and wind paints. */
export class BreathTelegraphs extends PaintedTelegraphs<BreathTelegraphKind> {
  constructor(glowStep: number, materials: THREE.Material[]) {
    super(BREATH_TELEGRAPH_LOOKS, glowStep, materials, 'smithHeartBreath');
  }
}

/** The Hammer Council's granite paints. */
export class CouncilTelegraphs extends PaintedTelegraphs<CouncilTelegraphKind> {
  constructor(glowStep: number, materials: THREE.Material[]) {
    super(COUNCIL_TELEGRAPH_LOOKS, glowStep, materials, 'smithHeartCouncil');
  }
}
