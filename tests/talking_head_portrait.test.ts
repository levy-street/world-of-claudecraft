// @vitest-environment happy-dom
// The talking-head panel's portrait: an NPC speaker shows its OWN face (the live
// headshot a target frame draws for it, nonplayer_portrait_core.ts), the crest while
// that face is still owed, and the face once its capture lands. The panel paints once
// per speaker, so three things keep it from being stuck on the crest: the landing
// repaints it, a capture that failed silently is asked for again with the next line,
// and an ask made before portraits were paintable is repeated when they are. A face
// that has landed is never repainted, and the empty panel goes back to the crest.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const crestCanvas = {} as HTMLCanvasElement;
// Additive, never bare: only iconCanvas is stubbed (the procedural crest needs a real 2D context).
vi.mock('../src/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icons')>()),
  iconCanvas: vi.fn(() => crestCanvas),
}));
// The 3D portrait pipeline starts real GLB loads under happy-dom (tests/talking_head.test.ts
// has the long form); the lane is stubbed and the test drives its two listeners by hand.
vi.mock('../src/render/characters/portrait', () => ({
  cachedPortraitDataUrl: vi.fn(() => null),
  modularPortraitDataUrl: vi.fn(() => null),
  onPortraitsReady: vi.fn(),
  onPortraitUpdate: vi.fn(),
  playerPortraitDataUrl: vi.fn(() => null),
  portraitsReady: vi.fn(() => false),
  visualPortraitDataUrl: vi.fn(() => null),
}));

import { npcPortraitSourceFor } from '../src/render/characters/manifest';
import {
  onPortraitsReady,
  onPortraitUpdate,
  portraitsReady,
  visualPortraitDataUrl,
} from '../src/render/characters/portrait';
import { TalkingHeadController } from '../src/ui/hud/talking_head';

/** The tutorial coach, the panel's one speaker today: a druid on the male body. */
const ODO = 'ferryman_odo';
/** Another NPC on that same body, wearing a different head. */
const MARLOW = 'cook_marlow';
const BODY = 'player_druid';
const ODO_FACE = 'data:image/png;base64,ODO';
const MARLOW_FACE = 'data:image/png;base64,MARLOW';
const CREST_URL = '/ui/crests/status/npc.webp';

class FakeImage {
  complete = false;
  naturalWidth = 0;
  addEventListener(): void {}
  set src(_url: string) {}
}

const line = (speakerId: string) => ({ speakerId, speakerName: 'Speaker', text: 'A line.' });
const portraitOf = (): HTMLCanvasElement =>
  document.querySelector('canvas.th-portrait') as HTMLCanvasElement;
const landed = () => vi.mocked(onPortraitUpdate).mock.calls[0][0];
const asks = (): number => vi.mocked(visualPortraitDataUrl).mock.calls.length;
/** The lane answers each head with its own face once `ready` names it. */
const laneHolds = (...ready: string[]): void => {
  vi.mocked(visualPortraitDataUrl).mockImplementation((_key, _skin, _framing, head) => {
    if (ready.includes(ODO) && head === npcPortraitSourceFor(ODO, 'npc')?.head) return ODO_FACE;
    if (ready.includes(MARLOW) && head === npcPortraitSourceFor(MARLOW, 'npc')?.head)
      return MARLOW_FACE;
    return null;
  });
};

describe('TalkingHeadController portrait', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="ui"></div>';
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as never);
    vi.mocked(visualPortraitDataUrl).mockReset().mockReturnValue(null);
    vi.mocked(portraitsReady).mockReset().mockReturnValue(false);
    vi.mocked(onPortraitUpdate).mockClear();
    vi.mocked(onPortraitsReady).mockClear();
  });

  it("asks for the speaker's own face on its class body and holds the crest meanwhile", () => {
    const face = npcPortraitSourceFor(ODO, 'npc');
    expect(face?.visualKey).toBe(BODY);
    new TalkingHeadController(() => 0).say(line(ODO));
    expect(visualPortraitDataUrl).toHaveBeenCalledWith(BODY, 0, 'headshot', face?.head);
    expect(portraitOf().dataset.portrait).toBe(CREST_URL);
  });

  it('repaints with the face when the capture it waits on lands', () => {
    new TalkingHeadController(() => 0).say(line(ODO));
    laneHolds(ODO);
    landed()(BODY, 0);
    expect(portraitOf().dataset.portrait).toBe(ODO_FACE);
  });

  it('ignores a capture that is not its speaker: another body, another skin, a composed key', () => {
    new TalkingHeadController(() => 0).say(line(ODO));
    laneHolds(ODO);
    const before = asks();
    landed()('player_mage', 0);
    landed()(BODY, 2);
    landed()(BODY, 0, `${BODY}:mod:someone`);
    expect(asks()).toBe(before);
    expect(portraitOf().dataset.portrait).toBe(CREST_URL);
  });

  it('asks again once portraits become paintable (a line can arrive before the files)', () => {
    new TalkingHeadController(() => 0).say(line(ODO));
    const ready = vi.mocked(onPortraitsReady).mock.calls[0][0];
    laneHolds(ODO);
    ready();
    expect(portraitOf().dataset.portrait).toBe(ODO_FACE);
  });

  it('waits on no readiness signal when portraits are already paintable', () => {
    vi.mocked(portraitsReady).mockReturnValue(true);
    new TalkingHeadController(() => 0).say(line(ODO));
    expect(onPortraitsReady).not.toHaveBeenCalled();
    // one ask, not a second one from a readiness callback that fires at once
    expect(asks()).toBe(1);
    expect(onPortraitUpdate).toHaveBeenCalledTimes(1);
  });

  it('asks again with the next line while the face is still owed (a failed capture reports nothing)', () => {
    const c = new TalkingHeadController(() => 0);
    c.say(line(ODO));
    expect(portraitOf().dataset.portrait).toBe(CREST_URL);
    // no update ever fires; the lane simply has the face by the time the next line comes
    laneHolds(ODO);
    c.say(line(ODO));
    expect(portraitOf().dataset.portrait).toBe(ODO_FACE);
  });

  it('never repaints a face that has landed: not on a later capture, not on the next line', () => {
    laneHolds(ODO);
    const c = new TalkingHeadController(() => 0);
    c.say(line(ODO));
    expect(portraitOf().dataset.portrait).toBe(ODO_FACE);
    const before = asks();
    landed()(BODY, 0);
    c.say(line(ODO));
    expect(asks()).toBe(before);
  });

  it('follows a speaker change made while a capture runs: the landing paints the new speaker', () => {
    const c = new TalkingHeadController(() => 0);
    c.say(line(ODO));
    c.say(line(MARLOW));
    // Odo's capture lands on the body both wear; the panel holds Marlow now
    laneHolds(ODO);
    landed()(BODY, 0);
    expect(visualPortraitDataUrl).toHaveBeenLastCalledWith(
      BODY,
      0,
      'headshot',
      npcPortraitSourceFor(MARLOW, 'npc')?.head,
    );
    expect(portraitOf().dataset.portrait).toBe(CREST_URL);
    laneHolds(ODO, MARLOW);
    landed()(BODY, 0);
    expect(portraitOf().dataset.portrait).toBe(MARLOW_FACE);
  });

  it('forgets its speaker with its line: the empty panel is back on the crest, and asks anew', () => {
    laneHolds(ODO);
    const c = new TalkingHeadController(() => 0);
    c.say(line(ODO));
    expect(portraitOf().dataset.portrait).toBe(ODO_FACE);
    c.hide();
    // Unlock Interface shows the hidden frame: no face may be left in it
    expect(portraitOf().dataset.portrait).toBe(CREST_URL);
    const before = asks();
    // a capture landing for the forgotten speaker repaints nothing
    landed()(BODY, 0);
    expect(asks()).toBe(before);
    expect(portraitOf().dataset.portrait).toBe(CREST_URL);
    c.say(line(ODO));
    expect(asks()).toBe(before + 1);
    expect(portraitOf().dataset.portrait).toBe(ODO_FACE);
    // and the whole exchange subscribed once
    expect(onPortraitUpdate).toHaveBeenCalledTimes(1);
  });

  it('draws the crest for a speaker with no authored look, and waits on nothing', () => {
    new TalkingHeadController(() => 0).say(line('no_such_speaker'));
    expect(visualPortraitDataUrl).not.toHaveBeenCalled();
    expect(onPortraitUpdate).not.toHaveBeenCalled();
    expect(portraitOf().dataset.portrait).toBe(CREST_URL);
  });
});
