// Lantern Hall's ClientWorld mirror (the IWorldQuests guild members, online half): one more
// link in the wire-state base-class chain (QuestWorldWireState -> LanceWireState ->
// GuildHallWireState -> ReconWireState -> ClientWorld), so online.ts does not grow. It owns
// the `gcon` self key the server ships (server/quest_snapshot_wire.ts emitQuestSelfKeys: the
// week's board, this character's progress and its Lantern Seals balance) and the
// quartermaster's buy verb.

import { GUILD_CONTRACTS_BY_ID } from '../sim/content/guild_contracts';
import type { GuildContractsView } from '../sim/guild_contracts';
import { sanitizeLanternSeals } from '../sim/lantern_seals';
import { LanceWireState } from './lance_wire_state';

const EMPTY: GuildContractsView = Object.freeze({
  week: '',
  offered: [],
  done: [],
  lifetime: 0,
  seals: 0,
});

/** Decode the `gcon` key: a malformed record keeps nothing of it (the empty board); ids the
 *  catalog does not know are dropped, so a version-skewed server never names a phantom. */
export function decodeGuildContractsWire(value: unknown): GuildContractsView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY;
  const row = value as Partial<Record<keyof GuildContractsView, unknown>>;
  const ids = (list: unknown): string[] =>
    Array.isArray(list)
      ? list.filter((id): id is string => typeof id === 'string' && !!GUILD_CONTRACTS_BY_ID[id])
      : [];
  const lifetime =
    typeof row.lifetime === 'number' && Number.isFinite(row.lifetime)
      ? Math.max(0, Math.floor(row.lifetime))
      : 0;
  return {
    week: typeof row.week === 'string' ? row.week : '',
    offered: ids(row.offered),
    done: ids(row.done),
    lifetime,
    seals: sanitizeLanternSeals(row.seals),
  };
}

export class GuildHallWireState extends LanceWireState {
  guildContracts: GuildContractsView = EMPTY;

  buyGuildCosmetic(offerId: string): void {
    this.sendQuestWorldCommand({ cmd: 'guild_buy_cosmetic', offer: offerId });
  }

  /** The quest family's self apply (the lance keys included), then the guild key. */
  override applyQuestSelfSnapshot(
    self: Parameters<LanceWireState['applyQuestSelfSnapshot']>[0] & { gcon?: unknown },
    simTime?: unknown,
  ): boolean {
    const changed = super.applyQuestSelfSnapshot(self, simTime);
    // delta key: absent keeps the mirror
    if (self.gcon === undefined) return changed;
    // a mirror built without its field initializers (a bare test client) has no board yet
    const sealsBefore = this.guildContracts?.seals ?? 0;
    this.guildContracts = decodeGuildContractsWire(self.gcon);
    // a seals move no longer echoes through the inventory: repaint balance-priced windows
    return this.guildContracts.seals !== sealsBefore || changed;
  }

  override resetQuestWorldWireState(): void {
    super.resetQuestWorldWireState();
    this.guildContracts = EMPTY;
  }
}
