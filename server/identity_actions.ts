// Implementation of the $WOC identity actions (rename character / rename guild /
// reserve a vanity name): the prepare (validate + price) and apply (perform)
// halves the identity quote/confirm flow injects. Game-coupled bits (online
// check, guild leadership/rename) come in as `IdentityGameHooks` so this module
// stays free of the live client map and socket layer.
import { isUniqueViolation } from './http_util';
import { normalizeCharName, offensiveName } from './auth';
import {
  getCharacter,
  renameCharacter,
  reserveName,
  activeReservationHolder,
  countActiveReservations,
} from './db';
import type { ApplyResult, IdentityActions, IdentityKind } from './identity';

// Hooks main.ts wires from the live GameServer.
export interface IdentityGameHooks {
  isCharacterOnline(characterId: number): boolean;
  guildLeaderInfo(characterId: number): Promise<{ guildId: number; name: string; isLeader: boolean } | null>;
  renameGuildAsLeader(
    characterId: number,
    newName: string,
  ): Promise<{ ok: true; guildId: number; oldName: string; name: string } | { ok: false; error: string }>;
  validateGuildName(raw: string): string | null;
}

// Anti-squat: a hard cap on simultaneous active reservations per account, and a
// fixed reservation lifetime so a held-but-unused name eventually frees up.
const MAX_RESERVATIONS = 10;
const RESERVE_TTL_DAYS = 90;

export function makeIdentityActions(hooks: IdentityGameHooks): IdentityActions {
  return {
    async prepare(accountId, kind, body) {
      if (kind === 'rename_character') {
        const characterId = Number(body?.characterId);
        if (!Number.isInteger(characterId)) return { ok: false, status: 400, error: 'characterId required' };
        const name = normalizeCharName(body?.name);
        if (name === null) return { ok: false, status: 400, error: 'invalid character name (2-16 letters)' };
        if (offensiveName(name)) return { ok: false, status: 400, error: 'character name is not allowed' };
        const c = await getCharacter(accountId, characterId);
        if (!c) return { ok: false, status: 404, error: 'character not found' };
        // A moderator-required rename is free — it must go through the dedicated
        // free endpoint, not this paid flow.
        if (c.force_rename) return { ok: false, status: 400, error: 'this character has a required (free) rename — use that instead' };
        if (hooks.isCharacterOnline(characterId)) return { ok: false, status: 400, error: 'character is currently online' };
        // A reserved name can only be taken by the account that reserved it.
        const holder = await activeReservationHolder(name);
        if (holder !== null && holder !== accountId) return { ok: false, status: 409, error: 'that name is reserved' };
        return { ok: true, priceKey: 'rename_character', payload: { characterId, name } };
      }

      if (kind === 'rename_guild') {
        const characterId = Number(body?.characterId);
        if (!Number.isInteger(characterId)) return { ok: false, status: 400, error: 'characterId required' };
        const newName = hooks.validateGuildName(typeof body?.name === 'string' ? body.name : '');
        if (!newName) return { ok: false, status: 400, error: 'guild names are 3-24 letters (spaces allowed)' };
        if (offensiveName(newName)) return { ok: false, status: 400, error: 'guild name is not allowed' };
        const c = await getCharacter(accountId, characterId);
        if (!c) return { ok: false, status: 404, error: 'character not found' };
        const g = await hooks.guildLeaderInfo(characterId);
        if (!g) return { ok: false, status: 400, error: 'that character is not in a guild' };
        if (!g.isLeader) return { ok: false, status: 403, error: 'only the Guild Master may rename the guild' };
        return { ok: true, priceKey: 'rename_guild', payload: { characterId, name: newName } };
      }

      // reserve_name
      const name = normalizeCharName(body?.name);
      if (name === null) return { ok: false, status: 400, error: 'invalid name (2-16 letters)' };
      if (offensiveName(name)) return { ok: false, status: 400, error: 'name is not allowed' };
      const holder = await activeReservationHolder(name);
      if (holder !== null) {
        return holder === accountId
          ? { ok: false, status: 409, error: 'you already reserved that name' }
          : { ok: false, status: 409, error: 'that name is already reserved' };
      }
      if ((await countActiveReservations(accountId)) >= MAX_RESERVATIONS) {
        return { ok: false, status: 429, error: `reservation limit reached (${MAX_RESERVATIONS})` };
      }
      return { ok: true, priceKey: 'reserve_name', payload: { name, kind: 'character' } };
    },

    async apply(accountId, kind: IdentityKind, payload): Promise<ApplyResult> {
      if (kind === 'rename_character') {
        const characterId = Number(payload?.characterId);
        const name = String(payload?.name);
        // Re-check online at apply time: the player may have logged in during the
        // on-chain round-trip, and renaming a live session desyncs its name copy.
        if (hooks.isCharacterOnline(characterId)) return { status: 400, body: { error: 'character is currently online' } };
        try {
          const c = await renameCharacter(accountId, characterId, name);
          if (!c) return { status: 404, body: { error: 'character not found' } };
          return { status: 200, body: { id: c.id, name: c.name, class: c.class, level: c.level, forceRename: c.force_rename } };
        } catch (err) {
          if (isUniqueViolation(err)) return { status: 409, body: { error: 'that name is taken' } };
          throw err;
        }
      }

      if (kind === 'rename_guild') {
        const characterId = Number(payload?.characterId);
        const name = String(payload?.name);
        const r = await hooks.renameGuildAsLeader(characterId, name);
        if (!r.ok) {
          const status = r.error === 'name_taken' ? 409 : r.error === 'not_leader' ? 403 : 400;
          return { status, body: { error: r.error } };
        }
        return { status: 200, body: { guildId: r.guildId, name: r.name, previousName: r.oldName } };
      }

      // reserve_name
      const name = String(payload?.name);
      const rkind = typeof payload?.kind === 'string' ? payload.kind : 'character';
      const row = await reserveName(accountId, name, rkind, RESERVE_TTL_DAYS);
      if (!row) return { status: 409, body: { error: 'that name is already reserved' } };
      return { status: 200, body: { id: row.id, name: row.name, expiresAt: row.expires_at } };
    },
  };
}
