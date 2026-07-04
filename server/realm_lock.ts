// Namespace for advisory locks owned by World of ClaudeCraft realm processes.
// The second key is a stable hash of REALM_NAME, so different realms can run
// side by side while duplicate processes for one realm fail fast.
const REALM_LOCK_NAMESPACE = 0x57_4f_43; // "WOC"

interface RealmLockQueryResult<T> {
  rows: T[];
}

interface RealmLockClient {
  query<T = unknown>(text: string, values?: unknown[]): Promise<RealmLockQueryResult<T>>;
  release(): void;
}

interface RealmLockPool {
  connect(): Promise<RealmLockClient>;
}

export interface RealmSingletonLock {
  readonly realm: string;
  release(): Promise<void>;
}

export function realmSingletonLockEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.REALM_SINGLETON_LOCK !== '0';
}

export function realmAdvisoryLockKeys(realm: string): [number, number] {
  return [REALM_LOCK_NAMESPACE, fnv1a32(realm.trim().toLowerCase())];
}

function fnv1a32(input: string): number {
  let hash = 0x811c_9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash | 0;
}

export async function acquireRealmSingletonLock(
  pool: RealmLockPool,
  realm: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RealmSingletonLock | null> {
  if (!realmSingletonLockEnabled(env)) return null;

  const client = await pool.connect();
  const [namespace, realmKey] = realmAdvisoryLockKeys(realm);
  try {
    const result = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      [namespace, realmKey],
    );
    if (result.rows[0]?.locked !== true) {
      throw new Error(
        `Realm "${realm}" is already hosted by another game server process. ` +
          'Use one authoritative process per realm, or give this process a different REALM_NAME.',
      );
    }
    return new PgRealmSingletonLock(client, realm, namespace, realmKey);
  } catch (err) {
    client.release();
    throw err;
  }
}

class PgRealmSingletonLock implements RealmSingletonLock {
  private released = false;

  constructor(
    private readonly client: RealmLockClient,
    readonly realm: string,
    private readonly namespace: number,
    private readonly realmKey: number,
  ) {}

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    try {
      await this.client.query('SELECT pg_advisory_unlock($1, $2)', [this.namespace, this.realmKey]);
    } finally {
      this.client.release();
    }
  }
}
