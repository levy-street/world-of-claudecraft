// The Shardpike trial's ClientWorld mirror (the IWorldLanceTrial facet, online half),
// moved out of online.ts under the monolith ratchet as one more link in the wire-state
// base-class chain (QuestWorldWireState -> LanceWireState -> ReconWireState ->
// ClientWorld). It owns the self view the server ships as the `lance`/`lrest`/`lguide`
// delta keys (server/lance_wire.ts lanceSelfWire), the three no-argument verbs, and the
// world boss fight's per-entity bits off the dynamic wire block
// (server/world_boss_wire.ts writeWorldBossWireFields).

import type { Entity } from '../sim/types';
import type { LanceGuidanceView, LanceTrialView } from '../world_api';
import { QuestWorldWireState } from './quest_world_wire_state';

export class LanceWireState extends QuestWorldWireState {
  // Null between sessions, so the field only churns while a brace is live.
  lanceTrial: LanceTrialView | null = null;
  lanceRestRemaining = 0;
  lanceGuidance: LanceGuidanceView | null = null;

  lanceBrace(): void {
    this.sendQuestWorldCommand({ cmd: 'lance_brace' });
  }
  lanceThrust(): void {
    this.sendQuestWorldCommand({ cmd: 'lance_thrust' });
  }
  lanceRelease(): void {
    this.sendQuestWorldCommand({ cmd: 'lance_release' });
  }

  /** The quest family's self apply, then the three lance keys of the same record. */
  override applyQuestSelfSnapshot(
    self: Parameters<QuestWorldWireState['applyQuestSelfSnapshot']>[0] & {
      lance?: unknown;
      lrest?: unknown;
      lguide?: unknown;
    },
    simTime?: unknown,
  ): void {
    super.applyQuestSelfSnapshot(self, simTime);
    this.applyLanceSelfWire(self);
  }

  /** The self record's three lance keys, each delta-guarded like `corpse`. */
  applyLanceSelfWire(s: { lance?: unknown; lrest?: unknown; lguide?: unknown }): void {
    if (s.lance !== undefined) this.lanceTrial = (s.lance as LanceTrialView | null) ?? null;
    if (s.lrest !== undefined) this.lanceRestRemaining = (s.lrest as number) ?? 0;
    if (s.lguide !== undefined) this.lanceGuidance = (s.lguide as LanceGuidanceView | null) ?? null;
  }

  /**
   * The world boss fight's bits off one entity's dynamic wire block: the Shardpike brace
   * (remote clients pose it), the slumbering boss in bed (mob/slumber.ts: defined only once
   * the wire has ever said so, mirroring the sim's defined-only-on-a-sleeper discipline, so
   * the rig can lie down while the bit rides and wake on the edge where it stops), and the
   * warpath phase plus its unharried clock for the phase aura (balgath_aura_core.ts).
   */
  applyWorldBossEntityWire(
    e: Entity,
    w: { brc?: unknown; slp?: unknown; wp?: Entity['warpathPhase']; wu?: number },
  ): void {
    e.bracing = !!w.brc;
    if (w.slp) e.asleep = true;
    else if (e.asleep) e.asleep = false;
    e.warpathPhase = w.wp ?? undefined;
    e.warpathUnharried = w.wu ?? (e.warpathPhase ? 0 : undefined);
  }
}
