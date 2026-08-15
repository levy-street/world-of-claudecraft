// One-off remediation for the Rift forge wire exploit (PR #3329 closed the
// hole; this reverses its gains). The three forge commands were dispatchable
// by any authenticated client while the forge UI never shipped, so every
// forge effect in production data is exploit-derived: upgrade levels,
// enchants, and socketed gems on Riftbound gear. This migration resets each
// affected item instance to its as-dropped state and refunds what the forge
// consumed: essence for upgrades and enchants, gem items for sockets.
//
// Costs mirror src/sim/rift/progression.ts and are pinned against it by
// tests/rift_forge_rollback_migration.test.ts:
//   upgrade step k costs 2 + 2k essence, so reaching level N cost N * (N + 1)
//   enchant costs a flat 4 essence
//   socketing consumes the gem item only, no essence
//
// THIS IS A ONE-OFF, NOT A STANDING MIGRATION. The cragmaw migration can run
// on every deploy because its matching condition (a retired item id) can
// never legitimately reappear. This one is the opposite: if the Rift forge
// ships for real later, forge effects on items become LEGITIMATE state, and
// re-running this rollback would wipe honest players' progress. Three guards
// enforce the one-off contract:
//   1. The deploy playbook gates it behind eastbrook_run_rift_forge_rollback,
//      which defaults to false and is passed explicitly for one deploy only.
//   2. On a successful --apply this script writes a completion marker row
//      (world_state key below) in the same transaction, and every later run
//      refuses outright while the marker exists.
//   3. Apply requires a drained character_leases table, locks out admission and
//      character writes, and compare-and-swaps every selected state blob.
//
// Run with no flags for an all-realm dry run. --realm NAME scopes a dry run;
// --apply is all-realm only and belongs in a maintenance window after game
// servers have stopped accepting players and drained their character leases.
// The apply path verifies that drain under table locks before writing. Otherwise
// modeled on old_cragmaw_pelt_migration.ts, the deploy-time precedent.

import { Pool, type PoolClient } from 'pg';

const RIFT_ESSENCE_ITEM_ID = 'rift_essence';
const REFUND_STACK_SIZE = 20;
const ENCHANT_ESSENCE_COST = 4;
const ADVISORY_LOCK_CLASS = 3354;
const ADVISORY_LOCK_KEY = 20260813;

/** Completion marker: present in world_state means this one-off already ran
 *  and must never run again (see the header comment). */
export const COMPLETION_MARKER_KEY = 'migration:rift-forge-rollback-2026-08-13';

interface Options {
  apply: boolean;
  realm?: string;
}

export interface RiftForgeRollbackRuntime {
  loadEnvFile(): void;
  databaseUrl(): string | undefined;
  createPool(connectionString: string): Pool;
}

const DEFAULT_RUNTIME: RiftForgeRollbackRuntime = {
  loadEnvFile: () => process.loadEnvFile?.(),
  databaseUrl: () => process.env.DATABASE_URL,
  createPool: (connectionString) => new Pool({ connectionString, max: 2 }),
};

export interface RiftPayloadLike {
  upgradeLevel?: unknown;
  enchant?: unknown;
  gems?: unknown;
  baseStats?: unknown;
  [key: string]: unknown;
}

export interface InstanceLike {
  rift?: RiftPayloadLike;
  rolled?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SlotLike {
  itemId?: unknown;
  count?: unknown;
  instance?: unknown;
  [key: string]: unknown;
}

export interface RollbackRefund {
  essence: number;
  gems: string[];
}

interface InstanceRollback {
  changed: boolean;
  value: InstanceLike;
  refund: RollbackRefund;
}

export function upgradeEssenceSpent(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  return level * (level + 1);
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Mirrors rebuildRolledStats in src/sim/rift/progression.ts at the reset
 *  state (level 0, no enchant, no gems): base stats only, with `sta`
 *  materialized the same way the live rebuild materializes it. */
function resetRolledStats(instance: InstanceLike, rift: RiftPayloadLike): Record<string, unknown> {
  const base =
    rift.baseStats && typeof rift.baseStats === 'object'
      ? (rift.baseStats as Record<string, unknown>)
      : {};
  const stats: Record<string, number> = {};
  for (const [key, value] of Object.entries(base)) stats[key] = asNumber(value);
  stats.sta = stats.sta ?? 0;
  return { ...(instance.rolled ?? {}), quality: 'epic', stats };
}

export function rollbackInstance(instance: unknown): InstanceRollback {
  const empty: RollbackRefund = { essence: 0, gems: [] };
  if (!instance || typeof instance !== 'object' || !('rift' in instance)) {
    return { changed: false, value: instance as InstanceLike, refund: empty };
  }
  const source = instance as InstanceLike;
  const rift = source.rift;
  if (!rift || typeof rift !== 'object') {
    return { changed: false, value: source, refund: empty };
  }

  const upgradeLevel = asNumber(rift.upgradeLevel);
  const hasEnchant = rift.enchant != null && typeof rift.enchant === 'object';
  const gems = Array.isArray(rift.gems)
    ? rift.gems.filter((gem): gem is string => typeof gem === 'string')
    : [];
  if (upgradeLevel <= 0 && !hasEnchant && gems.length === 0) {
    return { changed: false, value: source, refund: empty };
  }

  const nextRift: RiftPayloadLike = { ...rift, upgradeLevel: 0, gems: [] };
  delete nextRift.enchant;
  const value: InstanceLike = {
    ...source,
    rift: nextRift,
    rolled: resetRolledStats(source, rift),
  };
  return {
    changed: true,
    value,
    refund: {
      essence: upgradeEssenceSpent(upgradeLevel) + (hasEnchant ? ENCHANT_ESSENCE_COST : 0),
      gems,
    },
  };
}

interface SlotsRollback {
  changed: boolean;
  value: unknown;
  refund: RollbackRefund;
  instancesReset: number;
}

function mergeRefund(into: RollbackRefund, from: RollbackRefund): void {
  into.essence += from.essence;
  into.gems.push(...from.gems);
}

export function rollbackSlots(slots: unknown): SlotsRollback {
  const refund: RollbackRefund = { essence: 0, gems: [] };
  if (!Array.isArray(slots)) return { changed: false, value: slots, refund, instancesReset: 0 };

  let changed = false;
  let instancesReset = 0;
  const value = slots.map((slot) => {
    if (!slot || typeof slot !== 'object' || !('instance' in slot)) return slot;
    const slotRecord = slot as SlotLike;
    const result = rollbackInstance(slotRecord.instance);
    if (!result.changed) return slot;
    changed = true;
    instancesReset += 1;
    mergeRefund(refund, result.refund);
    return { ...slotRecord, instance: result.value };
  });

  return { changed, value: changed ? value : slots, refund, instancesReset };
}

export function rollbackInstanceRecord(record: unknown): SlotsRollback {
  const refund: RollbackRefund = { essence: 0, gems: [] };
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { changed: false, value: record, refund, instancesReset: 0 };
  }

  let changed = false;
  let instancesReset = 0;
  const next: Record<string, unknown> = {};
  for (const [slot, instance] of Object.entries(record)) {
    const result = rollbackInstance(instance);
    if (result.changed) {
      changed = true;
      instancesReset += 1;
      mergeRefund(refund, result.refund);
      next[slot] = result.value;
    } else {
      next[slot] = instance;
    }
  }

  return { changed, value: changed ? next : record, refund, instancesReset };
}

/** Adds refunded items to an inventory immutably: tops up existing plain
 *  stacks of the same item first, then appends new stacks. The sim load path
 *  tolerates an over-capacity inventory (capacity only blocks new pickups),
 *  so appending is always safe. */
export function addRefundToInventory(inventory: unknown, itemId: string, count: number): unknown {
  if (count <= 0) return inventory;
  const slots = Array.isArray(inventory) ? [...inventory] : [];
  let remaining = count;

  for (let i = 0; i < slots.length && remaining > 0; i += 1) {
    const slot = slots[i];
    if (!slot || typeof slot !== 'object') continue;
    const slotRecord = slot as SlotLike;
    if (slotRecord.itemId !== itemId || slotRecord.instance != null) continue;
    const current = asNumber(slotRecord.count);
    if (current >= REFUND_STACK_SIZE) continue;
    const add = Math.min(REFUND_STACK_SIZE - current, remaining);
    slots[i] = { ...slotRecord, count: current + add };
    remaining -= add;
  }

  while (remaining > 0) {
    const add = Math.min(REFUND_STACK_SIZE, remaining);
    slots.push({ itemId, count: add });
    remaining -= add;
  }

  return slots;
}

export interface CharacterRollbackReport {
  instancesReset: number;
  essenceRefunded: number;
  gemsReturned: Record<string, number>;
}

interface CharacterRollback {
  changed: boolean;
  value: unknown;
  report: CharacterRollbackReport;
}

export function rollbackCharacterState(state: unknown): CharacterRollback {
  const report: CharacterRollbackReport = {
    instancesReset: 0,
    essenceRefunded: 0,
    gemsReturned: {},
  };
  if (!state || typeof state !== 'object') return { changed: false, value: state, report };

  const source = state as Record<string, unknown>;
  const next: Record<string, unknown> = { ...source };
  const refund: RollbackRefund = { essence: 0, gems: [] };
  let changed = false;
  let instancesReset = 0;

  for (const key of ['inventory', 'vendorBuyback']) {
    const result = rollbackSlots(source[key]);
    if (result.changed) {
      changed = true;
      instancesReset += result.instancesReset;
      mergeRefund(refund, result.refund);
      next[key] = result.value;
    }
  }

  const bank = source.bank;
  if (bank && typeof bank === 'object') {
    const bankRecord = bank as Record<string, unknown>;
    const result = rollbackSlots(bankRecord.inventory);
    if (result.changed) {
      changed = true;
      instancesReset += result.instancesReset;
      mergeRefund(refund, result.refund);
      next.bank = { ...bankRecord, inventory: result.value };
    }
  }

  // Match the runtime load path exactly: the current singular key wins whenever
  // it is non-nullish, otherwise the legacy plural key is the active record.
  // A forged plural shadow under an active current key is inert at runtime. Drop
  // that shadow without refunding it so recursive verification passes without
  // treating one logical equipped copy as two consumed items.
  const equipmentKey =
    source.equipmentInstance != null
      ? 'equipmentInstance'
      : source.equipmentInstances != null
        ? 'equipmentInstances'
        : undefined;
  if (equipmentKey) {
    const result = rollbackInstanceRecord(source[equipmentKey]);
    if (result.changed) {
      changed = true;
      instancesReset += result.instancesReset;
      mergeRefund(refund, result.refund);
      next[equipmentKey] = result.value;
    }
  }
  if (
    equipmentKey === 'equipmentInstance' &&
    rollbackInstanceRecord(source.equipmentInstances).changed
  ) {
    changed = true;
    delete next.equipmentInstances;
  }

  if (!changed) return { changed: false, value: state, report };

  let inventory = next.inventory ?? source.inventory;
  inventory = addRefundToInventory(inventory, RIFT_ESSENCE_ITEM_ID, refund.essence);
  const gemCounts: Record<string, number> = {};
  for (const gem of refund.gems) gemCounts[gem] = (gemCounts[gem] ?? 0) + 1;
  for (const [gemId, gemCount] of Object.entries(gemCounts)) {
    inventory = addRefundToInventory(inventory, gemId, gemCount);
  }
  next.inventory = inventory;

  report.instancesReset = instancesReset;
  report.essenceRefunded = refund.essence;
  report.gemsReturned = gemCounts;
  return { changed: true, value: next, report };
}

function parseArgs(argv: readonly string[]): Options {
  let realm: string | undefined;
  let apply = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--realm') {
      const value = argv[i + 1]?.trim();
      if (!value || value.startsWith('--')) throw new Error('--realm requires a realm name.');
      realm = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--realm=')) {
      const value = arg.slice('--realm='.length).trim();
      if (!value) throw new Error('--realm requires a realm name.');
      realm = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (apply && realm) {
    throw new Error('--realm is dry-run-only; --apply must verify and update all realms.');
  }

  return { apply, realm: realm || undefined };
}

const REMAINING_FORGE_EFFECTS_PATH =
  '$.**.rift ? (@.upgradeLevel > 0 || exists(@.enchant) || @.gems.size() > 0)';

export async function runRiftForgeRollbackMigration(
  argv: readonly string[],
  runtime: RiftForgeRollbackRuntime = DEFAULT_RUNTIME,
): Promise<void> {
  const { apply, realm } = parseArgs(argv);
  try {
    runtime.loadEnvFile();
  } catch {
    // .env is optional; production injects DATABASE_URL through Docker Compose.
  }

  const databaseUrl = runtime.databaseUrl();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  const pool = runtime.createPool(databaseUrl);
  const likeNeedle = '%"rift":%';
  const realmParams: string[] = realm ? [likeNeedle, realm] : [likeNeedle];
  const realmClause = realm ? ' AND realm = $2' : '';

  let scanned = 0;
  let changedCharacters = 0;
  let totalInstances = 0;
  let totalEssence = 0;
  const totalGems: Record<string, number> = {};
  let client: PoolClient | undefined;
  let transactionOpen = false;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
      ADVISORY_LOCK_CLASS,
      ADVISORY_LOCK_KEY,
    ]);

    // The transaction-scoped advisory lock serializes the absent-marker case:
    // a concurrent runner cannot pass this recheck until the first one commits
    // its completion marker or rolls back all character writes.
    const marker = await client.query<{ data: unknown }>(
      'SELECT data FROM world_state WHERE key = $1',
      [COMPLETION_MARKER_KEY],
    );
    if (marker.rows.length > 0) {
      console.log(
        `Refusing to run: completion marker ${COMPLETION_MARKER_KEY} exists. ` +
          'This rollback is a one-off that already applied; forge effects found now ' +
          `are presumed legitimate. Marker: ${JSON.stringify(marker.rows[0].data)}`,
      );
      await client.query('ROLLBACK');
      transactionOpen = false;
      return;
    }

    if (apply) {
      // Lock characters first and exclusively. A new admission that starts after
      // this waits before its first read; one already between its first read and
      // lease acquire waits on the lease-table lock below, then ws_auth reloads
      // the character after the acquire before joining.
      await client.query('LOCK TABLE characters IN ACCESS EXCLUSIVE MODE');
      // Production character writes are fenced by character_leases. This lock
      // prevents a new lease or heartbeat from appearing after the check below.
      await client.query('LOCK TABLE character_leases IN SHARE MODE');
      // Expired crash orphans are not removed automatically. Delete them while
      // both locks are held: this also revokes their nonce fence before apply.
      await client.query('DELETE FROM character_leases WHERE expires_at <= now()');
      const leases = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM character_leases',
      );
      const leaseCount = Number(leases.rows[0]?.count ?? 0);
      if (leaseCount > 0) {
        throw new Error(
          `Migration apply requires all game servers stopped and drained; found ${leaseCount} character lease(s).`,
        );
      }
    }

    const characters = await client.query<{
      id: number;
      name: string;
      realm: string;
      state: unknown;
    }>(
      `SELECT id, name, realm, state
       FROM characters
       WHERE state IS NOT NULL AND state::text LIKE $1${realmClause}
       ORDER BY id ASC`,
      realmParams,
    );

    for (const row of characters.rows) {
      scanned += 1;
      const result = rollbackCharacterState(row.state);
      if (!result.changed) continue;

      changedCharacters += 1;
      totalInstances += result.report.instancesReset;
      totalEssence += result.report.essenceRefunded;
      for (const [gemId, gemCount] of Object.entries(result.report.gemsReturned)) {
        totalGems[gemId] = (totalGems[gemId] ?? 0) + gemCount;
      }
      const gems = Object.entries(result.report.gemsReturned)
        .map(([gemId, gemCount]) => `${gemId} x${gemCount}`)
        .join(', ');
      console.log(
        `character ${row.id} "${row.name}" (${row.realm}): ` +
          `reset ${result.report.instancesReset} item(s), ` +
          `refunded ${result.report.essenceRefunded} essence` +
          (gems ? `, returned ${gems}` : ''),
      );

      if (apply) {
        const updated = await client.query(
          `UPDATE characters SET state = $1
           WHERE id = $2 AND state IS NOT DISTINCT FROM $3::jsonb`,
          [JSON.stringify(result.value), row.id, JSON.stringify(row.state)],
        );
        if (updated.rowCount !== 1) {
          throw new Error(
            `Character ${row.id} changed after migration selection; aborting without completion marker.`,
          );
        }
      }
    }

    if (apply) {
      const remaining = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM characters
         WHERE state IS NOT NULL
           AND jsonb_path_exists(state::jsonb, $1)`,
        [REMAINING_FORGE_EFFECTS_PATH],
      );
      if (Number(remaining.rows[0]?.count ?? 0) > 0) {
        throw new Error('Migration verification failed: forge effects remain after rollback.');
      }
      await client.query('INSERT INTO world_state (key, data, updated_at) VALUES ($1, $2, now())', [
        COMPLETION_MARKER_KEY,
        JSON.stringify({
          charactersUpdated: changedCharacters,
          instancesReset: totalInstances,
          essenceRefunded: totalEssence,
          gemsReturned: totalGems,
          realmScope: 'all',
        }),
      ]);
      await client.query('COMMIT');
      transactionOpen = false;
    } else {
      await client.query('ROLLBACK');
      transactionOpen = false;
    }
  } catch (err) {
    if (client && transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback errors after a failed or already closed transaction.
      }
    }
    throw err;
  } finally {
    client?.release();
    await pool.end();
  }

  const scope = realm ? `realm "${realm}"` : 'all realms';
  const mode = apply ? 'updated' : 'would update';
  const gemSummary = Object.entries(totalGems)
    .map(([gemId, gemCount]) => `${gemId} x${gemCount}`)
    .join(', ');
  console.log(
    [
      `Rift forge rollback (${scope}):`,
      `characters scanned=${scanned}, ${mode}=${changedCharacters},`,
      `instances reset=${totalInstances}, essence refunded=${totalEssence}` +
        (gemSummary ? `, gems returned: ${gemSummary}` : ''),
    ].join(' '),
  );
  if (!apply) {
    console.log('Dry run only. Re-run with --apply to write rolled-back state.');
  }
}
