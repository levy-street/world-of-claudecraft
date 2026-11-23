import { describe, expect, it } from 'vitest';
import type { Entity } from '../src/sim/types';
import { varkhulArenaPlayers } from '../src/sim/varkhul_attempt';

describe('Varkhul arena participation', () => {
  it('excludes the entry corridor and includes raiders past the arena edge', () => {
    const at = (id: number, z: number) => ({ id, pos: { x: 0, z } }) as Entity;
    const corridor = at(1, -33);
    const edge = at(2, -30);
    const arena = at(3, -29);

    expect(varkhulArenaPlayers([corridor, edge, arena], -30)).toEqual([edge, arena]);
  });
});
