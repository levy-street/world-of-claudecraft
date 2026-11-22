// The add-only mode of the choose-one leveling gear generator
// (scripts/quest_leveling_gear_gen.ts, its default). Every quest that already has
// a committed row in content/quest_choice_rewards.ts keeps it byte for byte; only
// an eligible quest with no row gets one, picked from the items the generator
// already owns (content/quest_leveling_gear.ts), so no shipped item is repriced
// and no new item id is minted:
//   - a green quest takes its level band's six pieces of one slot: a slot no other
//     quest of the same giver offers yet (so one chain does not hand out four pairs
//     of boots), then the slot the fewest quests offer, ties in SLOTS order;
//   - a blue quest (an elite or boss kill, or an authored blue: rewardQuality)
//     takes an existing rare set covering every role its authored blue leaves
//     unserved, of the lowest source level at or above the quest's own, then by
//     the same giver-slot and fewest-offers preference, ties in BLUE_THEMES then
//     SLOTS order.
// A reused piece must already source at the quest's level or above: item_level.ts
// prices an item at the highest source that offers it, so an offer at or below it
// leaves every baked stat line exactly where it is.
//
// Side-effect free: planAddOnly reads the content tables, spliceChoiceEntries is a
// pure text transform; the generator does the one file write.

import { QUEST_LEVELING_GEAR_ITEMS } from '../src/sim/content/quest_leveling_gear';
import { QUESTS } from '../src/sim/data';
import { itemSourceLevel } from '../src/sim/item_level';
import type { ItemDef } from '../src/sim/types';
import {
  BLUE_THEMES,
  bandFor,
  eligibleQuests,
  itemId,
  missingRoles,
  REUSED_RARE_CHOICES,
  ROLES,
  type Role,
  rewardQuality,
  SLOTS,
  sourceLevel,
} from './quest_leveling_gear_rules';

export interface AddedChoice {
  questId: string;
  quality: 'rare' | 'uncommon';
  ids: string[];
  /** The set the row was drawn from, e.g. `Highgale chest` or `Hoarfrost shoulder`. */
  from: string;
}

/** A candidate rare set: one theme's pieces of one slot for the roles a quest needs. */
export interface RareSetCandidate {
  ids: string[];
  /** The lowest source level among its pieces (item_level.ts itemSourceLevel). */
  level: number;
  /** Authored order: BLUE_THEMES order, then SLOTS order. */
  order: number;
  from: string;
}

/** The rare set a blue quest reuses: the lowest source level at or above the quest's
 *  (so the quest reprices nothing), then the least `crowding` (lower is better: how
 *  many quests offer the set already), then the authored order. Undefined when no
 *  candidate sources high enough. */
export function pickRareSet(
  candidates: readonly RareSetCandidate[],
  questLevel: number | undefined,
  crowding: (ids: readonly string[]) => number,
): RareSetCandidate | undefined {
  const fit = candidates.filter((c) => questLevel === undefined || c.level >= questLevel);
  return [...fit].sort(
    (a, b) => a.level - b.level || crowding(a.ids) - crowding(b.ids) || a.order - b.order,
  )[0];
}

// How many rows offer any of `ids`.
function offerCounter(rows: Map<string, readonly string[]>) {
  return (ids: readonly string[]) => {
    const want = new Set(ids);
    let n = 0;
    for (const row of rows.values()) if (row.some((id) => want.has(id))) n++;
    return n;
  };
}

const sourcesAtOrAbove = (ids: readonly string[], level: number | undefined) =>
  level === undefined || ids.every((id) => (itemSourceLevel(id) ?? -1) >= level);

/** Plans the rows for every eligible quest missing from `committed`, in the
 *  generator's quest order. Throws when a quest cannot be served from the items the
 *  generator already owns (minting new items needs art and i18n: use --reroll). */
export function planAddOnly(
  committed: Readonly<Record<string, readonly string[]>>,
  gear: Readonly<Record<string, ItemDef>> = QUEST_LEVELING_GEAR_ITEMS,
): AddedChoice[] {
  const rows = new Map<string, readonly string[]>(Object.entries(committed));
  const offers = offerCounter(rows);
  const slotOf = (ids: readonly string[]) => gear[ids[0]]?.slot;
  // The slots the quest's giver already hands out, then how often the set is offered.
  const crowdingFor = (giver: string) => {
    const taken = new Set<string | undefined>();
    for (const [questId, row] of rows) {
      if (QUESTS[questId]?.giverNpcId === giver) taken.add(slotOf(row));
    }
    return (ids: readonly string[]) => (taken.has(slotOf(ids)) ? 1e6 : 0) + offers(ids);
  };
  const owned = (ids: readonly string[], quality: ItemDef['quality']) =>
    ids.every((id) => gear[id]?.quality === quality);
  const added: AddedChoice[] = [];
  for (const { q, level } of eligibleQuests()) {
    if (rows.has(q.id)) continue;
    const src = sourceLevel(q);
    const crowding = crowdingFor(q.giverNpcId);
    let choice: AddedChoice;
    const reused = REUSED_RARE_CHOICES[q.id];
    if (reused) {
      choice = { questId: q.id, quality: 'rare', ids: [...reused], from: 'REUSED_RARE_CHOICES' };
    } else if (rewardQuality(q) === 'rare') {
      const roles: Role[] = missingRoles(q);
      const candidates: RareSetCandidate[] = [];
      Object.values(BLUE_THEMES).forEach((theme, t) => {
        SLOTS.forEach((slot, s) => {
          const ids = roles.map((role) => itemId(theme, role, slot));
          if (!owned(ids, 'rare')) return;
          const lvl = Math.min(...ids.map((id) => itemSourceLevel(id) ?? -1));
          candidates.push({
            ids,
            level: lvl,
            order: t * SLOTS.length + s,
            from: `${theme.theme} ${slot}`,
          });
        });
      });
      const pick = pickRareSet(candidates, src, crowding);
      if (!pick) {
        throw new Error(
          `${q.id} rates rare choices (elite, boss or authored blue) but no existing rare set ` +
            `covers its roles at source level ${src} or above; minting new rares needs a ` +
            'BLUE_THEMES entry, committed icon art and i18n names (run with --reroll)',
        );
      }
      choice = { questId: q.id, quality: 'rare', ids: pick.ids, from: pick.from };
    } else {
      const band = bandFor(level);
      const slots = SLOTS.map((slot, s) => ({
        slot,
        s,
        ids: ROLES.map((role) => itemId(band, role, slot)),
      }))
        .filter((c) => owned(c.ids, 'uncommon') && sourcesAtOrAbove(c.ids, src))
        .sort((a, b) => crowding(a.ids) - crowding(b.ids) || a.s - b.s);
      if (!slots[0]) {
        throw new Error(
          `${q.id}: no ${band.theme} slot sources at level ${src} or above; offering one ` +
            'would reprice shipped pieces (run with --reroll)',
        );
      }
      choice = {
        questId: q.id,
        quality: 'uncommon',
        ids: slots[0].ids,
        from: `${band.theme} ${slots[0].slot}`,
      };
    }
    rows.set(q.id, choice.ids);
    added.push(choice);
  }
  return added;
}

const keyToken = (questId: string) =>
  /^[a-z_][a-z0-9_]*$/.test(questId) ? questId : `'${questId}'`;

/** One QUEST_CHOICE_REWARDS row as Biome formats it (lineWidth 100). */
export function renderChoiceEntry(questId: string, ids: readonly string[]): string {
  const key = keyToken(questId);
  const one = `  ${key}: [${ids.map((id) => `'${id}'`).join(', ')}],`;
  if (one.length <= 100) return `${one}\n`;
  return `  ${key}: [\n${ids.map((id) => `    '${id}',\n`).join('')}  ],\n`;
}

const ROW_KEY = /^ {2}('?)([A-Za-z0-9_]+)\1: \[/;

/** Inserts `added` rows into the committed quest_choice_rewards.ts text, each at its
 *  sorted position (the generator's localeCompare order), leaving every other byte
 *  of the file untouched. Throws on a row that already exists. */
export function spliceChoiceEntries(
  text: string,
  added: readonly { questId: string; ids: readonly string[] }[],
): string {
  const lines = text.split('\n');
  const close = lines.lastIndexOf('};');
  if (close < 0) throw new Error('quest_choice_rewards.ts: no closing `};` line');
  const rowStarts: { key: string; line: number }[] = [];
  lines.forEach((line, i) => {
    const m = ROW_KEY.exec(line);
    if (m && i < close) rowStarts.push({ key: m[2], line: i });
  });
  const inserts = new Map<number, { key: string; block: string }[]>();
  for (const a of added) {
    if (rowStarts.some((r) => r.key === a.questId)) {
      throw new Error(`${a.questId} already has a committed row`);
    }
    const before = rowStarts.find((r) => r.key.localeCompare(a.questId) > 0)?.line ?? close;
    const list = inserts.get(before) ?? [];
    list.push({ key: a.questId, block: renderChoiceEntry(a.questId, a.ids) });
    inserts.set(before, list);
  }
  const out: string[] = [];
  lines.forEach((line, i) => {
    for (const { block } of (inserts.get(i) ?? []).sort((x, y) => x.key.localeCompare(y.key))) {
      out.push(...block.slice(0, -1).split('\n'));
    }
    out.push(line);
  });
  return out.join('\n');
}
