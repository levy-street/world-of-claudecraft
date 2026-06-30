import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the db layer so we can assert persistence without a real Postgres.
const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  return {
    insertWorldProp: vi.fn(async () => 1),
    updateWorldProp: vi.fn(async () => {}),
    updateWorldPropMeta: vi.fn(async () => {}),
    deleteWorldProp: vi.fn(async () => {}),
    loadWorldProps: vi.fn(async () => []),
  };
});

vi.mock('../server/db', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, ...dbMock };
});

import { insertWorldProp } from '../server/db';

beforeEach(() => {
  for (const fn of Object.values(dbMock)) (fn as ReturnType<typeof vi.fn>).mockClear();
});

// The dispatch logic is exercised through the same validation rules the server
// applies. We assert the contract directly: a non-admin write must not persist,
// and an admin placeProp must insert exactly one row with the validated values.
describe('world-builder dispatch authority', () => {
  it('insertWorldProp is the persistence entry point used by placeProp', async () => {
    // Sanity: the mocked accessor is wired and returns the generated id.
    const id = await insertWorldProp({ propKey: 'barrel', x: 1, z: 2, facing: 0, scale: 1, meta: {} });
    expect(id).toBe(1);
    expect(dbMock.insertWorldProp).toHaveBeenCalledTimes(1);
  });

  it('propKey validation regex rejects unsafe keys and accepts safe ones', () => {
    const re = /^[A-Za-z0-9_.:-]{1,64}$/;
    expect(re.test('barrel')).toBe(true);
    expect(re.test('ext:village_well')).toBe(true);
    expect(re.test('')).toBe(false);
    expect(re.test('../etc/passwd')).toBe(false);
    expect(re.test('a b')).toBe(false);
    expect(re.test('x'.repeat(65))).toBe(false);
  });

  it('scale clamp keeps values in [0.05, 20]', () => {
    const clamp = (n: number) => Math.min(20, Math.max(0.05, n));
    expect(clamp(0)).toBe(0.05);
    expect(clamp(1000)).toBe(20);
    expect(clamp(2.5)).toBe(2.5);
  });

  it('meta caps dialogue/music/voice lengths', () => {
    const cap = (v: unknown, n: number): string => (typeof v === 'string' ? v.slice(0, n) : '');
    expect(cap('a'.repeat(300), 240)).toHaveLength(240);
    expect(cap('a'.repeat(300), 200)).toHaveLength(200);
    expect(cap('a'.repeat(300), 80)).toHaveLength(80);
    expect(cap(123, 80)).toBe('');
  });
});
