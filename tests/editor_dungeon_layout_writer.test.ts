import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatDungeonLayoutLiteral,
  replaceLayoutConst,
} from '../src/editor/dungeon/dungeon_layout_writer_core';
import { AUTHORED_DUNGEON_FIXTURE } from './fixtures/authored_dungeon_layout';

// The layout serializer: a REAL evaluated round-trip against an authored
// room-graph layout fixture, literal style pins, and the brace-aware const
// replacer applied to that fixture's actual TypeScript source.

const LAYOUT_SOURCE_PATH = join(process.cwd(), 'tests/fixtures/authored_dungeon_layout.ts');

function expectDeepClose(actual: unknown, expected: unknown, path: string): void {
  if (typeof expected === 'number') {
    expect(typeof actual, path).toBe('number');
    expect(Math.abs((actual as number) - expected), path).toBeLessThan(1e-9);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, path).toBe(expected.length);
    expected.forEach((item, i) => {
      expectDeepClose((actual as unknown[])[i], item, `${path}[${i}]`);
    });
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    const expectedKeys = Object.keys(expected as Record<string, unknown>)
      .filter((key) => (expected as Record<string, unknown>)[key] !== undefined)
      .sort();
    const actualKeys = Object.keys(actual as Record<string, unknown>)
      .filter((key) => (actual as Record<string, unknown>)[key] !== undefined)
      .sort();
    expect(actualKeys, path).toEqual(expectedKeys);
    for (const key of expectedKeys) {
      expectDeepClose(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
    }
    return;
  }
  expect(actual, path).toBe(expected);
}

describe('editor dungeon layout writer', () => {
  it('emits a literal that evaluates back to the exact authored layout', () => {
    const literal = formatDungeonLayoutLiteral(AUTHORED_DUNGEON_FIXTURE);
    const evaluated = new Function('Math', `return ${literal}`)(Math);
    expectDeepClose(evaluated, AUTHORED_DUNGEON_FIXTURE, 'layout');
  });

  it('pins the authored source style: pretty yaws and one-line room entries', () => {
    const literal = formatDungeonLayoutLiteral(AUTHORED_DUNGEON_FIXTURE);
    expect(literal).toContain("{ id: 'ashen_descent_entrance', x0: -18, x1: 18, z0: -25, z1: 5 },");
    expect(literal).toContain('yaw: Math.PI / 2');
    expect(literal).toContain('yaw: -Math.PI / 2');
    expect(literal).toContain('yaw: Math.PI,');
    expect(literal).toContain('yaw: 0.18');
    expect(literal).toContain('  zMin: -25,');
    expect(literal).toContain('  dais: { x: 0, z: 222, r: 18 },');
    expect(literal).toContain('  pillars: [],');
    expect(literal).toContain('  tombs: [],');
    expect(literal).toContain('  stubs: [],');
    expect(literal).toContain("{ x: -39, z: 54, hw: 13, hd: 1, style: 'maze' },");
    expect(literal.startsWith('{\n')).toBe(true);
    expect(literal.endsWith('\n}')).toBe(true);
    // No line exceeds the repo lineWidth (the export prefix is not part of the literal).
    for (const line of literal.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(100);
    }
  });

  it('replaces one layout const in the real source file, leaving the rest intact', () => {
    const source = readFileSync(LAYOUT_SOURCE_PATH, 'utf8');
    const replaced = replaceLayoutConst(source, 'AUTHORED_DUNGEON_FIXTURE', '{ zMin: 0 }');
    expect(replaced).toContain(
      'export const AUTHORED_DUNGEON_FIXTURE: DungeonLayout = { zMin: 0 };',
    );
    // Everything before the const is byte-identical.
    const constStart = source.indexOf('export const AUTHORED_DUNGEON_FIXTURE');
    expect(constStart).toBeGreaterThan(0);
    expect(replaced.startsWith(source.slice(0, constStart))).toBe(true);
    // Everything after the original const's semicolon is byte-identical.
    // (Measured from the const's own closing brace rather than the next
    // section's comment: upstream reorders this file freely.)
    const constEnd = source.indexOf('\n};\n', constStart) + '\n};\n'.length;
    expect(constEnd).toBeGreaterThan(constStart);
    expect(replaced.endsWith(source.slice(constEnd))).toBe(true);
    // The neighbours survive.
    expect(replaced).toContain(
      "import type { DungeonLayout } from '../../src/sim/dungeon_layout';",
    );
    expect(replaced).toContain('export const AUTHORED_DUNGEON_NEIGHBOUR: DungeonLayout = {');
    // The old literal body is gone.
    expect(replaced).not.toContain("id: 'ashen_descent_entrance'");
  });

  it('round-trips the formatted literal through the real source file', () => {
    const source = readFileSync(LAYOUT_SOURCE_PATH, 'utf8');
    const literal = formatDungeonLayoutLiteral(AUTHORED_DUNGEON_FIXTURE);
    const replaced = replaceLayoutConst(source, 'AUTHORED_DUNGEON_FIXTURE', literal);
    expect(replaced).toContain(
      `export const AUTHORED_DUNGEON_FIXTURE: DungeonLayout = ${literal};`,
    );
    // Replacing with a formatted literal keeps the rest of the file intact.
    expect(replaced).toContain('export const AUTHORED_DUNGEON_NEIGHBOUR: DungeonLayout =');
  });

  it('throws when the const does not exist', () => {
    const source = readFileSync(LAYOUT_SOURCE_PATH, 'utf8');
    expect(() => replaceLayoutConst(source, 'NOPE_LAYOUT', '{}')).toThrow(/NOPE_LAYOUT/);
  });
});
