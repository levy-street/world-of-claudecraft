import { describe, expect, it } from 'vitest';
import {
  HARVEST_COMPONENT_ITEMS,
  HARVEST_COMPONENT_SPECIMENS,
} from '../src/sim/content/professions';
import {
  effectiveFocusComponents,
  harvestConcentrationBonus,
  yieldingFocusComponents,
} from '../src/sim/professions/gathering';
import {
  corpseHarvestPreferenceOptions,
  generalHarvestMaterialOptions,
  HARVEST_PREFERENCE_ALL,
  HARVEST_PREFERENCE_ALL_TOKEN,
  type HarvestMaterialOption,
  type HarvestPreference,
  type HarvestPreferenceResolution,
  type LoadedHarvestPreference,
  loadHarvestPreference,
  parseHarvestPreferenceCommand,
  resolveHarvestPreferenceOnCorpse,
  savedHarvestPreference,
} from '../src/sim/professions/harvest_preference';
import { UNMAPPED_FAMILY, UNMAPPED_FAMILY_2 } from './helpers/unmapped_family';

// The shipped families, spelled as literals rather than derived from the table,
// so a content edit that changes what a picker offers reds here instead of
// passing against its own source. horn and tusk BOTH map to curved_tusk, which
// is the shipped duplicate-row case the deduplication rule exists for.
const ALL_MATERIAL_IDS = [
  'rough_hide',
  'wolf_fang',
  'spider_silk',
  'venom_gland',
  'game_meat',
  'homespun_cloth',
  'sharp_claw',
  'curved_tusk',
  'mudfin_scale',
];

/** A material preference, spelled once so the arms below read as the contract. */
function material(itemId: string): HarvestPreference {
  return { kind: 'material', itemId };
}

/** The pick a resolution hands the canonical harvest path, or a throw naming
 *  the refusal: an arm asking for a pick has already asserted it got one. */
function chosenOf(resolved: HarvestPreferenceResolution): readonly string[] {
  if (resolved.kind === 'unavailable') throw new Error(`unavailable: ${resolved.itemId}`);
  return resolved.chosenComponents;
}

/** The preference a load kept, or a throw naming the refusal. */
function loadedPreference(loaded: LoadedHarvestPreference): HarvestPreference {
  if (!loaded.ok) throw new Error(`load refused: ${loaded.reason}`);
  return loaded.preference;
}

describe('the general harvest material options', () => {
  it('lists every supported family once, deduplicated by material item id', () => {
    const options = generalHarvestMaterialOptions();
    expect(options.map((o) => o.itemId)).toEqual(ALL_MATERIAL_IDS);
    // The dedupe is what makes horn and tusk ONE displayed choice: the row
    // carries both tags, and the material id is the identity that is stored.
    expect(options.find((o) => o.itemId === 'curved_tusk')?.components).toEqual(['tusk', 'horn']);
    expect(options.find((o) => o.itemId === 'rough_hide')?.components).toEqual(['hide']);
  });

  it('offers no tag, display label or specimen id as a choice', () => {
    const ids = new Set(generalHarvestMaterialOptions().map((o) => o.itemId));
    for (const tag of Object.keys(HARVEST_COMPONENT_ITEMS)) expect(ids.has(tag)).toBe(false);
    for (const specimen of Object.values(HARVEST_COMPONENT_SPECIMENS)) {
      expect(ids.has(specimen)).toBe(false);
    }
  });

  it('hands out a fresh list a caller cannot mutate into the next answer', () => {
    const first = generalHarvestMaterialOptions() as HarvestMaterialOption[];
    first.length = 0;
    expect(generalHarvestMaterialOptions().map((o) => o.itemId)).toEqual(ALL_MATERIAL_IDS);
  });
});

describe('the corpse harvest options', () => {
  it('offers All plus just the families this body supports', () => {
    expect(corpseHarvestPreferenceOptions(['hide', 'fang'])).toEqual([
      { kind: 'all' },
      { kind: 'material', itemId: 'rough_hide', components: ['hide'] },
      { kind: 'material', itemId: 'wolf_fang', components: ['fang'] },
    ]);
  });

  it('collapses two tags yielding one material into one row on the body too', () => {
    expect(corpseHarvestPreferenceOptions(['tusk', 'hide', 'horn'])).toEqual([
      { kind: 'all' },
      { kind: 'material', itemId: 'curved_tusk', components: ['tusk', 'horn'] },
      { kind: 'material', itemId: 'rough_hide', components: ['hide'] },
    ]);
  });

  it('never offers a carried family with no item behind it', () => {
    expect(corpseHarvestPreferenceOptions(['hide', UNMAPPED_FAMILY])).toEqual([
      { kind: 'all' },
      { kind: 'material', itemId: 'rough_hide', components: ['hide'] },
    ]);
    // A body made of nothing else keeps All and nothing more. Refusing such a
    // corpse outright is isHarvestableCorpse's job, upstream of a preference.
    expect(corpseHarvestPreferenceOptions([UNMAPPED_FAMILY, UNMAPPED_FAMILY_2])).toEqual([
      { kind: 'all' },
    ]);
    expect(corpseHarvestPreferenceOptions([])).toEqual([{ kind: 'all' }]);
  });

  it('leaves the caller tag list untouched and counts a repeated tag once', () => {
    const tags = ['hide', 'hide', 'fang'];
    expect(corpseHarvestPreferenceOptions(tags)).toEqual([
      { kind: 'all' },
      { kind: 'material', itemId: 'rough_hide', components: ['hide'] },
      { kind: 'material', itemId: 'wolf_fang', components: ['fang'] },
    ]);
    expect(tags).toEqual(['hide', 'hide', 'fang']);
  });
});

describe('parsing a harvest preference command', () => {
  it('accepts the All token and one supported material item id', () => {
    expect(parseHarvestPreferenceCommand(HARVEST_PREFERENCE_ALL_TOKEN)).toEqual({
      ok: true,
      preference: HARVEST_PREFERENCE_ALL,
    });
    expect(parseHarvestPreferenceCommand('rough_hide')).toEqual({
      ok: true,
      preference: material('rough_hide'),
    });
    expect(parseHarvestPreferenceCommand('curved_tusk')).toEqual({
      ok: true,
      preference: material('curved_tusk'),
    });
  });

  it('rejects a tag, a specimen id and an unknown id rather than coercing to All', () => {
    // A command is where a NEW choice is made, so it is strict: only a
    // currently supported material may become the stored preference. A refusal
    // leaves the existing one alone, which is why none of these answers All.
    for (const raw of ['hide', 'tusk', 'pristine_hide', 'prime_cut', 'copper_ore', 'materials']) {
      expect(parseHarvestPreferenceCommand(raw), raw).toEqual({ ok: false, reason: 'unsupported' });
    }
  });

  it('rejects a malformed value, an inherited key included', () => {
    for (const raw of [undefined, null, 42, {}, [], ['rough_hide'], true]) {
      expect(parseHarvestPreferenceCommand(raw)).toEqual({ ok: false, reason: 'malformed' });
    }
    // Object.prototype keys arrive as strings, so they are refused as
    // unsupported rather than reaching a bare table index.
    for (const raw of ['constructor', 'toString', '__proto__', 'valueOf', '']) {
      expect(parseHarvestPreferenceCommand(raw), raw).toEqual({ ok: false, reason: 'unsupported' });
    }
  });
});

describe('loading a saved harvest preference', () => {
  it('defaults only an absent legacy preference or explicit All token to All', () => {
    expect(loadHarvestPreference(undefined)).toEqual({
      ok: true,
      preference: HARVEST_PREFERENCE_ALL,
    });
    expect(loadHarvestPreference(HARVEST_PREFERENCE_ALL_TOKEN)).toEqual({
      ok: true,
      preference: HARVEST_PREFERENCE_ALL,
    });
  });

  it('keeps a stored material the current content no longer supports', () => {
    // The player's choice is theirs until they change it. Silently loading All
    // instead would gather the materials they deliberately left behind, on the
    // first harvest after an update or a reconnect.
    expect(loadedPreference(loadHarvestPreference('rough_hide'))).toEqual(material('rough_hide'));
    expect(loadedPreference(loadHarvestPreference('retired_material'))).toEqual(
      material('retired_material'),
    );
    // Kept verbatim at the bound, never truncated to fit it.
    const atBound = 'm'.repeat(64);
    expect(loadedPreference(loadHarvestPreference(atBound))).toEqual(material(atBound));
  });

  it('refuses malformed saved input instead of activating All', () => {
    for (const saved of [null, 42, {}, [], true, '', 'a'.repeat(65), 'two words', 'line\nbreak']) {
      const loaded = loadHarvestPreference(saved);
      expect(loaded, String(saved)).toEqual({ ok: false, reason: 'malformed' });
      // No active preference to act on, and no echo of the offending value:
      // integration must refuse to harvest until the player chooses again.
      expect(Object.keys(loaded)).toEqual(['ok', 'reason']);
    }
  });

  it('keeps a malformed load refused across two full JSON round trips until an explicit valid choice', () => {
    // A numeric live payload (never a plausible id) refuses first.
    const numericLoad = loadHarvestPreference(42);
    expect(numericLoad).toEqual({ ok: false, reason: 'malformed' });

    // A refused load holds no active preference to save, so the caller's
    // live slot is null: savedHarvestPreference(null) must hand that back
    // verbatim rather than coercing it toward All.
    const livePreference: HarvestPreference | null = numericLoad.ok ? numericLoad.preference : null;
    expect(livePreference).toBeNull();

    // Round trip 1: through a wrapping object, not a bare value, so the
    // save/load pair is proven against the shape a real character save uses.
    const savedFirst = savedHarvestPreference(livePreference);
    expect(savedFirst).toBeNull();
    const firstJson = JSON.stringify({ harvestPreference: savedFirst });
    expect(firstJson).toBe('{"harvestPreference":null}');
    const firstParsed = JSON.parse(firstJson) as { harvestPreference: unknown };
    const firstLoad = loadHarvestPreference(firstParsed.harvestPreference);
    expect(firstLoad).toEqual({ ok: false, reason: 'malformed' });

    // Round trip 2: still refused, still null, still no drift toward All.
    const stillLivePreference: HarvestPreference | null = firstLoad.ok
      ? firstLoad.preference
      : null;
    const savedSecond = savedHarvestPreference(stillLivePreference);
    expect(savedSecond).toBeNull();
    const secondJson = JSON.stringify({ harvestPreference: savedSecond });
    expect(secondJson).toBe('{"harvestPreference":null}');
    const secondParsed = JSON.parse(secondJson) as { harvestPreference: unknown };
    const secondLoad = loadHarvestPreference(secondParsed.harvestPreference);
    expect(secondLoad).toEqual({ ok: false, reason: 'malformed' });

    // Only an explicit valid COMMAND replaces the refused state.
    const replacement = parseHarvestPreferenceCommand('rough_hide');
    expect(replacement).toEqual({ ok: true, preference: material('rough_hide') });
    const replacedPreference = replacement.ok ? replacement.preference : null;
    const replacedJson = JSON.stringify({
      harvestPreference: savedHarvestPreference(replacedPreference),
    });
    expect(replacedJson).toBe('{"harvestPreference":"rough_hide"}');
    const replacedParsed = JSON.parse(replacedJson) as { harvestPreference: unknown };
    expect(loadHarvestPreference(replacedParsed.harvestPreference)).toEqual({
      ok: true,
      preference: material('rough_hide'),
    });
  });

  it('round trips a retired choice through load, resolve and save', () => {
    // The composed path a character takes across an update: the save loads back
    // as the same material, a body without it REFUSES rather than spreading,
    // and saving again writes the same id, so nothing has quietly changed.
    const loaded = loadedPreference(loadHarvestPreference('retired_material'));
    expect(loaded).toEqual(material('retired_material'));
    expect(resolveHarvestPreferenceOnCorpse(['hide', 'fang'], loaded)).toEqual({
      kind: 'unavailable',
      itemId: 'retired_material',
      available: [
        { itemId: 'rough_hide', components: ['hide'] },
        { itemId: 'wolf_fang', components: ['fang'] },
      ],
    });
    const written = savedHarvestPreference(loaded);
    expect(written).toBe('retired_material');
    expect(loadedPreference(loadHarvestPreference(written))).toEqual(loaded);
  });

  it('round trips a supported choice and the All default through the sparse save form', () => {
    expect(savedHarvestPreference(HARVEST_PREFERENCE_ALL)).toBeUndefined();
    expect(savedHarvestPreference(material('curved_tusk'))).toBe('curved_tusk');
    for (const preference of [HARVEST_PREFERENCE_ALL, material('spider_silk')]) {
      expect(loadedPreference(loadHarvestPreference(savedHarvestPreference(preference)))).toEqual(
        preference,
      );
    }
    const silk = loadedPreference(loadHarvestPreference('spider_silk'));
    const onBody = resolveHarvestPreferenceOnCorpse(['silk', 'venomSac'], silk);
    expect(chosenOf(onBody)).toEqual(['silk']);
  });
});

describe('the serialized byte footprint of a saved harvest preference', () => {
  // A representative save row: a wrapper object with an unrelated field
  // alongside the preference key, so the comma/key/value insertion is
  // measured exactly as it lands in a real save, never in isolation. The
  // preference key writes as `harvestPreference`, mirroring the persisted
  // field name.
  interface SavedPreferenceWrapper {
    readonly other: string;
    readonly harvestPreference?: string | null;
  }

  function wrapperBytes(saved: string | null | undefined): number {
    const wrapper: SavedPreferenceWrapper =
      saved === undefined ? { other: 'x' } : { other: 'x', harvestPreference: saved };
    return Buffer.byteLength(JSON.stringify(wrapper), 'utf8');
  }

  const BASELINE_BYTES = wrapperBytes(undefined);

  it('costs zero extra bytes for the default All preference', () => {
    const saved = savedHarvestPreference(HARVEST_PREFERENCE_ALL);
    expect(saved).toBeUndefined();
    expect(wrapperBytes(saved) - BASELINE_BYTES).toBe(0);
  });

  it('adds 37 bytes for the longest currently supported material id', () => {
    // homespun_cloth (14 characters) is the longest id ALL_MATERIAL_IDS ships today.
    const saved = savedHarvestPreference(material('homespun_cloth'));
    expect(saved).toBe('homespun_cloth');
    expect(wrapperBytes(saved) - BASELINE_BYTES).toBe(37);
  });

  it('adds 151 bytes for a preserved retired id built entirely of double quotes', () => {
    // Every one of the 64 characters is a double quote, so JSON escaping
    // doubles the quoted content to 128 characters before the two wrapping
    // quotes: a stress case for the shape bound's printable-ASCII allowance.
    const retiredId = '"'.repeat(64);
    const saved = savedHarvestPreference(material(retiredId));
    expect(saved).toBe(retiredId);
    expect(wrapperBytes(saved) - BASELINE_BYTES).toBe(151);
  });

  it('adds 151 bytes for a preserved retired id built entirely of backslashes', () => {
    // Backslash escapes to \\ under JSON.stringify exactly like the quote
    // case above, so the two 64-character retired ids cost identical bytes.
    const retiredId = '\\'.repeat(64);
    const saved = savedHarvestPreference(material(retiredId));
    expect(saved).toBe(retiredId);
    expect(wrapperBytes(saved) - BASELINE_BYTES).toBe(151);
  });

  it('adds 25 bytes for the malformed-load null sentinel', () => {
    // A refused live preference saves as JSON null (never undefined, never
    // the omitted key), so a malformed load survives a save/reload cycle
    // instead of quietly reverting to the sparse All encoding.
    const saved = savedHarvestPreference(null);
    expect(saved).toBeNull();
    expect(wrapperBytes(saved) - BASELINE_BYTES).toBe(25);
  });
});

describe('resolving a preference against one body', () => {
  it('spreads All across the body exactly as the canonical default does', () => {
    const resolved = resolveHarvestPreferenceOnCorpse(['hide', 'fang'], HARVEST_PREFERENCE_ALL);
    expect(resolved).toEqual({ kind: 'all', chosenComponents: [] });
    // The empty pick IS the canonical spread, so All hands the harvest path the
    // same argument it has always taken for no selection.
    expect(effectiveFocusComponents(['hide', 'fang'], chosenOf(resolved))).toEqual([
      'hide',
      'fang',
    ]);
  });

  it('resolves one material to every matching tag on that body, in body order', () => {
    const twoTags = resolveHarvestPreferenceOnCorpse(
      ['horn', 'hide', 'tusk'],
      material('curved_tusk'),
    );
    expect(twoTags).toEqual({
      kind: 'material',
      itemId: 'curved_tusk',
      chosenComponents: ['horn', 'tusk'],
    });
    expect(resolveHarvestPreferenceOnCorpse(['hide', 'fang'], material('rough_hide'))).toEqual({
      kind: 'material',
      itemId: 'rough_hide',
      chosenComponents: ['hide'],
    });
    // An unmapped family is never part of a resolved pick, and a repeated tag
    // is taken once: a duplicate would be a second grant off one claim.
    const repeated = resolveHarvestPreferenceOnCorpse(
      ['hide', UNMAPPED_FAMILY, 'hide'],
      material('rough_hide'),
    );
    expect(chosenOf(repeated)).toEqual(['hide']);
  });

  it('refuses a material this body does not carry and never falls back to All', () => {
    const resolved = resolveHarvestPreferenceOnCorpse(['cloth'], material('rough_hide'));
    expect(resolved).toEqual({
      kind: 'unavailable',
      itemId: 'rough_hide',
      available: [{ itemId: 'homespun_cloth', components: ['cloth'] }],
    });
    expect(resolved.kind).not.toBe('all');
    // A body with nothing behind its tags reports an empty availability list
    // rather than pretending All would have paid.
    expect(resolveHarvestPreferenceOnCorpse([UNMAPPED_FAMILY], material('rough_hide'))).toEqual({
      kind: 'unavailable',
      itemId: 'rough_hide',
      available: [],
    });
  });

  it('mutates neither the caller tags nor the preference, and repeats itself', () => {
    const tags = ['hide', 'fang'];
    const preference = material('rough_hide');
    const first = resolveHarvestPreferenceOnCorpse(tags, preference);
    const second = resolveHarvestPreferenceOnCorpse(tags, preference);
    expect(first).toEqual(second);
    expect(tags).toEqual(['hide', 'fang']);
    expect(preference).toEqual({ kind: 'material', itemId: 'rough_hide' });
  });

  it('decides nothing about yield: the canonical math owns the numbers', () => {
    // The resolution carries a pick and nothing else. A tier, a quantity or a
    // bonus field here would be a second copy of the concentration rule.
    const tags = ['hide', 'fang', 'claw'];
    const resolved = resolveHarvestPreferenceOnCorpse(tags, material('rough_hide'));
    expect(Object.keys(resolved).sort()).toEqual(['chosenComponents', 'itemId', 'kind']);
    // Fed to the canonical readers, a resolved pick is byte-identical to the
    // same pick made by hand: the preference chooses tags, it never retunes
    // the concentration tradeoff.
    expect(yieldingFocusComponents(tags, chosenOf(resolved))).toEqual(['hide']);
    expect(harvestConcentrationBonus(tags, chosenOf(resolved))).toBe(
      harvestConcentrationBonus(tags, ['hide']),
    );
    const spread = resolveHarvestPreferenceOnCorpse(tags, HARVEST_PREFERENCE_ALL);
    expect(harvestConcentrationBonus(tags, chosenOf(spread))).toBe(
      harvestConcentrationBonus(tags, []),
    );
  });
});
