// Claim a tradeable character (PR #735). A bound character's true owner is
// whoever controls its ‹label›.worldofclaudecraft.sol subdomain on-chain. After
// a player buys/receives that subdomain, they prove control here (their linked
// wallet == the subdomain's current on-chain owner) and the server reassigns the
// character — with all gear and progression — to their account.
//
//   POST /api/characters/:id/claim → the moved character
//
// On a successful claim the prior owner is forced offline and the character
// leaves its guild (a clean slate for the new owner; leadership hand-off/disband
// is handled by the normal guild-leave path). Game-coupled effects are injected.
import type http from 'node:http';
import { json } from './http_util';
import {
  walletForAccount,
  getCharacterAnyAccount,
  reassignCharacterAccount,
} from './db';
import { resolveSubdomainOwner } from './sns';
import { snsReady } from './sns';
import { CHARACTER_TRADEABLE } from './woc_config';

// Injected by main.ts from the live GameServer.
export interface ClaimHooks {
  isCharacterOnline(characterId: number): boolean;
  // Force the character's live session offline (called before the account moves).
  disconnectCharacter(characterId: number, reason: string): void;
  // Detach the character from any guild it belongs to (leader hand-off/disband
  // handled inside). Resolves when done.
  leaveGuildOnTransfer(characterId: number): Promise<void>;
}

let hooks: ClaimHooks | null = null;
export function registerClaimHooks(h: ClaimHooks): void {
  hooks = h;
}

// True when an account's linked wallet currently controls a bound character's
// subdomain on-chain — i.e. they may enter the world with it. Used both by the
// claim endpoint and the world-entry gate. A null owner (subdomain gone) or any
// mismatch means "not the controller".
export async function accountControlsBoundCharacter(accountId: number, boundDomain: string): Promise<boolean> {
  const wallet = await walletForAccount(accountId);
  if (!wallet) return false;
  const owner = await resolveSubdomainOwner(boundDomain);
  return owner !== null && owner === wallet.pubkey;
}

export async function handleCharacterClaim(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
  characterId: number,
): Promise<void> {
  if (!snsReady() || !CHARACTER_TRADEABLE) return json(res, 503, { error: 'character trading is not enabled' });
  if (!hooks) return json(res, 503, { error: 'claim unavailable' });

  const character = await getCharacterAnyAccount(characterId);
  if (!character) return json(res, 404, { error: 'character not found' });
  if (!character.bound_domain) return json(res, 400, { error: 'this character is not bound to a subdomain' });
  if (character.account_id === accountId) return json(res, 200, { id: character.id, name: character.name, alreadyYours: true });

  const wallet = await walletForAccount(accountId);
  if (!wallet) return json(res, 400, { error: 'link the Solana wallet that owns this name first' });

  const owner = await resolveSubdomainOwner(character.bound_domain);
  if (owner === null) return json(res, 409, { error: 'could not resolve the subdomain owner — try again' });
  if (owner !== wallet.pubkey) return json(res, 403, { error: 'your linked wallet does not own this character’s name' });

  // The chain says this account now owns the character. Settle the hand-off:
  // kick the prior owner's live session, detach from its guild, then move it.
  if (hooks.isCharacterOnline(characterId)) {
    hooks.disconnectCharacter(characterId, 'This character was transferred to a new owner.');
  }
  await hooks.leaveGuildOnTransfer(characterId);
  const moved = await reassignCharacterAccount(characterId, accountId);
  if (!moved) return json(res, 404, { error: 'character not found' });

  return json(res, 200, { id: moved.id, name: moved.name, class: moved.class, level: moved.level, claimed: true });
}
