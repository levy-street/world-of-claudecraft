import type { PlayerClass } from '../sim/types';
import type { CharacterSummary, RealmDirectory } from './online';
import type { SpacetimeConnectionConfig } from './backend';
import { StdbClient, rows, table, type StdbConnection, type StdbSubscriptionHandle } from './spacetime_client';

type AuthRow = {
  accountId: bigint;
  username: string;
  error: string;
};

type RosterRow = {
  realm: string;
  charactersJson: string;
  error: string;
};

type ProjectStatsRow = {
  realm: string;
  accountsCreated: bigint;
  playersOnline: number;
};

function asError(err: unknown, fallback = 'request failed'): Error {
  if (err instanceof Error && err.message) return err;
  return new Error(String(err || fallback));
}

function parseCharacters(row: RosterRow | null): CharacterSummary[] {
  if (!row?.charactersJson) return [];
  const parsed = JSON.parse(row.charactersJson) as CharacterSummary[];
  return parsed.map((c) => ({
    id: Number(c.id),
    name: String(c.name),
    class: c.class,
    level: Number(c.level),
    online: !!c.online,
    forceRename: !!c.forceRename,
  }));
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  if (predicate()) return;
  const started = Date.now();
  await new Promise<void>((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('SpacetimeDB request timed out'));
      }
    }, 25);
  });
}

export class SpacetimeApi {
  token: string | null = null;
  username: string | null = null;
  realm: string | null = null;
  base = '';

  private readonly client: StdbClient;
  private ready: Promise<void> | null = null;
  private subscription: StdbSubscriptionHandle | null = null;
  private auth: AuthRow | null = null;
  private roster: RosterRow | null = null;
  private stats: ProjectStatsRow | null = null;
  private authRevision = 0;
  private rosterRevision = 0;
  private statsRevision = 0;

  constructor(config: SpacetimeConnectionConfig) {
    this.client = new StdbClient(config);
  }

  setRealm(_url: string): void {
    this.base = '';
  }

  async connection(): Promise<StdbConnection> {
    await this.ensureReady();
    return this.client.connect();
  }

  private async ensureReady(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this.open();
    return this.ready;
  }

  private async open(): Promise<void> {
    const conn = await this.client.connect();

    const authTable = table(conn.db, 'authState', 'auth_state');
    const rosterTable = table(conn.db, 'characterRoster', 'character_roster');
    const statsTable = table(conn.db, 'projectStats', 'project_stats');

    const updateAuth = (_ctx: unknown, row: AuthRow) => {
      this.auth = row;
      this.authRevision++;
      this.token = this.client.authToken || null;
      this.username = row.username || null;
    };
    const updateRoster = (_ctx: unknown, row: RosterRow) => {
      this.roster = row;
      this.rosterRevision++;
      this.realm = row.realm || this.realm;
    };
    const updateStats = (_ctx: unknown, row: ProjectStatsRow) => {
      this.stats = row;
      this.statsRevision++;
      this.realm = row.realm || this.realm;
    };

    authTable.onInsert(updateAuth);
    authTable.onUpdate((_ctx: unknown, _old: AuthRow, row: AuthRow) => updateAuth(_ctx, row));
    rosterTable.onInsert(updateRoster);
    rosterTable.onUpdate((_ctx: unknown, _old: RosterRow, row: RosterRow) => updateRoster(_ctx, row));
    statsTable.onInsert(updateStats);
    statsTable.onUpdate((_ctx: unknown, _old: ProjectStatsRow, row: ProjectStatsRow) => updateStats(_ctx, row));

    await new Promise<void>((resolve, reject) => {
      this.subscription = conn
        .subscriptionBuilder()
        .onApplied(() => {
          for (const row of rows<AuthRow>(authTable)) updateAuth(null, row);
          for (const row of rows<RosterRow>(rosterTable)) updateRoster(null, row);
          for (const row of rows<ProjectStatsRow>(statsTable)) updateStats(null, row);
          resolve();
        })
        .onError((ctx: any) => reject(new Error(ctx?.event?.message ?? 'SpacetimeDB subscription failed')))
        .subscribe([
          'SELECT * FROM auth_state',
          'SELECT * FROM character_roster',
          'SELECT * FROM project_stats',
        ]);
    });
  }

  private async reducer<T>(fn: (conn: StdbConnection) => Promise<T>, fallback: string): Promise<T> {
    const conn = await this.connection();
    try {
      return await fn(conn);
    } catch (err) {
      throw asError(err, fallback);
    }
  }

  private async waitForAuth(revision: number): Promise<void> {
    await waitFor(() => this.authRevision > revision);
    if (this.auth?.error) throw new Error(this.auth.error);
    if (!this.auth || Number(this.auth.accountId) <= 0) throw new Error('not authenticated');
  }

  private async waitForRoster(revision: number): Promise<void> {
    await waitFor(() => this.rosterRevision > revision);
    if (this.roster?.error) throw new Error(this.roster.error);
  }

  async realms(): Promise<RealmDirectory> {
    await this.ensureReady();
    const stats = await this.projectStats();
    const chars = this.token ? parseCharacters(this.roster).length : 0;
    return {
      current: stats.realm,
      realms: [{ name: stats.realm, url: '', type: 'Normal' }],
      characters: chars > 0 ? { [stats.realm]: chars } : {},
    };
  }

  async realmStatus(_url: string): Promise<{ online: boolean; players: number }> {
    const stats = await this.projectStats();
    return { online: true, players: stats.players_online };
  }

  async register(username: string, password: string): Promise<void> {
    const revision = this.authRevision;
    await this.reducer((conn) => conn.reducers.register({ username, password }), 'could not register');
    await this.waitForAuth(revision);
  }

  async login(username: string, password: string): Promise<void> {
    const revision = this.authRevision;
    await this.reducer((conn) => conn.reducers.login({ username, password }), 'could not log in');
    await this.waitForAuth(revision);
  }

  async characters(): Promise<CharacterSummary[]> {
    const revision = this.rosterRevision;
    await this.reducer((conn) => conn.reducers.listCharacters({}), 'could not list characters');
    if (!this.roster || this.rosterRevision === revision) await this.waitForRoster(revision);
    if (this.roster?.error) throw new Error(this.roster.error);
    this.realm = this.roster?.realm ?? this.realm;
    return parseCharacters(this.roster);
  }

  async createCharacter(name: string, cls: PlayerClass): Promise<void> {
    const revision = this.rosterRevision;
    await this.reducer((conn) => conn.reducers.createCharacter({ name, className: cls }), 'could not create character');
    await this.waitForRoster(revision);
  }

  async renameCharacter(characterId: number, name: string): Promise<void> {
    const revision = this.rosterRevision;
    await this.reducer((conn) => conn.reducers.renameCharacter({ characterId: BigInt(characterId), name }), 'could not rename character');
    await this.waitForRoster(revision);
  }

  async deleteCharacter(characterId: number, name: string): Promise<void> {
    const revision = this.rosterRevision;
    await this.reducer((conn) => conn.reducers.deleteCharacter({ characterId: BigInt(characterId), name }), 'could not delete character');
    await this.waitForRoster(revision);
  }

  async reportPlayer(reporterCharacterId: number, targetPid: number, reason: string, details: string): Promise<void> {
    await this.reducer((conn) => conn.reducers.reportPlayer({
      reporterCharacterId: BigInt(reporterCharacterId),
      targetPid,
      reason,
      details,
    }), 'could not submit report');
  }

  async reportPlayerByName(reporterCharacterId: number, targetCharacterName: string, reason: string, details: string): Promise<void> {
    await this.reducer((conn) => conn.reducers.reportPlayerByName({
      reporterCharacterId: BigInt(reporterCharacterId),
      targetCharacterName,
      reason,
      details,
    }), 'could not submit report');
  }

  async projectStats(): Promise<{ accounts_created: number; players_online: number; realm: string }> {
    await this.ensureReady();
    if (!this.stats && this.statsRevision === 0) {
      await waitFor(() => this.statsRevision > 0, 2_000).catch(() => {});
    }
    return {
      accounts_created: Number(this.stats?.accountsCreated ?? 0n),
      players_online: Number(this.stats?.playersOnline ?? 0),
      realm: this.stats?.realm ?? 'Claudemoon',
    };
  }

  close(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.client.disconnect();
    this.ready = null;
  }
}
