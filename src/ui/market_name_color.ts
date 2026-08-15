// Pure resolver for the World Market row's item-NAME color.
//
// Why this FORKS item_name_color.ts instead of calling it: the shared resolver
// returns the shipped QUALITY_COLOR hues (correct for chat, loot, tooltips), but
// two of the six FAIL WCAG AA against the dark market panel ground (rare #0070dd
// reads 3.87:1, epic #a335ee reads 3.82:1, both under the 4.5:1 text floor); the
// rest pass. This module exists to REPAIR exactly those two, and ONLY on the
// market name lane. A palette parameter on the shared resolver was considered and
// rejected: it also carries the quest-purpose override (kind === 'quest' wins
// over quality), which the market row does not want, and it would push a palette
// argument onto every unrelated caller. So the market keeps a small purpose-built
// map, and this note is the "why it forks" the shared module's readers need.
//
// Returns a CSS custom-property reference, never a raw hex, so no color literal
// lives in the painter (the market_window no-magic guard) and the values stay
// themeable in tokens.css. DOM-free and unit-tested in tests/market_name_color.ts.
import type { ItemDef } from '../sim/types';

// The quality union as the catalog declares it (no separate exported alias
// exists; it lives inline on ItemDef).
type ItemQuality = NonNullable<ItemDef['quality']>;

// Every quality maps to a market name-color token. The repaired rare/epic tokens
// carry the lifted values (tokens.css); the others alias the shipped palette so
// the market name matches the rest of the game for the passing qualities.
const MARKET_NAME_COLOR_VAR: Record<ItemQuality, string> = {
  poor: 'var(--mkt-name-poor)',
  common: 'var(--mkt-name-common)',
  uncommon: 'var(--mkt-name-uncommon)',
  rare: 'var(--mkt-name-rare)',
  epic: 'var(--mkt-name-epic)',
  legendary: 'var(--mkt-name-legendary)',
};

// Fallback for a listing whose item carries no quality field.
export const MARKET_NAME_DEFAULT_COLOR = 'var(--mkt-name-common)';

export function marketNameColor(quality: ItemQuality | undefined): string {
  // Object.hasOwn, not a bare index, so a hostile wire quality string that
  // collides with an Object.prototype key cannot resolve to a function source
  // interpolated into the row's style attr (the same doctrine item_name_color.ts
  // carries; the value here is written into `style="color:..."`).
  return quality && Object.hasOwn(MARKET_NAME_COLOR_VAR, quality)
    ? MARKET_NAME_COLOR_VAR[quality]
    : MARKET_NAME_DEFAULT_COLOR;
}
