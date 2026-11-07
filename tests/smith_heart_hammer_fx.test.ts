// The Hammer vein's effects and air (phase 2B, presentation only):
//   - hammer_fx_core.ts reads the guardian's own numbers (never tunes them),
//     its cracks stay inside their reach and arc, Mountain's Wrath's dust wall
//     rides the trash engine's wave front on the same clock, the Slab plays
//     its break only for a gate seen opening, once;
//   - hammer_air_core.ts thins with the tier, puts the collapse spot's heavy
//     grit over the lower Gallery's walk, haloes every geode; the Cleft's
//     first image (phase 2D): five shafts, dust in them, warm pools, the
//     crystals' glow and their two lamps;
//   - HammerFx over a fake world: builds, follows the guardian's bar, plays
//     the blast and Hammerfall, never claims an event, and disposes.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HEART_CLEFT_CRYSTALS, planHammerAir } from '../src/render/smith_heart/hammer_air_core';
import { collapseSpot } from '../src/render/smith_heart/hammer_kit_plan_core';
import {
  HEART_CLEFT_GLOW_LIGHTS,
  planHeartLights,
} from '../src/render/smith_heart/heart_plan_core';
import { HammerFx } from '../src/render/smith_heart_fx';
import {
  crackLines,
  HAMMER_GUARDIAN,
  hammerfallHeat,
  hammerGuardianKit,
  MOUNTAINS_WRATH,
  SLAB_BREAK_SECONDS,
  SLAB_BURST_AT,
  slabBreakDue,
  slabBreakLook,
  WRATH_AFTERGLOW,
  wrathBlastLook,
  wrathChargeLook,
} from '../src/render/smith_heart_fx/hammer_fx_core';
import { NOVA_WAVE_SECONDS, novaWave } from '../src/render/trash_engine_fx/trash_engine_fx_core';
import { SMITH_HEART_CASTS, SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { CLEFT, SMITH_HEART_FIELD } from '../src/sim/content/smith_heart_layout';
import { authoredFieldSurfaceAt } from '../src/sim/instances/authored_field';
import type { Entity, SimEvent } from '../src/sim/types';
import { castDisplayName } from '../src/ui/cast_display_name';
import type { IWorld } from '../src/world_api';

describe('hammer_fx_core: the guardian read, never tuned', () => {
  it('reads Mountain’s Wrath and Hammerfall off the sim template', () => {
    const t = SMITH_HEART_MOBS[HAMMER_GUARDIAN];
    const kit = hammerGuardianKit();
    expect(kit.radius).toBe(t.trashKit?.nova?.radius);
    expect(kit.castTime).toBe(t.trashKit?.nova?.castTime);
    expect(kit.arcDeg).toBe(t.arcCleave?.arcDeg);
    expect(kit.range).toBe(t.arcCleave?.range);
    expect(t.trashKit?.nova?.castId).toBe(MOUNTAINS_WRATH);
  });

  it('keeps every crack inside its reach and its fan, the same every build', () => {
    const all = crackLines(7, 14, 17);
    expect(all.length).toBeGreaterThan(14);
    for (const c of all)
      for (const p of c.pts) expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(17 * 1.3);
    expect(crackLines(7, 14, 17)).toEqual(all);
    // A forward fan stays in front (heading 0 is +z).
    for (const c of crackLines(3, 7, 10, 0, 110)) {
      const tip = c.pts[c.pts.length - 1];
      expect(tip.z, 'a Hammerfall crack runs forward').toBeGreaterThan(0);
    }
  });

  it('charges over the bar, then rides the engine’s wave out and cools', () => {
    expect(wrathChargeLook(0).grow).toBe(0);
    expect(wrathChargeLook(0).rise).toBe(0);
    expect(wrathChargeLook(1).grow).toBe(1);
    expect(wrathChargeLook(0.9).heat).toBeGreaterThan(wrathChargeLook(0.2).heat);
    for (const e of [0, 0.1, 0.25, 0.4, NOVA_WAVE_SECONDS]) {
      expect(wrathBlastLook(e, 45).front).toBeCloseTo(novaWave(e, 45).front, 6);
    }
    expect(wrathBlastLook(NOVA_WAVE_SECONDS + 2, 45).alpha).toBe(0);
    expect(wrathBlastLook(WRATH_AFTERGLOW, 45).heat).toBe(0);
    expect(hammerfallHeat(0.12)).toBeGreaterThan(hammerfallHeat(1.2));
    expect(hammerfallHeat(3)).toBe(0);
  });

  it('breaks the Slab only for a gate seen opening, once, and in its time', () => {
    const now = 100;
    // First met already open: no replay.
    expect(slabBreakDue({ state: 'open', changed: false, since: 0.1 }, now, undefined)).toBeNull();
    expect(slabBreakDue({ state: 'closed', changed: true, since: 0.1 }, now, undefined)).toBeNull();
    const start = slabBreakDue({ state: 'open', changed: true, since: 0.2 }, now, undefined);
    expect(start).toBeCloseTo(99.8, 6);
    expect(
      slabBreakDue({ state: 'open', changed: true, since: 0.3 }, now + 0.1, start ?? 0),
    ).toBeNull();
    expect(
      slabBreakDue({ state: 'open', changed: true, since: SLAB_BREAK_SECONDS + 1 }, now, undefined),
    ).toBeNull();
    expect(slabBreakLook(SLAB_BURST_AT).flash).toBeCloseTo(1, 6);
    expect(slabBreakLook(SLAB_BREAK_SECONDS + 0.1)).toEqual({ flash: 0, dust: 0, grit: 0 });
  });
});

describe('the raid’s cast bars', () => {
  it('names every Smith Heart cast on the bar, never its raw id', () => {
    for (const id of Object.values(SMITH_HEART_CASTS)) expect(castDisplayName(id), id).not.toBe(id);
    expect(castDisplayName(SMITH_HEART_CASTS.hammerWrath)).toBe("Mountain's Wrath");
  });
});

describe('hammer_air_core: the vein’s air', () => {
  it('thins with the tier and puts the heavy grit over the lower Gallery', () => {
    const full = planHammerAir(1);
    const low = planHammerAir(0.35);
    const motes = (p: typeof full) => p.motes.reduce((n, v) => n + v.count, 0);
    expect(motes(low)).toBeLessThan(motes(full));
    expect(low.haze.length).toBeLessThan(full.haze.length);
    const heavy = full.grit.filter((g) => g.heavy);
    expect(heavy.length).toBeGreaterThanOrEqual(4);
    const over = heavy.filter(
      (g) => authoredFieldSurfaceAt(SMITH_HEART_FIELD, g.x, g.z)?.id === 'gallery_lower',
    );
    expect(over.length).toBeGreaterThanOrEqual(3);
    const c = collapseSpot();
    for (const g of heavy) expect(g.top).toBeGreaterThan(c.y + 8);
    expect(full.geodes.length).toBe(
      SMITH_HEART_FIELD.props.filter((p) => p.kind === 'sh_geode').length,
    );
    expect(full.grit.filter((g) => !g.heavy).length).toBeGreaterThan(10);
  });
});

describe('hammer_air_core: the Cleft, the raid’s first image', () => {
  it('lights the landing with five shafts, dust in them, warm pools and the crystals’ glow', () => {
    const full = planHammerAir(1);
    const low = planHammerAir(0.35);
    // Never thinned: the shafts are the image (five quads).
    expect(full.shafts.length).toBeGreaterThanOrEqual(5);
    expect(low.shafts.length).toBe(full.shafts.length);
    for (const s of full.shafts) {
      expect(Math.hypot(s.x - CLEFT.x, s.z - CLEFT.z)).toBeLessThan(CLEFT.r);
      expect(s.y0).toBe(CLEFT.h);
      expect(s.y1 - s.y0).toBeGreaterThan(20);
    }
    // At least one broad main shaft, and thin blades beside it.
    expect(Math.max(...full.shafts.map((s) => s.width))).toBeGreaterThanOrEqual(6);
    expect(Math.min(...full.shafts.map((s) => s.width))).toBeLessThan(2);
    // The dust hangs in the shafts (one volume each) and thins with the tier.
    expect(full.shaftMotes.length).toBe(full.shafts.length);
    const count = (p: typeof full) => p.shaftMotes.reduce((n, v) => n + v.count, 0);
    expect(count(low)).toBeLessThan(count(full));
    for (const v of full.shaftMotes) {
      expect(Math.hypot(v.x - CLEFT.x, v.z - CLEFT.z)).toBeLessThan(CLEFT.r + 4);
      expect(v.y0).toBeGreaterThan(CLEFT.h);
    }
    // A warm pool where each broad shaft lands, on the landing.
    expect(full.sunPools.length).toBeGreaterThanOrEqual(2);
    for (const c of full.sunPools) expect(c.y).toBeCloseTo(CLEFT.h + 0.6, 5);
    // The four amber crystal clusters at the gate's foot glow, at the landing's height.
    expect(full.cleftGlows.length).toBe(HEART_CLEFT_CRYSTALS.length);
    for (const g of full.cleftGlows) {
      expect(g.y).toBeGreaterThan(CLEFT.h);
      expect(g.y).toBeLessThan(CLEFT.h + 4);
    }
  });

  it('lights the crystals with two small steady lamps inside the Cleft’s budget', () => {
    const lights = planHeartLights().filter((l) => l.id.startsWith('cleft'));
    const crystals = lights.filter((l) => l.id.startsWith('cleft_crystals'));
    expect(crystals.length).toBe(HEART_CLEFT_GLOW_LIGHTS.length);
    for (const l of crystals) {
      expect(l.y).toBeGreaterThan(CLEFT.h);
      expect(l.range).toBeLessThan(16);
      expect(l.noHalo).toBe(true);
    }
    expect(lights.length).toBeLessThanOrEqual(8);
  });
});

describe('HammerFx over a fake world', () => {
  function entity(id: number, kind: Entity['kind'], templateId: string, x: number, z: number) {
    return {
      id,
      kind,
      templateId,
      name: templateId,
      pos: { x, y: 0, z },
      prevPos: { x, y: 0, z },
      facing: 0.4,
      scale: 1,
      hp: 100,
      maxHp: 100,
      dead: false,
      auras: [],
      castingAbility: null as string | null,
      castTargetId: null,
      castRemaining: 0,
      castTotal: 0,
    } as unknown as Entity;
  }

  it('follows the bar, plays the blast and Hammerfall, claims nothing, disposes', () => {
    const entities = new Map<number, Entity>();
    const me = entity(1, 'player', 'warrior', -10, 0);
    const boss = entity(2, 'mob', HAMMER_GUARDIAN, 0, 0);
    boss.castingAbility = MOUNTAINS_WRATH;
    boss.castTotal = 3;
    boss.castRemaining = 3;
    entities.set(me.id, me);
    entities.set(boss.id, boss);
    const world = { entities, player: me, playerId: me.id } as unknown as IWorld;
    const scene = new THREE.Scene();
    let shaken = 0;
    const fx = new HammerFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      (a) => {
        shaken += a;
      },
    );
    for (let i = 0; i < 30; i++) {
      boss.castRemaining = Math.max(0, boss.castRemaining - 1 / 30);
      fx.update(1 / 30);
    }
    const root = scene.getObjectByName('smith-heart-hammer-fx');
    expect(root).toBeDefined();
    const cracks = root?.getObjectByName('smithHeartWrathCracks');
    expect(cracks?.visible).toBe(true);
    expect(root?.getObjectByName('smithHeartWrathStones')?.visible).toBe(true);
    const nova = {
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'physical',
      fx: 'nova',
      ability: MOUNTAINS_WRATH,
    } as SimEvent;
    expect(fx.handleEvent(nova)).toBe(false);
    boss.castingAbility = null;
    for (let i = 0; i < 10; i++) fx.update(1 / 30);
    expect(root?.getObjectByName('smithHeartDustWall')?.visible).toBe(true);
    expect(root?.getObjectByName('smithHeartRubble')?.visible).toBe(true);
    expect(shaken).toBeGreaterThan(0);
    const swing = {
      type: 'spellfx',
      sourceId: boss.id,
      targetId: me.id,
      school: 'fire',
      fx: 'windup',
      ability: 'brood_cleave',
    } as SimEvent;
    expect(fx.handleEvent(swing)).toBe(false);
    fx.update(1 / 30);
    expect(root?.getObjectByName('smithHeartHammerfallCracks')?.visible).toBe(true);
    // Everything cools and hides again.
    for (let i = 0; i < 300; i++) fx.update(1 / 30);
    expect(root?.getObjectByName('smithHeartDustWall')?.visible).toBe(false);
    fx.dispose();
    expect(scene.getObjectByName('smith-heart-hammer-fx')).toBeUndefined();
  });
});
