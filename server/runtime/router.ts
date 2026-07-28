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
    const routeEpoch = this.reserveEpoch(characterId);
    const route = { characterId, runtimeKey, routeEpoch };
    this.routes.set(characterId, route);
    return { route, changed: true };
  }

  reserveEpoch(characterId: string): number {
    const routeEpoch = (this.lastEpoch.get(characterId) ?? 0) + 1;
    this.lastEpoch.set(characterId, routeEpoch);
    return routeEpoch;
  }

  commit(
    characterId: string,
    expectedEpoch: number,
    runtimeKey: string,
    routeEpoch: number,
  ): RuntimeRoute {
    const current = this.routes.get(characterId);
    if (!current || current.routeEpoch !== expectedEpoch) {
      throw new Error('runtime route changed before handoff commit');
    }
    const lastEpoch = this.lastEpoch.get(characterId) ?? 0;
    if (!Number.isInteger(routeEpoch) || routeEpoch <= expectedEpoch || routeEpoch > lastEpoch) {
      throw new Error('runtime handoff epoch was not reserved');
    }
    const route = { characterId, runtimeKey, routeEpoch };
    this.routes.set(characterId, route);
    return route;
  }

  accepts(output: Pick<RuntimeOutbound, 'characterId' | 'runtimeKey' | 'routeEpoch'>): boolean {
    const current = this.routes.get(output.characterId);
    return (
      current !== undefined &&
      current.runtimeKey === output.runtimeKey &&
      current.routeEpoch === output.routeEpoch
    );
  }

  usesRuntime(runtimeKey: string): boolean {
    for (const route of this.routes.values()) {
      if (route.runtimeKey === runtimeKey) return true;
    }
    return false;
  }

  detach(characterId: string, expectedEpoch: number): boolean {
    const current = this.routes.get(characterId);
    if (!current || current.routeEpoch !== expectedEpoch) return false;
    this.routes.delete(characterId);
    return true;
  }
}
