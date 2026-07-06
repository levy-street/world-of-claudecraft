// Offline paid-respec / loadout-slot transforms on a persisted CharacterState.
//
// These are the pure, host-agnostic state edits the $WOC-paid respec and
// loadout-slot flow applies to an OFFLINE character (its JSONB state), mirroring
// how a paid rename edits the stored row while the character is not in a live
// Sim. They are deliberately NOT Sim methods: a paid action mutates the saved
// state directly, so the transform must run without a live world.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no crypto, no
// network, no Math.random/Date.now (enforced by tests/architecture.test.ts). The
// transforms are deterministic functions of their input only.
import { DEFAULT_LOADOUT_SLOTS, MAX_LOADOUT_SLOTS, type SavedLoadout } from '../content/talents';
import type { CharacterState } from '../sim';

// The active loadout-slot cap for a character: its stored bonus clamped into
// [DEFAULT_LOADOUT_SLOTS, MAX_LOADOUT_SLOTS]. A missing/legacy field reads as the
// default, so pre-feature characters keep exactly the free slots they had.
export function loadoutSlotCap(state: Pick<CharacterState, 'loadoutSlots'>): number {
  const raw = typeof state.loadoutSlots === 'number' ? Math.floor(state.loadoutSlots) : 0;
  const bonus = Math.max(0, raw);
  return Math.min(MAX_LOADOUT_SLOTS, DEFAULT_LOADOUT_SLOTS + bonus);
}

// Whether another loadout slot can still be unlocked (cap not yet at the ceiling).
export function canUnlockLoadoutSlot(state: Pick<CharacterState, 'loadoutSlots'>): boolean {
  return loadoutSlotCap(state) < MAX_LOADOUT_SLOTS;
}

// Unlock one additional loadout slot. Returns the new state with an incremented
// bonus, or null when the character is already at the hard ceiling (so the
// caller rejects the paid action before charging for a no-op).
export function unlockLoadoutSlot(state: CharacterState): CharacterState | null {
  if (!canUnlockLoadoutSlot(state)) return null;
  const current =
    typeof state.loadoutSlots === 'number' ? Math.max(0, Math.floor(state.loadoutSlots)) : 0;
  return { ...state, loadoutSlots: current + 1 };
}

// Reset the character's spent talent points, keeping the chosen specialization
// (identical to the sim's free respec, applied to saved state). Returns a new
// state; the caller persists it. The active allocation is wiped; saved loadouts
// are left untouched so a respec does not silently destroy stored builds.
export function respecCharacterState(state: CharacterState): CharacterState {
  const spec = state.talents?.spec ?? null;
  const loadouts: SavedLoadout[] = state.loadouts ?? [];
  return {
    ...state,
    talents: { spec, ranks: {}, choices: {} },
    loadouts,
  };
}
