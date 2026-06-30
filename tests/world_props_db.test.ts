import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  return { query: vi.fn() };
});

vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: dbMock.query };
  }),
}));

import {
  deleteWorldProp,
  insertWorldProp,
  loadWorldProps,
  updateWorldProp,
  updateWorldPropMeta,
} from '../server/db';
import { REALM } from '../server/realm';

beforeEach(() => {
  dbMock.query.mockReset();
});

describe('world_props accessors (in-world Builder)', () => {
  it('loadWorldProps scopes to the current realm and maps rows', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        { id: '5', prop_key: 'barrel', x: 1.5, z: -2, facing: 0.25, scale: 2, meta: { dialogue: 'hi' } },
      ],
    });

    const props = await loadWorldProps();

    const [sql, params] = dbMock.query.mock.calls[0];
    // Realm-scoped: without the predicate a process would replay every realm's props.
    expect(sql).toContain('WHERE realm = $1');
    expect(params).toEqual([REALM]);
    expect(props).toEqual([
      { id: 5, propKey: 'barrel', x: 1.5, z: -2, facing: 0.25, scale: 2, meta: { dialogue: 'hi' } },
    ]);
  });

  it('insertWorldProp uses parameterized SQL and returns the generated id', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [{ id: '7' }] });

    const id = await insertWorldProp({ propKey: 'lamp', x: 3, z: 4, facing: 0, scale: 1, meta: {} });

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(id).toBe(7);
    expect(sql).toMatch(/\$1/);
    // The value travels in the params array, never interpolated into the SQL text.
    expect(sql).not.toContain('lamp');
    expect(params[0]).toBe(REALM);
    expect(params).toContain('lamp');
    expect(params[params.length - 1]).toBe('{}'); // meta serialized to JSON
  });

  it('updateWorldProp and updateWorldPropMeta are realm-scoped by id', async () => {
    dbMock.query.mockResolvedValue({ rows: [] });

    await updateWorldProp(9, 1, 2, 3, 4);
    let [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('WHERE id = $1 AND realm = $6');
    expect(params).toEqual([9, 1, 2, 3, 4, REALM]);

    await updateWorldPropMeta(9, { music: '/m/x.mp3' });
    [sql, params] = dbMock.query.mock.calls[1];
    expect(sql).toContain('WHERE id = $1 AND realm = $3');
    expect(params).toEqual([9, JSON.stringify({ music: '/m/x.mp3' }), REALM]);
  });

  it('deleteWorldProp is realm-scoped by id', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [] });

    await deleteWorldProp(11);

    const [sql, params] = dbMock.query.mock.calls[0];
    expect(sql).toContain('WHERE id = $1 AND realm = $2');
    expect(params).toEqual([11, REALM]);
  });
});
