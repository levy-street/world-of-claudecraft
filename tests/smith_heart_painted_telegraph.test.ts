// The Guardian of the Breath's and the Hammer Council's painted floor
// warnings (painted_telegraph_core.ts, painted_telegraphs.ts): every
// footprint wears its element's paint over the shared kit's exact shape and
// timing, the threat colour stays on the edge, the paint's program is fixed at
// the build (a look change is uniforms only), and each owner's glow pass sits
// over every one of its char rungs.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TelegraphKit } from '../src/render/floor_telegraph';
import { TELEGRAPH_THREAT_COLORS } from '../src/render/floor_telegraph/telegraph_look_core';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer_core';
import { BREATH_TELEGRAPH_FRAG } from '../src/render/smith_heart_fx/breath_telegraph_glsl';
import { COUNCIL_TELEGRAPH_FRAG } from '../src/render/smith_heart_fx/council_telegraph_glsl';
import {
  BOLT_RESTRIKE_HZ,
  BREATH_GUST_GLOW_STEP,
  BREATH_TELEGRAPH_GLOW_STEP,
  BREATH_TELEGRAPH_LOOKS,
  type BreathTelegraphKind,
  boltFlare,
  boltReach,
  COUNCIL_TELEGRAPH_GLOW_STEP,
  COUNCIL_TELEGRAPH_LOOKS,
  type CouncilTelegraphKind,
  craterFade,
  ROCK_CRATER,
  telegraphSeed,
} from '../src/render/smith_heart_fx/painted_telegraph_core';
import {
  BreathTelegraphs,
  CouncilTelegraphs,
} from '../src/render/smith_heart_fx/painted_telegraphs';

describe('the painted telegraphs: which paint each footprint wears', () => {
  it('lightning for the strikes and the storm bars, arcs for the charged ground', () => {
    const bolt: BreathTelegraphKind[] = [
      'strike',
      'drawnStrike',
      'drawnBar',
      'drawnMark',
      'fork',
      'lance',
      'cradle',
    ];
    for (const k of bolt) expect(BREATH_TELEGRAPH_LOOKS[k].paint).toBe('bolt');
    expect(BREATH_TELEGRAPH_LOOKS.charged.paint).toBe('charged');
  });

  it('wind for the vortex, the gales, the pinned and the exhale; the vortex pulls in', () => {
    for (const k of ['vortex', 'gale', 'pinned', 'gust'] as const)
      expect(BREATH_TELEGRAPH_LOOKS[k].paint).toBe('wind');
    expect(BREATH_TELEGRAPH_LOOKS.vortex.flow).toBeLessThan(0);
    expect(BREATH_TELEGRAPH_LOOKS.gust.flow).toBeGreaterThan(0);
    expect(BREATH_TELEGRAPH_LOOKS.gale.spin).not.toBe(0);
  });

  it("Thessaly's circle and the anchored stay friendly (the calm, never a storm paint)", () => {
    expect(BREATH_TELEGRAPH_LOOKS.calm.paint).toBe('calm');
    expect(BREATH_TELEGRAPH_LOOKS.anchor.paint).toBe('calm');
    expect(BREATH_FRAG_CALM_HAS_NO_FLICKER()).toBe(true);
  });

  it('stone for every council footprint: split stone, rubble for a fallen pillar', () => {
    const quake: CouncilTelegraphKind[] = [
      'wake',
      'rock',
      'rise',
      'echo',
      'slabGrind',
      'slabCrush',
      'song',
      'crater',
    ];
    for (const k of quake) expect(COUNCIL_TELEGRAPH_LOOKS[k].paint).toBe('quake');
    expect(COUNCIL_TELEGRAPH_LOOKS.rubble.paint).toBe('rubble');
  });

  it('every look keeps a full edge (the danger area is always readable)', () => {
    for (const L of [
      ...Object.values(BREATH_TELEGRAPH_LOOKS),
      ...Object.values(COUNCIL_TELEGRAPH_LOOKS),
    ]) {
      expect(L.rim).toBeGreaterThanOrEqual(0.85);
      expect(L.crack).toBeGreaterThan(0);
      expect(L.char).toBeLessThanOrEqual(0.7);
    }
  });
});

/** The calm's arm of the Breath shader carries no flicker term. */
function BREATH_FRAG_CALM_HAS_NO_FLICKER(): boolean {
  const calm = BREATH_TELEGRAPH_FRAG.split('#else\n  // The calm: still air.')[1]?.split(
    '#endif',
  )[0];
  return calm !== undefined && /float flick = 1\.0;/.test(calm) && !/hh2\(vec2\(st/.test(calm);
}

describe("the Falling Rock's crater", () => {
  it('holds, then fades out smoothly and is gone by its seconds', () => {
    expect(craterFade(-0.1)).toBe(0);
    expect(craterFade(0)).toBe(1);
    expect(craterFade(ROCK_CRATER.seconds * 0.4)).toBe(1);
    const mid = craterFade(ROCK_CRATER.seconds * 0.75);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(craterFade(ROCK_CRATER.seconds)).toBe(0);
  });

  it('is cosmetic: smaller than the soak and its edge no threat colour', () => {
    expect(ROCK_CRATER.share).toBeLessThan(1);
    for (const c of Object.values(TELEGRAPH_THREAT_COLORS)) expect(ROCK_CRATER.color).not.toBe(c);
  });
});

describe('the lightning: reach and flare', () => {
  it('the forks race out with the bar and stay inside the edge', () => {
    let last = -1;
    for (let f = 0; f <= 1.0001; f += 0.05) {
      const r = boltReach(f);
      expect(r).toBeGreaterThan(last);
      expect(r).toBeLessThan(1);
      last = r;
    }
    expect(boltReach(-1)).toBe(boltReach(0));
    expect(boltReach(2)).toBe(boltReach(1));
  });

  it('the white flare is the last stretch only and full at the landing', () => {
    expect(boltFlare(0)).toBe(0);
    expect(boltFlare(0.86)).toBe(0);
    expect(boltFlare(0.93)).toBeGreaterThan(0);
    expect(boltFlare(1)).toBe(1);
  });

  it('the shader mirrors the core (reach, flare, restrike rate)', () => {
    expect(BREATH_TELEGRAPH_FRAG).toContain('(0.45 + 0.51 * clamp(uFill, 0.0, 1.0))');
    expect(BREATH_TELEGRAPH_FRAG).toContain('uFill > 0.86 ? pow((uFill - 0.86) / 0.14, 2.0)');
    expect(BREATH_TELEGRAPH_FRAG).toContain(`uTime * ${BOLT_RESTRIKE_HZ.toFixed(1)}`);
  });

  it('two fans never share a seed', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 64; i++) seen.add(Math.round(telegraphSeed(i) * 1000));
    expect(seen.size).toBe(64);
  });
});

describe('the dressing', () => {
  const dressOne = (paint: 'breath' | 'council') => {
    const root = new THREE.Group();
    const kit = new TelegraphKit(root, true);
    const materials: THREE.Material[] = [];
    const fan = kit.fan(12);
    return { kit, fan, materials, root, paint };
  };

  it('a fan draws its char (a multiply) on its rung and its glow (additive) on the owner glow rung, off the kit uniforms', () => {
    const { kit, fan, materials } = dressOne('breath');
    const paints = new BreathTelegraphs(BREATH_TELEGRAPH_GLOW_STEP, materials);
    const d = paints.dress(fan, 'strike');
    expect(materials).toHaveLength(2);
    const char = fan.floor.material as THREE.ShaderMaterial;
    const glow = d.glow.material as THREE.ShaderMaterial;
    expect(char.blending).toBe(THREE.CustomBlending);
    expect(char.blendSrc).toBe(THREE.DstColorFactor);
    expect(char.blendDst).toBe(THREE.ZeroFactor);
    expect(glow.blending).toBe(THREE.AdditiveBlending);
    expect(char.defines).toMatchObject({ BT_BOLT: '', PT_CHAR: '' });
    expect(glow.defines).toMatchObject({ BT_BOLT: '' });
    expect(fan.floor.renderOrder).toBe(floorVfxRenderOrder('encounter', 12));
    expect(d.glow.renderOrder).toBe(floorVfxRenderOrder('encounter', BREATH_TELEGRAPH_GLOW_STEP));
    expect(d.glow.geometry).toBe(fan.floor.geometry);
    // The kit's paint call reaches both passes (the same uniform objects).
    kit.layOutFan(fan, 360, { color: 0xff6a2a });
    kit.paintFan(fan, { fill: 0.4, clock: 1, range: 3.5 });
    expect(char.uniforms.uFill.value).toBe(0.4);
    expect(glow.uniforms.uFill).toBe(char.uniforms.uFill);
    expect(glow.uniforms.uRange.value).toBe(3.5);
  });

  it('a look change inside the paint is uniforms only; another paint never relinks', () => {
    const { fan, materials } = dressOne('breath');
    const paints = new BreathTelegraphs(BREATH_TELEGRAPH_GLOW_STEP, materials);
    const d = paints.dress(fan, 'fork');
    const char = fan.floor.material as THREE.ShaderMaterial;
    const defines = { ...char.defines };
    paints.setLook(d, 'cradle');
    expect(d.kind).toBe('cradle');
    expect(d.look.uChar.value).toBe(BREATH_TELEGRAPH_LOOKS.cradle.char);
    paints.setLook(d, 'vortex');
    expect(d.kind).toBe('cradle');
    expect(fan.floor.material).toBe(char);
    expect(char.defines).toEqual(defines);
  });

  it('the council paints split stone and rubble', () => {
    const { fan, materials } = dressOne('council');
    const paints = new CouncilTelegraphs(COUNCIL_TELEGRAPH_GLOW_STEP, materials);
    const d = paints.dress(fan, 'rubble');
    expect((fan.floor.material as THREE.ShaderMaterial).defines).toMatchObject({ CT_RUBBLE: '' });
    expect(d.glow.renderOrder).toBe(floorVfxRenderOrder('encounter', COUNCIL_TELEGRAPH_GLOW_STEP));
    expect(COUNCIL_TELEGRAPH_FRAG).toContain('#if defined(CT_QUAKE)');
  });

  it("each owner's glow rung sits over its char rungs and never ties a normal-blended mark", () => {
    // BreathFightFx's fans: calm 6, charged 8, cradle 9, vortex and gales 10,
    // the bar 11, strikes 12, marks 13; BreathFx's exhale ring 10.
    expect(BREATH_TELEGRAPH_GLOW_STEP).toBeGreaterThan(13);
    expect(BREATH_GUST_GLOW_STEP).toBeGreaterThan(13);
    // CouncilFx's rubble 12, marks and spots 14, the souls' outer ring 16; the
    // slab's gouges (19, normal blend) stay off it.
    expect(COUNCIL_TELEGRAPH_GLOW_STEP).toBeGreaterThan(16);
    expect(COUNCIL_TELEGRAPH_GLOW_STEP).not.toBe(19);
  });
});
