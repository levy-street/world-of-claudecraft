// Per-demon custom names. Warlock demons are never saved (pet_commands.ts
// isDemonPetState): every summon builds a fresh entity from its template. A
// rename is therefore remembered here, keyed by the demon's template id, so
// the next summon of that same demon answers to the name the warlock gave it,
// across resummons, deaths and relogs.
import { MOBS } from '../data';
import { cleanPetName } from './pet_commands';

export type DemonNames = Record<string, string>;

/** True for a template a warlock summons as a demon pet. */
export function isDemonTemplate(templateId: string): boolean {
  return MOBS[templateId]?.family === 'demon';
}

/** Load-side guard: drops unknown templates and unclean names. */
export function normalizeDemonNames(raw: unknown): DemonNames {
  const names: DemonNames = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return names;
  for (const [templateId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isDemonTemplate(templateId)) continue;
    const clean = typeof value === 'string' ? cleanPetName(value) : null;
    if (clean) names[templateId] = clean;
  }
  return names;
}

/** Save fragment: absent while empty, so pre-feature saves stay byte-equal. */
export function demonNamesSaveFragment(names: DemonNames | undefined): {
  demonNames?: DemonNames;
} {
  return names && Object.keys(names).length > 0 ? { demonNames: { ...names } } : {};
}
