// Pickit loot filter — Diablo / PoE / D2 style "SHOW item if rarity>=rare"
//
// This filter never decides what drops (the upstream Sim does); it only
// decides which ground items the realm UI should highlight, hide, or color.
// Players opt into a filter per-realm; the default is to show everything.

import { RARITY_ORDER, type RarityId, type RealmItemSlot, type RealmItem } from './rarity';

export type PickitOp = '>=' | '<=' | '=' | '*=';

export interface PickitCondition {
  /** 'rarity' | 'slot' | 'level' | 'name' | 'stat:<statName>' */
  key: string;
  op: PickitOp;
  value: string;
}

export interface PickitRule {
  action: 'show' | 'hide';
  conditions: PickitCondition[];
  /** Optional CSS hex color override for the highlighted label. */
  color: string | null;
  /** True when the rule was tagged HIGHLIGHT (extra outline + ground beam). */
  highlight: boolean;
  /** 1-based source line for debugging. */
  line: number;
}

export interface PickitResult {
  show: boolean;
  highlight: boolean;
  color: string | null;
  matchedRule: PickitRule | null;
}

function parseCondition(token: string): PickitCondition | null {
  let op: PickitOp;
  let parts: string[];
  if (token.includes('>=')) { op = '>='; parts = token.split('>='); }
  else if (token.includes('<=')) { op = '<='; parts = token.split('<='); }
  else if (token.includes('*=')) { op = '*='; parts = token.split('*='); }
  else if (token.includes('=')) { op = '=';  parts = token.split('='); }
  else return null;
  const [key, value] = parts;
  if (!key || value === undefined) return null;
  return { key: key.trim(), op, value: value.trim() };
}

export function parsePickitFilter(text: string): PickitRule[] {
  const rules: PickitRule[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    const upper = line.toUpperCase();
    const action: 'show' | 'hide' = upper.startsWith('HIDE') ? 'hide' : 'show';
    const rest = line.replace(/^(SHOW|HIDE)\s+/i, '').trim();

    const rule: PickitRule = {
      action, conditions: [], color: null, highlight: false, line: i + 1,
    };
    for (const token of rest.split(/\s+/)) {
      const up = token.toUpperCase();
      if (up === 'HIGHLIGHT') { rule.highlight = true; continue; }
      if (up.startsWith('COLOR:')) { rule.color = token.split(':')[1] ?? null; continue; }
      const cond = parseCondition(token);
      if (cond) rule.conditions.push(cond);
    }
    rules.push(rule);
  }
  return rules;
}

function rarityRank(r: string): number {
  return RARITY_ORDER.indexOf(r as RarityId);
}

function evaluateCondition(cond: PickitCondition, item: RealmItem): boolean {
  const { key, op, value } = cond;
  if (key === 'rarity') {
    const itemRank = rarityRank(item.rarity);
    const valRank = rarityRank(value);
    if (valRank < 0) return false;
    if (op === '>=') return itemRank >= valRank;
    if (op === '<=') return itemRank <= valRank;
    if (op === '=')  return item.rarity === value;
  }
  if (key === 'slot') {
    return item.slot === (value as RealmItemSlot);
  }
  if (key === 'level') {
    const ilvl = item.itemLevel ?? 1;
    const v = parseInt(value, 10);
    if (Number.isNaN(v)) return false;
    if (op === '>=') return ilvl >= v;
    if (op === '<=') return ilvl <= v;
    if (op === '=')  return ilvl === v;
  }
  if (key === 'name' && op === '*=') {
    return (item.name ?? '').toLowerCase().includes(value.toLowerCase());
  }
  if (key.startsWith('stat:')) {
    const statName = key.slice(5);
    const affix = item.affixes.find((a) => a.stat === statName);
    if (!affix) return false;
    const v = parseFloat(value);
    if (Number.isNaN(v)) return false;
    if (op === '>=') return affix.value >= v;
    if (op === '<=') return affix.value <= v;
    if (op === '=')  return affix.value === v;
  }
  return false;
}

/** First matching rule wins. Items with no rule match show by default. */
export function evaluateItem(item: RealmItem, rules: PickitRule[]): PickitResult {
  for (const rule of rules) {
    const matches = rule.conditions.length > 0
      && rule.conditions.every((c) => evaluateCondition(c, item));
    if (matches) {
      return {
        show: rule.action === 'show',
        highlight: rule.highlight,
        color: rule.color,
        matchedRule: rule,
      };
    }
  }
  return { show: true, highlight: false, color: null, matchedRule: null };
}
