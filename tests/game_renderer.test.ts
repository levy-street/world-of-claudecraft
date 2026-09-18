import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameRenderer, validateGameRenderer } from '../src/game/game_renderer';
import { Settings } from '../src/game/settings';
import type { RendererCreateOptions } from '../src/render/renderer';
import { QuestTrackingState, sharedQuestTracking } from '../src/ui/quest_tracking_core';
import type { IWorld } from '../src/world_api';

const render = vi.hoisted(() => ({
  construct: vi.fn(),
  sync: vi.fn(),
  isContextLost: vi.fn(() => false),
}));

vi.mock('../src/render/renderer', () => ({
  Renderer: class {
    sync = render.sync;
    webgl = { getContext: () => ({ isContextLost: render.isContextLost }) };
    constructor(...args: unknown[]) {
      render.construct(...args);
    }
  },
}));

vi.mock('../src/ui/quest_tracking_core', async (original) => ({
  ...(await original<typeof import('../src/ui/quest_tracking_core')>()),
  sharedQuestTracking: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  render.isContextLost.mockReturnValue(false);
});

function fixture() {
  const world = {
    cfg: { playerClass: 'warrior' },
    player: { name: 'Eastbrook' },
  } as unknown as IWorld;
  const canvas = {} as HTMLCanvasElement;
  const nameplates = {} as HTMLDivElement;
  return { world, canvas, nameplates };
}

describe('game renderer composition', () => {
  it('forwards construction options and reads the shared persisted tracking choice for the current character', () => {
    const rows = new Map<string, string>();
    const storage = {
      getItem: (key: string) => rows.get(key) ?? null,
      setItem: (key: string, value: string) => void rows.set(key, value),
    };
    const tracking = new QuestTrackingState(storage);
    vi.mocked(sharedQuestTracking).mockReturnValue(tracking);
    const { world, canvas, nameplates } = fixture();
    const context = {} as WebGL2RenderingContext;
    const settings = new Settings();
    createGameRenderer(world, canvas, nameplates, settings, { context, initializeGfx: false });
    expect(render.construct).toHaveBeenCalledWith(world, canvas, nameplates, {
      context,
      initializeGfx: false,
      isQuestTracked: expect.any(Function),
      isEastbrookGuidanceEnabled: expect.any(Function),
    });
    const options = render.construct.mock.calls[0][3] as RendererCreateOptions;
    expect(options.isEastbrookGuidanceEnabled?.()).toBe(true);
    settings.set('eastbrookGuidance', false);
    expect(options.isEastbrookGuidanceEnabled?.()).toBe(false);
    const isTracked = options.isQuestTracked;
    if (!isTracked) throw new Error('Missing injected tracking reader');
    expect(isTracked('q_wolves')).toBe(true);
    tracking.setTracked('q_wolves', false);
    expect(isTracked('q_wolves')).toBe(false);

    // A fresh tracking instance reads the same stored row, as on reconnect.
    vi.mocked(sharedQuestTracking).mockReturnValue(new QuestTrackingState(storage));
    expect(isTracked('q_wolves')).toBe(false);
    world.player.name = 'Other character';
    expect(isTracked('q_wolves')).toBe(true);
    world.player.name = 'Eastbrook';
    expect(isTracked('q_wolves')).toBe(false);
  });

  it('validates with a render sync and rejects a lost WebGL context', () => {
    const { world, canvas, nameplates } = fixture();
    const renderer = createGameRenderer(world, canvas, nameplates, new Settings());
    expect(() => validateGameRenderer(renderer)).not.toThrow();
    expect(render.sync).toHaveBeenCalledWith(1, 0, null, 0, null);

    render.isContextLost.mockReturnValue(true);
    expect(() => validateGameRenderer(renderer)).toThrow(
      'WebGL2 context was lost while validating the rebuilt renderer',
    );
  });
});
