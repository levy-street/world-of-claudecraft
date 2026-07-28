import type { RuntimeHost, RuntimeJoin, RuntimeOutbound, RuntimeRoute } from './contract';
import { abortHandoff, beginHandoff, commitHandoff, markHandoffPrepared } from './handoff';
import { RuntimeRouter } from './router';

export interface RuntimeGatewayOptions {
  cleanupError?: (
    error: unknown,
    context: { characterId: string; runtimeKey: string; operation: 'abort' | 'leave' },
  ) => void;
}

export class RuntimeGateway<Input = unknown, Message = unknown> {
  readonly router = new RuntimeRouter();
  private readonly hosts = new Map<string, RuntimeHost<Input, Message>>();
  private readonly pendingClaims = new Map<string, number>();

  constructor(
    private readonly send: (outbound: RuntimeOutbound) => void,
    private readonly options: RuntimeGatewayOptions = {},
  ) {}

  register(host: RuntimeHost<Input, Message>): void {
    if (this.hosts.has(host.runtimeKey)) {
      throw new Error(`runtime host already registered: ${host.runtimeKey}`);
    }
    this.hosts.set(host.runtimeKey, host);
  }

  unregister(runtimeKey: string): boolean {
    if (this.router.usesRuntime(runtimeKey)) {
      throw new Error(`runtime host has an active route: ${runtimeKey}`);
    }
    if ((this.pendingClaims.get(runtimeKey) ?? 0) > 0) {
      throw new Error(`runtime host has a pending lifecycle operation: ${runtimeKey}`);
    }
    return this.hosts.delete(runtimeKey);
  }

  async stopRuntime(runtimeKey: string): Promise<void> {
    const host = this.requireHost(runtimeKey);
    if (this.router.usesRuntime(runtimeKey)) {
      throw new Error(`runtime host has an active route: ${runtimeKey}`);
    }
    if ((this.pendingClaims.get(runtimeKey) ?? 0) > 0) {
      throw new Error(`runtime host has a pending lifecycle operation: ${runtimeKey}`);
    }
    this.hosts.delete(runtimeKey);
    await host.stop();
  }

  hasHost(runtimeKey: string): boolean {
    return this.hosts.has(runtimeKey);
  }

  get hostCount(): number {
    return this.hosts.size;
  }

  async join(characterId: string, runtimeKey: string, input: Input): Promise<RuntimeRoute> {
    const current = this.router.current(characterId);
    if (current && current.runtimeKey !== runtimeKey) {
      return this.move(characterId, runtimeKey, input);
    }
    const host = this.requireHost(runtimeKey);
    const assignment = this.router.assign(characterId, runtimeKey);
    const request: RuntimeJoin<Input> = {
      characterId,
      routeEpoch: assignment.route.routeEpoch,
      input,
    };
    this.claim(runtimeKey);
    try {
      await host.join(request);
    } catch (error) {
      if (assignment.changed) {
        this.router.detach(characterId, assignment.route.routeEpoch);
      }
      throw error;
    } finally {
      this.release(runtimeKey);
    }
    return assignment.route;
  }

  handle(characterId: string, message: Message): boolean {
    const route = this.router.current(characterId);
    if (!route) return false;
    const host = this.hosts.get(route.runtimeKey);
    if (!host) return false;
    host.handle(characterId, route.routeEpoch, message);
    return true;
  }

  async move(characterId: string, runtimeKey: string, input: Input): Promise<RuntimeRoute> {
    const source = this.router.current(characterId);
    if (!source) return this.join(characterId, runtimeKey, input);
    if (source.runtimeKey === runtimeKey) return source;

    const sourceHost = this.requireHost(source.runtimeKey);
    const targetHost = this.requireHost(runtimeKey);
    const handoff = beginHandoff(this.router, source, runtimeKey);
    this.claim(runtimeKey);
    try {
      await targetHost.prepareTransfer({
        characterId,
        sourceEpoch: source.routeEpoch,
        targetEpoch: handoff.targetEpoch,
        transfer: input,
      });
      markHandoffPrepared(handoff);
      // The target is finalized but remains gateway-fenced until route commit.
      await targetHost.commitTransfer(characterId, handoff.targetEpoch);
      const target = commitHandoff(this.router, handoff);

      this.claim(source.runtimeKey);
      try {
        await sourceHost.leave(characterId, source.routeEpoch);
      } catch (error) {
        // Authority already moved. Leave failure is cleanup, not route failure.
        this.reportCleanup(error, characterId, source.runtimeKey, 'leave');
      } finally {
        this.release(source.runtimeKey);
      }
      return target;
    } catch (error) {
      if (handoff.state !== 'committed') {
        abortHandoff(handoff);
        try {
          await targetHost.abortTransfer(characterId, handoff.targetEpoch);
        } catch (abortError) {
          // Preserve the authority failure that caused the abort. Cleanup is
          // reported separately even when an inline adapter throws synchronously.
          this.reportCleanup(abortError, characterId, runtimeKey, 'abort');
        }
      }
      throw error;
    } finally {
      this.release(runtimeKey);
    }
  }

  async leave(characterId: string): Promise<boolean> {
    const route = this.router.current(characterId);
    if (!route) return false;
    const host = this.hosts.get(route.runtimeKey);
    if (host) {
      this.claim(route.runtimeKey);
      try {
        await host.leave(characterId, route.routeEpoch);
      } catch (error) {
        // The session is already leaving. Fence its route even when host
        // cleanup fails so stale output cannot keep logical authority alive.
        this.reportCleanup(error, characterId, route.runtimeKey, 'leave');
      } finally {
        this.release(route.runtimeKey);
      }
    }
    return this.router.detach(characterId, route.routeEpoch);
  }

  deliver(outbound: RuntimeOutbound): boolean {
    if (!this.router.accepts(outbound)) return false;
    this.send(outbound);
    return true;
  }

  private requireHost(runtimeKey: string): RuntimeHost<Input, Message> {
    const host = this.hosts.get(runtimeKey);
    if (!host) throw new Error(`runtime host is unavailable: ${runtimeKey}`);
    return host;
  }

  private claim(runtimeKey: string): void {
    this.pendingClaims.set(runtimeKey, (this.pendingClaims.get(runtimeKey) ?? 0) + 1);
  }

  private release(runtimeKey: string): void {
    const remaining = (this.pendingClaims.get(runtimeKey) ?? 1) - 1;
    if (remaining <= 0) this.pendingClaims.delete(runtimeKey);
    else this.pendingClaims.set(runtimeKey, remaining);
  }

  private reportCleanup(
    error: unknown,
    characterId: string,
    runtimeKey: string,
    operation: 'abort' | 'leave',
  ): void {
    try {
      this.options.cleanupError?.(error, { characterId, runtimeKey, operation });
    } catch {
      // Cleanup observers must never alter the already-decided authority state.
    }
  }
}
