// The Guardian of the Heat's floor marks: one ladder with a unique rung per
// layer (heat_floor_ladder_core.ts), pools that blend commutatively
// (heat_molten_decal.ts, heat_telegraph.ts), and the molten paint over the
// shared floor telegraph's footprint (heat_telegraph_core.ts). A tie between
// two transparent, depth-write-off floor marks sorts by the camera and
// flickers as it orbits; these pins hold that no Heat floor mark can tie with
// a mark it does not commute with, from the table down to the built roots.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TelegraphKit } from '../src/render/floor_telegraph';
import {
  FLOOR_VFX_LAYER_SPAN,
  floorVfxLayerOf,
  floorVfxRenderOrder,
} from '../src/render/floor_vfx_layer_core';
import { HeatBody, HeatFightFx, HeatFx } from '../src/render/smith_heart_fx';
import {
  HEAT_FLOOR,
  type HeatFloorRung,
  heatFloorFaults,
  heatFloorStep,
  heatParticleSteps,
} from '../src/render/smith_heart_fx/heat_floor_ladder_core';
import {
  applyCharBlend,
  moltenDecal,
  withCharTail,
} from '../src/render/smith_heart_fx/heat_molten_decal';
import { HeatTelegraphs } from '../src/render/smith_heart_fx/heat_telegraph';
import {
  HEAT_TELEGRAPH_LOOKS,
  type HeatTelegraphKind,
  heatTelegraphChar,
  heatTelegraphLanded,
} from '../src/render/smith_heart_fx/heat_telegraph_core';
import {
  HEAT_TELEGRAPH_FRAG,
  HEAT_TELEGRAPH_VERT,
} from '../src/render/smith_heart_fx/heat_telegraph_glsl';
import { ENGINE_PARTICLE_STEPS } from '../src/render/trash_engine_fx/engine_particles';

const ROOT = join(__dirname, '..');

type Blend = 'normal' | 'additive' | 'multiply' | 'other';

function blendOf(m: THREE.Material): Blend {
  if (m.blending === THREE.AdditiveBlending) return 'additive';
  if (m.blending === THREE.NormalBlending) return 'normal';
  if (
    m.blending === THREE.CustomBlending &&
    m.blendSrc === THREE.DstColorFactor &&
    m.blendDst === THREE.ZeroFactor
  )
    return 'multiply';
  return 'other';
}

interface Drawn {
  root: string;
  name: string;
  order: number;
  blend: Blend;
}

/** Every transparent renderable a root draws on the encounter band. */
function encounterDraws(root: THREE.Object3D): Drawn[] {
  const out: Drawn[] = [];
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m || Array.isArray(m) || !m.transparent) return;
    if (floorVfxLayerOf(o.renderOrder) !== 'encounter') return;
    out.push({ root: root.name, name: o.name, order: o.renderOrder, blend: blendOf(m) });
  });
  return out;
}

function buildHeatRoots(): THREE.Object3D[] {
  const scene = new THREE.Scene();
  const fx = new HeatFx(scene, () => 0);
  const fight = new HeatFightFx(scene, () => 0);
  const body = new HeatBody(scene, () => 0);
  const names = ['smith-heart-heat-fx', 'smith-heart-heat-fight-fx', 'smith-heart-heat-body'];
  const roots = names.map((n) => scene.getObjectByName(n));
  expect(roots.every(Boolean)).toBe(true);
  void fx;
  void fight;
  void body;
  return roots as THREE.Object3D[];
}

describe('heat_floor_ladder_core: one untied rung per Heat floor layer', () => {
  it('has no fault: no tie, nothing off the band or on its top rung, no pooled normal blend', () => {
    expect(heatFloorFaults()).toEqual([]);
    const steps = Object.values(HEAT_FLOOR).map((r) => r.step);
    expect(new Set(steps).size).toBe(steps.length);
    for (const s of steps) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(FLOOR_VFX_LAYER_SPAN.encounter - 1);
      expect(floorVfxLayerOf(floorVfxRenderOrder('encounter', s))).toBe('encounter');
    }
  });

  it('finds a tie, a step off the band, the top rung and a pooled normal blend', () => {
    const r = (step: number, blend: HeatFloorRung['blend'], pooled: boolean): HeatFloorRung => ({
      step,
      owner: 'heat_fx',
      blend,
      pooled,
    });
    const top = FLOOR_VFX_LAYER_SPAN.encounter - 1;
    const faults = heatFloorFaults({
      a: r(3, 'additive', true),
      b: r(3, 'multiply', true),
      c: r(top, 'additive', false),
      d: r(-1, 'additive', false),
      e: r(5, 'normal', true),
    });
    expect(faults.some((f) => f.startsWith('b ties a on step 3'))).toBe(true);
    expect(faults.some((f) => f.startsWith(`c sits off`))).toBe(true);
    expect(faults.some((f) => f.startsWith('d sits off'))).toBe(true);
    expect(faults).toContain('e pools a normal blend');
  });

  it('stacks the groups bottom to top: lasting scorch, molten chars, molten glows, warnings, particles', () => {
    const s = heatFloorStep;
    const scorch = [s('cinderTrack'), s('patches')];
    const moltenChar = [s('craterChar'), s('wakeChar'), s('riverChar'), s('zoneChar')];
    const moltenGlow = [s('craterGlow'), s('wakeGlow'), s('riverGlow'), s('zoneGlow')];
    const warnChar = [s('fistTelegraphChar'), s('fightTelegraphChar')];
    const warnGlow = [s('fistTelegraphGlow'), s('fightTelegraphGlow')];
    const curtains = [s('fistTelegraphCurtain'), s('fightTelegraphCurtain')];
    const particles = [
      s('fistSmoke'),
      s('fightSmoke'),
      s('bodySmoke'),
      s('fistSparks'),
      s('fightSparks'),
      s('bodySparks'),
    ];
    const groups = [scorch, moltenChar, moltenGlow, warnChar, warnGlow, curtains, particles];
    for (let i = 0; i + 1 < groups.length; i++)
      expect(Math.max(...groups[i])).toBeLessThan(Math.min(...groups[i + 1]));
    expect(s('wellPool')).toBeLessThan(Math.min(...scorch));
    // The wellspring's shimmer stands in the air over everything on the floor.
    expect(s('wellShimmer')).toBeGreaterThan(Math.max(...particles));
    expect(HEAT_FLOOR.wellShimmer).toMatchObject({ blend: 'additive', pooled: false });
    // Every multiply under every glow of its group (the chars commute, then the sums).
    for (const r of Object.values(HEAT_FLOOR))
      if (r.blend === 'multiply') expect(r.pooled).toBe(true);
  });

  it("gives each particle owner its own smoke rung and one additive rung, off the engines' defaults", () => {
    const owners = ['heat_fx', 'heat_fight_fx', 'heat_body'] as const;
    const smokes = owners.map((o) => heatParticleSteps(o).smoke);
    const sparks = owners.map((o) => heatParticleSteps(o).glow);
    expect(new Set([...smokes, ...sparks]).size).toBe(6);
    for (const o of owners) {
      const p = heatParticleSteps(o);
      expect(p.ring).toBe(p.glow);
      expect(p.fire).toBe(p.glow);
    }
    // The engines' own default steps (4, 6, 7, 8) are Heat rungs of other
    // layers: an owner left on them would tie the fight's floor marks.
    const defaults = Object.values(ENGINE_PARTICLE_STEPS);
    expect(defaults.some((d) => smokes.includes(d) || sparks.includes(d))).toBe(false);
  });
});

describe('the built Heat roots: no camera-sorted tie on the encounter band', () => {
  const roots = buildHeatRoots();
  const draws = roots.flatMap(encounterDraws);
  const byStep = new Map<number, HeatFloorRung>(
    Object.values(HEAT_FLOOR).map((r) => [floorVfxRenderOrder('encounter', r.step), r]),
  );

  it('draws only on the ladder rungs, each with the blend the ladder names', () => {
    expect(draws.length).toBeGreaterThan(40);
    const wrong = draws.filter((d) => {
      const r = byStep.get(d.order);
      return !r || (r.blend !== 'opaque' && r.blend !== d.blend);
    });
    expect(wrong.map((d) => `${d.root}/${d.name}@${d.order}:${d.blend}`)).toEqual([]);
  });

  it('never shares a rung between two roots', () => {
    const owner = new Map<number, string>();
    const clashes: string[] = [];
    for (const d of draws) {
      const o = owner.get(d.order);
      if (o && o !== d.root) clashes.push(`${d.order}: ${o} and ${d.root}`);
      owner.set(d.order, d.root);
    }
    expect(clashes).toEqual([]);
  });

  it('shares a rung inside a root only between pieces that commute (all additive or all multiply)', () => {
    const groups = new Map<number, Drawn[]>();
    for (const d of draws) groups.set(d.order, [...(groups.get(d.order) ?? []), d]);
    const bad: string[] = [];
    for (const [order, g] of groups) {
      if (g.length < 2) continue;
      const blends = new Set(g.map((d) => d.blend));
      const commutes = blends.size === 1 && (blends.has('additive') || blends.has('multiply'));
      if (!commutes) bad.push(`${order}: ${g.map((d) => `${d.name}:${d.blend}`).join(', ')}`);
    }
    expect(bad).toEqual([]);
  });

  it('draws every Heat warning in the molten paint, the flat kit footprint never', () => {
    const fight = roots[1];
    const fx = roots[0];
    let dressed = 0;
    for (const root of [fx, fight])
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m && !Array.isArray(m) && /^floorTelegraph(Fan|Lane)$/.test(m.name))
          throw new Error(`${root.name}: a flat kit footprint is drawn (${o.name})`);
        if (o.name !== 'smithHeartHeatTelegraph') return;
        dressed++;
        expect(blendOf(m as THREE.Material)).toBe('multiply');
        const glow = o.children.find((c) => c.name === 'smithHeartHeatTelegraphGlow') as
          | THREE.Mesh
          | undefined;
        expect(glow).toBeDefined();
        expect(blendOf(glow?.material as THREE.Material)).toBe('additive');
        expect(glow?.geometry).toBe((o as THREE.Mesh).geometry);
      });
    // Two fists and six lanes; six river lanes, six falls, six cinders'
    // reaches, twelve hunted rings (the seeds draw as one field, below).
    expect(dressed).toBe(2 + 6 + 6 + 6 + 6 + 12);
  });

  it("draws every seed's footprint as ONE field on the fight's warning rungs, char then glow", () => {
    const fight = roots[1];
    const fields: THREE.Mesh[] = [];
    fight.traverse((o) => {
      if (o.name === 'smithHeartHeatSeedField') fields.push(o as THREE.Mesh);
    });
    expect(fields).toHaveLength(1);
    const field = fields[0];
    expect(blendOf(field.material as THREE.Material)).toBe('multiply');
    expect(field.renderOrder).toBe(
      floorVfxRenderOrder('encounter', HEAT_FLOOR.fightTelegraphChar.step),
    );
    const glow = field.children.find((c) => c.name === 'smithHeartHeatSeedFieldGlow') as THREE.Mesh;
    expect(blendOf(glow.material as THREE.Material)).toBe('additive');
    expect(glow.geometry).toBe(field.geometry);
    expect(glow.renderOrder).toBe(
      floorVfxRenderOrder('encounter', HEAT_FLOOR.fightTelegraphGlow.step),
    );
    // No seed draws a footprint of its own any more.
    let seedFans = 0;
    fight.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (m?.uniforms?.uChar?.value === HEAT_TELEGRAPH_LOOKS.seedReach.char) seedFans++;
    });
    expect(seedFans).toBe(0);
  });
});

describe('heat_molten_decal: a normal blend split into a char and a glow', () => {
  it('splices the char tail before the closing brace, and refuses a body-less shader', () => {
    const frag = 'void main() {\n  gl_FragColor = vec4(1.0, 0.5, 0.2, 0.4);\n}\n';
    const out = withCharTail(frag);
    expect(out.indexOf('#ifdef HEAT_CHAR')).toBeGreaterThan(out.indexOf('gl_FragColor = vec4(1.0'));
    expect(out).toContain('gl_FragColor = vec4(vec3(1.0 - clamp(gl_FragColor.a, 0.0, 1.0)), 1.0);');
    expect(out.trimEnd().endsWith('}')).toBe(true);
    expect(() => withCharTail('no body')).toThrow();
  });

  it('multiplies the floor in the char (its alpha kept) and sums in the glow', () => {
    const m = new THREE.ShaderMaterial();
    applyCharBlend(m);
    expect(m.blending).toBe(THREE.CustomBlending);
    expect(m.blendSrc).toBe(THREE.DstColorFactor);
    expect(m.blendDst).toBe(THREE.ZeroFactor);
    expect(m.blendSrcAlpha).toBe(THREE.ZeroFactor);
    expect(m.blendDstAlpha).toBe(THREE.OneFactor);
    // dst * (1 - a) + col * a: one decal looks exactly as its normal blend.
    const dst = 0.6;
    const col = 0.9;
    const a = 0.35;
    expect(dst * (1 - a) + col * a).toBeCloseTo(dst + (col - dst) * a, 12);
  });

  it('builds both passes on one geometry and one uniforms object, the glow riding the char', () => {
    const materials: THREE.Material[] = [];
    const geometry = new THREE.PlaneGeometry(1, 1);
    const uniforms = { uHeat: { value: 0.5 } };
    const d = moltenDecal(
      {
        name: 'testDecal',
        geometry,
        vertexShader: 'void main() { gl_Position = vec4(0.0); }',
        fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
        uniforms,
        charStep: 4,
        glowStep: 9,
      },
      materials,
    );
    expect(materials).toEqual([d.mat, d.glowMat]);
    expect(d.mesh.children).toEqual([d.glow]);
    expect(d.glow.geometry).toBe(d.mesh.geometry);
    expect(d.mat.uniforms).toBe(uniforms);
    expect(d.glowMat.uniforms).toBe(uniforms);
    expect(d.mat.defines).toHaveProperty('HEAT_CHAR');
    expect(d.glowMat.defines ?? {}).not.toHaveProperty('HEAT_CHAR');
    expect(blendOf(d.mat)).toBe('multiply');
    expect(blendOf(d.glowMat)).toBe('additive');
    expect(d.mesh.renderOrder).toBe(floorVfxRenderOrder('encounter', 4));
    expect(d.glow.renderOrder).toBe(floorVfxRenderOrder('encounter', 9));
    expect(d.mesh.visible).toBe(false);
  });
});

describe('heat_telegraph: the kit footprint in the molten paint, shape and timing the kit', () => {
  it('drives both passes off the kit uniforms (its drape and paint reach them)', () => {
    const root = new THREE.Group();
    const kit = new TelegraphKit(root, true);
    const materials: THREE.Material[] = [];
    const t = new HeatTelegraphs(kit, { char: 12, glow: 14, curtain: 16 }, materials);
    const fan = t.fan('fist');
    kit.layOutFan(fan, 360, { color: 0xff2d44 });
    kit.drapeFan(fan, () => 0, 0, 0, 0, 0, 6);
    kit.paintFan(fan, { fill: 0.4, clock: 2, range: 6 });
    const char = fan.floor.material as THREE.ShaderMaterial;
    const glow = fan.floor.children[0] as THREE.Mesh;
    const glowMat = glow.material as THREE.ShaderMaterial;
    expect(char).not.toBe(fan.floorMat);
    expect(char.uniforms.uFill).toBe(fan.floorMat.uniforms.uFill);
    expect(glowMat.uniforms.uRange).toBe(fan.floorMat.uniforms.uRange);
    expect(char.uniforms.uFill.value).toBeCloseTo(0.4);
    expect(glowMat.uniforms.uRange.value).toBe(6);
    expect(char.uniforms.uChar.value).toBe(HEAT_TELEGRAPH_LOOKS.fist.char);
    expect(fan.floor.renderOrder).toBe(floorVfxRenderOrder('encounter', 12));
    expect(glow.renderOrder).toBe(floorVfxRenderOrder('encounter', 14));
    expect(fan.curtain?.renderOrder).toBe(floorVfxRenderOrder('encounter', 16));
    expect(fan.curtain?.visible).toBe(true);
    expect(materials).toHaveLength(2);
    // A seed's wide reach goes without its curtain (ten of them read as noise).
    const reach = t.fan('seedReach');
    expect(reach.curtain?.visible).toBe(false);
    const lane = t.lane('swell');
    kit.drapeLane(lane, () => 0, 0, 0, 0, 0, 32, 2.5, { color: 0xff6a2a });
    const laneChar = lane.floor.material as THREE.ShaderMaterial;
    expect(laneChar.uniforms.uLen).toBe(lane.floorMat.uniforms.uLen);
    expect(laneChar.uniforms.uLen.value).toBe(32);
    kit.dispose();
  });

  it('reads the timing off the kit (fill, front, warning, fade) and never a world point before the camera', () => {
    for (const u of ['uFill', 'uFront', 'uWarn', 'uFade', 'uRange', 'uLen', 'uHalf', 'uHalfArc'])
      expect(HEAT_TELEGRAPH_FRAG).toContain(`uniform float ${u};`);
    expect(HEAT_TELEGRAPH_FRAG).toContain('#ifdef HEAT_CHAR');
    expect(HEAT_TELEGRAPH_VERT).toContain('projectionMatrix * modelViewMatrix');
    expect(HEAT_TELEGRAPH_VERT).not.toMatch(/(?<!mat3\()viewMatrix\s*\*/);
  });
});

describe('heat_telegraph_core: the looks per kind', () => {
  it('chars deeper where swept and in the warning, a third of it once landed', () => {
    const kinds = Object.keys(HEAT_TELEGRAPH_LOOKS) as HeatTelegraphKind[];
    expect(kinds).toHaveLength(8);
    for (const k of kinds) {
      const ahead = heatTelegraphChar(k, 0, 0, false);
      const swept = heatTelegraphChar(k, 1, 0, false);
      const warn = heatTelegraphChar(k, 1, 1, false);
      expect(swept).toBeGreaterThan(ahead);
      expect(warn).toBeGreaterThan(swept);
      expect(heatTelegraphChar(k, 1, 0, true)).toBeCloseTo(swept * 0.35, 10);
      expect(ahead).toBeGreaterThan(0);
    }
    // The lethal fist chars deepest; the seeds' falloff reach is the lightest.
    const char = (k: HeatTelegraphKind) => HEAT_TELEGRAPH_LOOKS[k].char;
    expect(Math.max(...kinds.map(char))).toBe(char('fist'));
    expect(Math.min(...kinds.map(char))).toBe(char('seedReach'));
    expect(HEAT_TELEGRAPH_LOOKS.seedReach.falloff).toBe(1);
    expect(HEAT_TELEGRAPH_LOOKS.seedReach.rim).toBeLessThan(1);
    expect(HEAT_TELEGRAPH_LOOKS.seedReach.rim).toBeGreaterThan(0.3);
  });

  it('lands only at a full bar with no front left', () => {
    expect(heatTelegraphLanded(1, 0)).toBe(true);
    expect(heatTelegraphLanded(1, 0.75)).toBe(false);
    expect(heatTelegraphLanded(0.9, 0)).toBe(false);
  });
});

describe('the Heat modules take every floor step from the ladder', () => {
  const files = [
    'src/render/smith_heart_fx/heat_fx.ts',
    'src/render/smith_heart_fx/heat_fight_fx.ts',
    'src/render/smith_heart_fx/heat_well_fx.ts',
    'src/render/smith_heart_fx/heat_cinder_fx.ts',
    'src/render/smith_heart_fx/heat_body.ts',
  ];
  it('passes no literal step to the seam and builds no telegraph straight off the kit', () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (/floorVfxRenderOrder\(\s*'encounter'\s*,\s*\d/.test(line)) bad.push(`${f}:${i + 1}`);
        if (/\bkit\.(fan|lane)\(/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
