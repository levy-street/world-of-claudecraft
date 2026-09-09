// The extracted node-harvest and corpse-harvest feedback executor
// (src/ui/hud/professions/gathering_result_feedback.ts, the monolith-ratchet
// heal, the farm_event_feedback.ts precedent): the two HUD arms driven
// through a recording host. Pins: which surface each event writes, the item
// ids/quantities the lines name, the ROLLED-rarity line color (never the
// item def's own quality), the node-type cue plus the layered rare-tier
// stinger, the last-charge self-note, and the corpse harvest's one-cue
// per-command rule.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches the audio facade directly (the src/ui precedent, same
// as farm_event_feedback.ts) rather than through the host, so the cue arms
// are pinned through a mocked facade.
const audioMock = vi.hoisted(() => ({
  gather: vi.fn(),
  gatherRareTier: vi.fn(),
  lootItem: vi.fn(),
}));
vi.mock('../src/game/audio', () => ({ audio: audioMock }));

import { grantItemToken } from '../src/ui/grant_line_view';
import type {
  GatherResultEvent,
  GatherResultFeedbackHost,
  HarvestResultEvent,
} from '../src/ui/hud/professions/gathering_result_feedback';
import {
  handleGatherResult,
  handleHarvestResult,
} from '../src/ui/hud/professions/gathering_result_feedback';

beforeEach(() => {
  vi.clearAllMocks();
});

interface Call {
  fn: 'log' | 'showSelfNote';
  text: string;
  color?: string;
}

function recordingHost(): { host: GatherResultFeedbackHost; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    host: {
      log: (text, color) => calls.push({ fn: 'log', text, color }),
      showSelfNote: (text) => calls.push({ fn: 'showSelfNote', text }),
    },
  };
}

const driveGather = (ev: GatherResultEvent): Call[] => {
  const { host, calls } = recordingHost();
  handleGatherResult(ev, host);
  return calls;
};

const driveHarvest = (ev: HarvestResultEvent): Call[] => {
  const { host, calls } = recordingHost();
  handleHarvestResult(ev, host);
  return calls;
};

const GATHER_BASE = {
  type: 'gatherResult',
  nodeId: 'ore_1',
  nodeType: 'ore',
  professionId: 'mining',
  itemId: 'copper_ore',
  rareEvent: null,
} as const;

describe('gathering_result_feedback: gatherResult', () => {
  it('logs ONE line naming the granted item and quantity, colored by the ROLLED rarity', () => {
    const calls = driveGather({ ...GATHER_BASE, rarity: 'common', qty: 2 });
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe('log');
    expect(calls[0].color).toBe('#ffffff');
    expect(calls[0].text).toContain(grantItemToken('copper_ore'));
    expect(calls[0].text).toContain('2');
  });

  it('a rare-or-better roll colors the line with that rarity, never the item def quality', () => {
    // Copper Ore is a common-quality def; a rare ROLL still colors rare-blue,
    // which is the gatherResult rule this module preserves verbatim.
    const calls = driveGather({ ...GATHER_BASE, rarity: 'rare', qty: 1 });
    expect(calls[0].color).toBe('#0070dd');
  });

  it('fires the node-type gather cue exactly once', () => {
    driveGather({ ...GATHER_BASE, rarity: 'common', qty: 1 });
    expect(audioMock.gather).toHaveBeenCalledTimes(1);
    expect(audioMock.gather).toHaveBeenCalledWith('ore');
  });

  it('common/uncommon rolls play no rare-tier stinger', () => {
    driveGather({ ...GATHER_BASE, rarity: 'common', qty: 1 });
    driveGather({ ...GATHER_BASE, rarity: 'uncommon', qty: 1 });
    expect(audioMock.gatherRareTier).not.toHaveBeenCalled();
  });

  it('a rare-or-better roll layers the matching stinger ON TOP of the impact cue, never instead of it', () => {
    driveGather({ ...GATHER_BASE, rarity: 'legendary', qty: 1 });
    expect(audioMock.gather).toHaveBeenCalledTimes(1);
    expect(audioMock.gatherRareTier).toHaveBeenCalledWith('legendary');
  });

  it('a rare event forces at least the epic stinger regardless of rolled rarity', () => {
    // 'pristine_vein' is the authored ore-family flavor (GatherRareEventFlavor,
    // src/sim/types.ts), matching GATHER_BASE's 'ore' nodeType.
    driveGather({ ...GATHER_BASE, rarity: 'common', qty: 1, rareEvent: 'pristine_vein' });
    expect(audioMock.gatherRareTier).toHaveBeenCalledWith('epic');
  });

  it('effectDepleted announces the spent last charge as a SELF NOTE, never a second log line', () => {
    const calls = driveGather({
      ...GATHER_BASE,
      rarity: 'common',
      qty: 1,
      effectDepleted: true,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].fn).toBe('log');
    expect(calls[1].fn).toBe('showSelfNote');
  });

  it('omits the self-note when the charge was not depleted', () => {
    const calls = driveGather({ ...GATHER_BASE, rarity: 'common', qty: 1 });
    expect(calls).toHaveLength(1);
  });
});

describe('gathering_result_feedback: harvestResult', () => {
  const yieldOf = (itemId: string, qty: number, rarity: 'common' | 'rare' = 'common') => ({
    itemId,
    qty,
    rarity,
    kind: 'plain' as const,
  });

  it('logs ONE line per distinct yield, naming its item and quantity', () => {
    const calls = driveHarvest({
      type: 'harvestResult',
      pid: 1,
      yields: [yieldOf('rough_hide', 2), yieldOf('sharp_fang', 1)],
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].fn).toBe('log');
    expect(calls[0].text).toContain(grantItemToken('rough_hide'));
    expect(calls[0].text).toContain('2');
    expect(calls[1].text).toContain(grantItemToken('sharp_fang'));
  });

  it('colors each line by its ROLLED rarity, the gatherResult rule restated', () => {
    const calls = driveHarvest({
      type: 'harvestResult',
      pid: 1,
      yields: [yieldOf('rough_hide', 1, 'rare')],
    });
    expect(calls[0].color).toBe('#0070dd');
  });

  it('fires the generic pickup ding EXACTLY once for the whole command, never once per yield', () => {
    driveHarvest({
      type: 'harvestResult',
      pid: 1,
      yields: [yieldOf('rough_hide', 1), yieldOf('sharp_fang', 1), yieldOf('specimen_pelt', 1)],
    });
    expect(audioMock.lootItem).toHaveBeenCalledTimes(1);
    // Never borrows the node-gather cue family: a corpse harvest has its own
    // sound, not the ore/wood/herb impact.
    expect(audioMock.gather).not.toHaveBeenCalled();
    expect(audioMock.gatherRareTier).not.toHaveBeenCalled();
  });
});
