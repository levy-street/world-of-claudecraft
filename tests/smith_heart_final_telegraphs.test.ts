// The Masterless Strength's floor telegraphs and sculpted bodies (Jose's
// playtest of 28 Oct 2026: "the fire quarter's floor shapes are much better;
// make the other three AAA too"; the anvil was boxes):
//   - every quarter kit's footprint paints in its own element (the Heat's
//     molten basalt, the Quench's frost, the Breath's storm, the Hammer's
//     granite), each element's floor tint a different hue, the pools big
//     enough for every footprint the kit can show at once;
//   - the dressing builds a char (multiply) and a glow (additive) pass per
//     element on the kit's own rungs, sharing the kit's uniform objects (its
//     drape and fill drive both), each pass compiled for its element, and a
//     look written per assignment;
//   - the element shaders measure exactly the kit's footprint, place every
//     vertex through modelViewMatrix and run their noise on the mark's own
//     yards;
//   - the anvil is carved stone with crystals (an extruded, chamfered
//     profile far richer than a box, a horn longer than its heel), its
//     stone toned per vertex; the shells and the ice are faceted solids;
//   - the switch's shockwave rides out over the Anvil and fades.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TelegraphKit } from '../src/render/floor_telegraph';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer';
import { FINAL_KIT_FLOOR, shockWave } from '../src/render/smith_heart_fx/final_kit_fx_core';
import {
  ORB_FRAG,
  RIM_FRAG,
  SHOCK_FRAG,
  UNBOUND_FRAG,
  WHIRL_VERT,
} from '../src/render/smith_heart_fx/final_kit_glsl';
import {
  ANVIL_CRYSTALS,
  ANVIL_SIZE,
  anvilCrystals,
  anvilStone,
  iceCrust,
  shellStone,
} from '../src/render/smith_heart_fx/final_kit_shapes';
import {
  coldReachFill,
  FINAL_ELEMENT_TINTS,
  FINAL_TELEGRAPH_LOOKS,
  FINAL_TELEGRAPH_POOLS,
  type FinalTelegraphKind,
  finalTelegraphElement,
} from '../src/render/smith_heart_fx/final_telegraph_core';
import { FINAL_TELEGRAPH_FRAG } from '../src/render/smith_heart_fx/final_telegraph_glsl';
import { FinalTelegraphs } from '../src/render/smith_heart_fx/final_telegraphs';
import { FINAL_TUNING as T } from '../src/sim/encounters/smith_heart/final_ids';

describe("the final kits' element telegraphs", () => {
  it('paints each quarter in its own element', () => {
    const want: Record<FinalTelegraphKind, string> = {
      whirl: 'fire',
      pool: 'fire',
      ember: 'fire',
      crack: 'frost',
      cold: 'frost',
      drawn: 'storm',
      bolt: 'storm',
      orb: 'storm',
      tremor: 'stone',
      anvil: 'stone',
      crushed: 'stone',
      // Part 2: each Splinter's frontal in its own element.
      shearFire: 'fire',
      shearFrost: 'frost',
      shearStorm: 'storm',
      shearStone: 'stone',
      coal: 'fire',
      pounce: 'storm',
      buffet: 'storm',
    };
    for (const [k, el] of Object.entries(want))
      expect(finalTelegraphElement(k as FinalTelegraphKind), k).toBe(el);
    // The frost closes in on its break; storm and stone break out.
    expect(FINAL_TELEGRAPH_LOOKS.crack.inward).toBe(1);
    expect(FINAL_TELEGRAPH_LOOKS.tremor.inward).toBe(0);
    expect(FINAL_TELEGRAPH_LOOKS.bolt.inward).toBe(0);
    // A mark riding a body never carries a curtain (it would jitter).
    for (const k of ['whirl', 'ember', 'cold', 'drawn', 'bolt', 'crushed'] as const)
      expect(FINAL_TELEGRAPH_LOOKS[k].curtain, k).toBe(false);
    // Every look is drawn on every tier: a real char and a real line.
    for (const [k, L] of Object.entries(FINAL_TELEGRAPH_LOOKS)) {
      expect(L.char, k).toBeGreaterThan(0.15);
      expect(L.crack, k).toBeGreaterThan(0.5);
      expect(L.rim, k).toBeGreaterThan(0.5);
    }
  });

  it("tints each element's floor a different hue", () => {
    const hue = (c: readonly [number, number, number]) =>
      new THREE.Color(...c).getHSL({ h: 0, s: 0, l: 0 }).h;
    const hs = Object.values(FINAL_ELEMENT_TINTS).map(hue);
    for (let i = 0; i < hs.length; i++)
      for (let j = i + 1; j < hs.length; j++) expect(Math.abs(hs[i] - hs[j])).toBeGreaterThan(0.05);
    // The shader's tints are the core's.
    for (const [, [r, g, b]] of Object.entries(FINAL_ELEMENT_TINTS))
      expect(FINAL_TELEGRAPH_FRAG).toContain(`vec3 tint = vec3(${r}, ${g}, ${b})`);
  });

  it('keeps enough fans per element for every footprint at once', () => {
    // Fire: six whirls, the pool cap, three ember marks.
    expect(FINAL_TELEGRAPH_POOLS.fire).toBeGreaterThanOrEqual(6 + T.poolCap + T.emberMarks);
    // Frost: the cracks and the local player's reach.
    expect(FINAL_TELEGRAPH_POOLS.frost).toBeGreaterThanOrEqual(T.iceMarks * 2 + 1);
    // Storm: the orbs, the drawn marks, the bolt's target.
    expect(FINAL_TELEGRAPH_POOLS.storm).toBeGreaterThanOrEqual(T.orbCount * 2 + T.drawnMarks + 1);
    // Stone: the tremors, the Anvil, the Crushed.
    expect(FINAL_TELEGRAPH_POOLS.stone).toBeGreaterThanOrEqual(4 + 1 + 8);
    expect(coldReachFill(0)).toBe(0);
    expect(coldReachFill(50)).toBeCloseTo(0.5, 9);
    expect(coldReachFill(140)).toBe(1);
  });

  it("dresses a fan's char and glow passes per element on the kit's rungs", () => {
    const root = new THREE.Group();
    const kit = new TelegraphKit(root, true);
    const materials: THREE.Material[] = [];
    const steps = {
      char: FINAL_KIT_FLOOR.telegraphChar,
      glow: FINAL_KIT_FLOOR.telegraphGlow,
      curtain: FINAL_KIT_FLOOR.telegraphCurtain,
    };
    const tele = new FinalTelegraphs(kit, steps, materials);
    for (const [el, define] of [
      ['frost', 'FT_FROST'],
      ['storm', 'FT_STORM'],
      ['stone', 'FT_STONE'],
      ['fire', 'HEAT_CHAR'],
    ] as const) {
      const d = tele.fan(el, steps.char);
      const charMat = d.fan.floor.material as THREE.ShaderMaterial;
      const glow = d.fan.floor.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh;
      const glowMat = glow.material as THREE.ShaderMaterial;
      expect(charMat.blending).toBe(THREE.CustomBlending);
      expect(glowMat.blending).toBe(THREE.AdditiveBlending);
      expect(Object.keys(charMat.defines ?? {})).toContain(define);
      expect(d.fan.floor.renderOrder).toBe(floorVfxRenderOrder('encounter', steps.char));
      expect(glow.renderOrder).toBe(floorVfxRenderOrder('encounter', steps.glow));
      // Both passes read the kit's own fill and the look's own objects.
      expect(charMat.uniforms.uFill).toBe(d.fan.floorMat.uniforms.uFill);
      expect(glowMat.uniforms.uFill).toBe(d.fan.floorMat.uniforms.uFill);
      expect(glowMat.uniforms.uChar).toBe(charMat.uniforms.uChar);
      const kind =
        el === 'fire' ? 'pool' : el === 'frost' ? 'crack' : el === 'storm' ? 'orb' : 'anvil';
      tele.setLook(d, kind);
      expect(charMat.uniforms.uChar.value).toBe(FINAL_TELEGRAPH_LOOKS[kind].char);
      expect(glowMat.uniforms.uCells.value).toBe(FINAL_TELEGRAPH_LOOKS[kind].cells);
    }
    expect(materials.length).toBe(8);
    kit.dispose();
    for (const m of materials) m.dispose();
  });

  it('measures the kit footprint, places through modelViewMatrix, noises on the mark yards', () => {
    for (const src of [FINAL_TELEGRAPH_FRAG]) {
      expect(src).toContain('edge = min((1.0 - r) * uRange, flank)');
      expect(src).toContain('vP');
      expect(src).not.toMatch(/gl_FragCoord|cameraPosition/);
    }
    for (const v of [WHIRL_VERT]) {
      expect(v).toContain('modelViewMatrix');
      expect(v).not.toMatch(/viewMatrix \*/);
    }
    for (const f of [ORB_FRAG, RIM_FRAG, SHOCK_FRAG, UNBOUND_FRAG])
      expect(f).toContain('gl_FragColor');
  });
});

describe("the final kits' sculpted bodies", () => {
  it('carves the anvil from stone with a long horn and crystals, never a box', () => {
    const stone = anvilStone();
    stone.computeBoundingBox();
    const bb = stone.boundingBox as THREE.Box3;
    // A box has 24 vertices; the carved block has hundreds.
    expect(stone.getAttribute('position').count).toBeGreaterThan(400);
    expect(stone.getAttribute('color')).toBeDefined();
    expect(bb.max.y).toBeCloseTo(ANVIL_SIZE.height + 0, 0);
    expect(bb.min.y).toBeCloseTo(0, 1);
    // The horn reaches further from the middle than the heel.
    expect(bb.max.x).toBeGreaterThan(-bb.min.x);
    expect(bb.max.x - bb.min.x).toBeGreaterThan(ANVIL_SIZE.length - 0.5);
    const crystals = anvilCrystals();
    expect(crystals.getAttribute('position').count).toBe(ANVIL_CRYSTALS.length * 24);
    // The stone is toned: the feet darker than the face.
    const pos = stone.getAttribute('position');
    const col = stone.getAttribute('color');
    let low = 0;
    let lowN = 0;
    let high = 0;
    let highN = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 1) {
        low += col.getX(i);
        lowN++;
      } else if (pos.getY(i) > ANVIL_SIZE.height - 0.3) {
        high += col.getX(i);
        highN++;
      }
    }
    expect(high / highN).toBeGreaterThan(low / lowN);
    for (const g of [stone, crystals]) g.dispose();
  });

  it('builds the shell and the ice as faceted solids round a body', () => {
    const shell = shellStone();
    shell.computeBoundingBox();
    expect((shell.boundingBox as THREE.Box3).min.y).toBeGreaterThan(-0.4);
    expect((shell.boundingBox as THREE.Box3).max.y).toBeGreaterThan(2.2);
    const ice = iceCrust();
    expect(ice.getAttribute('position').count).toBe(5 * 24);
    for (const g of [shell, ice]) g.dispose();
  });

  it("rides the switch's shockwave out over the Anvil and fades it", () => {
    expect(shockWave(-1).alpha).toBe(0);
    let last = shockWave(0);
    expect(last.alpha).toBeCloseTo(1, 5);
    for (let t = 0.1; t < 1.5; t += 0.1) {
      const w = shockWave(t);
      expect(w.front).toBeGreaterThan(last.front);
      expect(w.alpha).toBeLessThan(last.alpha);
      last = w;
    }
    expect(last.front).toBeGreaterThan(80);
    expect(shockWave(1.6).alpha).toBe(0);
  });
});
