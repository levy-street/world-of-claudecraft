// The Guardian of the Breath's entrance, "Calm before the storm" (docs/design/
// raid/smith_heart.md section 7.2, "The entrance"; encounters/smith_heart/
// breath_intro.ts) over a REAL Sim: gathered into the still air and out of
// reach until the raid first climbs onto the Storm Cornice, the scene's clock
// on its aura, untargetable, unharmable and unpullable through the scene even
// with a raider at its side, no line said (wind and thunder only), handed
// back hostile at its end and pulled by the ordinary aggro (its pull line
// said as always), a late joiner reading the scene where it is, a forced
// pull spending it, the dev replay, determinism.

import { describe, expect, it } from 'vitest';
import { SMITH_HEART_DUNGEON } from '../src/sim/content/smith_heart';
import { BREATH, SMITH_HEART_BOSS_SPOTS } from '../src/sim/content/smith_heart_layout';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { displacePlayerForDev } from '../src/sim/dev/dev_displace';
import { handleSmithHeartDevChat } from '../src/sim/dev/smith_heart_dev';
import {
  BREATH_AURAS,
  BREATH_INTRO,
  BREATH_INTRO_STAGES,
  BREATH_NAMES,
  breathGuardian,
  breathIntroState,
  breathReadout,
  inBreathIntroReach,
} from '../src/sim/encounters/smith_heart';
import { breathLineKey } from '../src/sim/encounters/smith_heart/breath_voice';
import { enterDungeon } from '../src/sim/instances/dungeons';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent, type WorldContent } from '../src/sim/types';
import { breathAuraEffectDescriptor } from '../src/ui/breath_aura_effect';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

/** The Breath's third landing: far below the Cornice. */
const FAR = { x: -112, z: 170 };
/** On the climb's stairs, short of its top: wakes nothing. */
const STAIR = { x: -70, z: 191 };
/** The climb's flat top, a few strides short of the rim: wakes it, far
 *  outside its reach. */
const EDGE = { x: -54, z: 195 };
/** At its side: inside its aggro reach. */
const SIDE = { x: -6, z: 198 };

const ticks = (s: number) => Math.round(s / DT);

function claim(seed = 7) {
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    noPlayer: true,
    world: WORLD,
    devCommands: true,
  });
  const pids = [sim.addPlayer('warrior', 'Gale1'), sim.addPlayer('warrior', 'Gale2')];
  if (!enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pids[0])) throw new Error('enter');
  const inst = sim.ctx.instances.find(
    (i) => i.dungeonId === SMITH_HEART_DUNGEON && i.partyKey !== null,
  ) as InstanceSlot;
  const o = instanceOrigin(DUNGEONS[SMITH_HEART_DUNGEON].index, inst.slot);
  const players = pids.map((pid) => sim.ctx.entities.get(pid) as Entity);
  const put = (e: Entity, at: { x: number; z: number }) =>
    displacePlayerForDev(sim.ctx, e, o.x + at.x, o.z + at.z);
  for (const p of players) {
    put(p, FAR);
    p.maxHp = 50000;
    p.hp = 50000;
  }
  const boss = () => breathGuardian(sim.ctx, inst) as Entity;
  const run = (n: number) => {
    const out: SimEvent[] = [];
    for (let i = 0; i < n; i++) {
      for (const p of players) if (!p.dead) p.hp = Math.max(p.hp, 40000);
      out.push(...sim.tick());
    }
    return out;
  };
  const dev = (line: string) => handleSmithHeartDevChat(sim.ctx, line, pids[0]);
  return { sim, inst, pids, players, put, boss, run, dev };
}

const intro = (e: Entity) => e.auras.find((a) => a.id === BREATH_AURAS.intro);
/** Every boss yell in `ev` (the entrance says none). */
const yells = (ev: SimEvent[]) =>
  ev.filter((e) => e.type === 'chat' && (e as { channel?: string }).channel === 'yell');
const pullLines = (ev: SimEvent[], pid?: number) =>
  ev.filter(
    (e) =>
      e.type === 'chat' &&
      (e as { textKey?: string }).textKey === breathLineKey('guardian', 'pull') &&
      (pid === undefined || (e as { pid?: number }).pid === pid),
  );

describe('the wake reach: climbing onto the Cornice', () => {
  it('counts the climb flat top and the plateau, never the stairs below or the isles above', () => {
    const h = BREATH.cornice.h;
    expect(inBreathIntroReach(EDGE.x, EDGE.z, h)).toBe(true);
    expect(inBreathIntroReach(STAIR.x, STAIR.z, h - 3)).toBe(false);
    expect(inBreathIntroReach(FAR.x, FAR.z, 40)).toBe(false);
    // A floating isle (26 yd and more over the Cornice) is out of the band.
    expect(inBreathIntroReach(31, 139, h + 26)).toBe(false);
    // Far outside its own aggro reach: the scene plays before a pull.
    const at = SMITH_HEART_BOSS_SPOTS.breath;
    expect(Math.hypot(EDGE.x - at.x, EDGE.z - at.z)).toBeGreaterThan(45);
    expect(BREATH_INTRO.reach).toBe(58);
  });
});

describe('the Guardian of the Breath waits in the still air', () => {
  it('waits gathered, out of reach, until a raider climbs onto the Cornice', () => {
    const c = claim();
    c.run(3);
    const b = c.boss();
    expect(intro(b)).toMatchObject({ value: BREATH_INTRO_STAGES.dormant, permanent: true });
    expect(intro(b)?.name).toBe(BREATH_NAMES.intro);
    expect(b.hostile).toBe(false);
    expect(b.damageImmune).toBe(true);
    expect(b.encounterHeld).toBe(true);
    expect(c.sim.isHostileTo(c.players[0], b)).toBe(false);
    expect(breathIntroState(b).stage).toBe('dormant');
    // The stairs wake nothing.
    c.put(c.players[0], STAIR);
    c.run(ticks(1));
    expect(breathIntroState(b).stage).toBe('dormant');
    // A dead raider on the plateau wakes nothing either.
    c.put(c.players[1], EDGE);
    c.players[1].dead = true;
    c.run(2);
    expect(breathIntroState(b).stage).toBe('dormant');
    c.players[1].dead = false;
    c.players[1].hp = 50000;
    // A living raider on the climb's top wakes it.
    c.put(c.players[0], EDGE);
    c.run(1);
    expect(breathIntroState(b).stage).toBe('waking');
    expect(intro(b)?.value).toBe(BREATH_INTRO_STAGES.waking);
  });
});

describe('the entrance', () => {
  it('runs its clock on the aura, says nothing, and holds it out of every pull and blow', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], EDGE);
    // The second raider charges straight to its side, inside its aggro reach.
    c.put(c.players[1], SIDE);
    const ev: SimEvent[] = [];
    const b = c.boss();
    const hp0 = b.hp;
    let lastLeft = Number.POSITIVE_INFINITY;
    for (let i = 0; i < ticks(BREATH_INTRO.seconds); i++) {
      ev.push(...c.run(1));
      const a = intro(b);
      expect(a?.value).toBe(BREATH_INTRO_STAGES.waking);
      expect(a?.duration).toBe(BREATH_INTRO.seconds);
      expect(a?.remaining).toBeLessThan(lastLeft);
      expect((a?.remaining ?? 0) + breathIntroState(b).t).toBeCloseTo(BREATH_INTRO.seconds, 6);
      lastLeft = a?.remaining ?? 0;
      // Never pulled, never touchable, never in a fight.
      expect(b.inCombat).toBe(false);
      expect(b.smithHeartBreath).toBeUndefined();
      expect(b.hostile).toBe(false);
      expect(b.damageImmune).toBe(true);
      expect(c.sim.isHostileTo(c.players[1], b)).toBe(false);
      // A blow lands nothing.
      if (i === 40) c.sim.ctx.dealDamage(c.players[1], b, 500, false, 'physical', 'Strike', 'hit');
    }
    expect(b.hp).toBe(hp0);
    // Wind and thunder only: no voice.
    expect(yells(ev)).toHaveLength(0);
    // The scene ends: handed back, no aura (a late joiner sees it floating).
    c.run(1);
    expect(breathIntroState(b).stage).toBe('done');
    expect(intro(b)).toBeUndefined();
    expect(b.hostile).toBe(true);
    expect(b.damageImmune).toBe(false);
    expect(b.encounterHeld).toBe(false);
    // The raider at its side pulls it the ordinary way, and its pull line is
    // said (the entrance spoke none).
    const after = c.run(3);
    expect(b.smithHeartBreath).toBeDefined();
    expect(b.inCombat).toBe(true);
    expect(pullLines(after, c.players[0].id)).toHaveLength(1);
  });

  it('a raider who joins mid-scene reads it where it is off the aura', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], EDGE);
    c.run(ticks(5));
    const b = c.boss();
    const late = c.sim.addPlayer('mage', 'Gale3');
    const a = intro(b);
    expect(a?.value).toBe(BREATH_INTRO_STAGES.waking);
    const seen = (a?.duration ?? 0) - (a?.remaining ?? 0);
    expect(seen).toBeCloseTo(breathIntroState(b).t, 6);
    expect(seen).toBeGreaterThan(4.5);
    expect(c.sim.ctx.entities.get(late)).toBeDefined();
    // After the scene, a joiner finds no aura: it floats awake.
    c.run(ticks(BREATH_INTRO.seconds));
    expect(intro(b)).toBeUndefined();
  });

  it('plays once: a wipe sends it home awake', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], SIDE);
    c.run(ticks(BREATH_INTRO.seconds) + 4);
    const b = c.boss();
    expect(b.smithHeartBreath).toBeDefined();
    for (const p of c.players) c.put(p, FAR);
    c.dev('/dev heart breath reset');
    c.run(ticks(2));
    expect(b.smithHeartBreath).toBeUndefined();
    expect(intro(b)).toBeUndefined();
    expect(breathIntroState(b).stage).toBe('done');
    expect(b.hostile).toBe(true);
    // Back on the Cornice: no second scene, the ordinary pull at once.
    c.put(c.players[0], SIDE);
    c.run(4);
    expect(b.smithHeartBreath).toBeDefined();
    expect(intro(b)).toBeUndefined();
  });

  it('a fight begun before it woke spends it (the pull says its line)', () => {
    const c = claim();
    c.put(c.players[0], SIDE);
    const ev = c.run(2);
    const b = c.boss();
    expect(breathIntroState(b).stage).toBe('done');
    expect(intro(b)).toBeUndefined();
    expect(b.smithHeartBreath).toBeDefined();
    expect(pullLines(ev, c.players[0].id)).toHaveLength(1);
  });

  it('a dev mechanic forced mid-scene spends it and starts the fight', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], EDGE);
    c.run(ticks(3));
    expect(breathIntroState(c.boss()).stage).toBe('waking');
    expect(c.dev('/dev heart breath calm')).toBe(true);
    expect(breathIntroState(c.boss()).stage).toBe('done');
    expect(c.boss().smithHeartBreath).toBeDefined();
    expect(intro(c.boss())).toBeUndefined();
  });

  it('a dev kill while it waits leaves nothing gathered', () => {
    const c = claim();
    c.run(2);
    expect(c.dev('/dev heart kill breath')).toBe(true);
    c.run(2);
    expect(c.boss().dead).toBe(true);
    expect(intro(c.boss())).toBeUndefined();
    expect(breathIntroState(c.boss()).stage).toBe('done');
  });
});

describe('/dev heart breath intro', () => {
  it('gathers it again (held a moment) and the next waker replays the whole scene', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], EDGE);
    c.run(ticks(BREATH_INTRO.seconds) + 2);
    const b = c.boss();
    expect(breathIntroState(b).stage).toBe('done');
    expect(c.dev('/dev heart breath intro')).toBe(true);
    expect(intro(b)?.value).toBe(BREATH_INTRO_STAGES.dormant);
    expect(b.hostile).toBe(false);
    // Held for the replay hold even with the raider on the plateau.
    c.run(ticks(BREATH_INTRO.replayHold) - 1);
    expect(breathIntroState(b).stage).toBe('dormant');
    c.run(2);
    expect(breathIntroState(b).stage).toBe('waking');
    c.run(ticks(BREATH_INTRO.seconds) + 2);
    expect(breathIntroState(b).stage).toBe('done');
  });

  it('replays from inside the fight too: the fight resets first', () => {
    const c = claim();
    c.put(c.players[0], SIDE);
    c.run(4);
    const b = c.boss();
    expect(b.smithHeartBreath).toBeDefined();
    c.dev('/dev heart breath intro');
    c.run(1);
    expect(b.smithHeartBreath).toBeUndefined();
    expect(b.inCombat).toBe(false);
    expect(intro(b)?.value).toBe(BREATH_INTRO_STAGES.dormant);
  });
});

describe('the dev pull', () => {
  it('pulls a gathered guardian at once (its entrance spent) and keeps it fighting', () => {
    const c = claim();
    c.run(2);
    expect(breathIntroState(c.boss()).stage).toBe('dormant');
    expect(c.dev('/dev heart breath pull')).toBe(true);
    c.run(3);
    expect(breathIntroState(c.boss()).stage).toBe('done');
    expect(c.boss().smithHeartBreath).toBeDefined();
    expect(c.boss().inCombat).toBe(true);
  });

  it('the readout names the entrance while it is out of its fight', () => {
    const c = claim();
    c.run(2);
    expect(breathReadout(c.sim.ctx, c.inst)).toMatch(/gathered in the still air/);
    c.put(c.players[0], EDGE);
    c.run(ticks(2));
    expect(breathReadout(c.sim.ctx, c.inst)).toMatch(/entrance \d/);
  });
});

describe('the intro marker tooltip', () => {
  it('says it is out of reach until the storm sets it down', () => {
    const d = breathAuraEffectDescriptor({ id: BREATH_AURAS.intro } as never);
    expect(d).toEqual({ key: 'hudChrome.auraEffect.breathGuardian.intro', nums: {} });
    expect(hudChromeStrings.auraEffect.breathGuardian.intro).toMatch(
      /until the storm sets it down/,
    );
  });
});

describe('determinism', () => {
  it('two runs of the same claim hold and release on the same ticks', () => {
    const trace = () => {
      const c = claim(11);
      c.run(2);
      c.put(c.players[0], EDGE);
      const out: string[] = [];
      for (let i = 0; i < ticks(BREATH_INTRO.seconds) + 6; i++) {
        c.run(1);
        const a = intro(c.boss());
        out.push(`${i}:${a?.value ?? '-'}:${a?.remaining.toFixed(3) ?? '-'}:${c.boss().hostile}`);
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });
});
