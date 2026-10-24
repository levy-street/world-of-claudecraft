import { describe, expect, it } from 'vitest';
import {
  availableLoadout,
  campTemplatesAt,
  greensLoadout,
  LEVELING_SPECS,
  runLevelingCells,
} from '../scripts/leveling_ttk_probe';
import { ABILITIES, CLASSES, ITEMS } from '../src/sim/data';
import { canEquipItemInSlot } from '../src/sim/equipment_rules';
import type { EquipSlot } from '../src/sim/types';

// Smoke coverage for the leveling time-to-kill bench (scripts/leveling_ttk_probe.ts).
// The bench is a measurement instrument, not a balance pin: these checks keep it
// runnable and honest (real fights that end, gear the class can actually wear,
// the same answer for the same seed), so a refactor cannot quietly break it.
describe('leveling time-to-kill bench', () => {
  it('samples only ordinary open-world camp mobs that cover the level', () => {
    for (const level of [1, 7, 13, 20]) {
      const templates = campTemplatesAt(level);
      expect(templates.length).toBeGreaterThan(0);
      expect(templates.length).toBeLessThanOrEqual(8);
      for (const t of templates) {
        expect(level).toBeGreaterThanOrEqual(t.minLevel);
        expect(level).toBeLessThanOrEqual(t.maxLevel);
        expect(t.elite || t.boss || t.rare || t.dummy).toBeFalsy();
      }
    }
  });

  it('builds loadouts the class can wear in the slots it fills', () => {
    for (const cls of ['warrior', 'rogue', 'mage', 'druid'] as const) {
      const def = CLASSES[cls];
      const starter = { mainhand: def.startWeapon, chest: def.startChest };
      for (const level of [4, 12, 20]) {
        for (const loadout of [availableLoadout(cls, level, starter), greensLoadout(cls, level)]) {
          for (const [slot, id] of Object.entries(loadout) as [EquipSlot, string][]) {
            const item = ITEMS[id];
            expect(item, id).toBeDefined();
            // The spec only exists from level 5; spec-gated weapon rules key on it.
            const spec = level >= 5 ? LEVELING_SPECS[cls].spec : null;
            expect(canEquipItemInSlot(cls, item, slot, spec), `${cls} ${slot} ${id}`).toBe(true);
          }
        }
      }
    }
  });

  it('runs real fights to a kill and is deterministic for a fixed seed', () => {
    const run = () =>
      runLevelingCells({ cls: 'warrior', level: 6, tiers: ['available'], repetitions: 1, seed: 7 });
    const [cell] = run();
    expect(cell.fights.length).toBe(campTemplatesAt(6).length);
    for (const fight of cell.fights) {
      expect(fight.outcome).toBe('killed');
      expect(fight.seconds).toBeGreaterThan(0);
      expect(Object.values(fight.damageBySource).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(
        fight.mobHp,
      );
    }
    expect(run()).toEqual([cell]);
  }, 60_000);

  it('the arms rotation lands Maiming Strike', () => {
    const [cell] = runLevelingCells({
      cls: 'warrior',
      level: 10,
      tiers: ['available'],
      repetitions: 1,
      seed: 7,
    });
    const maiming = ABILITIES.mortal_strike.name;
    expect(cell.fights.some((f) => (f.damageBySource[maiming] ?? 0) > 0)).toBe(true);
  }, 60_000);

  it('feral keeps Cat Form across pulls instead of toggling it off', () => {
    const [cell] = runLevelingCells({
      cls: 'druid',
      level: 10,
      tiers: ['available'],
      repetitions: 1,
      seed: 7,
    });
    const casterSpells = [ABILITIES.wrath.name, ABILITIES.moonfire.name];
    expect(cell.fights.length).toBeGreaterThan(1);
    for (const fight of cell.fights) {
      for (const spell of casterSpells) expect(fight.damageBySource[spell], spell).toBeUndefined();
      expect(fight.damageBySource[ABILITIES.claw.name] ?? 0).toBeGreaterThan(0);
    }
  }, 60_000);
});
