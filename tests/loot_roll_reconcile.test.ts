import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';
import { LOOT_ROLL_REGRACE_MS, reconcileLootRolls } from '../src/ui/hud/loot/loot_roll_reconcile';

// Loot-roll prompts were delivered only as a single best-effort `lootRoll`
// event. A client that missed that one frame (reconnect, interest churn, a
// dropped snapshot) permanently lost the prompt while groupmates rolled. These
// tests pin the authoritative reconciliation surface: the Sim exposes the rolls
// a player may still answer, the server rides them on the self snapshot, and the
// online client mirrors them, so the HUD can re-show a missed prompt.

const makeSim = (seed = 42) =>
  new Sim({ seed, playerClass: 'warrior', autoEquip: true, noPlayer: true });

function teleportTo(sim: Sim, pid: number, x: number, z: number) {
  const e = sim.entities.get(pid)!;
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = terrainHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function partyWithSharedRoll(seed = 42) {
  const sim = makeSim(seed);
  const a = sim.addPlayer('warrior', 'Aaa');
  const b = sim.addPlayer('mage', 'Bbb');
  sim.partyInvite(b, a);
  sim.partyAccept(b);
  teleportTo(sim, a, 20, 20);
  teleportTo(sim, b, 21, 20);
  const mob = createMob(990700, MOBS.forest_wolf, 2, { x: 20, y: 0, z: 22 });
  mob.dead = true;
  mob.lootable = true;
  mob.tappedById = a;
  mob.loot = { copper: 0, items: [{ itemId: 'greyjaw_hide_boots', count: 1 }] };
  sim.entities.set(mob.id, mob);
  sim.lootCorpse(mob.id, a);
  const rollId = sim.events.find((e) => e.type === 'lootRoll')!.rollId;
  return { sim, a, b, rollId };
}

describe('Sim.activeLootRolls', () => {
  it('reports the open roll to every candidate who has not chosen', () => {
    const { sim, a, b, rollId } = partyWithSharedRoll();
    for (const pid of [a, b]) {
      const prompts = sim.activeLootRolls(pid);
      expect(prompts.map((p) => p.rollId)).toContain(rollId);
      const prompt = prompts.find((p) => p.rollId === rollId)!;
      expect(prompt.itemId).toBe('greyjaw_hide_boots');
      expect(prompt.itemName).toBe('Greyjaw Hide Boots');
    }
  });

  it('drops the roll for a player once they have submitted a choice', () => {
    const { sim, a, b, rollId } = partyWithSharedRoll();
    sim.submitLootRoll(rollId, 'greed', a);
    expect(sim.activeLootRolls(a).map((p) => p.rollId)).not.toContain(rollId);
    // still open for the other candidate
    expect(sim.activeLootRolls(b).map((p) => p.rollId)).toContain(rollId);
  });

  it('drops the roll for everyone once it resolves', () => {
    const { sim, a, b, rollId } = partyWithSharedRoll();
    sim.submitLootRoll(rollId, 'need', a);
    sim.submitLootRoll(rollId, 'need', b);
    expect(sim.activeLootRolls(a)).toHaveLength(0);
    expect(sim.activeLootRolls(b)).toHaveLength(0);
  });

  it('reports nothing to a non-candidate', () => {
    const { sim } = partyWithSharedRoll();
    const outsider = (sim as any).addPlayer('hunter', 'Ccc');
    expect(sim.activeLootRolls(outsider)).toHaveLength(0);
  });

  it('is deterministic for the same seed', () => {
    const run = () => partyWithSharedRoll(7).sim.activeLootRolls(2);
    expect(run()).toEqual(run());
  });
});

// The pure three-way decision behind the HUD recovery glue: given the server's
// open-roll mirror, the locally shown prompts, the locally dismissed rolls, and
// which shown rolls have been mirror-confirmed, decide what to show, retire, and
// prune. This is the subtlest part of the fix (the appear/disappear asymmetry
// and the event-before-mirror race), so it is unit-tested in isolation here.
describe('reconcileLootRolls (HUD decision)', () => {
  it('shows an open roll that is not yet shown or dismissed', () => {
    const d = reconcileLootRolls({ open: [1], shown: [], dismissed: [], confirmed: [] });
    expect(d.toShow).toEqual([1]);
    expect(d.toRetire).toEqual([]);
    // The newly open roll becomes confirmed for the next tick.
    expect(d.confirmed).toEqual([1]);
  });

  it('keeps shown rolls stable and restores a locally dismissed roll the server still offers past the grace', () => {
    // A tap is only a local intent. If the socket dropped it or the server rejected
    // it, the authoritative self mirror still lists roll 2. Once that has held past
    // the grace (a genuinely dropped submit, not a mirror that has not caught up),
    // the buttons must retry.
    const d = reconcileLootRolls({
      open: [1, 2],
      shown: [1],
      dismissed: [2],
      confirmed: [1],
      dismissedAt: { 2: 1000 },
      nowMs: 1000 + LOOT_ROLL_REGRACE_MS,
    });
    expect(d.toShow).toEqual([2]);
    expect(d.toRetire).toEqual([]);
  });

  it('does NOT re-show a freshly answered roll while the mirror is still catching up (no flash)', () => {
    // Online, a tap removes the prompt and sends the command, but the self mirror
    // keeps listing the roll open for a round trip. Within the grace we must not
    // re-create the just-answered prompt with live buttons.
    const d = reconcileLootRolls({
      open: [2],
      shown: [],
      dismissed: [2],
      confirmed: [2],
      dismissedAt: { 2: 1000 },
      nowMs: 1000 + LOOT_ROLL_REGRACE_MS - 1,
    });
    expect(d.toShow).toEqual([]);
    expect(d.toRetire).toEqual([]);
    // Still suppressed (mirror lists it), so it is not pruned yet either.
    expect(d.toPrune).toEqual([]);
  });

  it('re-shows a dropped submit once it stays open past the grace, but never after the mirror drops it', () => {
    // The dropped-submit recovery: the server never recorded the choice, so the
    // roll is still open well past the grace -> restore the retryable buttons.
    const stillOpen = reconcileLootRolls({
      open: [2],
      shown: [],
      dismissed: [2],
      confirmed: [2],
      dismissedAt: { 2: 1000 },
      nowMs: 1000 + LOOT_ROLL_REGRACE_MS,
    });
    expect(stillOpen.toShow).toEqual([2]);
    // The normal answer: the server recorded the choice before the grace elapsed,
    // so the roll has already left the mirror -> nothing to re-show, and prune it.
    const answered = reconcileLootRolls({
      open: [],
      shown: [],
      dismissed: [2],
      confirmed: [2],
      dismissedAt: { 2: 1000 },
      nowMs: 1000 + LOOT_ROLL_REGRACE_MS,
    });
    expect(answered.toShow).toEqual([]);
    expect(answered.toPrune).toEqual([2]);
  });

  it('retires a mirror-confirmed shown roll once the server drops it', () => {
    // Roll 1 was shown and previously seen in the mirror; the mirror is now empty,
    // so the server resolved it: retire the stale dead-button prompt.
    const d = reconcileLootRolls({ open: [], shown: [1], dismissed: [], confirmed: [1] });
    expect(d.toRetire).toEqual([1]);
    expect(d.confirmed).toEqual([]);
  });

  it('does NOT retire a just-shown roll the mirror has not caught up to yet', () => {
    // Roll 1 was shown from the transient event this frame but is not in the
    // mirror and was never confirmed: the event-before-mirror race. Leave it.
    const d = reconcileLootRolls({ open: [], shown: [1], dismissed: [], confirmed: [] });
    expect(d.toRetire).toEqual([]);
    expect(d.toShow).toEqual([]);
  });

  it('confirms an event-shown roll once it appears in the mirror, then retires it later', () => {
    // Frame A: shown from event, mirror now lists it -> becomes confirmed, no retire.
    const a = reconcileLootRolls({ open: [1], shown: [1], dismissed: [], confirmed: [] });
    expect(a.toRetire).toEqual([]);
    expect(a.confirmed).toEqual([1]);
    // Frame B: mirror drops it -> now retire (confirmation carried forward).
    const b = reconcileLootRolls({ open: [], shown: [1], dismissed: [], confirmed: a.confirmed });
    expect(b.toRetire).toEqual([1]);
  });

  it('prunes a dismissed roll once the server drops it, keeping still-open ones', () => {
    const d = reconcileLootRolls({ open: [2], shown: [], dismissed: [1, 2], confirmed: [] });
    expect(d.toPrune).toEqual([1]); // 1 gone from mirror -> forget it
    expect(d.toPrune).not.toContain(2); // 2 still open -> keep suppressing
  });

  it('handles show and retire in the same reconcile', () => {
    // Roll 1 confirmed-and-dropped (retire), roll 2 newly open (show).
    const d = reconcileLootRolls({ open: [2], shown: [1], dismissed: [], confirmed: [1] });
    expect(d.toRetire).toEqual([1]);
    expect(d.toShow).toEqual([2]);
    expect(d.confirmed).toEqual([2]);
  });
});
