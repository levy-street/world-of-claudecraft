// Max-Level XP Overflow & Post-Cap Progression.
//
// Covers the PRD's testing strategy: at-cap XP routes to lifetimeXp (not
// gold/zero) for both the solo and party paths, mid-level carry still works,
// virtual-level boundaries, level-diff anti-farm still gates trivial mobs,
// prestige resets the bar but not lifetimeXp, persistence round-trips, the
// XP-bar label states (pre-cap / at-cap / post-cap), and the online
// (ClientWorld) snapshot path — not just offline.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db layer so the online-path test needs no Postgres (mirrors
// snapshots.test.ts). Hoisted by vitest, so it applies to server/game below.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { Sim, CharacterState } from '../src/sim/sim';
import {
  MAX_LEVEL, MILESTONES, mobXpValue, virtualLevel, virtualLevelProgress,
  xpForLevel, xpToReachLevel, zeroDiff,
  PRESTIGE_XP_PER_RANK, maxPrestigeRank, canPrestige, xpUntilNextPrestige,
} from '../src/sim/types';
import { xpBarView, formatXp } from '../src/ui/xp_bar';
import { GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';
import { terrainHeight } from '../src/sim/world';

function makeSim(cls: 'warrior' | 'mage' | 'rogue' = 'warrior', seed = 42): Sim {
  return new Sim({ seed, playerClass: cls, autoEquip: true });
}

function nearestMob(sim: Sim) {
  const p = sim.player;
  let best: any = null, bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function teleport(sim: Sim, e: any, x: number, z: number) {
  e.pos.x = x; e.pos.z = z; e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

// -------------------------------------------------------------------------
// Pure curve functions
// -------------------------------------------------------------------------

describe('virtual-level curve', () => {
  it('below the cap, virtual level equals the real level', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      // lifetime XP to *reach* this level, plus a little into the bar
      const lifetime = xpToReachLevel(level) + (level < MAX_LEVEL ? Math.floor(xpForLevel(level) / 2) : 0);
      expect(virtualLevel(lifetime)).toBe(level);
    }
  });

  it('xpToReachLevel is monotonic and matches XP_TABLE pre-cap', () => {
    expect(xpToReachLevel(1)).toBe(0);
    expect(xpToReachLevel(2)).toBe(xpForLevel(1));
    expect(xpToReachLevel(3)).toBe(xpForLevel(1) + xpForLevel(2));
    for (let l = 1; l < 40; l++) {
      expect(xpToReachLevel(l + 1)).toBeGreaterThan(xpToReachLevel(l));
    }
  });

  it('virtual level climbs past the cap on lifetime XP boundaries', () => {
    // exactly at the cap threshold → virtual 20, one XP short → still 19's band? no: 20
    expect(virtualLevel(xpToReachLevel(20))).toBe(20);
    expect(virtualLevel(xpToReachLevel(21))).toBe(21);
    expect(virtualLevel(xpToReachLevel(21) - 1)).toBe(20);
    expect(virtualLevel(xpToReachLevel(27))).toBe(27);
    expect(virtualLevel(xpToReachLevel(27) + 1)).toBe(27);
    expect(virtualLevel(xpToReachLevel(28) - 1)).toBe(27);
  });

  it('post-cap levels cost progressively more (geometric grind)', () => {
    const step21 = xpToReachLevel(22) - xpToReachLevel(21);
    const step20 = xpToReachLevel(21) - xpToReachLevel(20);
    const step30 = xpToReachLevel(31) - xpToReachLevel(30);
    expect(step21).toBeGreaterThan(step20);
    expect(step30).toBeGreaterThan(step21);
  });

  it('virtualLevelProgress reports position within the current virtual level', () => {
    const base = xpToReachLevel(25);
    const span = xpToReachLevel(26) - xpToReachLevel(25);
    const prog = virtualLevelProgress(base + Math.floor(span / 2));
    expect(prog.level).toBe(25);
    expect(prog.span).toBe(span);
    expect(prog.into).toBeCloseTo(Math.floor(span / 2), -1);
  });
});

// -------------------------------------------------------------------------
// Solo cap-gate: at-cap XP routes to lifetimeXp, never gold/zero
// -------------------------------------------------------------------------

describe('solo grantXp at the cap', () => {
  it('accrues lifetimeXp at the cap instead of discarding it', () => {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(MAX_LEVEL);
    expect(sim.player.level).toBe(MAX_LEVEL);
    const before = sim.lifetimeXp;
    sim.grantXp(5000);
    expect(sim.lifetimeXp).toBe(before + 5000);
    // the level bar stays frozen — no power, no de-level, no level-up
    expect(sim.player.level).toBe(MAX_LEVEL);
    expect(sim.xp).toBe(0);
  });

  it('keeps accruing across many post-cap awards (overflow never resets)', () => {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(MAX_LEVEL);
    let expected = sim.lifetimeXp;
    for (let i = 0; i < 50; i++) { sim.grantXp(1000); expected += 1000; }
    expect(sim.lifetimeXp).toBe(expected);
    expect(virtualLevel(sim.lifetimeXp)).toBeGreaterThan(MAX_LEVEL);
  });

  it('a level-up into the cap keeps the overflow remainder in lifetimeXp', () => {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(MAX_LEVEL - 1); // level 19
    const lifeBefore = sim.lifetimeXp;
    const need = xpForLevel(MAX_LEVEL - 1); // 19 → 20
    sim.grantXp(need + 7777); // dings to 20 with a big overflow remainder
    expect(sim.player.level).toBe(MAX_LEVEL);
    expect(sim.xp).toBe(0); // bar cleared on reaching cap…
    expect(sim.lifetimeXp).toBe(lifeBefore + need + 7777); // …but nothing was lost
  });

  it('emits a virtual-level-up event when crossing a virtual level past cap', () => {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(MAX_LEVEL);
    sim.events.length = 0;
    sim.grantXp(xpToReachLevel(22)); // jump well past the cap
    const vlevels = sim.events.filter((e) => e.type === 'virtualLevelUp').map((e: any) => e.level);
    expect(vlevels).toContain(21);
    expect(vlevels).toContain(22);
  });
});

// -------------------------------------------------------------------------
// Mid-level carry (regression — must keep working)
// -------------------------------------------------------------------------

describe('pre-cap leveling regression', () => {
  it('carries overflow XP between levels', () => {
    const sim = makeSim('warrior');
    sim.grantXp(xpForLevel(1) + xpForLevel(2) + 10);
    expect(sim.player.level).toBe(3);
    expect(sim.xp).toBe(10); // carry preserved
  });

  it('lifetimeXp tracks the running total and matches virtual level pre-cap', () => {
    const sim = makeSim('warrior');
    sim.grantXp(xpForLevel(1) + xpForLevel(2) + 10);
    // total earned = sum of crossed levels + carry = xpToReachLevel(3) + 10
    expect(sim.lifetimeXp).toBe(xpToReachLevel(3) + 10);
    expect(virtualLevel(sim.lifetimeXp)).toBe(sim.player.level);
  });
});

// -------------------------------------------------------------------------
// Party cap-gate: a max-level party member still accrues lifetimeXp
// -------------------------------------------------------------------------

describe('party grantXp at the cap', () => {
  it('a capped party member accrues lifetimeXp from a shared kill', () => {
    const sim = makeSim('warrior');
    const p1 = sim.playerId;
    const p2 = sim.addPlayer('warrior', 'Bjorn');
    sim.partyInvite(p2, p1);
    sim.partyAccept(p2);
    sim.setPlayerLevel(MAX_LEVEL, p1);
    sim.setPlayerLevel(MAX_LEVEL, p2);

    const wolf = nearestMob(sim);
    wolf.level = MAX_LEVEL; // make it worth XP for level-20 killers (anti-gray)
    const e1 = sim.entities.get(p1)!;
    const e2 = sim.entities.get(p2)!;
    teleport(sim, e1, wolf.pos.x, wolf.pos.z);
    teleport(sim, e2, wolf.pos.x, wolf.pos.z);

    const m2 = sim.meta(p2)!;
    const before2 = m2.lifetimeXp;
    wolf.hp = 1;
    (sim as any).dealDamage(e1, wolf, 9999, false, 'physical', 'Test', 'hit');

    expect(wolf.dead).toBe(true);
    expect(m2.lifetimeXp).toBeGreaterThan(before2); // capped member still earns
    expect(e2.level).toBe(MAX_LEVEL); // …with no level/power change
    expect(m2.xp).toBe(0);
  });
});

// -------------------------------------------------------------------------
// Anti-farm: level-diff scaling still zeroes trivial mobs
// -------------------------------------------------------------------------

describe('anti-farm level-diff scaling', () => {
  it('gray mobs grant zero XP even post-cap', () => {
    // a level-20 player vs a far-lower mob: beyond the zero-diff band → 0
    expect(zeroDiff(MAX_LEVEL)).toBe(8);
    expect(mobXpValue(MAX_LEVEL - zeroDiff(MAX_LEVEL), MAX_LEVEL)).toBe(0);
    expect(mobXpValue(3, MAX_LEVEL)).toBe(0);
  });

  it('a zero award is a no-op on lifetimeXp', () => {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(MAX_LEVEL);
    const before = sim.lifetimeXp;
    sim.grantXp(0);
    sim.grantXp(mobXpValue(3, MAX_LEVEL)); // gray → 0
    expect(sim.lifetimeXp).toBe(before);
  });
});

// -------------------------------------------------------------------------
// Milestones
// -------------------------------------------------------------------------

describe('cosmetic milestones', () => {
  it('unlocks, emits, and persists the first milestone', () => {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(MAX_LEVEL);
    const first = MILESTONES[0];
    sim.events.length = 0;
    sim.grantXp(first.lifetimeXp + 1);
    expect(sim.unlockedMilestones).toContain(first.id);
    expect(sim.events.some((e: any) => e.type === 'milestoneUnlocked' && e.milestoneId === first.id)).toBe(true);
  });

  it('does not re-unlock a milestone already earned', () => {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(MAX_LEVEL);
    sim.grantXp(MILESTONES[0].lifetimeXp + 1);
    sim.events.length = 0;
    sim.grantXp(1000);
    expect(sim.events.some((e: any) => e.type === 'milestoneUnlocked')).toBe(false);
  });
});

// -------------------------------------------------------------------------
// Prestige: resets the bar, not lifetimeXp; cap-gated; cosmetic
// -------------------------------------------------------------------------

describe('prestige', () => {
  it('resets the level bar and bumps rank but never lifetimeXp', () => {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(MAX_LEVEL);
    sim.grantXp(800_000); // build a real lifetime total
    const m = sim.meta(sim.playerId)!;
    m.xp = 123; // simulate stray bar XP to prove the reset clears it
    const lifeBefore = sim.lifetimeXp;
    const ok = sim.prestige();
    expect(ok).toBe(true);
    expect(sim.xp).toBe(0); // bar reset
    expect(sim.prestigeRank).toBe(1); // rank incremented
    expect(sim.lifetimeXp).toBe(lifeBefore); // lifetime untouched
    expect(sim.player.level).toBe(MAX_LEVEL); // no de-level / power loss
  });

  it('is refused below the cap', () => {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(10);
    expect(sim.prestige()).toBe(false);
    expect(sim.prestigeRank).toBe(0);
  });
});

describe('prestige anti-abuse gate (server-locked rank)', () => {
  it('refuses prestige at the cap with no post-cap XP earned', () => {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(MAX_LEVEL); // lifetimeXp == cap threshold, nothing earned past it
    expect(maxPrestigeRank(sim.lifetimeXp)).toBe(0);
    expect(sim.prestige()).toBe(false);
    expect(sim.prestigeRank).toBe(0);
  });

  it('caps rank at earned post-cap XP — spamming the command cannot inflate it', () => {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(MAX_LEVEL);
    // earn exactly 3 prestige bars of post-cap XP
    sim.grantXp(PRESTIGE_XP_PER_RANK * 3);
    const allowed = maxPrestigeRank(sim.lifetimeXp);
    expect(allowed).toBe(3);
    // simulate a hacked client hammering the prestige command 100×
    let successes = 0;
    for (let i = 0; i < 100; i++) if (sim.prestige()) successes++;
    expect(successes).toBe(3);          // only as many as the earned XP supports
    expect(sim.prestigeRank).toBe(3);   // never beyond the XP-backed cap
    expect(sim.lifetimeXp).toBeGreaterThanOrEqual(xpToReachLevel(MAX_LEVEL)); // lifetime untouched by prestige
  });

  it('unlocks the next rank only after earning another full bar', () => {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(MAX_LEVEL);
    sim.grantXp(PRESTIGE_XP_PER_RANK);     // exactly one bar
    expect(sim.prestige()).toBe(true);     // rank 1
    expect(sim.prestige()).toBe(false);    // no XP left for rank 2
    expect(sim.prestigeRank).toBe(1);
    expect(xpUntilNextPrestige(sim.lifetimeXp, sim.prestigeRank)).toBe(PRESTIGE_XP_PER_RANK);
    sim.grantXp(PRESTIGE_XP_PER_RANK);     // earn another bar
    expect(canPrestige(MAX_LEVEL, sim.lifetimeXp, sim.prestigeRank)).toBe(true);
    expect(sim.prestige()).toBe(true);     // rank 2
    expect(sim.prestigeRank).toBe(2);
  });

  it('canPrestige is false below the cap regardless of lifetime XP', () => {
    expect(canPrestige(MAX_LEVEL - 1, 9_999_999, 0)).toBe(false);
  });
});

// -------------------------------------------------------------------------
// Persistence round-trip + legacy backfill
// -------------------------------------------------------------------------

describe('persistence', () => {
  it('round-trips lifetimeXp, prestigeRank, and milestones', () => {
    const sim = makeSim('warrior');
    sim.setPlayerLevel(MAX_LEVEL);
    sim.grantXp(MILESTONES[0].lifetimeXp + 5);
    sim.prestige();
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.lifetimeXp).toBeGreaterThan(0);
    expect(state.prestigeRank).toBe(1);
    expect(state.unlockedMilestones).toContain(MILESTONES[0].id);

    const sim2 = makeSim('warrior');
    const pid = sim2.addPlayer('warrior', 'Reload', { state });
    const m = sim2.meta(pid)!;
    expect(m.lifetimeXp).toBe(state.lifetimeXp);
    expect(m.prestigeRank).toBe(1);
    expect([...m.unlockedMilestones]).toContain(MILESTONES[0].id);
  });

  it('backfills lifetimeXp for characters saved before the counter existed', () => {
    const sim = makeSim('warrior');
    // a legacy save: level + bar XP, but no lifetimeXp field
    const legacy = sim.serializeCharacter(sim.playerId)!;
    const state: CharacterState = { ...legacy, level: 12, xp: 500 };
    delete (state as any).lifetimeXp;
    const sim2 = makeSim('warrior');
    const pid = sim2.addPlayer('warrior', 'Legacy', { state });
    const m = sim2.meta(pid)!;
    expect(m.lifetimeXp).toBe(xpToReachLevel(12) + 500);
  });
});

// -------------------------------------------------------------------------
// XP-bar label snapshots (pre-cap / at-cap / post-cap)
// -------------------------------------------------------------------------

describe('xp-bar label states', () => {
  it('pre-cap shows the level bar', () => {
    const v = xpBarView({ level: 5, xp: 1000, lifetimeXp: 0, showOverflow: true });
    expect(v.postCap).toBe(false);
    expect(v.label).toBe('1,000 / 2,800 XP (35%)');
  });

  it('at-cap with overflow shows the virtual-level bar starting at +0', () => {
    const v = xpBarView({ level: MAX_LEVEL, xp: 0, lifetimeXp: xpToReachLevel(MAX_LEVEL), showOverflow: true });
    expect(v.postCap).toBe(true);
    expect(v.label).toBe(`Lv 20 (+0)  ·  ${formatXp(xpToReachLevel(MAX_LEVEL))} total XP  ·  0% to next`);
  });

  it('post-cap shows virtual level, total, and percent to next', () => {
    const lifetime = xpToReachLevel(27); // start of virtual level 27
    const v = xpBarView({ level: MAX_LEVEL, xp: 0, lifetimeXp: lifetime, showOverflow: true });
    expect(v.postCap).toBe(true);
    expect(v.label).toBe(`Lv 20 (+7)  ·  ${formatXp(lifetime)} total XP  ·  0% to next`);
  });

  it('post-cap fill fraction advances within the virtual level', () => {
    const base = xpToReachLevel(27);
    const span = xpToReachLevel(28) - xpToReachLevel(27);
    const v = xpBarView({ level: MAX_LEVEL, xp: 0, lifetimeXp: base + Math.floor(span * 0.5), showOverflow: true });
    expect(v.fillFrac).toBeCloseTo(0.5, 1);
    expect(v.label).toMatch(/Lv 20 \(\+7\)  ·  .* total XP  ·  \d+% to next/);
  });

  it('classic "MAX LEVEL" when overflow display is turned off', () => {
    const v = xpBarView({ level: MAX_LEVEL, xp: 0, lifetimeXp: xpToReachLevel(25), showOverflow: false });
    expect(v.postCap).toBe(false);
    expect(v.label).toBe(`MAX LEVEL  ·  ${formatXp(xpToReachLevel(25))} total XP`);
  });
});

// -------------------------------------------------------------------------
// Online path: the values flow through the snapshot to the ClientWorld, and
// the client derives virtual level for display (server stays authoritative).
// -------------------------------------------------------------------------

function bareClient(pid: number): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass: 'warrior' };
  c.entities = new Map();
  c.missingSince = new Map(); // despawn-grace bookkeeping (set by the real field initializer)
  c.playerId = pid;
  c.moveInput = {};
  c.inventory = [];
  c.equipment = {};
  c.copper = 0;
  c.xp = 0;
  c.lifetimeXp = 0;
  c.prestigeRank = 0;
  c.unlockedMilestones = [];
  c.known = [];
  c.questLog = new Map();
  c.questsDone = new Set();
  c.pendingQuestCommands = new Map();
  c.partyInfo = null;
  c.tradeInfo = null;
  c.duelInfo = null;
  c.lastSnapAt = 0;
  c.snapInterval = 50;
  c.pendingFacingDelta = 0;
  c.connected = true;
  c.eventQueue = [];
  c.mouselookFacing = null;
  return c;
}

describe('online ClientWorld path', () => {
  let server: GameServer;

  beforeEach(() => {
    server = new GameServer();
  });

  it('post-cap lifetimeXp and prestige reach the client via snapshot', () => {
    const fc = { sent: [] as any[], ws: { readyState: 1, send: (p: string) => fc.sent.push(JSON.parse(p)) } };
    const session = server.join(fc.ws as any, 1, 1, 'Hilda', 'warrior', null);
    if ('error' in session) throw new Error(session.error);

    server.sim.setPlayerLevel(MAX_LEVEL, session.pid);
    server.sim.grantXp(xpToReachLevel(23), server.sim.meta(session.pid)!);
    server.sim.prestige(session.pid);

    (server as any).broadcastSnapshots();
    const snap = [...fc.sent].reverse().find((m) => m.t === 'snap');
    expect(snap).toBeTruthy();
    expect(snap.self.lxp).toBe(server.sim.meta(session.pid)!.lifetimeXp);
    expect(snap.self.prk).toBe(1);

    const serverLifetime = server.sim.meta(session.pid)!.lifetimeXp;
    const client = bareClient(session.pid);
    (client as any).applySnapshot(snap);
    expect(client.lifetimeXp).toBe(serverLifetime);
    expect(client.prestigeRank).toBe(1);
    // the client derives the cosmetic virtual level for display — identical to
    // what the authoritative sim computes, and past the cap
    expect(virtualLevel(client.lifetimeXp)).toBe(virtualLevel(serverLifetime));
    expect(virtualLevel(client.lifetimeXp)).toBeGreaterThan(MAX_LEVEL);
    expect(client.player.level).toBe(MAX_LEVEL);
  });
});
