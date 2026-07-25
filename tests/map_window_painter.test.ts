// No-magic-values + cadence guard for the overworld map painter.
//
// The pure geometry is covered by tests/map_window_view.test.ts. This suite also
// drives the real painter through a narrow fake 2D context so adapter wiring and
// token selection are behavior assertions rather than source-text guesses.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_WORLD, setActiveWorldContent, ZONES } from '../src/sim/data';
import { emptyZoneProps } from '../src/sim/types';
import { MapWindowPainter } from '../src/ui/map_window_painter';
import type { IWorld } from '../src/world_api';

const painter = readFileSync(new URL('../src/ui/map_window_painter.ts', import.meta.url), 'utf8');
// Drop comments so prose can't create a false positive (mirrors architecture.test).
const code = painter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

const MAP_COLOR_TOKENS = [
  '--color-map-label',
  '--color-map-outline',
  '--color-map-portal-dot',
  '--color-map-portal-label',
  '--color-map-npc-quest',
  '--color-map-player',
  '--color-map-ally-friend',
  '--color-map-ally-guild',
  '--color-map-rock',
  '--color-map-tree',
  '--color-map-oak',
  '--color-map-building-outline',
  '--color-map-building-armoury',
  '--color-map-building-chapel',
  '--color-map-building-inn',
  '--color-map-building-house',
  '--color-map-well',
  '--color-map-stall',
  '--color-map-tent',
  '--color-map-mine',
  '--color-map-graveyard',
  '--color-map-mudhut',
  '--color-map-campfire',
];

interface PaintTrace {
  fills: Array<{ style: string; commands: string[] }>;
  styleReads: string[];
}

function fakeMapContext(trace: PaintTrace): CanvasRenderingContext2D {
  let commands: string[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    imageSmoothingEnabled: false,
    drawImage(): void {},
    beginPath(): void {
      commands = [];
    },
    arc(): void {
      commands.push('arc');
    },
    moveTo(): void {
      commands.push('moveTo');
    },
    lineTo(): void {
      commands.push('lineTo');
    },
    closePath(): void {
      commands.push('closePath');
    },
    fill(): void {
      trace.fills.push({ style: String(ctx.fillStyle), commands: [...commands] });
    },
    stroke(): void {},
    fillText(): void {},
    strokeText(): void {},
    save(): void {},
    restore(): void {},
    translate(): void {},
    rotate(): void {},
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

function installMapStyleGlobals(trace: PaintTrace): void {
  vi.stubGlobal('document', { documentElement: {} });
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue(token: string): string {
      trace.styleReads.push(token);
      return `paint:${token}`;
    },
  }));
}

function mapWorld(): IWorld {
  return {
    player: {
      id: 1,
      kind: 'player',
      name: 'Painter',
      pos: { x: 17.5, z: -5.5 },
      facing: 0,
    },
    entities: new Map(),
    socialInfo: null,
    cfg: { seed: 42, playerClass: 'warrior' },
    questState: () => 'unavailable',
    questLog: new Map(),
  } as unknown as IWorld;
}

afterEach(() => {
  setActiveWorldContent(null);
  vi.unstubAllGlobals();
});

describe('map_window_painter: no magic values', () => {
  it('carries no literal hex or rgb color in TS', () => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    expect(hex, `hex colors: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb colors: ${rgb.join(', ')}`).toEqual([]);
  });

  it('resolves --color-map-* tokens via getComputedStyle exactly once per redraw', () => {
    expect(code).toContain('getComputedStyle');
    expect(code).toContain('getPropertyValue');
    expect(code).toContain('--color-map-');
    expect(code).toContain('resolveColors');
    // One getComputedStyle call site total: resolved once per paint into a colors
    // object, never re-read inside a per-marker draw loop.
    expect(code.match(/getComputedStyle/g) ?? []).toHaveLength(1);
  });

  it('defines every map color token it reads in the design-token sheet', () => {
    for (const tok of MAP_COLOR_TOKENS) {
      expect(code, `painter never reads ${tok}`).toContain(tok);
      expect(tokens, `missing ${tok}`).toContain(`${tok}:`);
    }
  });

  it('draws the active-world armoury footprint with its dedicated token', () => {
    const trace: PaintTrace = { fills: [], styleReads: [] };
    installMapStyleGlobals(trace);
    const ctx = fakeMapContext(trace);
    const painter = new MapWindowPainter();
    const world = mapWorld();
    const emptyProps = emptyZoneProps();
    const background = { width: 560, height: 560 } as HTMLCanvasElement;
    const options = {
      zone: ZONES[0],
      bg: background,
      canvasSize: 560,
      zoom: 6,
      center: { x: 17.5, z: -5.5 },
    };
    const buildingStyles = new Set([
      'paint:--color-map-building-armoury',
      'paint:--color-map-building-chapel',
      'paint:--color-map-building-inn',
      'paint:--color-map-building-house',
    ]);

    // An empty active-world props bundle must suppress the built-in Eastbrook
    // lots. This fails if the adapter silently falls back to static PROPS.
    setActiveWorldContent({ ...BUILTIN_WORLD, props: emptyProps });
    painter.paintOverworld(ctx, world, options);
    expect(trace.fills.filter((fill) => buildingStyles.has(fill.style))).toEqual([]);

    trace.fills.length = 0;
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      props: {
        ...emptyProps,
        buildings: [
          {
            kind: 'inn',
            landmark: 'eastbrook_grand_armoury',
            x: 17.5,
            z: -5.5,
            w: 13,
            d: 9,
            rot: -Math.PI / 2,
          },
        ],
      },
    });
    painter.paintOverworld(ctx, world, options);

    const buildingFills = trace.fills.filter((fill) => buildingStyles.has(fill.style));
    expect(buildingFills).toEqual([
      {
        style: 'paint:--color-map-building-armoury',
        commands: ['moveTo', 'lineTo', 'lineTo', 'lineTo', 'closePath'],
      },
    ]);
    expect(trace.styleReads.filter((token) => token.endsWith('building-armoury'))).toHaveLength(2);
  });

  it('caches the whole-world decorations once instead of regenerating per redraw', () => {
    expect(code).toContain('if (!this.decorations) this.decorations = generateDecorations(');
  });
});

describe('map_window_painter: cadence + cached background preserved', () => {
  it("still redraws from hud.update()'s mediumHud band behind the display guard", () => {
    expect(hud).toContain(
      "if ($('#map-window').style.display === 'block') this.updateMapWindow();",
    );
    expect(hud).toContain('this.mapPainter.paintOverworld(ctx, this.sim, {');
  });

  it('blits the Hud-owned cached terrain background rather than rebuilding it', () => {
    // The painter receives the cached bg and only drawImages it (no terrain build).
    expect(code).toContain('ctx.drawImage(');
    expect(code).not.toContain('paintTerrainRows');
    expect(code).not.toContain('renderTerrainCanvas');
    // Hud keeps the bg cache + prewarm and passes the cached canvas in each redraw.
    expect(hud).toContain('bg: this.mapZoneBg(zone)');
  });
});
