// Feature-neutral helpers for admin form fields: an operator-entered value is a
// string/number, or null/undefined when left at its default. Pure, so they
// unit-test directly in the default Node env.

export type FieldInput = string | number | null | undefined;

/** True when the operator actually entered something ('' / null = default). */
export function fieldFilled(value: FieldInput): boolean {
  if (value === null || value === undefined) return false;
  return String(value).trim() !== '';
}

export function fieldNumber(value: FieldInput): number {
  return typeof value === 'number' ? value : Number(String(value ?? '').trim());
}
