import { describe, expect, it } from 'vitest';
import { TURRET_SHOCKWAVE, TURRET_WEAPON } from '../src/sim/content/turret_defense';
import type { TurretAim, TurretEvent, TurretPhase } from '../src/sim/minigames/turret_defense';
import type { TurretFeedback } from '../src/sim/minigames/turret_feedback';
import {
  TURRET_OWN_SHOT_LEAD_TICKS,
  TURRET_OWN_SHOT_PENDING_MAX,
  TURRET_OWN_SHOT_RECORDS,
  TurretOwnShotLedger,
} from '../src/ui/hud/vehicle/turret_own_shot_core';
import type { TurretSessionView } from '../src/world_api/vehicles';

const CX = 10;
const CZ = 20;
const COOLDOWN = TURRET_WEAPON.cooldownTicks;

interface Seat {
  startTick?: number;
  phase?: TurretPhase;
  readyTick?: number;
  feedback?: TurretFeedback[];
}

function view(seat: Seat = {}): TurretSessionView {
  return {
    origin: { x: CX, y: 0, z: CZ },
    defense: {
      startTick: seat.startTick ?? 100,
      phase: seat.phase ?? 'wave',
      readyTick: seat.readyTick ?? 0,
      cx: CX,
      cz: CZ,
      aimX: 0,
      aimZ: 1,
    } as unknown as TurretSessionView['defense'],
    waveCount: 6,
    monstersLeft: 0,
    feedback: seat.feedback ?? [],
  };
}

function aim(x: number, z: number): TurretAim {
  return { x, z, dirX: 0, dirZ: 1, range: Math.hypot(x - CX, z - CZ) };
}

function fired(seq: number, tick: number, x: number, z: number, shotId = seq): TurretFeedback {
  const event: TurretEvent = {
    type: 'fired',
    shotId,
    fromX: CX,
    fromZ: CZ,
    x,
    y: 0,
    z,
    flightTicks: 6,
    impactTick: tick + 6,
  };
  return { seq, tick, event };
}

/** A ledger that measured these click-to-fired leads, one lone shot each (round trips that long). */
function measured(...leads: number[]): TurretOwnShotLedger {
  const shots = new TurretOwnShotLedger();
  leads.forEach((lead, i) => {
    shots.mark(view(), 10, aim(CX, CZ + 5), 'played');
    const entry = fired(1, 10 + lead, CX, CZ + 5);
    shots.ownShotOf(view({ feedback: [entry] }), entry);
    if (i === 0) expect(shots.leadTicks).toBe(lead);
  });
  return shots;
}

/** Eight trips of 3 to 5 ticks: a trusted band from 2 to 6 ticks. */
const JITTERY = [3, 4, 5, 4, 3, 5, 4, 4];

describe('the own-shot ledger', () => {
  it('marks a shot only when every mirror says the server accepts it', () => {
    const shots = new TurretOwnShotLedger();
    expect(shots.canMark(null, 200)).toBe(false);
    expect(shots.canMark(view(), null)).toBe(false);
    expect(shots.canMark(view({ phase: 'won' }), 200)).toBe(false);
    expect(shots.canMark(view({ phase: 'lost' }), 200)).toBe(false);
    expect(shots.canMark(view({ readyTick: 201 }), 200)).toBe(false);
    expect(shots.canMark(view({ phase: 'intro', readyTick: 200 }), 200)).toBe(true);
  });

  it('confirms the mark its fired entry matches, and answers every reader the same', () => {
    const shots = new TurretOwnShotLedger();
    const s0 = view();
    const serial = shots.mark(s0, 200, aim(CX, CZ + 30));
    expect(shots.status(serial)).toBe('pending');
    expect(shots.launchAfter(s0, 0)?.serial).toBe(serial);
    expect(shots.launchAfter(s0, serial)).toBeNull();
    const entry = fired(1, 203, CX, CZ + 30);
    const s1 = view({ feedback: [entry], readyTick: 203 + COOLDOWN });
    // The render and the fire sound both ask: one resolution, the same answer twice.
    expect(shots.ownShotOf(s1, entry)).toBe(serial);
    expect(shots.ownShotOf(s1, entry)).toBe(serial);
    expect(shots.ownShotOf(view({ feedback: [entry] }), entry)).toBe(serial);
    expect(shots.status(serial)).toBe('confirmed');
    expect(shots.leadTicks).toBe(3);
  });

  it('lands offline on the click tick itself, and holds no reticle after it', () => {
    const shots = new TurretOwnShotLedger();
    const serial = shots.mark(view(), 200, aim(CX + 5, CZ));
    const entry = fired(1, 200, CX + 5, CZ);
    const after = view({ feedback: [entry], readyTick: 200 + COOLDOWN });
    expect(shots.ownShotOf(after, entry)).toBe(serial);
    expect(shots.leadTicks).toBe(0);
    // A trip of 0 is a host firing inside the click: trusted at once, with no margin.
    expect([shots.leadLow, shots.leadHigh]).toEqual([0, 0]);
    expect(shots.holding(after, 200)).toBe(false);
    expect(shots.canMark(after, 200 + COOLDOWN - 1)).toBe(false);
    expect(shots.canMark(after, 200 + COOLDOWN)).toBe(true);
  });

  it('plays an unmarked fired entry as usual', () => {
    const shots = new TurretOwnShotLedger();
    const entry = fired(1, 200, CX, CZ + 30);
    expect(shots.ownShotOf(view({ feedback: [entry] }), entry)).toBe(0);
  });

  it('holds the reticle while a shot waits, until the next surely clears its cooldown', () => {
    const shots = measured(...JITTERY);
    expect([shots.leadLow, shots.leadHigh]).toEqual([2, 6]);
    const s = view();
    shots.mark(s, 200, aim(CX, CZ + 30));
    expect(shots.holding(s, 200)).toBe(true);
    // Its slowest trip readies the server at 215; the next click's fastest must arrive by then.
    const clear = 200 + 6 + COOLDOWN - 2;
    expect(shots.canMark(s, clear - 1)).toBe(false);
    expect(shots.canMark(s, clear)).toBe(true);
    shots.mark(s, clear, aim(CX, CZ + 31));
    expect(shots.launchAfter(s, 0)).not.toBeNull();
    expect(TURRET_OWN_SHOT_PENDING_MAX).toBe(2);
    expect(shots.canMark(s, clear + COOLDOWN)).toBe(false);
  });

  it('plays a click only once even the fastest trip in the band reaches a ready server', () => {
    // The old gate led the mirror by the smoothed trip less a tick (3 here): a 3-tick trip
    // then reached a server still cooling down.
    const jittery = measured(...JITTERY);
    const cooling = view({ readyTick: 220 });
    expect(jittery.canMark(cooling, 217)).toBe(false);
    expect(jittery.canMark(cooling, 218)).toBe(true);
    // Trips that never varied keep a tick of margin: the next one may still beat them.
    const steady = measured(7, 7, 7, 7, 7, 7, 7, 7);
    expect([steady.leadLow, steady.leadHigh]).toEqual([6, 8]);
    expect(steady.canMark(cooling, 213)).toBe(false);
    expect(steady.canMark(cooling, 214)).toBe(true);
    // A band of fewer trips is not trusted: the mirror's own ready tick, and a wide high end.
    const young = measured(7);
    expect([young.leadLow, young.leadHigh]).toEqual([0, 15]);
    expect(young.canMark(cooling, 219)).toBe(false);
    expect(young.canMark(cooling, 220)).toBe(true);
  });

  it('holds nothing for a click the server surely refuses, and the next for one it may take', () => {
    const shots = measured(3, 3, 3, 3, 3, 3, 3, 3);
    expect([shots.leadLow, shots.leadHigh]).toEqual([2, 4]);
    const s = view({ readyTick: 220 });
    // Even its slowest trip arrives before the cooldown ends: free, it neither plays nor holds.
    expect(shots.classify(s, 215)).toBe('free');
    shots.mark(s, 215, aim(CX, CZ + 30));
    expect(shots.launchAfter(s, 0)).toBeNull();
    expect(shots.canMark(s, 218)).toBe(true);
    // Its slowest trip would reach a ready server: held, it holds the next played click.
    expect(shots.classify(s, 217)).toBe('held');
    shots.mark(s, 217, aim(CX, CZ + 31));
    expect(shots.launchAfter(s, 0)).toBeNull();
    expect(shots.holding(s, 218)).toBe(true);
    expect(shots.canMark(s, 218)).toBe(false);
    // No entry by its slowest trip: the server refused it, and it holds no more.
    expect(shots.canMark(s, 221)).toBe(false);
    expect(shots.canMark(s, 222)).toBe(true);
  });

  it('adopts two waiting shots in fired order, each by its own point', () => {
    const shots = measured(14);
    const s = view();
    const first = shots.mark(s, 200, aim(CX, CZ + 30), 'played');
    const second = shots.mark(s, 210, aim(CX + 8, CZ + 30), 'played');
    const a = fired(1, 214, CX, CZ + 30);
    const b = fired(2, 224, CX + 8, CZ + 30);
    const both = view({ feedback: [a, b] });
    expect(shots.ownShotOf(both, a)).toBe(first);
    expect(shots.ownShotOf(both, b)).toBe(second);
    expect(shots.leadTicks).toBeCloseTo(14, 9);
  });

  it('refuses a mark no fired entry confirms inside the window, then flies a late one unheard', () => {
    const shots = new TurretOwnShotLedger();
    const s = view();
    const serial = shots.mark(s, 200, aim(CX, CZ + 30));
    const window = shots.confirmWindow;
    expect(window).toBe(2 * TURRET_OWN_SHOT_LEAD_TICKS + 4);
    shots.update(s, 200 + window);
    expect(shots.status(serial)).toBe('pending');
    shots.update(s, 200 + window + 1);
    expect(shots.status(serial)).toBe('refused');
    expect(shots.holding(s, 200 + window + 1)).toBe(false);
    // The server did fire it, late: a fresh shell with no second report, and its lead,
    // the only click at that point, widens the next window.
    const late = fired(1, 200 + 15, CX, CZ + 30);
    expect(shots.ownShotOf(view({ feedback: [late] }), late)).toBe(-serial);
    expect(shots.status(serial)).toBe('confirmed');
    expect(shots.leadTicks).toBe(15);
    expect(shots.confirmWindow).toBe(2 * 15 + 4);
  });

  it('refuses an older waiting mark the server skipped when a newer one fires', () => {
    const shots = measured(12);
    const s = view();
    const skipped = shots.mark(s, 200, aim(CX, CZ + 30), 'played');
    const taken = shots.mark(s, 210, aim(CX, CZ - 30), 'played');
    const entry = fired(1, 213, CX, CZ - 30);
    expect(shots.ownShotOf(view({ feedback: [entry] }), entry)).toBe(taken);
    expect(shots.status(skipped)).toBe('refused');
  });

  it('takes a same-point entry for the played click, but learns no trip from it', () => {
    // The server refused the played click and fired the held one at its point: the entry
    // stands for the shell in the air (one point, one report), but read as the played
    // click's trip it would claim 9 ticks.
    const shots = measured(3, 3, 3, 3, 3, 3, 3, 3);
    const s = view();
    const played = shots.mark(s, 200, aim(CX, CZ + 30), 'played');
    shots.mark(s, 206, aim(CX, CZ + 30), 'held');
    const entry = fired(1, 209, CX, CZ + 30);
    expect(shots.ownShotOf(view({ feedback: [entry] }), entry)).toBe(played);
    expect(shots.leadTicks).toBe(3);
    expect([shots.leadLow, shots.leadHigh]).toEqual([2, 4]);
  });

  it('among clicks as likely at one point, takes the one sent a trip before the entry', () => {
    const shots = measured(3, 3, 3, 3, 3, 3, 3, 3);
    const s = view();
    const older = shots.mark(s, 200, aim(CX, CZ + 30), 'held');
    const nearer = shots.mark(s, 204, aim(CX, CZ + 30), 'held');
    const entry = fired(1, 207, CX, CZ + 30);
    expect(shots.ownShotOf(view({ feedback: [entry] }), entry)).toBe(0);
    expect(shots.status(nearer)).toBe('confirmed');
    expect(shots.status(older)).toBe('refused');
  });

  it('never matches an entry fired before the click, or at another point', () => {
    const shots = new TurretOwnShotLedger();
    const s = view();
    const serial = shots.mark(s, 200, aim(CX, CZ + 30));
    const earlier = fired(1, 199, CX, CZ + 30);
    const elsewhere = fired(2, 203, CX, CZ + 31);
    const ring = view({ feedback: [earlier, elsewhere] });
    expect(shots.ownShotOf(ring, earlier)).toBe(0);
    expect(shots.ownShotOf(ring, elsewhere)).toBe(0);
    expect(shots.status(serial)).toBe('pending');
  });

  it('starts over with a new seat, and reuses its oldest settled record', () => {
    const shots = new TurretOwnShotLedger();
    const s = view();
    let last = 0;
    for (let i = 0; i < TURRET_OWN_SHOT_RECORDS + 2; i++) {
      last = shots.mark(s, 200 + i * 20, aim(CX, CZ + 10 + i));
      shots.update(s, 200 + i * 20 + 19);
    }
    expect(shots.status(1)).toBeNull();
    expect(shots.status(last)).toBe('refused');
    const next = view({ startTick: 900 });
    expect(shots.launchAfter(next, 0)).toBeNull();
    expect(shots.status(last)).toBeNull();
    expect(shots.mark(next, 950, aim(CX, CZ + 30))).toBe(last + 1);
  });
});

interface Armory extends Seat {
  shockReadyTick?: number;
  phaseEndTick?: number;
  shockwaves?: number;
  frags?: number;
  resupplies?: number;
  arsenal?: { shockwave: number; fragmentation: number };
}

/** A seat view with the limited weapons: 2 Shockwaves and 3 fragmentation shells by default. */
function armory(seat: Armory = {}): TurretSessionView {
  const base = view(seat);
  return {
    ...base,
    defense: {
      ...base.defense,
      shockReadyTick: seat.shockReadyTick ?? 0,
      phaseEndTick: seat.phaseEndTick ?? 0,
      plan: { arsenal: seat.arsenal ?? { shockwave: 2, fragmentation: 3 } },
      stats: {
        shockwaves: seat.shockwaves ?? 0,
        frags: seat.frags ?? 0,
        resupplies: seat.resupplies ?? 0,
      },
    } as unknown as TurretSessionView['defense'],
  };
}

function firedFrag(seq: number, tick: number, x: number, z: number): TurretFeedback {
  const entry = fired(seq, tick, x, z);
  return {
    ...entry,
    event: { ...(entry.event as Extract<TurretEvent, { type: 'fired' }>), weapon: 'frag' },
  };
}

function slammed(seq: number, tick: number): TurretFeedback {
  return {
    seq,
    tick,
    event: { type: 'shockwave', id: 1, x: CX, y: 0, z: CZ, startTick: tick, reach: 12 },
  };
}

const CENTER_AIM: TurretAim = { x: CX, z: CZ, dirX: 0, dirZ: 1, range: 0 };
const REARM = TURRET_SHOCKWAVE.rearmTicks;

describe('the own-shot ledger with the limited weapons', () => {
  it("counts a mission's resupplies in the charges a click sees, and never a weapon it lacks", () => {
    const shots = new TurretOwnShotLedger();
    const spent = { arsenal: { shockwave: 1, fragmentation: 0 }, shockwaves: 1 };
    const empty = armory({ ...spent, phase: 'between', phaseEndTick: 100 });
    expect(shots.chargesLeft(empty, 90, 'shock')).toBe(0);
    expect(shots.classify(empty, 90, 'shock')).toBe('free');
    // The wave's end resupplied it: one Shockwave more, still no fragmentation shell.
    const resupplied = armory({ ...spent, resupplies: 1, phase: 'between', phaseEndTick: 100 });
    expect(shots.chargesLeft(resupplied, 95, 'shock')).toBe(1);
    expect(shots.chargesLeft(resupplied, 95, 'frag')).toBe(0);
    const wave = armory({ ...spent, resupplies: 1, phase: 'wave' });
    expect(shots.classify(wave, 120, 'shock')).toBe('played');
    expect(shots.classify(wave, 120, 'frag')).toBe('free');
    shots.markWeapon(wave, 120, CENTER_AIM, 'shock');
    // The played click spends the resupplied charge as the player sees it: none twice.
    expect(shots.chargesLeft(wave, 120, 'shock')).toBe(0);
    expect(shots.classify(wave, 121, 'shock')).toBe('free');
  });

  it('keeps a waiting click spent across the resupply it lands with, and gives it back refused', () => {
    const shots = new TurretOwnShotLedger();
    const arsenal = { shockwave: 0, fragmentation: 2 };
    const wave = armory({ arsenal, frags: 1, phase: 'wave' });
    const serial = shots.markWeapon(wave, 200, aim(CX, CZ + 30), 'frag');
    expect(shots.chargesLeft(wave, 200, 'frag')).toBe(0);
    // The wave ends with the click still waiting: 2 given, 1 resupplied, 1 spent, 1 waiting.
    const cleared = armory({
      arsenal,
      frags: 1,
      resupplies: 1,
      phase: 'between',
      phaseEndTick: 400,
    });
    expect(shots.chargesLeft(cleared, 201, 'frag')).toBe(1);
    const late = 200 + shots.confirmWindow + 1;
    shots.update(cleared, late);
    expect(shots.status(serial)).toBe('refused');
    expect(shots.chargesLeft(cleared, late, 'frag')).toBe(2);
    expect(shots.chargesLeft(cleared, late, 'shock')).toBe(0);
  });

  it('plays a weapon click only in a wave, with a charge left and its own clock ready', () => {
    const shots = new TurretOwnShotLedger();
    expect(shots.canMark(armory(), 200, 'shock')).toBe(true);
    expect(shots.canMark(armory(), 200, 'frag')).toBe(true);
    // The server refuses both silently outside a wave, so a charge is never spent there.
    for (const phase of ['intro', 'between'] as const) {
      const lull = armory({ phase, phaseEndTick: 260 });
      expect(shots.canMark(lull, 200, 'shock')).toBe(false);
      expect(shots.canMark(lull, 200, 'frag')).toBe(false);
      expect(shots.classify(lull, 200, 'frag')).toBe('free');
      // A shell still fires between waves.
      expect(shots.canMark(lull, 200)).toBe(true);
    }
    // No charge left: never played, never held.
    const empty = armory({ shockwaves: 2, frags: 3 });
    expect(shots.classify(empty, 200, 'shock')).toBe('free');
    expect(shots.classify(empty, 200, 'frag')).toBe('free');
    // The Shockwave rearms on its own clock, apart from the cannon's reload.
    const rearming = armory({ shockReadyTick: 210, readyTick: 210 });
    expect(shots.canMark(rearming, 200, 'shock')).toBe(false);
    expect(shots.canMark(armory({ shockReadyTick: 210 }), 200, 'frag')).toBe(true);
    expect(shots.canMark(armory({ readyTick: 210 }), 200, 'shock')).toBe(true);
    expect(shots.canMark(armory({ readyTick: 210 }), 200, 'frag')).toBe(false);
  });

  it('shows a charge spent on a played click and gives it back when the click is refused', () => {
    const shots = new TurretOwnShotLedger();
    const s = armory();
    expect(shots.chargesLeft(s, 200, 'frag')).toBe(3);
    const serial = shots.markWeapon(s, 200, aim(CX, CZ + 30), 'frag');
    expect(shots.status(serial)).toBe('pending');
    expect(shots.chargesLeft(s, 200, 'frag')).toBe(2);
    expect(shots.chargesLeft(s, 200, 'shock')).toBe(2);
    shots.update(s, 200 + shots.confirmWindow + 1);
    expect(shots.status(serial)).toBe('refused');
    expect(shots.chargesLeft(s, 200 + shots.confirmWindow + 1, 'frag')).toBe(3);
  });

  it('never plays the last charge twice while its click waits', () => {
    // Long trips (18 ticks, trusted): a slam still waits for its entry when the rearm is over.
    const lastOne = measured(18, 18, 18, 18, 18, 18, 18, 18);
    const twoLeft = measured(18, 18, 18, 18, 18, 18, 18, 18);
    const s = armory({ shockwaves: 1 });
    expect(lastOne.classify(s, 200, 'shock')).toBe('played');
    lastOne.markWeapon(s, 200, CENTER_AIM, 'shock');
    twoLeft.markWeapon(armory(), 200, CENTER_AIM, 'shock');
    expect(lastOne.chargesLeft(s, 200, 'shock')).toBe(0);
    const ready = 200 + 19 + REARM - 17;
    expect(twoLeft.classify(armory(), ready, 'shock')).toBe('played');
    // The waiting slam surely takes the last charge: a click now is surely refused.
    expect(lastOne.classify(s, ready, 'shock')).toBe('free');
    expect(lastOne.status(1 + 8)).toBe('pending');
  });

  it('confirms a fragmentation shell only by a frag entry, and a shell only by a plain one', () => {
    const shots = new TurretOwnShotLedger();
    const s = armory();
    const frag = shots.markWeapon(s, 200, aim(CX, CZ + 30), 'frag');
    const plain = fired(1, 200, CX, CZ + 30);
    expect(shots.ownShotOf(armory({ feedback: [plain] }), plain)).toBe(0);
    expect(shots.status(frag)).toBe('pending');
    const burst = firedFrag(2, 200, CX, CZ + 30);
    const both = armory({ feedback: [plain, burst], frags: 1 });
    expect(shots.ownShotOf(both, burst)).toBe(frag);
    expect(shots.ownShotOf(both, burst)).toBe(frag);
    expect(shots.status(frag)).toBe('confirmed');
    expect(shots.chargesLeft(both, 200, 'frag')).toBe(2);
    // The other way round: a frag entry at a shell's point is not that shell's.
    const other = new TurretOwnShotLedger();
    const shell = other.mark(armory(), 200, aim(CX, CZ + 30));
    const lone = firedFrag(1, 200, CX, CZ + 30);
    expect(other.ownShotOf(armory({ feedback: [lone], frags: 1 }), lone)).toBe(0);
    expect(other.status(shell)).toBe('pending');
  });

  it('confirms a shell and a Shockwave sent on one tick, entries in command order', () => {
    for (const shockFirst of [false, true]) {
      const shots = new TurretOwnShotLedger();
      const s = armory();
      const shellMark = () => shots.mark(s, 200, aim(CX, CZ + 30));
      const slamMark = () => shots.markWeapon(s, 200, CENTER_AIM, 'shock');
      const first = shockFirst ? slamMark() : shellMark();
      const second = shockFirst ? shellMark() : slamMark();
      const shellEntry = fired(shockFirst ? 2 : 1, 203, CX, CZ + 30);
      const slamEntry = slammed(shockFirst ? 1 : 2, 203);
      const ring = shockFirst ? [slamEntry, shellEntry] : [shellEntry, slamEntry];
      const after = armory({ feedback: ring, shockwaves: 1, shockReadyTick: 203 + REARM });
      for (const entry of ring) {
        const own =
          entry === slamEntry ? (shockFirst ? first : second) : shockFirst ? second : first;
        expect(shots.ownShotOf(after, entry), `shock first: ${shockFirst}`).toBe(own);
      }
      expect([shots.status(first), shots.status(second)]).toEqual(['confirmed', 'confirmed']);
    }
  });

  it('shares the cannon reload between the shell and the fragmentation shell', () => {
    const shots = measured(0);
    const s = armory();
    shots.markWeapon(s, 200, aim(CX, CZ + 30), 'frag');
    expect(shots.canMark(s, 200)).toBe(false);
    expect(shots.canMark(s, 200 + COOLDOWN)).toBe(true);
    // The Shockwave is not on that clock.
    expect(shots.canMark(s, 200, 'shock')).toBe(true);
  });

  it('confirms a Shockwave by its entry, hands its slam to the readers once, and never twice', () => {
    const shots = new TurretOwnShotLedger();
    const s = armory();
    const serial = shots.markWeapon(s, 200, CENTER_AIM, 'shock');
    const slam = shots.launchAfter(s, 0);
    expect(slam).toMatchObject({ serial, weapon: 'shock', fromX: CX, fromZ: CZ });
    expect(shots.launchAfter(s, serial)).toBeNull();
    const entry = slammed(1, 203);
    const after = armory({ feedback: [entry], shockwaves: 1, shockReadyTick: 203 + REARM });
    // Its slam played on the click: every reader of the entry skips it, the ring still plays.
    expect(shots.ownShotOf(after, entry)).toBe(serial);
    expect(shots.ownShotOf(after, entry)).toBe(serial);
    expect(shots.status(serial)).toBe('confirmed');
    expect(shots.leadTicks).toBe(3);
    // An unmarked Shockwave (another tab, a replayed ring) plays whole from its entry.
    const other = slammed(2, 260);
    expect(shots.ownShotOf(armory({ feedback: [entry, other] }), other)).toBe(0);
  });

  it('keeps a shell mark launched without a weapon, as its fired entry carries none', () => {
    const shots = new TurretOwnShotLedger();
    shots.mark(armory(), 200, aim(CX, CZ + 30));
    expect(shots.launchAfter(armory(), 0)?.weapon).toBeUndefined();
  });

  it('refuses a waiting Shockwave the server skipped when a later command confirms', () => {
    const shots = measured(3);
    const s = armory();
    const slam = shots.markWeapon(s, 200, CENTER_AIM, 'shock', 'played');
    const shell = shots.mark(s, 202, aim(CX, CZ + 30), 'played');
    const entry = fired(1, 205, CX, CZ + 30);
    expect(shots.ownShotOf(armory({ feedback: [entry] }), entry)).toBe(shell);
    expect(shots.status(slam)).toBe('refused');
    expect(shots.chargesLeft(armory({ feedback: [entry] }), 205, 'shock')).toBe(2);
  });
});
