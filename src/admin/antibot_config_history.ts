import { type AntibotFormValue, antibotValueEquals } from './antibot_config';
import type { AntibotConfigField, AntibotConfigHistoryEntry, AntibotConfigValue } from './types';

export interface AntibotConfigHistoryRow {
  id: string;
  label: string;
  before: string;
  after: string;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface AntibotHistoryFormState {
  values: Record<string, AntibotFormValue>;
  skippedCount: number;
}

/** Turn a historical override document into editable state for the current schema. */
export function antibotHistoryFormState(
  fields: AntibotConfigField[],
  overrides: Record<string, AntibotConfigValue>,
): AntibotHistoryFormState {
  const fieldIds = new Set(fields.map((field) => field.id));
  let skippedCount = Object.keys(overrides).filter((id) => !fieldIds.has(id)).length;
  const values: Record<string, AntibotFormValue> = {};

  for (const field of fields) {
    const fallback = field.defaultValue;
    values[field.id] = Array.isArray(fallback) ? [...fallback] : fallback;
    if (!Object.hasOwn(overrides, field.id)) continue;

    const value = overrides[field.id];
    if (!historyValueCompatible(field, value)) {
      skippedCount += 1;
      continue;
    }
    values[field.id] = Array.isArray(value) ? [...value] : value;
  }

  return { values, skippedCount };
}

export function antibotConfigHistoryRows(
  entry: AntibotConfigHistoryEntry,
  fields: AntibotConfigField[],
  translate: Translate,
): AntibotConfigHistoryRow[] {
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const ids = new Set([...Object.keys(entry.beforeData), ...Object.keys(entry.afterData)]);
  const order = new Map(fields.map((field, index) => [field.id, index]));
  return [...ids]
    .filter((id) => historyValueChanged(id, entry))
    .sort(
      (a, b) =>
        (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER) ||
        a.localeCompare(b),
    )
    .map((id) => {
      const field = fieldById.get(id);
      return {
        id,
        label: field?.label ?? id,
        before: historyValueText(entry.beforeData, id, field, translate),
        after: historyValueText(entry.afterData, id, field, translate),
      };
    });
}

function historyValueChanged(id: string, entry: AntibotConfigHistoryEntry): boolean {
  const beforePresent = Object.hasOwn(entry.beforeData, id);
  const afterPresent = Object.hasOwn(entry.afterData, id);
  if (beforePresent !== afterPresent) return true;
  if (!beforePresent) return false;
  return !antibotValueEquals(entry.beforeData[id], entry.afterData[id]);
}

function historyValueCompatible(field: AntibotConfigField, value: AntibotConfigValue): boolean {
  switch (field.type) {
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (field.min === undefined || value >= field.min) &&
        (field.max === undefined || value <= field.max)
      );
    case 'boolean':
      return typeof value === 'boolean';
    case 'multi_select':
      return (
        Array.isArray(value) &&
        value.every(
          (entry) =>
            field.options === undefined || field.options.some((option) => option.value === entry),
        )
      );
    case 'select':
      return (
        typeof value === 'string' &&
        (field.options === undefined || field.options.some((option) => option.value === value))
      );
    case 'string':
      return typeof value === 'string';
  }
}

function historyValueText(
  document: Record<string, AntibotConfigValue>,
  id: string,
  field: AntibotConfigField | undefined,
  translate: Translate,
): string {
  if (!Object.hasOwn(document, id)) return translate('antibot.historyDefault');
  const value = document[id];
  if (typeof value === 'boolean') {
    return translate(value ? 'antibot.valueOn' : 'antibot.valueOff');
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return translate('antibot.historyNone');
    return value.map((entry) => optionLabel(field, entry)).join(', ');
  }
  if (typeof value === 'number') return field?.unit ? `${value} ${field.unit}` : String(value);
  return optionLabel(field, value);
}

function optionLabel(field: AntibotConfigField | undefined, value: string): string {
  return field?.options?.find((option) => option.value === value)?.label ?? value;
}
