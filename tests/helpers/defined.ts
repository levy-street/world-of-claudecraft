import { expect } from 'vitest';

export function expectDefined<T>(value: T, label = 'value'): NonNullable<T> {
  expect(value, `${label} should be defined`).toBeDefined();
  if (value === null || value === undefined) throw new Error(`${label} should be defined`);
  return value;
}
