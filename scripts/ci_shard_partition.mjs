/**
 * Deterministic shard packs for the CI balanced vitest sequencer (D11
 * path-matrix). Pure module: no vitest, no fs.
 *
 * Approach history:
 * 1. LPT on import-proxy weights: regressed D11 (run 30748073443, ratio 1.59,
 *    s4 import-bound). Proxy did not match real import residual.
 * 2. Stripe (round-robin) after sha1 order: breaks vitest's default contiguous
 *    sha1 slices so unlucky import clusters cannot sit in one equal-size slice.
 *
 * Callers supply keys; weights remain available for LPT helpers and tests.
 */

import { createHash } from 'node:crypto';

/**
 * @typedef {{ id: unknown, weight: number, key: string }} WeightedItem
 */

/**
 * Partition items into `count` packs by striping a sha1-sorted order.
 * Vitest default is contiguous slices of the same order; striping assigns
 * every Nth file to the same shard so neighbors in hash space fan out.
 *
 * Every item appears in exactly one pack. Empty packs only when
 * items.length < count.
 *
 * @param {WeightedItem[]} items
 * @param {number} count  shard count (N), must be >= 1
 * @returns {WeightedItem[][]} packs[0] is shard 1, packs[count-1] is shard N
 */
export function partitionByStripe(items, count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`partitionByStripe: count must be a positive integer, got ${count}`);
  }
  /** @type {WeightedItem[][]} */
  const packs = Array.from({ length: count }, () => []);
  if (items.length === 0) return packs;

  const ordered = [...items].sort((a, b) => {
    const ha = createHash('sha1').update(a.key).digest('hex');
    const hb = createHash('sha1').update(b.key).digest('hex');
    if (ha < hb) return -1;
    if (ha > hb) return 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  for (let i = 0; i < ordered.length; i++) {
    packs[i % count].push(ordered[i]);
  }
  return packs;
}

/**
 * Partition items into `count` packs by LPT (kept for unit tests / overlays).
 * - Sort by weight desc, then key asc (stable).
 * - Assign each item to the pack with the smallest current load; ties break
 *   toward the lower pack index.
 *
 * @param {WeightedItem[]} items
 * @param {number} count
 * @returns {WeightedItem[][]}
 */
export function partitionByLpt(items, count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`partitionByLpt: count must be a positive integer, got ${count}`);
  }
  /** @type {WeightedItem[][]} */
  const packs = Array.from({ length: count }, () => []);
  const load = Array.from({ length: count }, () => 0);
  if (items.length === 0) return packs;

  const ordered = [...items].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  for (const item of ordered) {
    let best = 0;
    for (let i = 1; i < count; i++) {
      if (load[i] < load[best]) best = i;
    }
    packs[best].push(item);
    load[best] += item.weight;
  }
  return packs;
}

/** Active pack strategy for the CI sequencer (approach 2). */
export const partitionForCi = partitionByStripe;

/**
 * Known long-Duration files from Phase 3 CI evidence (run 30712431702 and
 * earlier). Additive overlay so test-time monsters stay spread even when the
 * static import proxy under-weights them. Keys are repo-relative paths.
 * Values are extra weight units (same scale as weightForTestFile).
 */
export const DURATION_WEIGHT_OVERLAY = Object.freeze({
  'tests/mail_expiry.test.ts': 80_000,
  'tests/professions_trend_guild_letter.test.ts': 79_000,
  'tests/eastbrook_gameplay_integration.test.ts': 69_000,
  'tests/tank_crit_immunity_warrior_pair.test.ts': 55_000,
  'tests/tank_crit_immunity_paladin_pair.test.ts': 50_000,
  'tests/professions_trend_delivery_kind.test.ts': 47_000,
  'tests/corpse_harvest_sim.test.ts': 46_000,
  'tests/escort_quest.test.ts': 43_000,
  'tests/tank_crit_immunity_druid_pair.test.ts': 37_000,
  'tests/mail_instance.test.ts': 35_000,
  'tests/terrain_streaming.test.ts': 34_000,
  'tests/escort_ambush_convoy.test.ts': 28_000,
  'tests/professions_deeds_playthrough.test.ts': 25_000,
  'tests/grave_inferno.test.ts': 24_000,
  'tests/frost_mage_procs.test.ts': 24_000,
  'tests/stable_yard.test.ts': 22_000,
  'tests/world_population_invariant.test.ts': 21_000,
  'tests/terrain_escape_walkout.test.ts': 21_000,
  'tests/emerald_deck_escape.test.ts': 23_000,
  'tests/sfx_export_core.test.ts': 18_000,
  'tests/mount_race.test.ts': 18_000,
  'tests/guild_letter_online.test.ts': 16_000,
  'tests/dungeon_finder.test.ts': 17_000,
  'tests/sfx_studio_server_security.test.ts': 16_000,
  'tests/ai_review.test.ts': 18_000,
});

/**
 * Deterministic import-cost weight for a test file.
 * Size is a weak proxy; boosts target the graphs that dominate CI import time
 * (three/render/electron) and long suites from the overlay.
 *
 * @param {string} relPath  repo-relative posix path (e.g. tests/foo.test.ts)
 * @param {string} body     file contents (may be empty if unreadable)
 * @param {number} size     byte length
 * @returns {number} weight >= 1
 */
export function weightForTestFile(relPath, body, size) {
  const path = relPath.replace(/\\/g, '/');
  const text = typeof body === 'string' ? body : '';
  const bytes = Number.isFinite(size) && size > 0 ? size : text.length;
  let w = 1000 + bytes;

  // Heavy runtime graphs (import-bound residual drivers).
  if (/\bfrom\s+['"]three(?:\/|['"])/.test(text) || /require\(['"]three['"]\)/.test(text)) {
    w += 80_000;
  }
  if (/src\/render\/|from\s+['"][^'"]*\/render\//.test(text)) w += 40_000;
  if (path.includes('electron') || /from\s+['"][^'"]*electron/.test(text)) w += 50_000;
  if (/from\s+['"][^'"]*server\//.test(text) || path.startsWith('tests/server/')) w += 25_000;
  if (/from\s+['"][^'"]*src\/sim\/sim['"]|from\s+['"][^'"]*\/sim['"]/.test(text)) w += 30_000;
  if (/from\s+['"][^'"]*src\/sim\//.test(text)) w += 10_000;
  if (/@vitest-environment\s+jsdom/.test(text)) w += 15_000;
  if (path.startsWith('tests/admin/') || /from\s+['"][^'"]*src\/admin\//.test(text)) w += 20_000;
  if (/i18n\.resolved|i18n\.catalog|from\s+['"][^'"]*i18n/.test(text)) w += 15_000;
  if (/from\s+['"][^'"]*src\/ui\//.test(text)) w += 12_000;
  if (/from\s+['"][^'"]*src\/net\//.test(text)) w += 12_000;
  if (/from\s+['"][^'"]*src\/game\//.test(text)) w += 12_000;
  if (path.startsWith('tests/parity/')) w += 20_000;
  if (path.startsWith('tests/helpers/')) w += 5_000;

  const overlay = DURATION_WEIGHT_OVERLAY[path];
  if (overlay) w += overlay;

  return w < 1 ? 1 : w;
}

/**
 * Completeness check: packs form a partition of the original key set.
 * @param {WeightedItem[]} items
 * @param {WeightedItem[][]} packs
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function assertPartitionCompleteness(items, packs) {
  const expected = new Set(items.map((i) => i.key));
  const seen = new Set();
  for (const pack of packs) {
    for (const item of pack) {
      if (seen.has(item.key)) {
        return { ok: false, reason: `duplicate key in packs: ${item.key}` };
      }
      if (!expected.has(item.key)) {
        return { ok: false, reason: `unknown key in packs: ${item.key}` };
      }
      seen.add(item.key);
    }
  }
  if (seen.size !== expected.size) {
    const missing = [...expected].filter((k) => !seen.has(k));
    return {
      ok: false,
      reason: `missing ${expected.size - seen.size} key(s); e.g. ${missing[0] ?? '?'}`,
    };
  }
  return { ok: true };
}
