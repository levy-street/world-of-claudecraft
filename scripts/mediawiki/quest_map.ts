import { zoneContaining } from '../../src/sim/data';
import { BAKED_MAP_BG } from '../../src/ui/map_bg_manifest.generated';
import { mapZoneRegion } from '../../src/ui/map_terrain';

export interface RoutePoint {
  step: 'Start' | 'Hand-in' | number;
  frame: string;
  label: string;
  x: number;
  z: number;
  radius?: number;
}

const esc = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const fmt = (n: number) => Number(n.toFixed(3));
const marker = (step: RoutePoint['step']) =>
  step === 'Start' ? 'S' : step === 'Hand-in' ? 'H' : String(step);

/** Maps share the game's map axes: increasing x is left, increasing z is up.
 * Keep instance-local coordinates on their own plane and co-located stops on one pin. */
export function questMap(route: { points: RoutePoint[] }) {
  const groups = new Map<string, RoutePoint[]>();
  for (const point of route.points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z))
      throw Error('Invalid quest waypoint: ' + point.label);
    const zone = point.frame === 'Overworld' ? zoneContaining(point.x, point.z) : null;
    const name = zone?.name ?? point.frame;
    const group = groups.get(name) ?? [];
    group.push(point);
    groups.set(name, group);
  }
  if (!groups.size) return '';
  const blocks = [
    '== Route map ==',
    'S = start · Numbers = objective steps · H = hand-in. Pins with multiple labels share one location. Circles show search areas. Coordinates are (X, Z) in yards. Each instance map uses its own room origin.',
  ];
  for (const [name, points] of groups) {
    const zone = points[0].frame === 'Overworld' ? zoneContaining(points[0].x, points[0].z) : null;
    const locs = new Map<string, RoutePoint[]>();
    for (const p of points) {
      const key = p.x + ',' + p.z;
      const same = locs.get(key) ?? [];
      same.push(p);
      locs.set(key, same);
    }
    const xMin = Math.min(...points.map((p) => p.x - (p.radius ?? 0))),
      xMax = Math.max(...points.map((p) => p.x + (p.radius ?? 0)));
    const zMin = Math.min(...points.map((p) => p.z - (p.radius ?? 0))),
      zMax = Math.max(...points.map((p) => p.z + (p.radius ?? 0)));
    const dx = Math.max(65, 1.2 * (xMax - xMin), 1.2 * (zMax - zMin) * 1.65),
      dz = dx / 1.65;
    const right = (xMin + xMax + dx) / 2,
      top = (zMin + zMax + dz) / 2;
    const pins: string[] = [];
    const rows: string[] = [];
    let bg = '';
    if (zone && Object.hasOwn(BAKED_MAP_BG.zones, zone.id)) {
      const plate = mapZoneRegion(zone);
      const sx = (plate.maxX - plate.minX) / dx,
        sy = (plate.maxZ - plate.minZ) / dz;
      const px = Math.abs(1 - sx) < 0.000001 ? 0 : (100 * (right - plate.maxX)) / dx / (1 - sx);
      const py = Math.abs(1 - sy) < 0.000001 ? 0 : (100 * (top - plate.maxZ)) / dz / (1 - sy);
      bg =
        ' data-zone="' +
        zone.id +
        '" style="background-size:' +
        fmt(sx * 100) +
        '% ' +
        fmt(sy * 100) +
        '%;background-position:' +
        fmt(px) +
        '% ' +
        fmt(py) +
        '%"';
    }
    for (const same of locs.values()) {
      const p = same[0],
        x = fmt((100 * (right - p.x)) / dx),
        y = fmt((100 * (top - p.z)) / dz);
      const steps = [...new Set(same.map((p) => marker(p.step)))].join('/');
      const descriptions = [...new Set(same.map((p) => p.label))].join(' / ');
      const label = steps + ' · ' + descriptions + ' (' + p.x + ', ' + p.z + ')';
      const radius = Math.max(...same.map((p) => p.radius ?? 0));
      if (radius > 0)
        pins.push(
          '<span class="woc-radius" style="left:' +
            x +
            '%;top:' +
            y +
            '%;width:' +
            fmt((200 * radius) / dx) +
            '%;height:' +
            fmt((200 * radius) / dz) +
            '%"></span>',
        );
      pins.push(
        '<span class="woc-pin" title="' +
          esc(label) +
          '" style="left:' +
          x +
          '%;top:' +
          y +
          '%">' +
          esc(steps) +
          '</span>',
      );
      rows.push('* ' + label + (radius ? ' · ' + fmt(radius) + ' yd radius' : ''));
    }
    blocks.push(
      "'''" + name + "'''",
      '<div class="woc-map"' + bg + '>' + pins.join('') + '</div>',
      ...rows,
    );
  }
  return blocks.join('\n') + '\n\n';
}
