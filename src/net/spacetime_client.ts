import { DbConnection, type SubscriptionHandle } from './module_bindings';
import type { SpacetimeConnectionConfig } from './backend';

export type StdbConnection = DbConnection;
export type StdbSubscriptionHandle = SubscriptionHandle;

const TOKEN_KEY_PREFIX = 'woc_stdb_identity_token:';

function storageAvailable(): boolean {
  try {
    return typeof globalThis.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function tokenKey(config: SpacetimeConnectionConfig): string {
  return `${TOKEN_KEY_PREFIX}${config.uri}:${config.moduleName}`;
}

function readStoredToken(config: SpacetimeConnectionConfig): string | undefined {
  if (!storageAvailable()) return undefined;
  try {
    return globalThis.localStorage.getItem(tokenKey(config)) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStoredToken(config: SpacetimeConnectionConfig, token: string): void {
  if (!storageAvailable()) return;
  try {
    globalThis.localStorage.setItem(tokenKey(config), token);
  } catch {
    // Storage can be disabled or quota-limited; the live connection is still valid.
  }
}

export function table(db: unknown, camelName: string, snakeName = camelName): any {
  const view = db as Record<string, any>;
  return view[camelName] ?? view[snakeName];
}

export function rows<T = any>(tbl: any): T[] {
  if (!tbl?.iter) return [];
  return Array.from(tbl.iter()) as T[];
}

export class StdbClient {
  private conn: StdbConnection | null = null;
  private connecting: Promise<StdbConnection> | null = null;
  private disconnectHandlers = new Set<(reason: string) => void>();

  identityHex = '';
  authToken = '';

  constructor(readonly config: SpacetimeConnectionConfig) {}

  onDisconnect(handler: (reason: string) => void): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  async connect(): Promise<StdbConnection> {
    if (this.conn?.isActive) return this.conn;
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<StdbConnection>((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        this.conn = null;
        this.connecting = null;
        reject(err);
      };
      try {
        const conn = DbConnection.builder()
          .withUri(this.config.uri)
          .withDatabaseName(this.config.moduleName)
          .withToken(readStoredToken(this.config))
          .onConnect((connected, identity, token) => {
            this.conn = connected;
            this.identityHex = identity.toHexString();
            this.authToken = token;
            writeStoredToken(this.config, token);
            if (!settled) {
              settled = true;
              this.connecting = null;
              resolve(connected);
            }
          })
          .onConnectError((_ctx, error) => fail(error))
          .onDisconnect((_ctx, error) => {
            this.conn = null;
            this.connecting = null;
            const reason = error?.message || 'Connection to SpacetimeDB was lost.';
            if (!settled) {
              settled = true;
              reject(new Error(reason));
            }
            for (const handler of this.disconnectHandlers) handler(reason);
          })
          .build();
        this.conn = conn;
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    });

    return this.connecting;
  }

  disconnect(): void {
    this.connecting = null;
    const conn = this.conn;
    this.conn = null;
    conn?.disconnect();
  }
}
