// Catalog-vs-ABILITIES description drift guard.
//
// An ability tooltip renders the i18n CATALOG English (classAbilityNamesEn, via
// tEntity in src/ui/hud.ts), not ABILITIES[id].description, so the two can drift
// invisibly: the moonkin_form nerf (spell damage 20% to 15%) landed in classes.ts
// and spell_combat.ts while the catalog kept telling players 20%. This suite is
// the drift net for that leg. The sibling suite (ability_tooltip_consistency)
// already pins def.description prose to the LIVE effect data, so together the
// triangle closes: effects == def prose == catalog prose, numerically.
//
// SCOPING: a wholesale string comparison is impossible by design. The catalog is
// the ip-scrubbed PLAYER text (renamed prose like "marten's guise" for
// aspect_of_the_monkey, "Shadewolf" for ghost_wolf) and uses {damage}-style
// placeholders where the def uses $d-style, so most entries deliberately differ
// as PROSE. What must never differ is the NUMBERS a player reads: percentages,
// durations, flat values. So the general guard compares the ordered numeric
// tokens (digits with an optional % suffix) of every catalog description against
// its ABILITIES def description, which is exactly the divergence class that
// shipped (20% vs 15%) and would have failed on it.
import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/content/classes';
import { classAbilityNamesEn } from '../src/ui/i18n.catalog/abilities';

const CATALOG = classAbilityNamesEn.entities.abilities as Record<
  string,
  { name: string; description: string }
>;

// Ordered numeric tokens of a description: "15%", "50%", "3", "0.5", ... A "%"
// is part of the token on purpose (a tooltip claiming "15" where the mechanic
// grants "15%" is player-visible drift, the old shadowform catalog bug).
function numericTokens(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?%?/g) ?? [];
}

// Pre-existing, deliberate prose simplifications where the catalog omits or
// summarizes internal numbers. Each entry is justified; do NOT add one to paper
// over a balance change, fix the catalog text instead.
const NUMERIC_DRIFT_EXCEPTIONS: Record<string, string> = {
  // Catalog says "attack power rises with your level" where the def spells out
  // the formula ("+8 plus 2 per level"); the summary predates this guard.
  cat_form: 'catalog summarizes the level-scaling attack power formula',
  // Catalog appends a "for 10 min" duration the def text omits (the def ends
  // with the shift-out sentence instead); the mechanic is the same toggle.
  ghost_wolf: 'catalog states the 10 min duration the def prose omits',
};

describe('ability catalog English stays numerically in sync with ABILITIES', () => {
  it('every catalog description carries the same numbers as its def description', () => {
    const drifted: string[] = [];
    for (const [id, entry] of Object.entries(CATALOG)) {
      const def = ABILITIES[id];
      if (!def?.description) continue;
      if (NUMERIC_DRIFT_EXCEPTIONS[id]) continue;
      const catNums = numericTokens(entry.description).join(' ');
      const defNums = numericTokens(def.description).join(' ');
      if (catNums !== defNums) {
        drifted.push(`${id}: catalog [${catNums}] vs def [${defNums}]`);
      }
    }
    expect(drifted, drifted.join('\n')).toEqual([]);
  });

  it('every numeric-drift exception still names a real, still-drifted ability', () => {
    for (const id of Object.keys(NUMERIC_DRIFT_EXCEPTIONS)) {
      const def = ABILITIES[id];
      const entry = CATALOG[id];
      expect(def?.description, `${id} lost its def description`).toBeTruthy();
      expect(entry, `${id} lost its catalog entry`).toBeTruthy();
      // If the texts converge, the exception is stale: delete it so the
      // general guard covers the ability again.
      expect(
        numericTokens(entry.description).join(' '),
        `${id} no longer drifts, remove its exception`,
      ).not.toEqual(numericTokens(def?.description ?? ''));
    }
  });

  it('moonkin_form catalog English is byte-identical to its def description', () => {
    // The decisive pin for the 2026-07 balance nerf: moonkin_form has no
    // placeholders and no scrubbed prose, so the catalog and the def must match
    // EXACTLY, and both must carry the nerfed 15% (not the old 20%).
    const def = ABILITIES.moonkin_form;
    const entry = CATALOG.moonkin_form;
    expect(entry.description).toBe(def.description);
    expect(entry.description).toContain('spell damage by 15%');
    expect(entry.description).not.toContain('20%');
  });
});
