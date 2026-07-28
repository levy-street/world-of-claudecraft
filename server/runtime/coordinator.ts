import type { WebSocket } from 'ws';
import type { ClientSession, GameServer } from '../game';
import type { RuntimeMode } from './contract';
import { RuntimeGateway } from './gateway';
import { InlineRuntimeHost } from './inline_host';
import { overworldRuntimeKey } from './runtime_key';

export interface RuntimeCoordinatorStats {
  mode: RuntimeMode;
  hosts: number;
  routes: number;
  handoffs: number;
  handoffFailures: number;
}

interface RoutedMessage {
  session: ClientSession;
  raw: string;
}

function characterKey(session: ClientSession): string {
  return String(session.characterId);
}

/**
 * Owns the process-level authority map. Production remains one inline realm
 * runtime until a portal-isolated worker has a complete deterministic transfer
 * adapter. The hot path is a synchronous route lookup and direct dispatch.
 */
export class AuthoritativeRuntimeCoordinator {
  readonly gateway: RuntimeGateway<ClientSession, RoutedMessage>;
  private readonly attached = new Set<string>();
  private readonly pendingDetaches = new Set<Promise<void>>();
  private readonly runtimeKey: string;
  private readonly host: InlineRuntimeHost<ClientSession, RoutedMessage>;
  private state: 'new' | 'starting' | 'ready' | 'stopping' | 'stopped' = 'new';
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;

  constructor(
    private readonly game: GameServer,
    realm: string,
    readonly mode: RuntimeMode,
  ) {
    if (mode !== 'inline') {
      throw new Error(`runtime mode ${mode} is not configured with a production adapter`);
    }
    this.gateway = new RuntimeGateway(() => undefined);
    this.runtimeKey = overworldRuntimeKey(realm);
    this.host = new InlineRuntimeHost<ClientSession, RoutedMessage>(this.runtimeKey, {
      start: () => undefined,
      stop: () => undefined,
      join: () => undefined,
      prepareTransfer: () => undefined,
      commitTransfer: () => undefined,
      abortTransfer: () => undefined,
      leave: () => undefined,
      handle: (_characterId, _routeEpoch, message) => {
        this.game.handleMessage(message.session, message.raw);
      },
    });
    this.gateway.register(this.host);
  }

  start(): Promise<void> {
    if (this.state === 'ready') return Promise.resolve();
    if (this.state === 'starting' && this.startPromise) return this.startPromise;
    if (this.state !== 'new') return Promise.reject(new Error('runtime coordinator cannot start'));
    this.state = 'starting';
    this.startPromise = Promise.resolve(this.host.start())
      .then(() => {
        this.state = 'ready';
      })
      .catch((error) => {
        this.state = 'stopped';
        this.gateway.unregister(this.runtimeKey);
        throw error;
      });
    return this.startPromise;
  }

  async attach(session: ClientSession): Promise<void> {
    if (this.state !== 'ready') throw new Error('runtime coordinator is not ready');
    const characterId = characterKey(session);
    const current = this.gateway.router.current(characterId);
    if (this.attached.has(characterId) && current?.runtimeKey === this.runtimeKey) return;
    await this.gateway.join(characterId, this.runtimeKey, session);
    this.attached.add(characterId);
  }

  handleMessage(session: ClientSession, raw: string): void {
    const characterId = characterKey(session);
    if (!this.attached.has(characterId)) return;
    this.gateway.handle(characterId, { session, raw });
  }

  socketClosed(session: ClientSession, ws: WebSocket): boolean {
    return this.game.socketClosed(session, ws);
  }

  detached(session: ClientSession): void {
    const characterId = characterKey(session);
    this.attached.delete(characterId);
    const pending = this.gateway
      .leave(characterId)
      .then(() => undefined)
      .catch((error) => {
        console.error(`runtime detach failed for character ${characterId}:`, error);
      })
      .finally(() => this.pendingDetaches.delete(pending));
    this.pendingDetaches.add(pending);
  }

  stats(): RuntimeCoordinatorStats {
    return {
      mode: this.mode,
      hosts: this.gateway.hostCount,
      routes: this.attached.size,
      handoffs: 0,
      handoffFailures: 0,
    };
  }

  stop(): Promise<void> {
    if (this.state === 'stopped') return Promise.resolve();
    if (!this.stopPromise) this.stopPromise = this.stopNow();
    return this.stopPromise;
  }

  private async stopNow(): Promise<void> {
    if (this.state === 'starting' && this.startPromise) await this.startPromise;
    this.state = 'stopping';
    await Promise.allSettled(this.pendingDetaches);
    for (const characterId of [...this.attached]) await this.gateway.leave(characterId);
    this.attached.clear();
    if (this.gateway.hasHost(this.runtimeKey)) await this.gateway.stopRuntime(this.runtimeKey);
    this.state = 'stopped';
  }
}
