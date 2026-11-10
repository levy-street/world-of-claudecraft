// The Guardian of the Quench's entrance, "Under the ice" (docs/design/raid/
// smith_heart.md section 7.3, "The entrance"; encounters/smith_heart/
// quench_intro.ts) over a REAL Sim: frozen and out of reach until the raid
// first steps onto the lake, the scene's clock on her aura, her line said
// once on time, untargetable, unharmable and unpullable through the scene
// even with a raider at her side, handed back hostile at its end and pulled
// by the ordinary aggro (no pull line straight after it), a late joiner
// reading the scene where it is, a forced pull spending it, the dev replay,
// determinism.

import { describe, expect, it } from 'vitest';
import {
  SMITH_HEART_DIRECTIONS,
  SMITH_HEART_INLINE_DIRECTIONS,
} from '../scripts/voices/smith_heart_voice_pack.mjs';
import { VOICE_LINES } from '../src/game/voice_manifest.generated';
import { SMITH_HEART_DUNGEON } from '../src/sim/content/smith_heart';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { displacePlayerForDev } from '../src/sim/dev/dev_displace';
import { handleSmithHeartDevChat } from '../src/sim/dev/smith_heart_dev';
import {
  onQuenchIntroIce,
  QUENCH_AURAS,
  QUENCH_INTRO,
  QUENCH_INTRO_STAGES,
  QUENCH_LINES,
  quenchGuardian,
  quenchIntroState,
  quenchLineKey,
  quenchReadout,
} from '../src/sim/encounters/smith_heart';
import { enterDungeon } from '../src/sim/instances/dungeons';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent, type WorldContent } from '../src/sim/types';
import { yellVoiceKey } from '../src/ui/hud_voice_cues';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';
import { quenchAuraEffectDescriptor } from '../src/ui/quench_aura_effect';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

/** The Singing Ice: far from the lake. */
const FAR = { x: 156, z: -86 };
/** On the rock shelf, a few strides short of the ice: wakes nothing. */
const SHELF = { x: 192, z: -41 };
/** Just onto the ice at its southern edge: wakes her, far outside her reach. */
const EDGE = { x: 192, z: -34 };
/** At her side: inside her aggro reach. */
const SIDE = { x: 198, z: -9 };

const ticks = (s: number) => Math.round(s / DT);

function claim(seed = 7) {
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    noPlayer: true,
    world: WORLD,
    devCommands: true,
  });
  const pids = [sim.addPlayer('warrior', 'Rime1'), sim.addPlayer('warrior', 'Rime2')];
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
  const boss = () => quenchGuardian(sim.ctx, inst) as Entity;
  const run = (n: number) => {
    const out: SimEvent[] = [];
    for (let i = 0; i < n; i++) out.push(...sim.tick());
    return out;
  };
  const dev = (line: string) => handleSmithHeartDevChat(sim.ctx, line, pids[0]);
  return { sim, inst, pids, players, put, boss, run, dev };
}

const intro = (e: Entity) => e.auras.find((a) => a.id === QUENCH_AURAS.intro);
/** The `moment` lines in `ev` (one per listener: `pid` narrows to one). */
const said = (ev: SimEvent[], moment: keyof typeof QUENCH_LINES, pid?: number) =>
  ev.filter(
    (e) =>
      e.type === 'chat' &&
      (e as { textKey?: string }).textKey === quenchLineKey(moment) &&
      (pid === undefined || (e as { pid?: number }).pid === pid),
  );

describe('the wake reach: stepping onto the lake', () => {
  it('counts the ice (the lake grown a yard), never the shelf round it', () => {
    expect(onQuenchIntroIce(EDGE.x, EDGE.z)).toBe(true);
    expect(onQuenchIntroIce(SHELF.x, SHELF.z)).toBe(false);
    expect(onQuenchIntroIce(198, -2)).toBe(true);
    // Far outside her own aggro reach (16 yd): the scene plays before a pull.
    expect(Math.hypot(EDGE.x - 198, EDGE.z + 2)).toBeGreaterThan(30);
  });
});

describe('the Guardian of the Quench waits frozen', () => {
  it('lies frozen, out of reach, until a raider steps onto the ice', () => {
    const c = claim();
    c.run(3);
    const b = c.boss();
    expect(intro(b)).toMatchObject({ value: QUENCH_INTRO_STAGES.dormant, permanent: true });
    expect(b.hostile).toBe(false);
    expect(b.damageImmune).toBe(true);
    expect(b.encounterHeld).toBe(true);
    expect(c.sim.isHostileTo(c.players[0], b)).toBe(false);
    expect(quenchIntroState(b).stage).toBe('dormant');
    // The shelf wakes nothing.
    c.put(c.players[0], SHELF);
    c.run(ticks(1));
    expect(quenchIntroState(b).stage).toBe('dormant');
    // A dead raider on the ice wakes nothing either.
    c.put(c.players[1], EDGE);
    c.players[1].dead = true;
    c.run(2);
    expect(quenchIntroState(b).stage).toBe('dormant');
    c.players[1].dead = false;
    c.players[1].hp = 50000;
    // A living raider on the ice wakes her (still far outside her aggro).
    c.put(c.players[0], EDGE);
    c.run(1);
    expect(quenchIntroState(b).stage).toBe('waking');
    expect(intro(b)?.value).toBe(QUENCH_INTRO_STAGES.waking);
  });
});

describe('the entrance', () => {
  it('runs its clock on the aura, says its line once at speakAt, and holds her out of every pull and blow', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], EDGE);
    // The second raider charges straight to her side, inside her aggro reach.
    c.put(c.players[1], SIDE);
    const ev: SimEvent[] = [];
    const b = c.boss();
    const hp0 = b.hp;
    let lastLeft = Number.POSITIVE_INFINITY;
    let spokeAt = -1;
    for (let i = 0; i < ticks(QUENCH_INTRO.seconds); i++) {
      const e = c.run(1);
      ev.push(...e);
      if (spokeAt < 0 && said(e, 'intro').length > 0) spokeAt = quenchIntroState(b).t;
      const a = intro(b);
      expect(a?.value).toBe(QUENCH_INTRO_STAGES.waking);
      expect(a?.duration).toBe(QUENCH_INTRO.seconds);
      expect(a?.remaining).toBeLessThan(lastLeft);
      expect((a?.remaining ?? 0) + quenchIntroState(b).t).toBeCloseTo(QUENCH_INTRO.seconds, 6);
      lastLeft = a?.remaining ?? 0;
      // Never pulled, never touchable, never in a fight.
      expect(b.inCombat).toBe(false);
      expect(b.smithHeartQuench).toBeUndefined();
      expect(b.hostile).toBe(false);
      expect(b.damageImmune).toBe(true);
      expect(c.sim.isHostileTo(c.players[1], b)).toBe(false);
      // A blow lands nothing.
      if (i === 40) c.sim.ctx.dealDamage(c.players[1], b, 500, false, 'physical', 'Strike', 'hit');
    }
    expect(b.hp).toBe(hp0);
    // One line to each listener, its catalog key and English, on its beat.
    expect(said(ev, 'intro')).toHaveLength(2);
    expect(said(ev, 'intro')[0]).toMatchObject({
      channel: 'yell',
      text: QUENCH_LINES.intro,
      entityId: b.id,
    });
    expect(spokeAt).toBeGreaterThanOrEqual(QUENCH_INTRO.speakAt - 1e-9);
    expect(spokeAt).toBeLessThan(QUENCH_INTRO.speakAt + DT + 1e-9);
    // The scene ends: handed back, no aura (a late joiner sees her standing).
    c.run(1);
    expect(quenchIntroState(b).stage).toBe('done');
    expect(intro(b)).toBeUndefined();
    expect(b.hostile).toBe(true);
    expect(b.damageImmune).toBe(false);
    expect(b.encounterHeld).toBe(false);
    // The raider at her side pulls her the ordinary way, and her pull line
    // stays quiet (the entrance has just spoken).
    const after = c.run(3);
    expect(b.smithHeartQuench).toBeDefined();
    expect(b.inCombat).toBe(true);
    expect(said(after, 'pull')).toHaveLength(0);
  });

  it('a raider who joins mid-scene reads it where it is off the aura', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], EDGE);
    c.run(ticks(5));
    const b = c.boss();
    // A late joiner arrives: the aura tells their client how far in it is.
    const late = c.sim.addPlayer('mage', 'Rime3');
    const a = intro(b);
    expect(a?.value).toBe(QUENCH_INTRO_STAGES.waking);
    const seen = (a?.duration ?? 0) - (a?.remaining ?? 0);
    expect(seen).toBeCloseTo(quenchIntroState(b).t, 6);
    expect(seen).toBeGreaterThan(4.5);
    expect(c.sim.ctx.entities.get(late)).toBeDefined();
    // After the scene, a joiner finds no aura: she stands awake.
    c.run(ticks(QUENCH_INTRO.seconds));
    expect(intro(b)).toBeUndefined();
  });

  it('plays once: a wipe sends her home awake, and the next pull says its pull line', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], SIDE);
    c.run(ticks(QUENCH_INTRO.seconds) + 4);
    const b = c.boss();
    expect(b.smithHeartQuench).toBeDefined();
    for (const p of c.players) c.put(p, FAR);
    c.dev('/dev heart quench reset');
    c.run(ticks(2));
    expect(b.smithHeartQuench).toBeUndefined();
    expect(intro(b)).toBeUndefined();
    expect(quenchIntroState(b).stage).toBe('done');
    // Long after the entrance, the next pull speaks its own line.
    c.run(ticks(QUENCH_INTRO.pullQuiet));
    c.put(c.players[0], SIDE);
    const ev = c.run(4);
    expect(b.smithHeartQuench).toBeDefined();
    expect(said(ev, 'pull', c.players[0].id)).toHaveLength(1);
    expect(said(ev, 'intro')).toHaveLength(0);
  });

  it('a fight begun before she woke spends it (the pull says its line)', () => {
    const c = claim();
    // A raider already at her side on the claim's first tick: the ordinary
    // aggro takes her before the encounter ever held her.
    c.put(c.players[0], SIDE);
    const ev = c.run(2);
    const b = c.boss();
    expect(quenchIntroState(b).stage).toBe('done');
    expect(intro(b)).toBeUndefined();
    expect(b.smithHeartQuench).toBeDefined();
    expect(said(ev, 'pull', c.players[0].id)).toHaveLength(1);
    expect(said(ev, 'intro')).toHaveLength(0);
  });

  it('a dev mechanic forced mid-scene spends it and starts the fight', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], EDGE);
    c.run(ticks(3));
    expect(quenchIntroState(c.boss()).stage).toBe('waking');
    expect(c.dev('/dev heart quench breath')).toBe(true);
    expect(quenchIntroState(c.boss()).stage).toBe('done');
    expect(c.boss().smithHeartQuench).toBeDefined();
    expect(intro(c.boss())).toBeUndefined();
  });
});

describe('/dev heart quench intro', () => {
  it('puts her under the ice again (held a moment) and the next waker replays the whole scene', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], EDGE);
    c.run(ticks(QUENCH_INTRO.seconds) + 2);
    const b = c.boss();
    expect(quenchIntroState(b).stage).toBe('done');
    expect(c.dev('/dev heart quench intro')).toBe(true);
    expect(intro(b)?.value).toBe(QUENCH_INTRO_STAGES.dormant);
    expect(b.hostile).toBe(false);
    // Held frozen for the replay hold even with the raider on the ice.
    c.run(ticks(QUENCH_INTRO.replayHold) - 1);
    expect(quenchIntroState(b).stage).toBe('dormant');
    const ev = c.run(ticks(QUENCH_INTRO.seconds) + 4);
    expect(said(ev, 'intro', c.players[0].id)).toHaveLength(1);
    expect(quenchIntroState(b).stage).toBe('done');
  });

  it('replays from inside the fight too: the fight resets first', () => {
    const c = claim();
    c.put(c.players[0], SIDE);
    c.run(4);
    const b = c.boss();
    expect(b.smithHeartQuench).toBeDefined();
    c.dev('/dev heart quench intro');
    c.run(1);
    expect(b.smithHeartQuench).toBeUndefined();
    expect(b.inCombat).toBe(false);
    expect(intro(b)?.value).toBe(QUENCH_INTRO_STAGES.dormant);
  });
});

describe('the dev pull', () => {
  it('pulls a frozen guardian at once (her entrance spent) and keeps her fighting', () => {
    const c = claim();
    c.run(2);
    expect(quenchIntroState(c.boss()).stage).toBe('dormant');
    expect(c.dev('/dev heart quench pull')).toBe(true);
    c.run(3);
    expect(quenchIntroState(c.boss()).stage).toBe('done');
    expect(c.boss().smithHeartQuench).toBeDefined();
    expect(c.boss().inCombat).toBe(true);
  });

  it('a mechanic forced on a frozen guardian starts her fight and keeps it', () => {
    const c = claim();
    c.run(2);
    c.dev('/dev heart quench breath');
    c.run(2);
    expect(c.boss().smithHeartQuench).toBeDefined();
    expect(c.boss().inCombat).toBe(true);
  });

  it('the readout names the entrance while she is out of her fight', () => {
    const c = claim();
    c.run(2);
    expect(quenchReadout(c.sim.ctx, c.inst, c.pids[0])).toMatch(/frozen under the ice/);
    c.put(c.players[0], EDGE);
    c.run(ticks(2));
    expect(quenchReadout(c.sim.ctx, c.inst, c.pids[0])).toMatch(/entrance \d/);
  });
});

describe('the intro marker tooltip', () => {
  it('says she is out of reach until she breaks free of the ice', () => {
    const d = quenchAuraEffectDescriptor({ id: QUENCH_AURAS.intro } as never);
    expect(d).toEqual({ key: 'hudChrome.auraEffect.quenchGuardian.intro', nums: {} });
    expect(hudChromeStrings.auraEffect.quenchGuardian.intro).toMatch(/breaks free of the ice/);
    expect(hudChromeStrings.quenchGuardian.say.intro).toBe(QUENCH_LINES.intro);
  });
});

describe('determinism', () => {
  it('two runs of the same claim say and hold the same on the same ticks', () => {
    const trace = () => {
      const c = claim(11);
      c.run(2);
      c.put(c.players[0], EDGE);
      const out: string[] = [];
      for (let i = 0; i < ticks(QUENCH_INTRO.seconds) + 6; i++) {
        const ev = c.run(1);
        const a = intro(c.boss());
        out.push(
          `${i}:${a?.value ?? '-'}:${a?.remaining.toFixed(3) ?? '-'}:${said(ev, 'intro').length}:${c.boss().hostile}`,
        );
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });
});

describe('the entrance line', () => {
  it('is directed as a whisper that hardens and shipped in the voice manifest', () => {
    expect(SMITH_HEART_DIRECTIONS['quench.intro']).toBe('[soft, menacing whisper]');
    expect(SMITH_HEART_INLINE_DIRECTIONS['quench.intro']).toEqual({
      'You have woken the cold': '[hardening, cold]',
      'and the cold does not forgive': '[hard, final, menacing]',
    });
    expect(VOICE_LINES[yellVoiceKey(QUENCH_LINES.intro)]).toMatch(
      /^\/audio\/voice\/heart_quench_guardian\/yell__hush_the_lake_was_sleeping/,
    );
  });
});
