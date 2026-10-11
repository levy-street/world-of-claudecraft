import { describe, expect, it } from 'vitest';
import { ABILITIES, CLASSES } from '../src/sim/content/classes';
import { rowTreeFor } from '../src/sim/content/talent_rows';
import { talentsFor } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { MAX_LEVEL, type PlayerClass } from '../src/sim/types';
import type { ActionBarWorldInput } from '../src/ui/hud/action_bar/action_bar_view';
import {
  cooldownClassCatalog,
  cooldownTrackable,
} from '../src/ui/hud/cooldown_manager/cooldown_manager_catalog';
import { defaultCooldownSpellConfig } from '../src/ui/hud/cooldown_manager/cooldown_manager_config';
import { createCooldownManagerView } from '../src/ui/hud/cooldown_manager/cooldown_manager_view';

const CLASS_IDS = Object.keys(CLASSES) as PlayerClass[];

function worldOf(sim: Sim): ActionBarWorldInput {
  return {
    player: sim.player,
    target: null,
    inventory: sim.inventory,
    stealthed: false,
    paladinSpec: null,
    fateThreads: 0,
    entities: sim.entities.values(),
    activeAimSlot: null,
  };
}

/** Every build a class can reach, one row varied at a time (every option of
 *  every row is visited at least once, under every spec). */
function builds(cls: PlayerClass): { spec: string; rows: Record<number, string> }[] {
  const specs = talentsFor(cls)?.specs ?? [];
  const tree = rowTreeFor(cls) ?? [];
  const base: Record<number, string> = {};
  for (const row of tree) base[row.level] = row.options[0].id;
  const out: { spec: string; rows: Record<number, string> }[] = [];
  for (const spec of specs) {
    out.push({ spec: spec.id, rows: { ...base } });
    for (const row of tree) {
      for (const option of row.options.slice(1)) {
        out.push({ spec: spec.id, rows: { ...base, [row.level]: option.id } });
      }
    }
  }
  return out;
}

describe('cooldown manager spell catalog', () => {
  it('covers every class, holding only real, pressable spells', () => {
    expect(CLASS_IDS.length).toBeGreaterThanOrEqual(9);
    for (const cls of CLASS_IDS) {
      const catalog = cooldownClassCatalog(cls);
      expect(catalog.length, cls).toBeGreaterThan(10);
      for (const id of catalog) {
        expect(ABILITIES[id], `${cls}:${id}`).toBeDefined();
        expect(cooldownTrackable(id), `${cls}:${id}`).toBe(true);
      }
      expect(new Set(catalog).size).toBe(catalog.length);
    }
  });

  it('holds every castable spell any spec and talent build of any class knows at max level', () => {
    let checked = 0;
    for (const cls of CLASS_IDS) {
      const catalog = new Set(cooldownClassCatalog(cls));
      // One Sim per class; re-applying a build recomputes the known list.
      const sim = new Sim({ seed: 7, playerClass: cls, autoEquip: true });
      sim.setPlayerLevel(MAX_LEVEL);
      for (const build of builds(cls)) {
        expect(sim.applyTalents(build), `${cls} ${build.spec}`).toBe(true);
        for (const ability of sim.known) {
          if (!cooldownTrackable(ability.def.id)) continue;
          expect(catalog.has(ability.def.id), `${cls}/${build.spec}: ${ability.def.id}`).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  }, 120_000);

  it('gives every known spell of every spec a live button (resolves, has an icon, no throw)', () => {
    for (const cls of CLASS_IDS) {
      for (const spec of talentsFor(cls)?.specs ?? []) {
        const sim = new Sim({ seed: 7, playerClass: cls, autoEquip: true });
        sim.setPlayerLevel(MAX_LEVEL);
        expect(sim.applyTalents({ spec: spec.id, rows: {} })).toBe(true);
        sim.player.resource = sim.player.maxResource;
        const ids = sim.known.map((a) => a.def.id).filter(cooldownTrackable);
        const view = createCooldownManagerView({
          resolve: (id) => sim.resolvedAbility(id),
          formatCount: String,
        });
        view.setTracked(ids.map((id) => ({ id, config: defaultCooldownSpellConfig(), cue: null })));
        const state = view.tick(worldOf(sim), { soundsAllowed: false, preview: true });
        for (const button of state.buttons) {
          expect(button.abilityId, `${cls}/${spec.id}: ${button.baseId}`).not.toBeNull();
          expect(button.iconKey.startsWith('ability:')).toBe(true);
          expect(button.visible).toBe(true);
        }
      }
    }
  });

  it('includes spells from other specs, so a group can be set up before switching', () => {
    for (const cls of CLASS_IDS) {
      const catalog = new Set(cooldownClassCatalog(cls));
      for (const spec of talentsFor(cls)?.specs ?? []) {
        expect(catalog.has(spec.signature) || !cooldownTrackable(spec.signature), spec.id).toBe(
          true,
        );
      }
    }
    // Feral's Gorebite is there for every druid, whatever spec they play now.
    expect(cooldownClassCatalog('druid')).toContain('ferocious_bite');
  });
});
