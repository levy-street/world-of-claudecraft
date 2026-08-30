// Deliberately retired i18n catalog keys - the ONE shared source (Phase 14).
//
// Consumed by THREE places that must always agree:
//   - tests/guide_key_coverage.test.ts: the guide coverage sweep's allowlist
//     (a retired key may render nowhere; a live key may never hide here),
//   - scripts/i18n_scan.mjs: a retired key's unprovided locale rows become
//     `blocked` registry rows (with RETIRED_REASON), never `pending`, so the
//     release fill pass is not asked to translate prose that never renders,
//   - scripts/i18n_build.mjs: the runtime `pending` set excludes them the
//     same way (the build and the registry stay in lockstep).
//
/**
 * Keys kept in the catalog on purpose with NO live consumer left in the code.
 *
 * The catalog cannot simply drop them: every locale overlay under src/ui/i18n.locales/
 * still carries a reviewed translation for each one, and the maintainer's release fill
 * works from the catalog. Deleting the English source would orphan 21 locale rows and
 * (for the placeholder migrations below) throw away prose a human already reviewed.
 *
 * Nothing distinguished a deliberately retired key from a key a page stopped rendering by
 * accident until this list existed. Retiring a key is now an explicit, reviewed act: add
 * it here WITH ITS REASON, or the guide coverage sweep fails.
 *
 * The rule that keeps this list honest: a retired key must have NO reference left in
 * src/. The `has no live reference` test in tests/guide_key_coverage.test.ts proves it,
 * so this list can never be used to silence a key that a page really does try to render.
 */
export const RETIRED_KEYS = [
  // -- Placeholder migrations. A {placeholder} may never be added to an already-translated
  // key: it breaks interpolation parity in all 21 locales. Each of these was replaced by a
  // NEW *Count key carrying the token, and the original stays behind, untouched.
  'guide.faqPage.a6', // -> guide.faqPage.a6Count ({zones})
  'guide.home.faq.a4', // -> guide.home.faq.a4Count ({zones})
  'guide.home.world.sub', // -> guide.home.world.subCount ({zones})
  'guide.progression.journeyBody', // -> guide.progression.journeyBodyCount ({zones})

  // -- Reworded successors. The replacement says something materially different, so the
  // old value is not a stale translation to fix but a claim the game no longer makes.
  'guide.gear.soulboundBody', // -> guide.gear.soulboundBodyBound (bind-on-trade rules)
  'guide.profPages.ench.enchantsNote', // -> guide.profPages.ench.enchantsNoteOffhand
  'guide.profPages.specimenBody', // -> guide.profPages.specimenBodyFamilies
  'guide.professions.focusBody', // -> guide.professions.focusBodyTiers
  'guide.professions.harvestBodyChoice', // folded into the harvest section's body copy
  // -> guide.profPages.gatherDeeds.farmingSown (farming gained its own deeds at D13)
  'guide.profPages.gatherDeeds.farming',

  // -- Content the game no longer has, so the wiki must not define it.
  // The glossary defined Augment as a draft pick in a two-on-two Fiesta match.
  // Fiesta is retired and is not among the tabs the PvP window offers, so the term
  // described content no player can reach.
  'guide.glossary.augmentTerm',
  'guide.glossary.augmentDef',
  'guide.bestiary.flavor.mirejaw_frenzy', // summon-only encounter add, filtered from the bestiary
  'guide.footer.communityWiki', // the standalone MediaWiki redirect this SPA replaced

  // -- Superseded by generated content. These were hand-written dungeon facts before
  // GUIDE_DUNGEONS carried the roster; the page now renders names and level bands from
  // the sim, so a hardcoded name here could only ever drift.
  'guide.dungeonsPage.bastionName',
  'guide.dungeonsPage.hollowName',
  'guide.dungeonsPage.sanctumName',
  'guide.dungeonsPage.templeName',
  'guide.dungeonsPage.levelAround',
  'guide.dungeonsPage.raidSize',

  // -- Label variants a redesign dropped. The information still reaches the reader; only
  // this presentation of it is gone.
  'guide.classPage.roleLabel', // role and resource are hero badges now, using the
  'guide.classPage.resourceLabel', // shared classDetails.labels.* keys
  'guide.delvesPage.affixesLabel', // the affix pills sit under affixesHeading instead
  'guide.professions.craftHowTitle', // the crafting-window section was folded into craftBody
  'guide.nav.onThisPage', // the in-page TOC is labelled by guide.toc.heading
  'guide.nav.reference', // the sidebar heading comes from guide.groups.reference
  'guide.nav.backToGame', // the guide links out with guide.nav.playNow
  'guide.brandShort', // every surface renders the full guide.brand
  'guide.loading', // the SPA shell paints its own skeleton, never a loading string
  'guide.models.count', // the models page heads its grid without a running count

  // -- Orphaned by a computed key whose input set moved.
  // guide.groups.<GuideGroup>: 'compendium' was the single pre-split bucket, and is no
  // longer a GuideGroup (see the split comment in src/guide/routes.ts).
  'guide.groups.compendium',
  // guide.classHook.<classId>: the one-line class teaser. The class chooser renders the
  // curated feel tags from src/guide/class_meta.ts instead, so nothing calls it any more.
  'guide.classHook.druid',
  'guide.classHook.hunter',
  'guide.classHook.mage',
  'guide.classHook.paladin',
  'guide.classHook.priest',
  'guide.classHook.rogue',
  'guide.classHook.shaman',
  'guide.classHook.warlock',
  'guide.classHook.warrior',
  // guide.abilityHook.<abilityId>: rendered by class_view.ts for the first six hook-carrying
  // abilities in a class's GENERATED signature kit (scripts/wiki/build_content.mjs takes
  // kit-with-hook then slice(0, 6)). A key lands here when no class page asks for it any
  // more. ('thorns' also resolves through src/ui/talent_i18n.ts, so it sits in
  // LIVE_OFF_SWEEP_KEYS below instead.)
  // These nine are mage abilities an earlier kit refresh already dropped from that slice.
  'guide.abilityHook.blizzard',
  'guide.abilityHook.brain_freeze',
  'guide.abilityHook.conjure_food',
  'guide.abilityHook.fingers_of_frost',
  'guide.abilityHook.fireball_form',
  'guide.abilityHook.flurry',
  'guide.abilityHook.frozen_orb',
  'guide.abilityHook.ice_lance',
  'guide.abilityHook.shatter',
  // The v0.31 class overhauls rebuilt every kit. 'judgement' no longer exists as an ability
  // at all, and the next three are hiddenFromPlayer PALADIN_LEGACY ids kept only for the
  // persisted action-bar contract, so the class page can never list any of them.
  'guide.abilityHook.judgement',
  'guide.abilityHook.blessing_of_might',
  'guide.abilityHook.devotion_aura',
  'guide.abilityHook.seal_of_righteousness',
  // The rest are live abilities whose hooks fell out of the six signature slots when the
  // overhauls reordered kits and spec-gated abilities ('primal_exaltation' and 'stoneward'
  // left the kits entirely). The hook prose stays reviewed in every locale; a kit reorder
  // that surfaces one again simply removes it from this list.
  'guide.abilityHook.ancestor_return',
  'guide.abilityHook.arcane_shot',
  'guide.abilityHook.avenging_wrath',
  'guide.abilityHook.bastion_sweep',
  'guide.abilityHook.concussive_shot',
  'guide.abilityHook.earth_shock',
  'guide.abilityHook.flame_shock',
  'guide.abilityHook.hammer_of_wrath',
  'guide.abilityHook.healing_wave',
  'guide.abilityHook.life_tap',
  'guide.abilityHook.lifespring_weapon',
  'guide.abilityHook.lightning_shield',
  'guide.abilityHook.mongoose_bite',
  'guide.abilityHook.oath_chain',
  'guide.abilityHook.primal_exaltation',
  'guide.abilityHook.stoneward',
  'guide.abilityHook.stormsurge',
  'guide.abilityHook.tidecall',
  'guide.abilityHook.veilbound_march',
  // Phase 16 (2026-08-30) rewords, the reword-is-a-new-key convention: each
  // retired body's replacement renders in its place (masterwroughtBodyLegendary,
  // identityBodyOneMeal, enchantsNoteInfusionLive, tableBodyOneMeal); the old
  // keys keep their reviewed overlay fills until the release fill retires them.
  'guide.gear.masterwroughtBody',
  'guide.profPages.craftProse.cooking.identityBody',
  'guide.profPages.ench.enchantsNoteOffhand',
  'guide.profPages.farm.tableBody',
];

export const RETIRED_KEY_SET = new Set(RETIRED_KEYS);

// The reason stamped on every retired blocked row in the registry.
export const RETIRED_REASON =
  'Retired key: kept only for its reviewed overlay rows and the release-fill ledger; no page renders it (tests/guide_key_coverage.test.ts RETIRED_KEYS), so it is never a fill work item.';
