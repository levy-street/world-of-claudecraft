import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  deckStandInAction,
  deckStandInParentTransform,
  disposeDeckStandIn,
} from '../src/render/harbor_deck_stand_in_core';
import { GULLHAVEN_HARBOR, MAINLAND_HARBOR } from '../src/sim/harbor_layout';
import { WATER_LEVEL } from '../src/sim/world';

const HARBOR_SOURCE = readFileSync(new URL('../src/render/harbor.ts', import.meta.url), 'utf8');
const RENDERER_SOURCE = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

describe('harbor deck stand-in core', () => {
  it('builds only while a ship prop cue is live and keeps one existing visual', () => {
    expect(deckStandInAction(false, false, true)).toBe('idle');
    expect(deckStandInAction(true, false, true)).toBe('build');
    expect(deckStandInAction(true, true, true)).toBe('keep');
  });

  it('disposes an existing visual as soon as the prop cue is no longer live', () => {
    expect(deckStandInAction(false, true, true)).toBe('dispose');
  });

  it('builds nothing for the online blank entity while preserving an existing stand-in', () => {
    expect(deckStandInAction(true, false, false)).toBe('idle');
    expect(deckStandInAction(true, true, false)).toBe('keep');
  });

  it('preserves the authored world offset and player scale under the scaled ship parent', () => {
    const shipScale = 60 / 36.39;
    const transform = deckStandInParentTransform(
      { x: 6.6, y: 7.72, z: -1.25, yaw: Math.PI / 2 },
      shipScale,
      1.4,
    );

    expect(transform.x * shipScale).toBeCloseTo(6.6);
    expect(transform.y * shipScale).toBeCloseTo(7.72);
    expect(transform.z * shipScale).toBeCloseTo(-1.25);
    expect(transform.scale * shipScale).toBeCloseTo(1.4);
    expect(transform.yaw).toBe(Math.PI / 2);
  });

  it('places the authored attach point at both harbor deck centers and deck height', () => {
    const attach = { x: 6.6, y: 7.72, z: 0 };
    for (const harbor of [MAINLAND_HARBOR, GULLHAVEN_HARBOR]) {
      const deck = harbor.shipDecks[0];
      const cos = Math.cos(harbor.berth.rot);
      const sin = Math.sin(harbor.berth.rot);
      const worldX = harbor.berth.x + attach.x * cos + attach.z * sin;
      const worldZ = harbor.berth.z - attach.x * sin + attach.z * cos;
      const worldY = WATER_LEVEL - harbor.berth.draft + attach.y;

      expect(worldX).toBeCloseTo(deck.x);
      expect(worldZ).toBeCloseTo(deck.z);
      expect(worldY).toBeCloseTo(deck.y);
    }
  });

  it('can explicitly dispose a stand-in during scene reset', () => {
    const visual = {};
    const handle = { cueStartSec: 1, segment: {}, deckStandIn: visual as typeof visual | null };
    const dispose = vi.fn();

    disposeDeckStandIn(handle, dispose);
    disposeDeckStandIn(handle, dispose);

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(handle.deckStandIn).toBeNull();
  });
});

describe('harbor deck stand-in render wiring', () => {
  it('builds the local appearance through the public character builder entry point', () => {
    expect(HARBOR_SOURCE).toContain(
      'const HARBOR_SHIP_DECK_STAND_IN_ATTACH = {\n  x: 6.6,\n  y: 7.72,\n  z: 0,\n  yaw: Math.PI / 2,\n}',
    );
    expect(HARBOR_SOURCE).toContain("from './characters';");
    expect(HARBOR_SOURCE).toContain('const visual = createCharacterVisual(player);');
    expect(HARBOR_SOURCE).not.toContain("from './characters/visual';");
    expect(HARBOR_SOURCE).toContain('export const updateHarborShips = createHarborShipUpdater<');
    expect(HARBOR_SOURCE).toContain('updateMotion: updateHarborShipMotion,');
    expect(RENDERER_SOURCE).toContain(
      'const harborDeckStandInActive = updateHarborShips(this.sim.player, dt);',
    );
    expect(RENDERER_SOURCE).toContain('v.group.visible = !harborDeckStandInActive;');
    expect(HARBOR_SOURCE).toContain(
      'updateStandIn: (visual, dt) => visual.update(dt, DECK_STAND_IN_IDLE_STATE, false)',
    );
  });

  it('routes the existing ship reset through CharacterVisual disposal', () => {
    expect(HARBOR_SOURCE).toMatch(
      /function resetShip\(handle: HarborShipHandle\): void \{[\s\S]{0,250}disposeDeckStandIn\(handle,/,
    );
    expect(HARBOR_SOURCE).toContain('(visual) => visual.dispose()');
  });
});
