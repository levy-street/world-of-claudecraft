import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { requiredLevelFor } from '../src/sim/item_level_req';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

// knight_commanders_greaves is a rare, cloth-armor legs piece (any class can
// wear cloth) with NO class restriction, so it isolates the level gate from
// the proficiency gate. Its required level is derived from where it actually
// drops (a level-13 quest reward), not a flat quality band.
const HELM = 'knight_commanders_greaves';
const REQUIRED_LEVEL = 13;

function freshWarrior(level: number) {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true, autoEquip: false });
  const pid = sim.addPlayer('warrior', 'Tester');
  sim.setPlayerLevel(level, pid);
  sim.addItem(HELM, 1, pid);
  sim.drainEvents(); // clear setup events so a later drain only sees the equip attempt
  return { sim, pid };
}

function errorTexts(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

describe('equip level requirement', () => {
  it('the chosen test item really requires the expected level', () => {
    expect(requiredLevelFor(ITEMS[HELM])).toBe(REQUIRED_LEVEL);
  });

  it('blocks equipping gear above the character level and keeps it in the bags', () => {
    const { sim, pid } = freshWarrior(REQUIRED_LEVEL - 1);
    sim.equipItem(HELM, pid);
    expect(sim.meta(pid)!.equipment.legs).toBeUndefined();
    expect(sim.meta(pid)!.inventory.some((s) => s?.itemId === HELM)).toBe(true);
  });

  it('emits the level-requirement error naming the required level', () => {
    const { sim, pid } = freshWarrior(REQUIRED_LEVEL - 1);
    sim.equipItem(HELM, pid);
    const errs = errorTexts(sim.drainEvents());
    expect(errs).toContain(`You must be level ${REQUIRED_LEVEL} to equip that.`);
  });

  it('allows equipping at exactly the required level', () => {
    const { sim, pid } = freshWarrior(REQUIRED_LEVEL);
    sim.equipItem(HELM, pid);
    expect(sim.meta(pid)!.equipment.legs).toBe(HELM);
  });

  it('allows equipping above the required level', () => {
    const { sim, pid } = freshWarrior(20);
    sim.equipItem(HELM, pid);
    expect(sim.meta(pid)!.equipment.legs).toBe(HELM);
  });

  it('leaves an uncommon leveling green equippable at level 1', () => {
    // cryptbone_helm is uncommon: a leveling green, deliberately ungated.
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true, autoEquip: false });
    const pid = sim.addPlayer('warrior', 'Tester');
    sim.addItem('cryptbone_helm', 1, pid);
    sim.equipItem('cryptbone_helm', pid);
    expect(sim.meta(pid)!.equipment.helmet).toBe('cryptbone_helm');
  });

  it('is deterministic: same seed and level yield the same outcome', () => {
    const run = () => {
      const { sim, pid } = freshWarrior(REQUIRED_LEVEL);
      sim.equipItem(HELM, pid);
      return sim.meta(pid)!.equipment.legs;
    };
    expect(run()).toEqual(run());
  });

  it('auto-equip skips gear above the level silently (no equip, no error toast)', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Tester', { autoEquip: true });
    sim.setPlayerLevel(REQUIRED_LEVEL - 1, pid); // below the piece's required level
    sim.drainEvents();
    sim.addItem(HELM, 1, pid); // would trigger maybeAutoEquip
    expect(sim.meta(pid)!.equipment.legs).toBeUndefined();
    expect(errorTexts(sim.drainEvents())).not.toContain(
      `You must be level ${REQUIRED_LEVEL} to equip that.`,
    );
  });
});
