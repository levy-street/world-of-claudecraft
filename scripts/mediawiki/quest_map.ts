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
    [
      ...(kind === 'item'
        ? [
            'This map shows where to get the item. You only need one of the ways listed above.',
            '* A number on the map matches a numbered way to get it above.',
            '* Each spot in the list below the map says what to do there: start, do a step, or get the item.',
          ]
        : kind === 'system'
          ? [
              'This map shows where to go.',
              '* S marks where you start.',
              '* A number on the map matches a numbered step in the walkthrough.',
              '* R marks where you get your reward or arrive.',
            ]
          : [
              'This map shows where to go for this quest.',
              '* S marks where you start the quest.',
              '* A number on the map matches a numbered quest objective.',
              '* H marks where you hand in the quest.',
            ]),
      '* A pin showing more than one number or letter (like 1/2) is one spot used for all of them.',
      '* A + on a pin means there are more numbers for that spot in the list below the map.',
      '* A circle is an area to search, not one exact spot.',
      '* Coordinates are written (X, Z) and measured in yards.',
      '* Maps of the outside world show the whole zone. Maps inside a dungeon or building use their own coordinates, starting from that room.',
    ].join('\n'),
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
      // One line per thing to do at this spot: its number, where, then what to do there.
      const where =
        ' (' +
        fmt(p.x) +
        ', ' +
        fmt(p.z) +
        ')' +
        (radius ? ', search within ' + fmt(radius) + ' yards' : '');
      for (const text of new Set(same.map((q) => q.label))) {
        const marks = [...new Set(same.filter((q) => q.label === text).map((q) => marker(q.step)))];
        rows.push(
          "* '''" + marks.join('/') + "'''" + where + ': ' + text.replaceAll(' · ', ', ') + '.',
        );
      }
    }
    blocks.push(
      "'''" + name + "'''",
      '<div class="woc-map"' + bg + '>' + pins.join('') + '</div>',
      ...rows,
    );
  }
  return blocks.join('\n') + '\n\n';
}
