import type { Aura } from '../sim/types';

export interface FormTint {
  color: number;
  opacity: number;
}

export const FORM_TINTS = {
  form_shadow: { color: 0x8a5bcf, opacity: 1 },
  form_moonkin: { color: 0xdceeff, opacity: 0.6 },
} as const satisfies Partial<Record<Aura['kind'], FormTint>>;

const FORM_TINT_KINDS = Object.keys(FORM_TINTS) as Array<keyof typeof FORM_TINTS>;

export function formTintKey(tint: FormTint | null): string {
  return tint ? `${tint.color}:${tint.opacity}` : '';
}

export function activeFormTint(auras: readonly Pick<Aura, 'kind'>[]): FormTint | null {
  for (const kind of FORM_TINT_KINDS) {
    if (auras.some((aura) => aura.kind === kind)) return FORM_TINTS[kind];
  }
  return null;
}
