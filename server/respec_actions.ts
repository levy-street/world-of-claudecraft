// Implementation of the $WOC-paid respec + loadout-slot actions (#472): the
// prepare (validate + price) and apply (perform) halves the respec quote/confirm
// flow injects. Mirrors server/identity_actions.ts: game-coupled bits (the
// online check) come in as `RespecGameHooks` so this module stays free of the
// live client map and socket layer, and no raw SQL lives here.
//
// The two paid actions edit an OFFLINE character's persisted state through the
// sim-pure transforms in src/sim/progression/paid_respec.ts (the server-to-sim
// seam): the state change never touches crypto or the network, and it runs
// without a live Sim, exactly like a paid rename edits the stored row.
import {
  canUnlockLoadoutSlot,
  respecCharacterState,
  unlockLoadoutSlot,
} from '../src/sim/progression/paid_respec';
import { getCharacter, mutateOfflineCharacterState } from './db';
import type { WocPriceKey } from './woc_config';

export type RespecKind = 'respec' | 'unlock_loadout_slot';
export const RESPEC_KINDS: RespecKind[] = ['respec', 'unlock_loadout_slot'];

// Result of applying a paid action: status + JSON body returned to the client.
// Kept structurally identical to identity's ApplyResult.
export interface RespecApplyResult {
  status: number;
  body: unknown;
}

// Injected by main.ts. `prepare` validates auth/ownership/combat state and
// prices the request (no quote issued on failure); `apply` performs the paid
// action with exactly the payload prepare() persisted.
export interface RespecActions {
  prepare(
    accountId: number,
    kind: RespecKind,
    body: any,
  ): Promise<
    | { ok: true; priceKey: WocPriceKey; payload: Record<string, unknown> }
    | { ok: false; status: number; error: string }
  >;
  apply(accountId: number, kind: RespecKind, payload: any): Promise<RespecApplyResult>;
}

// Hooks main.ts wires from the live GameServer. A paid respec / loadout-slot
// edit rewrites the OFFLINE character's saved state, so the character must not be
// in a live session; renaming/respeccing a live session would desync it.
export interface RespecGameHooks {
  isCharacterOnline(characterId: number): boolean;
}

export function makeRespecActions(hooks: RespecGameHooks): RespecActions {
  async function validateCharacter(
    accountId: number,
    body: any,
  ): Promise<{ ok: true; characterId: number } | { ok: false; status: number; error: string }> {
    const characterId = Number(body?.characterId);
    if (!Number.isInteger(characterId)) {
      return { ok: false, status: 400, error: 'characterId required' };
    }
    const c = await getCharacter(accountId, characterId);
    if (!c) return { ok: false, status: 404, error: 'character not found' };
    // The paid edit rewrites the offline saved state. A character in a live
    // session (in combat or not) would have that write clobbered on its next
    // autosave, and swapping talents mid-fight is never allowed: require offline.
    if (hooks.isCharacterOnline(characterId)) {
      return { ok: false, status: 400, error: 'log the character out first' };
    }
    return { ok: true, characterId };
  }

  return {
    async prepare(accountId, kind, body) {
      const v = await validateCharacter(accountId, body);
      if (!v.ok) return v;

      if (kind === 'respec') {
        return { ok: true, priceKey: 'respec', payload: { characterId: v.characterId } };
      }

      // unlock_loadout_slot: reject before pricing if the character is already at
      // the hard loadout-slot ceiling, so a player never pays for a no-op.
      const c = await getCharacter(accountId, v.characterId);
      if (!c?.state) return { ok: false, status: 404, error: 'character not found' };
      if (!canUnlockLoadoutSlot(c.state)) {
        return { ok: false, status: 409, error: 'all loadout slots are already unlocked' };
      }
      return {
        ok: true,
        priceKey: 'loadout_slot',
        payload: { characterId: v.characterId },
      };
    },

    async apply(accountId, kind, payload): Promise<RespecApplyResult> {
      const characterId = Number(payload?.characterId);
      if (!Number.isInteger(characterId)) {
        return { status: 400, body: { error: 'characterId required' } };
      }
      // Re-check offline at apply time: the player may have logged in during the
      // on-chain round-trip, and editing a live session's saved state desyncs it.
      if (hooks.isCharacterOnline(characterId)) {
        return { status: 400, body: { error: 'log the character out first' } };
      }

      if (kind === 'respec') {
        const r = await mutateOfflineCharacterState(accountId, characterId, respecCharacterState);
        if (!r.ok) {
          const status = r.reason === 'not_found' ? 404 : 409;
          return { status, body: { error: 'character can no longer be respecced here' } };
        }
        return { status: 200, body: { respecced: true, characterId } };
      }

      // unlock_loadout_slot
      const r = await mutateOfflineCharacterState(accountId, characterId, unlockLoadoutSlot);
      if (!r.ok) {
        if (r.reason === 'unchanged') {
          return { status: 409, body: { error: 'all loadout slots are already unlocked' } };
        }
        return { status: r.reason === 'not_found' ? 404 : 409, body: { error: 'unlock failed' } };
      }
      return { status: 200, body: { unlocked: true, characterId } };
    },
  };
}
