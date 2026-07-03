// Map-editor data model. Pure: turns the sim's zone content into a flat list of
// draggable entities and serializes edits back out. No DOM. The `point` on each
// entity is a LIVE reference into the source object, so dragging mutates the same
// {x, z} the canvas reads, and export reflects the current state.
//
// This is an authoring aid: it never feeds the running sim. It reads content that
// is the source of truth and emits a patch a human pastes back into the zone files.

import type { CampDef, GroundObjectDef, NpcDef, ZoneDef } from '../sim/types';
import type { Vec2 } from './view';

export type EntityKind = 'hub' | 'graveyard' | 'lake' | 'poi' | 'camp' | 'npc' | 'object';

export interface EditorEntity {
  key: string; // stable unique id across a session
  kind: EntityKind;
  label: string;
  zoneId: string | null; // which zone's z-band contains it, for grouping/export
  radius: number; // world-space size for drawing + picking (yards)
  point: Vec2; // LIVE reference: mutate point.x / point.z to move it
}

export interface ZoneContent {
  zones: readonly ZoneDef[];
  camps: readonly CampDef[];
  npcs: Readonly<Record<string, NpcDef>>;
  objects: readonly GroundObjectDef[];
  roads?: readonly (readonly Vec2[])[]; // drawn as polylines; not editable in v1
}

// Default pick/draw radii (yards) for markers with no inherent world size.
const POINT_RADIUS = 2;

export function buildEntities(content: ZoneContent): EditorEntity[] {
  const out: EditorEntity[] = [];
  const zoneOf = (p: Vec2) => zoneIdAt(content.zones, p);

  for (const z of content.zones) {
    out.push({
      key: `hub:${z.id}`,
      kind: 'hub',
      label: `${z.name} hub (${z.hub.name})`,
      zoneId: z.id,
      radius: z.hub.radius,
      point: z.hub,
    });
    out.push({
      key: `graveyard:${z.id}`,
      kind: 'graveyard',
      label: `${z.name} graveyard`,
      zoneId: z.id,
      radius: POINT_RADIUS,
      point: z.graveyard,
    });
    z.lakes.forEach((lake, i) => {
      out.push({
        key: `lake:${z.id}:${i}`,
        kind: 'lake',
        label: `${z.name} lake ${i + 1}`,
        zoneId: z.id,
        radius: lake.radius,
        point: lake,
      });
    });
    z.pois.forEach((poi, i) => {
      out.push({
        key: `poi:${z.id}:${i}`,
        kind: 'poi',
        label: poi.label,
        zoneId: z.id,
        radius: POINT_RADIUS,
        point: poi,
      });
    });
  }

  content.camps.forEach((camp, i) => {
    out.push({
      key: `camp:${i}`,
      kind: 'camp',
      label: `${camp.mobId} x${camp.count}`,
      zoneId: zoneOf(camp.center),
      radius: Math.max(POINT_RADIUS, camp.radius),
      point: camp.center,
    });
  });

  for (const [id, npc] of Object.entries(content.npcs)) {
    if (npc.dynamic) continue; // not surface-placed; nothing to position on the map
    out.push({
      key: `npc:${id}`,
      kind: 'npc',
      label: npc.name,
      zoneId: zoneOf(npc.pos),
      radius: POINT_RADIUS,
      point: npc.pos,
    });
  }

  content.objects.forEach((obj, oi) => {
    obj.positions.forEach((pos, pi) => {
      out.push({
        key: `object:${oi}:${pi}`,
        kind: 'object',
        label: obj.name,
        zoneId: zoneOf(pos),
        radius: POINT_RADIUS,
        point: pos,
      });
    });
  });

  return out;
}

// The zone whose [zMin, zMax] band contains the point, or null. Zones partition the
// world by z; this is only for grouping handles, never for sim logic.
export function zoneIdAt(zones: readonly ZoneDef[], p: Vec2): string | null {
  for (const z of zones) {
    if (p.z >= z.zMin && p.z <= z.zMax) return z.id;
  }
  return null;
}

// Snapshot of every entity's position, taken at load, to diff edits against.
export function snapshot(entities: readonly EditorEntity[]): Map<string, Vec2> {
  const m = new Map<string, Vec2>();
  for (const e of entities) m.set(e.key, { x: e.point.x, z: e.point.z });
  return m;
}

export interface MovedEntity {
  key: string;
  kind: EntityKind;
  label: string;
  zoneId: string | null;
  from: Vec2;
  to: Vec2;
}

// Entities whose position differs from the snapshot, rounded to `precision`
// decimals so sub-yard float noise from dragging does not register as a change.
export function diffMoved(
  entities: readonly EditorEntity[],
  base: Map<string, Vec2>,
  precision = 2,
): MovedEntity[] {
  const moved: MovedEntity[] = [];
  for (const e of entities) {
    const was = base.get(e.key);
    if (!was) continue;
    const to = { x: round(e.point.x, precision), z: round(e.point.z, precision) };
    const from = { x: round(was.x, precision), z: round(was.z, precision) };
    if (to.x !== from.x || to.z !== from.z) {
      moved.push({ key: e.key, kind: e.kind, label: e.label, zoneId: e.zoneId, from, to });
    }
  }
  return moved;
}

// Human-readable patch of the moved markers, grouped by zone. Not auto-applied: the
// zone content is hand-authored data-as-code, so the operator pastes these in.
export function formatPatch(moved: readonly MovedEntity[]): string {
  if (moved.length === 0) return 'No changes.';
  const byZone = new Map<string, MovedEntity[]>();
  for (const m of moved) {
    const z = m.zoneId ?? '(unzoned)';
    (byZone.get(z) ?? byZone.set(z, []).get(z)!).push(m);
  }
  const lines: string[] = [`${moved.length} marker(s) moved:`, ''];
  for (const [zone, items] of byZone) {
    lines.push(`# ${zone}`);
    for (const m of items) {
      const f = `(${m.from.x}, ${m.from.z})`;
      const t = `(${m.to.x}, ${m.to.z})`;
      lines.push(`  ${m.kind}: ${m.label}: ${f} to ${t}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function round(v: number, precision: number): number {
  const f = 10 ** precision;
  return Math.round(v * f) / f;
}
