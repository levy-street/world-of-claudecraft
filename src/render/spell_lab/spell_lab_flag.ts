// Whether this dev session boots the Spell & VFX Review Lab (`?spells=on` or
// `?spelllab=on`). Read once at module load.
//
// Kept as a leaf module (no runtime/DOM imports) so `post.ts` can gate the
// dynamic import of `spell_lab_runtime.ts` without pulling the catalog or UI
// into non-lab sessions or the guide/editor bundles.

function readSpellParam(): string | null {
  if (typeof location === 'undefined') return null;
  const params = new URLSearchParams(location.search);
  return params.get('spells') ?? params.get('spelllab');
}

function readAutoOpenFlag(): boolean {
  if (!import.meta.env.DEV) return false;
  const mode = readSpellParam();
  return mode === 'on' || mode === '1' || mode === 'true';
}

function readDevFlag(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof location === 'undefined') return false;
  const mode = readSpellParam();
  return mode !== 'off' && mode !== '0';
}

const autoOpen = readAutoOpenFlag();
const devEnabled = readDevFlag();

/** True when `?spells=on` (or `?spelllab=on`) requested the Spell Lab panel on world entry. */
export function spellLabAutoOpen(): boolean {
  return autoOpen;
}

/** True in dev browser sessions unless explicitly disabled with `?spells=off`. */
export function spellLabDevEnabled(): boolean {
  return devEnabled;
}
