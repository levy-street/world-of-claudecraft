import type { RuntimeHost, RuntimeJoin, RuntimeOutbound, RuntimeRoute } from './contract';
import { abortHandoff, beginHandoff, commitHandoff, markHandoffPrepared } from './handoff';
import { RuntimeRouter } from './router';

export class RuntimeGateway<Input = unknown, Message = unknown> {
  readonly router = new RuntimeRouter();
  private readonly hosts = new Map<string, RuntimeHost<Input, Message>>();

  constructor(private readonly send: (outbound: RuntimeOutbound) => void) {}

  register(host: RuntimeHost<Input, Message>): void {
    if (this.hosts.has(host.runtimeKey)) {
      throw new Error(`runtime host already registered: ${host.runtimeKey}`);
    }
    this.hosts.set(host.runtimeKey, host);
  }

  unregister(runtimeKey: string): boolean {
    return this.hosts.delete(runtimeKey);
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
    try {
      await host.join(request);
    } catch (error) {
      if (assignment.changed) {
        this.router.detach(characterId, assignment.route.routeEpoch);
      }
      throw error;
    }
    return assignment.route;
  }

  async handle(characterId: string, message: Message): Promise<boolean> {
    const route = this.router.current(characterId);
    if (!route) return false;
    const host = this.hosts.get(route.runtimeKey);
    if (!host) return false;
    await host.handle(characterId, route.routeEpoch, message);
    return true;
  }

  async move(characterId: string, runtimeKey: string, input: Input): Promise<RuntimeRoute> {
    const source = this.router.current(characterId);
    if (!source) return this.join(characterId, runtimeKey, input);
    if (source.runtimeKey === runtimeKey) return source;

    const sourceHost = this.requireHost(source.runtimeKey);
    const targetHost = this.requireHost(runtimeKey);
    const handoff = beginHandoff(source, runtimeKey);
    let targetPrepared = false;
    try {
      await targetHost.join({
        characterId,
        routeEpoch: source.routeEpoch + 1,
        input,
      });
      targetPrepared = true;
      markHandoffPrepared(handoff);
      const target = commitHandoff(this.router, handoff);
      await sourceHost.leave(characterId, source.routeEpoch);
      return target;
    } catch (error) {
      if (handoff.state !== 'committed') {
        abortHandoff(handoff);
        if (targetPrepared) {
          await Promise.resolve(targetHost.leave(characterId, source.routeEpoch + 1)).catch(
            () => undefined,
          );
        }
      }
      throw error;
    }
  }

  async leave(characterId: string): Promise<boolean> {
    const route = this.router.current(characterId);
    if (!route) return false;
    const host = this.hosts.get(route.runtimeKey);
    if (host) await host.leave(characterId, route.routeEpoch);
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
}
