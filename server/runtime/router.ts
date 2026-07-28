import type { RuntimeOutbound, RuntimeRoute } from './contract';

export interface RouteAssignment {
  route: RuntimeRoute;
  changed: boolean;
}

export class RuntimeRouter {
  private readonly routes = new Map<string, RuntimeRoute>();
  private readonly lastEpoch = new Map<string, number>();

  current(characterId: string): RuntimeRoute | null {
    return this.routes.get(characterId) ?? null;
  }

  assign(characterId: string, runtimeKey: string): RouteAssignment {
    const current = this.routes.get(characterId);
    if (current?.runtimeKey === runtimeKey) return { route: current, changed: false };
    const routeEpoch = (this.lastEpoch.get(characterId) ?? 0) + 1;
    const route = { characterId, runtimeKey, routeEpoch };
    this.lastEpoch.set(characterId, routeEpoch);
    this.routes.set(characterId, route);
    return { route, changed: true };
  }

  commit(characterId: string, expectedEpoch: number, runtimeKey: string): RuntimeRoute {
    const current = this.routes.get(characterId);
    if (!current || current.routeEpoch !== expectedEpoch) {
      throw new Error('runtime route changed before handoff commit');
    }
    return this.assign(characterId, runtimeKey).route;
  }

  accepts(output: Pick<RuntimeOutbound, 'characterId' | 'routeEpoch'>): boolean {
    const current = this.routes.get(output.characterId);
    return current !== undefined && current.routeEpoch === output.routeEpoch;
  }

  detach(characterId: string, expectedEpoch: number): boolean {
    const current = this.routes.get(characterId);
    if (!current || current.routeEpoch !== expectedEpoch) return false;
    this.routes.delete(characterId);
    return true;
  }
}
