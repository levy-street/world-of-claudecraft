// The Hollow Crypt's hero creatures after the third pass: the Ossuary Drake (a
// colossal skeletal wyvern that breathes spectral FIRE, sweeps its tail,
// buffets with its wings and bites, never claws) and the Chapel Gargoyle (a
// great stone statue that wakes, dives and shrieks). Sim half: the breath cone
// hits exactly the cone and burns as fire, the tail only hits behind, the
// buffet only throws the close ones, the flight is a pure function of time,
// and the dive and landing send the cue the renderer keys on. Presentation
// half: the visuals are wired for flight and for the strikes, every crypt
// creature stands clearly over a player, and the breath telegraph and effect
// read the template's own cone.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { TELEGRAPH_ACCENTS } from '../src/render/floor_telegraph/telegraph_look_core';
import {
  anchorWorld,
  coneSpot,
  DRAKE_JAWS_EXHALE,
  drakeBreathCone,
  drakeStrikeShapes,
  GHOST_FIRE_RAMP,
  ghostFireRampGlsl,
  inConeLocal,
  paintsOwnBreath,
  shockwave,
  torrentEnvelope,
  torrentSeconds,
  touchedDown,
} from '../src/render/hollow_crypt/crypt_creature_fx_core';
import {
  CRYPT_TELEGRAPH_COLORS,
  cryptTelegraphSpecs,
} from '../src/render/hollow_crypt/crypt_trash_fx_core';
import { HOLLOW_CRYPT_SPAWNS } from '../src/sim/content/hollow_crypt';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { applyDungeonMobTuning } from '../src/sim/instances/difficulty';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { patrolPointAt } from '../src/sim/mob/patrol';
import {
  CRYPT_BARROWFLAME_BREATH,
  CRYPT_PERCH_DIVE,
  CRYPT_SKY_LANDING,
  tickTrashKits,
} from '../src/sim/mob/trash_kit';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

const PLAYER_HEIGHT = 2.6;

interface Room {
  sim: Sim;
  inst: InstanceSlot;
  me: Entity;
}

function room(seed = 91): Room {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat('/dev crypt enter', sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('no crypt claim');
  const me = sim.player;
  me.maxHp = 1e6;
  me.hp = 1e6;
  const o = instanceOrigin(DUNGEONS.hollow_crypt.index, inst.slot);
  me.pos = sim.ctx.groundPos(o.x + 20, o.z - 10);
  me.prevPos = { ...me.pos };
  sim.drainEvents();
  return { sim, inst, me };
}

function drakeAt(r: Room, facing: number): Entity {
  const t = MOBS.crypt_ossuary_drake;
  const mob = createMob(r.sim.ctx.nextId++, t, t.minLevel, { ...r.me.pos });
  applyDungeonMobTuning(mob, 'hollow_crypt', r.inst.difficulty);
  r.sim.ctx.addEntity(mob);
  r.inst.mobIds.push(mob.id);
  mob.inCombat = true;
  mob.aiState = 'attack';
  mob.aggroTargetId = r.me.id;
  mob.facing = facing;
  return mob;
}

function playerAt(r: Room, name: string, dx: number, dz: number): Entity {
  const pid = r.sim.addPlayer('mage', name);
  const e = r.sim.ctx.entities.get(pid) as Entity;
  e.pos = r.sim.ctx.groundPos(r.me.pos.x + dx, r.me.pos.z + dz);
  e.prevPos = { ...e.pos };
  e.maxHp = 1e6;
  e.hp = 1e6;
  return e;
}

describe('Ossuary Drake: Barrowflame Breath is spectral FIRE down its cone', () => {
  const breath = MOBS.crypt_ossuary_drake.breathCone;

  it('is the fire breath the owner asked for, on the same bar and cadence', () => {
    expect(breath?.castId).toBe(CRYPT_BARROWFLAME_BREATH);
    expect(breath?.name).toBe('Barrowflame Breath');
    expect(breath?.school).toBe('fire');
    // Gameplay timings kept from the first pass.
    expect(breath?.castTime).toBe(2);
    expect(breath?.every).toBe(12);
    expect(breath?.range).toBe(14);
    expect(breath?.arcDeg).toBe(70);
  });

  it('burns the players inside the cone as fire, and nobody outside it', () => {
    if (!breath) throw new Error('breath');
    const r = room();
    // A cleared run: nothing but this drake can touch the bench players.
    r.sim.chat('/dev crypt kill all', r.me.id);
    r.sim.drainEvents();
    // The drake stands on the bench player and faces +z.
    const drake = drakeAt(r, 0);
    const d = { x: drake.pos.x, z: drake.pos.z };
    // The tank holds it facing +z from inside its reach, so it never turns or walks.
    r.me.pos = r.sim.ctx.groundPos(d.x, d.z + 3);
    r.me.prevPos = { ...r.me.pos };
    const put = (name: string, ang: number, dist: number) => {
      const e = playerAt(r, name, 0, 0);
      e.pos = r.sim.ctx.groundPos(d.x + Math.sin(ang) * dist, d.z + Math.cos(ang) * dist);
      e.prevPos = { ...e.pos };
      return e;
    };
    const half = (breath.arcDeg * Math.PI) / 360;
    const inFront = put('Front', 0, 10);
    const nearEdge = put('Edge', half * 0.85, 12);
    const outsideArc = put('Wide', half + 0.25, 8);
    const tooFar = put('Far', 0, breath.range + 2);
    const behind = put('Behind', Math.PI, 5);
    // One tick settles the bench players' stats before their health is read.
    r.sim.tick();
    const hpOf = new Map([inFront, nearEdge, outsideArc, tooFar, behind].map((e) => [e.id, e.hp]));
    const hurt = (e: Entity) => e.dead || e.hp < (hpOf.get(e.id) ?? 0);
    let landed = false;
    for (let t = 0; t < breath.every + breath.castTime + 1 && !landed; t += DT) {
      drake.inCombat = true;
      drake.aggroTargetId = r.me.id;
      // Only the breath: hold the tail and the gust (the gust would throw
      // the bench players out of the cone).
      if (drake.trashKit) {
        drake.trashKit.timers.tailLash = 999;
        drake.trashKit.timers.wingGust = 999;
      }
      const wasCasting = drake.castingAbility === CRYPT_BARROWFLAME_BREATH;
      r.sim.tick();
      landed = wasCasting && drake.castingAbility === null;
    }
    expect(landed).toBe(true);
    expect(hurt(inFront)).toBe(true);
    expect(hurt(nearEdge)).toBe(true);
    expect(hurt(outsideArc)).toBe(false);
    expect(hurt(tooFar)).toBe(false);
    expect(hurt(behind)).toBe(false);
  });
});

describe('Ossuary Drake: tail sweep and wing buffet', () => {
  function kitRoom() {
    const r = room();
    const drake = drakeAt(r, 0);
    drake.trashKit = undefined;
    return { r, drake };
  }
  function runKit(r: Room, drake: Entity, seconds: number) {
    for (let t = 0; t < seconds; t += DT) {
      drake.inCombat = true;
      drake.aiState = 'attack';
      drake.facing = 0;
      tickTrashKits(r.sim.ctx);
      r.sim.drainEvents();
    }
  }

  it('the tail hits only who stands in the cone behind it, inside its reach', () => {
    const { r, drake } = kitRoom();
    const lash = MOBS.crypt_ossuary_drake.trashKit?.tailLash;
    if (!lash) throw new Error('lash');
    r.me.pos = r.sim.ctx.groundPos(drake.pos.x, drake.pos.z + 6);
    const behind = playerAt(r, 'Behind', 0, 0);
    behind.pos = r.sim.ctx.groundPos(drake.pos.x, drake.pos.z - lash.range * 0.7);
    const behindFar = playerAt(r, 'BehindFar', 0, 0);
    behindFar.pos = r.sim.ctx.groundPos(drake.pos.x, drake.pos.z - lash.range - 2);
    const beside = playerAt(r, 'Beside', 0, 0);
    beside.pos = r.sim.ctx.groundPos(drake.pos.x + 6, drake.pos.z + 1);
    runKit(r, drake, DT);
    const kit = drake.trashKit;
    if (kit) kit.timers.wingGust = 999;
    runKit(r, drake, lash.first + lash.castTime + DT * 3);
    expect(behind.hp).toBeLessThan(1e6);
    expect(behindFar.hp).toBe(1e6);
    expect(beside.hp).toBe(1e6);
    expect(r.me.hp).toBe(1e6);
  });

  it('the wing buffet throws back everyone inside its ring and nobody beyond it', () => {
    const { r, drake } = kitRoom();
    const gust = MOBS.crypt_ossuary_drake.trashKit?.wingGust;
    if (!gust) throw new Error('gust');
    r.me.pos = r.sim.ctx.groundPos(drake.pos.x + 4, drake.pos.z + 2);
    r.me.prevPos = { ...r.me.pos };
    const far = playerAt(r, 'Far', 0, 0);
    far.pos = r.sim.ctx.groundPos(drake.pos.x - gust.radius - 3, drake.pos.z);
    far.prevPos = { ...far.pos };
    const dist = (e: Entity) => Math.hypot(e.pos.x - drake.pos.x, e.pos.z - drake.pos.z);
    const nearBefore = dist(r.me);
    const farBefore = dist(far);
    runKit(r, drake, DT);
    const kit = drake.trashKit;
    if (kit) kit.timers.tailLash = 999;
    runKit(r, drake, gust.first + gust.castTime + DT * 3);
    expect(dist(r.me)).toBeGreaterThan(nearBefore + 3);
    expect(r.me.hp).toBeLessThan(1e6);
    expect(dist(far)).toBeCloseTo(farBefore, 3);
    expect(far.hp).toBe(1e6);
  });
});

describe('Ossuary Drake: flight', () => {
  it('flies the same path at the same moments in two independent worlds', () => {
    const idx = HOLLOW_CRYPT_SPAWNS.findIndex((s) => s.mobId === 'crypt_ossuary_drake');
    const track = (seed: number) => {
      const r = room(seed);
      const drake = r.sim.ctx.entities.get(r.inst.mobIds[idx]) as Entity;
      const out: number[] = [];
      for (let i = 0; i < 12 * 20; i++) {
        r.sim.tick();
        if (i % 40 === 0) out.push(drake.pos.x, drake.pos.y, drake.pos.z);
      }
      const loop = drake.dungeonPatrol;
      if (!loop) throw new Error('no loop');
      const expected = patrolPointAt(
        loop.points,
        r.sim.ctx.time * drake.moveSpeed * loop.pace + loop.offset,
      );
      expect(Math.hypot(drake.pos.x - expected.x, drake.pos.z - expected.z)).toBeLessThan(0.6);
      return out;
    };
    // Different world seeds, one flight: the loop is a pure function of time.
    expect(track(91)).toEqual(track(1234));
  }, 60_000);

  it('breaking off its flight sends the sky-landing cue; a perch dive sends the dive cue', () => {
    const r = room();
    const drake = drakeAt(r, 0);
    drake.trashKit = undefined;
    drake.pos.y += 20;
    const garg = createMob(
      r.sim.ctx.nextId++,
      MOBS.crypt_chapel_gargoyle,
      MOBS.crypt_chapel_gargoyle.minLevel,
      r.sim.ctx.groundPos(r.me.pos.x + 6, r.me.pos.z),
    );
    applyDungeonMobTuning(garg, 'hollow_crypt', r.inst.difficulty);
    r.sim.ctx.addEntity(garg);
    r.inst.mobIds.push(garg.id);
    garg.perchY = garg.pos.y + 12;
    garg.pos.y = garg.perchY;
    garg.inCombat = true;
    garg.aiState = 'attack';
    garg.aggroTargetId = r.me.id;
    tickTrashKits(r.sim.ctx);
    const cues = r.sim
      .drainEvents()
      .filter((e) => e.type === 'spellfx' && e.fx === 'windup')
      .map((e) => (e.type === 'spellfx' ? [e.sourceId, e.ability] : []));
    expect(cues).toContainEqual([drake.id, CRYPT_SKY_LANDING]);
    expect(cues).toContainEqual([garg.id, CRYPT_PERCH_DIVE]);
  });
});

/** A rest mesh's wingspan over its height (the first skinned primitive's bounds). */
function glbSpanOverHeight(url: string): number {
  const buf = readFileSync(`public/${url}`);
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as {
    meshes: { primitives: { attributes: { POSITION: number } }[] }[];
    accessors: { min: number[]; max: number[] }[];
  };
  const a = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
  return (a.max[0] - a.min[0]) / (a.max[1] - a.min[1]);
}

describe('the hero creatures on screen', () => {
  it('the drake flies, lands, bites (never claws) and plays each strike to its bar', () => {
    const v = VISUALS.mob_crypt_drake;
    expect(v.flight).toBe(true);
    expect(v.clips.jump).toBe('Fly');
    expect(v.clips.fall).toBe('Glide');
    expect(v.clips.land).toBe('Land');
    expect(v.clips.attack).toEqual(['Bite', 'Bite2']);
    expect(v.clips.castByAbility?.[CRYPT_BARROWFLAME_BREATH]).toBe('Breath');
    expect(v.clips.castPlayOut).toEqual(
      expect.arrayContaining(['Breath', 'TailSweep', 'WingBuffet']),
    );
    expect(v.castPlayOutHoldsAttacks).toBe(true);
    expect(v.clips.attackByAbility?.[CRYPT_SKY_LANDING]).toBe('SkyRoar');
    // Several times a player's height, its wings spanning the Processional's sky.
    expect(v.height).toBeGreaterThan(PLAYER_HEIGHT * 4);
  });

  it('the gargoyle perches as a statue, wakes on its dive cue, dives, slams and shrieks', () => {
    const v = VISUALS.mob_crypt_gargoyle;
    expect(v.flight).toBe(true);
    expect(v.clips.idle).toBe('Perch');
    expect(v.clips.jump).toBe('Perch');
    expect(v.clips.fall).toBe('Dive');
    expect(v.clips.land).toBe('DiveLand');
    expect(v.clips.attackByAbility?.[CRYPT_PERCH_DIVE]).toBe('Awaken');
    expect(v.clips.attack).toEqual(['ClawRake', 'ClawRake2']);
    expect(v.height).toBeGreaterThan(PLAYER_HEIGHT * 2);
    // Pass four: clearly over three times a player's height as it stands in game.
    const inGame = v.height * MOBS.crypt_chapel_gargoyle.scale;
    expect(inGame).toBeGreaterThanOrEqual(PLAYER_HEIGHT * 3);
    expect(inGame).toBeLessThanOrEqual(PLAYER_HEIGHT * 3.6);
  });

  it('ships every authored clip in the rebuilt GLBs', () => {
    const names = (file: string): string[] => {
      const buf = readFileSync(file);
      const len = buf.readUInt32LE(12);
      const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as {
        animations?: { name: string }[];
      };
      return (json.animations ?? []).map((a) => a.name);
    };
    expect(names('public/models/creatures/crypt_drake.glb')).toEqual(
      expect.arrayContaining([
        'Idle',
        'Walk',
        'Run',
        'Fly',
        'Glide',
        'Land',
        'SkyRoar',
        'Roar',
        'Bite',
        'Bite2',
        'Breath',
        'TailSweep',
        'WingBuffet',
        'Hit',
        'Death',
      ]),
    );
    expect(names('public/models/creatures/crypt_gargoyle.glb')).toEqual(
      expect.arrayContaining([
        'Perch',
        'Ready',
        'Walk',
        'Run',
        'Awaken',
        'Dive',
        'DiveLand',
        'ClawRake',
        'ClawRake2',
        'Screech',
        'Hit',
        'Death',
      ]),
    );
  });

  it('every creature the crypt spawns stands clearly over a player', () => {
    const ids = new Set<string>(HOLLOW_CRYPT_SPAWNS.map((s) => s.mobId));
    for (const t of ['crypt_bone_minion', 'crypt_bone_brute', 'crypt_carrion_crow']) ids.add(t);
    const small: string[] = [];
    for (const id of ids) {
      const t = MOBS[id];
      // Objects (egg sacs) and the open-world widow family are out of scope.
      if (!t || id === 'rime_egg_sac' || id === 'bonechill_widow') continue;
      const key = visualKeyFor({ kind: 'mob', templateId: id } as Entity);
      const tall = (VISUALS[key]?.height ?? 0) * t.scale;
      // A crow in a flock is measured by its span, not its hover height.
      const size = id === 'crypt_carrion_crow' ? tall * glbSpanOverHeight(VISUALS[key].url) : tall;
      if (size < PLAYER_HEIGHT * 1.1) small.push(`${id} (${key}) ${size.toFixed(2)}`);
    }
    expect(small).toEqual([]);
  });
});

describe('the breath on the floor matches the sim cone', () => {
  it('the drake paints its own breath (no generic orange cone on top)', () => {
    expect(paintsOwnBreath('crypt_ossuary_drake')).toBe(true);
    expect(paintsOwnBreath('crypt_ossuary_warrior')).toBe(false);
  });

  it('the breath and the other crypt strikes resolve through the sim name matcher', () => {
    for (const name of [
      'Barrowflame Breath',
      'Grave Cleave',
      'Tail Lash',
      'Wing Gust',
      'Stone Shriek',
      'Grave Bolt',
    ]) {
      expect(localizeSimAuraName(name), name).not.toBeNull();
    }
  });

  it('the telegraph is the template cone in ghost-fire colour', () => {
    const spec = cryptTelegraphSpecs()[CRYPT_BARROWFLAME_BREATH];
    const cone = drakeBreathCone();
    expect(spec.shape).toBe('cone');
    expect(spec.range).toBe(cone.range);
    expect(spec.arcDeg).toBe(cone.arcDeg);
    expect(spec.color).toBe(CRYPT_TELEGRAPH_COLORS.ghostfire);
  });

  it('the ground fire covers the whole cone, apex to rim, and never spills outside it', () => {
    const { range, arcDeg } = drakeBreathCone();
    const n = 150;
    let far = 0;
    let wideL = 0;
    let wideR = 0;
    for (let i = 0; i < n; i++) {
      const s = coneSpot(i, n, range, arcDeg, 1.2);
      expect(inConeLocal(s.x, s.z, range, arcDeg), `spot ${i}`).toBe(true);
      far = Math.max(far, s.r);
      wideL = Math.min(wideL, s.a);
      wideR = Math.max(wideR, s.a);
    }
    const half = (arcDeg * Math.PI) / 360;
    expect(far).toBeGreaterThan(range * 0.9);
    expect(wideL).toBeLessThan(-half * 0.8);
    expect(wideR).toBeGreaterThan(half * 0.8);
  });

  it('pours from the jaws over the cone apex, then fades', () => {
    const jaws = anchorWorld(DRAKE_JAWS_EXHALE, 0, 0, 0, 0, 1);
    const { range, arcDeg } = drakeBreathCone();
    expect(inConeLocal(jaws.x, jaws.z, range, arcDeg)).toBe(true);
    expect(torrentEnvelope(-0.1)).toBe(0);
    expect(torrentEnvelope(0.5)).toBe(1);
    expect(torrentEnvelope(torrentSeconds() + 0.01)).toBe(0);
  });

  it('the tail and buffet effects read the template shapes; shockwaves reach and end', () => {
    const s = drakeStrikeShapes();
    expect(s.tail.range).toBe(MOBS.crypt_ossuary_drake.trashKit?.tailLash?.range);
    expect(s.gust.radius).toBe(MOBS.crypt_ossuary_drake.trashKit?.wingGust?.radius);
    expect(shockwave(0.25, 10, 0.5).radius).toBeLessThan(10);
    expect(shockwave(0.5, 10, 0.5).done).toBe(true);
    expect(touchedDown(12, 0.1)).toBe(true);
    expect(touchedDown(0.5, 0.1)).toBe(false);
  });
});

describe('Ossuary Drake: the Barrowflame reads as fire, never ice', () => {
  it('its ghost-fire ramp is warm grave-light: green leads, blue never leads red past the embers', () => {
    let prevHeat = 0;
    for (const [h, r, g, b] of GHOST_FIRE_RAMP) {
      expect(h).toBeGreaterThan(prevHeat);
      prevHeat = h;
      // Green-led (ghostly), and never cyan: blue stays at or under red once
      // the flame is past its sooty embers.
      expect(g).toBeGreaterThanOrEqual(Math.max(r, b));
      if (h > 0.3) expect(b).toBeLessThanOrEqual(r + 0.03);
    }
    // White-hot at the core.
    const [, r, g, b] = GHOST_FIRE_RAMP[GHOST_FIRE_RAMP.length - 1];
    expect(Math.min(r, g, b)).toBeGreaterThan(0.9);
    expect(ghostFireRampGlsl()).toContain('vec3 ghostRamp(float h)');
  });

  it('its telegraph accent is green-white ghost fire, not the old turquoise', () => {
    const c = TELEGRAPH_ACCENTS.ghostfire;
    const r = (c >> 16) & 255;
    const g = (c >> 8) & 255;
    const b = c & 255;
    expect(g).toBeGreaterThan(r);
    expect(b).toBeLessThan(r);
  });
});

describe('the Knellwyrm: its own body and its own moves', () => {
  it('ships the drake set plus TakeWing, Strafe and Bellow, mapped to its mechanics', () => {
    const buf = readFileSync('public/models/creatures/crypt_knellwyrm.glb');
    const len = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as {
      animations?: { name: string }[];
    };
    const names = (json.animations ?? []).map((a) => a.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Idle',
        'Fly',
        'Glide',
        'Land',
        'Breath',
        'TailSweep',
        'WingBuffet',
        'Death',
        'TakeWing',
        'Strafe',
        'Bellow',
      ]),
    );
    const v = VISUALS[visualKeyFor({ kind: 'mob', templateId: 'crypt_knellwyrm' } as never)];
    expect(v.clips.castByAbility?.crypt_knellwyrm_pyre_strafe).toBe('TakeWing');
    expect(v.clips.castByAbility?.crypt_knellwyrm_strafe_run).toBe('Strafe');
    expect(v.clips.castByAbility?.crypt_knellwyrm_dread_bellow).toBe('Bellow');
    expect(v.clips.castByAbility?.crypt_barrowflame_breath).toBe('Breath');
    // Bigger than the drake as it stands in game.
    const wyrm = v.height * MOBS.crypt_knellwyrm.scale;
    const drake = VISUALS.mob_crypt_drake.height * MOBS.crypt_ossuary_drake.scale;
    expect(wyrm).toBeGreaterThan(drake * 1.2);
  });
});
