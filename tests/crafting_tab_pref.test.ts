import { describe, expect, it } from 'vitest';
import { parseCraftingTab, serializeCraftingTab } from '../src/ui/crafting_tab_pref';

describe('serialize / parse round-trip', () => {
  it('round-trips a valid profession id', () => {
    expect(parseCraftingTab(serializeCraftingTab('cooking'))).toBe('cooking');
  });

  it('round-trips null (no pick yet)', () => {
    expect(parseCraftingTab(serializeCraftingTab(null))).toBeNull();
  });
});

describe('parseCraftingTab tolerance', () => {
  it('falls back to null on garbage input', () => {
    expect(parseCraftingTab('not json')).toBeNull();
    expect(parseCraftingTab(null)).toBeNull();
    expect(parseCraftingTab(undefined)).toBeNull();
    expect(parseCraftingTab('')).toBeNull();
  });

  it('falls back to null on a non-string JSON value', () => {
    expect(parseCraftingTab('42')).toBeNull();
    expect(parseCraftingTab('true')).toBeNull();
    expect(parseCraftingTab('{"professionId":"cooking"}')).toBeNull();
    expect(parseCraftingTab('[]')).toBeNull();
  });

  it('falls back to null on an empty string profession id', () => {
    expect(parseCraftingTab('""')).toBeNull();
  });

  it('accepts any non-empty profession id string (open-ended content, not an enum)', () => {
    expect(parseCraftingTab('"weaponcrafting"')).toBe('weaponcrafting');
    expect(parseCraftingTab('"some_future_profession"')).toBe('some_future_profession');
  });
});
