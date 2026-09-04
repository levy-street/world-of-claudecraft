// The wiki's pattern-CHANNEL classification, in one place.
//
// A profession recipe whose sim-side acquisition is ['drop'] can actually be
// taught by up to two live channels at once: a teaching pattern item
// (pattern_<resultItemId>) sitting in a drop table, and the same pattern
// sitting in the Heroic Quartermaster's marks stock. The wiki row must name
// the channels that really exist, so the classification is DERIVED from the
// tables themselves rather than from a hand-kept list: a channel added
// anywhere reaches the wiki, and its pins, by existing.
//
// This module exists because that derivation had TWO copies: the generator's
// (scripts/wiki/build_content.mjs) and the accuracy guard's re-derivation in
// tests/guide.test.ts, which sat under a comment promising it derived the set
// "exactly as the generator derives it". Two copies of one expression is two
// chances to drift, and the guard would have gone on agreeing with a generator
// that had moved. One shared derivation, imported by both.
//
// The mirror does NOT become self-comparing by sharing it: tests/guide.test.ts
// keeps a literal exemplar for EVERY arm (known / trainer / drop / vendor /
// dropAndVendor) anchored on a named recipe id, so this module cannot be
// mutated into agreement with itself, and tests/wiki_vendor_channel.test.ts
// drives it off synthetic tables that owe nothing to live content.
//
// Pure and host-agnostic on purpose: it takes the tables as arguments and
// imports nothing, so the generator can hand it the esbuild-bundled sim tables
// and vitest can hand it the real ones (or fakes) without a bundle step.

/** The teaching-pattern item id for a recipe's output. The ONE spelling of
 *  this convention on the wiki arm. */
export function patternItemIdFor(resultItemId) {
  return `pattern_${resultItemId}`;
}

/** Every pattern id a LIVE drop table carries, plus every pattern id the
 *  Heroic Quartermaster stocks, derived from the tables themselves.
 *
 *  `mobs` is the overworld/raid bestiary (each def's optional `loot` rows carry
 *  the raid channel), `heroicBossLoot` the heroic-only five-man tables,
 *  `riftPatternItemIds` and `farmRiftDropItemIds` the two rift pick lists, and
 *  `heroicVendorStock` the marks counter's offers. A pattern nobody drops is
 *  vendor-only and says so; a pattern nobody sells is drop-only and says so. */
export function patternChannelSets({
  mobs,
  heroicBossLoot,
  riftPatternItemIds,
  farmRiftDropItemIds,
  heroicVendorStock,
}) {
  const dropped = new Set([
    ...Object.values(mobs).flatMap((m) =>
      (m.loot ?? []).flatMap((e) => (e.itemId ? [e.itemId] : [])),
    ),
    ...Object.values(heroicBossLoot)
      .flat()
      .flatMap((e) => (e.itemId ? [e.itemId] : [])),
    ...riftPatternItemIds,
    ...farmRiftDropItemIds,
  ]);
  const vendor = new Set(heroicVendorStock.map((o) => o.itemId));
  return { dropped, vendor };
}

/** True when `recipe` is drop-acquisition AND a live drop table carries its
 *  teaching pattern. */
export function dropTaughtRecipe(recipe, sets) {
  return (
    Boolean(recipe.acquisition?.includes('drop')) &&
    sets.dropped.has(patternItemIdFor(recipe.resultItemId))
  );
}

/** True when `recipe` is drop-acquisition AND the Heroic Quartermaster stocks
 *  its teaching pattern. */
export function vendorTaughtRecipe(recipe, sets) {
  return (
    Boolean(recipe.acquisition?.includes('drop')) &&
    sets.vendor.has(patternItemIdFor(recipe.resultItemId))
  );
}

/** The wiki row's acquisition value for one recipe: the FIVE-way
 *  classification the craft table renders.
 *
 *  'trainer' wins outright (a trainer recipe is bought, never found). Then the
 *  both-channels case, which gets its own value and its own rendered row
 *  BECAUSE either single label is a lie about the other channel: a farming
 *  pattern labelled vendor-only would send a reader to the quartermaster and
 *  they would never look in the raid it also drops from. Then vendor-only,
 *  then plain drop (the acquisition says drop even when no table this module
 *  knows about carries the pattern), then 'known' for the grandfathered set. */
export function recipeAcquisitionChannel(recipe, sets) {
  if (recipe.acquisition?.includes('trainer')) return 'trainer';
  const vendorTaught = vendorTaughtRecipe(recipe, sets);
  const dropTaught = dropTaughtRecipe(recipe, sets);
  if (vendorTaught && dropTaught) return 'dropAndVendor';
  if (vendorTaught) return 'vendor';
  if (recipe.acquisition?.includes('drop')) return 'drop';
  return 'known';
}
