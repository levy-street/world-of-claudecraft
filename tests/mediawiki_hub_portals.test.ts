import { expect, it } from 'vitest';
import { classHubRows, zoneHubRows } from '../scripts/mediawiki/hub_portals';
import { CLASSES, ZONES } from '../src/sim/data';

const w = {
  link: (title: string, label = title) => '[[' + title + '|' + label + ']]',
  titleBy: {
    zone: new Map(ZONES.map((z) => [z.id, 'zone/' + z.id])),
    class: new Map(Object.keys(CLASSES).map((id) => [id, 'class/' + id])),
  },
} as unknown as Parameters<typeof zoneHubRows>[0];

it('gives every zone card its level band and town as labelled facts, lowest band first', () => {
  const rows = zoneHubRows(w);
  expect(rows).toHaveLength(ZONES.length);
  const lows = rows.map((r) => Number(/Levels?: (\d+)/.exec(r)![1]));
  expect(lows).toEqual([...lows].sort((a, b) => a - b));
  for (const zone of ZONES) {
    const row = rows.find((r) => r.startsWith('[[zone/' + zone.id + '|'))!;
    expect(row).toContain(' · Town: ' + zone.hub.name);
  }
});

it('gives every class card its resource, roles in tank-healer-damage order and specializations', () => {
  const rows = classHubRows(w);
  expect(rows).toHaveLength(Object.keys(CLASSES).length);
  for (const row of rows) {
    expect(row).toMatch(/ · Resource: [A-Z]/);
    expect(row).toMatch(/ · Roles: (Tank|Healer|Damage)/);
    expect(row).toMatch(/ · Specializations: \S/);
    const roles = /Roles: ([^·]+)/.exec(row)![1].trim().split(', ');
    const order = ['Tank', 'Healer', 'Damage'];
    expect(roles).toEqual([...roles].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  }
  expect(rows.find((r) => r.startsWith('[[class/druid|'))).toContain('Roles: Tank, Healer, Damage');
});
