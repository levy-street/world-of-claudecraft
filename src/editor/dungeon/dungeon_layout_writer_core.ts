// Serializes a DungeonLayout back into the TypeScript object literal used in
// src/sim/dungeon_layout.ts, matching the hand-authored source style (2-space
// indent, trailing commas, one-line array entries when they fit lineWidth 100,
// pretty Math.PI fractions for yaw), plus a brace-aware const replacer so the
// editor can rewrite one layout const without touching the rest of the file.
// Editor pure core: no DOM, no three.js.
import type { DungeonLayout } from '../../sim/dungeon_layout';

const LINE_WIDTH = 100;

/** Top-level key order, mirroring the hand-authored layout source style. */
const KEY_ORDER = [
  'zMin',
  'zMax',
  'sideWallZ',
  'sideWallHd',
  'wallX',
  'endWallHw',
  'floorHalfX',
  'doorZ',
  'clutter',
  'shellPolygon',
  'shellPole',
  'pillars',
  'tombs',
  'stubs',
  'dais',
  'rooms',
  'doors',
  'barriers',
  'visualOpenings',
  'decor',
] as const;

function formatNumber(v: number): string {
  if (Object.is(v, -0)) return '0';
  if (Number.isInteger(v)) return String(v);
  const rounded = Math.round(v * 10000) / 10000;
  // Round to at most 4 decimals when that is lossless; otherwise keep full
  // precision so the emitted literal evaluates back to the exact value.
  if (Math.abs(rounded - v) < 1e-9) return String(rounded);
  return String(v);
}

/** Emits k * Math.PI / 4 as a pretty expression for exact multiples, else a plain number. */
function formatYaw(v: number): string {
  const k = Math.round(v / (Math.PI / 4));
  if (k !== 0 && Math.abs(k) <= 8 && Math.abs(v - (k * Math.PI) / 4) < 1e-9) {
    const sign = k < 0 ? '-' : '';
    const a = Math.abs(k);
    const g = a % 4 === 0 ? 4 : a % 2 === 0 ? 2 : 1;
    const num = a / g;
    const den = 4 / g;
    if (den === 1) return num === 1 ? `${sign}Math.PI` : `${sign}${num} * Math.PI`;
    if (num === 1) return `${sign}Math.PI / ${den}`;
    return `(${sign}${num} * Math.PI) / ${den}`;
  }
  return formatNumber(v);
}

function formatString(v: string): string {
  return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function formatScalar(key: string, value: unknown): string {
  if (typeof value === 'number') return key === 'yaw' ? formatYaw(value) : formatNumber(value);
  if (typeof value === 'string') return formatString(value);
  if (typeof value === 'boolean') return String(value);
  throw new Error(`Unsupported layout literal value for key ${key}: ${String(value)}`);
}

function inlineObject(obj: Record<string, unknown>): string {
  const parts = Object.entries(obj)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${formatScalar(key, value)}`);
  return `{ ${parts.join(', ')} }`;
}

function multilineObject(obj: Record<string, unknown>, indent: string): string {
  const inner = `${indent}  `;
  const lines = Object.entries(obj)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${inner}${key}: ${formatScalar(key, value)},`);
  return `{\n${lines.join('\n')}\n${indent}}`;
}

function formatObject(obj: Record<string, unknown>, indent: string, prefixLen: number): string {
  const inline = inlineObject(obj);
  if (prefixLen + inline.length + 1 <= LINE_WIDTH) return inline;
  return multilineObject(obj, indent);
}

function formatArray(items: readonly unknown[], indent: string): string {
  if (items.length === 0) return '[]';
  const inner = `${indent}  `;
  const lines = items.map((item) => {
    const rendered = formatObject(item as Record<string, unknown>, inner, inner.length);
    return `${inner}${rendered},`;
  });
  return `[\n${lines.join('\n')}\n${indent}]`;
}

/**
 * Emits the `{...}` TypeScript literal for a layout (without `export const`
 * prefix or trailing `;`), in the source file's authored style.
 */
export function formatDungeonLayoutLiteral(layout: DungeonLayout): string {
  const record = layout as unknown as Record<string, unknown>;
  const lines: string[] = [];
  for (const key of KEY_ORDER) {
    const value = record[key];
    if (value === undefined) continue;
    const prefix = `  ${key}: `;
    let rendered: string;
    if (Array.isArray(value)) rendered = formatArray(value, '  ');
    else if (typeof value === 'object' && value !== null) {
      rendered = formatObject(value as Record<string, unknown>, '  ', prefix.length);
    } else rendered = formatScalar(key, value);
    lines.push(`${prefix}${rendered},`);
  }
  return `{\n${lines.join('\n')}\n}`;
}

/**
 * Replaces the object literal of `export const <constName>: DungeonLayout = {...};`
 * in a source file with a new literal, leaving everything else byte-identical.
 * Scans with a brace counter that skips string literals and comments.
 * Throws if the const declaration is not found.
 */
export function replaceLayoutConst(source: string, constName: string, literal: string): string {
  const marker = `export const ${constName}: DungeonLayout = `;
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`Const ${constName} not found in source`);
  }
  const open = start + marker.length;
  if (source[open] !== '{') {
    throw new Error(`Const ${constName} is not assigned an object literal`);
  }
  let depth = 0;
  let i = open;
  let close = -1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
    i++;
  }
  if (close < 0) {
    throw new Error(`Unbalanced braces while scanning const ${constName}`);
  }
  let semi = close + 1;
  while (semi < source.length && /\s/.test(source[semi])) semi++;
  if (source[semi] !== ';') {
    throw new Error(`Missing terminating semicolon after const ${constName}`);
  }
  return source.slice(0, open) + literal + source.slice(semi);
}
