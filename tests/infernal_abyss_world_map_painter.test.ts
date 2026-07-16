import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { InfernalAbyssWorldMapPainter } from '../src/ui/infernal_abyss_world_map_painter';
import type { IWorld } from '../src/world_api';

const painterSource = readFileSync(
  new URL('../src/ui/infernal_abyss_world_map_painter.ts', import.meta.url),
  'utf8',
);
const tokensSource = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const painterCode = painterSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

function fakeContext(): CanvasRenderingContext2D {
  const target: Record<PropertyKey, unknown> = {
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
  return new Proxy(target, {
    get(object, property) {
      if (!(property in object)) object[property] = vi.fn();
      return object[property];
    },
    set(object, property, value) {
      object[property] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function infernalWorld(): IWorld {
  const origin = instanceOrigin(DUNGEONS.infernal_abyss.index, 0);
  const player = {
    id: 1,
    kind: 'player',
    dead: false,
    ghost: false,
    pos: { x: origin.x, z: origin.z },
    facing: 0,
  };
  return {
    player,
    entities: new Map([[player.id, player]]),
    partyInfo: null,
  } as unknown as IWorld;
}

afterEach(() => vi.unstubAllGlobals());

describe('InfernalAbyssWorldMapPainter', () => {
  it('caches the expensive static parchment by canvas size and localized title', () => {
    const backgroundContext = fakeContext();
    const createElement = vi.fn(() => ({
      width: 0,
      height: 0,
      getContext: vi.fn(() => backgroundContext),
    }));
    vi.stubGlobal('document', { documentElement: {}, createElement });
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#000' }));

    const painter = new InfernalAbyssWorldMapPainter();
    const output = fakeContext();
    const world = infernalWorld();
    const classColor = () => '#fff';
    painter.paint(output, world, 560, 'Title A', classColor);
    painter.paint(output, world, 560, 'Title A', classColor);
    expect(createElement).toHaveBeenCalledTimes(1);

    painter.paint(output, world, 560, 'Title B', classColor);
    expect(createElement).toHaveBeenCalledTimes(2);

    painter.paint(output, world, 480, 'Title B', classColor);
    expect(createElement).toHaveBeenCalledTimes(3);
  });

  it('keeps all painter colors in cached CSS design tokens', () => {
    const hex = painterCode.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = painterCode.match(/\brgba?\s*\(/g) ?? [];
    expect(hex, `hex colors: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb colors: ${rgb.join(', ')}`).toEqual([]);

    const tokenNames = [...painterSource.matchAll(/'(--color-[^']+)'/g)].map((match) => match[1]);
    expect(tokenNames.length).toBeGreaterThan(20);
    for (const token of tokenNames) {
      expect(tokensSource, `missing ${token}`).toContain(`${token}:`);
    }
    expect(painterCode).toContain('getComputedStyle');
    expect(painterCode).toContain('getPropertyValue');
  });

  it('keeps static map richness in the cached layer and live markers separate', () => {
    for (const layer of [
      'paintParchment',
      'paintBurntFrame',
      'paintChasms',
      'paintRoutes',
      'paintRooms',
      'paintBarriers',
      'paintLava',
      'paintRoomSigils',
      'paintLoreRunes',
      'paintCompassRose',
    ]) {
      expect(painterCode, `missing static layer ${layer}`).toContain(`this.${layer}(`);
    }
    expect(painterCode).toContain('this.paintLiveMarkers(');
    expect(painterCode).toContain('if (model.corpse) this.paintCorpseMarker(');
  });

  it('draws no untranslated room labels, only the localized title supplied by Hud', () => {
    expect(painterCode.match(/\.fillText\(/g)).toHaveLength(1);
    expect(painterCode).toContain('ctx.fillText(title,');
    for (const rawRoomLabel of ['Armory', 'Forge', 'Gladiator', 'Azazel']) {
      expect(painterCode).not.toContain(`'${rawRoomLabel}'`);
    }
  });
});
