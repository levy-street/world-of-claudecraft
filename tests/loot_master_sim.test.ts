import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { groundHeight } from '../src/sim/world';

const SEED = 20061;
const PREMIUM = 'greyjaw_hide_boots'; // uncommon: opens a roll under default strategies
const COMMON = 'worn_sword'; // common: never master-looted under a rare threshold

function makeSim() {
  return new Sim({ seed: SEED, playerClass: 'warrior' });
}
function teleportTo(sim: Sim, x: number, z: number, pid?: number) {
  const p = sim.entities.get(pid ?? sim.playerId)!;
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = groundHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

// A two-member party (a=leader) standing on a freshly tapped, lootable corpse
// holding `itemId`, with master loot enabled. Returns the pids.
function partyOnCorpse(sim: Sim, itemId: string, mobId = 990500) {
  const a = sim.playerId;
  const b = sim.addPlayer('mage', 'Bert');
  sim.partyInvite(b, a);
  sim.partyAccept(b);
  teleportTo(sim, 20, 20, a);
  teleportTo(sim, 21, 20, b);
  const mob = createMob(mobId, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
  mob.dead = true;
  mob.lootable = true;
  mob.tappedById = a;
  mob.loot = { copper: 0, items: [{ itemId, count: 1 }] };
  sim.entities.set(mob.id, mob);
  return { a, b, mob };
}

describe('master loot', () => {
  it('routes a threshold drop to the master looter instead of opening a need/greed roll', () => {
    const sim = makeSim();
    const { a, b, mob } = partyOnCorpse(sim, PREMIUM);
    sim.setPartyLootMaster(true, 0, 'uncommon', a); // 0 = leader is master looter

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);

    expect(sim.events.filter((e) => e.type === 'lootRoll')).toHaveLength(0);
    const prompts = sim.events.filter((e) => e.type === 'masterLoot');
    expect(prompts).toHaveLength(1);
    const prompt = prompts[0] as Extract<(typeof prompts)[number], { type: 'masterLoot' }>;
    expect(prompt.pid).toBe(a); // sent only to the master looter
    expect(prompt.itemId).toBe(PREMIUM);
    expect(prompt.candidates.map((c) => c.pid).sort()).toEqual([a, b].sort());
    expect(sim.countItem(PREMIUM, a) + sim.countItem(PREMIUM, b)).toBe(0); // nothing awarded yet
  });

  it('awards the item to the assigned member when the master looter assigns it', () => {
    const sim = makeSim();
    const { a, b, mob } = partyOnCorpse(sim, PREMIUM);
    sim.setPartyLootMaster(true, 0, 'uncommon', a);
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'masterLoot')?.rollId;
    if (rollId === undefined) throw new Error('expected master loot prompt');

    sim.events.length = 0;
    sim.assignMasterLoot(rollId, [b], a); // a single checked member is granted directly

    expect(sim.countItem(PREMIUM, b)).toBe(1);
    expect(sim.countItem(PREMIUM, a)).toBe(0);
    expect(sim.events.some((e) => e.type === 'loot' && e.text.includes('assigned'))).toBe(true);
    expect(sim.events.filter((e) => e.type === 'lootRoll')).toHaveLength(0); // 1 target skips the roll
  });

  it('does not surface a curate-phase master roll as a need/greed prompt (reconcile)', () => {
    const sim = makeSim();
    const { a, b, mob } = partyOnCorpse(sim, PREMIUM);
    sim.setPartyLootMaster(true, 0, 'uncommon', a);
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'masterLoot')!.rollId;

    // The reconcile surface (polled every frame by the HUD) must NOT return the
    // master roll to anyone while it is still in the curate phase, or every member
    // would re-show a need/greed prompt before the looter decides.
    expect(sim.activeLootRolls(a)).toHaveLength(0);
    expect(sim.activeLootRolls(b)).toHaveLength(0);

    // Once the looter releases it to a roll, it becomes a real need/greed prompt
    // the subset can answer, so the reconcile surface DOES return it.
    sim.assignMasterLoot(rollId, [a, b], a);
    expect(sim.activeLootRolls(b).map((p) => p.rollId)).toContain(rollId);
  });

  it('falls back to need/greed for remaining candidates when the master looter logs out', () => {
    const sim = makeSim();
    const { a, b, mob } = partyOnCorpse(sim, PREMIUM);
    const c = sim.addPlayer('rogue', 'Cara');
    sim.partyInvite(c, a);
    sim.partyAccept(c);
    teleportTo(sim, 21, 21, c);
    sim.setPartyLootMaster(true, 0, 'uncommon', a);
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'masterLoot')?.rollId;
    if (rollId === undefined) throw new Error('expected master loot prompt');

    sim.events.length = 0;
    sim.removePlayer(a);

    expect(sim.activeLootRolls(b).map((p) => p.rollId)).toContain(rollId);
    expect(sim.activeLootRolls(c).map((p) => p.rollId)).toContain(rollId);
    const entries = sim.lootRollGroupStatus(b)[0]?.entries ?? [];
    expect(entries.map((entry) => entry.pid).sort((x, y) => x - y)).toEqual(
      [b, c].sort((x, y) => x - y),
    );

    sim.submitLootRoll(rollId, 'pass', b);
    sim.submitLootRoll(rollId, 'pass', c);
    expect(mob.loot?.items.find((slot) => slot.itemId === PREMIUM)).toMatchObject({
      count: 1,
      openToAll: true,
    });
  });

  it('revokes assign authority when the party leader kicks the master looter mid-roll', () => {
    const sim = makeSim();
    const { a, b, mob } = partyOnCorpse(sim, PREMIUM);
    const c = sim.addPlayer('rogue', 'Cara');
    sim.partyInvite(c, a);
    sim.partyAccept(c);
    teleportTo(sim, 21, 21, c);
    sim.setPartyLootMaster(true, b, 'uncommon', a); // b (not the leader) is master looter
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'masterLoot')?.rollId;
    if (rollId === undefined) throw new Error('expected master loot prompt');

    sim.events.length = 0;
    sim.partyKick(b, a); // leader kicks the master looter while the roll is still open

    // The kicked looter must lose assignment authority immediately: a
    // self-assign must NOT grant the item.
    sim.assignMasterLoot(rollId, [b], b);
    expect(sim.countItem(PREMIUM, b)).toBe(0);

    // The roll falls back to a normal need/greed roll (same as the uncurated
    // 5-minute timeout path) instead of staying a curate-phase prompt only the
    // ex-looter could resolve.
    expect(sim.activeLootRolls(a).map((p) => p.rollId)).toContain(rollId);
    expect(sim.activeLootRolls(c).map((p) => p.rollId)).toContain(rollId);

    // The kicked ex-looter is still an ordinary candidate (leaving a party does
    // not retroactively strip existing roll candidacy, matching the "re-groups
    // mid-roll" contract elsewhere), but now has to roll fairly like anyone
    // else: no more self-assign shortcut.
    sim.submitLootRoll(rollId, 'need', a);
    sim.submitLootRoll(rollId, 'pass', b);
    sim.submitLootRoll(rollId, 'pass', c);
    expect(sim.countItem(PREMIUM, a)).toBe(1);
    expect(sim.countItem(PREMIUM, b)).toBe(0);
  });

  it('revokes assign authority when the master looter voluntarily leaves the party mid-roll', () => {
    const sim = makeSim();
    const { a, b, mob } = partyOnCorpse(sim, PREMIUM);
    sim.setPartyLootMaster(true, b, 'uncommon', a); // b (not the leader) is master looter
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'masterLoot')?.rollId;
    if (rollId === undefined) throw new Error('expected master loot prompt');

    sim.events.length = 0;
    sim.partyLeave(b); // the master looter leaves on their own, still connected

    sim.assignMasterLoot(rollId, [b], b);
    expect(sim.countItem(PREMIUM, b)).toBe(0);
    expect(sim.activeLootRolls(a).map((p) => p.rollId)).toContain(rollId);

    sim.submitLootRoll(rollId, 'need', a);
    sim.submitLootRoll(rollId, 'pass', b);
    expect(sim.countItem(PREMIUM, a)).toBe(1);
  });

  it('blocks a self-assign after the leader/master-looter kicks every other member and the party disbands', () => {
    const sim = makeSim();
    const { a, b, mob } = partyOnCorpse(sim, PREMIUM);
    const c = sim.addPlayer('rogue', 'Cara');
    sim.partyInvite(c, a);
    sim.partyAccept(c);
    teleportTo(sim, 21, 21, c);
    sim.setPartyLootMaster(true, 0, 'uncommon', a); // leader a is master looter
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'masterLoot')?.rollId;
    if (rollId === undefined) throw new Error('expected master loot prompt');

    sim.partyKick(b, a);
    sim.partyKick(c, a); // party collapses to just `a` and disbands

    // Even though `a` still nominally holds roll.masterLooter, the party is
    // gone: a self-assign must not grant the item.
    sim.assignMasterLoot(rollId, [a], a);
    expect(sim.countItem(PREMIUM, a)).toBe(0);

    // The roll falls back to a normal need/greed prompt for the original
    // candidates instead of staying stuck or self-assignable.
    expect(sim.activeLootRolls(a).map((p) => p.rollId)).toContain(rollId);
  });

  it('blocks a self-assign after the leader/master-looter is the last one left when everyone else leaves', () => {
    const sim = makeSim();
    const { a, b, mob } = partyOnCorpse(sim, PREMIUM);
    const c = sim.addPlayer('rogue', 'Cara');
    sim.partyInvite(c, a);
    sim.partyAccept(c);
    teleportTo(sim, 21, 21, c);
    sim.setPartyLootMaster(true, 0, 'uncommon', a); // leader a is master looter
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'masterLoot')?.rollId;
    if (rollId === undefined) throw new Error('expected master loot prompt');

    sim.partyLeave(b);
    sim.partyLeave(c); // party collapses to just `a` and disbands

    sim.assignMasterLoot(rollId, [a], a);
    expect(sim.countItem(PREMIUM, a)).toBe(0);
    expect(sim.activeLootRolls(a).map((p) => p.rollId)).toContain(rollId);
  });

  it('blocks a self-assign after the master looter disbands the party and regroups with strangers', () => {
    const sim = makeSim();
    const { a, b, mob } = partyOnCorpse(sim, PREMIUM);
    const c = sim.addPlayer('rogue', 'Cara');
    sim.partyInvite(c, a);
    sim.partyAccept(c);
    teleportTo(sim, 21, 21, c);
    sim.setPartyLootMaster(true, 0, 'uncommon', a); // leader a is master looter
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'masterLoot')?.rollId;
    if (rollId === undefined) throw new Error('expected master loot prompt');

    sim.partyKick(b, a);
    sim.partyKick(c, a); // party collapses to just `a` and disbands

    // Re-forming ANY party must not restore authority over a roll that belongs
    // to the old group: the gate is anchored on roll.partyMembers, not on
    // merely holding some party of two or more.
    const d = sim.addPlayer('priest', 'Dorn');
    const e = sim.addPlayer('hunter', 'Elin');
    teleportTo(sim, 21, 20, d);
    teleportTo(sim, 20, 21, e);
    sim.partyInvite(d, a);
    sim.partyAccept(d);
    sim.partyInvite(e, a);
    sim.partyAccept(e);

    sim.assignMasterLoot(rollId, [a], a);
    expect(sim.countItem(PREMIUM, a)).toBe(0);
    expect(sim.activeLootRolls(a).map((p) => p.rollId)).toContain(rollId);
  });

  it('read-side gate compares the roll own group, not merely holding some party', () => {
    const sim = makeSim();
    const { a, b, mob } = partyOnCorpse(sim, PREMIUM);
    const c = sim.addPlayer('rogue', 'Cara');
    sim.partyInvite(c, a);
    sim.partyAccept(c);
    teleportTo(sim, 21, 21, c);
    sim.setPartyLootMaster(true, 0, 'uncommon', a); // leader a is master looter
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'masterLoot')?.rollId;
    if (rollId === undefined) throw new Error('expected master loot prompt');

    sim.partyKick(b, a);
    sim.partyKick(c, a); // party collapses to just `a` and disbands

    // Restore stale curate authority directly, standing in for any future
    // membership-mutating path that forgets to revoke: the read-side gate in
    // assignMasterLoot is the backstop that must still refuse.
    const roll = (sim as unknown as { pendingLootRolls: Map<number, { masterLooter?: number }> })
      .pendingLootRolls;
    const pending = roll.get(rollId);
    if (!pending) throw new Error('expected the roll to still be pending');
    pending.masterLooter = a;

    // `a` regroups with two unrelated players, so they DO hold a party of more
    // than one: only comparing against the roll own partyMembers refuses this.
    const d = sim.addPlayer('priest', 'Dorn');
    const e = sim.addPlayer('hunter', 'Elin');
    teleportTo(sim, 21, 20, d);
    teleportTo(sim, 20, 21, e);
    sim.partyInvite(d, a);
    sim.partyAccept(d);
    sim.partyInvite(e, a);
    sim.partyAccept(e);

    sim.assignMasterLoot(rollId, [a], a);
    expect(sim.countItem(PREMIUM, a)).toBe(0);
    expect(sim.activeLootRolls(a).map((p) => p.rollId)).toContain(rollId);
  });

  it('rejects assignment from anyone other than the master looter', () => {
    const sim = makeSim();
    const { a, b, mob } = partyOnCorpse(sim, PREMIUM);
    sim.setPartyLootMaster(true, 0, 'uncommon', a);
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'masterLoot')!.rollId;

    sim.assignMasterLoot(rollId, [b], b); // b is not the master looter

    expect(sim.countItem(PREMIUM, a) + sim.countItem(PREMIUM, b)).toBe(0);
  });

  it('leaves below-threshold drops to the normal loot path', () => {
    const sim = makeSim();
    const { a, mob } = partyOnCorpse(sim, COMMON);
    sim.setPartyLootMaster(true, 0, 'rare', a); // rare threshold, item is common

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);

    expect(sim.events.filter((e) => e.type === 'masterLoot')).toHaveLength(0);
    expect(sim.countItem(COMMON, a)).toBe(1); // looter-takes-all for common items
  });

  it('opens a need/greed roll for the checked subset when 2+ are selected', () => {
    const sim = makeSim();
    const { a, b, mob } = partyOnCorpse(sim, PREMIUM);
    sim.setPartyLootMaster(true, 0, 'uncommon', a);
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'masterLoot')!.rollId;

    sim.events.length = 0;
    sim.assignMasterLoot(rollId, [a, b], a); // looter releases it to a roll among both

    const rolls = sim.events.filter((e) => e.type === 'lootRoll' && e.rollId === rollId);
    expect(rolls.map((e) => e.pid as number).sort((x, y) => x - y)).toEqual(
      [a, b].sort((x, y) => x - y),
    );
    expect(sim.countItem(PREMIUM, a) + sim.countItem(PREMIUM, b)).toBe(0); // not granted yet

    sim.submitLootRoll(rollId, 'need', a);
    sim.submitLootRoll(rollId, 'pass', b);
    expect(sim.countItem(PREMIUM, a)).toBe(1); // a needed, b passed
  });

  it('rolls only among the checked subset, excluding unchecked candidates', () => {
    const sim = makeSim();
    const { a, b, mob } = partyOnCorpse(sim, PREMIUM);
    const c = sim.addPlayer('rogue', 'Cara');
    sim.partyInvite(c, a);
    sim.partyAccept(c);
    teleportTo(sim, 21, 21, c); // within loot range of the corpse
    sim.setPartyLootMaster(true, 0, 'uncommon', a);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'masterLoot')!.rollId;

    sim.events.length = 0;
    sim.assignMasterLoot(rollId, [b, c], a); // exclude the looter a

    const rolls = sim.events.filter((e) => e.type === 'lootRoll' && e.rollId === rollId);
    expect(rolls.map((e) => e.pid as number).sort((x, y) => x - y)).toEqual(
      [b, c].sort((x, y) => x - y),
    );

    sim.submitLootRoll(rollId, 'need', a); // a is not in the subset: ignored
    sim.submitLootRoll(rollId, 'need', b);
    sim.submitLootRoll(rollId, 'pass', c);
    expect(sim.countItem(PREMIUM, b)).toBe(1); // b won among {b, c}
    expect(sim.countItem(PREMIUM, a)).toBe(0);
  });

  it('rejects an empty or out-of-candidate selection (prompt stays in the curate phase)', () => {
    const sim = makeSim();
    const { a, b, mob } = partyOnCorpse(sim, PREMIUM);
    sim.setPartyLootMaster(true, 0, 'uncommon', a);
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'masterLoot')!.rollId;

    sim.events.length = 0;
    sim.assignMasterLoot(rollId, [], a); // nothing checked
    sim.assignMasterLoot(rollId, [99999], a); // not a candidate

    expect(sim.countItem(PREMIUM, a) + sim.countItem(PREMIUM, b)).toBe(0);
    expect(sim.events.filter((e) => e.type === 'lootRoll')).toHaveLength(0); // not converted to a roll
  });

  it('gives the master looter a 5-minute curate window (longer than a need/greed roll)', () => {
    const sim = makeSim();
    const { a, mob } = partyOnCorpse(sim, PREMIUM);
    sim.setPartyLootMaster(true, 0, 'uncommon', a);
    sim.lootCorpse(mob.id, a);
    const prompt = sim.events.find((e) => e.type === 'masterLoot')!;
    const expiresAt = (prompt as { expiresAt: number }).expiresAt;
    // The master looter's curate window is 5 minutes (300s) from now.
    expect(expiresAt).toBeCloseTo(sim.time + 300, 5);
    // The expiry is an absolute deadline checked per tick (sim.ts), so jump to just shy
    // of it rather than ticking 6000 times: a still-open master roll has NOT fallen back
    // to need/greed while sim.time < expiresAt.
    const rollId = prompt.rollId;
    sim.time = expiresAt - 1;
    let convertedEarly = false;
    for (let i = 0; i < 10; i++) {
      for (const e of sim.tick())
        if (e.type === 'lootRoll' && e.rollId === rollId) convertedEarly = true;
    }
    expect(convertedEarly).toBe(false);
  }, 120000); // ticks a five-minute window on a 13-zone world under suite load

  it('converts an uncurated drop to a need/greed roll for all candidates at the 5-min timeout', () => {
    const sim = makeSim();
    const { a, b, mob } = partyOnCorpse(sim, PREMIUM);
    sim.setPartyLootMaster(true, 0, 'uncommon', a);
    sim.lootCorpse(mob.id, a);
    const prompt = sim.events.find((e) => e.type === 'masterLoot')!;
    const rollId = prompt.rollId;
    const expiresAt = (prompt as { expiresAt: number }).expiresAt;

    // Jump to the edge of the 300s curate window, then tick past it (the expiry is an
    // absolute deadline checked per tick), instead of ticking through all 6000: the
    // uncurated master roll converts to a need/greed roll for every candidate.
    sim.time = expiresAt - 0.5;
    const rolls: number[] = [];
    for (let i = 0; i < 40; i++) {
      for (const e of sim.tick())
        if (e.type === 'lootRoll' && e.rollId === rollId && e.pid !== undefined) rolls.push(e.pid);
    }
    expect(rolls.sort((x, y) => x - y)).toEqual([a, b].sort((x, y) => x - y));
    // 6020 ticks of a 9-zone world: give it headroom under full-suite load
  }, 120000); // ticks a five-minute window on a 13-zone world under suite load

  it('only the leader can change the loot method', () => {
    const sim = makeSim();
    const { a, b } = partyOnCorpse(sim, PREMIUM);
    sim.setPartyLootMaster(true, 0, 'uncommon', b); // b is not the leader
    expect(sim.partyInfo?.master.enabled).toBe(false);
    sim.setPartyLootMaster(true, 0, 'uncommon', a);
    expect(sim.partyInfo?.master.enabled).toBe(true);
  });

  it('master loot pinned to the leader follows a promote-to-leader handoff', () => {
    const sim = makeSim();
    const { a, b, mob } = partyOnCorpse(sim, PREMIUM);
    sim.setPartyLootMaster(true, 0, 'uncommon', a); // 0 = leader is master looter

    sim.partyPromote(b, a); // hand leadership from a to b
    expect(sim.partyOf(b)?.leader).toBe(b);

    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);
    const prompts = sim.events.filter((e) => e.type === 'masterLoot');
    expect(prompts).toHaveLength(1);
    // The assignment prompt now reaches the NEW leader (b), not the old leader (a).
    expect((prompts[0] as { pid: number }).pid).toBe(b);
  });

  it('disabled master loot keeps the existing need/greed behavior', () => {
    const sim = makeSim();
    const { a, mob } = partyOnCorpse(sim, PREMIUM);
    // master loot left disabled (default)
    sim.events.length = 0;
    sim.lootCorpse(mob.id, a);
    expect(sim.events.filter((e) => e.type === 'masterLoot')).toHaveLength(0);
    expect(sim.events.filter((e) => e.type === 'lootRoll').length).toBeGreaterThan(0);
  });
});

// #2526. assignMasterLoot REFUSES a selection whose every named pid is no longer
// (or never was) a candidate, and deliberately leaves the roll in its curate phase.
// The looter's client cleared the row on the click, and the two need/greed
// reconcile reads skip a curate-phase master roll by design, so nothing could
// restore the prompt: the looter waited out the 300s timeout with no way back in.
// activeMasterLootRolls is the missing half, and every arm below is written so an
// EMPTY surface (what a consumed roll looks like) fails it.
describe('the master looter reconcile surface (#2526)', () => {
  // A three-member party (a = leader = master looter) on a corpse holding PREMIUM,
  // with the curate prompt already open.
  function openMasterRoll() {
    const sim = makeSim();
    const { a, b, mob } = partyOnCorpse(sim, PREMIUM);
    const c = sim.addPlayer('rogue', 'Cara');
    sim.partyInvite(c, a);
    sim.partyAccept(c);
    teleportTo(sim, 21, 21, c);
    sim.setPartyLootMaster(true, 0, 'uncommon', a);
    sim.lootCorpse(mob.id, a);
    const rollId = sim.events.find((e) => e.type === 'masterLoot')!.rollId;
    sim.events.length = 0;
    return { sim, a, b, c, mob, rollId };
  }

  it('reaches the master looter only, and never a candidate, while the roll curates', () => {
    const { sim, a, b, c, rollId } = openMasterRoll();

    expect(sim.activeMasterLootRolls(a)).toMatchObject([
      { rollId, itemId: PREMIUM, itemName: 'Greyjaw Hide Boots', quality: 'uncommon' },
    ]);
    expect(sim.activeMasterLootRolls(a)[0].candidates.map((cand) => cand.pid)).toEqual([a, b, c]);
    expect(sim.activeMasterLootRolls(a)[0].expiresAt).toBeCloseTo(sim.time + 300, 5);
    // Names come from the live roster, so the checkbox list is labelled. Pinned to
    // literals: reading sim.meta(a).name here would compare the implementation
    // against its own source and could not fail.
    expect(sim.activeMasterLootRolls(a)[0].candidates.map((cand) => cand.name)).toEqual([
      'Adventurer',
      'Bert',
      'Cara',
    ]);

    // The zero-argument arm, which is the ONLY one production reaches: IWorld
    // declares activeMasterLootRolls() with no parameter, so the HUD always calls
    // it bare and Sim's `pid = this.playerId` default carries the viewer.
    expect(sim.playerId).toBe(a);
    expect(sim.activeMasterLootRolls().map((p) => p.rollId)).toEqual([rollId]);

    // The AC that the fix must not break: a candidate sees the curate-phase roll
    // on NO surface, neither as an assignment prompt nor as a need/greed one.
    expect(sim.activeMasterLootRolls(b)).toEqual([]);
    expect(sim.activeMasterLootRolls(c)).toEqual([]);
    expect(sim.activeLootRolls(b)).toEqual([]);
    expect(sim.lootRollGroupStatus(b)).toEqual([]);
  });

  it('returns every curate-phase roll the looter owns, not just the first', () => {
    const { sim, a, b, c, mob, rollId } = openMasterRoll();
    // A second corpse dropping a second threshold item: the read loops the whole
    // pending map and pushes every match, and nothing else in this file opens two
    // at once, so a first-match-only read would pass every other case here.
    const second = createMob(mob.id + 1, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
    second.dead = true;
    second.lootable = true;
    second.tappedById = a;
    second.loot = { copper: 0, items: [{ itemId: PREMIUM, count: 1 }] };
    sim.entities.set(second.id, second);
    sim.lootCorpse(second.id, a);
    const secondRollId = sim.events.find((e) => e.type === 'masterLoot')!.rollId;
    expect(secondRollId).not.toBe(rollId);

    expect(sim.activeMasterLootRolls(a).map((p) => p.rollId)).toEqual([rollId, secondRollId]);
    expect(sim.activeMasterLootRolls(b)).toEqual([]);
    expect(sim.activeMasterLootRolls(c)).toEqual([]);

    // Consuming one leaves the other, so the two are tracked independently.
    sim.assignMasterLoot(rollId, [b], a);
    expect(sim.activeMasterLootRolls(a).map((p) => p.rollId)).toEqual([secondRollId]);
  });

  it('keeps the prompt, minus the departed pid, when the only named target has left', () => {
    const { sim, a, b, c, rollId } = openMasterRoll();
    // The reachable way a named pid stops being a candidate mid-window: an explicit
    // logout, which runs removePlayerFromLootRolls and shrinks roll.candidates.
    sim.removePlayer(c);

    sim.assignMasterLoot(rollId, [c], a);

    // The decisive pair. The item went nowhere AND the roll is still curating: an
    // absence-only assertion cannot tell "refused, prompt held" from "consumed".
    expect(sim.countItem(PREMIUM, a) + sim.countItem(PREMIUM, b)).toBe(0);
    expect(sim.activeMasterLootRolls(a).map((p) => p.rollId)).toEqual([rollId]);
    // Rebuilt from the CURRENT roster, so the looter cannot re-pick the pid that
    // was just refused and loop until the timeout.
    expect(sim.activeMasterLootRolls(a)[0].candidates.map((cand) => cand.pid)).toEqual([a, b]);
    expect(sim.events.filter((e) => e.type === 'lootRoll')).toHaveLength(0); // not converted

    // And the restored prompt is live, not a husk: assigning again lands.
    sim.assignMasterLoot(rollId, [b], a);
    expect(sim.countItem(PREMIUM, b)).toBe(1);
    expect(sim.activeMasterLootRolls(a)).toEqual([]);
  });

  it('keeps the prompt when the named pid was never a candidate at all', () => {
    const { sim, a, b, c, rollId } = openMasterRoll();

    sim.assignMasterLoot(rollId, [99999], a);

    expect(sim.activeMasterLootRolls(a).map((p) => p.rollId)).toEqual([rollId]);
    expect(sim.activeMasterLootRolls(a)[0].candidates.map((cand) => cand.pid)).toEqual([a, b, c]);
    expect(sim.countItem(PREMIUM, b)).toBe(0);
    sim.assignMasterLoot(rollId, [b], a);
    expect(sim.countItem(PREMIUM, b)).toBe(1);
  });

  it('drops the prompt off the surface the moment a direct assignment lands', () => {
    const { sim, a, b, rollId } = openMasterRoll();
    expect(sim.activeMasterLootRolls(a)).toHaveLength(1); // not vacuously empty

    sim.assignMasterLoot(rollId, [b], a);

    expect(sim.activeMasterLootRolls(a)).toEqual([]);
    expect(sim.countItem(PREMIUM, b)).toBe(1);
  });

  it('drops the prompt when the looter releases the roll to a need/greed subset', () => {
    const { sim, a, b, c, rollId } = openMasterRoll();
    expect(sim.activeMasterLootRolls(a)).toHaveLength(1); // the surface had it to lose

    sim.assignMasterLoot(rollId, [b, c], a);

    // The roll KEEPS its id but is no longer a master roll, so it moves from the
    // master surface to the need/greed one for exactly the chosen subset.
    expect(sim.activeMasterLootRolls(a)).toEqual([]);
    expect(sim.activeLootRolls(b).map((p) => p.rollId)).toEqual([rollId]);
    expect(sim.activeLootRolls(c).map((p) => p.rollId)).toEqual([rollId]);
    expect(sim.activeLootRolls(a)).toEqual([]); // a excluded themselves
  });

  it('drops the prompt when the uncurated window times out into a need/greed roll', () => {
    const { sim, a, b, c, rollId } = openMasterRoll();
    const expiresAt = sim.activeMasterLootRolls(a)[0].expiresAt;

    sim.time = expiresAt - 0.5;
    for (let i = 0; i < 40; i++) sim.tick();

    expect(sim.activeMasterLootRolls(a)).toEqual([]);
    expect(sim.activeLootRolls(a).map((p) => p.rollId)).toEqual([rollId]);
    expect(sim.activeLootRolls(b).map((p) => p.rollId)).toEqual([rollId]);
    expect(sim.activeLootRolls(c).map((p) => p.rollId)).toEqual([rollId]);
  });

  it('keeps an open prompt with its original looter across a leader handoff', () => {
    const { sim, a, b, rollId } = openMasterRoll();
    // The roll captured `a` as its master looter at open time, so promoting `b`
    // must NOT move an already-open curate prompt: the surface follows the roll,
    // not the live party setting.
    sim.partyPromote(b, a);

    expect(sim.activeMasterLootRolls(a).map((p) => p.rollId)).toEqual([rollId]);
    expect(sim.activeMasterLootRolls(b)).toEqual([]);
  });

  it('converts rather than stranding when the master looter themselves logs out', () => {
    const { sim, a, b, c, rollId } = openMasterRoll();
    expect(sim.activeMasterLootRolls(a)).toHaveLength(1); // the surface had it to lose

    sim.removePlayer(a);

    // No orphaned curate prompt is left behind on the surface for anyone.
    expect(sim.activeMasterLootRolls(b)).toEqual([]);
    expect(sim.activeMasterLootRolls(c)).toEqual([]);
    expect(sim.activeLootRolls(b).map((p) => p.rollId)).toEqual([rollId]);
  });
});

// #2505. The pid list reaching assignMasterLoot is client-supplied and the
// masterAssign wire case validates that pids is a non-empty numeric array no
// longer than a full raid roster (#2524) and nothing about the values, so a
// hand-crafted frame can still name the same candidate twice. Every case runs the
// repeat against the equivalent duplicate-free request on the SAME seed: the
// repeat must be indistinguishable in bags, chat, prompts, and rng stream position.
describe('a repeated pid in a master-loot assignment (#2505)', () => {
  // Every rng draw `fn` spends, counted through the parity harness's own
  // observer seam. A no-new-draws guard, NOT the determinism arm: the extra
  // tie-break int a doubled candidate list buys is spent at RESOLUTION, which
  // these windows do not reach, so both arms legitimately read the same here.
  // The determinism arm is the stream-position case at the end of this block.
  function countDraws(sim: Sim, fn: () => void): number {
    let draws = 0;
    const rng = (sim as unknown as { rng: { setObserver: (o: (() => void) | null) => void } }).rng;
    rng.setObserver(() => {
      draws++;
    });
    try {
      fn();
    } finally {
      rng.setObserver(null);
    }
    return draws;
  }

  // The next `n` values off the shared world rng. Two worlds that ran
  // equivalent requests from the same seed sit at the same stream position, so
  // their drains match value for value; a world that spent one extra draw is
  // offset by one and every later value differs.
  function drainStream(sim: Sim, n: number): number[] {
    const rng = (sim as unknown as { rng: { next: () => number } }).rng;
    return Array.from({ length: n }, () => rng.next());
  }

  // A three-member party (a=leader=master looter) on a corpse holding PREMIUM,
  // with the master-loot prompt already open and the event log cleared.
  function openMasterRoll() {
    const sim = makeSim();
    const { a, b, mob } = partyOnCorpse(sim, PREMIUM);
    const c = sim.addPlayer('rogue', 'Cara');
    sim.partyInvite(c, a);
    sim.partyAccept(c);
    teleportTo(sim, 21, 21, c); // within loot range of the corpse
    sim.setPartyLootMaster(true, 0, 'uncommon', a);
    sim.lootCorpse(mob.id, a);
    const prompt = sim.events.find((e) => e.type === 'masterLoot')!;
    const rollId = prompt.rollId;
    const { expiresAt, candidates } = prompt as {
      expiresAt: number;
      candidates: { pid: number }[];
    };
    sim.events.length = 0;
    return { sim, a, b, c, mob, rollId, expiresAt, candidates };
  }

  // Runs one assignment and reports everything an observer could tell the two
  // requests apart by: bags, chat, prompts, and draws.
  function assign(pids: (ids: { a: number; b: number; c: number }) => number[]) {
    const world = openMasterRoll();
    const { sim, a, b, c, rollId } = world;
    const draws = countDraws(sim, () => sim.assignMasterLoot(rollId, pids({ a, b, c }), a));
    return {
      ...world,
      draws,
      prompts: sim.events
        .filter((e) => e.type === 'lootRoll' && e.rollId === rollId)
        .map((e) => e.pid as number),
      lines: sim.events.filter((e) => e.type === 'loot').map((e) => `${e.pid}|${e.text}`),
      bags: [sim.countItem(PREMIUM, a), sim.countItem(PREMIUM, b), sim.countItem(PREMIUM, c)],
    };
  }

  it('grants [X, X] exactly like [X], with the same chat and the same draw count', () => {
    const dup = assign(({ b }) => [b, b]);
    const once = assign(({ b }) => [b]);

    // Not a vacuous comparison of two empty bags: the control really granted.
    expect(once.bags).toEqual([0, 1, 0]);
    expect(dup.bags).toEqual(once.bags);
    // Chat compared verbatim, per recipient: the duplicate used to print the
    // named player's line twice once the roll it wrongly opened resolved.
    expect(dup.lines).toEqual(once.lines);
    expect(dup.lines.filter((line) => line.includes('assigned'))).toHaveLength(3); // one per member
    expect(dup.draws).toBe(0); // a direct grant draws nothing, and neither does the repeat
    expect(once.draws).toBe(0);
  });

  it('takes the direct-grant arm for [X, X], not a one-player need/greed roll', () => {
    // The deliberate behavior change the dedupe buys, pinned so it is a
    // decision rather than a side effect: deduping BEFORE the length tests is
    // what keeps [X, X] on the single-target arm. A dedupe placed after them
    // would still convert the roll, prompt the player, and wait out the timer
    // for a "contest" of one.
    const dup = assign(({ b }) => [b, b]);
    expect(dup.prompts).toEqual([]);
    expect(dup.sim.activeLootRolls(dup.b)).toHaveLength(0);
    expect(dup.sim.lootRollGroupStatus(dup.b)).toHaveLength(0); // the roll is gone, not reopened
    // The three above are all absences, which "dropped on the floor" satisfies
    // just as well. This is the one that says the item actually went somewhere.
    expect(dup.bags).toEqual([0, 1, 0]);
  });

  it('rolls [X, X, Y] among X and Y once each, resolving when both have answered', () => {
    const dup = assign(({ b, c }) => [b, b, c]);
    const once = assign(({ b, c }) => [b, c]);

    expect(once.prompts).toEqual([once.b, once.c]);
    expect(dup.prompts).toEqual([dup.b, dup.c]); // one prompt each, not two for b

    // The decisive arm: resolveLootRoll fires on `choices.size >= candidates.length`,
    // so a candidate list still holding the repeat would sit at 2 of 3 answered
    // and hang until the 60s timeout instead of resolving here.
    const dupDraws = countDraws(dup.sim, () => {
      dup.sim.submitLootRoll(dup.rollId, 'need', dup.b);
      dup.sim.submitLootRoll(dup.rollId, 'need', dup.c);
    });
    const onceDraws = countDraws(once.sim, () => {
      once.sim.submitLootRoll(once.rollId, 'need', once.b);
      once.sim.submitLootRoll(once.rollId, 'need', once.c);
    });

    // A literal, not just an equality that could hold at zero: two needers cost
    // exactly two rolls on this seed (no tie, so no tie-break int). The repeat
    // used to add a third entry, hence a third reveal line and a tie-break draw.
    expect(onceDraws).toBe(2);
    expect(dupDraws).toBe(onceDraws);
    expect(dup.sim.countItem(PREMIUM, dup.b) + dup.sim.countItem(PREMIUM, dup.c)).toBe(1);
    expect([dup.sim.countItem(PREMIUM, dup.b), dup.sim.countItem(PREMIUM, dup.c)]).toEqual([
      once.sim.countItem(PREMIUM, once.b),
      once.sim.countItem(PREMIUM, once.c),
    ]);

    // Exactly one reveal line per contender per party member (3 members, 2
    // contenders), and Bert's appears once, not twice.
    const reveals = dup.sim.events.flatMap((e) =>
      e.type === 'loot' && e.text.includes('Need Roll') ? [e.text] : [],
    );
    expect(reveals).toHaveLength(6);
    expect(reveals.filter((text) => text.includes('Bert'))).toHaveLength(3);
  });

  it('keeps request order for a duplicate-free list, and first-seen order for a repeat', () => {
    // Order decides prompt (and therefore reveal) order, so the dedupe must not
    // sort or re-seat: the trailing copy of c does not move c behind b.
    const plain = assign(({ b, c }) => [c, b]);
    expect(plain.prompts).toEqual([plain.c, plain.b]);
    const repeat = assign(({ b, c }) => [c, b, c]);
    expect(repeat.prompts).toEqual([repeat.c, repeat.b]);

    // Both expectations above are reversals of the roster: c joined the party
    // after b, so roll.candidates runs b then c. Pinning that makes the two
    // toEqual calls real order assertions rather than pairs that would also
    // hold if the dedupe sorted, or rebuilt the list from roll.candidates.
    expect(plain.c).toBeGreaterThan(plain.b);
    expect(repeat.prompts).not.toEqual([repeat.b, repeat.c]);
  });

  it('ignores a repeat of a pid that is not a candidate at all', () => {
    const world = openMasterRoll();
    const draws = countDraws(world.sim, () =>
      world.sim.assignMasterLoot(world.rollId, [99999, 99999], world.a),
    );
    // Deduping must not turn a rejected selection into an accepted one: an
    // ineligible pid named twice is still an empty selection.
    expect(draws).toBe(0);
    expect(world.sim.events.filter((e) => e.type === 'lootRoll')).toHaveLength(0);
    expect(world.sim.countItem(PREMIUM, world.b)).toBe(0);

    // The prompt SURVIVED, rather than being quietly consumed. Nothing above
    // can tell those apart: activeLootRolls hides a curate-phase master roll by
    // design, so an empty reconcile surface is what a deleted roll looks like
    // too. A valid assignment landing afterwards is the proof it was still open.
    expect(world.sim.activeLootRolls(world.b)).toHaveLength(0); // curate phase, so not a prompt
    world.sim.assignMasterLoot(world.rollId, [world.b], world.a);
    expect(world.sim.countItem(PREMIUM, world.b)).toBe(1);
  });

  it('drops only the ineligible copy when a repeat and a stranger share a request', () => {
    // The dedupe and the eligibility filter have to compose: a request mixing a
    // repeated candidate with a pid that was never a candidate keeps one copy
    // of the first and none of the second, so it is the single-target grant.
    const mixed = assign(({ b }) => [b, b, 99999]);
    expect(mixed.prompts).toEqual([]);
    expect(mixed.bags).toEqual([0, 1, 0]);
  });

  it('lets the master looter assign a repeat of themselves', () => {
    // The looter is an eligible candidate like any other, so [A, A] from A is a
    // plain self-assignment, not a special case. Pinned because it is the one
    // shape where the deduped pid is also the pid passing the ownership check.
    const self = assign(({ a }) => [a, a]);
    expect(self.prompts).toEqual([]);
    expect(self.bags).toEqual([1, 0, 0]);
  });

  it('opens the master roll with a candidate roster that has no repeat', () => {
    // Load-bearing for everything above: the dedupe only covers the pid list the
    // CLIENT sends. If roll.candidates could itself carry a repeat (it cannot
    // today: party.members is uniqueness-guarded at join, and lootRecipientIds
    // is built from it) the identical doubled prompt, doubled reveal, and
    // tie-break draw would come back through the other door.
    const pids = openMasterRoll().candidates.map((cand) => cand.pid);
    expect(pids).toHaveLength(3); // the whole party, so the check has something to catch
    expect(new Set(pids).size).toBe(3);
  });

  it('opens the master roll with a roster scoped to the tapping party', () => {
    // The other half of that invariant, and now load-bearing in a second place:
    // server/game.ts bounds the masterAssign pid list at RAID_MAX (#2524) purely
    // because the candidate roster is a subset of one party, which partyAccept and
    // the finder seam both cap. A bystander standing on the corpse is the way that
    // could quietly stop being true, so pin it with one present: a count-only
    // assertion on an all-party fixture would pass either way.
    const { sim, a } = openMasterRoll();
    const bystander = sim.addPlayer('hunter', 'Nosy');
    teleportTo(sim, 21, 21, bystander); // right on the corpse, in no party
    expect(sim.partyOf(bystander)).toBeNull();

    const rosterFor = (mobId: number) => {
      const mob = createMob(mobId, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
      mob.dead = true;
      mob.lootable = true;
      mob.tappedById = a;
      mob.loot = { copper: 0, items: [{ itemId: PREMIUM, count: 1 }] };
      sim.entities.set(mob.id, mob);
      sim.events.length = 0;
      sim.lootCorpse(mob.id, a);
      const opened = sim.events.find((e) => e.type === 'masterLoot');
      expect(opened).toBeTruthy();
      return (opened as { candidates: { pid: number }[] }).candidates.map((c) => c.pid);
    };

    const outside = rosterFor(990501);
    const members = sim.partyOf(a)?.members ?? [];
    expect(outside.length).toBeGreaterThan(1); // a real roll, not an empty one
    expect(outside.filter((pid) => !members.includes(pid))).toEqual([]);
    expect(outside).not.toContain(bystander);

    // The control that makes it a statement about MEMBERSHIP rather than distance:
    // nothing about where they stand changes, they simply join, and the very same
    // corpse position now puts them on the roster.
    sim.partyInvite(bystander, a);
    sim.partyAccept(bystander);
    expect(rosterFor(990502)).toContain(bystander);
  });

  it('routes a departed [X, X] target down the same fallback [X] takes', () => {
    // The dedupe newly steers a repeat into the single-target arm, and that arm
    // has its own guard: a target who logged out during the up-to-5min curate
    // window would silently destroy the item, so it converts to need/greed over
    // the FULL candidate list instead. Pinned because "[X, X] behaves exactly
    // like [X]" has to hold on this branch too, not just the happy path.
    const run = (pids: (ids: { b: number }) => number[]) => {
      const world = openMasterRoll();
      world.sim.entities.delete(world.b); // gone from the world, still on the roll
      world.sim.assignMasterLoot(world.rollId, pids({ b: world.b }), world.a);
      return {
        ...world,
        prompts: world.sim.events
          .filter((e) => e.type === 'lootRoll' && e.rollId === world.rollId)
          .map((e) => e.pid as number),
      };
    };
    const dup = run(({ b }) => [b, b]);
    const once = run(({ b }) => [b]);

    // The full roster, not the named target: the fallback deliberately widens.
    expect(once.prompts).toEqual([once.a, once.b, once.c]);
    expect(dup.prompts).toEqual(once.prompts);
    expect(dup.sim.countItem(PREMIUM, dup.a)).toBe(0); // nothing granted on this arm
  });

  // The determinism arm. The duplicate's extra draw is a tie-break ctx.rng.int
  // spent when the roll RESOLVES, so no assertion taken at assignment time can
  // see it: reaching it means ticking the roll past its deadline. Counting
  // draws across ticks is not usable (world simulation draws too), so this
  // compares where the shared stream ENDS UP instead, which is the property
  // that actually matters: a repeat must not shift the world's draw sequence.
  it('leaves the world rng stream exactly where [X] leaves it', () => {
    const run = (pids: (ids: { b: number; c: number }) => number[]) => {
      const world = openMasterRoll();
      world.sim.assignMasterLoot(world.rollId, pids({ b: world.b, c: world.c }), world.a);
      // Whatever the assignment opened (nothing, on the fixed single-target
      // arm), answer it and run out every deadline it could be waiting on.
      world.sim.submitLootRoll(world.rollId, 'need', world.b);
      world.sim.time = world.expiresAt - 0.5;
      for (let i = 0; i < 40; i++) world.sim.tick();
      return { world, stream: drainStream(world.sim, 4) };
    };
    const dup = run(({ b }) => [b, b]);
    const once = run(({ b }) => [b]);
    expect(dup.stream).toEqual(once.stream);

    // Sensitivity, so the equality above is not just two worlds that never
    // diverge: a genuinely different request DOES move the stream, which is
    // what the duplicate used to do (an extra reveal entry and a tie-break int
    // for a player tied with itself).
    const other = run(({ b, c }) => [b, c]);
    expect(other.stream).not.toEqual(once.stream);
    expect(new Set(once.stream).size).toBe(4); // a real drain, not four repeats of one value

    // And the plain determinism floor: the same request on the same seed twice
    // is the same world, so the repeat run reproduces its own stream too.
    expect(run(({ b }) => [b, b]).stream).toEqual(dup.stream);
  });
});
