import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasVisibleHuntersMark } from '../src/render/hunter_mark_marker_core';
import type { Aura, Entity } from '../src/sim/types';

function entity(dead: boolean, auras: Aura[]): Pick<Entity, 'dead' | 'auras'> {
  return { dead, auras };
}

function aura(kind: Aura['kind']): Aura {
  return {
    id: kind,
    name: kind,
    kind,
    remaining: 60,
    duration: 60,
    value: 0,
    sourceId: 1,
    school: 'physical',
  };
}

describe("Hunter's Mark overhead marker state", () => {
  it('is visible only on a living entity carrying the replicated mark aura', () => {
    expect(hasVisibleHuntersMark(entity(false, [aura('hunter_mark')]))).toBe(true);
    expect(hasVisibleHuntersMark(entity(false, [aura('buff_speed')]))).toBe(false);
    expect(hasVisibleHuntersMark(entity(true, [aura('hunter_mark')]))).toBe(false);
  });

  it('keeps the marker manager wired into the renderer frame update', () => {
    const source = readFileSync(join(process.cwd(), 'src/render/renderer.ts'), 'utf8');
    expect(source).toContain('new HunterMarkMarkers()');
    expect(source).toContain('this.hunterMarkMarkers.update(this.sim, this.views)');
  });
});
