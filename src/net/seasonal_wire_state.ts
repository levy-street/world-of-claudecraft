// The seasonal-event ClientWorld mirror (the IWorldSeasonal facet, online half),
// one more link in the wire-state base-class chain (QuestWorldWireState ->
// LanceWireState -> SeasonalWireState -> ReconWireState -> ClientWorld), so
// online.ts stays under its monolith ceiling. It owns the `season` and `tot` self
// delta keys (server/seasonal_wire.ts emitSeasonalSelfKeys) and the knock verb.
//
// Presentation only: the server decides whether an event runs and what a knock
// hands over; this mirrors the answers and sends the request.
import { LanceWireState } from './lance_wire_state';
import type { QuestWorldWireState } from './quest_world_wire_state';

/** A self `season` value: an event id, or null (an explicit clear). Anything else
 *  is dropped as version skew, never rendered. */
export function decodeSeasonWire(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9_]{1,40}$/.test(value) ? value : null;
}

/** A self `tot` value: today's knocked NPC template ids. Malformed rows drop. */
export function decodeTrickOrTreatWire(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value
      .filter((id): id is string => typeof id === 'string' && /^[a-z0-9_]{1,64}$/.test(id))
      .slice(0, 64),
  );
}

export class SeasonalWireState extends LanceWireState {
  activeSeasonalEvent: string | null = null;
  trickOrTreatedToday: readonly string[] = Object.freeze([]);

  trickOrTreat(npcId: number): void {
    if (!Number.isSafeInteger(npcId)) return;
    this.sendQuestWorldCommand({ cmd: 'trick_or_treat', npcId });
  }

  /** The lance family's self apply, then the two seasonal keys of the same record. */
  override applyQuestSelfSnapshot(
    self: Parameters<QuestWorldWireState['applyQuestSelfSnapshot']>[0] & {
      lance?: unknown;
      lrest?: unknown;
      lguide?: unknown;
      season?: unknown;
      tot?: unknown;
    },
    simTime?: unknown,
  ): void {
    super.applyQuestSelfSnapshot(self, simTime);
    if (self.season !== undefined) this.activeSeasonalEvent = decodeSeasonWire(self.season);
    if (self.tot !== undefined) this.trickOrTreatedToday = decodeTrickOrTreatWire(self.tot);
  }

  /** A fresh session starts closed until the server's first self record says
   *  otherwise: the quest family's session reset clears the seasonal mirrors too. */
  override resetQuestWorldWireState(): void {
    super.resetQuestWorldWireState();
    this.activeSeasonalEvent = null;
    this.trickOrTreatedToday = Object.freeze([]);
  }
}
