// The Guardian of the Heat's molten telegraphs: the shared floor telegraph's
// pooled fans and lanes (../floor_telegraph), dressed in the Hearth's paint
// (heat_telegraph_glsl.ts, heat_telegraph_core.ts).
//
// The kit keeps everything a player reads the timing and the shape off: it
// drapes the footprint on the real floor at the sim's exact radius, length
// and width, and its paint call writes the fill (the sim's bar), the front,
// the warning and the fade into its footprint's uniforms. Dressing swaps the
// footprint's paint only: its mesh draws the CHAR pass (a multiply) on this
// owner's char rung, a child mesh on the same draped geometry draws the GLOW
// pass (additive) on its glow rung, both reading the kit's own uniform
// objects (so every paint call reaches them), and the kit's cosmetic curtain
// moves to the owner's curtain rung (heat_floor_ladder_core.ts). The
// footprint draws on every tier; the flow, the fine cracks, the embers and
// the curtain shed on the low tier, as the kit's own layers do.
//
// Built in the owner's constructor under its gated root (both programs link
// at the gate); the materials go to the owner's list for its dispose (the
// kit's own, now undrawn, footprint materials stay the kit's to dispose).

import * as THREE from 'three';
import type { TelegraphFan, TelegraphKit, TelegraphLane } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { applyCharBlend } from './heat_molten_decal';
import { HEAT_TELEGRAPH_LOOKS, type HeatTelegraphKind } from './heat_telegraph_core';
import { HEAT_TELEGRAPH_FRAG, HEAT_TELEGRAPH_VERT } from './heat_telegraph_glsl';

/** How many yards of a dressed lane, from its start, a wave has already
 *  rolled past (its warning clears there; 0 shows the whole lane). */
export function setLaneSpent(lane: TelegraphLane, yards: number): void {
  const u = (lane.floor.material as THREE.ShaderMaterial).uniforms?.uSpent;
  if (u) u.value = yards;
}

/** An owner's three telegraph rungs (encounter steps). */
export interface HeatTelegraphSteps {
  char: number;
  glow: number;
  curtain: number;
}

export class HeatTelegraphs {
  constructor(
    private readonly kit: TelegraphKit,
    private readonly steps: HeatTelegraphSteps,
    private readonly materials: THREE.Material[],
  ) {}

  /** A pooled fan (a disc or a ring at 360) in the kind's molten paint. */
  fan(kind: HeatTelegraphKind): TelegraphFan {
    const f = this.kit.fan(0);
    this.dress(f.floor, f.floorMat.uniforms, f.curtain, kind);
    return f;
  }

  /** A pooled lane in the kind's molten paint. */
  lane(kind: HeatTelegraphKind): TelegraphLane {
    const l = this.kit.lane(0);
    this.dress(l.floor, l.floorMat.uniforms, l.curtain, kind);
    return l;
  }

  private dress(
    floor: THREE.Mesh,
    kitUniforms: object,
    curtain: THREE.Mesh | null,
    kind: HeatTelegraphKind,
  ): void {
    const L = HEAT_TELEGRAPH_LOOKS[kind];
    // The kit's own uniform objects (the spread copies the references), so
    // its drape and paint calls drive both passes.
    const uniforms: Record<string, THREE.IUniform> = {
      ...(kitUniforms as Record<string, THREE.IUniform>),
      uChar: { value: L.char },
      uBody: { value: L.body },
      uFalloff: { value: L.falloff },
      uCells: { value: L.cells },
      uCrack: { value: L.crack },
      uRimK: { value: L.rim },
      uSpent: { value: 0 },
    };
    const common = {
      uniforms,
      vertexShader: HEAT_TELEGRAPH_VERT,
      fragmentShader: HEAT_TELEGRAPH_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    };
    const charMat = new THREE.ShaderMaterial({
      ...common,
      name: 'smithHeartHeatTelegraphChar',
      defines: { HEAT_CHAR: '' },
    });
    applyCharBlend(charMat);
    const glowMat = new THREE.ShaderMaterial({
      ...common,
      name: 'smithHeartHeatTelegraphGlow',
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(charMat, glowMat);
    floor.material = charMat;
    floor.name = 'smithHeartHeatTelegraph';
    floor.renderOrder = floorVfxRenderOrder('encounter', this.steps.char);
    const glow = new THREE.Mesh(floor.geometry, glowMat);
    glow.name = 'smithHeartHeatTelegraphGlow';
    glow.frustumCulled = false;
    glow.renderOrder = floorVfxRenderOrder('encounter', this.steps.glow);
    floor.add(glow);
    if (curtain) {
      curtain.renderOrder = floorVfxRenderOrder('encounter', this.steps.curtain);
      // Cosmetic only: the kinds whose curtain reads as noise go without.
      curtain.visible = L.curtain;
    }
  }
}
