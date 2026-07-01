import type { Entity } from './types';

export const VENDOR_STOCK_REFRESH_MIN = 15 * 60;
export const VENDOR_STOCK_REFRESH_MAX = 45 * 60;

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hashUnit(input: string): number {
  return hashString(input) / 0x100000000;
}

function vendorKey(e: Entity): string {
  return e.templateId || String(e.id);
}

function refreshDelay(seed: number, key: string, generation: number): number {
  const roll = hashUnit(`${seed}:${key}:${generation}:delay`);
  return Math.round(
    VENDOR_STOCK_REFRESH_MIN + roll * (VENDOR_STOCK_REFRESH_MAX - VENDOR_STOCK_REFRESH_MIN),
  );
}

function pickRotatingItems(
  pool: readonly string[],
  baseItems: readonly string[],
  slots: number,
  seed: number,
  key: string,
  generation: number,
): string[] {
  const base = new Set(baseItems);
  const candidates = pool.filter((itemId) => !base.has(itemId));
  const picks: string[] = [];
  for (let slot = 0; slot < slots && picks.length < candidates.length; slot++) {
    const available = candidates.filter((itemId) => !picks.includes(itemId));
    const roll = hashUnit(`${seed}:${key}:${generation}:item:${slot}`);
    picks.push(available[Math.floor(roll * available.length)]);
  }
  return picks;
}

export function scheduleVendorStockRefresh(e: Entity, now: number, seed: number): boolean {
  if (e.kind !== 'npc' || e.vendorRotatingItems.length === 0) return false;
  if (e.vendorStockRefreshAt > now) return false;

  e.vendorStockRefreshAt = now + refreshDelay(seed, vendorKey(e), e.vendorStockGeneration + 1);
  return true;
}

export function refreshVendorStock(e: Entity, now: number, seed: number): boolean {
  if (e.kind !== 'npc' || e.vendorRotatingItems.length === 0) return false;
  if (e.vendorStockRefreshAt <= 0) scheduleVendorStockRefresh(e, now, seed);
  if (e.vendorStockRefreshAt > now) return false;

  const generation = e.vendorStockGeneration + 1;
  const key = vendorKey(e);
  const slots = Math.max(1, e.vendorStockSlots);
  const rotating = pickRotatingItems(
    e.vendorRotatingItems,
    e.vendorBaseItems,
    slots,
    seed,
    key,
    generation,
  );
  e.vendorItems = [...e.vendorBaseItems, ...rotating];
  e.vendorStockGeneration = generation;
  e.vendorStockRefreshAt = now + refreshDelay(seed, key, generation + 1);
  return true;
}
