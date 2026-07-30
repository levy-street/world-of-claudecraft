// Pure filename-to-catalog policy index for the bulk conformance CLI. Runtime
// discovery deliberately prefers a published MP3 when both it and a source
// master exist; conformance deliberately prefers the lossless source. Indexing
// by stem lets both files inherit the same channel and naming policy.

import path from 'node:path';
import { expectedChannelsForEntry } from './sfx_conform_rules.mjs';
import { parseCatalogSfxVariantStem, parseMobSfxVariantStem } from './sfx_manifest_builder.mjs';

function stem(filename) {
  return path.basename(filename, path.extname(filename));
}

export function buildSfxConformPolicy(catalog, discoveredEntries, sourceFilenames = []) {
  const catalogByKey = new Map(catalog.map((entry) => [entry.key, entry]));
  const catalogKeys = new Set(catalogByKey.keys());
  const expectedChannelsByStem = new Map();
  const recognizedStems = new Set();
  const blockedStems = new Set();
  const violations = [];

  // Catalog keys are valid source-master stems even when runtime discovery
  // selects numbered MP3 takes instead, or before any release MP3 exists.
  for (const entry of catalog) {
    recognizedStems.add(entry.key);
    expectedChannelsByStem.set(entry.key, expectedChannelsForEntry(entry));
  }

  for (const entry of Object.values(discoveredEntries)) {
    // A non-catalog entry is a mob subfamily extension: a positional voice,
    // which inherits the default mono policy.
    const expected = expectedChannelsForEntry(catalogByKey.get(entry.key));
    for (const track of entry.tracks) {
      const trackStem = stem(track.filename);
      recognizedStems.add(trackStem);
      expectedChannelsByStem.set(trackStem, expected);
    }
  }

  // Runtime discovery requires catalog takes to be contiguous from `_1`. It only
  // sees published MP3s, so validate the complete source inventory here before a
  // lossless `_2` (for example) can be conformed into an unloadable release file.
  const sourceVariantsByKey = new Map();
  for (const filename of sourceFilenames) {
    const value = stem(filename);
    if (catalogByKey.has(value)) continue; // an exact key may itself end in `_N`
    const parsed = parseCatalogSfxVariantStem(value, catalogKeys);
    if (!parsed) continue;
    let variants = sourceVariantsByKey.get(parsed.key);
    if (!variants) {
      variants = new Map();
      sourceVariantsByKey.set(parsed.key, variants);
    }
    const existing = variants.get(parsed.variantNumber);
    if (existing) {
      existing.filenames.push(filename);
    } else {
      variants.set(parsed.variantNumber, { ...parsed, filenames: [filename] });
    }
  }
  for (const [key, variantsByNumber] of sourceVariantsByKey) {
    const variants = [...variantsByNumber.values()].sort(
      (left, right) => left.variantNumber - right.variantNumber,
    );
    const gapIndex = variants.findIndex((variant, index) => variant.variantNumber !== index + 1);
    if (gapIndex === -1) continue;
    const offender = variants[gapIndex];
    violations.push(
      `noncontiguous SFX source variants for ${key}: expected _${gapIndex + 1} before ${offender.filenames[0]}`,
    );
    for (const variant of variants.slice(gapIndex)) {
      blockedStems.add(`${variant.key}_${variant.variantId}`);
    }
  }

  function expectedChannelsForStem(value) {
    if (blockedStems.has(value)) return undefined;
    const exact = expectedChannelsByStem.get(value);
    if (exact !== undefined) return exact;

    const variant = parseCatalogSfxVariantStem(value, catalogKeys);
    if (variant) return expectedChannelsForEntry(catalogByKey.get(variant.key));

    // Dynamic mob subfamilies intentionally have no catalog row. Their
    // positional vocalizations inherit the default mono policy.
    if (parseMobSfxVariantStem(value).kind === 'valid') {
      return expectedChannelsForEntry(undefined);
    }
    return undefined;
  }

  // A custom (hand-recorded, already-mastered) key is pre-mastered material,
  // not raw or generated content: conform must never re-target its loudness
  // against a metric (integrated LUFS) that may not match how the author
  // actually mixed it, only guard against real true-peak overshoot. See the
  // `custom` flag's meaning in conform_audio.mjs.
  function isCustomMaster(filename) {
    const value = stem(filename);
    const direct = catalogByKey.get(value);
    if (direct) return direct.custom === true;
    const variant = parseCatalogSfxVariantStem(value, catalogKeys);
    if (variant) return catalogByKey.get(variant.key)?.custom === true;
    return false;
  }

  return {
    violations,
    recognizes(filename) {
      const value = stem(filename);
      if (blockedStems.has(value)) return false;
      return recognizedStems.has(value) || expectedChannelsForStem(value) !== undefined;
    },
    expectedChannels(filename) {
      return expectedChannelsForStem(stem(filename));
    },
    isCustomMaster,
  };
}
