import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';
import { arenaOrigin } from '../src/sim/data';
import { AUGMENTS, AUGMENTS_BY_ID, eligibleAugments, tierForWave } from '../src/sim/content/augments';
import type { PlayerClass } from '../src/sim/types';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x; e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

// Seat a 2v2 Fiesta with four solo-queued players and run the countdown out so
// the bout is live. Returns the match plus the four pids.
function startFiesta(classes: PlayerClass[] = ['warrior', 'mage', 'rogue', 'priest']) {
  const sim = makeWorld();
  const pids = classes.map((c, i) => sim.addPlayer(c, `P${i}`));
  pids.forEach((p, i) => teleport(sim, p, i * 4, -40));
  pids.forEach((p) => sim.arenaQueueJoin(p, 'fiesta'));
  sim.tick(); // matchmake
  for (let i = 0; i < 20 * 8; i++) {
    sim.tick();
    const m = sim.arenaMatchFor(pids[0]);
    if (m && m.state === 'active') break;
  }
  const match = sim.arenaMatchFor(pids[0])!;
  return { sim, match, pids };
}

describe('fiesta: matchmaking & format', () => {
  it('seats four solo-queuers into one 2v2 Fiesta match', () => {
    const { sim, match, pids } = startFiesta();
    expect(match).toBeTruthy();
    expect(match.format).toBe('fiesta');
    expect(match.fiesta).toBeTruthy();
    expect(match.teamA.length).toBe(2);
    expect(match.teamB.length).toBe(2);
    expect(new Set([...match.teamA, ...match.teamB])).toEqual(new Set(pids));
    expect(sim.arenaQueueFiesta.length).toBe(0);
  });

  it('keeps fiesta on its own queue, separate from ranked 2v2', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'A');
    sim.arenaQueueJoin(a, 'fiesta');
    expect(sim.arenaQueueFiesta.length).toBe(1);
    expect(sim.arenaQueue2v2.length).toBe(0);
  });
});

describe('fiesta: scoring & respawn', () => {
  it('a takedown scores a point and benches the victim on a respawn timer', () => {
    const { sim, match, pids } = startFiesta();
    const killerPid = match.teamA[0];
    const victimPid = match.teamB[0];
    const victim = sim.entities.get(victimPid)!;
    const killer = sim.entities.get(killerPid)!;
    // Drop the victim with a single overwhelming cross-team hit.
    (sim as any).dealDamage(killer, victim, victim.maxHp + 50, false, 'physical', null);
    expect(match.fiesta!.scoreA).toBe(1);
    expect(match.fiesta!.respawn.has(victimPid)).toBe(true);
    expect(victim.dead).toBe(true);

    // The victim should NOT be permanently eliminated — they revive on their timer.
    const downedFor = match.fiesta!.respawn.get(victimPid)!;
    for (let i = 0; i < Math.ceil(downedFor * 20) + 5; i++) sim.tick();
    expect(match.fiesta!.respawn.has(victimPid)).toBe(false);
    expect(sim.entities.get(victimPid)!.dead).toBe(false);
    expect(sim.entities.get(victimPid)!.hp).toBeGreaterThan(0);
  });

  it('respawn timers grow with each death', () => {
    const { sim, match } = startFiesta();
    const t1 = (sim as any).fiestaRespawnTime(1, 0);
    const t2 = (sim as any).fiestaRespawnTime(2, 0);
    const tLate = (sim as any).fiestaRespawnTime(2, 120);
    expect(t2).toBeGreaterThan(t1);
    expect(tLate).toBeGreaterThan(t2);
    expect(t1).toBeLessThanOrEqual(14);
    expect(tLate).toBeLessThanOrEqual(14); // capped
  });

  it('reaching the score limit ends the bout (no Elo change for fiesta)', () => {
    const { sim, match, pids } = startFiesta();
    const ratingBefore = (sim as any).players.get(pids[0]).arenaRating;
    const f = match.fiesta!;
    f.scoreA = f.scoreLimit - 1;
    const killer = sim.entities.get(match.teamA[0])!;
    const victim = sim.entities.get(match.teamB[0])!;
    (sim as any).dealDamage(killer, victim, victim.maxHp + 50, false, 'physical', null);
    expect(f.scoreA).toBeGreaterThanOrEqual(f.scoreLimit);
    expect(match.state).toBe('over');
    expect((sim as any).players.get(pids[0]).arenaRating).toBe(ratingBefore);
  });
});

// Down `victimPid` via a cross-team enemy so a queued augment offer surfaces.
function downViaEnemy(sim: Sim, match: any, victimPid: number) {
  const onA = match.teamA.includes(victimPid);
  const killerPid = (onA ? match.teamB : match.teamA)[0];
  const killer = sim.entities.get(killerPid)!;
  const victim = sim.entities.get(victimPid)!;
  (sim as any).dealDamage(killer, victim, victim.maxHp + 50, false, 'physical', null);
}

describe('fiesta: augments', () => {
  it('queues an augment wave as pending, then offers it on the next death', () => {
    const { sim, match, pids } = startFiesta();
    for (let i = 0; i < 20 * 12 && match.fiesta!.wave < 1; i++) sim.tick();
    expect(match.fiesta!.wave).toBe(1);
    // Deferred: nothing pops mid-fight — it's queued as pending instead.
    expect(match.fiesta!.offers.has(pids[0])).toBe(false);
    const pending = match.fiesta!.pending.get(pids[0]);
    expect(pending?.[0]?.choices.length).toBe(3);
    expect(pending?.[0]?.tier).toBe('silver');
    // Dying surfaces the offer.
    downViaEnemy(sim, match, pids[0]);
    const offer = match.fiesta!.offers.get(pids[0]);
    expect(offer).toBeTruthy();
    const cls = (sim as any).players.get(pids[0]).cls;
    for (const id of offer!.choices) {
      const aug = AUGMENTS_BY_ID[id];
      expect(aug).toBeTruthy();
      if (aug.classes) expect(aug.classes).toContain(cls);
    }
  });

  it('picking an augment folds its effect into the player', () => {
    const { sim, match, pids } = startFiesta();
    for (let i = 0; i < 20 * 12 && match.fiesta!.wave < 1; i++) sim.tick();
    const pid = pids[0];
    const e = sim.entities.get(pid)!;
    downViaEnemy(sim, match, pid);
    const offer = match.fiesta!.offers.get(pid)!;
    expect(offer).toBeTruthy();
    const hpAug = offer.choices.find((id) => AUGMENTS_BY_ID[id].effect.stats?.maxHpPct);
    const chosen = hpAug ?? offer.choices[0];
    sim.arenaAugmentPick(chosen, pid);
    expect((sim as any).players.get(pid).fiestaAugments).toContain(chosen);
    expect(match.fiesta!.offers.has(pid)).toBe(false);
    expect((sim as any).players.get(pid).fiestaMods).toBeTruthy();
  });

  it('augments are stripped when the bout ends', () => {
    const { sim, match, pids } = startFiesta();
    for (let i = 0; i < 20 * 12 && match.fiesta!.wave < 1; i++) sim.tick();
    const pid = pids[0];
    downViaEnemy(sim, match, pid);
    const offer = match.fiesta!.offers.get(pid)!;
    sim.arenaAugmentPick(offer.choices[0], pid);
    // Let everyone revive so the finishing blow comes from a live attacker.
    for (let i = 0; i < 20 * 16 && match.fiesta!.respawn.size > 0; i++) sim.tick();
    // End the bout by hitting the score cap, then run out the aftermath.
    match.fiesta!.scoreA = match.fiesta!.scoreLimit;
    downViaEnemy(sim, match, match.teamB[0]);
    for (let i = 0; i < 20 * 8 && sim.arenaMatchFor(pid); i++) sim.tick();
    expect(sim.arenaMatchFor(pid)).toBeNull();
    expect((sim as any).players.get(pid).fiestaAugments).toEqual([]);
    expect((sim as any).players.get(pid).fiestaMods).toBeNull();
  });

  it('banks multiple augment waves and offers them one per death, in order', () => {
    const { sim, match, pids } = startFiesta();
    const pid = pids[0];
    (sim as any).fiestaOpenWave(match);
    (sim as any).fiestaOpenWave(match);
    expect(match.fiesta!.pending.get(pid)?.length).toBe(2);
    expect(match.fiesta!.offers.has(pid)).toBe(false); // deferred, not mid-fight
    downViaEnemy(sim, match, pid);
    expect(match.fiesta!.offers.has(pid)).toBe(true);
    expect(match.fiesta!.pending.get(pid)?.length ?? 0).toBe(1);
    sim.arenaAugmentPick(match.fiesta!.offers.get(pid)!.choices[0], pid);
    // Still benched → the next banked wave surfaces immediately.
    expect(match.fiesta!.offers.has(pid)).toBe(true);
    sim.arenaAugmentPick(match.fiesta!.offers.get(pid)!.choices[0], pid);
    expect(match.fiesta!.offers.has(pid)).toBe(false);
    expect((sim as any).players.get(pid).fiestaAugments.length).toBe(2);
  });

  it('standardizes every fighter to level 20 with a balanced build, restoring after', () => {
    const sim = new Sim({ seed: 5, playerClass: 'warrior', noPlayer: true });
    const pids = (['warrior', 'mage', 'rogue', 'priest'] as const).map((c, i) => sim.addPlayer(c, `P${i}`));
    // Pretend everyone walked in at level 8.
    for (const p of pids) sim.setPlayerLevel(8, p);
    pids.forEach((p) => teleport(sim, p, pids.indexOf(p) * 4, -40));
    pids.forEach((p) => sim.arenaQueueJoin(p, 'fiesta'));
    sim.tick();
    for (const p of pids) expect(sim.entities.get(p)!.level).toBe(20);
    // Persistence safety: serialize must report the ORIGINAL level, not 20.
    expect(sim.serializeCharacter(pids[0])!.level).toBe(8);
  });
});

describe('fiesta: hazard ring', () => {
  it('damages a fighter standing outside the ring', () => {
    const { sim, match, pids } = startFiesta();
    const f = match.fiesta!;
    f.ringRadius = 6; // close it tight
    const pid = match.teamA[0];
    const e = sim.entities.get(pid)!;
    const origin = arenaOrigin(match.slot);
    // Stand well outside the ring.
    teleport(sim, pid, origin.x + 30, origin.z);
    const hpBefore = e.hp;
    for (let i = 0; i < 20; i++) sim.tick(); // ~1s
    expect(sim.entities.get(pid)!.hp).toBeLessThan(hpBefore);
  });
});

describe('fiesta: ring power-ups', () => {
  it('spawns a power-up that telegraphs, becomes grabbable, and buffs the grabber', () => {
    const { sim, match } = startFiesta();
    const f = match.fiesta!;
    for (let i = 0; i < 20 * 14 && f.powerups.length === 0; i++) sim.tick();
    expect(f.powerups.length).toBeGreaterThan(0);
    const p = f.powerups[0];
    expect(p.state).toBe('spawning');
    for (let i = 0; i < 20 * 6 && p.state === 'spawning'; i++) sim.tick();
    expect(p.state).toBe('ready');
    const pid = match.teamA[0];
    const e = sim.entities.get(pid)!;
    teleport(sim, pid, p.x, p.z);
    const before = e.auras.length;
    sim.tick();
    expect(e.auras.length).toBeGreaterThan(before);
  });
});

describe('fiesta: determinism', () => {
  it('re-offers identical augment cards on replay', () => {
    const run = () => {
      const { sim, match, pids } = startFiesta();
      for (let i = 0; i < 20 * 12 && match.fiesta!.wave < 1; i++) sim.tick();
      return pids.map((p) => match.fiesta!.offers.get(p)?.choices ?? []);
    };
    expect(run()).toEqual(run());
  });
});

describe('fiesta: offline practice vs bots', () => {
  it('spawns three bots, seats a 2v2 bout, and the bots fight (score climbs)', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    expect(sim.startFiestaPractice()).toBe(true);
    expect((sim as any).fiestaBotPids.length).toBe(3);
    let match: any = null;
    for (let i = 0; i < 20 * 70; i++) {
      sim.updateFiestaBots();
      sim.tick();
      match = sim.arenaMatchFor(sim.playerId);
      if (match?.fiesta && match.fiesta.scoreA + match.fiesta.scoreB > 0) break;
    }
    expect(match?.fiesta).toBeTruthy();
    expect(match.fiesta.scoreA + match.fiesta.scoreB).toBeGreaterThan(0);
  });

  it('toggling practice off tears down the bots and dequeues them', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.startFiestaPractice();
    const botPids = [...(sim as any).fiestaBotPids];
    expect(botPids.length).toBe(3);
    expect(sim.startFiestaPractice()).toBe(false); // toggle off
    expect((sim as any).fiestaBotPids.length).toBe(0);
    for (const pid of botPids) expect(sim.entities.has(pid)).toBe(false);
  });

  it('practice runs are deterministic (same score timeline on replay)', () => {
    const run = () => {
      const sim = new Sim({ seed: 11, playerClass: 'mage' });
      sim.startFiestaPractice();
      for (let i = 0; i < 20 * 30; i++) { sim.updateFiestaBots(); sim.tick(); }
      const m = sim.arenaMatchFor(sim.playerId);
      return m?.fiesta ? [m.fiesta.scoreA, m.fiesta.scoreB] : null;
    };
    expect(run()).toEqual(run());
  });
});

describe('fiesta: augment catalog integrity', () => {
  it('every augment id is unique and tiers map to waves', () => {
    const ids = AUGMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(tierForWave(1)).toBe('silver');
    expect(tierForWave(2)).toBe('gold');
    expect(tierForWave(3)).toBe('prismatic');
  });

  it('every class can be offered three augments at every tier', () => {
    const classes: PlayerClass[] = ['warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid'];
    for (const cls of classes) {
      for (const tier of ['silver', 'gold', 'prismatic'] as const) {
        // role null is the worst case (healer-only augments excluded)
        const pool = eligibleAugments(tier, cls, null, new Set());
        expect(pool.length).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
