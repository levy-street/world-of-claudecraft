import { Pool } from 'pg';

const RETIRED_ITEM_ID = 'pristine_ridge_stalker_pelt';
const REPLACEMENT_ITEM_ID = 'old_cragmaws_pelt';

interface Options {
  apply: boolean;
  realm?: string;
}

interface ItemSlotLike {
  itemId?: unknown;
  [key: string]: unknown;
}

interface MigrationResult<T> {
  changed: boolean;
  value: T;
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
      realm = argv[i + 1]?.trim();
      i += 1;
      continue;
    }
    if (arg.startsWith('--realm=')) {
      realm = arg.slice('--realm='.length).trim();
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { apply, realm: realm || undefined };
}

function replaceItemId(itemId: unknown): MigrationResult<unknown> {
  if (itemId !== RETIRED_ITEM_ID) return { changed: false, value: itemId };
  return { changed: true, value: REPLACEMENT_ITEM_ID };
}

function migrateItemSlot<T>(slot: T): MigrationResult<T> {
  if (!slot || typeof slot !== 'object' || !('itemId' in slot)) {
    return { changed: false, value: slot };
  }
  const itemSlot = slot as ItemSlotLike;
  const itemId = replaceItemId(itemSlot.itemId);
  if (!itemId.changed) return { changed: false, value: slot };
  return {
    changed: true,
    value: { ...itemSlot, itemId: itemId.value } as T,
  };
}

function migrateItemSlots<T>(slots: T): MigrationResult<T> {
  if (!Array.isArray(slots)) return { changed: false, value: slots };

  let changed = false;
  const value = slots.map((slot) => {
    const result = migrateItemSlot(slot);
    changed ||= result.changed;
    return result.value;
  });

  return { changed, value: value as T };
}

function migrateEquipment<T>(equipment: T): MigrationResult<T> {
  if (!equipment || typeof equipment !== 'object') return { changed: false, value: equipment };

  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [slot, itemId] of Object.entries(equipment)) {
    const result = replaceItemId(itemId);
    changed ||= result.changed;
    next[slot] = result.value;
  }

  return { changed, value: (changed ? next : equipment) as T };
}

export function migrateCharacterState<T>(state: T): MigrationResult<T> {
  if (!state || typeof state !== 'object') return { changed: false, value: state };

  let changed = false;
  const source = state as Record<string, unknown>;
  const next: Record<string, unknown> = { ...source };

  for (const key of ['inventory', 'vendorBuyback']) {
    const result = migrateItemSlots(source[key]);
    if (result.changed) {
      changed = true;
      next[key] = result.value;
    }
  }

  const equipment = migrateEquipment(source.equipment);
  if (equipment.changed) {
    changed = true;
    next.equipment = equipment.value;
  }

  return { changed, value: (changed ? next : state) as T };
}

export function migrateMarketState<T>(state: T): MigrationResult<T> {
  if (!state || typeof state !== 'object') return { changed: false, value: state };

  let changed = false;
  const source = state as Record<string, unknown>;
  const next: Record<string, unknown> = { ...source };

  const listings = migrateItemSlots(source.listings);
  if (listings.changed) {
    changed = true;
    next.listings = listings.value;
  }

  if (Array.isArray(source.collections)) {
    const collections = source.collections.map((collection) => {
      if (!collection || typeof collection !== 'object') return collection;
      const collectionRecord = collection as Record<string, unknown>;
      const items = migrateItemSlots(collectionRecord.items);
      if (!items.changed) return collection;
      changed = true;
      return { ...collectionRecord, items: items.value };
    });
    if (changed) next.collections = collections;
  }

  return { changed, value: (changed ? next : state) as T };
}

export async function runOldCragmawPeltMigration(argv: readonly string[]): Promise<void> {
  try {
    process.loadEnvFile?.();
  } catch {
    // .env is optional; production injects DATABASE_URL through Docker Compose.
  }

  const { apply, realm } = parseArgs(argv);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const likeNeedle = `%${RETIRED_ITEM_ID}%`;
  const realmParams: string[] = realm ? [likeNeedle, realm] : [likeNeedle];
  const realmClause = realm ? ' AND realm = $2' : '';

  let scannedCharacters = 0;
  let changedCharacters = 0;
  let scannedWorldStates = 0;
  let changedWorldStates = 0;
  let committed = false;

  try {
    await pool.query('BEGIN');

    const characters = await pool.query<{ id: number; state: unknown }>(
      `SELECT id, state
       FROM characters
       WHERE state IS NOT NULL AND state::text LIKE $1${realmClause}
       ORDER BY id ASC`,
      realmParams,
    );

    for (const row of characters.rows) {
      scannedCharacters += 1;
      const result = migrateCharacterState(row.state);
      if (!result.changed) continue;

      changedCharacters += 1;
      if (apply) {
        await pool.query('UPDATE characters SET state = $1 WHERE id = $2', [
          JSON.stringify(result.value),
          row.id,
        ]);
      }
    }

    const worldStates = await pool.query<{ key: string; data: unknown }>(
      "SELECT key, data FROM world_state WHERE key = 'market' AND data::text LIKE $1 ORDER BY key ASC",
      [likeNeedle],
    );

    for (const row of worldStates.rows) {
      scannedWorldStates += 1;
      const result = migrateMarketState(row.data);
      if (!result.changed) continue;

      changedWorldStates += 1;
      if (apply) {
        await pool.query('UPDATE world_state SET data = $1, updated_at = now() WHERE key = $2', [
          JSON.stringify(result.value),
          row.key,
        ]);
      }
    }

    if (apply) {
      const remainingCharacters = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM characters
         WHERE state IS NOT NULL AND state::text LIKE $1${realmClause}`,
        realmParams,
      );
      const remainingMarket = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM world_state WHERE key = 'market' AND data::text LIKE $1",
        [likeNeedle],
      );

      if (
        Number(remainingCharacters.rows[0]?.count ?? 0) > 0 ||
        Number(remainingMarket.rows[0]?.count ?? 0) > 0
      ) {
        throw new Error(`Migration verification failed: ${RETIRED_ITEM_ID} still exists.`);
      }

      await pool.query('COMMIT');
      committed = true;
    } else {
      await pool.query('ROLLBACK');
    }
  } catch (err) {
    if (!committed) {
      try {
        await pool.query('ROLLBACK');
      } catch {
        // Ignore rollback errors after a failed or already closed transaction.
      }
    }
    throw err;
  } finally {
    await pool.end();
  }

  const scope = realm ? `realm "${realm}"` : 'all realms';
  const mode = apply ? 'updated' : 'would update';
  console.log(
    [
      `Old Cragmaw pelt migration (${scope}):`,
      `characters scanned=${scannedCharacters}, ${mode}=${changedCharacters}`,
      `market documents scanned=${scannedWorldStates}, ${mode}=${changedWorldStates}`,
    ].join(' '),
  );
  if (!apply) {
    console.log('Dry run only. Re-run with --apply to write migrated state.');
  }
}
