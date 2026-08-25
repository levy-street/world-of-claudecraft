// The SYNTHETIC never-mapped component families the corpse-harvest suites
// retag fixtures with, and the ONE retag idiom they all share.
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
// of a callback through withRetaggedTemplates below, which restores the
// template in a finally.
//
// Two names rather than one because several arms need a corpse made of
// NOTHING BUT unmapped families with more than one tag on it (the #2513
// all-unmapped shape has a two-tag width to prove the gate reads the table
// and not the count).

import { MOBS } from '../../src/sim/data';

export const UNMAPPED_FAMILY = 'antler';
export const UNMAPPED_FAMILY_2 = 'fleece';

/**
 * Retag real, otherwise-untagged templates for the duration of `body`,
 * restored in a finally: the corpse-harvest suites' one idiom for the shapes
 * shipped content no longer carries (an all-unmapped corpse, a mixed corpse).
 *
 * THE PREMISE GUARD, checked here once rather than assumed in every suite:
 * every template named must be UNTAGGED as found (componentTags undefined),
 * so a retag replaces nothing and the restore puts back exactly the absence
 * it found. A template that already carries tags is refused with a throw
 * naming it, BEFORE any template is mutated, because retagging a shipped
 * carrier would borrow another case's fixture and the restore would put the
 * shipped tags back under a premise the arm never stated. The retag fixtures
 * today are warlock_imp, warlock_voidwalker and tunnel_rat; a red here means
 * one of them gained shipped tags, and the fix is to re-pick the fixture.
 */
export function withRetaggedTemplates<T>(
  retags: Readonly<Record<string, readonly string[]>>,
  body: () => T,
): T {
  const ids = Object.keys(retags);
  for (const id of ids) {
    const template = MOBS[id];
    if (template === undefined) {
      throw new Error(`${id} is not a shipped mob template; re-pick the retag fixture`);
    }
    if (template.componentTags !== undefined) {
      throw new Error(
        `${id} carries component tags [${template.componentTags.join(', ')}] as shipped; ` +
          're-pick the retag fixture',
      );
    }
  }
  const prior = new Map<string, string[] | undefined>();
  for (const id of ids) {
    prior.set(id, MOBS[id].componentTags);
    MOBS[id].componentTags = [...retags[id]];
  }
  try {
    return body();
  } finally {
    for (const [id, tags] of prior) MOBS[id].componentTags = tags;
  }
}
