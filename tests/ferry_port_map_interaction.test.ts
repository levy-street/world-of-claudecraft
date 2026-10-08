import { describe, expect, it, vi } from 'vitest';
import { FERRY_PORTS } from '../src/ui/ferry_port_map_core';
import { drawFerryPortMapMarker } from '../src/ui/ferry_port_map_painter';
import { MapMarkerInteractionController } from '../src/ui/hud/map/map_marker_interaction_controller';
import { MapMarkerTooltipContent } from '../src/ui/hud/map/map_marker_tooltip_content';
import { MapSemanticAccessibilityCore } from '../src/ui/map_semantic_accessibility_core';
import type { IWorld } from '../src/world_api';

function harness() {
  let clock = 0;
  const world = { ferryView: () => ({ clock }) } as unknown as IWorld;
  const content = new MapMarkerTooltipContent(world);
  const paint = vi.fn();
  const hide = vi.fn();
  const name = (id: string) => id;
  const controller = new MapMarkerInteractionController({
    names: {
      zone: name,
      dungeon: name,
      delve: name,
      station: name,
      poi: name,
      rift: name,
      npc: name,
      mob: name,
      worldQuest: name,
    },
    npc: () => '',
    station: () => '',
    service: () => '',
    gather: () => '',
    farm: () => '',
    worldQuest: () => '',
    worldBoss: () => '',
    questArea: () => '',
    navigation: (marker) => content.navigation('', marker),
    paint,
    hide,
    clearMemo: () => {},
  });
  const canvas = {
    width: 560,
    height: 560,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 280, height: 280 }),
  } as HTMLCanvasElement;
  controller.refreshGeometry(canvas);
  const port = { ...FERRY_PORTS[0], mx: 100, my: 120 };
  controller.setContinentPorts([port]);
  return {
    controller,
    content,
    canvas,
    port,
    paint,
    hide,
    setClock: (value: number) => {
      clock = value;
    },
  };
}

describe('ferry port tooltip interaction', () => {
  it.each([false, true])(
    'refreshes a stationary hover/tap (%s), eliding unchanged seconds',
    (touch) => {
      const h = harness();
      expect(h.controller.showAt(h.canvas, 60, 80, touch)).toBe(true);
      expect(h.paint).toHaveBeenCalledTimes(1);
      expect(h.paint.mock.calls[0][0]).toContain('Board now');
      h.controller.setContinentPorts([h.port]);
      expect(h.paint).toHaveBeenCalledTimes(1);
      h.setClock(1);
      h.controller.setContinentPorts([h.port]);
      expect(h.paint).toHaveBeenCalledTimes(2);
      expect(h.paint.mock.calls[1][0]).not.toBe(h.paint.mock.calls[0][0]);
      h.setClock(1000);
      h.controller.stopPortRefresh();
      h.controller.setContinentPorts([h.port]);
      expect(h.paint).toHaveBeenCalledTimes(2);
    },
  );

  it('dismisses a removed port and never revives it after clear', () => {
    const h = harness();
    h.controller.showAt(h.canvas, 60, 80);
    h.controller.setContinentPorts([]);
    expect(h.hide).toHaveBeenCalledOnce();
    h.controller.clear();
    h.setClock(10);
    h.controller.setContinentPorts([h.port]);
    expect(h.paint).toHaveBeenCalledOnce();
  });

  it('does not revive a port after moving to an empty area', () => {
    const h = harness();
    h.controller.showAt(h.canvas, 60, 80);
    expect(h.controller.showAt(h.canvas, 200, 200)).toBe(false);
    h.setClock(10);
    h.controller.setContinentPorts([h.port]);
    expect(h.paint).toHaveBeenCalledOnce();
  });

  it('uses enlarged touch hit targets in CSS pixels', () => {
    const h = harness();
    expect(h.controller.showAt(h.canvas, 78, 80)).toBe(false);
    expect(h.controller.showAt(h.canvas, 78, 80, true)).toBe(true);
  });
});

describe('ferry port silhouette', () => {
  it('draws a hull and sail with supplied tokens and restores canvas state', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
    };
    drawFerryPortMapMarker(
      ctx as unknown as CanvasRenderingContext2D,
      { mx: 30, my: 40 },
      20,
      'gold',
      'dark',
    );
    expect(ctx.fill).toHaveBeenCalledTimes(2);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    expect(ctx.save).toHaveBeenCalledOnce();
    expect(ctx.restore).toHaveBeenCalledOnce();
  });
});

describe('accessible port map timetables', () => {
  it('reads the live timetable resolver on the continent and updates changed seconds', () => {
    const h = harness();
    const core = new MapSemanticAccessibilityCore({
      zone: (id) => id,
      dungeon: (id) => id,
      delve: (id) => id,
      station: (id) => id,
      poi: (id) => id,
      rift: (id) => id,
      npc: (id) => id,
      mob: (id) => id,
      worldQuest: (id) => id,
      ferryPort: (route, berth) => h.content.ferryPortSemantic(route, berth),
    });
    expect(core.updatePorts([h.port], 'World', 560)).toContain('departs in 1:00');
    h.setClock(1);
    expect(core.updatePorts([h.port], 'World', 560)).toContain('departs in 0:59');
    expect(core.updatePorts([], 'World', 560)).not.toContain('ferry departs');
  });
});
