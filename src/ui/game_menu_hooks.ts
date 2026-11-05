// The Game Menu's quick toggles and links (Nameplates, Music, Haptics, Discord,
// Donate, the Steam wishlist): the actions that left the mobile More tray for
// the Esc menu. Each one is the SAME action the tray ran, so this module owns
// the shared halves both callers use (the music flip, the nameplate flip, the
// donate hop) and the one seam main.ts attaches the host-owned halves through
// (the renderer's nameplate flag, the touch controls' haptics state, the
// Discord entry). A module seam rather than a member on OptionsHooks: the hooks
// interface lives in hud.ts, which sits at its monolith ceiling.

import { music } from '../game/music';
import type { GameMenuQuickState } from './options_view';

/** The project donation page (the More tray's former Donate pill). */
export const DONATE_URL = 'https://ko-fi.com/worldofclaudecraft';

/** The renderer slice the nameplate toggle flips. */
export interface NameplateSource {
  showNameplates: boolean;
}

/** The touch controls' slice the haptics toggle reads and flips. */
export interface HapticsSource {
  /** The touch interface is up: haptics apply only there. */
  readonly touchActive: boolean;
  readonly hapticsEnabled: boolean;
  /** Flip and persist the preference; returns the new state. */
  toggleHaptics(): boolean;
}

export interface GameMenuHooks {
  nameplates: NameplateSource;
  haptics: HapticsSource;
  /** The Discord entry (account panel or invite), or null when the build
   *  hides the Discord entry. */
  discord: (() => void) | null;
}

let attached: GameMenuHooks | null = null;

/** main.ts wires the host-owned halves once the renderer and touch controls exist. */
export function attachGameMenuHooks(
  nameplates: NameplateSource,
  haptics: HapticsSource,
  discord: (() => void) | null,
): void {
  attached = { nameplates, haptics, discord };
}

/** The attached hooks, or null before main.ts wires them (and in tests). */
export function gameMenuHooks(): GameMenuHooks | null {
  return attached;
}

/** Flip world nameplates; returns the new state. */
export function toggleNameplates(source: NameplateSource): boolean {
  source.showNameplates = !source.showNameplates;
  return source.showNameplates;
}

/** Flip background music; returns whether music is now enabled. */
export function toggleMusic(): boolean {
  music.setEnabled(!music.enabled);
  return music.enabled;
}

/** Open the donation page in a new tab. */
export function openDonatePage(): void {
  window.open(DONATE_URL, '_blank', 'noopener,noreferrer');
}

/** The quick group's state for buildOptionsMenu, from the attached hooks plus
 *  the host gates the tray applied (passed in, so this stays testable). */
export function gameMenuQuickState(
  hooks: GameMenuHooks,
  gates: { nativeApp: boolean; steamWishlistSuppressed: boolean },
): GameMenuQuickState {
  return {
    nameplates: hooks.nameplates.showNameplates,
    music: music.enabled,
    haptics: hooks.haptics.touchActive ? hooks.haptics.hapticsEnabled : null,
    discord: hooks.discord !== null,
    // Donate hides on the native apps, exactly as `body.native-app #mobile-donate` did.
    donate: !gates.nativeApp,
    steamWishlist: !gates.steamWishlistSuppressed,
  };
}
