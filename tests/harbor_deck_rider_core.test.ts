import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  deckRiderPoseMatches,
  type HarborDeckRiderResolution,
  type HarborDeckRiderShip,
  harborDeckRiderMidInteraction,
  missingDeckRiderWarning,
  resolveHarborDeckRider,
} from '../src/render/harbor_deck_rider_core.js';
import type { HarborDeck } from '../src/sim/harbor_layout.js';
import type { SceneAttachFrame } from '../src/sim/types.js';

const DECKS: readonly HarborDeck[] = [{ x: 10, z: 20, y: 3, hw: 4, hd: 2 }];
const HARBOR_SOURCE = readFileSync(
  fileURLToPath(new URL('../src/render/harbor.ts', import.meta.url)),
  'utf8',
);
const RENDERER_SOURCE = readFileSync(
  fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url)),
  'utf8',
);

const MOVED_FRAME: SceneAttachFrame = {
  position: { x: 30, y: 5, z: 40 },
  yaw: Math.PI / 2,
};

function ship(overrides: Partial<HarborDeckRiderShip> = {}): HarborDeckRiderShip {
  return {
    target: 'ferry',
    baseX: 10,
    baseY: 3,
    baseZ: 20,
    baseRot: 0,
    frame: MOVED_FRAME,
    shipDecks: DECKS,
    displaced: true,
    ...overrides,
  };
}

function output(): HarborDeckRiderResolution {
  return {
    entityId: 0,
    target: '',
    mode: 'none',
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
  };
}

describe('harbor deck rider core', () => {
  it('moves a deck-posted entity through the displaced ship frame', () => {
    const out = output();

    expect(
      resolveHarborDeckRider(
        {
          entityId: 7,
          x: 12,
          y: 3,
          z: 21,
          yaw: 0.25,
          midInteraction: false,
        },
        [ship()],
        out,
      ),
    ).toBe(out);

    expect(out).toEqual({
      entityId: 7,
      target: 'ferry',
      mode: 'ride',
      x: 31,
      y: 5,
      z: 38,
      yaw: Math.PI / 2 + 0.25,
    });
    expect(deckRiderPoseMatches(out, out)).toBe(true);
  });

  it('uses hiding only for a supported rider in a live interaction', () => {
    const out = output();

    resolveHarborDeckRider(
      {
        entityId: 8,
        x: 10,
        y: 3,
        z: 20,
        yaw: 0,
        midInteraction: true,
      },
      [ship()],
      out,
    );

    expect(out.mode).toBe('hide');
    expect(out.target).toBe('ferry');
  });

  it('leaves entities outside live displaced deck plans alone', () => {
    const out = output();
    const candidate = {
      entityId: 9,
      x: 18,
      y: 3,
      z: 20,
      yaw: 1,
      midInteraction: false,
    };

    resolveHarborDeckRider(candidate, [ship()], out);
    expect(out).toMatchObject({ mode: 'none', x: 18, y: 3, z: 20, yaw: 1 });

    resolveHarborDeckRider(candidate, [ship({ displaced: false })], out);
    expect(out.mode).toBe('none');
  });

  it('detects when a resolved rider was not rendered at its displaced pose', () => {
    const out = output();
    resolveHarborDeckRider(
      {
        entityId: 10,
        x: 10,
        y: 3,
        z: 20,
        yaw: 0,
        midInteraction: false,
      },
      [ship()],
      out,
    );

    expect(
      deckRiderPoseMatches(out, {
        x: out.x + 0.1,
        y: out.y,
        z: out.z,
        yaw: out.yaw,
      }),
    ).toBe(false);
    expect(
      missingDeckRiderWarning(out, {
        x: out.x + 0.1,
        y: out.y,
        z: out.z,
        yaw: out.yaw,
      }),
    ).toBe('Entity 10 is supported by displaced ship ferry without riding it.');
  });

  it.each([
    { targetId: 4, castingAbility: null, inCombat: false },
    { targetId: null, castingAbility: 'cast', inCombat: false },
    { targetId: null, castingAbility: null, inCombat: true },
  ])('uses each live interaction arm as the hide fallback', (interaction) => {
    expect(harborDeckRiderMidInteraction(interaction)).toBe(true);
  });

  it('pins far-rider retention, mutation, and the independent runtime audit', () => {
    expect(RENDERER_SOURCE).toMatch(
      /this\.createHarborDeckRiderViews\(\s*runtimeViewBudget,\s*createdViewTypes\s*\)/,
    );
    expect(RENDERER_SOURCE).toContain('if (max === 0 || !harborShipCueActive()) return 0;');
    expect(RENDERER_SOURCE).toContain('if (created >= max) break;');
    expect(RENDERER_SOURCE).toContain('runtimeViewBudget - deckRiderViews');
    expect(RENDERER_SOURCE).toContain('!harborDeckRiderActive(e) &&');
    expect(RENDERER_SOURCE).toContain(
      '!deckRiderActive &&\n        characterViewOutsideHysteresis(',
    );
    expect(RENDERER_SOURCE).toContain('const riderPlan = harborDeckRiderVisualPlan(e, v.group);');
    expect(RENDERER_SOURCE).toContain('applyHarborDeckRiderVisual(riderPlan, v.group);');
    expect(RENDERER_SOURCE).toContain('warnMissingHarborDeckRider(riderPlan, v.group);');
    expect(HARBOR_SOURCE).toContain('visual.visible = false;');
    expect(HARBOR_SOURCE).toContain('console.warn(warning);');
  });
});
