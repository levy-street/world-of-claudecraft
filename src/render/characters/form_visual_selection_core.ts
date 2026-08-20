export const CHARACTER_FORM_FLAG = {
  sheep: 1 << 0,
  bear: 1 << 1,
  cat: 1 << 2,
  travel: 1 << 3,
  fireball: 1 << 4,
  metamorph: 1 << 5,
} as const;

export const CHARACTER_FORM_READY = {
  sheep: 1 << 0,
  bear: 1 << 1,
  cat: 1 << 2,
  travel: 1 << 3,
  metamorph: 1 << 4,
} as const;

export type CharacterFormVisual =
  | 'base'
  | 'sheep'
  | 'bear'
  | 'cat'
  | 'travel'
  | 'fireball'
  | 'metamorph';

export interface CharacterFormVisibility {
  base: boolean;
  sheep: boolean;
  bear: boolean;
  cat: boolean;
  travel: boolean;
  metamorph: boolean;
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

export function characterFormMaskForAura(aura: AuraIdentity): number {
  if (aura.kind === 'polymorph') return CHARACTER_FORM_FLAG.sheep;
  if (aura.kind === 'form_bear') return CHARACTER_FORM_FLAG.bear;
  if (aura.kind === 'form_cat' || aura.id === 'ghost_wolf') {
    return CHARACTER_FORM_FLAG.cat;
  }
  if (aura.kind === 'form_travel') return CHARACTER_FORM_FLAG.travel;
  if (aura.kind === 'form_fireball') return CHARACTER_FORM_FLAG.fireball;
  // `form_lich` is the current Necromancy marker and `form_metamorph` is the
  // legacy Warlock marker. They intentionally share presentation only; their
  // simulation mechanics remain independent and renderer-owned code never
  // rewrites either aura.
  if (aura.kind === 'form_metamorph' || aura.kind === 'form_lich') {
    return CHARACTER_FORM_FLAG.metamorph;
  }
  return 0;
}

export function requestedCharacterForm(mask: number): CharacterFormVisual {
  if (mask & CHARACTER_FORM_FLAG.sheep) return 'sheep';
  if (mask & CHARACTER_FORM_FLAG.bear) return 'bear';
  if (mask & CHARACTER_FORM_FLAG.cat) return 'cat';
  if (mask & CHARACTER_FORM_FLAG.travel) return 'travel';
  if (mask & CHARACTER_FORM_FLAG.fireball) return 'fireball';
  if (mask & CHARACTER_FORM_FLAG.metamorph) return 'metamorph';
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
  compilePending: unknown,
): number {
  let mask = 0;
  if (formRigReady(sheep, compilePending)) mask |= CHARACTER_FORM_READY.sheep;
  if (formRigReady(bear, compilePending)) mask |= CHARACTER_FORM_READY.bear;
  if (formRigReady(cat, compilePending)) mask |= CHARACTER_FORM_READY.cat;
  if (formRigReady(travel, compilePending)) mask |= CHARACTER_FORM_READY.travel;
  if (formRigReady(metamorph, compilePending)) mask |= CHARACTER_FORM_READY.metamorph;
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
