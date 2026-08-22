// Tool-effect charm tooltip lines: the pure string-builder composed inside
// Hud.itemTooltip and the Professions window hover cards. English copy asserted
// directly (the gather_tool_tooltip.test.ts idiom); charge numbers must mirror
// TOOL_EFFECTS.startingDurability and RARITY_DURABILITY_BONUS, never re-invented.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOL_EFFECTS } from '../src/sim/content/professions';
import { ITEMS } from '../src/sim/data';
import { RARITY_DURABILITY_BONUS, slotToolEffectRefused } from '../src/sim/professions/tools';
import type { ItemDef } from '../src/sim/types';
import { itemNameColor } from '../src/ui/item_name_color';
import {
  hasToolEffectCard,
  isToolEffectItem,
  toolEffectStandaloneTooltip,
  toolEffectTooltipLines,
} from '../src/ui/tool_effect_tooltip';

describe('toolEffectTooltipLines: live charms', () => {
  it("Gatherer's Cache names the kind, quantity bonus, how to slot, and charges", () => {
    const html = toolEffectTooltipLines(ITEMS.gatherers_cache);
    expect(html).toContain('<div class="tt-sub">Tool charm</div>');
    expect(html).toContain('<div class="tt-green">+1 yield per harvest while charged.</div>');
    expect(html).toContain(
      '<div class="tt-desc">Slot onto a mining, logging, herbalism, or farming tool from the Professions window. Consumed when slotted.</div>',
    );
    expect(html).toContain(
      `<div class="tt-desc">Starts with ${TOOL_EFFECTS.gatherers_cache.startingDurability} charges on a common tool (+${RARITY_DURABILITY_BONUS} per rarity rung).</div>`,
    );
    expect(html).toContain('<div class="tt-sub">Does not slot on fishing rods.</div>');
    // No title (Hud.itemTooltip already prints the item name) and no "open
    // Professions" cue: the bag hover appends that as its affordance hint
    // (bagTooltipHintKey), so repeating it here would double the sentence.
    expect(html).not.toContain('tt-title');
    expect(html).not.toContain('Open Professions to slot this');
  });

  it("Artisan's Eye states the grade bonus instead of the quantity bonus", () => {
    const html = toolEffectTooltipLines(ITEMS.artisans_eye);
    expect(html).toContain('<div class="tt-sub">Tool charm</div>');
    expect(html).toContain(
      '<div class="tt-green">Raises the harvest grade by 1 tool tier while charged.</div>',
    );
    expect(html).not.toContain('+1 yield per harvest');
  });

  it('isToolEffectItem is true only for charm items', () => {
    expect(isToolEffectItem(ITEMS.gatherers_cache)).toBe(true);
    expect(isToolEffectItem(ITEMS.artisans_eye)).toBe(true);
    expect(isToolEffectItem(ITEMS.copper_mining_pick)).toBe(false);
    expect(isToolEffectItem(ITEMS.copper_ore)).toBe(false);
    expect(isToolEffectItem(ITEMS.lesser_healing_potion)).toBe(false);
  });

  it('the prose numbers track the sim catalog', () => {
    // "+1 yield per harvest" and "by 1 tool tier" spell the bonus out as
    // English prose, so nothing else ties the copy to the data: this pin
    // forces a rebalance of TOOL_EFFECTS[*].bonus to update the catalog copy
    // (hud_chrome.ts toolEffectTooltip.bonus.*) in the same change.
    expect(TOOL_EFFECTS.gatherers_cache.bonus).toBe(1);
    expect(TOOL_EFFECTS.artisans_eye.bonus).toBe(1);
    // The charge-line assertions above interpolate the same constants the
    // builder reads (they track the catalog by construction), so pin the
    // ladder inputs to literals once here.
    expect(TOOL_EFFECTS.gatherers_cache.startingDurability).toBe(20);
    expect(TOOL_EFFECTS.artisans_eye.startingDurability).toBe(20);
    expect(RARITY_DURABILITY_BONUS).toBe(10);
    // "Does not slot on fishing rods." tracks the slot policy: if fishing is
    // ever wired for real, this pin drags the landOnly copy along.
    expect(slotToolEffectRefused('fishing', 'gatherers_cache')).toBe(true);
    expect(slotToolEffectRefused('fishing', 'artisans_eye')).toBe(true);
    // The hoe phase lifted farming's shipless refusal arm: both live effects
    // now slot on farming for real (professions/farming.ts harvestCrop maps
    // quantity to bonus picks and quality to a fine-chance bump), so the
    // admission is pinned in both live-effect rows.
    expect(slotToolEffectRefused('farming', 'gatherers_cache')).toBe(false);
    expect(slotToolEffectRefused('farming', 'artisans_eye')).toBe(false);
    // Springback Charm (id quickening_charm, kind respawnSpeed) stays refused
    // on EVERY profession via the kind arm, farming included. One arm per
    // site: farming proves the kind arm survives the lifted shipless arm,
    // mining proves it fires away from farming entirely.
    expect(slotToolEffectRefused('farming', 'quickening_charm')).toBe(true);
    expect(slotToolEffectRefused('mining', 'quickening_charm')).toBe(true);
    // The Maker's Charm is a quantity effect too, so the SAME admission holds
    // for it, and it is pinned against the predicate rather than against the
    // sentence: the howToSlot copy names farming, and this is what makes that
    // claim true rather than merely written. It was unpinned until 11e, which
    // is how the charm-on-a-hoe path survived two packets unexamined.
    expect(slotToolEffectRefused('farming', 'makers_charm')).toBe(false);
    expect(slotToolEffectRefused('fishing', 'makers_charm')).toBe(true);
    // The copy and the policy in BOTH directions: every profession the
    // sentence advertises really admits a live quantity charm, and every one it
    // omits really refuses. Derived from the sentence, so a reword that adds or
    // drops a profession without moving the policy reds here.
    // Scoped to the ADVERTISED sentence, not the whole tooltip: the tooltip
    // also carries the landOnly line, which names fishing precisely because it
    // is refused, so a whole-tooltip search would find the word for the
    // opposite reason and the negative arm would be meaningless.
    const rendered = toolEffectTooltipLines(ITEMS.makers_charm);
    const advertised = /<div class="tt-desc">(Slot onto [^<]*)<\/div>/.exec(rendered)?.[1];
    expect(advertised, 'the how-to-slot sentence must render').toBeTruthy();
    for (const professionId of ['mining', 'logging', 'herbalism', 'farming'] as const) {
      expect(advertised, `${professionId} must be advertised`).toContain(professionId);
      expect(slotToolEffectRefused(professionId, 'makers_charm')).toBe(false);
    }
    // ...and the one it omits really is refused, which is what the separate
    // landOnly line tells the player.
    expect(advertised).not.toContain('fishing');
    expect(rendered).toContain('Does not slot on fishing rods.');
    // The farming gatherTool roster, once the self-clearing empty tripwire of
    // the shipless era, is now the exact four-rung hoe ladder, in ITEMS
    // insertion order (which is how Object.values returns them).
    expect(
      Object.values(ITEMS)
        .filter((item) => item.use?.type === 'gatherTool' && item.use.professionId === 'farming')
        .map((item) => item.id),
    ).toEqual(['garden_hoe', 'bronze_hoe', 'skysilver_hoe', 'osmium_hoe']);
  });
});

describe('toolEffectTooltipLines: everything else', () => {
  it('non-charm items render nothing', () => {
    expect(toolEffectTooltipLines(ITEMS.copper_ore)).toBe('');
    expect(toolEffectTooltipLines(ITEMS.copper_mining_pick)).toBe('');
    expect(toolEffectTooltipLines(ITEMS.arcane_dust)).toBe('');
  });

  it('a charm whose effect id the catalog retired renders nothing', () => {
    // A stale def can outlive its effect (a content retirement); the item
    // path must go quiet rather than build a card with no honest bonus line.
    const retired = {
      kind: 'tool',
      name: 'Retired Charm',
      use: { type: 'toolEffect', effectId: 'retired_charm' },
    } as unknown as ItemDef;
    expect(toolEffectTooltipLines(retired)).toBe('');
  });

  it('Hud.itemTooltip composes the module (one line, never inline logic)', () => {
    // Strip whole-line comments first so a comment merely naming the call
    // cannot satisfy the pin (the gather_tool_tooltip.test.ts idiom).
    const hudSrc = readFileSync(path.join(__dirname, '../src/ui/hud.ts'), 'utf8').replace(
      /^\s*\/\/.*$/gm,
      '',
    );
    expect(hudSrc).toContain("from './tool_effect_tooltip'");
    expect(hudSrc).toContain('toolEffectTooltipLines(item)');
  });
});

describe('toolEffectStandaloneTooltip: professions window card', () => {
  it('renders a titled card for a live effect id, colored by the charm item quality', () => {
    const html = toolEffectStandaloneTooltip('gatherers_cache');
    // esc() HTML-encodes the apostrophe (Gatherer&#39;s Cache).
    expect(html).toContain('Gatherer&#39;s Cache');
    // The title color is derived from the charm's own ItemDef (the
    // itemNameColor idiom), never a hardcoded quality.
    expect(html).toContain(
      `<div class="tt-title" style="color:${itemNameColor(ITEMS.gatherers_cache)}">`,
    );
    expect(html).toContain('Tool charm');
    expect(html).toContain('+1 yield per harvest while charged.');
    // Standalone is for the Professions window itself: no "open Professions"
    // cue (the player is already there).
    expect(html).not.toContain('Open Professions to slot this');
  });

  it('renders nothing for an unknown effect id', () => {
    expect(toolEffectStandaloneTooltip('not_a_real_effect')).toBe('');
  });

  it('hasToolEffectCard gates exactly the ids with a card (the painter mint gate)', () => {
    for (const id of Object.keys(TOOL_EFFECTS)) expect(hasToolEffectCard(id), id).toBe(true);
    expect(hasToolEffectCard('not_a_real_effect')).toBe(false);
    expect(hasToolEffectCard('')).toBe(false);
  });

  it('every shipped charm item carries its pinned quality (the title-color rung table)', () => {
    // Until phase 09 every charm was rare, so the derived color
    // (itemNameColor on the charm def) and the no-item fallback were
    // byte-identical and the color assertion above could not distinguish
    // derive from hardcode. The epic Maker's Charm is the distinguishing
    // fixture the old tripwire demanded (see the next arm); this exact map
    // remains the tripwire for any FUTURE rung change.
    const expected: Record<string, string> = {
      gatherers_cache: 'rare',
      artisans_eye: 'rare',
      makers_charm: 'epic',
    };
    const charms = Object.values(ITEMS).filter((def) => def.use?.type === 'toolEffect');
    expect(charms.map((def) => def.id).sort()).toEqual(Object.keys(expected).sort());
    for (const def of charms) expect(def.quality, def.id).toBe(expected[def.id]);
  });

  it('the epic charm title takes the DERIVED epic color, not the rare fallback', () => {
    // The fixture the old all-rare tripwire demanded: epic differs from the
    // fallback rung, so a hardcoded QUALITY_COLOR.rare title now fails here.
    const html = toolEffectStandaloneTooltip('makers_charm');
    expect(html).toContain(
      `<div class="tt-title" style="color:${itemNameColor(ITEMS.makers_charm)}">`,
    );
    expect(itemNameColor(ITEMS.makers_charm)).not.toBe(itemNameColor(ITEMS.gatherers_cache));
  });

  it('covers every live TOOL_EFFECTS catalog entry with its OWN bonus line', () => {
    // Per-id snippets, so a BONUS_KEYS table wired to one shared key could
    // never pass: the table's identity is what this loop pins.
    const expectedBonusSnippet: Record<string, string> = {
      gatherers_cache: '+1 yield per harvest',
      artisans_eye: 'Raises the harvest grade',
      quickening_charm: 'Shortens the node respawn timer',
      makers_charm: '+2 yield per harvest',
    };
    for (const id of Object.keys(TOOL_EFFECTS)) {
      const html = toolEffectStandaloneTooltip(id);
      expect(html.length, id).toBeGreaterThan(0);
      expect(html, id).toContain('Tool charm');
      expect(html, id).toContain(expectedBonusSnippet[id]);
    }
  });
});
