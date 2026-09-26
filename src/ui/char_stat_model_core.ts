// Pure bridge from the live world to the character sheet's stat model.
//
// Maps an IWorld-shaped read (the shown player entity, its equipment, its class)
// onto the host-agnostic stat_tooltip core's input, then builds the model one
// stat cell and its hover tooltip render from. Extracted from Hud.statModel so
// the coordinator stays a one-line consumer and the mapping is testable against
// BOTH a Sim- and a ClientWorld-shaped world (tests/char_stat_model_core.test.ts).
//
// DOM-free and deterministic. The only i18n it touches is NAME resolution for
// the "Made up of:" source lines (an equipped item's and an active aura's display
// name, resolved the same way the buff bar resolves them), which the pure-core
// rule allows. The Spell Crit value is the sim's own spellCritChance run over the
// entity, never a UI copy of the formula: offline it reads the Sim's entity, and
// online the self mirror carries the one input it would otherwise lack (the
// shared crit core, the `scb` self scalar).

import { spellCritChance } from '../sim/combat/spell_combat';
import { warriorParryChance } from '../sim/combat/warrior_hit_table';
import { ABILITIES, ITEMS } from '../sim/data';
import type { IWorld } from '../world_api';
import { abilityDisplayName } from './ability_display_name';
import { auraDisplayNameForHud } from './aura_display_name';
import { itemDisplayName } from './entity_i18n';
import {
  type BuffStatSource,
  buildStatTooltip,
  type GearStatSource,
  type StatId,
  type StatTooltipModel,
  weaponDps,
} from './stat_tooltip';

/** The slice of IWorld the stat sheet reads: the shown player, their worn
 *  equipment (by item id), and their class. */
export type CharStatWorld = Pick<IWorld, 'player' | 'equipment' | 'cfg'>;

/** Build the stat model for one character-sheet cell from the live world. Both
 *  the cell and its tooltip call this at paint/hover time, so they read the
 *  player's current numbers. */
export function charStatModel(world: CharStatWorld, stat: StatId): StatTooltipModel {
  const p = world.player;
  const cls = world.cfg.playerClass;
  const wpn = world.equipment.mainhand ? ITEMS[world.equipment.mainhand] : null;
  // Equipped items + active auras feed the upstream "Made up of:" source
  // breakdown; names resolve the same way the buff bar resolves them.
  const gear: GearStatSource[] = [];
  for (const id of Object.values(world.equipment)) {
    const item = id ? ITEMS[id] : null;
    if (!item || (!item.stats && !item.spellPower && !item.healPower)) continue;
    gear.push({
      name: itemDisplayName(item),
      stats: item.stats,
      spellPower: item.spellPower,
      healPower: item.healPower,
    });
  }
  const buffs: BuffStatSource[] = p.auras.map((a) => ({
    kind: a.kind,
    value: a.value,
    name: auraDisplayNameForHud(
      a.name,
      ABILITIES[a.id] ? abilityDisplayName(ABILITIES[a.id]) : null,
    ),
  }));
  return buildStatTooltip(stat, {
    cls,
    stats: p.stats,
    level: p.level,
    attackPower: p.attackPower,
    spellPower: p.spellPower,
    healPower: p.healPower,
    critChance: p.critChance,
    spellCritChance: spellCritChance(p),
    dodgeChance: p.dodgeChance,
    critRating: p.critRating,
    hasteRating: p.hasteRating,
    hitRating: p.hitRating,
    parryChance: cls === 'warrior' ? warriorParryChance(p.stats.str) : 0,
    dps: weaponDps(wpn?.weapon, p.attackPower),
    gear,
    buffs,
  });
}
