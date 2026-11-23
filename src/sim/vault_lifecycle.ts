// Vault deadlines use the host-injected lockout clock, deterministic in replays.
import { VAULT_PORTAL_LIFETIME } from './content/treasure_maps';
import type { RiftInstance } from './rift/types';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { VaultAttempt } from './treasure_vault';

export const VAULT_LIFETIME_MS = VAULT_PORTAL_LIFETIME * 1000;
export const VAULT_LOOT_LIFETIME_MS = 15 * 60 * 1000;

/** Untimed legacy attempts cannot establish a start time: retire their lock. */
export function vaultDeadline(attempt: Pick<VaultAttempt, 'expiresAtMs'>): number {
  return attempt.expiresAtMs ?? 0;
}

export function expireVaultAttempt(meta: PlayerMeta, nowMs: number): boolean {
  if (!meta.vaultAttempt || nowMs < vaultDeadline(meta.vaultAttempt)) return false;
  meta.vaultAttempt = null;
  meta.vaultAttemptDurable = true;
  meta.wireRev++;
  return true;
}

export function completeVaultAttempt(attempt: VaultAttempt, killedAtMs: number): void {
  attempt.bossKilledAtMs ??= killedAtMs;
  attempt.expiresAtMs = Math.min(
    vaultDeadline(attempt),
    attempt.bossKilledAtMs + VAULT_LOOT_LIFETIME_MS,
  );
}

/** Stamp the actual kill, before reward persistence can retry or be delayed. */
export function recordVaultBossKill(ctx: SimContext, inst: RiftInstance): void {
  const vault = inst.vault;
  if (!vault || vault.bossKilledAtMs !== undefined) return;
  vault.bossKilledAtMs = ctx.lockoutNowMs();
  vault.expiresAtMs = Math.min(
    vault.expiresAtMs ?? vault.bossKilledAtMs + VAULT_LIFETIME_MS,
    vault.bossKilledAtMs + VAULT_LOOT_LIFETIME_MS,
  );
  const portal = inst.portalId === null ? undefined : ctx.entities.get(inst.portalId);
  if (portal) portal.vaultExpiresAt = vault.expiresAtMs;
  for (const meta of ctx.players.values()) {
    if (!vault.attemptId || meta.vaultAttempt?.id !== vault.attemptId) continue;
    completeVaultAttempt(meta.vaultAttempt, vault.bossKilledAtMs);
    meta.wireRev++;
  }
}
