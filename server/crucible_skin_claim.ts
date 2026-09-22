// 'claim_crucible_skin': the Inner Crucible raid-reward skin claim, extracted
// from GameServer behind a narrow structural seam (the account_cosmetics_service
// precedent). The shared verdict (src/sim/crucible_skin_claim.ts) decides, so a
// client can never claim on its own word; the entitlement rides the same
// account-wide full-body-skin list the Founder Pack uses.
import { crucibleSkinDef } from '../src/sim/content/crucible_skins';
import { crucibleClaimVerdict } from '../src/sim/crucible_skin_claim';
import type { PlayerMeta } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { AccountCosmetics } from '../src/world_api';
import { grantAccountFounderSkin } from './db';

export interface CrucibleClaimDeps {
  sim: {
    meta(pid: number): PlayerMeta | null | undefined;
    ctx: Pick<SimContext, 'markItemDiscovered'>;
  };
  pid: number;
  session: { accountId: number; accountCosmetics: AccountCosmetics };
  cosmetics: { updateLive(accountId: number, cosmetics: AccountCosmetics): void };
  outcome(ok: boolean): void;
}

export function handleClaimCrucibleSkin(deps: CrucibleClaimDeps, catalogArg: unknown): void {
  const catalog = typeof catalogArg === 'string' ? catalogArg : null;
  const def = catalog ? crucibleSkinDef(catalog) : null;
  const meta = deps.sim.meta(deps.pid);
  const { session } = deps;
  if (
    !catalog ||
    !def ||
    !meta ||
    !session.accountId ||
    crucibleClaimVerdict(meta, catalog, session.accountCosmetics.founderSkinIds ?? []) !== 'ok'
  ) {
    deps.outcome(false);
    return;
  }
  void (async () => {
    const updated = await grantAccountFounderSkin(session.accountId, catalog);
    session.accountCosmetics = updated;
    deps.cosmetics.updateLive(session.accountId, updated);
    deps.sim.ctx.markItemDiscovered(meta, def.itemId);
    deps.outcome(true);
  })();
}
