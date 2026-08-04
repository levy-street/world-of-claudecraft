// Pure, DOM-free persistence helpers for the crafting window's last-selected
// tab (issue #2347: reopening the crafting menu defaulted back to the first
// profession tab instead of the one the player was last using). Mirrors the
// bag_filter.ts precedent: a tolerant parse that falls back to "no pick yet"
// on anything malformed, so a corrupt localStorage value can never break the
// window. profession ids are open-ended content (src/sim/content/recipes.ts),
// not a fixed enum, so the only shape check here is "non-empty string"; the
// actual membership check against the player's current tabs still happens in
// resolveSelectedCraft() (crafting_view.ts), which is what guards against a
// stale/renamed profession id.
//
// DOM-free so tests/crafting_tab_pref.test.ts can drive it directly.

export function serializeCraftingTab(professionId: string | null): string {
  return JSON.stringify(professionId);
}

export function parseCraftingTab(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return typeof parsed === 'string' && parsed.length > 0 ? parsed : null;
}
