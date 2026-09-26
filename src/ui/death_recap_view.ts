// Pure presentation mapping and calculation core for World of Warcraft-style death recap.
// Computes relative timeline deltas, remaining health percentages, lethal strike
// identification, and combat event cards for the death recap dialog.

import { formatNumber } from './i18n';
import type { DeathRecapRecord } from './meters_death_recap';

export interface DeathRecapCardModel {
  index: number;
  timeRel: string;
  ability: string;
  abilityId: string | null;
  sourceName: string;
  amount: number;
  amountStr: string;
  hpBefore?: number;
  hpAfter?: number;
  maxHp?: number;
  hpStr: string;
  hpPercent: number;
  lethal: boolean;
  type: 'damage' | 'heal' | 'absorb';
  school?: string;
  crit?: boolean;
}

export interface DeathRecapSummary {
  killerName?: string;
  killerAbility?: string;
  deathTime: number;
  totalDamage: number;
  totalHeal: number;
  cards: DeathRecapCardModel[];
}

export function formatRecapTime(deltaMs: number): string {
  const diffSec = deltaMs / 1000;
  if (Math.abs(diffSec) < 0.05) return ' 0.0s';
  const prefix = diffSec > 0 ? '+' : '';
  return `${prefix}${diffSec.toFixed(1)}s`;
}

export function formatRecapHp(
  hp: number | undefined,
  maxHp: number | undefined,
): { hpStr: string; hpPercent: number } {
  if (hp === undefined) return { hpStr: '', hpPercent: 0 };
  const safeHp = Math.max(0, Math.round(hp));
  if (maxHp !== undefined && maxHp > 0) {
    const percent = Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100)));
    return {
      hpStr: `${safeHp} / ${Math.round(maxHp)} (${percent}%)`,
      hpPercent: percent,
    };
  }
  const percent = Math.max(0, Math.min(100, Math.round(hp)));
  return {
    hpStr: `${safeHp} HP`,
    hpPercent: percent,
  };
}

export function buildDeathRecapCards(
  record: DeathRecapRecord,
  maxCards: number = 8,
): DeathRecapCardModel[] {
  const deathTime = record.deathTime;
  const rawEvents = record.events;
  if (!rawEvents || rawEvents.length === 0) return [];

  // Take the most recent events up to maxCards
  const events =
    rawEvents.length > maxCards ? rawEvents.slice(rawEvents.length - maxCards) : rawEvents;
  const cards: DeathRecapCardModel[] = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const isLast = i === events.length - 1;
    const isLethal = ev.lethal === true || (isLast && ev.type === 'damage');
    const timeRel = isLethal ? ' 0.0s' : formatRecapTime(ev.timestamp - deathTime);

    let amountStr = '';
    if (ev.type === 'damage') {
      amountStr = `-${formatNumber(Math.round(ev.amount), { maximumFractionDigits: 0 })}`;
    } else if (ev.type === 'heal') {
      amountStr = `+${formatNumber(Math.round(ev.amount), { maximumFractionDigits: 0 })}`;
    } else {
      amountStr = `[${formatNumber(Math.round(ev.amount), { maximumFractionDigits: 0 })} abs]`;
    }

    const { hpStr, hpPercent } = formatRecapHp(ev.hpAfter, ev.maxHp);

    cards.push({
      index: i,
      timeRel,
      ability:
        ev.ability || (ev.type === 'damage' ? 'Attack' : ev.type === 'heal' ? 'Heal' : 'Shield'),
      abilityId: ev.abilityId ?? null,
      sourceName: ev.sourceName || 'Unknown',
      amount: ev.amount,
      amountStr,
      hpBefore: ev.hpBefore,
      hpAfter: ev.hpAfter,
      maxHp: ev.maxHp,
      hpStr,
      hpPercent,
      lethal: isLethal,
      type: ev.type,
      school: ev.school,
      crit: ev.crit,
    });
  }

  return cards;
}

export function buildDeathRecapSummary(
  record: DeathRecapRecord,
  maxCards: number = 8,
): DeathRecapSummary {
  const cards = buildDeathRecapCards(record, maxCards);
  let totalDamage = 0;
  let totalHeal = 0;

  for (const ev of record.events ?? []) {
    if (ev.type === 'damage') {
      totalDamage += ev.amount;
    } else if (ev.type === 'heal') {
      totalHeal += ev.amount;
    }
  }

  return {
    killerName: record.killerName,
    killerAbility: record.killerAbility,
    deathTime: record.deathTime,
    totalDamage: Math.round(totalDamage),
    totalHeal: Math.round(totalHeal),
    cards,
  };
}
