import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WebSocket } from 'ws';
import { DbConnection } from '../src/net/module_bindings';
import type { PlayerClass } from '../src/sim/types';
import type { CharacterState } from '../src/sim/sim';
import { GameServer, type ClientSession } from './game';
import { StdbGamePersistence } from './stdb_persistence';

try {
  process.loadEnvFile?.();
} catch {
  // .env is optional in production.
}

type IdentityLike = { toHexString(): string };

type WorldSessionRow = {
  id: bigint;
  owner: IdentityLike;
  accountId: bigint;
  characterId: bigint;
  playerId: number;
  className: string;
  characterName: string;
  active: boolean;
  bridgeAttached: boolean;
  error: string;
};

type CharacterRow = {
  id: bigint;
  accountId: bigint;
  name: string;
  className: string;
  level: number;
  stateJson: string;
};

type InputStateRow = {
  sessionId: bigint;
  forward: boolean;
  back: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  strafeLeft: boolean;
  strafeRight: boolean;
  jump: boolean;
  facingValid: boolean;
  facing: number;
};

type ClientCommandRow = {
  id: bigint;
  sessionId: bigint;
  kind: string;
  payloadJson: string;
  consumed: boolean;
};

type BridgeSession = {
  stdbId: bigint;
  owner: IdentityLike;
  accountId: number;
  characterId: number;
  gameSession: ClientSession;
};

const STDB_URI = process.env.STDB_URI ?? process.env.VITE_STDB_URI ?? 'http://127.0.0.1:3000';
const STDB_MODULE = process.env.STDB_MODULE ?? process.env.VITE_STDB_MODULE ?? 'worldofclaudecraft';
const TOKEN_FILE = resolve(process.env.STDB_BRIDGE_TOKEN_FILE ?? '.stdb-bridge-token');
const BRIDGE_SETUP_TOKEN = process.env.STDB_BRIDGE_SETUP_TOKEN?.trim() || '';
const SAVE_INTERVAL_MS = 30_000;

function table(db: unknown, camelName: string, snakeName = camelName): any {
  const view = db as Record<string, any>;
  return view[camelName] ?? view[snakeName];
}

function rows<T = any>(tbl: any): T[] {
  if (!tbl?.iter) return [];
  return Array.from(tbl.iter()) as T[];
}

function readBridgeToken(): string | undefined {
  if (process.env.STDB_AUTH_TOKEN) return process.env.STDB_AUTH_TOKEN;
  try {
    const token = readFileSync(TOKEN_FILE, 'utf8').trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

function writeBridgeToken(token: string): void {
  try {
    writeFileSync(TOKEN_FILE, `${token}\n`, { mode: 0o600 });
  } catch (err) {
    console.warn('could not persist SpacetimeDB bridge token:', err);
  }
}

function parseState(raw: string): CharacterState | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CharacterState;
  } catch {
    return null;
  }
}

class BridgeSocket {
  readyState = 1;

  constructor(private readonly sendHandler: (payload: string) => void) {}

  send(payload: unknown): void {
    this.sendHandler(String(payload));
  }

  close(): void {
    this.readyState = 3;
  }
}

class StdbBridge {
  private conn: DbConnection | null = null;
  private game: GameServer | null = null;
  private readonly sessions = new Map<string, BridgeSession>();
  private readonly consumedCommands = new Set<string>();
  private saveTimer: ReturnType<typeof setInterval> | null = null;

  async start(): Promise<void> {
    this.conn = await this.connect();
    this.game = new GameServer(new StdbGamePersistence(this.conn));
    if (BRIDGE_SETUP_TOKEN) {
      await this.conn.reducers.authorizeBridge({ setupToken: BRIDGE_SETUP_TOKEN });
    }
    await this.conn.reducers.bridgePing({ sessions: 0, tick: 0n });
    this.watchTables(this.conn);
    await new Promise<void>((resolve, reject) => {
      this.conn!
        .subscriptionBuilder()
        .onApplied(() => {
          resolve();
        })
        .onError((ctx: any) => reject(new Error(ctx?.event?.message ?? 'SpacetimeDB bridge subscription failed')))
        .subscribe([
          'SELECT * FROM world_session',
          'SELECT * FROM input_state',
          'SELECT * FROM client_command',
          'SELECT * FROM character',
          'SELECT * FROM world_state',
          'SELECT * FROM friend_link',
          'SELECT * FROM block_link',
          'SELECT * FROM guild',
          'SELECT * FROM guild_member',
        ]);
    });
    await this.game.loadMarket();
    this.game.start();
    this.scanInitialRows();
    this.saveTimer = setInterval(() => void this.saveAll(), SAVE_INTERVAL_MS);
    console.log(`SpacetimeDB bridge online: ${STDB_URI}/${STDB_MODULE}`);
  }

  private connect(): Promise<DbConnection> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      try {
        DbConnection.builder()
          .withUri(STDB_URI)
          .withDatabaseName(STDB_MODULE)
          .withToken(readBridgeToken())
          .onConnect((conn, identity, token) => {
            writeBridgeToken(token);
            console.log(`SpacetimeDB bridge identity: ${identity.toHexString()}`);
            if (!settled) {
              settled = true;
              resolve(conn);
            }
          })
          .onConnectError((_ctx, error) => fail(error))
          .onDisconnect((_ctx, error) => {
            console.error('SpacetimeDB bridge disconnected:', error?.message ?? 'connection closed');
            process.exitCode = 1;
            void this.stop();
          })
          .build();
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private watchTables(conn: DbConnection): void {
    const sessionTable = table(conn.db, 'worldSession', 'world_session');
    const inputTable = table(conn.db, 'inputState', 'input_state');
    const commandTable = table(conn.db, 'clientCommand', 'client_command');

    sessionTable.onInsert((_ctx: unknown, row: WorldSessionRow) => void this.syncSession(row));
    sessionTable.onUpdate((_ctx: unknown, _old: WorldSessionRow, row: WorldSessionRow) => void this.syncSession(row));
    inputTable.onInsert((_ctx: unknown, row: InputStateRow) => this.applyInput(row));
    inputTable.onUpdate((_ctx: unknown, _old: InputStateRow, row: InputStateRow) => this.applyInput(row));
    commandTable.onInsert((_ctx: unknown, row: ClientCommandRow) => this.applyCommand(row));
    commandTable.onUpdate((_ctx: unknown, _old: ClientCommandRow, row: ClientCommandRow) => this.applyCommand(row));
  }

  private scanInitialRows(): void {
    if (!this.conn) return;
    const sessionTable = table(this.conn.db, 'worldSession', 'world_session');
    const inputTable = table(this.conn.db, 'inputState', 'input_state');
    const commandTable = table(this.conn.db, 'clientCommand', 'client_command');
    for (const row of rows<WorldSessionRow>(sessionTable)) void this.syncSession(row);
    for (const row of rows<InputStateRow>(inputTable)) this.applyInput(row);
    for (const row of rows<ClientCommandRow>(commandTable)) this.applyCommand(row);
  }

  private characterFor(id: bigint): CharacterRow | null {
    if (!this.conn) return null;
    const characterTable = table(this.conn.db, 'character');
    return rows<CharacterRow>(characterTable).find((row) => row.id === id) ?? null;
  }

  private async syncSession(row: WorldSessionRow): Promise<void> {
    const key = String(row.id);
    const existing = this.sessions.get(key);
    if (!row.active) {
      if (existing) await this.closeSession(existing, row.error || 'client left');
      return;
    }
    if (existing) return;
    const character = this.characterFor(row.characterId);
    if (!character) {
      await this.conn?.reducers.bridgeCloseSession({
        sessionId: row.id,
        stateJson: '',
        level: 1,
        reason: 'character not found',
      });
      return;
    }

    let bridge: BridgeSession | null = null;
    const socket = new BridgeSocket((payload) => {
      if (bridge) void this.publishOutbound(bridge, payload);
      else void this.publishEarly(row, payload);
    }) as unknown as WebSocket;
    const result = this.requireGame().join(
      socket,
      Number(row.accountId),
      Number(row.characterId),
      row.characterName || character.name,
      (row.className || character.className) as PlayerClass,
      parseState(character.stateJson),
      false,
    );
    if ('error' in result) {
      await this.conn?.reducers.bridgeCloseSession({
        sessionId: row.id,
        stateJson: character.stateJson || '',
        level: Number(character.level || 1),
        reason: result.error,
      });
      return;
    }
    bridge = {
      stdbId: row.id,
      owner: row.owner,
      accountId: Number(row.accountId),
      characterId: Number(row.characterId),
      gameSession: result,
    };
    this.sessions.set(key, bridge);
  }

  private async publishEarly(row: WorldSessionRow, payload: string): Promise<void> {
    let msg: any;
    try {
      msg = JSON.parse(payload);
    } catch {
      return;
    }
    if (msg.t === 'hello') {
      await this.conn?.reducers.bridgeAttachSession({ sessionId: row.id, playerId: Number(msg.pid) });
    }
  }

  private async publishOutbound(bridge: BridgeSession, payload: string): Promise<void> {
    if (!this.conn?.isActive) return;
    let msg: any;
    try {
      msg = JSON.parse(payload);
    } catch {
      return;
    }
    if (msg.t === 'hello') {
      await this.conn.reducers.bridgeAttachSession({ sessionId: bridge.stdbId, playerId: Number(msg.pid) });
      return;
    }
    if (msg.t === 'snap') {
      await this.conn.reducers.bridgePublishSnapshot({ sessionId: bridge.stdbId, owner: bridge.owner as any, payloadJson: payload });
      return;
    }
    if (msg.t === 'events') {
      await this.conn.reducers.bridgePublishEvents({ sessionId: bridge.stdbId, owner: bridge.owner as any, payloadJson: payload });
      return;
    }
    if (msg.t === 'social') {
      await this.conn.reducers.bridgePublishSocial({ sessionId: bridge.stdbId, owner: bridge.owner as any, payloadJson: payload });
      return;
    }
    if (msg.t === 'error') {
      await this.closeSession(bridge, msg.error ?? 'server rejected session');
    }
  }

  private applyInput(row: InputStateRow): void {
    const bridge = this.sessions.get(String(row.sessionId));
    if (!bridge) return;
    this.requireGame().handleMessage(bridge.gameSession, JSON.stringify({
      t: 'input',
      mi: {
        f: row.forward ? 1 : 0,
        b: row.back ? 1 : 0,
        tl: row.turnLeft ? 1 : 0,
        tr: row.turnRight ? 1 : 0,
        sl: row.strafeLeft ? 1 : 0,
        sr: row.strafeRight ? 1 : 0,
        j: row.jump ? 1 : 0,
      },
      ...(row.facingValid ? { facing: row.facing } : {}),
    }));
  }

  private applyCommand(row: ClientCommandRow): void {
    if (row.consumed) return;
    const commandId = String(row.id);
    if (this.consumedCommands.has(commandId)) return;
    const bridge = this.sessions.get(String(row.sessionId));
    if (!bridge) return;
    this.consumedCommands.add(commandId);
    this.requireGame().handleMessage(bridge.gameSession, row.payloadJson || JSON.stringify({ t: 'cmd', cmd: row.kind }));
    void this.conn?.reducers.bridgeConsumeCommand({ commandId: row.id }).catch((err) => {
      console.error('failed to mark STDB command consumed:', err);
    });
  }

  private async saveSession(bridge: BridgeSession): Promise<{ stateJson: string; level: number }> {
    const game = this.requireGame();
    const state = game.sim.serializeCharacter(bridge.gameSession.pid);
    const entity = game.sim.entities.get(bridge.gameSession.pid);
    const stateJson = state ? JSON.stringify(state) : '';
    const level = entity?.level ?? 1;
    if (this.conn?.isActive && stateJson) {
      await this.conn.reducers.bridgeSaveCharacter({
        characterId: BigInt(bridge.characterId),
        level,
        stateJson,
      });
    }
    return { stateJson, level };
  }

  private async closeSession(bridge: BridgeSession, reason: string): Promise<void> {
    if (!this.sessions.delete(String(bridge.stdbId))) return;
    const saved = await this.saveSession(bridge).catch(() => ({ stateJson: '', level: 1 }));
    await this.requireGame().leave(bridge.gameSession, reason).catch((err) => console.error('bridge leave failed:', err));
    await this.conn?.reducers.bridgeCloseSession({
      sessionId: bridge.stdbId,
      stateJson: saved.stateJson,
      level: saved.level,
      reason,
    }).catch((err) => console.error('failed to close STDB session:', err));
  }

  private async saveAll(): Promise<void> {
    const game = this.game;
    await this.conn?.reducers.bridgePing({ sessions: this.sessions.size, tick: BigInt(game?.sim.tickCount ?? 0) }).catch(() => {});
    for (const bridge of this.sessions.values()) {
      await this.saveSession(bridge).catch((err) => console.error(`STDB save failed for ${bridge.characterId}:`, err));
    }
  }

  private async stop(): Promise<void> {
    if (this.saveTimer !== null) clearInterval(this.saveTimer);
    this.game?.stop();
    await this.saveAll().catch(() => {});
    this.conn?.disconnect();
  }

  private requireGame(): GameServer {
    if (!this.game) throw new Error('SpacetimeDB bridge game server is not initialized');
    return this.game;
  }
}

const bridge = new StdbBridge();
bridge.start().catch((err) => {
  console.error('failed to start SpacetimeDB bridge:', err);
  process.exit(1);
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
