// The contiguous profession SELF-mirror application block ClientWorld runs per
// snapshot: commission orders, enchanting-action result mirrors, gathering
// proficiency, tool effect slots, harvest preference, the gathering goal,
// farm plots, professionsState, and crafting identity. Kept ClientWorld-free
// so the delta contract (every key delta-omitted; a missing key retains the
// prior mirror) can be read and tested in one place, following the
// bank_snapshot_wire.ts precedent.

import type { HarvestPreference } from '../sim/professions/harvest_preference';
import type {
  CraftingIdentityView,
  FarmPlotView,
  PlayerProfessionsView,
  ToolEffectSlotView,
} from '../world_api';
import type {
  ApplyEnchantResultView,
  CommissionOrderView,
  DisenchantResultView,
  GatheringGoalView,
  SalvageResultView,
} from '../world_api/professions';
import { decodeCraftingIdentity } from './crafting_wire';
import { decodeGatheringGoalWire } from './gathering_goal_wire';
import { decodeHarvestPreferenceWire } from './harvest_preference_wire';

/** The profession self-mirror fields ClientWorld keeps; the concrete
 *  ClientWorld satisfies this structurally. */
export interface ProfessionsSelfMirrors {
  commissionOrders: readonly CommissionOrderView[];
  lastDisenchantResult: DisenchantResultView | null;
  lastEnchantResult: ApplyEnchantResultView | null;
  lastSalvageResult: SalvageResultView | null;
  gatheringProficiency: Record<string, number>;
  toolEffectSlots: readonly ToolEffectSlotView[];
  harvestPreference: HarvestPreference | null;
  gatheringGoal: GatheringGoalView | null;
  myFarmPlots: readonly FarmPlotView[];
  professionsState: PlayerProfessionsView;
  craftSkills: Record<string, number>;
  craftingIdentity: CraftingIdentityView;
}

/** Apply the profession self-mirror keys from one snapshot self record, in
 *  the same order ClientWorld previously applied them inline. Every key here
 *  is delta-omitted: an omitted key means UNCHANGED and must retain the prior
 *  mirror, never default to empty. */
export function applyProfessionsSelfMirror(
  target: ProfessionsSelfMirrors,
  s: {
    corder?: readonly CommissionOrderView[] | null;
    denc?: DisenchantResultView | null;
    ench?: ApplyEnchantResultView | null;
    salv?: SalvageResultView | null;
    gprof?: Record<string, number> | null;
    tslot?: readonly ToolEffectSlotView[] | null;
    hpref?: unknown;
    ggoal?: unknown;
    fplot?: readonly FarmPlotView[] | null;
    prof?: PlayerProfessionsView | null;
    cprof?: CraftingIdentityView | null;
  },
): void {
  // Commission order board (issue #1298): server-gated on the board
  // revision at the corder wire cadence (a passive party converges within
  // one cadence window; the viewer's own commands re-arm for the next
  // snapshot), and this is how BOTH sides of an accept/deliver converge
  // (not the commissionOrderResult event, which is deny-toast only).
  if (s.corder !== undefined) target.commissionOrders = s.corder ?? [];
  // Enchanting-action outcome mirrors (Professions 2.0): the convergence arm
  // for lastDisenchantResult/lastEnchantResult/lastSalvageResult (the event
  // mirror is the immediacy arm; both feed the same field). Server-diffed
  // per tick, so two identical consecutive deny results produce no delta
  // change, which is exactly why the event arm also exists.
  if (s.denc !== undefined) target.lastDisenchantResult = s.denc ?? null;
  if (s.ench !== undefined) target.lastEnchantResult = s.ench ?? null;
  if (s.salv !== undefined) target.lastSalvageResult = s.salv ?? null;
  if (s.gprof !== undefined) target.gatheringProficiency = s.gprof ?? {};
  if (s.tslot !== undefined) target.toolEffectSlots = s.tslot ?? [];
  // hpref: delta-omitted; present decodes via the shared wire leaf, which
  // refuses a malformed value to null rather than reviving All.
  if (s.hpref !== undefined) target.harvestPreference = decodeHarvestPreferenceWire(s.hpref);
  // ggoal (Intentional Gathering PR4): delta-omitted; present decodes via
  // the shared strict wire leaf, which refuses a malformed frame to null
  // rather than rendering a partial or stale projection.
  if (s.ggoal !== undefined) target.gatheringGoal = decodeGatheringGoalWire(s.ggoal);
  if (s.fplot !== undefined) target.myFarmPlots = s.fplot ?? [];
  if (s.prof !== undefined) target.professionsState = s.prof ?? { skills: [] };
  if (s.cprof !== undefined && s.cprof) {
    const decoded = decodeCraftingIdentity(s.cprof);
    target.craftSkills = decoded.craftSkills;
    target.craftingIdentity = decoded.identity;
  }
}
