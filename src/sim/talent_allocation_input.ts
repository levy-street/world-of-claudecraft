import {
  MAX_LOADOUTS,
  ROW_LEVELS,
  type TalentAllocation,
  type TalentRowLevel,
} from './content/talents';

const MAX_TALENT_ID_LENGTH = 64;
const ALLOCATION_KEYS = new Set(['spec', 'rows']);
const ROW_LEVEL_SET: ReadonlySet<number> = new Set(ROW_LEVELS);

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  return value as Record<string, unknown>;
}

export function parseTalentRowLevel(value: unknown): TalentRowLevel | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
  return ROW_LEVEL_SET.has(value) ? (value as TalentRowLevel) : null;
}

export function parseTalentLoadoutIndex(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
  return value >= 0 && value < MAX_LOADOUTS ? value : null;
}

export function parseTalentOptionId(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TALENT_ID_LENGTH) {
    return undefined;
  }
  return value;
}

/** Strict boundary parser for the one canonical Talent V2 allocation shape. */
export function parseTalentAllocation(value: unknown): TalentAllocation | null {
  const source = plainRecord(value);
  if (!source || Object.keys(source).some((key) => !ALLOCATION_KEYS.has(key))) return null;
  if (!Object.hasOwn(source, 'spec') || !Object.hasOwn(source, 'rows')) return null;

  const spec = source.spec;
  if (
    spec !== null &&
    (typeof spec !== 'string' || spec.length === 0 || spec.length > MAX_TALENT_ID_LENGTH)
  ) {
    return null;
  }

  const rawRows = plainRecord(source.rows);
  if (!rawRows) return null;
  const rows: Partial<Record<TalentRowLevel, string>> = {};
  for (const [rawLevel, optionId] of Object.entries(rawRows)) {
    const level = parseTalentRowLevel(Number(rawLevel));
    const parsedOptionId = parseTalentOptionId(optionId);
    if (
      level === null ||
      String(level) !== rawLevel ||
      parsedOptionId === undefined ||
      parsedOptionId === null
    ) {
      return null;
    }
    rows[level] = parsedOptionId;
  }

  return { spec, rows };
}
