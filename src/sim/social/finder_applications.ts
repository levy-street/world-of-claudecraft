// Player and listing indexes keep personal reads bounded by the application cap.
import type { Role } from '../content/talents';

export const FINDER_PLAYER_APPLICATION_CAP = 5;

export interface FinderApplication {
  pid: number;
  listingId: number;
  activityId: string;
  leaderPid: number;
  roles: Role[];
  selectedRole?: Role; // explicit single-role application, independent of sticky preferences
  at: number;
  expiresAt?: number;
}

export class FinderApplications {
  private readonly players = new Map<number, Map<number, FinderApplication>>();
  private readonly listings = new Map<number, Map<number, FinderApplication>>();
  has(pid: number): boolean {
    return this.players.has(pid);
  }
  get(pid: number, listingId?: number): FinderApplication | undefined {
    const apps = this.players.get(pid);
    return listingId === undefined ? apps?.values().next().value : apps?.get(listingId);
  }
  forPlayer(pid: number): FinderApplication[] {
    return [...(this.players.get(pid)?.values() ?? [])];
  }
  forListing(listingId: number): FinderApplication[] {
    return [...(this.listings.get(listingId)?.values() ?? [])];
  }
  set(app: FinderApplication): void {
    const player = this.players.get(app.pid) ?? new Map();
    const listing = this.listings.get(app.listingId) ?? new Map();
    player.set(app.listingId, app);
    listing.set(app.pid, app);
    this.players.set(app.pid, player);
    this.listings.set(app.listingId, listing);
  }
  delete(pid: number, listingId?: number): boolean {
    const apps = listingId === undefined ? this.forPlayer(pid) : [this.get(pid, listingId)];
    let removed = false;
    for (const app of apps) {
      if (!app) continue;
      const player = this.players.get(pid)!;
      const listing = this.listings.get(app.listingId)!;
      player.delete(app.listingId);
      listing.delete(pid);
      if (!player.size) this.players.delete(pid);
      if (!listing.size) this.listings.delete(app.listingId);
      removed = true;
    }
    return removed;
  }
  values(): FinderApplication[] {
    return [...this.players.values()].flatMap((apps) => [...apps.values()]);
  }
}
