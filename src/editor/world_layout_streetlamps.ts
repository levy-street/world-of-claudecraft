import { STREETLAMP_FIXTURE } from '../render/streetlamp_fixture.generated';
import type { MapDoc, MapPlacement } from '../sim/map_doc';
import {
  STREETLAMP_COLLIDER_RADIUS,
  STREETLAMP_FIXTURE_HEIGHT,
  STREETLAMP_STYLE_BY_ZONE,
  type StreetlampStyleId,
} from '../sim/streetlamp_style';
import type { LayoutStreetlamp } from '../sim/world_layout/streetlamps';
import { compileLayoutAdditions } from './world_layout_additions';
import { matchLayoutScenery } from './world_layout_scenery';

const NATIVE_FIELDS = new Set([
  'path',
  'x',
  'z',
  'y',
  'rotY',
  'rotX',
  'rotZ',
  'scale',
  'scaleX',
  'scaleY',
  'scaleZ',
  'detached',
  'groundY',
  'collideRadius',
  'collideCustom',
]);

export interface StreetlampLayoutBinding {
  uid: string;
  source: MapPlacement;
  reason: string;
  /** UID is present in the reviewed historical source and deliberately absent now. */
  remove?: true;
  /** Explicitly reviewed historical anchor, absent from the current road plan. */
  absentSourceReason?: string;
}

export function compileLayoutStreetlamps(
  map: MapDoc,
  bindings: readonly StreetlampLayoutBinding[] | undefined,
  current: readonly MapPlacement[] | undefined,
  used: Set<string>,
  reserved: Set<number>,
  issue: (id: string, reason: string) => void,
): LayoutStreetlamp[] {
  const out: LayoutStreetlamp[] = [];
  const sources = new Set<string>();
  for (const binding of bindings ?? []) {
    try {
      const style = /^props\/streetlamp_([a-z0-9_]+)$/.exec(binding.source.assetId)?.[1] as
        | StreetlampStyleId
        | undefined;
      if (
        !style ||
        !STREETLAMP_FIXTURE[style] ||
        !current ||
        !binding.reason.trim() ||
        !Number.isFinite(binding.source.x) ||
        !Number.isFinite(binding.source.z)
      )
        throw new Error('Lamp needs a known fixture, current baseline and review reason.');
      const matches = matchLayoutScenery([binding.source, binding.source], current).matches;
      if (
        matches.length > 1 ||
        (matches.length === 0 && !binding.absentSourceReason?.trim()) ||
        matches.some((m) => reserved.has(m.currentIndex))
      )
        throw new Error('Lamp source is missing, ambiguous or already replaced.');
      const key = JSON.stringify([style, binding.source.x, binding.source.z]);
      if (sources.has(key)) throw new Error('Lamp source is bound twice.');
      if (binding.remove) {
        if (binding.source.uid !== binding.uid || map.placements.some((p) => p.uid === binding.uid))
          throw new Error('Lamp removal needs a historical UID absent from the reviewed map.');
        out.push({ source: { x: binding.source.x, z: binding.source.z, style }, target: null });
        sources.add(key);
        for (const match of matches) reserved.add(match.currentIndex);
        continue;
      }
      const localUsed = new Set(used),
        errors: string[] = [];
      const projected = compileLayoutAdditions(
        map,
        { [binding.uid]: binding.reason },
        localUsed,
        (_id, reason) => errors.push(reason),
      );
      const p = projected[0];
      const expectedScale = STREETLAMP_FIXTURE_HEIGHT / STREETLAMP_FIXTURE[style].unitHeight;
      if (
        errors.length ||
        projected.length !== 1 ||
        Object.keys(p).some((key) => !NATIVE_FIELDS.has(key)) ||
        p.path !== `/models/props/streetlamp_${style}.glb` ||
        Math.abs(p.scale - expectedScale) > 1e-9 ||
        (p.rotX ?? 0) !== 0 ||
        (p.rotZ ?? 0) !== 0 ||
        [p.scaleX ?? 1, p.scaleY ?? 1, p.scaleZ ?? 1].some((s) => s !== 1) ||
        p.collideRadius !== STREETLAMP_COLLIDER_RADIUS[style] ||
        !p.collideCustom ||
        p.hitboxes?.length
      )
        throw new Error(
          'Native lamp binding supports upright, original-size fixtures with their canonical solid post.',
        );
      out.push({
        source: { x: binding.source.x, z: binding.source.z, style },
        target: {
          x: p.x,
          z: p.z,
          lift: p.y ?? 0,
          fixtureYaw: p.rotY,
          ...(p.detached ? { groundY: p.groundY ?? 0 } : {}),
          areaId:
            Object.entries(STREETLAMP_STYLE_BY_ZONE).find(([, value]) => value === style)?.[0] ??
            null,
        },
      });
      sources.add(key);
      used.add(binding.uid);
      for (const match of matches) reserved.add(match.currentIndex);
    } catch (error) {
      issue(`streetlamp:${binding.uid}`, error instanceof Error ? error.message : String(error));
    }
  }
  return out;
}
