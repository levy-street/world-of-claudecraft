// The extracted farming feedback executor (src/ui/farm_event_feedback.ts, the
// v0.38.0 sync monolith heal): the five HUD arms driven through a recording
// host. These arms previously lived inline in hud.ts's event switch with no
// direct test (the pure resolution underneath is farming_view.test.ts's job);
// the extraction gives the executor its own behavioral pins: which surface
// each event writes, how many lines, which item ids the lines name, the
// half-pair and positive-count guards, and the literal colors.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches the audio facade directly (the src/ui precedent) rather
// than through FarmFeedbackHost, so the cue arms are pinned through a mocked
// facade the same way the sibling window suites stub `audio`.
const audioMock = vi.hoisted(() => ({
  farmPlant: vi.fn(),
  farmHarvest: vi.fn(),
  farmReady: vi.fn(),
}));
vi.mock('../src/game/audio', () => ({ audio: audioMock }));

import type { FarmEvent, FarmFeedbackHost } from '../src/ui/farm_event_feedback';
import { handleFarmEvent } from '../src/ui/farm_event_feedback';
import type { FarmDeniedReason } from '../src/ui/farming_view';
import { grantItemToken } from '../src/ui/grant_line_view';

beforeEach(() => {
  vi.clearAllMocks();
});

interface Call {
  fn: 'log' | 'showSelfNote' | 'showError' | 'showBanner';
  text: string;
  color?: string;
}

function recordingHost(): { host: FarmFeedbackHost; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    host: {
      log: (text, color) => calls.push({ fn: 'log', text, color }),
      showSelfNote: (text) => calls.push({ fn: 'showSelfNote', text }),
      showError: (text) => calls.push({ fn: 'showError', text }),
      showBanner: (text) => calls.push({ fn: 'showBanner', text }),
    },
  };
}

const drive = (ev: FarmEvent): Call[] => {
  const { host, calls } = recordingHost();
  handleFarmEvent(ev, host);
  return calls;
};

describe('farm_event_feedback: the five HUD arms', () => {
  it('farmPlanted logs ONE plant-green line naming the seed the plant consumed', () => {
    const calls = drive({
      type: 'farmPlanted',
      pid: 1,
      bedId: 'eastbrook_1',
      cropId: 'vale_wheat',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe('log');
    expect(calls[0].color).toBe('#c8f7c5');
    // The line names the SEED (the item the plant spent), resolved from the
    // crop id: the literal seed id here pins the crop-to-seed hop.
    expect(calls[0].text).toContain(grantItemToken('vale_wheat_seed'));
  });

  it('a plain harvest logs ONE grant-green produce line with the granted item and quantity', () => {
    const calls = drive({
      type: 'farmHarvested',
      pid: 1,
      bedId: 'eastbrook_1',
      cropId: 'vale_wheat',
      itemId: 'vale_wheat_produce',
      count: 3,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe('log');
    expect(calls[0].color).toBe('#7fdc4f');
    expect(calls[0].text).toContain(grantItemToken('vale_wheat_produce'));
    expect(calls[0].text).toContain('3');
  });

  it('a mixed harvest logs the fine-grade twin as a SECOND line beside the produce line', () => {
    const calls = drive({
      type: 'farmHarvested',
      pid: 1,
      bedId: 'eastbrook_1',
      cropId: 'vale_wheat',
      itemId: 'vale_wheat_produce',
      count: 2,
      fineItemId: 'fine_vale_wheat',
      fineCount: 1,
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].fn).toBe('log');
    expect(calls[1].text).toContain(grantItemToken('fine_vale_wheat'));
  });

  it('a half fine pair renders NOTHING extra (both halves demanded, the malformed-frame guard)', () => {
    const base = {
      type: 'farmHarvested',
      pid: 1,
      bedId: 'eastbrook_1',
      cropId: 'vale_wheat',
      itemId: 'vale_wheat_produce',
      count: 2,
    } as const;
    expect(drive({ ...base, fineItemId: 'fine_vale_wheat' })).toHaveLength(1);
    expect(drive({ ...base, fineCount: 2 })).toHaveLength(1);
  });

  it('the seed-back line renders only on a POSITIVE count and names the seed', () => {
    const base = {
      type: 'farmHarvested',
      pid: 1,
      bedId: 'high_1',
      cropId: 'highland_barley',
      itemId: 'highland_barley_produce',
      count: 2,
    } as const;
    expect(drive({ ...base, seedBackCount: 0 })).toHaveLength(1);
    const calls = drive({ ...base, seedBackCount: 1 });
    expect(calls).toHaveLength(2);
    expect(calls[1].fn).toBe('log');
    expect(calls[1].color).toBe('#7fdc4f');
    expect(calls[1].text).toContain(grantItemToken('highland_barley_seed'));
  });

  it('effectDepleted announces the spent last charge as a SELF NOTE, not a log line', () => {
    const calls = drive({
      type: 'farmHarvested',
      pid: 1,
      bedId: 'eastbrook_1',
      cropId: 'vale_wheat',
      itemId: 'vale_wheat_produce',
      count: 1,
      effectDepleted: true,
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].fn).toBe('showSelfNote');
  });

  it('farmWithered logs the husk payout GREY and the consolation seed-back GREEN', () => {
    const noConsolation = drive({
      type: 'farmWithered',
      pid: 1,
      bedId: 'high_1',
      cropId: 'highland_barley',
      count: 2,
    });
    expect(noConsolation).toHaveLength(1);
    expect(noConsolation[0].color).toBe('#a8a8a8');
    expect(noConsolation[0].text).toContain(grantItemToken('withered_husks'));
    const calls = drive({
      type: 'farmWithered',
      pid: 1,
      bedId: 'high_1',
      cropId: 'highland_barley',
      count: 2,
      seedBackCount: 1,
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].color).toBe('#7fdc4f');
    expect(calls[1].text).toContain(grantItemToken('highland_barley_seed'));
  });

  it('farmDenied renders an error toast ONLY, and the tool reason formats the crop tier', () => {
    const plain = drive({ type: 'farmDenied', pid: 1, reason: 'no_seed' });
    expect(plain).toHaveLength(1);
    expect(plain[0].fn).toBe('showError');
    // The tool refusal on a catalog crop names the tier the plant gate
    // demanded (highland_barley is tier 3).
    const tool = drive({ type: 'farmDenied', pid: 1, reason: 'tool', cropId: 'highland_barley' });
    expect(tool).toHaveLength(1);
    expect(tool[0].fn).toBe('showError');
    expect(tool[0].text).toContain('3');
    // A cropId the catalog does not carry falls back to the flat tool line
    // (still exactly one toast, never a tierless template).
    const drifted = drive({ type: 'farmDenied', pid: 1, reason: 'tool', cropId: 'not_a_crop' });
    expect(drifted).toHaveLength(1);
    expect(drifted[0].fn).toBe('showError');
    expect(drifted[0].text).not.toContain('{tier}');
    // The lock-only refusal (issue 3042, the v0.38.0 sync): resolves through
    // the same reason-keyed template to its own line, one toast.
    const locked = drive({ type: 'farmDenied', pid: 1, reason: 'locked' });
    expect(locked).toHaveLength(1);
    expect(locked[0].fn).toBe('showError');
    expect(locked[0].text.length).toBeGreaterThan(0);
  });

  it('farmHusksConverted logs ONE grant-green line naming BOTH sides of the trade', () => {
    const calls = drive({ type: 'farmHusksConverted', pid: 1, husks: 4, compost: 2 });
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe('log');
    expect(calls[0].color).toBe('#7fdc4f');
    expect(calls[0].text).toContain(grantItemToken('withered_husks'));
    expect(calls[0].text).toContain(grantItemToken('compost'));
    expect(calls[0].text).toContain('4');
    expect(calls[0].text).toContain('2');
  });
});

describe('farm_event_feedback: the cue arms', () => {
  const HARVEST: FarmEvent = {
    type: 'farmHarvested',
    pid: 1,
    bedId: 'eastbrook_1',
    cropId: 'vale_wheat',
    itemId: 'vale_wheat_produce',
    count: 3,
  };

  it('farmPlanted fires the plant cue EXACTLY once and never the harvest cue', () => {
    drive({ type: 'farmPlanted', pid: 1, bedId: 'eastbrook_1', cropId: 'vale_wheat' });
    expect(audioMock.farmPlant).toHaveBeenCalledTimes(1);
    expect(audioMock.farmHarvest).not.toHaveBeenCalled();
  });

  it('farmHarvested fires the harvest cue EXACTLY once and never the plant cue', () => {
    drive(HARVEST);
    expect(audioMock.farmHarvest).toHaveBeenCalledTimes(1);
    expect(audioMock.farmPlant).not.toHaveBeenCalled();
  });

  it('the extra harvest LINES do not each earn their own cue', () => {
    // A mixed harvest that also pays a seed back and spends the last tool
    // charge writes four surfaces; it is still ONE harvest, so still one cue.
    const calls = drive({
      ...HARVEST,
      count: 2,
      fineItemId: 'fine_vale_wheat',
      fineCount: 1,
      seedBackCount: 1,
      effectDepleted: true,
    });
    expect(calls.length).toBeGreaterThan(1);
    expect(audioMock.farmHarvest).toHaveBeenCalledTimes(1);
  });

  it('farmWithered SHARES the harvest cue: the same action resolved, unluckily', () => {
    drive({ type: 'farmWithered', pid: 1, bedId: 'high_1', cropId: 'highland_barley', count: 2 });
    expect(audioMock.farmHarvest).toHaveBeenCalledTimes(1);
    expect(audioMock.farmPlant).not.toHaveBeenCalled();
  });

  it('farmDenied and farmHusksConverted stay SILENT on every cue', () => {
    // The refusals already speak through the error toast, and the husk trade
    // is a menu conversion; a borrowed world-action cue on either is the bug
    // this negative arm exists to catch. The reason list is TYPE-FORCED
    // against the union in src/sim/types.ts (via the FarmDeniedReason
    // extract): a fifteenth reason is a tsc error here until its row joins,
    // so no refusal branch can ship outside this sweep (the Phase 7 QA
    // hand-maintenance finding).
    const REASON_ROWS: Record<FarmDeniedReason, true> = {
      bad_bed: true,
      bad_crop: true,
      range: true,
      bed_taken: true,
      skill: true,
      no_seed: true,
      not_ready: true,
      no_plot: true,
      no_husks: true,
      no_compost: true,
      no_fee_produce: true,
      no_tonic: true,
      tool: true,
      locked: true,
    };
    const reasons = Object.keys(REASON_ROWS) as FarmDeniedReason[];
    for (const reason of reasons) {
      // Each reason still produces its one toast: proof the loop actually
      // reached the arm rather than silently no-opping past it.
      expect(drive({ type: 'farmDenied', pid: 1, reason }), reason).toHaveLength(1);
    }
    drive({ type: 'farmHusksConverted', pid: 1, husks: 4, compost: 2 });
    expect(audioMock.farmPlant).not.toHaveBeenCalled();
    expect(audioMock.farmHarvest).not.toHaveBeenCalled();
    expect(audioMock.farmReady).not.toHaveBeenCalled();
  });
});

// The ready notice (the ready-notice phase). The sim emits ONE text-free,
// counts-only farmReady per sweep, so everything about how many surfaces
// light up, in which register, and which sentence each renders lives in the
// arm under test rather than in the event.
describe('farm_event_feedback: the ready notice', () => {
  const hasDigit = (text: string) => /\d/.test(text);

  it('a single ready plot: one ambient banner, one pale-green line, one cue', () => {
    const calls = drive({ type: 'farmReady', pid: 1, ready: 1 });
    expect(calls.map((c) => c.fn)).toEqual(['showBanner', 'log']);
    expect(calls[1].color).toBe('#c8f7c5');
    // The banner and the line say the SAME thing: the banner is the glance
    // and the log is the record, never two different claims about one event.
    expect(calls[0].text).toBe(calls[1].text);
    // Real localized copy, not a leaked key, and the singular branch: the
    // one-plot sentence names no number at all, so a code path that always
    // reached for the {count} sibling would render "1 crops" and fail here.
    expect(calls[0].text).not.toContain('hudChrome.');
    expect(hasDigit(calls[0].text)).toBe(false);
    expect(audioMock.farmReady).toHaveBeenCalledTimes(1);
    // Never a harvest sound: nothing was brought in, and borrowing the
    // harvest cue would tell the player a crop was collected without them.
    expect(audioMock.farmHarvest).not.toHaveBeenCalled();
    expect(audioMock.farmPlant).not.toHaveBeenCalled();
  });

  it('several ready plots take the counted sentence, formatted', () => {
    const calls = drive({ type: 'farmReady', pid: 1, ready: 4 });
    expect(calls.map((c) => c.fn)).toEqual(['showBanner', 'log']);
    expect(calls[1].text).toContain('4');
    // Decisively the OTHER branch from the arm above: same surfaces, a
    // different sentence.
    expect(calls[1].text).not.toBe(drive({ type: 'farmReady', pid: 1, ready: 1 })[1].text);
  });

  it('a mixed notice reports BOTH outcomes, ready first and withered in the miss register', () => {
    const calls = drive({ type: 'farmReady', pid: 1, ready: 2, withered: 1 });
    expect(calls.map((c) => c.fn)).toEqual(['showBanner', 'log', 'log']);
    // The banner leads with the actionable half; the failed crop is reported
    // honestly on its own grey line rather than folded into the ready count.
    expect(calls[0].text).toBe(calls[1].text);
    expect(calls[1].color).toBe('#c8f7c5');
    expect(calls[2].color).toBe('#a8a8a8');
    expect(calls[2].text).not.toBe(calls[1].text);
    expect(calls[1].text).toContain('2');
    // The withered line is the SAME sentence a withered-only notice leads
    // with, cross-checked against that arm rather than against a copy
    // literal, so the two paths can never drift into different wording.
    expect(calls[2].text).toBe(drive({ type: 'farmReady', pid: 1, ready: 0, withered: 1 })[0].text);
    // Still ONE cue for the whole event, however many halves it has.
    expect(audioMock.farmReady).toHaveBeenCalledTimes(2); // this arm drove twice
  });

  it('a withered-only notice banners the withered sentence and logs only the grey line', () => {
    const calls = drive({ type: 'farmReady', pid: 1, ready: 0, withered: 3 });
    expect(calls.map((c) => c.fn)).toEqual(['showBanner', 'log']);
    expect(calls[0].text).toBe(calls[1].text);
    expect(calls[1].color).toBe('#a8a8a8');
    expect(calls[1].text).toContain('3');
    // Its own plural split, proven the same way as the ready family's.
    expect(hasDigit(drive({ type: 'farmReady', pid: 1, ready: 0, withered: 1 })[0].text)).toBe(
      false,
    );
    expect(audioMock.farmReady).toHaveBeenCalledTimes(2); // this arm drove twice
  });

  it('an all-zero notice says nothing and makes no sound', () => {
    // Unreachable from this sim (the sweep returns early when nothing
    // transitioned), so it can only arrive from a stale or foreign server:
    // an empty banner and a bare "0" line would be worse than silence.
    expect(drive({ type: 'farmReady', pid: 1, ready: 0 })).toHaveLength(0);
    expect(drive({ type: 'farmReady', pid: 1, ready: 0, withered: 0 })).toHaveLength(0);
    expect(audioMock.farmReady).not.toHaveBeenCalled();
  });

  it('never writes the error or self-note surfaces', () => {
    // The notice is news, not a refusal and not floating combat text: a
    // future arm that reached for showError or showSelfNote would be
    // announcing the same event on a third surface.
    for (const ev of [
      { type: 'farmReady', pid: 1, ready: 1 },
      { type: 'farmReady', pid: 1, ready: 0, withered: 2 },
      { type: 'farmReady', pid: 1, ready: 2, withered: 2 },
    ] as const) {
      const fns = drive(ev).map((c) => c.fn);
      expect(fns).not.toContain('showError');
      expect(fns).not.toContain('showSelfNote');
    }
  });
});
