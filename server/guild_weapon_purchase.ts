import { reserveGuildWeaponSkin } from '../src/sim/guild_quartermaster';
import type { Sim } from '../src/sim/sim';
import type { AccountCosmeticsService } from './account_cosmetics_service';
import type { ClientSession } from './game';
import {
  type GuildWeaponPurchaseSave,
  purchaseGuildWeaponAtomic,
} from './guild_weapon_purchase_db';
import type { PaidGuildCreateSnapshot } from './paid_guild_creation';
import { KeyedSerialWriteAborted, type KeyedSerialWriter } from './serial_writer';
import type { CharacterSaveArgs } from './woc_market_character_save';

export interface GuildWeaponPurchaseHost {
  sim(): Sim;
  session(id: number): ClientSession | null | undefined;
  queue: Pick<KeyedSerialWriter<number>, 'enqueueCancellable'>;
  capture(id: number): PaidGuildCreateSnapshot | null;
  conflict(id: number): boolean;
  acknowledge(save: CharacterSaveArgs): boolean;
  quarantine(session: ClientSession): void;
  cosmetics: Pick<AccountCosmeticsService, 'updateLive'>;
  persist?: typeof purchaseGuildWeaponAtomic;
}

/** At most two active/queued jobs per realm and one per account. Admission and
 * transaction deadlines bound retained sessions and pool/character FIFO occupancy. */
export class GuildWeaponPurchases {
  private readonly pending = new Set<number>();
  constructor(private readonly host: GuildWeaponPurchaseHost) {}

  start(session: ClientSession, offerId: string): Promise<void> {
    if (this.pending.has(session.accountId) || this.pending.size >= 2) return Promise.resolve();
    this.pending.add(session.accountId);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15_000);
    timer.unref();
    const nonce = session.leaseNonce;
    return this.host.queue
      .enqueueCancellable(session.characterId, abort.signal, async () => {
        let charged = false;
        try {
          if (
            this.host.session(session.characterId) !== session ||
            session.left ||
            session.escrowQuarantined ||
            !nonce ||
            session.leaseNonce !== nonce ||
            this.host.conflict(session.characterId)
          )
            return;
          // Covers exceptions during mutation as well as capture/persistence. An
          // uncertain projection must become unsaveable before this FIFO job ends.
          charged = true;
          const offer = reserveGuildWeaponSkin(
            this.host.sim().ctx,
            offerId,
            session.pid,
            (skinId) => session.accountCosmetics.weaponSkinIds.includes(skinId),
          );
          if (!offer) {
            charged = false;
            return;
          }
          const captured = this.host.capture(session.characterId);
          if (!captured) throw new Error('Guild purchase snapshot missing');
          const save: GuildWeaponPurchaseSave = {
            ...captured,
            characterId: session.characterId,
            accountId: session.accountId,
            leaseNonce: nonce,
            skinId: offer.skinId,
          };
          const skinIds = await (this.host.persist ?? purchaseGuildWeaponAtomic)(
            save,
            abort.signal,
          );
          // COMMIT has happened. Failures below quarantine for reload; they never
          // retry, refund, or publish a second grant. Preserve the current loadout.
          if (
            this.host.session(session.characterId) !== session ||
            session.leaseNonce !== nonce ||
            !this.host.acknowledge(save)
          )
            throw new Error('Guild purchase acknowledgement lost');
          this.host.cosmetics.updateLive(session.accountId, {
            ...session.accountCosmetics,
            weaponSkinIds: skinIds,
          });
          this.host.sim().ctx.emit({ type: 'guildCosmeticBought', offerId, pid: session.pid });
        } catch (error) {
          if (charged) {
            session.escrowQuarantined = true;
            this.host.quarantine(session);
          }
          console.error('Guild weapon purchase failed; reload durable character state:', error);
        }
      })
      .catch((error) => {
        if (!(error instanceof KeyedSerialWriteAborted))
          console.error('Guild purchase queue failed:', error);
      })
      .finally(() => {
        clearTimeout(timer);
        this.pending.delete(session.accountId);
      });
  }
}
