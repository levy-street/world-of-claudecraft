// The Smith's Heart's loot moment (src/render/smith_heart_fx/loot_coffer_core.ts,
// painted by loot_coffer_fx.ts):
//   - every guardian raises the coffer, in its own palette, as its own death
//     scene resolves (never before its climax), at a spot clear of the body;
//   - the mood off what the viewer may take (yours, others, empty); the rise
//     in order (the climb, the lock, the lid, the shaft); reduced motion
//     drops the climb, the flash and the burst; every sound a shipped sample;
//   - LootCofferFx over a fake world: nothing before the scene resolves, a
//     coffer after it; its click proxy carries the CORPSE's id (and picking
//     resolves a ray through it to the corpse); emptied, the lid shuts and
//     the proxy lets go; gone, it sinks and the slot frees; a body first
//     seen dead has its coffer standing at once; a body with nothing never
//     raises one; the particles are world points; the low tier sheds only
//     its named double;
//   - `/dev heart loot` lays a purse on a dead guardian that the real
//     corpse-loot path then empties.

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { SFX_FIXED_CATALOG_KEYS } from '../src/game/sfx_manifest.generated';
import { fxPickProxies } from '../src/render/fx_pick_proxies';
import { gfxInternalsForTest, sharedUniforms } from '../src/render/gfx';
import { BREATH_DEATH } from '../src/render/smith_heart_fx/breath_death_core';
import {
  COUNCIL_DEATH_END,
  COUNCIL_END_LEAD,
  councilSecondDeathSeconds,
} from '../src/render/smith_heart_fx/council_death_core';
import { DEATH_END, DEATH_IMPACT } from '../src/render/smith_heart_fx/final_death_core';
import { HEAT_DEATH } from '../src/render/smith_heart_fx/heat_death_core';
import {
  LOOT_COFFER,
  LOOT_COFFER_BOSSES,
  LOOT_COFFER_IN_REACH,
  LOOT_COFFER_LOW_SHARE,
  LOOT_COFFER_MAX_REACH,
  LOOT_COFFER_PALETTES,
  LOOT_COFFER_RISE_SOUNDS,
  LOOT_COFFER_SECONDARY_LAYERS,
  LOOT_COFFER_SHUT_SOUND,
  LOOT_COFFER_TARGETS,
  type LootCofferRise,
  lootCofferBudget,
  lootCofferClickable,
  lootCofferCrossed,
  lootCofferEase,
  lootCofferMood,
  lootCofferRise,
  lootCofferSettled,
  lootCofferSink,
  lootCofferSpot,
} from '../src/render/smith_heart_fx/loot_coffer_core';
import { LootCofferFx } from '../src/render/smith_heart_fx/loot_coffer_fx';
import { COFFER, COFFER_SCALE } from '../src/render/smith_heart_fx/loot_coffer_shape';
import { QUENCH_DEATH } from '../src/render/smith_heart_fx/quench_death_core';
import { WorldPicking } from '../src/render/world_picking';
import { SMITH_HEART_DUNGEON } from '../src/sim/content/smith_heart';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { handleSmithHeartDevChat } from '../src/sim/dev/smith_heart_dev';
import {
  SMITH_HEART_DEV_LOOT_COPPER,
  SMITH_HEART_LOOT_BOSSES,
  smithHeartLootTargets,
} from '../src/sim/dev/smith_heart_loot_dev';
import { BREATH_GUARDIAN } from '../src/sim/encounters/smith_heart/breath_ids';
import {
  COUNCIL_GUARDIAN,
  COUNCIL_SEAM_SINGER,
} from '../src/sim/encounters/smith_heart/council_ids';
import { FINAL_BOSS } from '../src/sim/encounters/smith_heart/final_ids';
import { HEAT_GUARDIAN } from '../src/sim/encounters/smith_heart/heat_ids';
import { QUENCH_GUARDIAN } from '../src/sim/encounters/smith_heart/quench_ids';
import { corpseLootReach, corpseLootReachBonus } from '../src/sim/loot/corpse_loot_reach';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { type Entity, INTERACT_RANGE } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

const newRise = (): LootCofferRise => ({
  sink: 0,
  ring: 0,
  ringAlpha: 0,
  pool: 0,
  flash: 0,
  open: 0,
  shaft: 0,
  shed: 0,
  done: false,
});

describe('the guardians', () => {
  it('every boss of the raid raises one, in its own palette, the council in one', () => {
    expect(Object.keys(LOOT_COFFER_BOSSES).sort()).toEqual(
      [
        COUNCIL_GUARDIAN,
        COUNCIL_SEAM_SINGER,
        BREATH_GUARDIAN,
        QUENCH_GUARDIAN,
        HEAT_GUARDIAN,
        FINAL_BOSS,
      ].sort(),
    );
    expect(LOOT_COFFER_BOSSES[COUNCIL_GUARDIAN].flavour).toBe('stone');
    expect(LOOT_COFFER_BOSSES[COUNCIL_SEAM_SINGER].flavour).toBe('stone');
    expect(LOOT_COFFER_BOSSES[BREATH_GUARDIAN].flavour).toBe('storm');
    expect(LOOT_COFFER_BOSSES[QUENCH_GUARDIAN].flavour).toBe('frost');
    expect(LOOT_COFFER_BOSSES[HEAT_GUARDIAN].flavour).toBe('ember');
    expect(LOOT_COFFER_BOSSES[FINAL_BOSS].flavour).toBe('forge');
    const accents = new Set(Object.values(LOOT_COFFER_PALETTES).map((p) => p.accent));
    expect(accents.size).toBe(Object.keys(LOOT_COFFER_PALETTES).length);
  });

  it('rises as each scene resolves: after its climax, before its end', () => {
    const scene: Record<string, [number, number]> = {
      [COUNCIL_GUARDIAN]: [COUNCIL_END_LEAD.guardian, councilSecondDeathSeconds('guardian')],
      [COUNCIL_SEAM_SINGER]: [COUNCIL_END_LEAD.singer, councilSecondDeathSeconds('singer')],
      [BREATH_GUARDIAN]: [BREATH_DEATH.clapAt, BREATH_DEATH.end],
      [QUENCH_GUARDIAN]: [QUENCH_DEATH.end - 3, QUENCH_DEATH.end],
      [HEAT_GUARDIAN]: [HEAT_DEATH.crumbleAt - 1, HEAT_DEATH.end],
      [FINAL_BOSS]: [DEATH_IMPACT, DEATH_END],
    };
    for (const [id, [climax, end]] of Object.entries(scene)) {
      const at = LOOT_COFFER_BOSSES[id].revealAt;
      expect(at, id).toBeGreaterThan(climax);
      expect(at, id).toBeLessThan(end);
    }
    // The council's scenes end before their end beat: the coffer waits for it.
    expect(LOOT_COFFER_BOSSES[COUNCIL_GUARDIAN].revealAt).toBeGreaterThan(
      COUNCIL_DEATH_END.guardian - 1.5,
    );
  });

  it('a looter at the coffer front is in the body loot reach (a big body from its edge)', () => {
    // Half the coffer's depth (scaled) and a looter's step in front of it.
    const front = (COFFER.depth / 2) * COFFER_SCALE + 0.6;
    expect(LOOT_COFFER_IN_REACH + front).toBeLessThanOrEqual(INTERACT_RANGE);
    for (const [id, boss] of Object.entries(LOOT_COFFER_BOSSES)) {
      const spot = lootCofferSpot(10, 20, 0.7, boss, { x: 0, z: 0, yaw: 0 });
      const r = Math.hypot(spot.x - 10, spot.z - 20);
      expect(r, id).toBeGreaterThan(2.5);
      expect(r, id).toBeLessThanOrEqual(LOOT_COFFER_MAX_REACH + 1e-9);
      const bonus = corpseLootReachBonus({ kind: 'mob', templateId: id });
      expect(r, id).toBeLessThanOrEqual(LOOT_COFFER_IN_REACH + bonus + 1e-9);
      // The same sum the sim's lootCorpse gate takes, from the coffer's front.
      expect(r + front, id).toBeLessThanOrEqual(corpseLootReach({ kind: 'mob', templateId: id }));
    }
    // The guardian lying in its 10.5 yd wellspring is looted from the lip.
    expect(corpseLootReachBonus({ kind: 'mob', templateId: HEAT_GUARDIAN })).toBeGreaterThan(10);
  });

  it('is a click on its corpse only while there is something to open', () => {
    expect(lootCofferClickable(false, 'yours', 0)).toBe(true);
    expect(lootCofferClickable(false, 'others', 0.5)).toBe(true);
    expect(lootCofferClickable(false, 'empty', 0)).toBe(false);
    expect(lootCofferClickable(true, 'yours', 0)).toBe(false);
    expect(lootCofferClickable(false, 'yours', 1.2)).toBe(false);
  });

  it('an emptied coffer lingers shut, then settles away', () => {
    const hold = LOOT_COFFER.closeFor + LOOT_COFFER.emptyHold;
    expect(lootCofferSettled('empty', hold - 0.1)).toBe(false);
    expect(lootCofferSettled('empty', hold)).toBe(true);
    expect(lootCofferSettled('yours', hold * 10)).toBe(false);
  });

  it('stands in front of the body (forward is (sin, cos)) and faces away from it', () => {
    const boss = { flavour: 'forge' as const, revealAt: 1, reach: 3, bearing: 0 };
    const spot = lootCofferSpot(0, 0, Math.PI / 2, boss, { x: 0, z: 0, yaw: 0 });
    expect(spot.x).toBeCloseTo(3, 6);
    expect(spot.z).toBeCloseTo(0, 6);
    expect(spot.yaw).toBeCloseTo(Math.PI / 2, 6);
    const far = lootCofferSpot(0, 0, 0, { ...boss, reach: 99 }, { x: 0, z: 0, yaw: 0 });
    expect(far.z).toBeCloseTo(LOOT_COFFER_MAX_REACH, 6);
  });
});

describe('the mood', () => {
  it('yours when this viewer may take something, others while anyone may, else empty', () => {
    expect(lootCofferMood('loot', true, true, false)).toBe('yours');
    expect(lootCofferMood('none', true, true, false)).toBe('others');
    expect(lootCofferMood('harvest', true, true, false)).toBe('others');
    expect(lootCofferMood('none', true, false, false)).toBe('empty');
    // Decayed or standing again: nothing, whatever it says.
    expect(lootCofferMood('loot', true, true, true)).toBe('empty');
    expect(lootCofferMood('loot', false, true, false)).toBe('empty');
  });

  it('shut and dark when empty; open with its shaft only when it is yours', () => {
    expect(LOOT_COFFER_TARGETS.empty.lid).toBe(0);
    expect(LOOT_COFFER_TARGETS.empty.shaft).toBe(0);
    expect(LOOT_COFFER_TARGETS.empty.sparks).toBe(0);
    expect(LOOT_COFFER_TARGETS.others.shaft).toBe(0);
    expect(LOOT_COFFER_TARGETS.others.lid).toBeGreaterThan(0);
    expect(LOOT_COFFER_TARGETS.yours.shaft).toBe(1);
    expect(LOOT_COFFER_TARGETS.yours.lid).toBeGreaterThan(LOOT_COFFER_TARGETS.others.lid);
    expect(LOOT_COFFER_TARGETS.yours.glow).toBeGreaterThan(LOOT_COFFER_TARGETS.others.glow);
    expect(LOOT_COFFER_TARGETS.others.glow).toBeGreaterThan(LOOT_COFFER_TARGETS.empty.glow);
  });

  it('eases toward a target, never past it', () => {
    expect(lootCofferEase(0, 10, 0.05, 100)).toBeCloseTo(5, 6);
    expect(lootCofferEase(9, 10, 0.05, 100)).toBe(10);
    expect(lootCofferEase(10, 0, 0.05, 1, 100)).toBeCloseTo(5, 6);
    expect(lootCofferEase(3, 3, 0.05, 1)).toBe(3);
  });
});

describe('the rise', () => {
  it('climbs out of the floor, locks with a flash, opens, then its shaft bursts', () => {
    const R = LOOT_COFFER;
    const at = (t: number) => ({ ...lootCofferRise(t, false, newRise()) });
    expect(at(0).sink).toBeCloseTo(R.depth, 6);
    expect(at(0).open).toBe(0);
    expect(at(0).shaft).toBe(0);
    let last = R.depth + 1;
    for (let t = 0; t <= R.climbTo; t += 0.05) {
      const s = at(t).sink;
      expect(s).toBeLessThanOrEqual(last + 1e-9);
      last = s;
    }
    expect(at(R.climbTo).sink).toBeCloseTo(0, 6);
    expect(at(R.lockAt).flash).toBeCloseTo(1, 6);
    expect(at(R.lockAt + 0.3).flash).toBe(0);
    expect(at(R.openAt - 0.01).open).toBe(0);
    expect(at(R.openAt + R.openFor).open).toBeCloseTo(1, 6);
    expect(at(R.shaftAt - 0.01).shaft).toBe(0);
    expect(at(R.shaftAt + 0.2).shaft).toBeGreaterThan(1);
    expect(at(R.end).shaft).toBeCloseTo(1, 6);
    expect(at(R.ringGone).ringAlpha).toBeCloseTo(0, 6);
    expect(at(R.end).done).toBe(true);
    expect(at(R.end - 0.1).done).toBe(false);
  });

  it('reduced motion: no climb, no flash, no burst; the light fades in', () => {
    for (let t = 0; t <= 3; t += 0.1) {
      const r = lootCofferRise(t, true, newRise());
      expect(r.sink).toBe(0);
      expect(r.flash).toBe(0);
      expect(r.shaft).toBeLessThanOrEqual(1);
      expect(r.shed).toBe(0);
    }
    expect(lootCofferRise(2, true, newRise()).open).toBe(1);
    expect(lootCofferSink(0.5, true)).toBe(0);
    expect(lootCofferSink(LOOT_COFFER.sinkFor, false)).toBeCloseTo(LOOT_COFFER.depth, 6);
  });

  it('every sound is a shipped sample, in order', () => {
    let prev = -1;
    for (const s of [...LOOT_COFFER_RISE_SOUNDS, LOOT_COFFER_SHUT_SOUND]) {
      expect(SFX_FIXED_CATALOG_KEYS, s.key).toContain(s.key);
    }
    for (const s of LOOT_COFFER_RISE_SOUNDS) {
      expect(s.at).toBeGreaterThan(prev);
      prev = s.at;
    }
    expect(lootCofferCrossed(0.5, 0.6, 0.55)).toBe(true);
    expect(lootCofferCrossed(-1, 0.6, 0.55)).toBe(false);
    expect(lootCofferCrossed(0.5, 2, 0.55)).toBe(false);
  });

  it('the low tier thins the particles and sheds the halo; every other tier is whole', () => {
    expect(lootCofferBudget('low')).toEqual({ share: LOOT_COFFER_LOW_SHARE, secondary: false });
    for (const tier of ['medium', 'high', 'ultra'] as const)
      expect(lootCofferBudget(tier)).toEqual({ share: 1, secondary: true });
  });
});

// ---- the painter over a fake world -------------------------------------------------------------

describe('LootCofferFx raises the coffer', () => {
  afterEach(() => {
    sharedUniforms.uTime.value = 0;
  });

  function setup(templateId = HEAT_GUARDIAN, reduced = false) {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const entities = new Map<number, Entity>();
    const mk = (id: number, kind: Entity['kind'], tid: string, x: number, z: number) =>
      ({
        id,
        kind,
        templateId: tid,
        name: tid,
        pos: { x, y: 0, z },
        prevPos: { x, y: 0, z },
        facing: 0,
        scale: 1,
        hp: 100,
        maxHp: 100,
        dead: false,
        lootable: false,
        loot: null,
        corpseTimer: 600,
        lootFfaTimer: 0,
        tappedById: null,
        ownerId: null,
        harvestClaimedBy: null,
        inCombat: false,
        auras: [],
      }) as unknown as Entity;
    const me = mk(1, 'player', 'warrior', o.x - 210, o.z - 10);
    const boss = mk(2, 'mob', templateId, o.x - 220, o.z);
    entities.set(me.id, me);
    entities.set(boss.id, boss);
    const world = {
      entities,
      player: me,
      playerId: me.id,
      partyInfo: null,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const scene = new THREE.Scene();
    const fx = new LootCofferFx(
      scene,
      () => 0,
      world,
      undefined,
      () => reduced,
    );
    const step = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 20); i++) {
        sharedUniforms.uTime.value += 0.05;
        fx.update(0.05);
      }
    };
    const kill = (withLoot = true) => {
      boss.dead = true;
      boss.hp = 0;
      if (withLoot) {
        boss.lootable = true;
        boss.loot = { copper: 500, items: [] };
      }
    };
    const proxy = () =>
      fxPickProxies().find((p) => p.userData.entityId === boss.id && scene.getObjectById(p.id));
    const lidAngle = () => {
      const lid = scene.getObjectByName('smithHeartLootLid');
      return lid ? THREE.MathUtils.radToDeg(-(lid.parent as THREE.Object3D).rotation.x) : 0;
    };
    return { scene, fx, boss, me, entities, step, kill, proxy, lidAngle };
  }

  const shown = (scene: THREE.Scene, name: string) => {
    let any = false;
    scene.traverse((o) => {
      if (o.name !== name) return;
      let v = true;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) v = v && p.visible;
      any = any || v;
    });
    return any;
  };

  it('waits for the scene to resolve, then rises; its proxy is the corpse', () => {
    const t = setup();
    const at = LOOT_COFFER_BOSSES[HEAT_GUARDIAN].revealAt;
    t.step(1);
    t.kill();
    t.step(at - 0.6);
    expect(t.fx.standing).toEqual([]);
    expect(t.proxy()).toBeUndefined();
    // The death is read on the scan (four times a second): a beat of slack.
    t.step(1.2);
    expect(t.fx.standing).toEqual([t.boss.id]);
    t.step(LOOT_COFFER.end + 1);
    expect(shown(t.scene, 'smithHeartLootBody')).toBe(true);
    expect(shown(t.scene, 'smithHeartLootShaft')).toBe(true);
    expect(t.lidAngle()).toBeCloseTo(LOOT_COFFER_TARGETS.yours.lid, 0);
    expect(t.proxy()?.userData.entityId).toBe(t.boss.id);
    t.fx.dispose();
    expect(fxPickProxies().some((p) => t.scene.getObjectById(p.id))).toBe(false);
  });

  it('stands beside the body, where its guardian puts it', () => {
    const t = setup();
    t.step(0.5);
    t.kill();
    t.step(LOOT_COFFER_BOSSES[HEAT_GUARDIAN].revealAt + LOOT_COFFER.end + 0.5);
    const stage = t.scene.getObjectByName('smithHeartLootCoffer0') as THREE.Object3D;
    const d = Math.hypot(stage.position.x - t.boss.pos.x, stage.position.z - t.boss.pos.z);
    expect(d).toBeCloseTo(LOOT_COFFER_BOSSES[HEAT_GUARDIAN].reach, 3);
    t.fx.dispose();
  });

  it('a ray through the coffer picks the corpse (the same loot path as its body)', () => {
    const t = setup();
    t.step(0.5);
    t.kill();
    t.step(LOOT_COFFER_BOSSES[HEAT_GUARDIAN].revealAt + LOOT_COFFER.end + 0.5);
    const stage = t.scene.getObjectByName('smithHeartLootCoffer0') as THREE.Object3D;
    t.scene.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    camera.position.set(stage.position.x + 9, 5, stage.position.z + 9);
    camera.lookAt(stage.position.x, 1, stage.position.z);
    camera.updateMatrixWorld(true);
    const picking = new WorldPicking(
      {
        sim: () =>
          ({
            entities: t.entities,
            playerId: t.me.id,
            player: t.me,
          }) as unknown as IWorld,
        camera: () => camera,
        viewport: () => ({ width: 800, height: 800 }),
        views: () => new Map(),
        clickTargets: () => [],
        gatherNodeMeshes: () => [],
        nameplatePick: () => null,
        placedAssets: () => null,
      },
      new THREE.Raycaster(),
    );
    expect(picking.pickDirect(400, 400)).toBe(t.boss.id);
    // Emptied: the coffer lets the click go (nothing left to open).
    t.boss.loot = null;
    t.boss.lootable = false;
    t.step(1);
    expect(picking.pickDirect(400, 400)).toBeNull();
    t.fx.dispose();
  });

  it('emptied, its lid falls shut and its light goes out', () => {
    const t = setup();
    t.step(0.5);
    t.kill();
    t.step(LOOT_COFFER_BOSSES[HEAT_GUARDIAN].revealAt + LOOT_COFFER.end + 0.5);
    expect(t.lidAngle()).toBeGreaterThan(40);
    t.boss.loot = null;
    t.boss.lootable = false;
    t.step(LOOT_COFFER.closeFor + 0.6);
    expect(t.lidAngle()).toBeCloseTo(0, 3);
    expect(shown(t.scene, 'smithHeartLootShaft')).toBe(false);
    expect(t.proxy()).toBeUndefined();
    // Still beside the body a while, shut and dark; then it sinks away.
    expect(t.fx.standing).toEqual([t.boss.id]);
    t.step(LOOT_COFFER.emptyHold + LOOT_COFFER.sinkFor + 0.5);
    expect(t.fx.standing).toEqual([]);
    t.fx.dispose();
  });

  it('only someone else may loot: ajar, no shaft, still the corpse to click', () => {
    const t = setup();
    t.step(0.5);
    t.kill(false);
    t.boss.lootable = true;
    t.boss.loot = { copper: 0, items: [{ itemId: 'linen_cloth', count: 1, personalFor: [99] }] };
    t.step(LOOT_COFFER_BOSSES[HEAT_GUARDIAN].revealAt + LOOT_COFFER.end + 1.5);
    expect(t.fx.standing).toEqual([t.boss.id]);
    expect(t.lidAngle()).toBeCloseTo(LOOT_COFFER_TARGETS.others.lid, 0);
    expect(shown(t.scene, 'smithHeartLootShaft')).toBe(false);
    expect(t.proxy()?.userData.entityId).toBe(t.boss.id);
    t.fx.dispose();
  });

  it('the body gone, it sinks back and the slot frees', () => {
    const t = setup();
    t.step(0.5);
    t.kill();
    t.step(LOOT_COFFER_BOSSES[HEAT_GUARDIAN].revealAt + LOOT_COFFER.end + 0.5);
    t.entities.delete(t.boss.id);
    t.step(0.6);
    expect(t.fx.standing).toEqual([t.boss.id]);
    t.step(LOOT_COFFER.sinkFor + 0.5);
    expect(t.fx.standing).toEqual([]);
    expect(shown(t.scene, 'smithHeartLootBody')).toBe(false);
    t.fx.dispose();
  });

  it('a body first seen dead with loot has its coffer standing at once, no rise', () => {
    const t = setup();
    t.kill();
    t.step(0.5);
    expect(t.fx.standing).toEqual([t.boss.id]);
    const rig = (t.scene.getObjectByName('smithHeartLootBody') as THREE.Object3D)
      .parent as THREE.Object3D;
    expect(rig.position.y).toBe(0);
    expect(t.lidAngle()).toBeCloseTo(LOOT_COFFER_TARGETS.yours.lid, 0);
    t.fx.dispose();
  });

  it('a body with nothing to loot never raises one; loot laid later raises it', () => {
    const t = setup(BREATH_GUARDIAN);
    t.step(0.5);
    t.kill(false);
    t.step(LOOT_COFFER_BOSSES[BREATH_GUARDIAN].revealAt + 3);
    expect(t.fx.standing).toEqual([]);
    t.boss.lootable = true;
    t.boss.loot = { copper: 10, items: [] };
    t.step(0.5);
    expect(t.fx.standing).toEqual([t.boss.id]);
    t.fx.dispose();
  });

  it('emits its sparks at world points round the coffer (the pools ignore a parent)', () => {
    const t = setup();
    t.step(0.5);
    t.kill();
    t.step(LOOT_COFFER_BOSSES[HEAT_GUARDIAN].revealAt + 2);
    const stage = t.scene.getObjectByName('smithHeartLootCoffer0') as THREE.Object3D;
    let near = 0;
    for (const name of ['smithHeartLootSparks', 'smithHeartLootDust']) {
      const mesh = t.scene.getObjectByName(name) as THREE.Mesh;
      expect(mesh.parent?.name).toBe('smith-heart-loot-coffer');
      const born = mesh.geometry.getAttribute('aLife');
      const pos = mesh.geometry.getAttribute('aPos0');
      for (let i = 0; i < born.count; i++) {
        if (born.getX(i) < 0) continue;
        const d = Math.hypot(pos.getX(i) - stage.position.x, pos.getZ(i) - stage.position.z);
        expect(d).toBeLessThan(4);
        near++;
      }
    }
    expect(near).toBeGreaterThan(20);
    t.fx.dispose();
  });

  it('plays the whole rise on the low tier and sheds only its named double', () => {
    const restore = gfxInternalsForTest.overrideSettings({ tier: 'low' });
    try {
      const t = setup();
      t.step(0.5);
      t.kill();
      t.step(LOOT_COFFER_BOSSES[HEAT_GUARDIAN].revealAt + LOOT_COFFER.end + 0.5);
      expect(shown(t.scene, 'smithHeartLootShaft')).toBe(true);
      expect(shown(t.scene, 'smithHeartLootBody')).toBe(true);
      for (const layer of LOOT_COFFER_SECONDARY_LAYERS)
        expect(shown(t.scene, layer), layer).toBe(false);
      t.fx.dispose();
    } finally {
      restore();
    }
  });

  it('the full tier draws the halo with the shaft', () => {
    const t = setup();
    t.step(0.5);
    t.kill();
    t.step(LOOT_COFFER_BOSSES[HEAT_GUARDIAN].revealAt + LOOT_COFFER.end + 0.5);
    expect(shown(t.scene, LOOT_COFFER_SECONDARY_LAYERS[0])).toBe(true);
    t.fx.dispose();
  });

  it('reduced motion: never under the floor, the coffer simply there', () => {
    const t = setup(HEAT_GUARDIAN, true);
    t.step(0.5);
    t.kill();
    t.step(LOOT_COFFER_BOSSES[HEAT_GUARDIAN].revealAt + 0.1);
    const rig = (t.scene.getObjectByName('smithHeartLootBody') as THREE.Object3D)
      .parent as THREE.Object3D;
    for (let i = 0; i < 40; i++) {
      t.step(0.05);
      expect(rig.position.y).toBe(0);
    }
    t.fx.dispose();
  });

  it('out of the raid it lets everything go', () => {
    const t = setup();
    t.kill();
    t.step(0.5);
    expect(t.fx.standing).toEqual([t.boss.id]);
    t.me.pos = { x: 0, y: 0, z: 0 };
    t.step(0.5);
    expect(t.fx.standing).toEqual([]);
    t.fx.dispose();
  });
});

describe('LootCofferFx across the raid', () => {
  afterEach(() => {
    sharedUniforms.uTime.value = 0;
  });

  /** A fake world holding several bodies, entities in the ClientWorld mirror
   *  shape when `mirror` (blank_entity.ts: ffa as Infinity or 0, a null
   *  loot list, a tap from the wire). */
  function raid(ids: string[]) {
    const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
    const entities = new Map<number, Entity>();
    const mk = (id: number, kind: Entity['kind'], tid: string, x: number, z: number) =>
      ({
        id,
        kind,
        templateId: tid,
        name: tid,
        pos: { x, y: 0, z },
        prevPos: { x, y: 0, z },
        facing: 0,
        scale: 1,
        hp: 100,
        maxHp: 100,
        dead: false,
        lootable: false,
        loot: null,
        corpseTimer: 600,
        lootFfaTimer: Number.POSITIVE_INFINITY,
        tappedById: null,
        ownerId: null,
        harvestClaimedBy: null,
        inCombat: false,
        auras: [],
      }) as unknown as Entity;
    const me = mk(1, 'player', 'warrior', o.x, o.z);
    entities.set(me.id, me);
    const bodies = ids.map((tid, i) => {
      const e = mk(10 + i, 'mob', tid, o.x + 30 * i, o.z + 20);
      entities.set(e.id, e);
      return e;
    });
    const world = {
      entities,
      player: me,
      playerId: me.id,
      partyInfo: null,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const fx = new LootCofferFx(
      new THREE.Scene(),
      () => 0,
      world,
      undefined,
      () => false,
    );
    const step = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 20); i++) {
        sharedUniforms.uTime.value += 0.05;
        fx.update(0.05);
      }
    };
    return { fx, me, bodies, step };
  }

  it('two looted council coffers settle away, so a later guardian still gets one', () => {
    const r = raid([COUNCIL_GUARDIAN, COUNCIL_SEAM_SINGER, BREATH_GUARDIAN]);
    const [g, s, b] = r.bodies;
    r.step(0.5);
    for (const e of [g, s]) {
      e.dead = true;
      e.lootable = true;
      e.loot = { copper: 10, items: [] };
      e.lootFfaTimer = 0;
    }
    r.step(Math.max(LOOT_COFFER_BOSSES[COUNCIL_GUARDIAN].revealAt, 5) + LOOT_COFFER.end + 1);
    expect(r.fx.standing.sort()).toEqual([g.id, s.id].sort());
    for (const e of [g, s]) {
      e.loot = null;
      e.lootable = false;
    }
    r.step(LOOT_COFFER.closeFor + LOOT_COFFER.emptyHold + LOOT_COFFER.sinkFor + 1);
    expect(r.fx.standing).toEqual([]);
    b.dead = true;
    b.lootable = true;
    b.loot = { copper: 10, items: [] };
    b.lootFfaTimer = 0;
    r.step(LOOT_COFFER_BOSSES[BREATH_GUARDIAN].revealAt + 1);
    expect(r.fx.standing).toEqual([b.id]);
    r.fx.dispose();
  });

  it('reads the mirror shape: another party tap is "others", a pending roll too', () => {
    const r = raid([QUENCH_GUARDIAN]);
    const [q] = r.bodies;
    r.step(0.5);
    // Tapped by someone else, still owner-locked (the wire's ffa = Infinity).
    q.dead = true;
    q.lootable = true;
    q.tappedById = 999;
    q.loot = { copper: 40, items: [] };
    r.step(LOOT_COFFER_BOSSES[QUENCH_GUARDIAN].revealAt + 1);
    expect(r.fx.standing).toEqual([q.id]);
    // A roll still running: lootable with a null loot list.
    q.loot = null;
    r.step(1);
    expect(r.fx.standing).toEqual([q.id]);
    // The roll resolved: the body settles empty.
    q.lootable = false;
    r.step(LOOT_COFFER.closeFor + LOOT_COFFER.emptyHold + LOOT_COFFER.sinkFor + 1);
    expect(r.fx.standing).toEqual([]);
    r.fx.dispose();
  });
});

// ---- the dev verb over a real Sim ----------------------------------------------------------------

describe('/dev heart loot', () => {
  it('names the guardians it lays loot on', () => {
    expect(smithHeartLootTargets('')).toBeNull();
    expect(smithHeartLootTargets('all')).toBeNull();
    expect([...(smithHeartLootTargets('council') ?? [])].sort()).toEqual(
      [COUNCIL_GUARDIAN, COUNCIL_SEAM_SINGER].sort(),
    );
    expect([...(smithHeartLootTargets('heat') ?? [])]).toEqual([HEAT_GUARDIAN]);
    expect([...(smithHeartLootTargets('final') ?? [])]).toEqual([FINAL_BOSS]);
    expect(smithHeartLootTargets('nonsense')).toBeUndefined();
    for (const id of Object.keys(LOOT_COFFER_BOSSES))
      expect(SMITH_HEART_LOOT_BOSSES.has(id), id).toBe(true);
  });

  it('lays a purse on a dead guardian that the real corpse loot then empties', () => {
    const sim = new Sim({ seed: 31, playerClass: 'warrior', autoEquip: false, devCommands: true });
    const dev = (line: string) => handleSmithHeartDevChat(sim.ctx, line, sim.player.id);
    sim.setPlayerLevel(20);
    expect(dev('/dev heart tp heat')).toBe(true);
    sim.tick();
    const DUNGEON = DUNGEONS[SMITH_HEART_DUNGEON];
    const inst: InstanceSlot | undefined = sim.ctx.instances.find((i) => {
      if (i.dungeonId !== SMITH_HEART_DUNGEON || i.partyKey === null || i.exitId === null)
        return false;
      const o = instanceOrigin(DUNGEON.index, i.slot);
      return Math.abs(sim.player.pos.x - o.x) < 300 && Math.abs(sim.player.pos.z - o.z) < 250;
    });
    if (!inst) throw new Error('no claim');
    const boss = inst.mobIds
      .map((id) => sim.ctx.entities.get(id))
      .find((e) => e?.templateId === HEAT_GUARDIAN);
    if (!boss) throw new Error('no guardian');
    // Living: nothing to lay it on.
    expect(dev('/dev heart loot heat')).toBe(true);
    expect(boss.loot ?? null).toBeNull();
    expect(dev('/dev heart kill heat')).toBe(true);
    sim.tick();
    expect(boss.dead).toBe(true);
    // The raid's drops are not wired: the kill itself leaves nothing.
    expect(boss.lootable).toBe(false);
    expect(dev('/dev heart loot heat')).toBe(true);
    expect(boss.lootable).toBe(true);
    expect(boss.loot?.copper).toBe(SMITH_HEART_DEV_LOOT_COPPER);
    expect(boss.loot?.items).toEqual([]);
    // The real path: in reach, the corpse is looted and settles empty.
    sim.player.pos = { ...boss.pos, x: boss.pos.x + 2 };
    const before = sim.ctx.players.get(sim.player.id)?.copper ?? 0;
    expect(sim.lootCorpse(boss.id)).toBe(true);
    expect((sim.ctx.players.get(sim.player.id)?.copper ?? 0) - before).toBe(
      SMITH_HEART_DEV_LOOT_COPPER,
    );
    expect(boss.lootable).toBe(false);
  });
});
