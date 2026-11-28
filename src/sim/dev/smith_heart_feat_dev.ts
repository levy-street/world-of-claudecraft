// /dev heart feat <council|breath|quench|heat|final|all> grant|reset: the Smith's Heart's
// encounter feats on demand, so their rewards can be checked without the fights
// (ALLOW_DEV_COMMANDS only, routed by smith_heart_dev.ts behind the ctx.devCommands gate).
//
//   grant  each named feat through the one grant path (grantDeed), so the toast, the Book
//          and the reward follow exactly as a real kill would; the meta follows on the
//          evaluator's next pass once all five are held.
//   reset  takes the named feats (and the meta with any of them) off the character, its
//          Renown and its account-ledger entry, the offline mirror's appearances, and the
//          charger's reins from the bags, for this session. Online the account's appearance
//          row and the character_deeds rows are insert-only and stay, so the deeds come back
//          at the next login; earning the feat again simply re-confirms it.
//
// Dev text stays English (the dev channel).

import { forgetAccountDeedEarner } from '../account_ledger';
import { SMITHS_HEART_META_MOUNT } from '../content/mounts';
import {
  SMITH_HEART_FEAT_DEEDS,
  SMITH_HEART_FEAT_ORDER,
  SMITH_HEART_META_DEED,
} from '../content/smith_heart_rewards';
import { SMITHS_HEART_WEAPON_SKINS, type SmithsHeartEncounter } from '../content/weapon_skins';
import { recomputeRenown, setActiveTitle } from '../deeds';
import { mountItemId } from '../mounts';
import type { SimContext } from '../sim_context';

const FEAT_ALIASES: Readonly<Record<string, SmithsHeartEncounter>> = {
  council: 'hammer_council',
  hammer: 'hammer_council',
  breath: 'breath',
  quench: 'quench',
  heat: 'heat',
  final: 'masterless',
  masterless: 'masterless',
};

export const SMITH_HEART_FEAT_DEV_USAGE =
  '[dev] /dev heart feat <council|breath|quench|heat|final|all> <grant|reset>';

function log(ctx: SimContext, pid: number, text: string): void {
  ctx.emit({ type: 'log', text, pid });
}

/** The encounters `what` names, or null. */
export function smithHeartFeatTargets(what: string): readonly SmithsHeartEncounter[] | null {
  if (what === 'all') return SMITH_HEART_FEAT_ORDER;
  const one = Object.hasOwn(FEAT_ALIASES, what) ? FEAT_ALIASES[what] : undefined;
  return one ? [one] : null;
}

/** `/dev heart feat ...` with `arg` the text after `feat`. Always handles the line. */
export function smithHeartFeatDev(ctx: SimContext, arg: string, pid: number): void {
  const [what = '', action = ''] = arg.trim().toLowerCase().split(/\s+/);
  const targets = smithHeartFeatTargets(what);
  const meta = ctx.players.get(pid);
  if (!targets || (action !== 'grant' && action !== 'reset') || !meta) {
    ctx.error(pid, SMITH_HEART_FEAT_DEV_USAGE);
    return;
  }
  if (action === 'grant') {
    let n = 0;
    for (const e of targets) if (ctx.grantDeed(meta, SMITH_HEART_FEAT_DEEDS[e])) n++;
    log(ctx, pid, `[dev] Granted ${n} Smith's Heart feat${n === 1 ? '' : 's'} (${what}).`);
    return;
  }
  const ids = targets.map((e) => SMITH_HEART_FEAT_DEEDS[e]);
  ids.push(SMITH_HEART_META_DEED);
  const characterId = meta.characterId ?? 0;
  let n = 0;
  for (const id of ids) {
    if (meta.deedsEarned.delete(id)) n++;
    forgetAccountDeedEarner(meta.accountLedger, id, characterId);
  }
  const skins = new Set(targets.map((e) => SMITHS_HEART_WEAPON_SKINS[e]));
  ctx.accountCosmetics = {
    ...ctx.accountCosmetics,
    weaponSkinIds: ctx.accountCosmetics.weaponSkinIds.filter((id) => !skins.has(id)),
  };
  const reins = mountItemId(SMITHS_HEART_META_MOUNT);
  const held = reins ? ctx.countItem(reins, pid) : 0;
  if (reins && held > 0) ctx.removeItem(reins, held, pid);
  const e = ctx.entities.get(pid);
  if (e && meta.activeTitle !== null && ids.includes(meta.activeTitle))
    setActiveTitle(meta, e, null);
  recomputeRenown(meta);
  ctx.markDeedsDirty(pid);
  meta.wireRev++;
  log(
    ctx,
    pid,
    `[dev] Reset ${n} Smith's Heart deed${n === 1 ? '' : 's'} (${what}); appearances cleared from this session, reins taken back.`,
  );
}
