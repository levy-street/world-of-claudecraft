// Weight of the Anvil's look (render/smith_heart_fx/final_anvil_core.ts and
// final_anvil_fx.ts, a part of FinalKitFx):
//   - the plan: it hangs high through most of its bar and lands at its end,
//     heating all the way; six runes kindle one a second; the closing ring
//     slides in from outside the rim onto it only once it drops; the share's
//     colour turns on the sim's own minimum; the strike flashes, cools and
//     ends; its fragments ring the strike on every tier (the low tier's
//     fewer pieces still round the whole burst) and lie down; the thud fades
//     with distance and is gone under reduced motion; its sound beats are
//     existing samples, each once;
//   - the painter over a fake world: the anvil, the runes and the column on
//     the mark through the bar (every tier), gold with three under it, ember
//     with fewer; the strike hides the anvil, bursts it into fragments, lays
//     the scar and the flash, thuds the camera once, emits its particles at
//     WORLD points round the mark (the pools ignore a parent); nothing shakes
//     under reduced motion; the low tier keeps every actionable piece.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SFX_FIXED_CATALOG_KEYS } from '../src/game/sfx_manifest.generated';
import { activateGfxProfile, GFX, getActiveGfxProfile } from '../src/render/gfx';
import { FinalKitFx } from '../src/render/smith_heart_fx';
import {
  ANVIL_FX,
  ANVIL_SOUNDS,
  anvilChunkAt,
  anvilCrossed,
  anvilHang,
  anvilImpact,
  anvilRuneLit,
  anvilShake,
  anvilSoakReady,
} from '../src/render/smith_heart_fx/final_anvil_core';
import { HEART_ROOM } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  FINAL_BOSS,
  FINAL_CASTS,
  FINAL_CUES,
  FINAL_OBJECTS,
  finalTimed,
  FINAL_TUNING as T,
} from '../src/sim/encounters/smith_heart/final_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

describe("the Anvil's plan", () => {
  it('hangs high through its bar, drops at its end and heats all the way', () => {
    expect(anvilHang(0).height).toBeGreaterThan(15);
    expect(anvilHang(ANVIL_FX.dropAt - 0.01).height).toBeGreaterThan(15);
    expect(anvilHang(1).height).toBeLessThan(0.01);
    let prevH = Number.POSITIVE_INFINITY;
    let prevHeat = -1;
    for (let f = 0; f <= 1.0001; f += 0.02) {
      const L = anvilHang(f);
      expect(L.height).toBeLessThanOrEqual(prevH + 1e-9);
      expect(L.heat).toBeGreaterThan(prevHeat);
      prevH = L.height;
      prevHeat = L.heat;
    }
    expect(anvilHang(1).heat).toBeCloseTo(1, 6);
    // The column of heat shows from the start (the line it falls).
    expect(anvilHang(0).column).toBeGreaterThan(0.2);
  });

  it('kindles six runes one a second through the 6 s bar', () => {
    expect(ANVIL_FX.runes).toBe(6);
    expect(T.anvilCast).toBe(6);
    for (let s = 0; s < 6; s++) {
      const runes = anvilHang((s + 0.999) / T.anvilCast).runes;
      for (let i = 0; i < 6; i++) {
        const lit = anvilRuneLit(i, runes);
        if (i < s) expect(lit, `rune ${i} at ${s} s`).toBe(1);
        if (i > s) expect(lit, `rune ${i} at ${s} s`).toBe(0);
      }
    }
    expect(anvilRuneLit(0, 0)).toBe(0);
    for (let i = 0; i < 6; i++) expect(anvilRuneLit(i, anvilHang(1).runes)).toBe(1);
  });

  it('slides its closing ring in onto the rim only once it drops', () => {
    expect(anvilHang(ANVIL_FX.dropAt - 0.01).close).toBe(0);
    expect(anvilHang(ANVIL_FX.dropAt - 0.01).closeAlpha).toBe(0);
    const start = anvilHang(ANVIL_FX.dropAt + 1e-6).close;
    expect(start).toBeCloseTo(ANVIL_FX.closeFrom, 3);
    let prev = start;
    for (let f = ANVIL_FX.dropAt + 0.02; f <= 1.0001; f += 0.02) {
      const c = anvilHang(f).close;
      expect(c).toBeLessThanOrEqual(prev + 1e-9);
      expect(c).toBeGreaterThanOrEqual(1);
      prev = c;
    }
    expect(anvilHang(1).close).toBeCloseTo(1, 6);
    expect(anvilHang(1).closeAlpha).toBeCloseTo(1, 6);
    // The streak and the shiver are the drop's, never before the last second.
    expect(anvilHang(0.5).streak).toBe(0);
    expect(anvilHang(0.5).shudder).toBe(0);
    expect(anvilHang(ANVIL_FX.dropAt - 0.05).shudder).toBeGreaterThan(0);
    expect(anvilHang(0.95).streak).toBeGreaterThan(0.5);
  });

  it("turns the runes gold on the sim's own minimum of soakers", () => {
    expect(anvilSoakReady(T.anvilMinSoakers)).toBe(true);
    expect(anvilSoakReady(T.anvilMinSoakers - 1)).toBe(false);
    expect(anvilSoakReady(0)).toBe(false);
  });

  it('flashes at the strike, cools and ends; the flash is capped under reduced motion', () => {
    const at0 = anvilImpact(0, false);
    expect(at0.flash).toBeCloseTo(1, 6);
    expect(at0.scar).toBe(1);
    expect(at0.live).toBe(true);
    expect(anvilImpact(0, true).flash).toBeLessThanOrEqual(0.35);
    expect(anvilImpact(ANVIL_FX.flashFor + 0.01, false).flash).toBe(0);
    expect(anvilImpact(3, false).scar).toBeLessThan(anvilImpact(1, false).scar);
    expect(anvilImpact(ANVIL_FX.scarFor + 0.1, false).live).toBe(false);
    expect(anvilImpact(-1, false).live).toBe(false);
    expect(anvilImpact(Number.NaN, false).live).toBe(false);
  });

  it('flings its fragments round the whole strike on every tier, and lays them down', () => {
    for (const count of [ANVIL_FX.chunks, ANVIL_FX.chunksLow]) {
      // Every quarter round the strike gets pieces.
      const quarters = new Set<number>();
      for (let i = 0; i < count; i++) {
        const c = anvilChunkAt(i, count, 0.3);
        expect(c.size).toBeGreaterThan(0);
        expect(c.y).toBeGreaterThan(0);
        const a = Math.atan2(c.x, c.z);
        quarters.add(Math.floor(((a + Math.PI) / (Math.PI * 2)) * 4) % 4);
        // Landed and lying low before it fades.
        const late = anvilChunkAt(i, count, 1.6);
        expect(late.y).toBeLessThan(0.5);
        expect(anvilChunkAt(i, count, ANVIL_FX.chunksFor).size).toBe(0);
      }
      expect(quarters.size).toBe(4);
    }
    // The low tier's pieces are larger (the burst fills the same space).
    expect(anvilChunkAt(0, ANVIL_FX.chunksLow, 0.2).size).toBeGreaterThan(
      anvilChunkAt(0, ANVIL_FX.chunks, 0.2).size,
    );
  });

  it('thuds hardest under it, fades with distance and is gone under reduced motion', () => {
    expect(anvilShake(0, false)).toBeGreaterThan(anvilShake(30, false));
    expect(anvilShake(30, false)).toBeGreaterThan(anvilShake(80, false));
    expect(anvilShake(200, false)).toBe(0);
    expect(anvilShake(0, true)).toBe(0);
  });

  it('beats only on existing samples, each crossing once', () => {
    for (const s of ANVIL_SOUNDS) {
      expect((SFX_FIXED_CATALOG_KEYS as readonly string[]).includes(s.key), s.key).toBe(true);
      expect((s.bar === undefined) !== (s.after === undefined)).toBe(true);
    }
    expect(anvilCrossed(0.49, 0.51, 0.5)).toBe(true);
    expect(anvilCrossed(0.51, 0.53, 0.5)).toBe(false);
    expect(anvilCrossed(0.6, 0.4, 0.5)).toBe(false);
  });
});

// ---- the painter over a fake world --------------------------------------------------------

function entity(id: number, kind: string, templateId: string, x: number, z: number): Entity {
  return {
    id,
    kind,
    templateId,
    name: templateId,
    pos: { x, y: 0, z },
    facing: 0,
    dead: false,
    hp: 100,
    maxHp: 100,
    scale: kind === 'object' ? T.anvilR : 1,
    auras: [],
    castingAbility: null,
    castRemaining: 0,
    castTotal: 0,
    castTargetId: null,
  } as unknown as Entity;
}

function shown(root: THREE.Object3D | undefined, name: string): boolean {
  let v = false;
  root?.traverse((o) => {
    if (o.name !== name) return;
    let p: THREE.Object3D | null = o;
    let all = true;
    while (p && p !== root) {
      if (!p.visible) all = false;
      p = p.parent;
    }
    v ||= all;
  });
  return v;
}

function rig(opts: { reduced?: boolean; under?: number } = {}) {
  const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
  const mark = { x: o.x + HEART_ROOM.x, z: o.z + HEART_ROOM.z + 20 };
  const entities = new Map<number, Entity>();
  const me = entity(1, 'player', 'warrior', mark.x + 30, mark.z);
  entities.set(1, me);
  for (let i = 0; i < (opts.under ?? 0); i++) {
    const p = entity(10 + i, 'player', 'mage', mark.x + i, mark.z - 1);
    entities.set(p.id, p);
  }
  const boss = entity(2, 'mob', FINAL_BOSS, mark.x, mark.z + 25);
  entities.set(2, boss);
  const anvil = entity(
    5,
    'object',
    finalTimed(FINAL_OBJECTS.anvilPrefix, T.anvilCast),
    mark.x,
    mark.z,
  );
  entities.set(5, anvil);
  const world = {
    entities,
    player: me,
    playerId: me.id,
    entityRosterVersion: 1,
  } as unknown as IWorld;
  const scene = new THREE.Scene();
  const shakes: number[] = [];
  const fx = new FinalKitFx(
    scene,
    () => 0,
    world,
    undefined,
    () => opts.reduced === true,
    (a) => shakes.push(a),
  );
  const root = scene.getObjectByName('smith-heart-final-kit-fx');
  const bar = (left: number) => {
    boss.castingAbility = FINAL_CASTS.anvil;
    boss.castTotal = T.anvilCast;
    boss.castRemaining = left;
  };
  const land = () => {
    entities.delete(5);
    (world as { entityRosterVersion: number }).entityRosterVersion++;
    boss.castingAbility = null;
    return fx.handleEvent({
      type: 'spellfxAt',
      x: mark.x,
      z: mark.z,
      school: 'physical',
      fx: 'burst',
      radius: T.anvilR,
      ability: FINAL_CUES.anvil,
    } as SimEvent);
  };
  const uniforms = (name: string) => {
    const m = root?.getObjectByName(name) as THREE.Mesh;
    return (m.material as THREE.ShaderMaterial).uniforms;
  };
  return { fx, root, mark, shakes, bar, land, uniforms };
}

describe('the Anvil over a fake world', () => {
  it('hangs it over its mark with its countdown, then strikes: fragments, scar, flash, one thud', () => {
    const r = rig({ under: 3 });
    r.bar(T.anvilCast - 0.5);
    for (let i = 0; i < 4; i++) r.fx.update(1 / 20);
    for (const n of [
      'smithHeartFinalAnvil',
      'smithHeartFinalAnvilRunes',
      'smithHeartFinalAnvilColumn',
    ])
      expect(shown(r.root, n), n).toBe(true);
    // The share: three under it, gold.
    const gold = r.uniforms('smithHeartFinalAnvilRunes').uColor.value as THREE.Color;
    expect(gold.g).toBeGreaterThan(0.7);
    // Past the drop: the closing ring and the streak.
    r.bar(T.anvilCast * 0.1);
    r.fx.update(1 / 20);
    expect(r.uniforms('smithHeartFinalAnvilRunes').uClose.value).toBeGreaterThan(1);
    expect(shown(r.root, 'smithHeartFinalAnvilStreak')).toBe(true);
    // The strike.
    expect(r.land()).toBe(true);
    r.fx.update(1 / 20);
    expect(shown(r.root, 'smithHeartFinalAnvil')).toBe(false);
    expect(shown(r.root, 'smithHeartFinalAnvilRunes')).toBe(false);
    for (const n of [
      'smithHeartFinalAnvilShards',
      'smithHeartFinalAnvilScar',
      'smithHeartFinalAnvilFlash',
    ])
      expect(shown(r.root, n), n).toBe(true);
    expect(r.shakes).toHaveLength(1);
    expect(r.shakes[0]).toBeGreaterThan(0);
    // The particles were born round the mark, in the world.
    const pools: THREE.Mesh[] = [];
    r.root?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && /^trashEngine(Glow|Smoke|Pyre)$/.test(m.name)) pools.push(o as THREE.Mesh);
    });
    let near = 0;
    for (const mesh of pools) {
      expect(mesh.parent?.name).toBe('smith-heart-final-kit-fx');
      const born = mesh.geometry.getAttribute('aLife');
      const pos = mesh.geometry.getAttribute('aPos0');
      for (let i = 0; i < born.count; i++) {
        if (born.getX(i) < 0) continue;
        expect(Math.hypot(pos.getX(i) - r.mark.x, pos.getZ(i) - r.mark.z)).toBeLessThan(20);
        near++;
      }
    }
    expect(near).toBeGreaterThan(100);
    // The aftermath runs out and hides.
    for (let i = 0; i < (ANVIL_FX.scarFor + 0.5) * 20; i++) r.fx.update(1 / 20);
    for (const n of [
      'smithHeartFinalAnvilShards',
      'smithHeartFinalAnvilScar',
      'smithHeartFinalAnvilFlash',
    ])
      expect(shown(r.root, n), n).toBe(false);
    expect(r.shakes).toHaveLength(1);
    r.fx.dispose();
  });

  it('burns ember red with too few under it', () => {
    const r = rig({ under: 1 });
    r.bar(T.anvilCast - 1);
    r.fx.update(1 / 20);
    const c = r.uniforms('smithHeartFinalAnvilRunes').uColor.value as THREE.Color;
    expect(c.r).toBeGreaterThan(0.9);
    expect(c.g).toBeLessThan(0.5);
    r.fx.dispose();
  });

  it('never shakes under reduced motion, and still draws the strike', () => {
    const r = rig({ reduced: true, under: 3 });
    r.bar(1);
    r.fx.update(1 / 20);
    r.land();
    r.fx.update(1 / 20);
    expect(r.shakes).toHaveLength(0);
    expect(shown(r.root, 'smithHeartFinalAnvilScar')).toBe(true);
    r.fx.dispose();
  });

  it('keeps every actionable piece on the low tier, with fewer fragments', () => {
    const original = getActiveGfxProfile();
    activateGfxProfile({ ...original, settings: { ...GFX, tier: 'low' } });
    try {
      const r = rig({ under: 3 });
      const shards = r.root?.getObjectByName('smithHeartFinalAnvilShards') as THREE.InstancedMesh;
      expect(shards.count).toBe(ANVIL_FX.chunksLow);
      r.bar(T.anvilCast * 0.1);
      r.fx.update(1 / 20);
      for (const n of [
        'smithHeartFinalAnvil',
        'smithHeartFinalAnvilRunes',
        'smithHeartFinalAnvilColumn',
      ])
        expect(shown(r.root, n), n).toBe(true);
      expect(r.uniforms('smithHeartFinalAnvilRunes').uClose.value).toBeGreaterThan(1);
      r.land();
      r.fx.update(1 / 20);
      expect(shown(r.root, 'smithHeartFinalAnvilScar')).toBe(true);
      r.fx.dispose();
    } finally {
      activateGfxProfile(original);
    }
  });
});
