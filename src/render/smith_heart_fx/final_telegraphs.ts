// The Masterless Strength's element telegraphs: the shared floor
// telegraph's pooled fans (../floor_telegraph) dressed in each quarter's
// paint (final_telegraph_core.ts): the Heat's molten basalt
// (heat_telegraph_glsl.ts), the Quench's frost, the Breath's storm and the
// Hammer's granite (final_telegraph_glsl.ts).
//
// As in heat_telegraph.ts, the kit keeps everything a player reads the
// timing and the shape off (the drape at the sim's exact radius, the fill,
// the front, the warning, the fade); the dressing swaps the paint only: the
// fan's mesh draws the CHAR pass (a multiply) on the owner's char rung, a
// child mesh on the same draped geometry draws the GLOW pass (additive) on
// its glow rung, both reading the kit's own uniform objects, and the kit's
// cosmetic curtain moves to the owner's curtain rung. One pool of fans per
// element; a fan takes its kind's look when the painter assigns it
// (`setLook` writes the look's uniforms, shared by both passes).
//
// Built in the owner's constructor under its gated root (every program links
// at the gate); the materials go to the owner's list for its dispose.

import * as THREE from 'three';
import type { TelegraphFan, TelegraphKit } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  FINAL_TELEGRAPH_LOOKS,
  type FinalElement,
  type FinalTelegraphKind,
} from './final_telegraph_core';
import { FINAL_TELEGRAPH_FRAG, FINAL_TELEGRAPH_VERT } from './final_telegraph_glsl';
import { applyCharBlend } from './heat_molten_decal';
import { HEAT_TELEGRAPH_FRAG, HEAT_TELEGRAPH_VERT } from './heat_telegraph_glsl';

/** The owner's three telegraph rungs (encounter steps). */
export interface FinalTelegraphSteps {
  char: number;
  glow: number;
  curtain: number;
}

/** A dressed fan of one element. */
export interface FinalTelegraphFan {
  fan: TelegraphFan;
  element: FinalElement;
  /** The look's uniforms (both passes read these objects). */
  look: Record<string, THREE.IUniform<number>>;
  kind: FinalTelegraphKind | null;
}

const ELEMENT_DEFINE: Readonly<Record<Exclude<FinalElement, 'fire'>, string>> = {
  frost: 'FT_FROST',
  storm: 'FT_STORM',
  stone: 'FT_STONE',
};

export class FinalTelegraphs {
  constructor(
    private readonly kit: TelegraphKit,
    private readonly steps: FinalTelegraphSteps,
    private readonly materials: THREE.Material[],
  ) {}

  /** A pooled fan (a ring at 360) in `element`'s paint. */
  fan(element: FinalElement, rung: number): FinalTelegraphFan {
    const f = this.kit.fan(rung);
    const look: Record<string, THREE.IUniform<number>> = {
      uChar: { value: 0.5 },
      uBody: { value: 1 },
      uFalloff: { value: 0 },
      uCells: { value: 0.5 },
      uCrack: { value: 1 },
      uRimK: { value: 1 },
      uInward: { value: 0 },
      // The Heat paint's spent-lane clip (a fan never clips).
      uSpent: { value: 0 },
    };
    // The kit's own uniform objects (the spread copies the references), so
    // its drape and paint calls drive both passes.
    const uniforms: Record<string, THREE.IUniform> = {
      ...(f.floorMat.uniforms as Record<string, THREE.IUniform>),
      ...look,
    };
    const fire = element === 'fire';
    const common = {
      uniforms,
      vertexShader: fire ? HEAT_TELEGRAPH_VERT : FINAL_TELEGRAPH_VERT,
      fragmentShader: fire ? HEAT_TELEGRAPH_FRAG : FINAL_TELEGRAPH_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    };
    const own: Record<string, string> = fire ? {} : { [ELEMENT_DEFINE[element]]: '' };
    const charMat = new THREE.ShaderMaterial({
      ...common,
      name: `smithHeartFinalTelegraphChar_${element}`,
      defines: { ...own, [fire ? 'HEAT_CHAR' : 'FT_CHAR']: '' },
    });
    applyCharBlend(charMat);
    const glowMat = new THREE.ShaderMaterial({
      ...common,
      name: `smithHeartFinalTelegraphGlow_${element}`,
      defines: own,
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(charMat, glowMat);
    f.floor.material = charMat;
    f.floor.name = 'smithHeartFinalTelegraph';
    f.floor.renderOrder = floorVfxRenderOrder('encounter', this.steps.char);
    const glow = new THREE.Mesh(f.floor.geometry, glowMat);
    glow.name = 'smithHeartFinalTelegraphGlow';
    glow.frustumCulled = false;
    glow.renderOrder = floorVfxRenderOrder('encounter', this.steps.glow);
    f.floor.add(glow);
    if (f.curtain) f.curtain.renderOrder = floorVfxRenderOrder('encounter', this.steps.curtain);
    return { fan: f, element, look, kind: null };
  }

  /** Give a dressed fan its kind's look (no allocation). */
  setLook(d: FinalTelegraphFan, kind: FinalTelegraphKind): void {
    if (d.kind === kind) return;
    const L = FINAL_TELEGRAPH_LOOKS[kind];
    d.kind = kind;
    d.look.uChar.value = L.char;
    d.look.uBody.value = L.body;
    d.look.uFalloff.value = L.falloff;
    d.look.uCells.value = L.cells;
    d.look.uCrack.value = L.crack;
    d.look.uRimK.value = L.rim;
    d.look.uInward.value = L.inward;
    if (d.fan.curtain) d.fan.curtain.visible = L.curtain;
  }
}
