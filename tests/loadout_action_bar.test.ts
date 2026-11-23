import { describe, expect, it } from 'vitest';
import {
  classSpecs,
  SAVED_LOADOUT_BAR_SLOTS,
  type TalentAllocation,
} from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { MAX_LEVEL } from '../src/sim/types';
import {
  ACTION_BAR_ABILITY_SLOTS,
  ActionBarController,
} from '../src/ui/hud/action_bar/action_bar_controller';
import { loadoutGrantedAbilityIds } from '../src/ui/hud/action_bar/hotbar';

describe('loadout action bar persistence', () => {
  it('preserves the full three-row action bar in saved loadouts', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(MAX_LEVEL);
    const fullBar = Array.from({ length: SAVED_LOADOUT_BAR_SLOTS + 1 }, (_, i) => `slot_${i}`);

    expect(SAVED_LOADOUT_BAR_SLOTS).toBe(ACTION_BAR_ABILITY_SLOTS);
    expect(sim.saveLoadout('Three Row Bar', fullBar)).toBe(0);
    expect(sim.loadouts[0].bar).toEqual(fullBar.slice(0, SAVED_LOADOUT_BAR_SLOTS));
  });
});

// End to end over the real Sim, mirroring the HUD flow exactly: a spec pick
// commits at once (talents_window commitSpec), the per-frame sync follows the
// spec onto its own bar, Save records the live bar, a build switch re-applies
// it. Regression for the "warlock spec spells are not saved in builds" report:
// the spec's bar was seeded from the pre-spec key without its own spells, so
// the build recorded none, and switching back to it restored a bar without
// them.
describe('build save round trip through the action bar controller', () => {
  class MemoryStorage {
    readonly values = new Map<string, string>();
    getItem(key: string): string | null {
      return this.values.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
      this.values.set(key, value);
    }
    removeItem(key: string): void {
      this.values.delete(key);
    }
  }

  // Two classes on purpose: a warlock's pre-spec bar carries a spell that stops
  // being known under a spec, which trips the controller's warlock-overhaul
  // repair and masks the seed bug there, so the warlock arm only pins that the
  // whole A -> B -> A round trip restores the bar; the mage arm is the decisive
  // one (no repair path: it fails without the legacy-seed heal).
  it.each(['mage', 'warlock'] as const)(
    'restores a %s build with its spec spells after switching away and back',
    (cls) => {
      const sim = new Sim({ seed: 3, playerClass: cls });
      sim.setPlayerLevel(MAX_LEVEL);
      const specs = classSpecs(cls);
      expect(specs.length).toBeGreaterThanOrEqual(2);
      const controller = new ActionBarController({
        storage: new MemoryStorage(),
        playerClass: cls,
        playerName: 'Lock',
        playerLevel: () => sim.player.level,
        talentSpec: () => sim.talentSpec,
        talentAllocation: () => sim.talents,
        knownAbilityIds: () => sim.known.map((known) => known.def.id),
        hasAura: () => false,
        showAttackButton: () => true,
      });
      const settle = (): void => {
        controller.syncSpec();
        controller.syncKnownAbilities();
      };
      const abilityIds = (): (string | null)[] =>
        controller.actions.map((action) => (action?.type === 'ability' ? action.id : null));
      const granted = (spec: string): string[] => [
        ...loadoutGrantedAbilityIds(cls, { spec, rows: {} }, sim.player.level),
      ];
      // Spec-less start: the bar seeds under the pre-spec key, as every character's does.
      controller.init();
      settle();
      expect(sim.talentSpec).toBeNull();

      // Pick spec A in the talents window (commits at once); the sync follows it.
      expect(sim.setSpec(specs[0])).toBe(true);
      settle();
      const grantedA = granted(specs[0]);
      expect(grantedA.length).toBeGreaterThan(0);
      for (const id of grantedA) expect(abilityIds(), `${id} on the spec bar`).toContain(id);
      const liveA = abilityIds();
      expect(sim.saveLoadout('A', liveA, sim.talents)).toBe(0);
      for (const id of grantedA) expect(sim.loadouts[0].bar).toContain(id);

      // Pick spec B and save build B the same way.
      expect(sim.setSpec(specs[1])).toBe(true);
      settle();
      for (const id of granted(specs[1])) expect(abilityIds(), `${id} on spec B`).toContain(id);
      expect(sim.saveLoadout('B', abilityIds(), sim.talents)).toBe(1);

      // Switch back to A the way Hud.requestLoadoutSwitch + applyLoadoutBar do.
      expect(sim.switchLoadout(0)).toBe(true);
      controller.applyLoadout(sim.loadouts[0].bar, sim.loadouts[0].alloc);
      controller.saveActions();
      settle();
      expect(abilityIds()).toEqual(liveA);
    },
  );
});
