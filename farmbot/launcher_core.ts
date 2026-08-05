// Pure seams for the farmbot launcher (farmbot/launcher.ts owns the HTTP IO):
// the child-process log ring buffer, the form-fields-to-config assembly, and
// the zone list derivation. No IO, no clock reads beyond what the caller
// passes in, so the whole module is unit-tested without a server or a child.

// A bounded line log with absolute indexing for incremental polling: push
// arbitrary text (split on newlines), read with since(n) where n is an index
// returned by an earlier read. Lines older than the cap are dropped and the
// absolute index keeps advancing, so a polling client can never skip or
// double-print a line.
export class RingLog {
  private lines: string[] = [];
  private base = 0; // absolute index of lines[0]
  private partial = ''; // buffered tail of a line not yet newline-terminated

  constructor(private readonly cap = 2000) {}

  push(text: string): void {
    const parts = (this.partial + text).split('\n');
    this.partial = parts.pop() ?? '';
    for (const part of parts) {
      this.lines.push(part.endsWith('\r') ? part.slice(0, -1) : part);
    }
    if (this.lines.length > this.cap) {
      this.base += this.lines.length - this.cap;
      this.lines.splice(0, this.lines.length - this.cap);
    }
  }

  // Flush the unterminated tail (child exited mid-line). Safe to call any
  // number of times.
  end(): void {
    if (this.partial) {
      this.lines.push(this.partial);
      this.partial = '';
      if (this.lines.length > this.cap) {
        this.base += this.lines.length - this.cap;
        this.lines.splice(0, this.lines.length - this.cap);
      }
    }
  }

  since(n: number): { lines: string[]; next: number } {
    // n is an absolute index from an earlier read; clamp into the live window.
    const from = Math.min(Math.max(n - this.base, 0), this.lines.length);
    return { lines: this.lines.slice(from), next: this.base + this.lines.length };
  }

  get size(): number {
    return this.base + this.lines.length;
  }
}

// Unique zone ids in first-seen (table) order.
export function deriveZones(nodes: readonly { zoneId: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const node of nodes) {
    if (!seen.has(node.zoneId)) {
      seen.add(node.zoneId);
      out.push(node.zoneId);
    }
  }
  return out;
}

// The bot's machine-readable status line (main.ts prints it every 2 s).
export interface Fbstat {
  pos: { x: number; z: number };
  zoneId: string;
  mode: string;
  hp: number;
  maxHp: number;
  resource: number;
  maxResource: number;
  bagsUsed: number;
  bagCapacity: number;
  stats: {
    harvests: number;
    catches: number;
    kills: number;
    deaths: number;
    // Total copper earned this run (positive purse deltas only). Optional on
    // older bots so a mixed build still parses.
    copperGained?: number;
    raresKept?: number;
    xpGained?: number;
    levelsGained?: number;
  };
  // Progression mirrors for the leveling display; optional on older bots.
  xp?: number;
  level?: number;
  xpGained?: number;
  // Target-mat mode payload; present only when the bot runs mode 'target'.
  target?: { itemId: string; count: number; goal: number };
  inventory: { itemId: string; count: number }[];
}

// Classic WoC purse display: copper integer -> "Ng Ns Nc".
export function formatCopper(copper: number): string {
  const c = Math.max(0, Math.floor(Number.isFinite(copper) ? copper : 0));
  const g = Math.floor(c / 10_000);
  const s = Math.floor((c % 10_000) / 100);
  const cop = c % 100;
  if (g > 0) return `${g}g ${s}s ${cop}c`;
  if (s > 0) return `${s}s ${cop}c`;
  return `${cop}c`;
}

export const FBSTAT_PREFIX = 'FBSTAT ';

// Parse one log line into an Fbstat, null for anything else (including
// malformed JSON after the prefix).
export function parseFbstatLine(line: string): Fbstat | null {
  if (!line.startsWith(FBSTAT_PREFIX)) return null;
  try {
    const data = JSON.parse(line.slice(FBSTAT_PREFIX.length)) as Partial<Fbstat>;
    if (
      typeof data.zoneId !== 'string' ||
      typeof data.mode !== 'string' ||
      !data.pos ||
      typeof data.pos.x !== 'number' ||
      typeof data.pos.z !== 'number'
    ) {
      return null;
    }
    return data as Fbstat;
  } catch {
    return null;
  }
}

// Splits the child's raw output into complete log lines, skimming FBSTAT
// status lines off the stream (latest wins on `latest`) so they never reach
// the log pane. Partial tails stay buffered, same contract as RingLog.
export class FbstatFilter {
  private partial = '';
  latest: Fbstat | null = null;

  push(text: string): string[] {
    const parts = (this.partial + text).split('\n');
    this.partial = parts.pop() ?? '';
    const lines: string[] = [];
    for (const raw of parts) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      const stat = parseFbstatLine(line);
      if (stat) this.latest = stat;
      else lines.push(line);
    }
    return lines;
  }
}

// One zone's mini-map payload for the launcher page.
export interface ZoneMapInfo {
  id: string;
  name: string;
  rect: { zMin: number; zMax: number; xMin: number; xMax: number };
  lakes: { x: number; z: number; radius: number }[];
  nodes: { id: string; type: string; x: number; z: number }[];
}

const STRIP_HALF_WIDTH = 180; // zones without xMin/xMax span the strip

export function buildZoneMeta(
  zones: readonly {
    id: string;
    name: string;
    zMin: number;
    zMax: number;
    xMin?: number;
    xMax?: number;
    lakes: { x: number; z: number; radius: number }[];
  }[],
  nodes: readonly { id: string; zoneId: string; type: string; pos: { x: number; z: number } }[],
): ZoneMapInfo[] {
  return zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    rect: {
      zMin: zone.zMin,
      zMax: zone.zMax,
      xMin: zone.xMin ?? -STRIP_HALF_WIDTH,
      xMax: zone.xMax ?? STRIP_HALF_WIDTH,
    },
    lakes: zone.lakes.map((l) => ({ x: l.x, z: l.z, radius: l.radius })),
    nodes: nodes
      .filter((n) => n.zoneId === zone.id)
      .map((n) => ({ id: n.id, type: n.type, x: n.pos.x, z: n.pos.z })),
  }));
}

// The launcher form's flat field shape (what the page POSTs as `config`).
export interface LauncherFormConfig {
  serverUrl: string;
  characterName: string;
  zoneId: string;
  nodeTypes: string[];
  maxNodeTier: number;
  fishingEnabled: boolean;
  fishingSpotX: number | null;
  fishingSpotZ: number | null;
  castsPerSpot: number | null;
  abilitySlots: number[];
  eatItemId: string;
  drinkItemId: string;
  eatBelowHpPct: number | null;
  drinkBelowManaPct: number | null;
  fullPolicy: string;
  maxRuntimeMinutes: number;
  // Farm mode ('gather-fish' | 'gather' | 'fish' | 'gold' | 'level'); '' means default.
  mode: string;
  // Gold mode: comma-separated dungeon ids and the recharge threshold.
  goldDungeons: string;
  goldRestBelowPct: number | null;
  // Level mode: camp-circuit target and rules.
  targetLevel: number | null;
  lootRule: string;
  zoneUp: boolean;
  // Economy: auto-equip upgrades, World Market selling, mount travel.
  gearUpgrades: boolean;
  marketSell: boolean;
  mountEnabled: boolean;
  mountBuyTraining: boolean;
  // Target mode: the one material, optional goal (null = forever), source
  // override ('auto' | 'gather' | 'fish' | 'mobs').
  targetItemId: string;
  targetGoal: number | null;
  targetSource: string;
}

// Assemble the plain object that parseConfig validates. Omits optional keys
// entirely when the form leaves them empty, so a blank advanced field never
// becomes a validation error, and never carries credentials (those travel in
// the child's environment, never in this document).
export function assembleConfig(f: LauncherFormConfig): Record<string, unknown> {
  const fishing: Record<string, unknown> = { enabled: f.fishingEnabled };
  if (f.fishingEnabled && f.fishingSpotX !== null && f.fishingSpotZ !== null) {
    fishing.spot = { x: f.fishingSpotX, z: f.fishingSpotZ };
  }
  if (f.fishingEnabled && f.castsPerSpot !== null) fishing.castsPerSpot = f.castsPerSpot;

  const combat: Record<string, unknown> = { abilitySlots: f.abilitySlots };
  if (f.eatItemId) combat.eatItemId = f.eatItemId;
  if (f.drinkItemId) combat.drinkItemId = f.drinkItemId;
  if (f.eatItemId && f.eatBelowHpPct !== null) combat.eatBelowHpPct = f.eatBelowHpPct;
  if (f.drinkItemId && f.drinkBelowManaPct !== null) combat.drinkBelowManaPct = f.drinkBelowManaPct;

  const out: Record<string, unknown> = {
    serverUrl: f.serverUrl,
    characterName: f.characterName,
    zoneId: f.zoneId,
    nodeTypes: f.nodeTypes,
    maxNodeTier: f.maxNodeTier,
    fishing,
    combat,
    bags: { fullPolicy: f.fullPolicy },
    maxRuntimeMinutes: f.maxRuntimeMinutes,
  };
  if (f.mode) out.mode = f.mode;
  if (f.mode === 'gold') {
    const goldFarm: Record<string, unknown> = {};
    const dungeons = f.goldDungeons
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (dungeons.length > 0) goldFarm.dungeons = dungeons;
    if (f.goldRestBelowPct !== null) goldFarm.restBelowPct = f.goldRestBelowPct;
    out.goldFarm = goldFarm;
  }
  if (f.mode === 'level') {
    const levelGrind: Record<string, unknown> = { zoneUp: f.zoneUp };
    if (f.targetLevel !== null) levelGrind.targetLevel = f.targetLevel;
    if (f.lootRule) levelGrind.lootRule = f.lootRule;
    out.levelGrind = levelGrind;
  }
  if (f.mode === 'target') {
    const target: Record<string, unknown> = { itemId: f.targetItemId };
    if (f.targetGoal !== null) target.goal = f.targetGoal;
    if (f.targetSource && f.targetSource !== 'auto') target.source = f.targetSource;
    out.target = target;
  }
  // Economy: emitted only when enabled, so the defaults stay the defaults.
  if (f.gearUpgrades) out.gearUpgrades = true;
  if (f.marketSell) (out.bags as Record<string, unknown>).marketSell = true;
  if (f.mountEnabled || f.mountBuyTraining) {
    out.mount = { enabled: f.mountEnabled, buyTraining: f.mountBuyTraining };
  }
  return out;
}

// --- target mode (phase 18) ---------------------------------------------------
// The launcher-side seams for mode 'target': the compact item catalog behind
// the page's picker, the reference-kit resolver the /api/sources preview
// runs, and the one-line source descriptions the preview shows. Same purity
// rule as the rest of this module: no IO, no clock.

import { ITEMS } from '../src/sim/data';
import type { ItemDef } from '../src/sim/types';
import { defaultTargetResolverDeps, resolveTarget, type TargetSource } from './target_sources';

export interface ItemCatalogEntry {
  id: string;
  name: string;
  kind?: ItemDef['kind'];
  quality?: ItemDef['quality'];
}

// Every item, compactly (the picker's search space; a few hundred entries).
export function buildItemCatalog(items: Record<string, ItemDef> = ITEMS): ItemCatalogEntry[] {
  return Object.values(items).map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    quality: d.quality,
  }));
}

// The preview character: a reference kit (tier-1 handaxe/pick/sickle plus the
// simple pole) so gather/eastbrook-fish sources resolve, empty proficiency
// (band 0), level 20. Documented in the UI note: the preview shows what a
// starter kitted character could farm; the bot resolves again at startup
// against the REAL character (tools and proficiency it actually has), so the
// live pick can differ (e.g. mirefen water needs a tier-2 rod).
export const SOURCES_PREVIEW_CHARACTER = {
  inventory: [
    { itemId: 'copper_mining_pick', count: 1 },
    { itemId: 'handaxe', count: 1 },
    { itemId: 'gathering_sickle', count: 1 },
    { itemId: 'simple_fishing_pole', count: 1 },
  ],
  proficiencies: {},
  playerLevel: 20,
} as const;

export function resolveSourcesPreview(itemId: string): TargetSource[] {
  return resolveTarget(itemId, defaultTargetResolverDeps(SOURCES_PREVIEW_CHARACTER));
}

// One read-only preview line per source (the page renders them in order).
export function describeSource(source: TargetSource, itemId: string): string {
  if (source.kind === 'gather') {
    return `${source.nodeIds.length} ${source.nodeType} nodes in ${source.zoneId}`;
  }
  if (source.kind === 'fish') {
    return `fish in ${source.zoneId}, ${Math.round(source.weightShare * 100)}% per cast at your band`;
  }
  const diff =
    source.levelDiff !== null && source.levelDiff > 4
      ? ` (warning: ${source.levelDiff} levels above you)`
      : '';
  return `${itemId} from ${source.mobId} camps in ${source.zoneId}, ${Math.round(source.chance * 100)}% per kill${diff}`;
}
