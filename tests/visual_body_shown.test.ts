// @vitest-environment happy-dom
// CharacterVisual.bodyShown: whether the body draws now. The launcher turntable takes its
// loading silhouette off on it (CharacterPreview.subjectDrawn), so it must read false for
// exactly as long as a WOC body waits on its head (a whole-look head keeps the body hidden
// until every piece of its look hangs) and true once the head is live, or once a file of it
// failed (the wait ends then and the body draws without that piece). Driven through a REAL
// visual on the fixture WOC body (tests/helpers/woc_visual_harness.ts).
import { afterEach, describe, expect, it } from 'vitest';
import { IDLE, KEY, releaseWocVisualHarness, wocVisualHarness } from './helpers/woc_visual_harness';

const QUIFF = 'models/chars/players/woc/head_type_a_hair_quiff.glb';

afterEach(() => {
  releaseWocVisualHarness();
});

describe('CharacterVisual.bodyShown', () => {
  it('reads false while the head streams, true the frame it goes live', async () => {
    const h = await wocVisualHarness({ headPack: true, held: [QUIFF] });
    const v = new h.CharacterVisual(KEY, 0xffffff, 0);
    const wrap = v.root.getObjectByName('character_model_wrap');
    v.setWocHeadLook({ ...h.DEFAULT_APPEARANCE, headHair: 'quiff' });
    // before its first frame (the rig's own visibility is not settled yet): waiting on its head
    expect(v.bodyShown).toBe(false);
    v.update(0.05, IDLE, true);
    // the hairstyle is still on the wire: no head, no body, and the getter agrees
    expect(wrap?.visible).toBe(false);
    expect(v.bodyShown).toBe(false);
    h.releases.get(QUIFF)?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 40 && !v.bodyShown; i++) {
      v.update(0.05, IDLE, true);
      await Promise.resolve();
    }
    expect(v.wocHeadLook?.look.hair).toBe('quiff');
    expect(wrap?.visible).toBe(true);
    expect(v.bodyShown).toBe(true);
    v.dispose();
  }, 60000);

  it('reads true once a head file failed: the wait ends and the body draws without it', async () => {
    const h = await wocVisualHarness({ headPack: true, failed: [QUIFF] });
    const v = new h.CharacterVisual(KEY, 0xffffff, 0);
    const wrap = v.root.getObjectByName('character_model_wrap');
    v.setWocHeadLook({ ...h.DEFAULT_APPEARANCE, headHair: 'quiff' });
    for (let i = 0; i < 40 && !v.bodyShown; i++) {
      v.update(0.05, IDLE, true);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(wrap?.visible).toBe(true);
    expect(v.bodyShown).toBe(true);
    v.dispose();
  }, 60000);

  it('reads true at once for a body whose head look is resident at build', async () => {
    const h = await wocVisualHarness({ headPack: true });
    const v = new h.CharacterVisual(KEY, 0xffffff, 0);
    v.update(0.05, IDLE, true);
    expect(v.bodyShown).toBe(true);
    v.dispose();
  }, 60000);
});
