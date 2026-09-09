// The corpse-harvest preference COMMAND BODY (Intentional Gathering PR3), behind
// the SimContext seam. This is a stored PLAYER SETTING, not a harvest action:
// setHarvestPreference takes no kit, location, combat or cost gate, changes only
// the resolved player's own PlayerMeta field, and draws no rng. The pure
// validation/load/save rules live in harvest_preference.ts; this module is the
// thin command shell over PlayerMeta the way materials_vault.ts's command bodies
// sit over their own state.

import type { SimContext } from '../sim_context';
import { type HarvestPreference, parseHarvestPreferenceCommand } from './harvest_preference';

/** Defensive clone: a caller mutating the returned value must never be able to
 *  reach the stored choice (the same contract resolveHarvestPreferenceOnCorpse's
 *  callers get from harvest_preference.ts). */
function cloneHarvestPreference(preference: HarvestPreference): HarvestPreference {
  return preference.kind === 'material'
    ? { kind: 'material', itemId: preference.itemId }
    : { kind: 'all' };
}

/** The resolved player's current preference, or null for an unknown pid AND for
 *  a malformed persisted preference alike (see harvest_preference.ts
 *  loadHarvestPreference: a refusal carries no active preference to act on). */
export function harvestPreferenceFor(ctx: SimContext, pid: number): HarvestPreference | null {
  const preference = ctx.players.get(pid)?.harvestPreference;
  if (!preference) return null;
  return cloneHarvestPreference(preference);
}

/**
 * Set the resolved player's harvest preference. Validated strictly through
 * parseHarvestPreferenceCommand (the same command parser the pure leaf and its
 * tests pin), so a malformed or unsupported `raw` leaves the current choice
 * byte-identical rather than falling back to All. An unknown pid (no meta) is a
 * silent no-op, matching the deeds.ts setActiveTitle/setActiveBorder precedent:
 * a stale or spoofed request never surfaces a toast, and never touches anyone
 * but the resolved player.
 */
export function setHarvestPreference(ctx: SimContext, raw: string, pid?: number): void {
  const id = pid ?? ctx.primaryId;
  const meta = ctx.players.get(id);
  if (!meta) return;
  const command = parseHarvestPreferenceCommand(raw);
  if (!command.ok) return;
  meta.harvestPreference = command.preference;
}
