import { zoneContaining } from '../../src/sim/data';
import { BAKED_MAP_BG } from '../../src/ui/map_bg_manifest.generated';
import { mapZoneRegion } from '../../src/ui/map_terrain';

export interface RoutePoint {
  step: 'Start' | 'Hand-in' | 'Reward' | number;
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
  step === 'Start' ? 'S' : step === 'Hand-in' ? 'H' : step === 'Reward' ? 'R' : String(step);

/** Maps share the game's map axes: increasing x is left, increasing z is up.
 * Keep instance-local coordinates on their own plane and co-located stops on one pin. */
export function questMap(
  route: { points: RoutePoint[] },
  kind: 'quest' | 'system' | 'item' = 'quest',
  notes: string[] = [],
) {
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
    kind === 'item' ? '== Acquisition map ==' : '== Route map ==',
    ...notes.map((note) => note + '\n'),
    (kind === 'item'
      ? 'Numbers match the source sections above. Each location names its starting, objective or collection action. Choose one available source.'
      : kind === 'system'
        ? 'S = start · Numbers = walkthrough steps · R = reward or arrival.'
        : 'S = start · Numbers = objective steps · H = hand-in.') +
      ' Overworld maps show the full zone. Pins with multiple labels share one location. A + on a pin means more source numbers are listed below. Circles show search areas. Coordinates are (X, Z) in yards. Each instance map uses its own room origin.',
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
    const plate = zone ? mapZoneRegion(zone) : undefined;
    const localWidth = Math.max(65, 1.2 * (xMax - xMin), 1.2 * (zMax - zMin) * 1.65);
    const dx = plate ? plate.maxX - plate.minX : localWidth,
      dz = plate ? plate.maxZ - plate.minZ : localWidth / 1.65;
    const right = plate ? plate.maxX : (xMin + xMax + dx) / 2,
      top = plate ? plate.maxZ : (zMin + zMax + dz) / 2;
    const pins: string[] = [];
    const rows: string[] = [];
    let bg = ' style="aspect-ratio:' + fmt(dx) + '/' + fmt(dz) + '"';
    if (zone && Object.hasOwn(BAKED_MAP_BG.zones, zone.id)) {
      bg =
        ' data-zone="' +
        zone.id +
        '" style="aspect-ratio:' +
        fmt(dx) +
        '/' +
        fmt(dz) +
        ';background-size:100% 100%;background-position:0% 0%"';
    }
    if (zone)
      pins.push(
        '<span class="woc-landmark" title="' +
          esc(zone.hub.name + ' · settlement reference') +
          '" style="left:' +
          fmt((100 * (right - zone.hub.x)) / dx) +
          '%;top:' +
          fmt((100 * (top - zone.hub.z)) / dz) +
          '%">' +
          esc(zone.hub.name) +
          '</span>',
      );
    for (const same of locs.values()) {
      const p = same[0],
        x = fmt((100 * (right - p.x)) / dx),
        y = fmt((100 * (top - p.z)) / dz);
      const stepLabels = [...new Set(same.map((p) => marker(p.step)))];
      const steps = stepLabels.join('/');
      const badge = steps.length > 12 ? stepLabels.slice(0, 3).join('/') + '/+' : steps;
      const descriptions = [...new Set(same.map((p) => p.label))].join(' / ');
      const label = steps + ' · ' + descriptions + ' (' + fmt(p.x) + ', ' + fmt(p.z) + ')';
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
          esc(
            label.replace(
              /\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g,
              (_, title, display) => display ?? title,
            ),
          ) +
          '" style="left:' +
          x +
          '%;top:' +
          y +
          '%">' +
          esc(badge) +
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
