// The bespoke Thornhollow Fields rune-pad effect kits: the pure tuning/seed core
// (src/render/battleground_rune_vfx_core.ts) and the Three kit builder plus its
// model-swap seam (battleground_rune_vfx.ts / battleground_rune_model.ts).
//
// What these pin, and why each one is load-bearing:
//   - the three kits stay DISTINCT (the whole point of "bespoke": a player must
//     read which pad is up from its motion, not just its color);
//   - seeds are deterministic, so two clients standing on one pad see one
//     effect and a pad rebuilt after interest churn does not re-scatter;
//   - every geometry/material a kit hands a view is marked shared, because pad
//     views are stateful and UNPOOLED, per-view disposal would otherwise free
//     resources the next pad build reuses (the battleground_props.ts contract);
//   - lowGfx drops the richness (light + shells) but keeps the identity cloud;
//   - a rune with no registered GLB still builds its procedural fallback body,
//     which is the LIVE path until custom models land.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type BgObjectRefs, buildBattlegroundObject } from '../src/render/battleground_props';
import {
  battlegroundRuneModelPreloadInternalsForTest,
  prepareRuneModel,
  RUNE_MODEL_DEFS,
} from '../src/render/battleground_rune_model';
import {
  buildRuneVfxKit,
  type RuneVfxKit,
  runeVfxInternalsForTest,
} from '../src/render/battleground_rune_vfx';
import {
  RUNE_MOTE_SEED_STRIDE,
  RUNE_VFX_TUNING,
  runeLightPulse,
  runeMoteSeeds,
  runeSeed,
  runeShardYaw,
} from '../src/render/battleground_rune_vfx_core';
import { isSharedGeometry, isSharedMaterial } from '../src/render/shared_resource';
import { type BgRuneType, RUNE_VISUALS } from '../src/sim/social/battleground';

const KINDS: BgRuneType[] = ['sprint', 'damage', 'defense'];

describe('rune vfx core: seeds', () => {
  it('is deterministic and spreads over the unit interval', () => {
    // Same index+salt is the same value, always: a pad that churns out of
    // interest and back must rebuild the identical cloud.
    for (let i = 0; i < 64; i++) {
      expect(runeSeed(i, 3)).toBe(runeSeed(i, 3));
    }
    const values = Array.from({ length: 256 }, (_, i) => runeSeed(i, 1));
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    // A degenerate hash (all one bucket) would pile every mote on one spoke.
    const buckets = new Set(values.map((v) => Math.floor(v * 8)));
    expect(buckets.size).toBe(8);
    // The four channels must not be the same sequence offset, or angle and
    // radius would correlate and the cloud would collapse to a spiral seam.
    expect(runeSeed(7, 1)).not.toBe(runeSeed(7, 2));
    expect(runeSeed(7, 2)).not.toBe(runeSeed(7, 3));
  });

  it('packs one vec4 per mote', () => {
    for (const kind of KINDS) {
      const count = RUNE_VFX_TUNING[kind].motes;
      const seeds = runeMoteSeeds(count);
      expect(seeds).toBeInstanceOf(Float32Array);
      expect(seeds.length).toBe(count * RUNE_MOTE_SEED_STRIDE);
      expect(RUNE_MOTE_SEED_STRIDE).toBe(4);
    }
    expect(runeMoteSeeds(0).length).toBe(0);
  });
});

describe('rune vfx core: per-frame math', () => {
  it('pulses each light around 1 within its own amplitude', () => {
    for (const kind of KINDS) {
      const t = RUNE_VFX_TUNING[kind];
      // Peak of the sine is a quarter period in; trough three quarters.
      const period = 1 / t.lightPulseHz;
      expect(runeLightPulse(kind, 0)).toBeCloseTo(1, 6);
      expect(runeLightPulse(kind, period / 4)).toBeCloseTo(1 + t.lightPulse, 5);
      expect(runeLightPulse(kind, (period * 3) / 4)).toBeCloseTo(1 - t.lightPulse, 5);
      // Never dark, never blinding, at any time.
      for (let time = 0; time < 12; time += 0.137) {
        const pulse = runeLightPulse(kind, time);
        expect(pulse).toBeGreaterThan(0.5);
        expect(pulse).toBeLessThan(1.5);
      }
    }
  });

  it('spins only the Ward shard ring', () => {
    expect(runeShardYaw('defense', 2)).toBeCloseTo(2 * RUNE_VFX_TUNING.defense.shardSpin, 6);
    expect(runeShardYaw('defense', 2)).not.toBe(0);
    // Sprint and Battle carry no shards; a nonzero yaw here would silently
    // rotate a group that does not exist.
    expect(runeShardYaw('sprint', 2)).toBe(0);
    expect(runeShardYaw('damage', 2)).toBe(0);
  });
});

describe('rune vfx core: the kits stay distinct', () => {
  it('gives every rune its own motion signature', () => {
    // Bespoke means bespoke: no two kits may share a tuning row, and the three
    // vertex shaders must be three different programs.
    const rows = KINDS.map((k) => JSON.stringify(RUNE_VFX_TUNING[k]));
    expect(new Set(rows).size).toBe(3);
    const shaders = KINDS.map((k) => runeVfxInternalsForTest.moteVertexShaders[k]);
    expect(new Set(shaders).size).toBe(3);
    // Sprint is the fast one and Ward the slow one, by construction.
    expect(RUNE_VFX_TUNING.sprint.cycleSec).toBeLessThan(RUNE_VFX_TUNING.damage.cycleSec);
    expect(RUNE_VFX_TUNING.damage.cycleSec).toBeLessThan(RUNE_VFX_TUNING.defense.cycleSec);
  });

  it('declares every uniform its shader reads', () => {
    // A missing uniform is a silent black cloud in the browser and nowhere
    // else, so pin the declaration instead of waiting for a playtest.
    for (const kind of KINDS) {
      const src = runeVfxInternalsForTest.moteVertexShaders[kind];
      for (const name of ['uTime', 'uRise', 'uRadius', 'uSize', 'uCycle']) {
        expect(src, `${kind} shader declares ${name}`).toContain(`uniform float ${name};`);
      }
      expect(src).toContain('attribute vec4 aSeed;');
    }
  });
});

function collect(root: THREE.Object3D): {
  points: THREE.Points[];
  meshes: THREE.Mesh[];
  lights: THREE.PointLight[];
} {
  const points: THREE.Points[] = [];
  const meshes: THREE.Mesh[] = [];
  const lights: THREE.PointLight[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Points) points.push(o);
    else if (o instanceof THREE.PointLight) lights.push(o);
    else if (o instanceof THREE.Mesh) meshes.push(o);
  });
  return { points, meshes, lights };
}

/** The kit for a rune, or a failure: every rune type must have one. */
function kitFor(kind: BgRuneType, lowGfx = false): RuneVfxKit {
  const kit = buildRuneVfxKit(kind, RUNE_VISUALS[kind].color, lowGfx);
  if (!kit) throw new Error(`no vfx kit built for the ${kind} rune`);
  return kit;
}

describe('buildRuneVfxKit', () => {
  it('builds one GPU mote cloud per kit, sized and seeded from the core', () => {
    for (const kind of KINDS) {
      const { points } = collect(kitFor(kind).group);
      expect(points).toHaveLength(1);
      const geo = points[0].geometry;
      const seed = geo.getAttribute('aSeed');
      expect(seed.itemSize).toBe(RUNE_MOTE_SEED_STRIDE);
      expect(seed.count).toBe(RUNE_VFX_TUNING[kind].motes);
      // Shader-derived positions leave Three's inferred bounds at the origin;
      // without an explicit sphere the cloud pops out at grazing angles.
      expect(points[0].frustumCulled).toBe(false);
      const sphere = geo.boundingSphere;
      if (!sphere) throw new Error(`${kind} cloud needs explicit bounds`);
      expect(sphere.radius).toBeGreaterThan(RUNE_VFX_TUNING[kind].radius);
    }
  });

  it('marks every resource shared, so per-view disposal cannot strand a rebuild', () => {
    for (const kind of KINDS) {
      const { points, meshes } = collect(kitFor(kind).group);
      for (const o of [...points, ...meshes]) {
        expect(isSharedGeometry(o.geometry), `${kind} geometry shared`).toBe(true);
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) expect(isSharedMaterial(m), `${kind} material shared`).toBe(true);
      }
    }
  });

  it('reuses one cached program per kit rather than one per pad', () => {
    // Two pads of the same rune type appear on the field at once; they must
    // share the material (they animate in lockstep off one clock) and the
    // geometry, or a busy field pays three extra programs per pad.
    for (const kind of KINDS) {
      const a = collect(kitFor(kind).group);
      const b = collect(kitFor(kind).group);
      expect(a.points[0].material).toBe(b.points[0].material);
      expect(a.points[0].geometry).toBe(b.points[0].geometry);
    }
  });

  it('drops the richness on low gfx but keeps the identity cloud', () => {
    for (const kind of KINDS) {
      const kit = kitFor(kind, true);
      const { points, meshes, lights } = collect(kit.group);
      expect(points).toHaveLength(1); // the cloud IS the identity; never cut it
      expect(lights).toHaveLength(0);
      expect(meshes).toHaveLength(0);
      // update() must stay safe with nothing to drive.
      expect(() => kit.update(3.5)).not.toThrow();
    }
  });

  it('drives the light pulse and the shard yaw from the core', () => {
    const ward = kitFor('defense');
    const { lights } = collect(ward.group);
    expect(lights).toHaveLength(1);
    ward.update(0);
    expect(lights[0].intensity).toBeCloseTo(runeVfxInternalsForTest.lightIntensity, 5);
    const t = 0.6;
    ward.update(t);
    expect(lights[0].intensity).toBeCloseTo(
      runeVfxInternalsForTest.lightIntensity * runeLightPulse('defense', t),
      5,
    );
    const shards = ward.group.children.find(
      (c): c is THREE.Group => c instanceof THREE.Group && c.children.length > 1,
    );
    if (!shards) throw new Error('the Ward kit must carry an orbiting shard ring');
    expect(shards.rotation.y).toBeCloseTo(runeShardYaw('defense', t), 6);
  });
});

describe('the pad body: custom GLB or procedural fallback', () => {
  it('spins the procedural body while no model is registered', () => {
    for (const kind of KINDS) {
      const { group } = buildBattlegroundObject('bg_rune', RUNE_VISUALS[kind].color, false);
      const refs = group.userData.bg as BgObjectRefs;
      expect(refs.kind).toBe('rune');
      if (refs.kind !== 'rune') return;
      // Body present under the spinner, and the kit wired for the fx pass.
      expect(refs.gem.children.length).toBeGreaterThan(0);
      const vfx = refs.vfx;
      if (!vfx) throw new Error(`the ${kind} pad must carry its kit`);
      expect(() => vfx.update(1.25)).not.toThrow();
      // With a kit in place the pad's light belongs to the kit, not the pad:
      // exactly one light, and it lives under the kit's group.
      const padLights = collect(group).lights;
      expect(padLights).toHaveLength(1);
      expect(collect(vfx.group).lights).toHaveLength(1);
    }
  });

  it('still lights an unrecognized rune color that has no kit', () => {
    const { group } = buildBattlegroundObject('bg_rune', 0x123456, false);
    const refs = group.userData.bg as BgObjectRefs;
    if (refs.kind !== 'rune') throw new Error('expected a rune');
    expect(refs.vfx).toBeNull();
    expect(collect(group).lights).toHaveLength(1);
  });

  it('centers an off-center export on the spin axis', () => {
    // The pad spinner yaws the prepared group about its own origin, so a body
    // left where the artist's export put it would orbit that origin instead of
    // turning in place. Authored exports are routinely off-center.
    const source = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
    source.position.set(3, 1, -2);
    const prepared = prepareRuneModel(source, { url: '/models/z.glb', targetHeight: 2 }, 0x00ffff);
    const bounds = new THREE.Box3().setFromObject(prepared);
    expect((bounds.min.x + bounds.max.x) / 2).toBeCloseTo(0, 5);
    expect((bounds.min.z + bounds.max.z) / 2).toBeCloseTo(0, 5);
    // Centering is horizontal only, the anchor still owns the vertical seat.
    expect(bounds.max.y).toBeCloseTo(1, 5);
  });

  it('normalizes a registered model to the def and shares its resources', () => {
    // Driven with a stand-in scene rather than a shipped GLB: this is the
    // contract ANY dropped-in model must meet, independent of what is
    // registered in RUNE_MODEL_DEFS today.
    const source = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(2, 8, 2), // 8 units tall, seated on the origin
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    );
    box.position.y = 4;
    source.add(box);

    const prepared = prepareRuneModel(
      source,
      { url: '/models/x.glb', targetHeight: 1.2 },
      0xff0000,
    );
    const bounds = new THREE.Box3().setFromObject(prepared);
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(1.2, 5);
    // Default anchor centers the body on the spinner origin (it hovers).
    expect(bounds.max.y).toBeCloseTo(0.6, 5);
    expect(bounds.min.y).toBeCloseTo(-0.6, 5);

    const { meshes } = collect(prepared);
    expect(meshes).toHaveLength(1);
    expect(isSharedGeometry(meshes[0].geometry)).toBe(true);
    const mat = meshes[0].material as THREE.MeshStandardMaterial;
    expect(isSharedMaterial(mat)).toBe(true);
    // The loader cache is immutable: preparation must not have touched it.
    expect(meshes[0].geometry).not.toBe(box.geometry);
    expect(mat).not.toBe(box.material);
    // Rune color pushed into emissive so a plain export still blooms.
    expect(mat.emissive.getHex()).toBe(0xff0000);
    expect(mat.emissiveIntensity).toBeGreaterThan(0);
    // Pads never cast shadow: one shadow-map draw per pad for no read.
    expect(meshes[0].castShadow).toBe(false);
  });

  it('makes a translucent body blend against the world but not against itself', () => {
    const source = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
    const prepared = prepareRuneModel(
      source,
      { url: '/models/t.glb', targetHeight: 1, opacity: 0.62 },
      0xff8800,
    );
    const mat = collect(prepared).meshes[0].material as THREE.MeshStandardMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBeCloseTo(0.62, 5);
    // depthWrite stays on: these bodies self-overlap, and without it they
    // render as a jumble of their own interior faces instead of tinted glass.
    expect(mat.depthWrite).toBe(true);
  });

  it('leaves a body with no opacity override fully solid', () => {
    const source = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial());
    const prepared = prepareRuneModel(source, { url: '/models/s.glb', targetHeight: 1 }, 0xff8800);
    const mat = collect(prepared).meshes[0].material as THREE.MeshStandardMaterial;
    expect(mat.transparent).toBe(false);
    expect(mat.opacity).toBe(1);
  });

  it('seats a base-anchored model on the spinner origin', () => {
    const source = new THREE.Mesh(new THREE.BoxGeometry(1, 4, 1), new THREE.MeshStandardMaterial());
    source.position.y = 2;
    const prepared = prepareRuneModel(
      source,
      { url: '/models/y.glb', targetHeight: 2, anchor: 0, yaw: Math.PI / 2 },
      0x00ff00,
    );
    const bounds = new THREE.Box3().setFromObject(prepared);
    expect(bounds.min.y).toBeCloseTo(0, 5);
    expect(bounds.max.y).toBeCloseTo(2, 5);
    expect(prepared.rotation.y).toBeCloseTo(Math.PI / 2, 6);
  });

  it('keeps the def table total and its urls under public/models', () => {
    // Every rune has an entry (null = fallback), so adding a rune type cannot
    // silently skip the model seam.
    for (const kind of KINDS) expect(kind in RUNE_MODEL_DEFS).toBe(true);
    for (const url of battlegroundRuneModelPreloadInternalsForTest.urls()) {
      expect(url.startsWith('/models/')).toBe(true);
      expect(url.endsWith('.glb')).toBe(true);
    }
  });
});
