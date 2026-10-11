// The auras the Cooldown Manager can track beside spells: class ENGINES (Old
// Blood, Soul Fragments, Ruin, Icicles...), PROCS (Hot Streak, Sudden Death, a
// talent's proc) and the BUFFS a class's own spells put on the player. A tracked
// aura is a button that lights while the aura is on you, shows its stacks and
// time left, and can chime when it comes up or fills.
//
// Three sources, merged per class (every spec, talent and level, like the spell
// catalog), then topped up at runtime by what the player has actually carried
// (cooldown_manager_controller records helpful auras seen on the player):
//   - ENGINE_AURAS: the class engines. Their auras are minted by sim modules,
//     not declarative content, so no derivation can see them: this is the one
//     hand table, and tests/cooldown_manager_auras.test.ts pins every row's
//     kind AND English name against the sim source, so a rename fails loudly.
//   - Procs: the Auras panel's curated proc defs for every class ability, and
//     every talent-row proc that lands an aura (all options, not the chosen one).
//   - Buffs: every self-applied aura the class's spells author, from the aura
//     track catalog (derived from ABILITIES).
//
// Tokens stored in a group: `aura:<id>` matches a live aura by id, `kind:<kind>`
// by kind (engines: one kind, one bank). Names resolve at paint time through the
// same localization the buff bar uses; nothing here is player text.
//
// Pure: content reads only, no DOM or storage.

import type { ChoiceRowOption } from '../../../sim/content/choice_rows';
import { CHOICE_ROWS } from '../../../sim/content/choice_rows';
import type { PlayerClass } from '../../../sim/types';
import { availableAuraProcDefs, talentAuraKind } from '../../aura_overlay_view';
import type { TranslationKey } from '../../i18n.catalog';
import { AURA_TRACK_CATALOG } from '../aura_tracks/aura_track_catalog';
import { cooldownClassAbilityIds } from './cooldown_manager_catalog';

export const AURA_TOKEN_PREFIX = 'aura:';
export const KIND_TOKEN_PREFIX = 'kind:';

/** How the settings panel names an aura entry. Every arm resolves through an
 *  existing localized path (ability names, talent names, catalog keys, and the
 *  sim aura-name matcher the buff bar uses). */
export type CooldownAuraLabel =
  | { type: 'ability'; id: string }
  | { type: 'talent'; choice: ChoiceRowOption }
  | { type: 'key'; key: TranslationKey }
  | { type: 'sim'; name: string };

export interface CooldownAuraEntry {
  /** The token stored in a group (`aura:<id>` or `kind:<kind>`). */
  token: string;
  match: 'id' | 'kind';
  /** The aura id (match 'id') or kind (match 'kind') a live aura must carry. */
  value: string;
  /** The aura kind, for the icon resolver (the same identity the buff bar uses). */
  kind: string;
  label: CooldownAuraLabel;
  /** Engine, proc or buff: the picker groups by it. */
  category: 'engine' | 'proc' | 'buff' | 'seen';
}

interface EngineRow {
  kind: string;
  /** The English name the sim mints the aura with (pinned by the test). */
  name: string;
}

/** The class engines: resource banks and spec states minted by sim modules. */
export const ENGINE_AURAS: Readonly<Record<PlayerClass, readonly EngineRow[]>> = {
  warrior: [],
  paladin: [],
  hunter: [
    { kind: 'hunter_ferocity', name: 'Pack Ferocity' },
    { kind: 'hunter_frenzy', name: 'Unleashed Frenzy' },
    { kind: 'hunter_momentum', name: 'Hunting Momentum' },
    { kind: 'hunter_reentry', name: 'Armed Re-entry' },
  ],
  rogue: [
    { kind: 'venom_ritual', name: 'Venom Ritual' },
    { kind: 'gloam', name: 'Gloam' },
    { kind: 'redline', name: 'Redline' },
    { kind: 'dusk_economy', name: 'Dusk Economy' },
    { kind: 'veiled_edge', name: 'Shadow Veil' },
  ],
  priest: [
    { kind: 'doctrine', name: 'Doctrine' },
    { kind: 'gloomtithe', name: 'Gloomtithe' },
  ],
  shaman: [],
  mage: [{ kind: 'icicles', name: 'Icicles' }],
  warlock: [
    { kind: 'soul_fragments', name: 'Soul Fragments' },
    { kind: 'necromancy_death_echo', name: 'Death Echo' },
    { kind: 'destruction_ruin', name: 'Ruin' },
    { kind: 'desolation', name: 'Desolation' },
  ],
  druid: [
    { kind: 'old_blood', name: 'Old Blood' },
    { kind: 'moontide', name: 'Moontide' },
    { kind: 'verdance', name: 'Verdance' },
  ],
};

/** Whether a stored token names an aura entry (rather than a spell). */
export function isCooldownAuraToken(token: string): boolean {
  return token.startsWith(AURA_TOKEN_PREFIX) || token.startsWith(KIND_TOKEN_PREFIX);
}

/** Parse a stored aura token back into its match rule, or null for a spell. */
export function parseCooldownAuraToken(
  token: string,
): { match: 'id' | 'kind'; value: string } | null {
  if (token.startsWith(AURA_TOKEN_PREFIX)) {
    return { match: 'id', value: token.slice(AURA_TOKEN_PREFIX.length) };
  }
  if (token.startsWith(KIND_TOKEN_PREFIX)) {
    return { match: 'kind', value: token.slice(KIND_TOKEN_PREFIX.length) };
  }
  return null;
}

/** The first live aura a token matches, or undefined. */
export function findCooldownAura<T extends { id?: string; kind: string }>(
  rule: { match: 'id' | 'kind'; value: string },
  auras: readonly T[],
): T | undefined {
  for (const aura of auras) {
    if (rule.match === 'id' ? aura.id === rule.value : aura.kind === rule.value) return aura;
  }
  return undefined;
}

const cache = new Map<PlayerClass, readonly CooldownAuraEntry[]>();

/** Every trackable aura of a class across all specs and talents, engines first. */
export function cooldownAuraCatalog(cls: PlayerClass): readonly CooldownAuraEntry[] {
  const cached = cache.get(cls);
  if (cached) return cached;
  const out: CooldownAuraEntry[] = [];
  const ids = new Set<string>();
  const kinds = new Set<string>();
  const addKind = (kind: string, label: CooldownAuraLabel): void => {
    if (kinds.has(kind)) return;
    kinds.add(kind);
    out.push({
      token: `${KIND_TOKEN_PREFIX}${kind}`,
      match: 'kind',
      value: kind,
      kind,
      label,
      category: 'engine',
    });
  };
  const addId = (
    id: string,
    kind: string,
    label: CooldownAuraLabel,
    category: CooldownAuraEntry['category'],
  ): void => {
    if (ids.has(id) || kinds.has(kind)) return;
    ids.add(id);
    out.push({ token: `${AURA_TOKEN_PREFIX}${id}`, match: 'id', value: id, kind, label, category });
  };

  for (const row of ENGINE_AURAS[cls] ?? []) addKind(row.kind, { type: 'sim', name: row.name });

  // Every class ability, passives included: a passive (Hot Streak) is what arms
  // its proc, so the Auras panel keys the proc off it.
  const spells = cooldownClassAbilityIds(cls);
  const known = spells.map((id) => ({ def: { id } }));
  for (const def of availableAuraProcDefs(cls, known)) {
    const label: CooldownAuraLabel = def.labelKey
      ? { type: 'key', key: def.labelKey }
      : { type: 'ability', id: def.iconAbilityId };
    addId(def.auraId ?? def.id, def.auraKind, label, 'proc');
  }
  for (const row of CHOICE_ROWS[cls]?.rows ?? []) {
    for (const choice of row.options) {
      const proc = choice.effect.proc;
      if (!proc) continue;
      const kind = proc.responses.map(talentAuraKind).find((entry) => entry !== null);
      if (kind) addId(proc.id, kind, { type: 'talent', choice }, 'proc');
    }
  }
  const spellSet = new Set(spells);
  for (const entry of AURA_TRACK_CATALOG.values()) {
    if (!spellSet.has(entry.abilityId)) continue;
    addId(entry.id, entry.kind, { type: 'ability', id: entry.abilityId }, 'buff');
  }
  cache.set(cls, out);
  return out;
}

/** A catalog entry for an aura first seen on the player at runtime. */
export function seenAuraEntry(seen: { id: string; kind: string; name: string }): CooldownAuraEntry {
  return {
    token: `${AURA_TOKEN_PREFIX}${seen.id}`,
    match: 'id',
    value: seen.id,
    kind: seen.kind,
    label: { type: 'sim', name: seen.name },
    category: 'seen',
  };
}
