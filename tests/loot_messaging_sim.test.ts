import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';

const SEED = 20061;
const PREMIUM = 'greyjaw_hide_boots'; // uncommon: opens a need/greed roll by default

function makeSim() {
  return new Sim({ seed: SEED, playerClass: 'warrior' });
}
function teleportTo(sim: Sim, x: number, z: number, pid: number) {
  const p = sim.entities.get(pid)!;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = groundHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

// Leader + two members; leader and one member on the corpse, the third far out of
// loot range, to prove the outcome reaches the WHOLE party, not just candidates.
function partyOfThree(sim: Sim, itemId: string, mobId = 990501) {
  const a = sim.playerId;
  const b = sim.addPlayer('mage', 'Bert');
  const c = sim.addPlayer('priest', 'Cora');
  for (const p of [b, c]) {
    sim.partyInvite(p, a);
    sim.partyAccept(p);
  }
  teleportTo(sim, 20, 20, a);
  teleportTo(sim, 21, 20, b);
  teleportTo(sim, 900, 900, c);
  const mob = createMob(mobId, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
  mob.dead = true;
  mob.lootable = true;
  mob.tappedById = a;
  mob.loot = { copper: 0, items: [{ itemId, count: 1 }] };
  sim.entities.set(mob.id, mob);
  return { a, b, c, mob };
}

describe('loot lifecycle broadcasts', () => {
  it('announces the roll open to the whole party with an item token', () => {
    const sim = makeSim();
    const { c, mob } = partyOfThree(sim, PREMIUM);
    sim.events.length = 0;
    sim.lootCorpse(mob.id, sim.playerId);
    const rolling = sim.events.filter(
      (e) => e.type === 'loot' && /^Rolling for \[\[i:.+\]\]\.$/.test((e as { text: string }).text),
    );
    expect(rolling.length).toBe(3);
    expect(rolling.some((e) => (e as { pid?: number }).pid === c)).toBe(true);
    expect(rolling.every((e) => (e as { text: string }).text.includes(`[[i:${PREMIUM}]]`))).toBe(
      true,
    );
  });

  it('broadcasts the roll outcome to the whole party with a token', () => {
    const sim = makeSim();
    const { a, b, c, mob } = partyOfThree(sim, PREMIUM);
    sim.lootCorpse(mob.id, a);
    const roll = [
      ...(
        sim as unknown as { pendingLootRolls: Map<number, { id: number }> }
      ).pendingLootRolls.values(),
    ][0];
    sim.events.length = 0;
    sim.submitLootRoll(roll.id, 'need', a);
    sim.submitLootRoll(roll.id, 'greed', b);
    const wins = sim.events.filter(
      (e) => e.type === 'loot' && / wins \[\[i:.+\]\] \(\d+\)$/.test((e as { text: string }).text),
    );
    expect(wins.map((e) => (e as { pid?: number }).pid).sort()).toEqual([a, b, c].sort());
  });

  it('broadcasts to the rolls own party even if a candidate re-groups mid-roll', () => {
    const sim = makeSim();
    const { a, b, c, mob } = partyOfThree(sim, PREMIUM);
    sim.lootCorpse(mob.id, a); // opens the need/greed roll, snapshotting party [a,b,c]
    const roll = [
      ...(
        sim as unknown as { pendingLootRolls: Map<number, { id: number; candidates: number[] }> }
      ).pendingLootRolls.values(),
    ][0];
    // The first candidate leaves and joins a DIFFERENT party while the roll is open.
    const d = sim.addPlayer('rogue', 'Dane');
    sim.partyLeave(a);
    sim.partyInvite(a, d);
    sim.partyAccept(a);
    sim.events.length = 0;
    for (const pid of roll.candidates) sim.submitLootRoll(roll.id, 'pass', pid);
    const passed = sim.events.filter(
      (e) =>
        e.type === 'loot' &&
        /^Everyone passed on \[\[i:.+\]\]\.$/.test((e as { text: string }).text),
    );
    const pids = passed.map((e) => (e as { pid?: number }).pid).sort();
    // The outcome reaches the party that opened the roll, never Dane's unrelated party.
    expect(pids).toEqual([a, b, c].sort());
    expect(pids).not.toContain(d);
  });
});

describe('loot settings announcements', () => {
  it('announces only what changed', () => {
    const sim = makeSim();
    const { a } = partyOfThree(sim, PREMIUM);
    sim.setPartyLootMaster(true, 0, 'uncommon', a);
    sim.events.length = 0;
    sim.setPartyLootMaster(true, 0, 'rare', a); // only threshold changes
    const texts = sim.events
      .filter((e) => e.type === 'log')
      .map((e) => (e as { text: string }).text);
    expect(texts).toContain('Loot threshold set to rare.');
    expect(texts.some((t) => /^Loot method set to/.test(t))).toBe(false);
  });

  it('sends a loot settings summary to a newly joined member', () => {
    const sim = makeSim();
    const a = sim.playerId;
    // setPartyLootMaster is a leader-only party op; form a party of two first
    // (a solo player has no party, so the call would otherwise no-op).
    const c = sim.addPlayer('priest', 'Cora');
    sim.partyInvite(c, a);
    sim.partyAccept(c);
    sim.setPartyLootMaster(true, 0, 'rare', a);
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.events.length = 0;
    sim.partyAccept(b);
    const toJoiner = sim.events
      .filter((e) => e.type === 'log' && (e as { pid?: number }).pid === b)
      .map((e) => (e as { text: string }).text);
    expect(
      toJoiner.some((t) =>
        /^Loot Settings: Master Loot, Master Looter .+, threshold rare\.$/.test(t),
      ),
    ).toBe(true);
  });

  it('announces the new effective master looter when the leader leaves', () => {
    const sim = makeSim();
    const { a } = partyOfThree(sim, PREMIUM);
    sim.setPartyLootMaster(true, 0, 'rare', a); // looter 0 = leader
    sim.events.length = 0;
    sim.partyLeave(a); // leadership passes; effective looter changes
    expect(
      sim.events.some(
        (e) => e.type === 'log' && /^Master Looter is now .+\.$/.test((e as { text: string }).text),
      ),
    ).toBe(true);
  });

  it('does not announce a looter change when a disbanding party dissolves to solo', () => {
    const sim = makeSim();
    const a = sim.playerId;
    const b = sim.addPlayer('mage', 'Bert');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    sim.setPartyLootMaster(true, b, 'rare', a); // b is the explicitly named master looter
    sim.events.length = 0;
    sim.partyLeave(b); // the non-leader explicit looter leaves; party of 2 disbands
    expect(
      sim.events.some(
        (e) => e.type === 'log' && /^Master Looter is now/.test((e as { text: string }).text),
      ),
    ).toBe(false);
  });
});
