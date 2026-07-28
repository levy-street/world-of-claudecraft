import type { WebSocket } from 'ws';
import type { ClientSession, GameServer, RuntimePlacement } from '../game';
import type { RuntimeMode } from './contract';
import { RuntimeGateway } from './gateway';
import { InlineRuntimeHost } from './inline_host';
import { instanceRuntimeKey, overworldRuntimeKey } from './runtime_key';

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

export function placementRuntimeKey(realm: string, placement: RuntimePlacement): string {
  if (placement.kind === 'overworld') return overworldRuntimeKey(realm, placement.claimId);
  return instanceRuntimeKey(realm, placement.kind, placement.claimId);
}

/**
 * Owns the process-level authority map. The current release uses inline hosts,
 * preserving the single-Sim behavior, while every socket is routed through the
 * same epoch-fenced contract used by dedicated instance workers. This makes a
 * host swap a control-plane change instead of a WebSocket or protocol rewrite.
 */
export class AuthoritativeRuntimeCoordinator {
  readonly gateway: RuntimeGateway<ClientSession, RoutedMessage>;
  private readonly attached = new Set<string>();
  private readonly moves = new Map<string, Promise<void>>();
  private handoffs = 0;
  private handoffFailures = 0;

  constructor(
    private readonly game: GameServer,
    private readonly realm: string,
    readonly mode: RuntimeMode,
  ) {
    this.gateway = new RuntimeGateway(() => undefined);
  }

  attach(session: ClientSession): void {
    const characterId = characterKey(session);
    const runtimeKey = this.runtimeKeyFor(session);
    this.ensureInlineHost(runtimeKey);
    this.attached.add(characterId);
    void this.gateway.join(characterId, runtimeKey, session).catch((error) => {
      this.attached.delete(characterId);
      console.error(`runtime attach failed for character ${characterId}:`, error);
    });
  }

  handleMessage(session: ClientSession, raw: string): void {
    const characterId = characterKey(session);
    if (!this.attached.has(characterId)) this.attach(session);
    void this.gateway.handle(characterId, { session, raw }).catch((error) => {
      console.error(`runtime message failed for character ${characterId}:`, error);
    });
    this.reconcile(session);
  }

  socketClosed(session: ClientSession, ws: WebSocket): boolean {
    return this.game.socketClosed(session, ws);
  }

  detached(session: ClientSession): void {
    const characterId = characterKey(session);
    this.attached.delete(characterId);
    void this.gateway.leave(characterId).catch((error) => {
      console.error(`runtime detach failed for character ${characterId}:`, error);
    });
  }

  stats(): RuntimeCoordinatorStats {
    return {
      mode: this.mode,
      hosts: this.gateway.hostCount,
      routes: this.attached.size,
      handoffs: this.handoffs,
      handoffFailures: this.handoffFailures,
    };
  }

  async stop(): Promise<void> {
    await Promise.allSettled(this.moves.values());
    for (const characterId of [...this.attached]) await this.gateway.leave(characterId);
    this.attached.clear();
  }

  private runtimeKeyFor(session: ClientSession): string {
    return placementRuntimeKey(this.realm, this.game.runtimePlacement(session));
  }

  private ensureInlineHost(runtimeKey: string): void {
    if (this.gateway.hasHost(runtimeKey)) return;
    const host = new InlineRuntimeHost<ClientSession, RoutedMessage>(runtimeKey, {
      start: () => undefined,
      stop: () => undefined,
      join: () => undefined,
      leave: () => undefined,
      handle: (_characterId, _routeEpoch, message) => {
        this.game.handleMessage(message.session, message.raw);
      },
    });
    this.gateway.register(host);
    void host.start();
  }

  private reconcile(session: ClientSession): void {
    const characterId = characterKey(session);
    const prior = this.moves.get(characterId) ?? Promise.resolve();
    const next = prior
      .then(async () => {
        if (!this.attached.has(characterId)) return;
        const targetKey = this.runtimeKeyFor(session);
        const current = this.gateway.router.current(characterId);
        if (current?.runtimeKey === targetKey) return;
        this.ensureInlineHost(targetKey);
        await this.gateway.move(characterId, targetKey, session);
        this.handoffs++;
      })
      .catch((error) => {
        this.handoffFailures++;
        console.error(`runtime handoff failed for character ${characterId}:`, error);
      })
      .finally(() => {
        if (this.moves.get(characterId) === next) this.moves.delete(characterId);
      });
    this.moves.set(characterId, next);
  }
}
