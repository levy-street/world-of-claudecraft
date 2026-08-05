import { describe, expect, it } from 'vitest';
import { buildZoneGraph, findZonePath } from '../farmbot/zone_graph';
import { PORTALS, ZONES } from '../src/sim/data';

const GRAPH = buildZoneGraph(ZONES, PORTALS);

function hops(graph: typeof GRAPH, from: string, to: string) {
  const path = findZonePath(graph, from, to);
  return path?.map((h) => h.zoneId) ?? null;
}

describe('farmbot zone graph (real ZONES)', () => {
  it('links the strip chain through the default central passes', () => {
    expect(hops(GRAPH, 'eastbrook_vale', 'mirefen_marsh')).toEqual(['mirefen_marsh']);
    expect(hops(GRAPH, 'eastbrook_vale', 'thornpeak_heights')).toEqual([
      'mirefen_marsh',
      'thornpeak_heights',
    ]);
    const path = findZonePath(GRAPH, 'eastbrook_vale', 'thornpeak_heights');
    expect(path?.[0].waypoint).toEqual({ x: 0, z: 180 });
    expect(path?.[1].waypoint).toEqual({ x: 0, z: 540 });
  });

  it('treats the veiled hollow south border as sealed and routes through the portal', () => {
    // no direct thornpeak -> veiled edge...
    expect(
      (GRAPH.get('thornpeak_heights') ?? []).some(
        (h) => h.zoneId === 'veiled_hollow' && h.waypoint.z === 900,
      ),
    ).toBe(false);
    // ...but the duskfall passage portal links them
    const path = findZonePath(GRAPH, 'eastbrook_vale', 'veiled_hollow');
    expect(path).not.toBeNull();
    const last = path?.[path.length - 1];
    expect(last?.zoneId).toBe('veiled_hollow');
    expect(last?.waypoint).toEqual({ x: 10, z: 770 }); // portal mouth on the thornpeak side
  });

  it('connects the column zones through their declared passes', () => {
    expect(hops(GRAPH, 'mirefen_marsh', 'willowfen')).toEqual(['willowfen']);
    expect(hops(GRAPH, 'mirefen_marsh', 'galecrest')).toEqual(['galecrest']);
    expect(hops(GRAPH, 'thornpeak_heights', 'palmreach')).toEqual(['palmreach']);
    expect(hops(GRAPH, 'thornpeak_heights', 'evergarden')).toEqual(['evergarden']);
    // the far north: frostveil bridges to both columns
    expect(hops(GRAPH, 'frostveil', 'drakelands')).toEqual(['drakelands']);
    expect(hops(GRAPH, 'frostveil', 'amberfall')).toEqual(['amberfall']);
    // and the columns chain south through their own bands
    expect(hops(GRAPH, 'drakelands', 'wraithwood')).toEqual(['wraithwood']);
    expect(hops(GRAPH, 'amberfall', 'nightbloom')).toEqual(['nightbloom']);
  });

  it('farshore_isle is unreachable on foot (no declared pass)', () => {
    expect(findZonePath(GRAPH, 'eastbrook_vale', 'farshore_isle')).toBeNull();
    expect(GRAPH.get('farshore_isle') ?? []).toEqual([]);
  });

  it('returns an empty path when already there', () => {
    expect(findZonePath(GRAPH, 'mirefen_marsh', 'mirefen_marsh')).toEqual([]);
  });
});
