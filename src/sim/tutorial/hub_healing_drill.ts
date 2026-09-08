// The hub's optional healing lesson (q_hub_healing_numbers): sim-side,
// server-authoritative credit for landing effective DIRECT heals on the hub
// healing dummy, on the model of the damage lesson's own tutorial/dummy_drill.ts
// (the meter is the lesson, not the button pressed to get there), but stricter:
// the agreed test contract is three effective direct player casts, so this
// module validates the ability itself rather than trusting every applyHeal
// application as a genuine cast.
//
// Rejected by construction:
//   - HoT ticks never reach this hook at all: combat/auras.ts applies a
//     periodic heal's hp change directly and never calls applyHeal.
//   - Beacon transfers never call applyHeal either (combat/paladin_beacon.ts's
//     applyBeaconTransfer mutates the beacon's hp and emits its own event).
//   - Chain/proc/echo/self heals and any NPC or pet heal are excluded
//     structurally: this hook is called from exactly ONE site,
//     combat/effect_dispatch.ts's PRIMARY direct-heal case, right after that
//     case's own `ctx.applyHeal` resolves and before the Power Echo repeat
//     later in the same case runs. A chained hop (chainHeal), a proc/derived
//     heal, a beacon transfer, and the Power Echo repeat itself all call
//     `applyHeal` from OTHER sites this module is never wired into, so none
//     of them can reach this hook regardless of the abilityId they pass. The
//     abilityId check below is what tells the caster's OWN class heal apart
//     from a different ability landing through this same case (e.g. Chain
//     Heal's first hop uses a different effect path, not this one).
//   - A fully overhealed or fully absorbed cast (the effective `healed`
//     argument is 0) credits nothing, and neither does a heal on any target
//     but the hub's own healing dummy, nor a non-player source.
//
// This ONLY gates quest credit: nothing here stops an ineligible class from
// freely healing the dummy outside the lesson.
//
// Zero rng (it credits a count and emits events). `src/sim`-pure: no DOM/
// render/ui/game/net imports, no Math.random/Date.now (tests/architecture.test.ts).

import {
  HUB_HEALING_DRILL_OBJECT_ITEM_ID,
  HUB_HEALING_DRILL_QUEST_ID,
  HUB_HEALING_DUMMY_ID,
} from '../content/practice_dummies';
import { QUESTS } from '../data';
import { emitQuestProgress } from '../quests/quest_credit';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { hubHealingAbilityId } from './hub_healing_lesson';

export const HEALING_DRILL_QUEST_ID = HUB_HEALING_DRILL_QUEST_ID;
export const HEALING_DRILL_OBJECT_ITEM_ID = HUB_HEALING_DRILL_OBJECT_ITEM_ID;

/** The hub's own friendly healing target, and nothing else: the Highwatch
 *  row's friendly_player_dummy is a different fixture for a different lesson. */
export function isHubHealingDummy(target: Entity): boolean {
  return target.kind === 'mob' && target.templateId === HUB_HEALING_DUMMY_ID;
}

/**
 * Credit one effective DIRECT heal. Called from exactly one site,
 * combat/effect_dispatch.ts's PRIMARY direct-heal case, right after that
 * case's own `ctx.applyHeal` call resolves (see this module's header for why
 * that placement is what keeps every derived/echoed/chained/procced heal
 * from ever reaching this hook). `abilityId` is `ctx.applyHeal`'s own
 * parameter, passed straight through so this can tell a genuine cast of the
 * caster's class heal apart from a different ability resolving through the
 * same case.
 */
export function creditHubHealingDrill(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  healed: number,
  abilityId: string | null,
): void {
  if (healed <= 0) return;
  if (!abilityId) return;
  if (!isHubHealingDummy(target)) return;
  if (source.kind !== 'player') return;
  const meta = ctx.players.get(source.id);
  if (!meta) return;
  // The SAME resolver the quest's own availability gate reads
  // (quests/quest_commands.ts requiresUsableHealAbility): only a genuine cast
  // of the caster's OWN class heal, at their current level, counts. This is
  // also the class allowlist: hubHealingAbilityId returns null outright for
  // any class outside druid/shaman/paladin/priest, so a mage (even healing
  // spec) or any other class can never credit this lesson.
  if (abilityId !== hubHealingAbilityId(meta.cls, source.level)) return;
  const qp = meta.questLog.get(HEALING_DRILL_QUEST_ID);
  if (qp?.state !== 'active') return;
  const objective = QUESTS[HEALING_DRILL_QUEST_ID]?.objectives[0];
  if (objective?.type !== 'interact') return;
  if (objective.targetObjectItemId !== HEALING_DRILL_OBJECT_ITEM_ID) return;
  const current = qp.counts[0] ?? 0;
  if (current >= objective.count) return;
  qp.counts[0] = current + 1;
  meta.counters.questProgress++;
  emitQuestProgress(ctx, meta, qp, objective, 0);
  ctx.checkQuestReady(qp, meta);
}
