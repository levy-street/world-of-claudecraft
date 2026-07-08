// MobileCoreKit: pure derivation of the mobile action-cluster mapping (the
// RoV / Arena-of-Valor style thumb cluster shown instead of the scrolling
// hotbar on touch devices) -- for EVERY class, with per-form kits where the
// class shapeshifts (druid) and per-player overrides on top.
//
// The cluster is NOT a new action system: each cluster button is a remap onto an
// EXISTING bar slot (the same barSlot indices castSlot / abilityForSlot /
// itemForSlot already speak), so casting, cooldowns, server validation, and the
// keybind path all reuse the action-bar family unchanged. This module only decides
// WHICH bar slot each cluster role shows:
//
//   attack    the curated "basic attack" ability (the class's spammable filler:
//             Heroic Strike, Frostbolt, Smite, Wrath / Maul / Claw, ...);
//             barSlot 0 (the fixed auto-attack toggle) when none is on the bar.
//   skill1-3  curated per-class/per-form picks first (in kit order), topped up
//             with the remaining learned bar abilities in bar order.
//   utility   the curated heal / defensive / buff / escape button, topped up the
//             same way. (There is deliberately NO ultimate button: ultimates are
//             not coded in the upstream game yet.)
//   potion    the first bar slot bound to a potion item.
//   form1-3   shapeshift toggles (druid bear/cat/travel) -- with the hotbar
//             replaced on touch these are the only shapeshift affordance; classes
//             without toggles hide them.
//
// RESOLUTION ORDER (highest first):
//   1. per-player OVERRIDES (localStorage, saved by character+class+form) -- a
//      role's override wins when that ability is learned and on the bar;
//   2. the curated kit for (class, form) via resolveMobileCoreKit;
//   3. bar-order top-up (first eligible action-bar slots), so an unknown class
//      or an empty kit still renders a usable cluster -- never broken buttons.
//
// Kits are ordered CANDIDATE lists: ids upstream has not implemented yet (see
// CLUSTER_PLACEHOLDER_IDS) simply never match and fall through to the next
// candidate -- safe placeholders that self-upgrade when upstream ships them.
//
// DOM-free and dependency-free on purpose (a UI_PURE_CORE, see
// tests/architecture.test.ts): the host (hud.ts) flattens its hotbarActions +
// resolved abilities into ClusterSourceSlot[] only when the bar actually changes,
// and diffing via clusterMapEquals keeps the per-frame path allocation-free. The
// curated ids are plain strings validated against the class kits by
// tests/mobile_cluster_view.test.ts, not an import of sim content.

/** The painter-driven cluster buttons, in render order. (The small target-cycle
 *  button is a plain callback button the host adds separately -- it is not an
 *  action-bar slot, so it is not a role here.) */
export const CLUSTER_ROLES = [
  'attack',
  'skill1',
  'skill2',
  'skill3',
  'utility',
  'potion',
  'form1',
  'form2',
  'form3',
] as const;

export type ClusterRole = (typeof CLUSTER_ROLES)[number];

/** Shapeshift toggle abilities (castable in any form; mirrors the host's
 *  FORM_TOGGLE_IDS). They claim the small form buttons and never the skills. */
export const CLUSTER_FORM_TOGGLE_IDS: ReadonlySet<string> = new Set([
  'bear_form',
  'cat_form',
  'travel_form',
]);

/** Number of plain skill buttons in the cluster (skill1..skill3). */
export const CLUSTER_SKILL_COUNT = 3;

/** Number of form-toggle buttons in the cluster (form1..form3). */
export const CLUSTER_FORM_COUNT = 3;

/** The cluster roles a player may override with a custom ability binding.
 *  potion picks items automatically and the form buttons are the shapeshift
 *  affordance, so neither is overridable. */
export const OVERRIDABLE_CLUSTER_ROLES = [
  'attack',
  'skill1',
  'skill2',
  'skill3',
  'utility',
] as const;

export type OverridableClusterRole = (typeof OVERRIDABLE_CLUSTER_ROLES)[number];

/** Per-player custom bindings: role -> ability id. Stored by the host in
 *  localStorage per character+class+form; an override only wins when that
 *  ability is learned and on the bar (otherwise the curated kit applies). */
export type ClusterOverrides = Partial<Record<OverridableClusterRole, string>>;

/** Curated ids referencing abilities upstream has NOT implemented yet. They are
 *  listed first in the kits so the cluster upgrades itself the moment upstream
 *  ships them; until then they never match and the next candidate wins. The test
 *  suite checks every curated id is either a real ability or listed here. */
export const CLUSTER_PLACEHOLDER_IDS: ReadonlySet<string> = new Set([
  // druid (Milestone 4)
  'starsurge',
  'starfall',
  'swiftmend',
  'mangle',
  'ironfur',
  'thrash',
  'frenzied_regeneration',
  'shred',
  'berserk',
  'moonkin_strike',
  // all-class expansion (Milestone 5)
  'shield_slam',
  'whirlwind',
  'blizzard',
  'blink',
  'holy_fire',
  'multi_shot',
  'freezing_trap',
  'disengage',
  'healthstone',
  'crusader_strike',
  'chain_lightning',
]);

/** A class's (or druid form's) curated cluster picks: ordered CANDIDATE lists,
 *  first-found-on-bar wins, so a low-level character who hasn't learned the
 *  primary pick degrades to the next one (and past the list, to the bar-order
 *  top-up). `attack` is optional: without it the big button stays the classic
 *  auto-attack / attack-nearest toggle. */
export interface MobileCoreKit {
  attack?: readonly string[];
  skills: readonly string[];
  utility: readonly string[];
}

/** Curated core kit per class: attack = the spammable filler; skills = primary
 *  damage/heal/threat, then utility/mobility/DoT, then AoE/burst/CC; utility =
 *  heal / buff / escape / defensive. Ability ids come from
 *  src/sim/content/classes.ts; placeholder-led entries encode the requested
 *  loadout for abilities upstream hasn't shipped. */
export const MOBILE_CORE_KITS: Record<string, MobileCoreKit> = {
  warrior: {
    attack: ['heroic_strike'],
    skills: ['charge', 'shield_slam', 'rend', 'whirlwind', 'cleave', 'thunder_clap', 'execute'],
    utility: ['defensive_stance', 'battle_shout', 'bloodrage'],
  },
  mage: {
    attack: ['frostbolt'],
    skills: ['fireball', 'frost_nova', 'blizzard', 'arcane_missiles', 'fire_blast', 'polymorph'],
    utility: ['blink', 'ice_barrier', 'frost_armor'],
  },
  priest: {
    attack: ['smite'],
    skills: ['heal', 'power_word_shield', 'holy_fire', 'shadow_word_pain', 'mind_blast'],
    utility: ['renew', 'flash_heal', 'lesser_heal'],
  },
  rogue: {
    attack: ['sinister_strike'],
    skills: ['backstab', 'eviscerate', 'gouge', 'ambush', 'kidney_shot'],
    utility: ['sprint', 'evasion', 'slice_and_dice'],
  },
  hunter: {
    attack: ['arcane_shot'],
    skills: [
      'multi_shot',
      'aimed_shot',
      'serpent_sting',
      'freezing_trap',
      'concussive_shot',
      'raptor_strike',
    ],
    utility: ['disengage', 'aspect_of_the_hawk', 'rapid_fire'],
  },
  warlock: {
    attack: ['shadow_bolt'],
    skills: ['corruption', 'drain_life', 'fear', 'immolate', 'curse_of_agony'],
    utility: ['healthstone', 'demon_skin', 'life_tap'],
  },
  paladin: {
    attack: ['crusader_strike', 'judgement'],
    skills: ['judgement', 'consecration', 'holy_light', 'hammer_of_justice', 'exorcism'],
    utility: ['divine_protection', 'lay_on_hands', 'flash_of_light'],
  },
  shaman: {
    attack: ['lightning_bolt'],
    skills: ['flame_shock', 'earth_shock', 'chain_lightning', 'stormstrike', 'frost_shock'],
    utility: ['healing_wave', 'lightning_shield', 'rockbiter_weapon'],
  },
  // The druid entry is the caster ("humanoid") form; DRUID_FORM_CORE_KITS below
  // carries the bear/cat kits and aliases 'normal' to this one. A moonkin form
  // does not exist upstream yet, so the caster kit doubles as the boomkin
  // loadout (moonkin_strike / starsurge / starfall are placeholder candidates).
  druid: {
    attack: ['moonkin_strike', 'wrath'],
    skills: ['moonfire', 'starsurge', 'starfire', 'starfall', 'insect_swarm', 'entangling_roots'],
    utility: ['swiftmend', 'rejuvenation', 'regrowth', 'healing_touch'],
  },
};

/** Druid per-form kits, keyed by the host's HotbarForm ('normal' falls back to
 *  the class entry above). Real bear-bar ids today: bear_charge, maul, growl,
 *  demoralizing_roar, swipe, enrage, bash; cat-bar ids: prowl, rake, claw,
 *  ferocious_bite, dash, pounce, tigers_fury, rip (see requiresForm in
 *  src/sim/content/classes.ts). Placeholder candidates lead where the requested
 *  ability isn't coded yet. */
export const DRUID_FORM_CORE_KITS: Record<string, MobileCoreKit> = {
  normal: MOBILE_CORE_KITS.druid,
  bear: {
    attack: ['maul'],
    skills: ['mangle', 'swipe', 'ironfur', 'enrage', 'thrash', 'demoralizing_roar', 'bash'],
    utility: ['growl', 'frenzied_regeneration', 'bash'],
  },
  cat: {
    attack: ['claw'],
    skills: ['shred', 'rake', 'rip', 'ferocious_bite', 'pounce', 'tigers_fury'],
    utility: ['dash', 'pounce', 'berserk', 'tigers_fury', 'prowl'],
  },
};

/** Resolve the curated kit for a class + hotbar form. Druids are form-aware
 *  (bear/cat kits, everything else -> the caster kit); other classes ignore the
 *  form (rogue 'stealth' keeps the rogue kit). Null when the class is unknown --
 *  deriveClusterMap then fills every button from bar order, so even an
 *  unrecognized class renders a working cluster. */
export function resolveMobileCoreKit(playerClass: string, form: string): MobileCoreKit | null {
  if (playerClass === 'druid') {
    return DRUID_FORM_CORE_KITS[form] ?? MOBILE_CORE_KITS.druid;
  }
  return MOBILE_CORE_KITS[playerClass] ?? null;
}

/** One bar slot flattened by the host for the derivation. `kind` is 'ability' only
 *  for LEARNED abilities (unlearned bindings must be flattened as 'other' so they
 *  never claim a cluster button); `abilityId` accompanies 'ability' entries so the
 *  curated kit can match. */
export interface ClusterSourceSlot {
  barSlot: number;
  kind: 'ability' | 'potion' | 'other';
  abilityId?: string;
}

/** The derived mapping: cluster role -> barSlot. `attack` is 0 (the classic
 *  auto-attack toggle) unless a curated basic-attack ability is on the bar; the
 *  other roles are null when no candidate exists (the host renders that button
 *  empty and CSS hides it). */
export type ClusterMap = Record<'attack', number> &
  Record<Exclude<ClusterRole, 'attack'>, number | null>;

/** The all-empty mapping a fresh host starts from (attack is always live). */
export function emptyClusterMap(): ClusterMap {
  return {
    attack: 0,
    skill1: null,
    skill2: null,
    skill3: null,
    utility: null,
    potion: null,
    form1: null,
    form2: null,
    form3: null,
  };
}

function findAbility(
  source: readonly ClusterSourceSlot[],
  abilityId: string,
): ClusterSourceSlot | null {
  for (const slot of source) {
    if (slot.kind === 'ability' && slot.abilityId === abilityId) return slot;
  }
  return null;
}

/**
 * Derive the cluster mapping from the flattened bar: per-player overrides win,
 * then the curated kit, then bar-order top-up. Pure: same input, same output;
 * allocates only per call (call on bar/form changes, not per frame).
 */
export function deriveClusterMap(
  source: readonly ClusterSourceSlot[],
  kit: MobileCoreKit | null = null,
  overrides: ClusterOverrides | null = null,
): ClusterMap {
  const map = emptyClusterMap();
  const claimed: number[] = [];

  // A shared claim helper: skip empty finds and already-claimed slots.
  const claim = (slot: ClusterSourceSlot | null): number | null => {
    if (slot === null || claimed.includes(slot.barSlot)) return null;
    claimed.push(slot.barSlot);
    return slot.barSlot;
  };
  const claimOverride = (role: OverridableClusterRole): number | null => {
    const id = overrides?.[role];
    if (id === undefined || CLUSTER_FORM_TOGGLE_IDS.has(id)) return null;
    return claim(findAbility(source, id));
  };

  // Claim EVERY override up front, before any curated fill: a player's binding
  // must never lose its slot to a curated pick for a different role.
  const attackOverride = claimOverride('attack');
  const skillRoles = ['skill1', 'skill2', 'skill3'] as const;
  const skills: (number | null)[] = skillRoles.map((role) => claimOverride(role));
  const utilityOverride = claimOverride('utility');

  // The basic attack: the player's override, else the first curated candidate on
  // the bar, else the fixed auto-attack slot 0 (which no other role can claim).
  if (attackOverride !== null) {
    map.attack = attackOverride;
  } else {
    for (const id of kit?.attack ?? []) {
      const slot = claim(findAbility(source, id));
      if (slot !== null) {
        map.attack = slot;
        break;
      }
    }
  }

  // form1..3: shapeshift toggles, claimed BEFORE the skills so they always land
  // on the small form buttons (the touch UI's only shapeshift affordance) and
  // never crowd a skill slot.
  const forms: number[] = [];
  for (const slot of source) {
    if (forms.length >= CLUSTER_FORM_COUNT) break;
    if (slot.kind !== 'ability' || slot.abilityId === undefined) continue;
    if (!CLUSTER_FORM_TOGGLE_IDS.has(slot.abilityId)) continue;
    const got = claim(slot);
    if (got !== null) forms.push(got);
  }
  map.form1 = forms[0] ?? null;
  map.form2 = forms[1] ?? null;
  map.form3 = forms[2] ?? null;

  // skill1..3: overridden positions were claimed above; the remaining positions
  // COMPACT-FILL from curated picks in kit order first...
  const fillSkill = (slot: ClusterSourceSlot | null) => {
    const at = skills.indexOf(null);
    if (at === -1) return;
    const got = claim(slot);
    if (got !== null) skills[at] = got;
  };
  for (const id of kit?.skills ?? []) fillSkill(findAbility(source, id));

  // utility: override (claimed up front), then the curated candidate. Resolved
  // BEFORE the skills' bar-order top-up so a curated utility ability sitting on
  // the bar is reserved for the utility button instead of being swept up as a
  // filler skill (the curated heal/defensive intent beats generic skill filler).
  map.utility = utilityOverride;
  if (map.utility === null) {
    for (const id of kit?.utility ?? []) {
      map.utility = claim(findAbility(source, id));
      if (map.utility !== null) break;
    }
  }

  // ...then top up any still-empty skill slots with the remaining learned bar
  // abilities in bar order.
  for (const slot of source) {
    if (slot.kind === 'ability') fillSkill(slot);
  }
  map.skill1 = skills[0];
  map.skill2 = skills[1];
  map.skill3 = skills[2];

  // utility bar-order fallback: the next unclaimed bar ability when neither an
  // override nor a curated pick applied.
  if (map.utility === null) {
    for (const slot of source) {
      if (slot.kind !== 'ability') continue;
      map.utility = claim(slot);
      if (map.utility !== null) break;
    }
  }

  // potion: the first potion-bound bar slot.
  for (const slot of source) {
    if (slot.kind === 'potion') {
      map.potion = slot.barSlot;
      break;
    }
  }

  return map;
}

/** Role-wise equality, so the host can skip rebinding when a re-derive lands on
 *  the same mapping. */
export function clusterMapEquals(a: ClusterMap, b: ClusterMap): boolean {
  for (const role of CLUSTER_ROLES) {
    if (a[role] !== b[role]) return false;
  }
  return true;
}

/** Parse a persisted overrides blob (localStorage JSON) into a validated
 *  ClusterOverrides: only overridable roles, only string ids, everything else
 *  dropped. Null when nothing valid remains. */
export function parseClusterOverrides(raw: unknown): ClusterOverrides | null {
  if (raw === null || typeof raw !== 'object') return null;
  const out: ClusterOverrides = {};
  let any = false;
  for (const role of OVERRIDABLE_CLUSTER_ROLES) {
    const id = (raw as Record<string, unknown>)[role];
    if (typeof id === 'string' && id.length > 0 && !CLUSTER_FORM_TOGGLE_IDS.has(id)) {
      out[role] = id;
      any = true;
    }
  }
  return any ? out : null;
}
