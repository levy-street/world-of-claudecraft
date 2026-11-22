// Party pings, sim layer (src/sim/social/party_pings.ts): who sees a ping
// (the sender's party or raid, solo only the sender), what a ping may point
// at (a finite point or a live unit within range, never a hidden enemy), how
// often (the per-sender sliding window on the sim clock), how long it lives
// (its lifetime, or until its unit dies or despawns) and when the store
// forgets it (party disband, every prune).

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import {
  isPingKind,
  PARTY_PING_BURST,
  PARTY_PING_GROUP_MAX,
  PARTY_PING_LIFETIME_S,
  PARTY_PING_RANGE,
  PARTY_PING_SENDER_MAX,
  PARTY_PING_WINDOW_S,
  type PartyPings,
  PING_ASSIST,
  PING_ATTACK,
  PING_KIND_COUNT,
  PING_LOOK,
  PING_WARNING,
  pingGroupKey,
} from '../src/sim/social/party_pings';
import { DT } from '../src/sim/types';

function world() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function party(sim: Sim, ...pids: number[]): void {
  for (let i = 1; i < pids.length; i++) {
    sim.partyInvite(pids[i], pids[0]);
    sim.partyAccept(pids[i]);
  }
}

function store(sim: Sim): PartyPings {
  return (sim as unknown as { targeting: { pings: PartyPings } }).targeting.pings;
}

const view = (sim: Sim, pid: number) => store(sim).viewFor(pid);

/** Advance the sim clock by `seconds` (whole ticks). */
function wait(sim: Sim, seconds: number): void {
  for (let i = 0; i < Math.ceil(seconds / DT); i++) sim.tick();
}

function posOf(sim: Sim, id: number) {
  const e = sim.entities.get(id);
  if (!e) throw new Error(`no entity ${id}`);
  return e.pos;
}

/** A ground point a few yards in front of `pid`. */
function near(sim: Sim, pid: number, dx = 5) {
  const p = posOf(sim, pid);
  return { x: p.x + dx, y: p.y, z: p.z };
}

function pingAt(sim: Sim, pid: number, kind = PING_LOOK, dx = 5): boolean {
  const p = near(sim, pid, dx);
  return store(sim).send(kind, null, p.x, p.y, p.z, pid);
}

/** A live mob, with `pid` moved beside it. */
function besideMob(sim: Sim, pid: number) {
  const mob = [...sim.entities.values()].find((e) => e.kind === 'mob' && !e.dead);
  if (!mob) throw new Error('no mob in the world');
  const me = sim.entities.get(pid);
  if (!me) throw new Error('no player');
  me.pos = { x: mob.pos.x + 6, y: mob.pos.y, z: mob.pos.z };
  return mob;
}

describe('party pings: the kinds', () => {
  it('five wire kinds, nothing else', () => {
    expect(PING_KIND_COUNT).toBe(5);
    for (let k = 0; k < PING_KIND_COUNT; k++) expect(isPingKind(k)).toBe(true);
    for (const bad of [-1, 5, 1.5, Number.NaN, '1', null]) expect(isPingKind(bad)).toBe(false);
  });

  it('a group key is the party, or the player when solo', () => {
    expect(pingGroupKey(null, 7)).toBe('solo:7');
    expect(pingGroupKey(3, 7)).toBe('party:3');
  });
});

describe('party pings: who sees them', () => {
  it('a solo player sees their own ping, and nobody else does', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    expect(pingAt(sim, a)).toBe(true);
    expect(view(sim, a)).toHaveLength(1);
    expect(view(sim, a)[0]).toMatchObject({ kind: PING_LOOK, from: a, fromName: 'Aleph' });
    expect(view(sim, b)).toEqual([]);
  });

  it('every party member sees a member ping; an outsider does not', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const c = sim.addPlayer('priest', 'Gimel');
    party(sim, a, b);
    expect(pingAt(sim, b, PING_WARNING)).toBe(true);
    expect(view(sim, a)).toEqual(view(sim, b));
    expect(view(sim, a)[0]).toMatchObject({ kind: PING_WARNING, from: b, fromName: 'Bet' });
    expect(view(sim, c)).toEqual([]);
    expect(store(sim).wireFor(c)).toBe('null');
  });

  it('a raid member reaches the whole raid', () => {
    const sim = world();
    // A raid needs a full party of five to convert, then fills a second subgroup.
    const pids = [1, 2, 3, 4, 5].map((n) => sim.addPlayer('warrior', `P${n}`));
    party(sim, ...pids);
    sim.convertPartyToRaid(pids[0]);
    const c = sim.addPlayer('priest', 'Gimel');
    sim.partyInvite(c, pids[0]);
    sim.partyAccept(c);
    expect(sim.partyOf(c)?.raid).toBe(true);
    expect(pingAt(sim, c)).toBe(true);
    for (const pid of pids) expect(view(sim, pid)).toHaveLength(1);
  });

  it('the offline Sim reads the primary player view through IWorld', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const p = sim.player.pos;
    sim.sendPing(PING_LOOK, null, p.x + 3, p.y, p.z + 3);
    expect(sim.partyPings()).toHaveLength(1);
    expect(sim.partyPings()[0].from).toBe(sim.playerId);
  });

  it('the wire row is serialized once and shared by the group', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    party(sim, a, b);
    pingAt(sim, a);
    const wa = store(sim).wireFor(a);
    const wb = store(sim).wireFor(b);
    expect(wa).toBe(wb);
    const [row] = JSON.parse(wa) as unknown[][];
    const ping = view(sim, a)[0];
    expect(row).toEqual([ping.id, PING_LOOK, a, 'Aleph', 0, ping.x, ping.y, ping.z, '', '', '']);
  });
});

describe('party pings: validation', () => {
  it('refuses a bad kind, a non-finite point and an unknown sender', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    const p = near(sim, a);
    const s = store(sim);
    expect(s.send(PING_KIND_COUNT, null, p.x, p.y, p.z, a)).toBe(false);
    expect(s.send(-1, null, p.x, p.y, p.z, a)).toBe(false);
    expect(s.send(PING_LOOK, null, Number.NaN, p.y, p.z, a)).toBe(false);
    expect(s.send(PING_LOOK, null, p.x, Number.POSITIVE_INFINITY, p.z, a)).toBe(false);
    expect(s.send(PING_LOOK, null, p.x, p.y, p.z, 999_999)).toBe(false);
    expect(view(sim, a)).toEqual([]);
  });

  it('refuses a point out of range, horizontally or vertically', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    const p = posOf(sim, a);
    const s = store(sim);
    expect(s.send(PING_LOOK, null, p.x + PARTY_PING_RANGE + 1, p.y, p.z, a)).toBe(false);
    expect(s.send(PING_LOOK, null, p.x + 1, p.y + 200, p.z, a)).toBe(false);
    expect(s.send(PING_LOOK, null, p.x + PARTY_PING_RANGE - 1, p.y, p.z, a)).toBe(true);
  });

  it('a ground ping stands on the sim floor, never the clicked height', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    const p = posOf(sim, a);
    // A click a few yards in the air over flat ground still lands on the floor.
    expect(store(sim).send(PING_LOOK, null, p.x + 4, p.y + 10, p.z, a)).toBe(true);
    const [ping] = view(sim, a);
    expect(ping.y).toBeLessThan(p.y + 10);
    expect(Math.abs(ping.y - p.y)).toBeLessThan(3);
  });

  it('a unit ping carries the unit and its point; a dead or missing unit is refused', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    const mob = besideMob(sim, a);
    const s = store(sim);
    expect(s.send(PING_ATTACK, mob.id, 0, 0, 0, a)).toBe(true);
    const [ping] = view(sim, a);
    expect(ping).toMatchObject({
      kind: PING_ATTACK,
      target: mob.id,
      targetKind: 'mob',
      targetTemplate: mob.templateId,
      targetName: mob.name,
    });
    expect(ping.x).toBeCloseTo(mob.pos.x, 1);
    expect(ping.z).toBeCloseTo(mob.pos.z, 1);
    expect(s.send(PING_ATTACK, 987_654, 0, 0, 0, a)).toBe(false);
    expect(s.send(PING_ATTACK, 1.5, 0, 0, 0, a)).toBe(false);
    mob.dead = true;
    expect(s.send(PING_ATTACK, mob.id, 0, 0, 0, a)).toBe(false);
  });

  it('a unit out of range is refused', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    const mob = besideMob(sim, a);
    const me = sim.entities.get(a);
    if (!me) throw new Error('no player');
    me.pos = { x: mob.pos.x + PARTY_PING_RANGE + 5, y: mob.pos.y, z: mob.pos.z };
    expect(store(sim).send(PING_ATTACK, mob.id, 0, 0, 0, a)).toBe(false);
  });

  it('a stealthed unit outside the group is refused; a stealthed group mate is not', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('rogue', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    party(sim, a, b);
    const pa = posOf(sim, a);
    for (const id of [b, c]) {
      const e = sim.entities.get(id);
      if (!e) throw new Error('no player');
      e.pos = { x: pa.x + 4, y: pa.y, z: pa.z };
      e.stealthed = true;
    }
    expect(store(sim).send(PING_ASSIST, c, 0, 0, 0, a)).toBe(false);
    expect(store(sim).send(PING_ASSIST, b, 0, 0, 0, a)).toBe(true);
    expect(view(sim, a)[0]).toMatchObject({ target: b, targetKind: 'player', targetName: 'Bet' });
  });

  it('a dead sender may still ping (a ghost directs the fight)', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    const me = sim.entities.get(a);
    if (!me) throw new Error('no player');
    me.dead = true;
    expect(pingAt(sim, a)).toBe(true);
  });
});

describe('party pings: rate limit on the sim clock', () => {
  it('a sender spends a burst per window, then waits for the oldest to age out', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    for (let i = 0; i < PARTY_PING_BURST; i++) expect(pingAt(sim, a, PING_LOOK, 2 + i)).toBe(true);
    expect(pingAt(sim, a)).toBe(false);
    wait(sim, PARTY_PING_WINDOW_S / 2);
    expect(pingAt(sim, a)).toBe(false);
    wait(sim, PARTY_PING_WINDOW_S / 2 + DT);
    expect(pingAt(sim, a)).toBe(true);
  });

  it('one sender spending their burst never blocks a party mate', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    party(sim, a, b);
    for (let i = 0; i < PARTY_PING_BURST; i++) pingAt(sim, a, PING_LOOK, 2 + i);
    expect(pingAt(sim, a)).toBe(false);
    expect(pingAt(sim, b)).toBe(true);
  });

  it('is deterministic: two worlds fed the same pings agree byte for byte', () => {
    const run = () => {
      const sim = world();
      const a = sim.addPlayer('warrior', 'Aleph');
      const out: boolean[] = [];
      for (let i = 0; i < 9; i++) {
        out.push(pingAt(sim, a, i % PING_KIND_COUNT, 1 + i));
        wait(sim, 0.7);
      }
      return { out, wire: store(sim).wireFor(a) };
    };
    expect(run()).toEqual(run());
  });
});

describe('party pings: lifetime and caps', () => {
  it('a ping expires after its lifetime, and its emptied group is forgotten', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    pingAt(sim, a);
    wait(sim, PARTY_PING_LIFETIME_S - 0.5);
    expect(view(sim, a)).toHaveLength(1);
    wait(sim, 0.6);
    expect(view(sim, a)).toEqual([]);
    expect(store(sim).wireFor(a)).toBe('null');
    expect(store(sim).size).toBe(0);
  });

  it('an attached ping ends when its unit dies', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    const mob = besideMob(sim, a);
    expect(store(sim).send(PING_ATTACK, mob.id, 0, 0, 0, a)).toBe(true);
    const before = store(sim).wireFor(a);
    expect(view(sim, a)).toHaveLength(1);
    mob.dead = true;
    expect(view(sim, a)).toEqual([]);
    expect(store(sim).wireFor(a)).not.toBe(before);
  });

  it('an attached ping ends when its unit despawns', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    const mob = besideMob(sim, a);
    pingAt(sim, a);
    expect(store(sim).send(PING_ATTACK, mob.id, 0, 0, 0, a)).toBe(true);
    sim.entities.delete(mob.id);
    // The ground ping stays; only the unit's ping goes.
    expect(view(sim, a).map((p) => p.kind)).toEqual([PING_LOOK]);
  });

  it('a sender holds at most their share; the oldest goes first', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    const ids: number[] = [];
    for (let i = 0; i < PARTY_PING_SENDER_MAX + 1; i++) {
      wait(sim, PARTY_PING_WINDOW_S / PARTY_PING_BURST + DT);
      expect(pingAt(sim, a, PING_LOOK, 1 + i)).toBe(true);
      ids.push(view(sim, a).at(-1)?.id ?? -1);
    }
    expect(view(sim, a).map((p) => p.id)).toEqual(ids.slice(1));
  });

  it('a group holds at most its cap', () => {
    const sim = world();
    const pids = [1, 2, 3, 4, 5].map((n) => sim.addPlayer('warrior', `P${n}`));
    party(sim, ...pids);
    for (const pid of pids)
      for (let i = 0; i < PARTY_PING_SENDER_MAX; i++) pingAt(sim, pid, PING_LOOK, 1 + i);
    expect(view(sim, pids[0]).length).toBeLessThanOrEqual(PARTY_PING_GROUP_MAX);
    expect(view(sim, pids[0]).length).toBe(Math.min(PARTY_PING_GROUP_MAX, 15));
  });

  it('ids are unique and increasing', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    pingAt(sim, a, PING_LOOK, 1);
    pingAt(sim, a, PING_LOOK, 2);
    const [x, y] = view(sim, a).map((p) => p.id);
    expect(y).toBeGreaterThan(x);
  });
});

describe('party pings: disband and regrouping', () => {
  it('a disbanded party takes its pings with it', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    party(sim, a, b);
    pingAt(sim, a);
    expect(store(sim).size).toBe(1);
    sim.partyLeave(b); // a two-player party disbands
    expect(sim.partyOf(a)).toBeNull();
    expect(store(sim).size).toBe(0);
    expect(view(sim, a)).toEqual([]);
  });

  it('a member who leaves no longer sees the group pings', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const c = sim.addPlayer('priest', 'Gimel');
    party(sim, a, b, c);
    pingAt(sim, a);
    sim.partyLeave(c);
    expect(view(sim, b)).toHaveLength(1);
    expect(view(sim, c)).toEqual([]);
  });

  it('a solo ping is not shown to the party the player joins later', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    pingAt(sim, a);
    party(sim, a, b);
    expect(view(sim, b)).toEqual([]);
  });

  it('idle rate windows are swept on the next send', () => {
    const sim = world();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    pingAt(sim, a);
    expect(store(sim).senderCount).toBe(1);
    wait(sim, PARTY_PING_WINDOW_S + DT);
    pingAt(sim, b);
    expect(store(sim).senderCount).toBe(1);
  });
});
