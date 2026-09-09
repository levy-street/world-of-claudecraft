// The player frame's anchored buff row (aurasOnPlayerFrame) sits above the
// frame by default; auraBarBelowFrame is the player's own choice to flip it
// below instead (src/styles/hud.css keys off this exact class). Purely
// presentational and needing no DOM reparenting, unlike aurasOnPlayerFrame, so
// it never touches src/ui/hud.ts: main.ts's applySetting applies it directly.
// Pulled into its own module (not inlined in main.ts) so this has a real
// behavioral Vitest instead of a source-text pin on main.ts, which has no
// lightweight instantiation seam of its own.
export const AURA_BAR_BELOW_CLASS = 'auras-below-frame';

/** Narrowed to just the one DOMTokenList method used, so a Vitest can drive
 *  this against a hand-rolled fake classList (repo convention, no jsdom). */
export interface ClassTogglable {
  classList: { toggle(cls: string, force?: boolean): boolean };
}

export function applyAuraBarSide(body: ClassTogglable, below: boolean): void {
  body.classList.toggle(AURA_BAR_BELOW_CLASS, below);
}
