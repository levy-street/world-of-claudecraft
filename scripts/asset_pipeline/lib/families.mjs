// Asset category and weapon-family specs the pipeline normalizes against.
//
// The weapon numbers are MEASURED from the shipped variant packs (see the grip
// convention in src/render/characters/assets.ts: the mesh origin IS the grip,
// blade along +Y, and VARIANT_GRIPS only ever scales oversized models DOWN).
// gripFrac = how far above the mesh bottom the origin sits, as a fraction of
// total height. height = the family's typical world-unit height; keep it under
// maxHeight (the engine clamp) so new weapons keep their native scale.
//
// Measured averages (public/models/weapons, July 2026):
//   sword 0.178 (h 2.21), dagger 0.186 (h 1.28), axe/hammer 0.260 (h 1.46),
//   staff 0.403 (h 2.28), wand 0.271 (h 1.09), polearm 0.353 (h 2.67)

/** Weapon families, keyed by the VAR_* grip family in KAYKIT_WEAPON_ACCESSORY.
 *  `tokens`: tests/held_weapon_models.test.ts requires the variant key to contain
 *  one of these. `bladeUp`: whether the small (pointy) end goes up (+Y); heavy
 *  headed weapons (axe/hammer) carry their mass at the top instead. */
export const WEAPON_FAMILIES = {
  sword: {
    grip: 'VAR_SWORD',
    tokens: ['sword'],
    gripFrac: 0.18,
    height: 2.0,
    maxHeight: 2.0,
    lift: 0.04,
    heavyEndUp: false,
  },
  dagger: {
    grip: 'VAR_DAGGER',
    tokens: ['dagger', 'knife'],
    gripFrac: 0.19,
    height: 1.28,
    maxHeight: 1.4,
    lift: 0.04,
    heavyEndUp: false,
  },
  axe: {
    grip: 'VAR_AXE',
    tokens: ['axe'],
    gripFrac: 0.26,
    height: 1.45,
    maxHeight: 1.5,
    lift: 0.04,
    heavyEndUp: true,
  },
  // Hammers were formerly folded into the axe family (so "gen a hammer" produced
  // an axe-shaped model); split out with their own VAR_HAMMER grip so the prompt
  // reads "fantasy hammer" and generation actually yields one. Same top-heavy
  // physical profile as an axe (identical grip numbers), just a distinct type.
  hammer: {
    grip: 'VAR_HAMMER',
    tokens: ['hammer', 'maul', 'warhammer'],
    gripFrac: 0.26,
    height: 1.45,
    maxHeight: 1.5,
    lift: 0.04,
    heavyEndUp: true,
  },
  // One-handed bludgeon: a heavy head on a shaft (mace/flail/morningstar). Carries
  // its mass at the top like the axe/hammer, so it is generated head-up.
  mace: {
    grip: 'VAR_MACE',
    tokens: ['mace', 'flail', 'morningstar', 'cudgel'],
    gripFrac: 0.26,
    height: 1.4,
    maxHeight: 1.5,
    lift: 0.04,
    heavyEndUp: true,
  },
  staff: {
    grip: 'VAR_STAFF',
    tokens: ['staff'],
    gripFrac: 0.4,
    height: 2.28,
    maxHeight: 2.4,
    lift: 0.18,
    heavyEndUp: true,
  },
  wand: {
    grip: 'VAR_WAND',
    tokens: ['wand'],
    gripFrac: 0.27,
    height: 1.09,
    maxHeight: 1.2,
    lift: 0.04,
    heavyEndUp: false,
  },
  polearm: {
    grip: 'VAR_POLEARM',
    tokens: ['halberd', 'spear', 'scythe'],
    gripFrac: 0.35,
    height: 2.5,
    maxHeight: 2.5,
    lift: 0.18,
    heavyEndUp: false,
  },
  // Caster tome, held roughly mid-body in one hand; small, so the origin sits
  // near the middle. A book has no blade/head, so its generation orientation is
  // set explicitly in prompts.mjs; fine-tune the in-hand pose per weapon via the
  // viewer's GRIP FIT (WEAPON_GRIP_OVERRIDES).
  book: {
    grip: 'VAR_BOOK',
    tokens: ['book', 'tome', 'grimoire', 'codex'],
    gripFrac: 0.5,
    height: 1.0,
    maxHeight: 1.2,
    lift: 0.04,
    heavyEndUp: false,
  },
  // Two-handed ranged; generated tip-up like a blade, then rotated to point
  // forward in-hand via a per-weapon GRIP FIT override.
  crossbow: {
    grip: 'VAR_CROSSBOW',
    tokens: ['crossbow', 'xbow'],
    gripFrac: 0.28,
    height: 1.4,
    maxHeight: 1.6,
    lift: 0.04,
    heavyEndUp: false,
  },
  // Two-handed ranged bow (longbow/shortbow/recurve): gripped at the CENTER, so
  // the origin sits mid-height. Generated as a vertical bow, then angled to the
  // archer's in-hand pose via a per-weapon GRIP FIT override (like the crossbow).
  // Declared AFTER crossbow so a "*crossbow" key matches crossbow first ("bow" is
  // a substring of "crossbow").
  bow: {
    grip: 'VAR_BOW',
    tokens: ['bow', 'longbow', 'shortbow', 'recurve'],
    gripFrac: 0.5,
    height: 1.8,
    maxHeight: 2.0,
    lift: 0.04,
    heavyEndUp: false,
  },
};

/** Resolve a family from a weapon kind or variant-key token. */
export function weaponFamilyFor(kindOrKey) {
  const s = String(kindOrKey).toLowerCase();
  if (WEAPON_FAMILIES[s]) return { name: s, ...WEAPON_FAMILIES[s] };
  for (const [name, fam] of Object.entries(WEAPON_FAMILIES)) {
    if (fam.tokens.some((t) => s.includes(t))) return { name, ...fam };
  }
  return null;
}

/** Per-category generation and budget targets, matched to the shipped asset
 *  quality bar (weapons ~300 tris/10-70 KB, props ~300-6k tris, creatures
 *  ~2-4k tris/40-350 KB; textures WebP <= 512px, flat low-poly style). */
export const CATEGORY_SPECS = {
  weapon: {
    outDir: 'public/models/weapons',
    faceLimit: 800,
    maxTex: 512,
    maxBytes: 120 * 1024,
    maxTris: 1500,
  },
  prop: {
    outDir: 'public/models/props',
    faceLimit: 2000,
    maxTex: 512,
    maxBytes: 350 * 1024,
    maxTris: 6000,
  },
  creature: {
    outDir: 'public/models/creatures',
    faceLimit: 4000,
    maxTex: 512,
    maxBytes: 1536 * 1024,
    maxTris: 8000,
  },
  // Player-grade cosmetic bodies (the skinmodel lane): best-quality generation
  // (v3.1 + smart_low_poly) runs richer than mob-grade creatures; shipped class
  // models are 5.8k-8k tris and the chars budget absorbs ~2MB heroes.
  skinmodel: {
    outDir: 'public/models/chars/skins',
    faceLimit: 8000,
    maxTex: 1024,
    maxBytes: 2560 * 1024,
    maxTris: 11000,
  },
};

/** Game clip vocabulary a creature/humanoid ClipMap needs, mapped onto the Tripo
 *  preset animation libraries (see lib/tripo.mjs). `biped90` is the rig model
 *  v1.0-20240301 library (biped only, preset:biped:*); `basic` is the rig model
 *  v2.5-20260210 library (all rig types, preset:*). Order matters: the first
 *  preset that retargets successfully wins the game clip name. */
export const BIPED_CLIP_PLAN = [
  { game: 'Idle', presets: ['preset:biped:idle'] },
  { game: 'Walk', presets: ['preset:biped:walk'] },
  { game: 'Run', presets: ['preset:biped:run'] },
  { game: 'Attack', presets: ['preset:biped:slash'] },
  { game: 'Hit', presets: ['preset:biped:hit_to_body_01'] },
  { game: 'Death', presets: ['preset:biped:defeat_02'] },
  { game: 'Cast', presets: ['preset:biped:cast_a_spell'] },
  { game: 'Jump', presets: ['preset:biped:jump'] },
];

/** Minimal plan for non-biped rig types (rig model v2.5-20260210 presets). The
 *  walk preset name depends on the detected rig_type. Idle/attack/death have no
 *  dedicated non-biped presets; the integrator maps walk into those slots and
 *  flags the gaps in the report. */
export function quadClipPlan(rigType) {
  const walk = {
    quadruped: 'preset:quadruped:walk',
    hexapod: 'preset:hexapod:walk',
    octopod: 'preset:octopod:walk',
    serpentine: 'preset:serpentine:march',
    aquatic: 'preset:aquatic:march',
  }[rigType];
  if (!walk) return null;
  return [{ game: 'Walk', presets: [walk] }];
}

/** ClipMap snippet fields required by src/render/characters/manifest.ts. */
export const REQUIRED_CLIPMAP_FIELDS = ['idle', 'walk', 'run', 'attack', 'death'];

/** The FULL KayKit-vocabulary clip plan for generated PLAYER-GRADE bodies
 *  (the skinmodel lane). Clips are retargeted from the Tripo biped preset
 *  library (rig model v1.0-20240301, preset:biped:*) and named with the EXACT
 *  KayKit clip names the game's kaykit() ClipMap factory expects, so a
 *  generated body integrates with `clips: kaykit([...])` like every shipped
 *  class model, and the animation STYLE stays coherent with the KayKit set.
 *  `game` entries listed as arrays copy one retargeted clip under several
 *  KayKit names (sit covers both floor-sit clips). Presets without a KayKit
 *  equivalent (Walking_Backwards, Block, strafes, Spellcast_Raise) are omitted:
 *  the game's baseAction()/emote fallbacks degrade gracefully to idle/walk. */
export const KAYKIT_CLIP_PLAN = [
  { game: 'Idle', presets: ['preset:biped:idle'] },
  { game: 'Walking_A', presets: ['preset:biped:walk'] },
  { game: 'Running_A', presets: ['preset:biped:run'] },
  { game: '1H_Melee_Attack_Chop', presets: ['preset:biped:slash'] },
  { game: '2H_Melee_Attack_Chop', presets: ['preset:biped:chop'] },
  { game: '2H_Ranged_Shoot', presets: ['preset:biped:shoot'] },
  { game: 'Spellcasting', presets: ['preset:biped:cast_a_spell'] },
  { game: 'Spellcast_Shoot', presets: ['preset:biped:fire'] },
  { game: 'Hit_A', presets: ['preset:biped:hit_to_body_01'] },
  { game: 'Death_A', presets: ['preset:biped:defeat_02'] },
  { game: 'Jump_Idle', presets: ['preset:biped:jump'] },
  { game: ['Sit_Floor_Down', 'Sit_Floor_Idle'], presets: ['preset:biped:sit'] },
  { game: 'Lie_Idle', presets: ['preset:biped:swim'] },
  { game: 'Cheer', presets: ['preset:biped:cheer'] },
];

/** The KayKit clip names a player-grade body must carry as a minimum for the
 *  kaykit() ClipMap to fully drive it (attack slot name depends on the class). */
export const KAYKIT_REQUIRED_CLIPS = [
  'Idle',
  'Walking_A',
  'Running_A',
  '1H_Melee_Attack_Chop',
  'Death_A',
];
