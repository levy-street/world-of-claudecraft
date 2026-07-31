// The meter panel's paint list: member bars with each open member's split
// folded in directly underneath. Ranking and share math belong to
// tests/meters_rows_view.test.ts and tests/meters_breakdown_view.test.ts; this
// file pins WHICH lines exist, in what order, and when a bar is expandable.

import { describe, expect, it } from 'vitest';
import type { BreakdownEntry } from '../src/ui/meters_breakdown_view';
import { buildMeterList, type MeterListMember } from '../src/ui/meters_list_view';
import type { MeterRow } from '../src/ui/meters_rows_view';

const bar = (pid: number, name: string, value: number): MeterRow => ({
  tally: { pid, name, cls: null, dmg: value, heal: 0, dmgByMob: new Map() },
  value,
  fill: 1,
  hasAggro: false,
});

const entry = (ability: string | null, petName: string | null, amount: number): BreakdownEntry => ({
  ability,
  petName,
  amount,
});

const member = (row: MeterRow, entries: BreakdownEntry[], expanded: boolean): MeterListMember => ({
  row,
  entries,
  expanded,
});

describe('meter list view', () => {
  it('emits one line per member when nothing is open', () => {
    const lines = buildMeterList(
      [
        member(
          bar(1, 'Hero', 500),
          [entry('Aimed Shot', null, 300), entry('Claw', 'Pet', 200)],
          false,
        ),
        member(bar(2, 'Pal', 100), [entry('Smite', null, 100)], false),
      ],
      10,
    );
    expect(lines.map((line) => line.kind)).toEqual(['member', 'member']);
  });

  it('emits an open member split directly under that member, before the next bar', () => {
    const lines = buildMeterList(
      [
        member(
          bar(1, 'Hero', 500),
          [entry('Aimed Shot', null, 300), entry('Claw', 'Pet', 200)],
          true,
        ),
        member(bar(2, 'Pal', 100), [entry('Smite', null, 100)], false),
      ],
      10,
    );
    expect(
      lines.map((line) =>
        line.kind === 'member' ? `bar:${line.row.tally.name}` : `split:${line.row.ability}`,
      ),
    ).toEqual(['bar:Hero', 'split:Aimed Shot', 'split:Claw', 'bar:Pal']);
    // every split line names the member it belongs to, for the painter's label
    const split = lines.filter((line) => line.kind === 'ability');
    expect(split.every((line) => line.kind === 'ability' && line.ownerPid === 1)).toBe(true);
  });

  it('keeps the pet ability separate from the owner ability of the same name', () => {
    const lines = buildMeterList(
      [member(bar(1, 'Hero', 60), [entry('Bite', null, 40), entry('Bite', 'Pet', 20)], true)],
      10,
    );
    expect(
      lines.flatMap((line) =>
        line.kind === 'ability' ? [[line.row.petName, line.row.amount]] : [],
      ),
    ).toEqual([
      [null, 40],
      ['Pet', 20],
    ]);
  });

  it('does not treat a single-row split as expandable: it would only restate the bar', () => {
    const lines = buildMeterList(
      [member(bar(1, 'Hero', 300), [entry('Aimed Shot', null, 300)], true)],
      10,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].kind === 'member' && lines[0].expandable).toBe(false);
    expect(lines[0].kind === 'member' && lines[0].expanded).toBe(false);
  });

  it('reports expandable without opening it when the member is closed', () => {
    const lines = buildMeterList(
      [
        member(
          bar(1, 'Hero', 500),
          [entry('Aimed Shot', null, 300), entry('Claw', 'Pet', 200)],
          false,
        ),
      ],
      10,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].kind === 'member' && lines[0].expandable).toBe(true);
    expect(lines[0].kind === 'member' && lines[0].expanded).toBe(false);
  });

  it('honors the row cap on each member split, folding the tail into one line', () => {
    const entries = [1, 2, 3, 4, 5].map((n) => entry(`Spell ${n}`, null, n * 10));
    const lines = buildMeterList([member(bar(1, 'Hero', 150), entries, true)], 10, 3);
    const split = lines.filter((line) => line.kind === 'ability');
    expect(split).toHaveLength(3);
    // the trailing line carries how many entries folded into it (5 - 2 shown)
    expect(split[2].kind === 'ability' && split[2].row.folded).toBe(3);
  });

  it('drops a member with no contributions at all rather than showing an empty split', () => {
    const lines = buildMeterList([member(bar(1, 'Hero', 0), [], true)], 10);
    expect(lines).toHaveLength(1);
    expect(lines[0].kind).toBe('member');
  });
});
