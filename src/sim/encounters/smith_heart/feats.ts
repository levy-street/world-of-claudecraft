// The Smith's Heart's encounter feats (content/smith_heart_rewards.ts, the Book of Deeds
// records in content/deeds.ts): one skill task a boss, judged at its fall from what the pull
// watched (feat_attempt.ts on the fight state) and granted to every player in the claim (the
// encounter-task roster: a healer or a tank who left no damage trace is credited, docs/design/
// deeds.md rule 6). Every rule fails only through the raid's own play, never a roll, and each
// asks that its proving mechanic really happened, so a bare dev kill after the pull earns
// nothing. (A dev run that FORCES the proving mechanic, `/dev heart breath phase2` and the
// like, then kills the boss does earn it: that is a dev-only path, kept on purpose so the
// grant can be tested through the real fall; `/dev heart feat` is the direct one.) Any
// difficulty counts. Draws no rng.
//
//   The Hammer Council   every Mountain's Rush that lands shatters the cursed pillar
//                        (council.ts marks each landing), at least one.
//   The Breath           no raider falls into the void in the fight (breath.ts, from the
//                        void's own deaths), and the storm broke (the second half).
//   The Quench           no raider Encased in Rime (quench_cold.ts freezePlayer, every
//                        freeze's one door), and the second half began.
//   The Heat             no Rolling Cinder reaches its quarry (heat_cinders.ts), and at
//                        least one was called.
//   The Masterless       no Overload bar burst (the fight's own `bursts`), and both
//   Strength             intermissions were fought.

import { SMITH_HEART_FEAT_DEEDS } from '../../content/smith_heart_rewards';
import type { SmithsHeartEncounter } from '../../content/weapon_skins';
import { instanceClaimContains } from '../../instances/dungeons';
import type { InstanceSlot, PlayerMeta } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { BreathFightState } from './breath_state';
import type { CouncilFightState } from './council_state';
import type { SmithHeartFeatAttempt } from './feat_attempt';
import type { FinalFightState } from './final_state';
import type { HeatFightState } from './heat_state';
import type { QuenchFightState } from './quench_state';

/** The fight state each encounter's rule reads at the fall. */
export type SmithHeartFeatFight =
  | { encounter: 'hammer_council'; st: CouncilFightState }
  | { encounter: 'breath'; st: BreathFightState }
  | { encounter: 'quench'; st: QuenchFightState }
  | { encounter: 'heat'; st: HeatFightState }
  | { encounter: 'masterless'; st: FinalFightState };

function clean(feat: SmithHeartFeatAttempt | undefined): boolean {
  return !feat?.broken;
}

/** PURE: did this pull meet its encounter's feat? */
export function smithHeartFeatMet(fight: SmithHeartFeatFight): boolean {
  switch (fight.encounter) {
    case 'hammer_council':
      return clean(fight.st.feat) && (fight.st.feat?.count ?? 0) >= 1;
    case 'breath':
      return clean(fight.st.feat) && fight.st.half !== 'wind';
    case 'quench':
      return clean(fight.st.feat) && fight.st.half !== 'lake';
    case 'heat':
      return clean(fight.st.feat) && fight.st.cindersCalled >= 1;
    case 'masterless':
      return fight.st.bursts === 0 && fight.st.phase.intermissions >= 2;
  }
}

/** Every player inside the claim's footprint, dead or alive (the encounter-task roster),
 *  by the instance system's own claim test (instances/dungeons.ts instanceClaimContains). */
export function smithHeartClaimPlayers(ctx: SimContext, inst: InstanceSlot): PlayerMeta[] {
  const out: PlayerMeta[] = [];
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (e && instanceClaimContains(inst, e.pos)) out.push(meta);
  }
  return out;
}

/** The boss has fallen: grant its feat to the claim's players when the pull met it.
 *  Returns how many were granted it (an earlier earner is skipped by grantDeed). */
export function settleSmithHeartFeat(
  ctx: SimContext,
  inst: InstanceSlot,
  fight: SmithHeartFeatFight,
): number {
  if (!smithHeartFeatMet(fight)) return 0;
  const deedId = SMITH_HEART_FEAT_DEEDS[fight.encounter satisfies SmithsHeartEncounter];
  let granted = 0;
  for (const meta of smithHeartClaimPlayers(ctx, inst)) {
    if (ctx.grantDeed(meta, deedId)) granted++;
  }
  return granted;
}
