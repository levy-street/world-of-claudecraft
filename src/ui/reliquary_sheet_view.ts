// Pure, host-agnostic model + HTML for the character-sheet Reliquary lines
// (labeled completion pair + Curator rank). DOM-free so Node tests can pin
// the numbers and chrome keys without a painter. Account weapon skins never
// invent character rank or sheet totals (catalogCharacterCompletion).

import { type AccountEarner, accountDeedLookup, accountRelicLookup } from '../sim/account_ledger';
import {
  catalogCharacterCompletion,
  curatorRankFromOwned,
  type OwnedIdLookup,
} from '../sim/reliquary';
import { esc } from './esc';
import { formatNumber, t } from './i18n';
import { curatorRankNameKey } from './reliquary_view';

/** Surfaces the character sheet needs to recompute the Reliquary pair. The two
 *  account-ledger halves are optional so a host or test with no ledger reads
 *  exactly as the per-character sheet did; with them the pair is ACCOUNT-wide,
 *  the same union the Reliquary window and the inspect card show. */
export interface ReliquarySheetWorld {
  deedStats: { itemsDiscovered: OwnedIdLookup };
  reliquaryMarks: OwnedIdLookup;
  ownedMounts(): readonly string[];
  deedsEarned: OwnedIdLookup;
  reliquaryAccountFinds?: ReadonlyMap<string, readonly AccountEarner[]>;
  accountDeeds?: ReadonlyMap<string, readonly AccountEarner[]>;
}

const NO_ENTRIES: ReadonlyMap<string, readonly AccountEarner[]> = new Map();

export interface ReliquarySheetModel {
  owned: number;
  total: number;
  curatorRank: number;
}

/** Pure character-scoped completion + rank for the paperdoll progression block. */
export function buildReliquarySheetModel(world: ReliquarySheetWorld): ReliquarySheetModel {
  const ledger = {
    relics: world.reliquaryAccountFinds ?? NO_ENTRIES,
    deeds: world.accountDeeds ?? NO_ENTRIES,
  };
  const opts = {
    itemsDiscovered: accountRelicLookup(world.deedStats.itemsDiscovered, ledger, 'item'),
    marks: accountRelicLookup(world.reliquaryMarks, ledger, 'mark'),
    ownedMounts: accountRelicLookup(new Set(world.ownedMounts()), ledger, 'mount'),
    deedsEarned: accountDeedLookup(world.deedsEarned, ledger),
  };
  const completion = catalogCharacterCompletion(opts);
  return {
    owned: completion.owned,
    total: completion.total,
    curatorRank: curatorRankFromOwned(completion.owned),
  };
}

/**
 * The viewer's OWN live Curator standing, in the shape the inspect card takes.
 *
 * Lives here rather than on Hud because it needs nothing of Hud's: only the
 * world seam this module already defines, and the same model the character
 * sheet's Reliquary line is built from, which is what stops the card and the
 * sheet ever printing different numbers for the same player. Hud composes it at
 * its one call site (Hud.openInspect, gated on the inspected pid being the
 * viewer's).
 */
export function selfCuratorStanding(world: ReliquarySheetWorld): {
  curatorRank: number;
  owned: number;
  total: number;
} {
  const model = buildReliquarySheetModel(world);
  return { curatorRank: model.curatorRank, owned: model.owned, total: model.total };
}

/**
 * Progression-block HTML for The Reliquary: completion pair, named Curator
 * rank (or unranked), and a button that opens the Reliquary window. Pure over
 * the model + t(); the painter only injects the result and wires the click.
 */
export function reliquarySheetProgressionHtml(model: ReliquarySheetModel): string {
  const owned = formatNumber(model.owned, { maximumFractionDigits: 0 });
  const total = formatNumber(model.total, { maximumFractionDigits: 0 });
  const pair = t('hudChrome.reliquary.charCompletion', { owned, total });
  const rankLabel =
    model.curatorRank > 0
      ? t(curatorRankNameKey(model.curatorRank), {
          rank: formatNumber(model.curatorRank, { maximumFractionDigits: 0 }),
        })
      : t('hudChrome.reliquary.curatorUnranked');
  return (
    `<div class="cp-milestones cp-reliquary">` +
    `<span class="cp-ms-label">${esc(t('hudChrome.reliquary.charCompletionLabel'))}:</span> ` +
    `<b class="cp-reliquary-count">${esc(pair)}</b> ` +
    `<span class="cp-ms-label">${esc(t('hudChrome.reliquary.charRankLabel'))}:</span> ` +
    `<b class="cp-reliquary-rank" data-rank="${model.curatorRank}">${esc(rankLabel)}</b> ` +
    `<button type="button" class="btn cp-deeds-btn" data-act="open-reliquary">${esc(
      t('hudChrome.reliquary.charOpen'),
    )}</button>` +
    `</div>`
  );
}
