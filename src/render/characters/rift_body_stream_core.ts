// Which character GLBs leave the boot gate on the iOS memory profile, which of
// them stream right after first paint, and which wait for a Rift or a Buried
// Hoard to become reachable.
//
// The iOS profile carves every creature and enemy body out of the boot gate and
// streams it after first paint (the why lives in assets.ts, beside the stream).
// The bodies only Rift content draws are a large share of that stream
// (measured: 110 to 125 MB of ArrayBuffers at world entry) and no overworld
// entity ever draws them, so on that profile they wait instead. Desktop and
// Android keep every body in the boot gate, so nothing here changes what they
// load or when.
//
// The class is derived from CONTENT, never from a file name. A visual key is
// Rift-only when the mob dispatch reaches it from a Rift or Buried Hoard
// template (RIFT_MOBS, HOARD_MOBS) and from nothing else: no other template, no
// family or global fallback, no NPC route. A body url is Rift-only when every
// visual def that references it is Rift-only, so a body shared with the
// overworld stays in the entry stream by construction. The Rift-only bodies then
// split in two lanes by what can spawn them:
// - the RIFT lane: bodies some RIFT_MOBS template draws. Natural Rift floors
//   spawn those templates (the themed trash and bosses), and so do Buried Hoards
//   (their trash, and the themed bosses of the rarer maps);
// - the HOARD lane: bodies only HOARD_MOBS templates draw (the cave bosses and
//   the encounter actors), which only a Buried Hoard spawns.
// So a natural Rift asks for the Rift lane only, and a Buried Hoard for both.
//
// Pure (RENDER_PURE_CORES): no three.js, no DOM, no clock; tests import it
// directly.

import { HOARD_MOBS, RIFT_MOBS } from '../../sim/content/rift/mobs';
import { HOARD_MIN_LEVEL } from '../../sim/content/treasure_maps';
import { isRiftPos, MOBS } from '../../sim/data';
import { RIFT_MIN_LEVEL } from '../../sim/rift/portals';
import {
  HOARD_ENTRANCE_TEMPLATE_ID,
  isRiftEntranceTemplate,
  vaultSeedTier,
} from '../../sim/rift/vault_seed';
import { PLAYER_INTEREST_RADIUS } from '../../sim/types';
import {
  fallbackVisualKeys,
  mobKeyTemplateIds,
  mobVisualKeyFor,
  VISUALS,
  type VisualDef,
} from './manifest';

/** The creature and enemy body folders the iOS profile streams instead of gating. */
export const STREAMED_BODY_URL_PREFIXES: readonly string[] = [
  'models/creatures/',
  'models/chars/enemies/',
];

export function isStreamedBodyUrl(url: string): boolean {
  return STREAMED_BODY_URL_PREFIXES.some((prefix) => url.includes(prefix));
}

/** Every template a Rift or a Buried Hoard spawns, and nothing else spawns. */
export function riftTemplateIds(): ReadonlySet<string> {
  return new Set([...Object.keys(RIFT_MOBS), ...Object.keys(HOARD_MOBS)]);
}

function defUrls(def: VisualDef): string[] {
  return [def.url, ...(def.animUrls ?? []), ...(def.attach ?? []).map((a) => a.url)];
}

let riftKeysMemo: ReadonlySet<string> | null = null;

/** Visual keys only a Rift or Buried Hoard template can draw. */
export function riftOnlyVisualKeys(): ReadonlySet<string> {
  if (riftKeysMemo) return riftKeysMemo;
  const rift = riftTemplateIds();
  const riftKeys = new Set<string>();
  for (const id of rift) riftKeys.add(mobVisualKeyFor(id));
  const otherIds = new Set([...Object.keys(MOBS), ...mobKeyTemplateIds()]);
  for (const id of otherIds) {
    if (!rift.has(id)) riftKeys.delete(mobVisualKeyFor(id));
  }
  for (const key of fallbackVisualKeys()) riftKeys.delete(key);
  riftKeysMemo = riftKeys;
  return riftKeys;
}

/** Which Rift-only lane a body rides. */
export type RiftBodyLane = 'rift' | 'hoard';

let laneMemo: ReadonlyMap<string, RiftBodyLane> | null = null;

/** Every streamed body url only Rift-only visual defs reference, with its lane:
 *  'rift' when a RIFT_MOBS template draws it, 'hoard' when only HOARD_MOBS do. */
export function riftOnlyBodyLanes(): ReadonlyMap<string, RiftBodyLane> {
  if (laneMemo) return laneMemo;
  const keys = riftOnlyVisualKeys();
  const urls = new Set<string>();
  const shared = new Set<string>();
  for (const [key, def] of Object.entries(VISUALS)) {
    for (const url of defUrls(def)) (keys.has(key) ? urls : shared).add(url);
  }
  const riftDrawn = new Set<string>();
  for (const id of Object.keys(RIFT_MOBS)) {
    for (const url of defUrls(VISUALS[mobVisualKeyFor(id)])) riftDrawn.add(url);
  }
  const lanes = new Map<string, RiftBodyLane>();
  for (const url of urls) {
    if (shared.has(url) || !isStreamedBodyUrl(url)) continue;
    lanes.set(url, riftDrawn.has(url) ? 'rift' : 'hoard');
  }
  laneMemo = lanes;
  return lanes;
}

/** How the character preload set splits on one graphics profile. */
export interface CharacterStreamPlan {
  /** Held out of the boot gate: fetched later, and re-armed on a build miss. */
  streamed: string[];
  /** Streamed bodies fetched right after the first painted world frame. */
  postEntry: string[];
  /** Streamed bodies some Rift template draws (natural Rifts and Buried Hoards). */
  rift: string[];
  /** Streamed bodies only Buried Hoard templates draw. */
  hoard: string[];
}

/**
 * Split the character preload set. `onDemandUrls` (the weapon-skin cosmetics)
 * leave the gate on every host and load on demand only. The iOS memory profile
 * also carves out every streamed body folder: the Rift-only bodies into their
 * lane, the rest into the post-entry stream. Any other profile gates every
 * body, so every lane is empty there.
 */
export function characterStreamPlan(
  preloadUrls: readonly string[],
  onDemandUrls: ReadonlySet<string>,
  iosMemoryProfile: boolean,
): CharacterStreamPlan {
  const lanes = riftOnlyBodyLanes();
  const plan: CharacterStreamPlan = { streamed: [], postEntry: [], rift: [], hoard: [] };
  for (const url of preloadUrls) {
    const body = iosMemoryProfile && isStreamedBodyUrl(url);
    if (!body && !onDemandUrls.has(url)) continue;
    plan.streamed.push(url);
    if (!body) continue;
    plan[lanes.get(url) ?? 'postEntry'].push(url);
  }
  return plan;
}

/** What the world asks of the lanes this frame. */
export interface RiftBodyDemand {
  rift: boolean;
  hoard: boolean;
  /** The player stands in a Rift or a Buried Hoard: no reason left to wait. */
  inside: boolean;
}

/** What the lanes need from the asset loader (assets.ts binds them). */
export interface RiftBodyLaneHost {
  /** Fetch and index one body; resolves at once for a resident one. */
  fetch(url: string): Promise<void>;
  /** True once the post-entry stream was kicked (it goes first in the queue). */
  postEntryStarted(): boolean;
  /** Dev-channel note, once per lane, the first time it starts fetching. */
  onLaneStart?(lane: RiftBodyLane, count: number): void;
}

/**
 * The two lanes' pacing. The iOS loader runs two GLB fetches at a time in one
 * FIFO queue, so a lane that queued its whole set at once would park every
 * other GLB (the post-entry stream, a zone's props, a body a creature in view
 * is missing) behind tens of megabytes. A lane therefore holds at most ONE
 * fetch in flight and walks its list in order, and it waits for the post-entry
 * stream to be queued first unless the player already stands inside. A body a
 * view misses is fetched by the build-miss path at once, beside the lane. A
 * fetch that fails is left to that build-miss path too; the lane moves on.
 */
export class RiftBodyLanes {
  private readonly urls: Record<RiftBodyLane, readonly string[]> = { rift: [], hoard: [] };
  private readonly cursor: Record<RiftBodyLane, number> = { rift: 0, hoard: 0 };
  private readonly demanded: Record<RiftBodyLane, boolean> = { rift: false, hoard: false };
  private urgent = false;
  private inFlight = false;

  constructor(private readonly host: RiftBodyLaneHost) {}

  /** Install a profile's lane lists. A changed list restarts its walk (resident
   *  bodies resolve at once); what was demanded stays demanded. */
  setUrls(rift: readonly string[], hoard: readonly string[]): void {
    if (rift.join('|') !== this.urls.rift.join('|')) {
      this.urls.rift = rift;
      this.cursor.rift = 0;
    }
    if (hoard.join('|') !== this.urls.hoard.join('|')) {
      this.urls.hoard = hoard;
      this.cursor.hoard = 0;
    }
  }

  /** True while a lane holds a body it has not fetched. */
  pending(): boolean {
    return this.cursor.rift < this.urls.rift.length || this.cursor.hoard < this.urls.hoard.length;
  }

  demand(d: Readonly<RiftBodyDemand>): void {
    if (d.rift) this.demanded.rift = true;
    if (d.hoard) this.demanded.hoard = true;
    if (d.inside) this.urgent = true;
    this.pump();
  }

  private pump(): void {
    if (this.inFlight) return;
    if (!this.urgent && !this.host.postEntryStarted()) return;
    const url = this.next();
    if (url === null) return;
    this.inFlight = true;
    this.host
      .fetch(url)
      .catch(() => undefined)
      .finally(() => {
        this.inFlight = false;
        this.pump();
      });
  }

  private next(): string | null {
    for (const lane of LANE_ORDER) {
      if (!this.demanded[lane] || this.cursor[lane] >= this.urls[lane].length) continue;
      if (this.cursor[lane] === 0) this.host.onLaneStart?.(lane, this.urls[lane].length);
      return this.urls[lane][this.cursor[lane]++];
    }
    return null;
  }
}

/** A Buried Hoard's trash comes from the Rift lane, so that lane goes first. */
const LANE_ORDER: readonly RiftBodyLane[] = ['rift', 'hoard'];

/** The minimum level a Rift entrance admits, or null for any other template.
 *  Mirrors the gate in sim/rift/runs.ts enterRift: a Buried Hoard entrance
 *  opens from HOARD_MIN_LEVEL, every other Rift portal from RIFT_MIN_LEVEL. */
export function riftEntranceMinLevel(templateId: string): number | null {
  if (!isRiftEntranceTemplate(templateId)) return null;
  return templateId === HOARD_ENTRANCE_TEMPLATE_ID ? HOARD_MIN_LEVEL : RIFT_MIN_LEVEL;
}

interface StreamTriggerEntity {
  readonly id: number;
  readonly kind: string;
  readonly templateId: string;
  readonly pos: { readonly x: number; readonly z: number };
}

/** The IWorld slice the trigger reads. */
export interface RiftBodyStreamWorld {
  /** Non-null while the local player is on a Rift or Buried Hoard floor. */
  readonly riftFloor: { readonly seed: number } | null;
  /** The treasure map read and not yet dug up (IWorld.treasureMap). */
  readonly treasureMap: unknown;
  readonly player: {
    readonly level: number;
    readonly pos: { readonly x: number; readonly z: number };
  };
  readonly entities: ReadonlyMap<number, StreamTriggerEntity>;
  readonly entityRosterVersion: number;
}

/** The lanes as the trigger drives them. */
export interface RiftBodyLaneControl {
  pending(): boolean;
  demand(d: Readonly<RiftBodyDemand>): void;
}

/**
 * The lanes' trigger, polled once per frame by the client loop. Each arm asks
 * only for what the content behind it can spawn, early enough that the bodies
 * are resident before the first creature is in view:
 * - a treasure map read (and not dug yet) by a player who can enter a Buried
 *   Hoard: the hoard AND Rift lanes, from the moment the map is read (or from
 *   the login of a player carrying one) through the whole walk to the dig site;
 * - an entrance the local player may enter (the level gate enterRift applies)
 *   inside PLAYER_INTEREST_RADIUS, the edge at which an online client first
 *   receives it and offline presentation uses too: a natural Rift portal asks
 *   for the Rift lane, a Buried Hoard entrance (a party member of the digger,
 *   who holds no map) for both. Vault ownership is not on the wire, so a
 *   stranger's hoard entrance in range also asks: the error is toward loading;
 * - the local player already inside: the Rift lane at once (the position alone
 *   answers before the floor state lands, at a login on the spot), plus the
 *   hoard lane once the floor names a Buried Hoard.
 *
 * Once every lane has walked its list (or on any profile where they are empty)
 * the poll is one call. Entrances are re-listed only when the roster changes.
 */
export class RiftBodyStreamTrigger {
  private rosterVersion = -1;
  private readonly entranceIds: number[] = [];
  private readonly demandScratch: RiftBodyDemand = { rift: false, hoard: false, inside: false };

  constructor(private readonly lanes: RiftBodyLaneControl) {}

  /** Poll once per frame. */
  update(world: RiftBodyStreamWorld): void {
    if (!this.lanes.pending()) return;
    const demand = this.demandOf(world);
    if (demand.rift || demand.hoard) this.lanes.demand(demand);
  }

  /** What the world asks of the lanes now (a reused object: read it at once). */
  demandOf(world: RiftBodyStreamWorld): Readonly<RiftBodyDemand> {
    const d = this.demandScratch;
    d.rift = false;
    d.hoard = false;
    d.inside = false;
    const { player } = world;
    const floor = world.riftFloor;
    if (floor !== null || isRiftPos(player.pos.x)) {
      d.inside = true;
      d.rift = true;
      if (floor !== null && vaultSeedTier(floor.seed) !== null) d.hoard = true;
    }
    if (world.treasureMap !== null && player.level >= HOARD_MIN_LEVEL) {
      d.rift = true;
      d.hoard = true;
    }
    if (this.rosterVersion !== world.entityRosterVersion) {
      this.rosterVersion = world.entityRosterVersion;
      this.entranceIds.length = 0;
      for (const e of world.entities.values()) {
        if (e.kind === 'object' && riftEntranceMinLevel(e.templateId) !== null) {
          this.entranceIds.push(e.id);
        }
      }
    }
    const reachSq = PLAYER_INTEREST_RADIUS * PLAYER_INTEREST_RADIUS;
    for (const id of this.entranceIds) {
      const e = world.entities.get(id);
      if (!e) continue;
      const minLevel = riftEntranceMinLevel(e.templateId);
      if (minLevel === null || player.level < minLevel) continue;
      const dx = e.pos.x - player.pos.x;
      const dz = e.pos.z - player.pos.z;
      if (dx * dx + dz * dz > reachSq) continue;
      d.rift = true;
      if (e.templateId === HOARD_ENTRANCE_TEMPLATE_ID) d.hoard = true;
    }
    return d;
  }
}
