// The SYNTHETIC never-mapped component families the corpse-harvest suites
// retag fixtures with.
//
// Until Masterwrought Phase 11m the suites used `gills` and `horn` for this:
// two families shipped content really tagged that HARVEST_COMPONENT_ITEMS
// (src/sim/content/professions.ts) did not map, so every "carried but
// unmapped" arm (#2509's pick-level refusal, #2513's corpse-level gate,
// #2514's concentration bonus) could be driven on a shipped template. 11m
// mapped both (state.md row 11m-ORPHAN: horn to curved_tusk, gills to
// mudfin_scale), so no shipped template carries an unmapped tag any more and
// every one of those arms needs a family that will NEVER gain a row.
//
// Two facts make these safe to build a fixture on, and both are pinned in
// tests/harvest_geography.test.ts rather than assumed here: no
// HARVEST_COMPONENT_ITEMS row maps either name, and no shipped template
// carries either tag. A suite that needs an unmapped family beside a mapped
// one retags a real, otherwise-untagged template with these for the duration
// of a callback (the withUnmappedTemplate idiom in
// tests/corpse_harvest_sim.test.ts) and restores it in a finally.
//
// Two names rather than one because several arms need a corpse made of
// NOTHING BUT unmapped families with more than one tag on it (the #2513
// all-unmapped shape has a two-tag width to prove the gate reads the table
// and not the count).
export const UNMAPPED_FAMILY = 'antler';
export const UNMAPPED_FAMILY_2 = 'fleece';
