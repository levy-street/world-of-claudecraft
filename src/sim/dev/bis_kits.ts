// The /dev bis kit choices: every spec's default kit plus the two variant
// pairs (feral cat / bear, enhancement Galeheart / Stonebound). Pure data and
// two readers, small enough for the dev command window to import directly.

import { DEV_KIT_ROLES, devKitRole } from '../content/dev_kit_roles';
import type { PlayerClass } from '../types';

// Kit variants: two specs carry a second kit. Each variant names the kit it
// wears and the talent spec its equip legality is judged under; a bare spec
// id wears its own (default) kit: feral is the cat, enhancement Galeheart.
const DEV_BIS_KIT_VARIANTS: Readonly<
  Partial<Record<PlayerClass, Readonly<Record<string, { kit: string; spec: string }>>>>
> = {
  druid: { cat: { kit: 'feral', spec: 'feral' }, bear: { kit: 'bear', spec: 'feral' } },
  shaman: {
    galeheart: { kit: 'enhancement', spec: 'enhancement' },
    stonebound: { kit: 'stonebound', spec: 'enhancement' },
  },
};

/** Every kit choice per class, in talent order with each variant pair beside
 *  its spec (feral and enhancement are replaced by their two variants). */
export function devBisKitChoices(cls: PlayerClass): readonly string[] {
  const variants = DEV_BIS_KIT_VARIANTS[cls] ?? {};
  return (DEV_KIT_ROLES[cls] ?? []).flatMap((role) => {
    const own = Object.entries(variants).filter(([, v]) => v.spec === role.spec);
    return own.length > 0 ? own.map(([word]) => word) : [role.spec];
  });
}

/** Resolve a spec or variant word to the kit key and the talent spec. */
export function resolveDevBisKit(
  cls: PlayerClass,
  word: string,
): { kit: string; spec: string } | null {
  const lower = word.toLowerCase();
  const variant = DEV_BIS_KIT_VARIANTS[cls]?.[lower];
  if (variant) return variant;
  return devKitRole(cls, lower) ? { kit: lower, spec: lower } : null;
}
