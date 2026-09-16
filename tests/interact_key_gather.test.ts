import { describe, expect, it, vi } from 'vitest';

// The wiring under test is thin by design (main.ts firewall extraction), so
// the two UI cores it composes are mocked and the assertions are about what
// reaches them and what comes back, never about their own rules (those have
// their own suites: tests/gather_node_interact.test.ts,
// tests/gather_node_tooltip_controller.test.ts, the gathering view suites).
vi.mock('../src/ui/gather_node_tooltip_controller', () => ({
  gatherNodeToolGateFor: vi.fn((_world: unknown, node: { tier: number }) => ({
    nodeTier: node.tier,
    viewerToolTier: 0,
    unmetText: `unmet:${node.tier}`,
  })),
}));
vi.mock('../src/ui/hud/professions/gathering_view', () => ({
  gatherEffectPrompt: vi.fn((_world: unknown, nodeId: string) =>
    nodeId === 'ore_prompt' ? { effectId: 'fx', charges: 2 } : null,
  ),
}));
vi.mock('../src/ui/i18n', () => ({
  t: (key: string) => `t:${key}`,
}));

import {
  createGatherEffectConfirm,
  interactKeyGatherOptions,
} from '../src/game/interact_key_gather';
import { GATHER_NODES } from '../src/sim/data';
import { gatherNodeToolGateFor } from '../src/ui/gather_node_tooltip_controller';
import { gatherEffectPrompt } from '../src/ui/hud/professions/gathering_view';
import type { IWorld } from '../src/world_api';

const world = { marker: 'world' } as unknown as IWorld;

describe('createGatherEffectConfirm', () => {
  it('asks the view core the pure question and routes the ask through the HUD dialog', () => {
    const confirmToolEffectUse = vi.fn();
    const gate = createGatherEffectConfirm(world, { confirmToolEffectUse });

    expect(gate.needed('ore_plain')).toBeNull();
    expect(gate.needed('ore_prompt')).toEqual({ effectId: 'fx', charges: 2 });
    expect(gatherEffectPrompt).toHaveBeenCalledWith(world, 'ore_prompt');

    const proceed = vi.fn();
    const prompt = { effectId: 'fx', charges: 2 };
    gate.ask(prompt, proceed);
    expect(confirmToolEffectUse).toHaveBeenCalledExactlyOnceWith(prompt, proceed);
  });
});

describe('interactKeyGatherOptions', () => {
  it('hands the press the live node list, the localized lines and the shared confirm gate', () => {
    const effectConfirm = { needed: vi.fn(() => null), ask: vi.fn() };
    const opts = interactKeyGatherOptions(world, effectConfirm);

    // The SAME array the node click and the tool press read, not a copy.
    expect(opts.nodes).toBe(GATHER_NODES);
    expect(opts.tooFarText).toBe('t:questUi.errors.tooFar');
    expect(opts.notReadyText).toBe('t:hudChrome.gathering.notReady');
    expect(opts.effectConfirm).toBe(effectConfirm);
  });

  it('resolves the tool gate against the picked node with the live world', () => {
    const opts = interactKeyGatherOptions(world, { needed: () => null, ask: () => {} });
    const node = { id: 'ore_t2', pos: { x: 1, z: 0 }, type: 'ore', tier: 2 } as const;

    expect(opts.toolGateFor?.(node)).toEqual({
      nodeTier: 2,
      viewerToolTier: 0,
      unmetText: 'unmet:2',
    });
    expect(gatherNodeToolGateFor).toHaveBeenCalledWith(world, node);
  });
});
