import { GOURDLIGHT_TRICKS } from '../../sim/content/gourdlight_eve';
import {
  THATCHBOUND_CROW_AURA_ID,
  THATCHBOUND_STRAWLING_AURA_ID,
} from '../../sim/content/gourdlight_eve_scarecrow';
import { WILDHEART_TOADED } from '../../sim/mob/trash_kit/wildheart_cast_ids';

export const CHARACTER_FORM_FLAG = {
  sheep: 1 << 0,
  bear: 1 << 1,
  cat: 1 << 2,
  travel: 1 << 3,
  fireball: 1 << 4,
  metamorph: 1 << 5,
  sporemender: 1 << 6,
} as const;

export const CHARACTER_FORM_READY = {
  sheep: 1 << 0,
  bear: 1 << 1,
  cat: 1 << 2,
  travel: 1 << 3,
  metamorph: 1 << 4,
  sporemender: 1 << 5,
} as const;

export type CharacterFormVisual =
  | 'base'
  | 'sheep'
  | 'bear'
  | 'cat'
  | 'travel'
  | 'fireball'
  | 'metamorph'
  | 'sporemender';

export interface CharacterFormVisibility {
  base: boolean;
  sheep: boolean;
  bear: boolean;
  cat: boolean;
  travel: boolean;
  metamorph: boolean;
  sporemender: boolean;
}

export interface CharacterFormShadowPlan {
  activeArticulated: boolean;
  baseProxy: boolean;
  formProxy: boolean;
}

export interface CharacterFormShadowState {
  isSelf: boolean;
  nearShadow: boolean;
  inProxyBand: boolean;
  staticFar: boolean;
}

interface AuraIdentity {
  kind: string;
  id?: string;
}

export type CharacterFormKey =
  | 'form_sheep'
  | 'form_bear'
  | 'form_cat'
  | 'form_travel'
  | 'form_metamorph'
  | 'form_sporemender';

/** The polymorphs that wear a toad, not the sheep (the Sunbone Hexcaller's
 *  Toad Hex): still kind 'polymorph', so the one polymorph slot and its gate
 *  serve both; only the asset differs. */
export const TOAD_POLYMORPH_AURAS: ReadonlySet<string> = new Set([WILDHEART_TOADED]);

export type CharacterFormAssetKey =
  | CharacterFormKey
  | 'form_ghost_wolf'
  | 'form_toad'
  | 'form_foreman'
  | 'form_trick_bat'
  | 'form_trick_skeleton'
  | 'form_costume_ghost'
  | 'form_costume_goblin'
  | 'form_puppet_strawling'
  | 'form_puppet_crow';

/** The Gourdlight Eve tricks that wear a body (seasonal_trick_looks.ts): kind
 *  'seasonal_cosmetic', a LOOK on the polymorph slot with no control behind it. */
const TRICK_FORM_ASSETS: Readonly<Record<string, CharacterFormAssetKey>> = {
  [GOURDLIGHT_TRICKS[0].id]: 'form_trick_bat',
  [GOURDLIGHT_TRICKS[1].id]: 'form_trick_skeleton',
  // the costume draughts (content/gourdlight_eve.ts GOURDLIGHT_COSTUMES), the same bodies
  // for ten minutes, and the ghost of their own
  gourdlight_costume_skeleton: 'form_trick_skeleton',
  gourdlight_costume_ghost: 'form_costume_ghost',
  gourdlight_costume_bat: 'form_trick_bat',
  // the Gurglegreen Cauldron's drinker (round 11, seasonal/toy_cauldron.ts): the Coinsack
  // Scurrier's goblin body, worn the same way as a costume
  gourdlight_toy_gurglegreen: 'form_costume_goblin',
};

/** Thatchbound's puppet bodies (Old Thatchgrin's mind control): kind 'incapacitate', a
 *  real control, drawn on the polymorph slot like a polymorph is. */
const PUPPET_FORM_ASSETS: Readonly<Record<string, CharacterFormAssetKey>> = {
  [THATCHBOUND_STRAWLING_AURA_ID]: 'form_puppet_strawling',
  [THATCHBOUND_CROW_AURA_ID]: 'form_puppet_crow',
};

function puppetFormAsset(aura: AuraIdentity): CharacterFormAssetKey | null {
  if (aura.kind !== 'incapacitate' || aura.id === undefined) return null;
  return PUPPET_FORM_ASSETS[aura.id] ?? null;
}

function trickFormAsset(aura: AuraIdentity): CharacterFormAssetKey | null {
  if (aura.kind !== 'seasonal_cosmetic' || aura.id === undefined) return null;
  return TRICK_FORM_ASSETS[aura.id] ?? null;
}

/** The renderer shares one cat/wolf slot, but the two classes keep distinct
 *  assets; it shares one polymorph slot too, and a toad hex keeps its toad.
 *  The Metamorphosis slot is shared the same way by the Knucklebone of Balgath's
 *  Shape of the Foreman (kind `form_foreman`): its own cyclops rig, the slot's gate.
 *  Resolve at construction so every look stays behind the existing form gate. */
export function characterFormAssetKey(
  formKey: CharacterFormKey,
  auras: readonly AuraIdentity[],
): CharacterFormAssetKey {
  if (formKey === 'form_cat' && auras.some((aura) => aura.id === 'ghost_wolf')) {
    return 'form_ghost_wolf';
  }
  if (formKey === 'form_sheep') {
    // A real polymorph (control) outranks a trick's look; a trick shows only alone.
    if (auras.some(isToadPolymorph)) return 'form_toad';
    if (!auras.some((aura) => aura.kind === 'polymorph')) {
      // a puppet's body (a control) outranks a trick's look
      for (const aura of auras) {
        const puppet = puppetFormAsset(aura);
        if (puppet) return puppet;
      }
      for (const aura of auras) {
        const trick = trickFormAsset(aura);
        if (trick) return trick;
      }
    }
  }
  if (formKey === 'form_metamorph' && auras.some((aura) => aura.kind === 'form_foreman'))
    return 'form_foreman';
  return formKey;
}

function isToadPolymorph(aura: AuraIdentity): boolean {
  return aura.kind === 'polymorph' && aura.id !== undefined && TOAD_POLYMORPH_AURAS.has(aura.id);
}

/** Is the built polymorph rig (built from `builtKey`) the wrong animal for the
 *  polymorph the entity wears now (a sheep left from an earlier Polymorph
 *  under a Toad Hex, or the other way round)? Then the slot is rebuilt. */
export function polymorphRigStale(builtKey: string, auras: readonly AuraIdentity[]): boolean {
  return builtKey !== characterFormAssetKey('form_sheep', auras);
}

export function characterFormMaskForAura(aura: AuraIdentity): number {
  if (aura.kind === 'polymorph') return CHARACTER_FORM_FLAG.sheep;
  // A Gourdlight Eve trick body borrows the polymorph slot's look (no control).
  if (trickFormAsset(aura)) return CHARACTER_FORM_FLAG.sheep;
  // Thatchbound's puppet bodies ride the same slot (a real control, like a polymorph).
  if (puppetFormAsset(aura)) return CHARACTER_FORM_FLAG.sheep;
  if (aura.kind === 'form_bear') return CHARACTER_FORM_FLAG.bear;
  if (aura.kind === 'form_cat' || aura.id === 'ghost_wolf') {
    return CHARACTER_FORM_FLAG.cat;
  }
  if (aura.kind === 'form_travel') return CHARACTER_FORM_FLAG.travel;
  if (aura.kind === 'form_sporemender') return CHARACTER_FORM_FLAG.sporemender;
  if (aura.kind === 'form_fireball') return CHARACTER_FORM_FLAG.fireball;
  // `form_lich` is the current Necromancy marker and `form_metamorph` is the
  // legacy Warlock marker. They intentionally share presentation only; their
  // simulation mechanics remain independent and renderer-owned code never
  // rewrites either aura.
  if (aura.kind === 'form_metamorph' || aura.kind === 'form_lich') {
    return CHARACTER_FORM_FLAG.metamorph;
  }
  // The Shape of the Foreman rides the same slot with its own rig (characterFormAssetKey).
  if (aura.kind === 'form_foreman') return CHARACTER_FORM_FLAG.metamorph;
  return 0;
}

export function requestedCharacterForm(mask: number): CharacterFormVisual {
  if (mask & CHARACTER_FORM_FLAG.sheep) return 'sheep';
  if (mask & CHARACTER_FORM_FLAG.bear) return 'bear';
  if (mask & CHARACTER_FORM_FLAG.cat) return 'cat';
  if (mask & CHARACTER_FORM_FLAG.travel) return 'travel';
  if (mask & CHARACTER_FORM_FLAG.fireball) return 'fireball';
  if (mask & CHARACTER_FORM_FLAG.metamorph) return 'metamorph';
  if (mask & CHARACTER_FORM_FLAG.sporemender) return 'sporemender';
  return 'base';
}

function readyFlagFor(form: CharacterFormVisual): number {
  switch (form) {
    case 'sheep':
      return CHARACTER_FORM_READY.sheep;
    case 'bear':
      return CHARACTER_FORM_READY.bear;
    case 'cat':
      return CHARACTER_FORM_READY.cat;
    case 'travel':
      return CHARACTER_FORM_READY.travel;
    case 'metamorph':
      return CHARACTER_FORM_READY.metamorph;
    case 'sporemender':
      return CHARACTER_FORM_READY.sporemender;
    default:
      return 0;
  }
}

export function resolvedCharacterForm(
  requested: CharacterFormVisual,
  readyMask: number,
): CharacterFormVisual {
  if (requested === 'base' || requested === 'fireball') return requested;
  return readyMask & readyFlagFor(requested) ? requested : 'base';
}

/** A form rig counts as ready only once it can actually DRAW: built AND past
 *  its compile gate. `compilePending` is the shared pending-root token (null
 *  when nothing is linking); a rig whose root is that token is treated as
 *  absent, so `resolvedCharacterForm` keeps the entity on its base body until
 *  the rig links. Without that, the instant the rig was constructed the
 *  resolved form flipped to the form while the gate still hid it, and a
 *  polymorphed target had no silhouette at all for the whole gate window.
 *  Reads only `.root` identity, so it stays Three-free. */
export function characterFormReadyMask(
  sheep: unknown,
  bear: unknown,
  cat: unknown,
  travel: unknown,
  metamorph: unknown,
  sporemender: unknown,
  compilePending: unknown,
): number {
  let mask = 0;
  if (formRigReady(sheep, compilePending)) mask |= CHARACTER_FORM_READY.sheep;
  if (formRigReady(bear, compilePending)) mask |= CHARACTER_FORM_READY.bear;
  if (formRigReady(cat, compilePending)) mask |= CHARACTER_FORM_READY.cat;
  if (formRigReady(travel, compilePending)) mask |= CHARACTER_FORM_READY.travel;
  if (formRigReady(metamorph, compilePending)) mask |= CHARACTER_FORM_READY.metamorph;
  if (formRigReady(sporemender, compilePending)) mask |= CHARACTER_FORM_READY.sporemender;
  return mask;
}

function formRigReady(visual: unknown, compilePending: unknown): boolean {
  if (!visual) return false;
  if (compilePending === null || compilePending === undefined) return true;
  return (visual as { root?: unknown }).root !== compilePending;
}

export function activeCharacterFormVisual<T>(
  resolved: CharacterFormVisual,
  base: T,
  sheep: T | null,
  bear: T | null,
  cat: T | null,
  travel: T | null,
  metamorph: T | null,
  sporemender: T | null,
): T {
  switch (resolved) {
    case 'sheep':
      return sheep ?? base;
    case 'bear':
      return bear ?? base;
    case 'cat':
      return cat ?? base;
    case 'travel':
      return travel ?? base;
    case 'metamorph':
      return metamorph ?? base;
    case 'sporemender':
      return sporemender ?? base;
    default:
      return base;
  }
}

export function characterFormVisibility(resolved: CharacterFormVisual): CharacterFormVisibility {
  return {
    base: resolved === 'base',
    sheep: resolved === 'sheep',
    bear: resolved === 'bear',
    cat: resolved === 'cat',
    travel: resolved === 'travel',
    metamorph: resolved === 'metamorph',
    sporemender: resolved === 'sporemender',
  };
}

export function characterFormShadowPlan(
  resolved: CharacterFormVisual,
  state: CharacterFormShadowState,
): CharacterFormShadowPlan {
  const { isSelf, nearShadow, inProxyBand, staticFar } = state;
  if (resolved === 'fireball') {
    return {
      activeArticulated: false,
      baseProxy: false,
      formProxy: false,
    };
  }
  const isBase = resolved === 'base';
  const proxyBand = !isSelf && !nearShadow && inProxyBand;
  return {
    activeArticulated: isBase ? isSelf || nearShadow : isSelf || nearShadow || inProxyBand,
    baseProxy: proxyBand && isBase,
    formProxy: proxyBand && staticFar && !isBase,
  };
}
