import { expect } from 'vitest';
import type { AbilityVfxFullSpec } from '../../src/render/ability_vfx_core';
import { abilityVfxFullSpec } from '../../src/render/ability_vfx_registry';

/** Pin all authored spell anatomy while the class-language suite owns casting vocabulary. */
export function authoredVfxSpec(id: string, authored: AbilityVfxFullSpec): AbilityVfxFullSpec {
  const runtime = abilityVfxFullSpec(id);
  if (!runtime) throw new Error(`Missing runtime spec: ${id}`);
  const { castIdentity, areaTelegraph, windupStyle, ...anatomy } = runtime;
  const { windupStyle: authoredWindup, ...authoredAnatomy } = authored;
  expect(anatomy).toEqual({
    ...authoredAnatomy,
    impact: {
      ...authored.impact,
      light: authored.impact?.light ?? 1,
      sparks: authored.impact?.sparks ?? 12,
    },
  });
  expect(areaTelegraph).toBeUndefined();
  if (castIdentity !== undefined) {
    expect(castIdentity).toBe('occult');
    expect(windupStyle).toBe(authoredWindup === 'none' ? 'none' : 'occult');
  } else expect(windupStyle).toBe(authoredWindup);
  expect(abilityVfxFullSpec(id)).toBe(runtime);
  return runtime;
}
