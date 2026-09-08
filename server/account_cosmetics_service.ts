// The live-session side of account cosmetics: the per-account remembered view,
// the fan-out to every session on the account, and the command handlers that
// change what a character wears or what an account owns (quest lockouts, mech
// chromas, Season 1 Armory weapon skins, mount skins). Extracted from
// GameServer behind a narrow host seam so the coordinator stays a thin
// consumer; the pure rules live in server/account_cosmetics_live.ts and the
// persistence in server/account_cosmetics_db.ts (re-exported by ./db, which is
// what keeps every test double on one import).
import { isMountSkinId } from '../src/sim/content/mount_skins';
import { withWeaponSkinApplied } from '../src/sim/content/weapon_skin_rules';
import { isWeaponSkinType, WEAPON_SKINS } from '../src/sim/content/weapon_skins';
import type { Entity, SkinCatalog, WeaponSkinLoadout, WeaponSkinType } from '../src/sim/types';
import type { AccountCosmetics } from '../src/world_api';
import {
  type AccountSkinField,
  EMPTY_LIVE_ACCOUNT_COSMETICS,
  mergeAccountCosmetics,
  ownedWeaponSkinLoadout,
} from './account_cosmetics_live';
import {
  grantAccountMechChroma,
  grantAccountMountSkins,
  grantAccountWeaponSkins,
  markAccountQuestComplete,
  setAccountWeaponSkinLoadout,
} from './db';
import { createKeyedSerialWriter } from './serial_writer';

/** The slice of a live session this service reads and writes. */
export interface CosmeticsSession {
  accountId: number;
  pid: number;
  accountCosmetics: AccountCosmetics;
}

/** The slice of the Sim the service drives. */
export interface CosmeticsSim {
  meta(pid: number): { questsDone: Set<string>; questLog: Map<string, unknown> } | null | undefined;
  ctx: { markDeedsDirty(pid: number): void };
  entities: Map<number, Entity>;
  setWeaponSkinLoadout(pid: number, loadout: WeaponSkinLoadout): void;
  setWeaponSkin(pid: number, skinId: string | null, weaponType?: WeaponSkinType): boolean;
  setPlayerSkin(pid: number, skin: number, catalog: SkinCatalog): boolean;
  setMountSkin(pid: number, skinId: string | null): boolean;
}

export interface AccountCosmeticsHost {
  sim(): CosmeticsSim;
  /** Every live session, any account (the service filters by accountId). */
  sessions(): Iterable<CosmeticsSession>;
  /** Re-send the quest log/done state after a lockout change. */
  resyncQuests(session: CosmeticsSession): void;
}

export class AccountCosmeticsService {
  private readonly pendingSkinGrants = new Map<number, Set<string>>();
  private readonly byAccount = new Map<number, AccountCosmetics>();
  // Per-account FIFO for the applied weapon loadout writes (fire and forget by
  // contract: a failed save is a cosmetic loss the next apply overwrites).
  private readonly loadoutSaveQueues = createKeyedSerialWriter<number>();

  constructor(private readonly host: AccountCosmeticsHost) {}

  applyQuestLockouts(pid: number, cosmetics: AccountCosmetics): void {
    const meta = this.host.sim().meta(pid);
    if (!meta) return;
    for (const questId of cosmetics.completedQuestIds) {
      meta.questsDone.add(questId);
      meta.questLog.delete(questId);
    }
    // The bare adds bypass the quest-credit mark site, and the lockout quests
    // can satisfy quest/meta deed triggers: request a full evaluator pass.
    if (cosmetics.completedQuestIds.length > 0) this.host.sim().ctx.markDeedsDirty(pid);
  }

  remember(accountId: number, cosmetics: AccountCosmetics): AccountCosmetics {
    const merged = mergeAccountCosmetics(
      this.byAccount.get(accountId) ?? EMPTY_LIVE_ACCOUNT_COSMETICS,
      cosmetics,
    );
    this.byAccount.set(accountId, merged);
    return merged;
  }

  updateLive(accountId: number, cosmetics: AccountCosmetics): void {
    const merged = this.remember(accountId, cosmetics);
    const sim = this.host.sim();
    for (const live of this.host.sessions()) {
      if (live.accountId !== accountId) continue;
      live.accountCosmetics = merged;
      this.applyQuestLockouts(live.pid, merged);
      sim.setWeaponSkinLoadout(live.pid, ownedWeaponSkinLoadout(merged));
      this.host.resyncQuests(live);
    }
  }

  noteQuestComplete(session: CosmeticsSession, questId: string): void {
    const current = session.accountCosmetics;
    const completedQuestIds = current.completedQuestIds.includes(questId)
      ? current.completedQuestIds
      : [...current.completedQuestIds, questId];
    this.updateLive(session.accountId, { ...current, completedQuestIds });
    void markAccountQuestComplete(session.accountId, questId)
      .then((cosmetics) => this.updateLive(session.accountId, cosmetics))
      .catch((err) => console.error('failed to save account quest cosmetic state:', err));
  }

  noteMechChroma(session: CosmeticsSession, chromaId: string): void {
    const current = session.accountCosmetics;
    const mechChromaIds = current.mechChromaIds.includes(chromaId)
      ? current.mechChromaIds
      : [...current.mechChromaIds, chromaId];
    this.updateLive(session.accountId, { ...current, mechChromaIds });
    void grantAccountMechChroma(session.accountId, chromaId)
      .then((cosmetics) => this.updateLive(session.accountId, cosmetics))
      .catch((err) => console.error('failed to save account mech chroma:', err));
  }

  /**
   * Grant a mech-chroma cosmetic to an account by id (a Discord swag claim, whose
   * points/claim are already resolved durably server-side). Best-effort live update:
   * persist the grant, then push the refreshed cosmetics to any online session on the
   * account. The live push is a no-op when the account is offline. Injected into the
   * ported Discord swag route via configureDiscordRuntime (server/discord.ts).
   */
  grantMechChroma(accountId: number, chromaId: string): void {
    void grantAccountMechChroma(accountId, chromaId)
      .then((cosmetics) => this.updateLive(accountId, cosmetics))
      .catch((err) => console.error('failed to grant swag mech chroma:', err));
  }

  /**
   * Mirror Season 1 Armory weapon-skin ownership into the rollback-safe
   * account_weapon_cosmetics row and push it to any live session on the
   * account. Injected into the Claudium spend/store routes via
   * configureClaudiumRuntime (server/claudium.ts); the economy service's grant
   * ledger stays the purchase source of truth.
   */
  grantWeaponSkins(accountId: number, skinIds: string[]): void {
    this.grantSkins(
      accountId,
      skinIds.filter((id) => WEAPON_SKINS[id]),
      'weaponSkinIds',
      grantAccountWeaponSkins,
    );
  }

  /** Mount skins (src/sim/content/mount_skins.ts): the same account-wide mirror
   *  into the rollback-safe account_mount_cosmetics row. Ownership only; wearing
   *  the skin is the character's own change_mount_skin. */
  grantMountSkins(accountId: number, skinIds: string[]): void {
    this.grantSkins(
      accountId,
      skinIds.filter(isMountSkinId),
      'mountSkinIds',
      grantAccountMountSkins,
    );
  }

  /** Coalesce concurrent reconciliations. Publish ownership only after the
   * durable mirror succeeds, so a failed write remains retryable on store open. */
  private grantSkins(
    accountId: number,
    known: string[],
    field: AccountSkinField,
    persist: (accountId: number, known: string[]) => Promise<AccountCosmetics>,
  ): void {
    const current = this.byAccount.get(accountId);
    const pending = this.pendingSkinGrants.get(accountId) ?? new Set<string>();
    const fresh = [...new Set(known)].filter(
      (id) => !current?.[field]?.includes(id) && !pending.has(`${field}:${id}`),
    );
    if (fresh.length === 0) return;
    for (const id of fresh) pending.add(`${field}:${id}`);
    this.pendingSkinGrants.set(accountId, pending);
    void persist(accountId, fresh)
      .then((cosmetics) => {
        // A grant changes ownership, never the actively edited weapon loadout.
        // The SQL snapshot may predate an apply/detach made while it was saving.
        const live = this.byAccount.get(accountId);
        this.updateLive(
          accountId,
          live ? { ...cosmetics, weaponSkinLoadout: live.weaponSkinLoadout } : cosmetics,
        );
      })
      .catch((err) => console.error(`failed to grant account ${field}:`, err))
      .finally(() => {
        for (const id of fresh) pending.delete(`${field}:${id}`);
        if (pending.size === 0) this.pendingSkinGrants.delete(accountId);
      });
  }

  /** Apply (skinId set) or detach (skinId null + wtype) a Season 1 Armory weapon
   *  skin. Server-authoritative: the account must own the skin, and the Sim
   *  re-validates that a weapon of the skin's type is equipped right now. The
   *  loadout is account state, so every session on the account updates live. */
  changeWeaponSkin(session: CosmeticsSession, skinId: string | null, wtype?: string): void {
    const current = session.accountCosmetics;
    const sim = this.host.sim();
    let weaponSkinLoadout: Record<string, string>;
    if (skinId !== null) {
      const def = WEAPON_SKINS[skinId];
      if (!def) return;
      if (!current.weaponSkinIds.includes(skinId)) return; // must own it (anti-forge)
      if (!sim.setWeaponSkin(session.pid, skinId)) return; // type-match gate
      weaponSkinLoadout = withWeaponSkinApplied(current.weaponSkinLoadout, skinId) ?? {};
    } else {
      if (!wtype || !isWeaponSkinType(wtype)) return;
      if (!current.weaponSkinLoadout[wtype]) return;
      sim.setWeaponSkin(session.pid, null, wtype);
      weaponSkinLoadout = { ...current.weaponSkinLoadout };
      delete weaponSkinLoadout[wtype];
    }
    this.updateLive(session.accountId, { ...current, weaponSkinLoadout });
    const snapshot = { ...weaponSkinLoadout };
    void this.loadoutSaveQueues
      .enqueue(session.accountId, () => setAccountWeaponSkinLoadout(session.accountId, snapshot))
      .catch((err: unknown) => {
        console.error('failed to save weapon skin loadout:', err);
      });
  }

  /** Wear (skinId) or take off (null) a mount skin on the acting character.
   *  Server-authoritative: the account must own the skin (anti-forge); the
   *  Sim validates the id and mirrors it onto the entity so the identity wire
   *  (`msk`) carries it to every client in view. Per character by design: only
   *  the acting character's worn skin changes, the account-wide unlock is never
   *  touched, and the character save persists the choice. */
  changeMountSkin(session: CosmeticsSession, raw: unknown): void {
    const skinId = raw === null ? null : typeof raw === 'string' ? raw : undefined;
    if (skinId === undefined) return;
    if (skinId !== null && !(session.accountCosmetics.mountSkinIds ?? []).includes(skinId)) return;
    this.host.sim().setMountSkin(session.pid, skinId);
  }
}
