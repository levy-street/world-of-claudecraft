// The Hammer Council's entrance, "The quarry wakes" (docs/design/raid/
// smith_heart.md section 7.1, "The entrance"; encounters/smith_heart/
// council_intro.ts) over a REAL Sim: both members asleep and out of reach
// until the raid first comes down into the Quarry, the scene's clock on an
// aura on EACH member, the Guardian's and the Singer's pull lines said once
// each on their beats, both untargetable, unharmable and unpullable through
// the scene even with raiders at their sides, both handed back hostile at
// its end and pulled by the ordinary aggro (no pull lines straight after
// it), a late joiner reading the scene where it is, a forced pull spending
// it, the dev replay, determinism, and the lines' shipped clips.

import { describe, expect, it } from 'vitest';
import { VOICE_LINES } from '../src/game/voice_manifest.generated';
import { SMITH_HEART_DUNGEON } from '../src/sim/content/smith_heart';
import { HAMMER_PIT, SMITH_HEART_BOSS_SPOTS } from '../src/sim/content/smith_heart_layout';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { displacePlayerForDev } from '../src/sim/dev/dev_displace';
import { handleSmithHeartDevChat } from '../src/sim/dev/smith_heart_dev';
import {
  COUNCIL_AURAS,
  COUNCIL_INTRO,
  COUNCIL_INTRO_STAGES,
  COUNCIL_NAMES,
  COUNCIL_ROLES,
  councilBodies,
  councilIntroState,
  councilReadout,
  councilState,
  inCouncilIntroReach,
} from '../src/sim/encounters/smith_heart';
import { COUNCIL_LINES, councilLineKey } from '../src/sim/encounters/smith_heart/council_voice';
import { enterDungeon } from '../src/sim/instances/dungeons';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type SimEvent, type WorldContent } from '../src/sim/types';
import { councilAuraEffectDescriptor } from '../src/ui/council_aura_effect';
import { yellVoiceKey } from '../src/ui/hud_voice_cues';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

/** The Gallery's lower landing: far above and outside the quarry. */
const FAR = { x: -66, z: -206 };
/** The Pit Mouth, where the raid comes down: wakes the quarry, far outside
 *  either member's aggro reach (16 yd). */
const MOUTH = { x: -22, z: -172 };
/** At the Guardian's side and the Singer's: inside each one's aggro reach. */
const GUARDIAN_SIDE = { x: HAMMER_PIT.x - 4, z: HAMMER_PIT.z - 2 };
const SINGER_SIDE = {
  x: SMITH_HEART_BOSS_SPOTS.seamSinger.x - 3,
  z: SMITH_HEART_BOSS_SPOTS.seamSinger.z + 2,
};

const ticks = (s: number) => Math.round(s / DT);

function claim(seed = 7) {
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    noPlayer: true,
    world: WORLD,
    devCommands: true,
  });
  const pids = [
    sim.addPlayer('warrior', 'Quarry1'),
    sim.addPlayer('warrior', 'Quarry2'),
    sim.addPlayer('warrior', 'Quarry3'),
  ];
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
  const bodies = () => {
    const b = councilBodies(sim.ctx, inst);
    if (!b?.guardian || !b.singer) throw new Error('no council');
    return { guardian: b.guardian, singer: b.singer };
  };
  const run = (n: number) => {
    const out: SimEvent[] = [];
    for (let i = 0; i < n; i++) out.push(...sim.tick());
    return out;
  };
  const dev = (line: string) => handleSmithHeartDevChat(sim.ctx, line, pids[0]);
  return { sim, inst, pids, players, put, bodies, run, dev, o };
}

const intro = (e: Entity) => e.auras.find((a) => a.id === COUNCIL_AURAS.intro);
/** `role`'s `moment` lines in `ev` (one per listener: `pid` narrows to one). */
const said = (ev: SimEvent[], role: 'guardian' | 'singer', moment: 'pull' | 'wipe', pid?: number) =>
  ev.filter(
    (e) =>
      e.type === 'chat' &&
      (e as { textKey?: string }).textKey === councilLineKey(role, moment) &&
      (pid === undefined || (e as { pid?: number }).pid === pid),
  );

describe('the wake reach: coming down into the quarry', () => {
  it('counts the pit and the last flight of the stair, never the Gallery above', () => {
    expect(inCouncilIntroReach(MOUTH.x, MOUTH.z, HAMMER_PIT.h)).toBe(true);
    expect(inCouncilIntroReach(HAMMER_PIT.x, HAMMER_PIT.z, HAMMER_PIT.h)).toBe(true);
    // Too far out, or too far over the floor.
    expect(inCouncilIntroReach(FAR.x, FAR.z, HAMMER_PIT.h + 14)).toBe(false);
    expect(inCouncilIntroReach(HAMMER_PIT.x - 60, HAMMER_PIT.z, HAMMER_PIT.h)).toBe(false);
    expect(
      inCouncilIntroReach(HAMMER_PIT.x, HAMMER_PIT.z, HAMMER_PIT.h + COUNCIL_INTRO.band + 1),
    ).toBe(false);
    // The Pit Mouth is far outside both members' aggro reach (16 yd): the
    // scene plays before a pull could.
    expect(Math.hypot(MOUTH.x - HAMMER_PIT.x, MOUTH.z - HAMMER_PIT.z)).toBeGreaterThan(25);
    const s = SMITH_HEART_BOSS_SPOTS.seamSinger;
    expect(Math.hypot(MOUTH.x - s.x, MOUTH.z - s.z)).toBeGreaterThan(25);
  });
});

describe('the council sleeps', () => {
  it('both lie dormant and out of reach until a living raider comes down', () => {
    const c = claim();
    c.run(3);
    const b = c.bodies();
    for (const r of COUNCIL_ROLES) {
      expect(intro(b[r]), r).toMatchObject({
        value: COUNCIL_INTRO_STAGES.dormant,
        permanent: true,
        name: COUNCIL_NAMES.intro,
      });
      expect(b[r].hostile, r).toBe(false);
      expect(b[r].damageImmune, r).toBe(true);
      expect(b[r].encounterHeld, r).toBe(true);
      expect(c.sim.isHostileTo(c.players[0], b[r]), r).toBe(false);
    }
    // ONE state the two share.
    expect(councilIntroState(b)).toBe(councilIntroState({ guardian: b.guardian, singer: null }));
    expect(councilIntroState(b)).toBe(councilIntroState({ guardian: null, singer: b.singer }));
    expect(councilIntroState(b).stage).toBe('dormant');
    // The Gallery wakes nothing.
    c.run(ticks(1));
    expect(councilIntroState(b).stage).toBe('dormant');
    // A dead raider at the Pit Mouth wakes nothing either.
    c.put(c.players[1], MOUTH);
    c.players[1].dead = true;
    c.run(2);
    expect(councilIntroState(b).stage).toBe('dormant');
    c.players[1].dead = false;
    c.players[1].hp = 50000;
    // A living raider at the Pit Mouth wakes the quarry.
    c.put(c.players[0], MOUTH);
    c.run(1);
    expect(councilIntroState(b).stage).toBe('waking');
    for (const r of COUNCIL_ROLES) expect(intro(b[r])?.value, r).toBe(COUNCIL_INTRO_STAGES.waking);
  });
});

describe('the entrance', () => {
  it('runs one clock on both auras, says each line once on its beat, and holds BOTH out of every pull and blow', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], MOUTH);
    // Two raiders charge straight to the Guardian's side and the Singer's,
    // inside each one's aggro reach.
    c.put(c.players[1], GUARDIAN_SIDE);
    c.put(c.players[2], SINGER_SIDE);
    const b = c.bodies();
    const hp0 = { guardian: b.guardian.hp, singer: b.singer.hp };
    const spokeAt = { guardian: -1, singer: -1 };
    const ev: SimEvent[] = [];
    let lastLeft = Number.POSITIVE_INFINITY;
    for (let i = 0; i < ticks(COUNCIL_INTRO.seconds); i++) {
      const e = c.run(1);
      ev.push(...e);
      const t = councilIntroState(b).t;
      for (const r of COUNCIL_ROLES) {
        if (spokeAt[r] < 0 && said(e, r, 'pull').length > 0) spokeAt[r] = t;
        const a = intro(b[r]);
        expect(a?.value, r).toBe(COUNCIL_INTRO_STAGES.waking);
        expect(a?.duration, r).toBe(COUNCIL_INTRO.seconds);
        expect((a?.remaining ?? 0) + t, r).toBeCloseTo(COUNCIL_INTRO.seconds, 6);
        // Never pulled, never touchable, never in a fight.
        expect(b[r].inCombat, r).toBe(false);
        expect(b[r].hostile, r).toBe(false);
        expect(b[r].damageImmune, r).toBe(true);
        expect(b[r].aggroTargetId, r).toBeNull();
        expect(c.sim.isHostileTo(c.players[1], b[r]), r).toBe(false);
      }
      expect(intro(b.guardian)?.remaining).toBeLessThan(lastLeft);
      lastLeft = intro(b.guardian)?.remaining ?? 0;
      expect(councilState(b)).toBeNull();
      // A blow lands nothing on either.
      if (i === 40) {
        c.sim.ctx.dealDamage(c.players[1], b.guardian, 500, false, 'physical', 'Strike', 'hit');
        c.sim.ctx.dealDamage(c.players[2], b.singer, 500, false, 'physical', 'Strike', 'hit');
      }
    }
    expect(b.guardian.hp).toBe(hp0.guardian);
    expect(b.singer.hp).toBe(hp0.singer);
    // Each member's pull line once to each listener (three raiders), its
    // catalog key and English, from its own body, on its own beat.
    expect(said(ev, 'guardian', 'pull')).toHaveLength(3);
    expect(said(ev, 'singer', 'pull')).toHaveLength(3);
    expect(said(ev, 'guardian', 'pull')[0]).toMatchObject({
      channel: 'yell',
      text: COUNCIL_LINES.guardian.pull,
      entityId: b.guardian.id,
    });
    expect(said(ev, 'singer', 'pull')[0]).toMatchObject({
      channel: 'yell',
      text: COUNCIL_LINES.singer.pull,
      entityId: b.singer.id,
    });
    expect(spokeAt.guardian).toBeGreaterThanOrEqual(COUNCIL_INTRO.guardianSpeakAt - 1e-9);
    expect(spokeAt.guardian).toBeLessThan(COUNCIL_INTRO.guardianSpeakAt + DT + 1e-9);
    expect(spokeAt.singer).toBeGreaterThanOrEqual(COUNCIL_INTRO.singerSpeakAt - 1e-9);
    expect(spokeAt.singer).toBeLessThan(COUNCIL_INTRO.singerSpeakAt + DT + 1e-9);
    // The Guardian's clip (6.2 s) is done before the Singer starts.
    expect(COUNCIL_INTRO.singerSpeakAt - COUNCIL_INTRO.guardianSpeakAt).toBeGreaterThan(6);
    // The scene ends: both handed back, no aura (a late joiner sees them
    // standing).
    c.run(1);
    expect(councilIntroState(b).stage).toBe('done');
    for (const r of COUNCIL_ROLES) {
      expect(intro(b[r]), r).toBeUndefined();
      expect(b[r].hostile, r).toBe(true);
      expect(b[r].damageImmune, r).toBe(false);
      expect(b[r].encounterHeld, r).toBe(false);
    }
    // The raiders at their sides pull them the ordinary way, and the pull's
    // lines stay quiet (the entrance has just said them).
    const after = c.run(ticks(PULL_WINDOW));
    expect(councilState(b)).not.toBeNull();
    expect(b.guardian.inCombat).toBe(true);
    expect(b.singer.inCombat).toBe(true);
    expect(said(after, 'guardian', 'pull')).toHaveLength(0);
    expect(said(after, 'singer', 'pull')).toHaveLength(0);
  });

  it('a raider who joins mid-scene reads it where it is off either aura', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], MOUTH);
    c.run(ticks(6));
    const b = c.bodies();
    const late = c.sim.addPlayer('mage', 'Quarry4');
    for (const r of COUNCIL_ROLES) {
      const a = intro(b[r]);
      expect(a?.value, r).toBe(COUNCIL_INTRO_STAGES.waking);
      const seen = (a?.duration ?? 0) - (a?.remaining ?? 0);
      expect(seen, r).toBeCloseTo(councilIntroState(b).t, 6);
      expect(seen, r).toBeGreaterThan(5.5);
    }
    expect(c.sim.ctx.entities.get(late)).toBeDefined();
    // After the scene, a joiner finds no aura: both stand awake.
    c.run(ticks(COUNCIL_INTRO.seconds));
    for (const r of COUNCIL_ROLES) expect(intro(b[r]), r).toBeUndefined();
  });

  it('plays once: a wipe sends them home awake, and the next pull says its lines', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], GUARDIAN_SIDE);
    c.run(ticks(COUNCIL_INTRO.seconds) + 4);
    const b = c.bodies();
    expect(councilState(b)).not.toBeNull();
    for (const p of c.players) c.put(p, FAR);
    c.dev('/dev heart council reset');
    c.run(ticks(2));
    expect(councilState(b)).toBeNull();
    for (const r of COUNCIL_ROLES) expect(intro(b[r]), r).toBeUndefined();
    expect(councilIntroState(b).stage).toBe('done');
    // Long after the entrance, the next pull speaks its own lines.
    c.run(ticks(COUNCIL_INTRO.pullQuiet));
    c.put(c.players[0], GUARDIAN_SIDE);
    const ev = c.run(ticks(PULL_WINDOW));
    expect(councilState(b)).not.toBeNull();
    expect(said(ev, 'guardian', 'pull', c.players[0].id)).toHaveLength(1);
    expect(said(ev, 'singer', 'pull', c.players[0].id)).toHaveLength(1);
  });

  it('a fight begun before the quarry woke spends it (the pull says its lines)', () => {
    const c = claim();
    // A raider already at the Guardian's side on the claim's first tick:
    // the ordinary aggro takes it before the encounter ever held it.
    c.put(c.players[0], GUARDIAN_SIDE);
    const ev = c.run(ticks(PULL_WINDOW));
    const b = c.bodies();
    expect(councilIntroState(b).stage).toBe('done');
    for (const r of COUNCIL_ROLES) expect(intro(b[r]), r).toBeUndefined();
    expect(councilState(b)).not.toBeNull();
    expect(said(ev, 'guardian', 'pull', c.players[0].id)).toHaveLength(1);
    expect(said(ev, 'singer', 'pull', c.players[0].id)).toHaveLength(1);
  });

  it('a dev mechanic forced mid-scene spends it and starts the fight', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], MOUTH);
    c.run(ticks(3));
    const b = c.bodies();
    expect(councilIntroState(b).stage).toBe('waking');
    expect(c.dev('/dev heart council wrath')).toBe(true);
    expect(councilIntroState(b).stage).toBe('done');
    expect(councilState(b)).not.toBeNull();
    for (const r of COUNCIL_ROLES) expect(intro(b[r]), r).toBeUndefined();
  });

  it('a member killed before the quarry woke: the other plays it alone and says only its own line', () => {
    const c = claim();
    c.run(2);
    expect(c.dev('/dev heart kill singer')).toBe(true);
    c.run(1);
    const b = c.bodies();
    expect(b.singer.dead).toBe(true);
    c.put(c.players[0], MOUTH);
    const ev = c.run(ticks(COUNCIL_INTRO.seconds) + 2);
    expect(said(ev, 'guardian', 'pull', c.players[0].id)).toHaveLength(1);
    expect(said(ev, 'singer', 'pull')).toHaveLength(0);
    expect(councilIntroState(b).stage).toBe('done');
    expect(b.guardian.hostile).toBe(true);
  });
});

/** Ticks enough for the pull's two lines (council_voice.ts PULL_FIRST plus
 *  PULL_GAP) to have been said, were they going to be. */
const PULL_WINDOW = 6;

describe('a fight forced mid-scene', () => {
  it('after only the Guardian spoke: the Singer still says her pull line, the Guardian does not repeat his', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], MOUTH);
    c.run(ticks(COUNCIL_INTRO.guardianSpeakAt + 1));
    const b = c.bodies();
    expect(councilIntroState(b).spoke.guardian).toBe(true);
    expect(councilIntroState(b).spoke.singer).toBe(false);
    c.put(c.players[0], GUARDIAN_SIDE);
    expect(c.dev('/dev heart council pull')).toBe(true);
    const ev = c.run(ticks(PULL_WINDOW));
    expect(councilState(b)).not.toBeNull();
    expect(said(ev, 'guardian', 'pull')).toHaveLength(0);
    expect(said(ev, 'singer', 'pull', c.players[0].id)).toHaveLength(1);
  });

  it('both killed while asleep: nothing is left held in the stone', () => {
    const c = claim();
    c.run(2);
    c.dev('/dev heart kill council');
    c.run(2);
    const b = c.bodies();
    expect(councilIntroState(b).stage).toBe('done');
    for (const r of COUNCIL_ROLES) {
      expect(intro(b[r]), r).toBeUndefined();
      expect(b[r].encounterHeld, r).toBe(false);
    }
  });
});

describe('/dev heart council intro', () => {
  it('puts both to sleep again (held a moment) and the next waker replays the whole scene', () => {
    const c = claim();
    c.run(2);
    c.put(c.players[0], MOUTH);
    c.run(ticks(COUNCIL_INTRO.seconds) + 2);
    const b = c.bodies();
    expect(councilIntroState(b).stage).toBe('done');
    expect(c.dev('/dev heart council intro')).toBe(true);
    for (const r of COUNCIL_ROLES) {
      expect(intro(b[r])?.value, r).toBe(COUNCIL_INTRO_STAGES.dormant);
      expect(b[r].hostile, r).toBe(false);
    }
    // Held asleep for the replay hold even with the raider in the pit.
    c.run(ticks(COUNCIL_INTRO.replayHold) - 1);
    expect(councilIntroState(b).stage).toBe('dormant');
    const ev = c.run(ticks(COUNCIL_INTRO.seconds) + 4);
    expect(said(ev, 'guardian', 'pull', c.players[0].id)).toHaveLength(1);
    expect(said(ev, 'singer', 'pull', c.players[0].id)).toHaveLength(1);
    expect(councilIntroState(b).stage).toBe('done');
  });

  it('replays from inside the fight too: the fight resets first', () => {
    const c = claim();
    c.put(c.players[0], GUARDIAN_SIDE);
    c.run(4);
    const b = c.bodies();
    expect(councilState(b)).not.toBeNull();
    c.dev('/dev heart council intro');
    c.run(1);
    expect(councilState(b)).toBeNull();
    for (const r of COUNCIL_ROLES) {
      expect(b[r].inCombat, r).toBe(false);
      expect(intro(b[r])?.value, r).toBe(COUNCIL_INTRO_STAGES.dormant);
    }
  });
});

describe('the dev pull', () => {
  it('pulls a sleeping council at once (the entrance spent) and keeps both fighting', () => {
    const c = claim();
    c.run(2);
    expect(councilIntroState(c.bodies()).stage).toBe('dormant');
    expect(c.dev('/dev heart council pull')).toBe(true);
    c.run(3);
    const b = c.bodies();
    expect(councilIntroState(b).stage).toBe('done');
    expect(councilState(b)).not.toBeNull();
    expect(b.guardian.inCombat).toBe(true);
    expect(b.singer.inCombat).toBe(true);
  });

  it('a mechanic forced on a sleeping council starts its fight and keeps it', () => {
    const c = claim();
    c.run(2);
    c.dev('/dev heart council wake');
    c.run(2);
    const b = c.bodies();
    expect(councilState(b)).not.toBeNull();
    expect(b.guardian.inCombat || b.singer.inCombat).toBe(true);
  });

  it('the readout names the entrance while the council is out of its fight', () => {
    const c = claim();
    c.run(2);
    expect(councilReadout(c.sim.ctx, c.inst)).toMatch(/asleep in the rock and the crystal/);
    c.put(c.players[0], MOUTH);
    c.run(ticks(2));
    expect(councilReadout(c.sim.ctx, c.inst)).toMatch(/entrance \d/);
  });
});

describe('the intro marker tooltip and name', () => {
  it('says they are out of reach until the quarry wakes, under the shared Dormant name', () => {
    const d = councilAuraEffectDescriptor({ id: COUNCIL_AURAS.intro } as never);
    expect(d).toEqual({ key: 'hudChrome.auraEffect.council.intro', nums: {} });
    expect(hudChromeStrings.auraEffect.council.intro).toMatch(/cannot be attacked or harmed/);
    // The marker's name is the Hammer Vein Warder's (already localized).
    expect(COUNCIL_NAMES.intro).toBe('Dormant');
    expect(localizeSimAuraName(COUNCIL_NAMES.intro)).toBe('Dormant');
  });
});

describe('determinism', () => {
  it('two runs of the same claim say and hold the same on the same ticks', () => {
    const trace = () => {
      const c = claim(11);
      c.run(2);
      c.put(c.players[0], MOUTH);
      const out: string[] = [];
      for (let i = 0; i < ticks(COUNCIL_INTRO.seconds) + 6; i++) {
        const ev = c.run(1);
        const b = c.bodies();
        const a = intro(b.guardian);
        out.push(
          `${i}:${a?.value ?? '-'}:${a?.remaining.toFixed(3) ?? '-'}:${said(ev, 'guardian', 'pull').length}:${said(ev, 'singer', 'pull').length}:${b.guardian.hostile}:${b.singer.hostile}`,
        );
      }
      return out.join('|');
    };
    expect(trace()).toBe(trace());
  });
});

describe('the entrance lines', () => {
  it('are the council pull lines, already recorded and shipped in the voice manifest', () => {
    expect(hudChromeStrings.council.say.guardian_pull).toBe(COUNCIL_LINES.guardian.pull);
    expect(hudChromeStrings.council.say.singer_pull).toBe(COUNCIL_LINES.singer.pull);
    expect(VOICE_LINES[yellVoiceKey(COUNCIL_LINES.guardian.pull as string)]).toMatch(
      /^\/audio\/voice\/heart_hammer_guardian\/yell__strangers_in_the_quarry/,
    );
    expect(VOICE_LINES[yellVoiceKey(COUNCIL_LINES.singer.pull as string)]).toMatch(
      /^\/audio\/voice\/heart_seam_singer\/yell__hear_the_seam_sing/,
    );
  });
});
