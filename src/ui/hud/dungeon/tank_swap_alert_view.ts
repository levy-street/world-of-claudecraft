// The Smith's Heart's tank swap alert: the pure, DOM-free view core of the one
// small cue every swap of the raid shares (the Hammer Council's Hammer's
// Weight, the Breath's Wind-Battered and Thunder-Laden, the Heat's Cinder
// Grip, the Quench's Rime-Tempered, the Masterless Strength's Elemental
// Strike; which debuff and at how many stacks is the sim's data,
// encounters/smith_heart/tank_swap_ids.ts). Jose's rule of 2026-11-24: the one
// on-screen warning the raid keeps, for the tanks only, and calm.
//
//  - Swap: the local player carries a swap debuff at its count AND its boss
//    still has them as its target (being the boss's target is what "tanking"
//    means here; the debuffs only ever land on the boss's tank, so no role is
//    asked). The title the stacks, the thin bar the debuff's time left.
//  - Taunt: the local player is a TANK by spec role (the role the party and
//    raid frames show, resolved by both hosts through sim/party_frame_info.ts
//    partyFrameRole: form-aware), carries fewer than the count of that
//    family, and a party member carries it at the count while its boss is
//    still on them. One word, no bar.
//  - Hidden otherwise: below the count, for every non-tank, once the swap
//    happened (the boss turned to the other tank), and while dead.
// An ACTION prompt: the hints setting never hides it, every graphics tier
// paints it. The painter is the shared encounter alert's.

import type { Role } from '../../../sim/content/talents';
import {
  HEART_TANK_SWAPS,
  type HeartTankSwap,
  heartTankSwapAt,
} from '../../../sim/encounters/smith_heart/tank_swap_ids';
import { formatNumber, t } from '../../i18n';
import type { EncounterAlertHidden, EncounterAlertLive } from './encounter_alert_view';

export type TankSwapAlertKind = 'swap' | 'taunt';

/** Every kind class the painter toggles (the CSS keys on them). */
export const TANK_SWAP_ALERT_KINDS: readonly TankSwapAlertKind[] = ['swap', 'taunt'];

export type TankSwapAlertLive = Omit<EncounterAlertLive, 'kind'> & { kind: TankSwapAlertKind };
export type TankSwapAlertView = TankSwapAlertLive | EncounterAlertHidden;

const HIDDEN: EncounterAlertHidden = { visible: false };

export interface TankSwapAura {
  id: string;
  remaining?: number;
  duration?: number;
  stacks?: number;
  value3?: number;
  sourceId?: number;
}

export interface TankSwapBody {
  id: number;
  dead?: boolean;
  auras: readonly TankSwapAura[];
  /** A mob's current target (its tank). */
  aggroTargetId?: number | null;
}

export interface TankSwapAlertInput {
  self: TankSwapBody;
  /** The party or raid roster (the local player's own row included, which
   *  carries their spec role); null or empty when not grouped. */
  party: readonly { pid: number; role?: Role }[] | null | undefined;
  entity: (id: number) => TankSwapBody | undefined;
}

/** Each swap debuff id to its family (built once). */
const SWAP_BY_AURA: ReadonlyMap<string, HeartTankSwap> = new Map(
  HEART_TANK_SWAPS.flatMap((s) => s.auras.map((id) => [id, s] as const)),
);

/** A swap aura's stacks: the wire omits a single stack, so present means 1. */
const stacksOf = (a: TankSwapAura) => Math.max(1, Math.round(a.stacks ?? 1));

/** Does the aura's boss still have `bodyId` as its target? An unseen source
 *  (out of the mirror's range, or none recorded) counts as yes. */
function stillTanking(
  a: TankSwapAura,
  bodyId: number,
  entity: TankSwapAlertInput['entity'],
): boolean {
  if (a.sourceId === undefined) return true;
  const boss = entity(a.sourceId);
  if (!boss || boss.dead) return true;
  const target = boss.aggroTargetId ?? null;
  return target === null || target === bodyId;
}

/** The swap aura on `body` due at its count, its boss still on `body`. */
function dueOn(
  body: TankSwapBody,
  entity: TankSwapAlertInput['entity'],
): { aura: TankSwapAura; swap: HeartTankSwap; stacks: number } | null {
  for (const a of body.auras) {
    const swap = SWAP_BY_AURA.get(a.id);
    if (!swap) continue;
    const stacks = stacksOf(a);
    if (stacks < heartTankSwapAt(swap, a.value3)) continue;
    if (!stillTanking(a, body.id, entity)) continue;
    return { aura: a, swap, stacks };
  }
  return null;
}

/** `body`'s stacks of the swap family (its four Elemental Strikes are one). */
function familyStacks(body: TankSwapBody, swap: HeartTankSwap): number {
  let n = 0;
  for (const a of body.auras) if (SWAP_BY_AURA.get(a.id) === swap) n = Math.max(n, stacksOf(a));
  return n;
}

const whole = (v: number) => formatNumber(Math.max(0, Math.ceil(v)), { maximumFractionDigits: 0 });

export function buildTankSwapAlertView(input: TankSwapAlertInput): TankSwapAlertView {
  const self = input.self;
  if (self.dead) return HIDDEN;
  const mine = dueOn(self, input.entity);
  if (mine) {
    const left = Math.max(0, mine.aura.remaining ?? 0);
    const total = Math.max(1e-6, mine.aura.duration ?? left);
    const seconds = whole(left);
    const title = t('hudChrome.tankSwap.swapTitle', {
      stacks: formatNumber(mine.stacks, { maximumFractionDigits: 0 }),
    });
    return {
      visible: true,
      kind: 'swap',
      title,
      line: '',
      hint: '',
      key: '',
      progress: total > 1e-6 ? Math.max(0, Math.min(1, left / total)) : 0,
      progressAria: t('hudChrome.tankSwap.timeAria', { seconds }),
      barLabel: '',
      pressable: false,
      buttonAria: title,
    };
  }
  const party = input.party;
  if (!party || party.length < 2) return HIDDEN;
  let tank = false;
  for (const m of party) if (m.pid === self.id) tank = m.role === 'tank';
  if (!tank) return HIDDEN;
  for (const m of party) {
    if (m.pid === self.id) continue;
    const body = input.entity(m.pid);
    if (!body || body.dead) continue;
    const due = dueOn(body, input.entity);
    if (!due) continue;
    if (familyStacks(self, due.swap) >= heartTankSwapAt(due.swap, due.aura.value3)) continue;
    const title = t('hudChrome.tankSwap.tauntTitle');
    return {
      visible: true,
      kind: 'taunt',
      title,
      line: '',
      hint: '',
      key: '',
      progress: null,
      progressAria: '',
      barLabel: '',
      pressable: false,
      buttonAria: title,
    };
  }
  return HIDDEN;
}
