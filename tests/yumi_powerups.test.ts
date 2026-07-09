// Protect Yumi mystery power-ups (src/sim/social/yumi_powerups.ts): spawn
// cadence + fair reachable placement, the type stays hidden on the ground view,
// each of the four effects (invuln / stealth / endless mana / berserker), the
// one-at-a-time replace rule, and the mode-based objective HP (7500 vs 12500).

import { describe, expect, it } from 'vitest';
import { consumeNextCastFree, hasNextCastFree } from '../src/sim/combat/empower_next';
import { MOBS, yumiMazeOrigin } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { cleanupYumiMatch, yumiHpFor } from '../src/sim/social/yumi';
import {
  applyMysteryPowerup,
  isMysteryPowerupAura,
  MYSTERY_POWERUPS,
  spawnYumiPowerup,
  startYumiGrab,
  stopYumiGrab,
  updateYumiPowerups,
  YUMI_BERSERK_DMG_MULT,
  YUMI_BERSERK_TAKEN_MULT,
  YUMI_POWERUP_DURATION,
  YUMI_POWERUP_GRAB_TIME,
  yumiNextPowerupIn,
  yumiPowerupViews,
} from '../src/sim/social/yumi_powerups';
import { type Aura, DT, type Entity, type SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { teleportPoints, yumiMazeLayout } from '../src/sim/yumi_maze_layout';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

function makeWorld(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

// Queue N solos into a live yumi bout (yumi3 = 6 players, yumi5 = 10).
function startYumi(format: 'yumi3' | 'yumi5', seed = 7) {
  const sim = makeWorld(seed);
  const n = format === 'yumi3' ? 6 : 10;
  const pids = Array.from({ length: n }, (_, i) =>
    sim.addPlayer(i % 2 === 0 ? 'warrior' : 'mage', `P${i}`),
  );
  pids.forEach((p, i) => {
    teleport(sim, p, i * 4, -40);
  });
  pids.forEach((p) => {
    sim.arenaQueueJoin(p, format);
  });
  sim.tick(); // matchmake
  for (let i = 0; i < 20 * 8; i++) {
    const m = sim.arenaMatchFor(pids[0]);
    if (m && m.state === 'active') break;
    sim.tick();
  }
  const match = sim.arenaMatchFor(pids[0])!;
  const ctx = (sim as any).ctx;
  return { sim, match, pids, ctx };
}

// Two plain players NOT in any match, so dealDamage never routes through the
// arena bench/death flow: a clean bench to exercise the damage hooks.
function duelWorld() {
  const sim = makeWorld(3);
  const a = sim.addPlayer('warrior', 'A');
  const b = sim.addPlayer('mage', 'B');
  return {
    sim,
    ctx: (sim as any).ctx,
    a: sim.entities.get(a)!,
    b: sim.entities.get(b)!,
  };
}

const hit = (sim: Sim, src: Entity, tgt: Entity, amount: number) =>
  (sim as any).dealDamage(src, tgt, amount, false, 'physical', null, 'hit');

// A player attacker + a fresh 5000 hp hostile mob target: dealDamage applies the
// amount VERBATIM to a mob (no player-vs-player dampening), so the damage hooks
// read cleanly. Mirrors the spawnHostileMob idiom in tests/combat_damage.test.ts.
function mobWorld() {
  const sim = new Sim({ seed: 9, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(10);
  const p = sim.player as Entity;
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 5, {
    x: p.pos.x + 2,
    y: p.pos.y,
    z: p.pos.z,
  }) as Entity;
  mob.hostile = true;
  mob.maxHp = 5000;
  mob.hp = 5000;
  sim.addEntity(mob);
  return { sim, ctx: sim.ctx, p, mob };
}

describe('yumi mode HP', () => {
  it('is mode-based: 3v3 keeps 7500, 5v5 is 12500', () => {
    expect(yumiHpFor('yumi3')).toBe(7500);
    expect(yumiHpFor('yumi5')).toBe(12500);
  });

  it('a live 5v5 seats two 12500 hp cats', () => {
    const { sim, match } = startYumi('yumi5');
    const y = (match as any).yumi;
    expect(y.maxHp).toBe(12500);
    expect(sim.entities.get(y.yumiA)!.maxHp).toBe(12500);
    expect(sim.entities.get(y.yumiB)!.hp).toBe(12500);
  });
});

describe('yumi power-up spawning', () => {
  it('drops a type-free orb on a reachable maze cell, away from live fighters', () => {
    const { sim, match, ctx } = startYumi('yumi3');
    const y = (match as any).yumi;
    spawnYumiPowerup(ctx, match);
    expect(y.powerups.length).toBe(1);
    const orb = y.powerups[0];
    expect(MYSTERY_POWERUPS.map((d) => d.id)).toContain(orb.defId);
    // The view NEVER leaks the type: every orb is a `(?)`.
    const views = yumiPowerupViews(match);
    expect(views.length).toBe(1);
    expect((views[0] as any).defId).toBeUndefined();
    expect(views[0].state).toBe('spawning');
    // Landed on a real teleport point of the maze (valid, reachable terrain).
    const origin = yumiMazeOrigin(match.slot);
    const pts = teleportPoints(yumiMazeLayout());
    const onPoint = pts.some(
      (p) => Math.abs(origin.x + p.x - orb.x) < 0.5 && Math.abs(origin.z + p.z - orb.z) < 0.5,
    );
    expect(onPoint).toBe(true);
  });

  it('keeps only one orb on the maze at a time', () => {
    const { sim, match, ctx } = startYumi('yumi3');
    const y = (match as any).yumi;
    spawnYumiPowerup(ctx, match);
    y.powerupTimer = 0; // force a spawn attempt
    updateYumiPowerups(ctx, match);
    expect(y.powerups.length).toBe(1); // MAX = 1, no second orb
  });

  it('a spawn draws EXACTLY two rng values regardless of how many cells are clear', () => {
    // The determinism guarantee: the per-match stream must advance by the same
    // amount whether the maze is empty or crowded, so a replay stays byte-
    // identical. rng.pick (1 draw) + the point pick (1 draw) = 2, and the
    // crowded-maze fallback (pool = pts) still draws exactly once.
    const countDraws = (crowd: boolean) => {
      const { sim, match, ctx } = startYumi('yumi3');
      const y = (match as any).yumi;
      if (crowd) {
        // Park every fighter on a distinct teleport cell to shrink the clear set.
        const origin = yumiMazeOrigin(match.slot);
        const pts = teleportPoints(yumiMazeLayout());
        [...match.teamA, ...match.teamB].forEach((pid, i) => {
          const e = sim.entities.get(pid)!;
          const p = pts[i % pts.length];
          e.pos.x = origin.x + p.x;
          e.pos.z = origin.z + p.z;
        });
      }
      let draws = 0;
      const real = y.rng.next.bind(y.rng);
      y.rng.next = () => {
        draws++;
        return real();
      };
      spawnYumiPowerup(ctx, match);
      return draws;
    };
    expect(countDraws(false)).toBe(2);
    expect(countDraws(true)).toBe(2);
  });

  it('nextPowerupIn counts down to the next spawn, 0 while an orb is out', () => {
    const { match, ctx } = startYumi('yumi3');
    const y = (match as any).yumi;
    y.powerups = [];
    y.powerupTimer = 12.4;
    expect(yumiNextPowerupIn(match)).toBe(13);
    spawnYumiPowerup(ctx, match);
    expect(yumiNextPowerupIn(match)).toBe(0);
  });
});

// Spawn a ready orb and stand `pid` on it; returns the orb, the fighter, and the
// live yumi state.
function readyOrbUnder(res: ReturnType<typeof startYumi>, pid: number) {
  const { sim, match, ctx } = res;
  const y = (match as any).yumi;
  spawnYumiPowerup(ctx, match);
  const orb = y.powerups[0];
  orb.state = 'ready';
  orb.timer = 30;
  const e = sim.entities.get(pid)!;
  e.pos.x = orb.x;
  e.pos.z = orb.z;
  return { orb, e, y };
}

const stunAura = (): Aura => ({
  id: 'test_stun',
  name: 'Stun',
  kind: 'stun',
  remaining: 3,
  duration: 3,
  value: 0,
  sourceId: -1,
  school: 'physical',
});

describe('yumi power-up hold-to-grab', () => {
  it('holding Interact on a ready orb channels ~1.8s, then grants the power-up', () => {
    const res = startYumi('yumi3');
    const { match, ctx } = res;
    const { orb, e, y } = readyOrbUnder(res, match.teamA[0]);
    startYumiGrab(ctx, match, e, orb.id);
    expect(e.yumiGrabRemaining).toBeCloseTo(YUMI_POWERUP_GRAB_TIME, 5);
    expect(e.yumiGrabTotal).toBe(YUMI_POWERUP_GRAB_TIME);
    let ticks = 0;
    while (e.yumiGrabRemaining > 0 && ticks < 20 * 4) {
      updateYumiPowerups(ctx, match); // -> updateYumiGrabs advances the channel
      ticks++;
    }
    expect(ticks).toBeGreaterThan(30); // ~36 ticks (1.8s), NOT instant
    expect(ticks).toBeLessThan(42);
    expect(e.auras.some((au) => isMysteryPowerupAura(au.kind))).toBe(true);
    expect(y.powerups.length).toBe(0);
    expect(e.yumiGrabRemaining).toBe(0);
  });

  it('does not grant partway through the channel', () => {
    const res = startYumi('yumi3');
    const { match, ctx } = res;
    const { orb, e, y } = readyOrbUnder(res, match.teamA[0]);
    startYumiGrab(ctx, match, e, orb.id);
    for (let i = 0; i < 10; i++) updateYumiPowerups(ctx, match); // ~0.5s < 1.8s
    expect(e.yumiGrabRemaining).toBeGreaterThan(0);
    expect(e.auras.some((au) => isMysteryPowerupAura(au.kind))).toBe(false);
    expect(y.powerups.length).toBe(1);
  });

  it('a stun during the channel cancels the grab (orb stays for someone else)', () => {
    const res = startYumi('yumi3');
    const { match, ctx } = res;
    const { orb, e, y } = readyOrbUnder(res, match.teamA[0]);
    startYumiGrab(ctx, match, e, orb.id);
    updateYumiPowerups(ctx, match);
    expect(e.yumiGrabRemaining).toBeGreaterThan(0);
    e.auras.push(stunAura());
    updateYumiPowerups(ctx, match);
    expect(e.yumiGrabRemaining).toBe(0);
    expect(y.grab.has(e.id)).toBe(false);
    expect(e.auras.some((au) => isMysteryPowerupAura(au.kind))).toBe(false);
    expect(y.powerups.length).toBe(1);
  });

  it('cannot even start a grab while stunned', () => {
    const res = startYumi('yumi3');
    const { match, ctx } = res;
    const { orb, e, y } = readyOrbUnder(res, match.teamA[0]);
    e.auras.push(stunAura());
    startYumiGrab(ctx, match, e, orb.id);
    expect(e.yumiGrabRemaining).toBe(0);
    expect(y.grab.has(e.id)).toBe(false);
  });

  it('nudging in place is fine, but leaving the orb radius cancels', () => {
    const res = startYumi('yumi3');
    const { match, ctx } = res;
    const { orb, e } = readyOrbUnder(res, match.teamA[0]);
    startYumiGrab(ctx, match, e, orb.id);
    e.pos.x += 1; // still within YUMI_POWERUP_RADIUS
    updateYumiPowerups(ctx, match);
    expect(e.yumiGrabRemaining).toBeGreaterThan(0);
    e.pos.x += 100; // out of range
    updateYumiPowerups(ctx, match);
    expect(e.yumiGrabRemaining).toBe(0);
  });

  it('one active per player: cannot start a grab while already holding a power-up', () => {
    const res = startYumi('yumi3');
    const { match, ctx } = res;
    const { orb, e, y } = readyOrbUnder(res, match.teamA[0]);
    applyMysteryPowerup(ctx, e, 'invuln'); // already holding one
    startYumiGrab(ctx, match, e, orb.id);
    expect(e.yumiGrabRemaining).toBe(0);
    expect(y.grab.has(e.id)).toBe(false);
  });

  it('releasing Interact (stopYumiGrab) cancels the channel', () => {
    const res = startYumi('yumi3');
    const { match, ctx } = res;
    const { orb, e, y } = readyOrbUnder(res, match.teamA[0]);
    startYumiGrab(ctx, match, e, orb.id);
    updateYumiPowerups(ctx, match);
    stopYumiGrab(match, e);
    expect(e.yumiGrabRemaining).toBe(0);
    expect(y.grab.has(e.id)).toBe(false);
  });

  it('the orb despawning mid-channel cancels the grab on the same tick', () => {
    const res = startYumi('yumi3');
    const { match, ctx } = res;
    const { orb, e, y } = readyOrbUnder(res, match.teamA[0]);
    startYumiGrab(ctx, match, e, orb.id);
    updateYumiPowerups(ctx, match);
    expect(e.yumiGrabRemaining).toBeGreaterThan(0);
    orb.timer = 0.01; // times out on the next tick
    updateYumiPowerups(ctx, match);
    expect(y.powerups.length).toBe(0);
    expect(e.yumiGrabRemaining).toBe(0);
    expect(y.grab.has(e.id)).toBe(false);
    expect(e.auras.some((au) => isMysteryPowerupAura(au.kind))).toBe(false);
  });

  it('two channels completing on the same tick: exactly one fighter gets the orb', () => {
    // The tie-break documented in updateYumiGrabs: `y.grab` iterates in Map
    // insertion order, so the fighter who STARTED first wins the same-tick
    // claim and the loser's channel cancels at once (the orb is gone).
    const res = startYumi('yumi3');
    const { sim, match, ctx } = res;
    const { orb, e: first, y } = readyOrbUnder(res, match.teamA[0]);
    const second = sim.entities.get(match.teamB[0])!;
    second.pos.x = orb.x;
    second.pos.z = orb.z;
    startYumiGrab(ctx, match, first, orb.id); // first to start...
    startYumiGrab(ctx, match, second, orb.id);
    for (let i = 0; i < 40; i++) updateYumiPowerups(ctx, match);
    // ...is first to finish (every channel is the same fixed 1.8s).
    expect(first.auras.some((au) => isMysteryPowerupAura(au.kind))).toBe(true);
    expect(second.auras.some((au) => isMysteryPowerupAura(au.kind))).toBe(false);
    expect(y.powerups.length).toBe(0); // the one orb was consumed exactly once
    expect(y.grab.size).toBe(0); // the loser's channel cancelled, not dangling
    expect(second.yumiGrabRemaining).toBe(0);
  });

  it('cleanupYumiMatch zeroes every fighter grab bar and the channel map', () => {
    const res = startYumi('yumi3');
    const { match, ctx } = res;
    const { orb, e, y } = readyOrbUnder(res, match.teamA[0]);
    startYumiGrab(ctx, match, e, orb.id);
    updateYumiPowerups(ctx, match);
    expect(e.yumiGrabRemaining).toBeGreaterThan(0);
    cleanupYumiMatch(ctx, match);
    expect(e.yumiGrabRemaining).toBe(0);
    expect(e.yumiGrabTotal).toBe(0);
    expect(y.grab.size).toBe(0);
  });
});

describe('yumi power-up effects', () => {
  it('Invulnerable: the carrier takes no damage', () => {
    const { sim, ctx, p, mob } = mobWorld();
    applyMysteryPowerup(ctx, mob, 'invuln');
    hit(sim, p, mob, 500);
    expect(mob.hp).toBe(5000); // fully immune
  });

  it('Berserker: deals more (source) and takes more (target)', () => {
    // The tuning contract, pinned as literals so a drive-by constant change
    // fails here (asserting against the same constant damage.ts imports would
    // be a self-comparison that can never fail).
    expect(YUMI_BERSERK_DMG_MULT).toBe(1.4);
    expect(YUMI_BERSERK_TAKEN_MULT).toBe(1.35);
    // baseline: a plain 100 hit lands verbatim on a mob
    const w0 = mobWorld();
    hit(w0.sim, w0.p, w0.mob, 100);
    expect(5000 - w0.mob.hp).toBe(100);
    // outgoing boost: a berserk attacker (100 x 1.4)
    const w1 = mobWorld();
    applyMysteryPowerup(w1.ctx, w1.p, 'berserk');
    hit(w1.sim, w1.p, w1.mob, 100);
    expect(5000 - w1.mob.hp).toBe(140);
    // incoming amplification: a berserk victim, plain attacker (100 x 1.35)
    const w2 = mobWorld();
    applyMysteryPowerup(w2.ctx, w2.mob, 'berserk');
    hit(w2.sim, w2.p, w2.mob, 100);
    expect(5000 - w2.mob.hp).toBe(135);
  });

  it('Berserker never amplifies self-damage or source-less damage', () => {
    // Both berserk arms guard on a real enemy source (matching the Weakening
    // Hex arm): the built-in downside amplifies what ENEMIES do to you, never
    // your own self-damage or environmental hits (falls, neutral bleeds).
    const w1 = mobWorld();
    applyMysteryPowerup(w1.ctx, w1.mob, 'berserk');
    hit(w1.sim, w1.mob, w1.mob, 100); // self-damage: untouched
    expect(5000 - w1.mob.hp).toBe(100);
    const w2 = mobWorld();
    applyMysteryPowerup(w2.ctx, w2.mob, 'berserk');
    hit(w2.sim, null, w2.mob, 100); // source-less (fall-style): untouched
    expect(5000 - w2.mob.hp).toBe(100);
  });

  it('Endless Mana: reads as a free cast that is never consumed', () => {
    const { ctx, a } = duelWorld();
    expect(hasNextCastFree(a)).toBe(false);
    applyMysteryPowerup(ctx, a, 'endless_mana');
    expect(hasNextCastFree(a)).toBe(true);
    // the aura stays put (free casts for the whole duration, never consumed)
    expect(a.auras.some((au) => au.kind === 'pu_endless_mana')).toBe(true);
    // ...and the CONSUME path agrees: every consume answers free and leaves the
    // aura in place (a single-shot next_cast_free would vanish after the first).
    expect(consumeNextCastFree(ctx, a)).toBe(true);
    expect(consumeNextCastFree(ctx, a)).toBe(true);
    expect(consumeNextCastFree(ctx, a)).toBe(true);
    expect(a.auras.some((au) => au.kind === 'pu_endless_mana')).toBe(true);
    expect(hasNextCastFree(a)).toBe(true);
  });

  it('Stealth: hides the carrier and survives taking a hit (unlike rogue stealth)', () => {
    const { sim, ctx, a, b } = duelWorld();
    applyMysteryPowerup(ctx, b, 'stealth');
    expect(b.stealthed).toBe(true);
    // taking a hit would break rogue stealth; the power-up persists
    hit(sim, a, b, 50);
    expect(b.stealthed).toBe(true);
    expect(b.auras.some((au) => au.kind === 'pu_stealth')).toBe(true);
  });
});

describe('yumi power-up rules', () => {
  it('replace-not-stack: a new grab drops the old power-up (one at a time)', () => {
    const { ctx, a } = duelWorld();
    applyMysteryPowerup(ctx, a, 'invuln');
    applyMysteryPowerup(ctx, a, 'berserk');
    const mystery = a.auras.filter((au) => isMysteryPowerupAura(au.kind));
    expect(mystery.length).toBe(1);
    expect(mystery[0].kind).toBe('pu_berserk');
    expect(a.auras.some((au) => au.kind === 'pu_invuln')).toBe(false);
  });

  it('every effect lasts exactly 15 seconds', () => {
    const { ctx, a } = duelWorld();
    for (const def of MYSTERY_POWERUPS) {
      applyMysteryPowerup(ctx, a, def.id);
      const au = a.auras.find((x) => x.kind === def.auraKind)!;
      expect(au.duration).toBe(YUMI_POWERUP_DURATION);
      expect(YUMI_POWERUP_DURATION).toBe(15);
    }
  });

  it('every mystery power-up aura name is localizable (no raw-English buff-frame leak)', () => {
    // The buff frame + aura gain/fade log localize by aura NAME via AURA_NAME_KEY;
    // an unregistered name leaks raw English in every non-English locale.
    for (const def of MYSTERY_POWERUPS) {
      expect(localizeSimAuraName(def.auraName)).not.toBeNull();
    }
  });

  it('Stealth alone carries no aura colour (a glow would reveal it); others do', () => {
    const byId = Object.fromEntries(MYSTERY_POWERUPS.map((d) => [d.id, d]));
    expect(byId.stealth.auraColor).toBeNull();
    expect(byId.invuln.auraColor).not.toBeNull();
    expect(byId.endless_mana.auraColor).not.toBeNull();
    expect(byId.berserk.auraColor).not.toBeNull();
  });

  it('the pickup event reveals the type + aura colour (null for Stealth)', () => {
    // Drive a full hold-to-grab through real ticks so the completion emit lands.
    const res = startYumi('yumi3');
    const { sim, match } = res;
    const a0id = match.teamA[0];
    const { orb, e: a0 } = readyOrbUnder(res, a0id);
    orb.defId = 'stealth'; // pin the type for a deterministic assertion
    sim.yumiGrabStart(orb.id, a0id);
    const evs: SimEvent[] = [];
    for (let i = 0; i < 20 * 3 && a0.yumiGrabRemaining > 0; i++) evs.push(...sim.tick());
    const ev = evs.find((e) => e.type === 'yumiPowerup') as any;
    expect(ev).toBeTruthy();
    expect(ev.defId).toBe('stealth');
    expect(ev.entityId).toBe(a0.id);
    expect(ev.auraColor).toBeNull();
    expect(ev.duration).toBe(YUMI_POWERUP_DURATION);
  });
});

describe('yumi sudden-death bleed pool', () => {
  it('scales off the MODE pool: a 5v5 step-1 pulse bleeds 125, not the 3v3 75', () => {
    // Pinned literals: ceil(12500 x 0.01 x 1) = 125. A regression that reads
    // the YUMI_HP constant instead of y.maxHp would bleed ceil(7500 x 0.01) =
    // 75 here and only ever be right at 3v3, where the two coincide.
    const { sim, match } = startYumi('yumi5');
    const y = (match as any).yumi;
    match.timer = 600 - 0.5; // just before YUMI_SUDDEN_AT latches
    const catA = sim.entities.get(y.yumiA)!;
    const hp0 = catA.hp;
    expect(hp0).toBe(12500);
    for (let i = 0; i < 20 * 4 && catA.hp === hp0; i++) sim.tick();
    expect(hp0 - catA.hp).toBe(125);
  });
});

// The online freshness contract: the orbs ride the 1/s yumiStatus heartbeat
// (the arena wire that also carries them is rate-limited to ~10s, coarser than
// the 4s telegraph), and any orb TRANSITION forces an immediate out-of-band
// beat, so spawn/ready/grab/timeout are never up to a second (let alone 10s)
// stale on any host.
describe('yumi power-up heartbeat cadence', () => {
  // Advance to just past a whole-second heartbeat edge, so anything the next
  // few ticks emit can only come from the statusDirty transition path.
  function pastSecondEdge(sim: Sim, match: any) {
    let last = Math.floor(match.timer);
    for (let i = 0; i < 40; i++) {
      sim.tick();
      const s = Math.floor(match.timer);
      if (s !== last) return;
      last = s;
    }
    throw new Error('no second edge within 40 ticks');
  }

  it('every heartbeat carries the live orb views', () => {
    const { sim, match, ctx, pids } = startYumi('yumi3');
    spawnYumiPowerup(ctx, match);
    let beat: any = null;
    for (let i = 0; i < 40 && !beat; i++) {
      beat = sim.tick().find((e) => e.type === 'yumiStatus' && (e as any).pid === pids[0]);
    }
    expect(beat).toBeTruthy();
    expect(beat.groundPowerups.length).toBe(1);
    expect(beat.groundPowerups[0].state).toMatch(/spawning|ready/);
    expect((beat.groundPowerups[0] as any).defId).toBeUndefined(); // type never leaks
  });

  it('a spawn mid-second fires an immediate beat with the new orb on it', () => {
    const { sim, match, pids } = startYumi('yumi3');
    const y = (match as any).yumi;
    pastSecondEdge(sim, match);
    y.powerupTimer = 2 * DT; // the spawn lands two ticks from now, mid-second
    sim.tick();
    expect(y.powerups.length).toBe(0);
    const evs = sim.tick(); // the spawn tick
    expect(y.powerups.length).toBe(1);
    const beat = evs.find((e) => e.type === 'yumiStatus' && (e as any).pid === pids[0]) as any;
    expect(beat).toBeTruthy();
    expect(beat.groundPowerups.length).toBe(1);
    expect(beat.groundPowerups[0].id).toBe(y.powerups[0].id);
    expect(beat.groundPowerups[0].state).toBe('spawning');
  });

  it('an orb timing out mid-second fires an immediate beat with the orb gone', () => {
    const { sim, match, ctx, pids } = startYumi('yumi3');
    const y = (match as any).yumi;
    spawnYumiPowerup(ctx, match);
    const orb = y.powerups[0];
    orb.state = 'ready';
    pastSecondEdge(sim, match);
    orb.timer = 2 * DT; // despawns two ticks from now, mid-second
    sim.tick();
    expect(y.powerups.length).toBe(1);
    const evs = sim.tick(); // the timeout tick
    expect(y.powerups.length).toBe(0);
    const beat = evs.find((e) => e.type === 'yumiStatus' && (e as any).pid === pids[0]) as any;
    expect(beat).toBeTruthy();
    expect(beat.groundPowerups.length).toBe(0);
  });
});
