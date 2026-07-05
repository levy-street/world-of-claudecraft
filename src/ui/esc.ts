// Canonical HTML escaper for the HUD's innerHTML / attribute interpolation.
//
// The src/ui/ rule is "all HTML interpolation goes through esc()" (see
// src/ui/CLAUDE.md). This is the one shared implementation the HUD and the
// small presentation modules import, instead of each re-deriving its own. It
// escapes the five characters that matter in both element-content and double-
// quoted attribute contexts, with `&` first so the entities it emits are not
// themselves re-escaped.
export const esc = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
