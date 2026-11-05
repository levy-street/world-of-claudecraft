// The Masterless Strength's own model (phase 2O): the GLB, its wiring in the
// character manifest, and the pure plan of its element bodies and its
// transformation (src/render/smith_heart_fx/final_body_core.ts).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import {
  MASTERLESS_STRENGTH_CLIPS,
  MASTERLESS_STRENGTH_URL,
  SMITH_HEART_BOSS_LOOKS,
} from '../src/render/characters/smith_heart_boss_looks';
import { SMITH_HEART_PLACEHOLDER_LOOKS } from '../src/render/characters/smith_heart_placeholder_looks';
import {
  boltJoint,
  FINAL_BODY_CLIP,
  FINAL_BODY_ELEMENTS,
  FINAL_BODY_GESTURES,
  FINAL_BODY_HEIGHT,
  FINAL_BODY_NODES,
  FINAL_ELEMENT_LOOK,
  FINAL_SHIFT,
  finalBodyElement,
  finalBodyPoint,
  finalShiftAura,
  finalShiftStage,
  finalShiftStarts,
} from '../src/render/smith_heart_fx/final_body_core';
import { FORGE_FIST_CUE } from '../src/render/smith_heart_fx/final_fx_core';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { FINAL_BOSS, FINAL_CASTS } from '../src/sim/encounters/smith_heart/final_ids';

function glbJson(rel: string): {
  nodes: { name?: string; mesh?: number; skin?: number }[];
  animations: { name: string }[];
  extensionsRequired?: string[];
  images?: { mimeType?: string }[];
} {
  const buf = readFileSync(`public/${rel}`);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

describe('the Masterless Strength model', () => {
  const key = SMITH_HEART_PLACEHOLDER_LOOKS[FINAL_BOSS];
  const def = VISUALS[key];

  it('replaces the borrowed bodyless colossus with its own rigged body', () => {
    expect(key).toBe('smith_heart_masterless_strength');
    expect(def).toBe(SMITH_HEART_BOSS_LOOKS.smith_heart_masterless_strength);
    expect(def.url).toBe(MASTERLESS_STRENGTH_URL);
    expect(def.bodyless).toBeFalsy();
    expect(VISUALS.smith_heart_colossus).toBeUndefined();
    // Drawn where the colossus stood: its height times the boss's scale.
    expect(def.height).toBe(FINAL_BODY_HEIGHT);
    expect(FINAL_BODY_HEIGHT * SMITH_HEART_MOBS[FINAL_BOSS].scale).toBeGreaterThan(18);
    const boss = { kind: 'mob', templateId: FINAL_BOSS } as Parameters<typeof visualKeyFor>[0];
    expect(visualKeyFor(boss)).toBe(key);
  });

  it('ships every clip it binds, KTX2 textures, and the four element bodies', () => {
    const json = glbJson(MASTERLESS_STRENGTH_URL);
    const names = json.animations.map((a) => a.name).sort();
    expect(names).toEqual([...MASTERLESS_STRENGTH_CLIPS].sort());
    const c = def.clips;
    const bound = [
      c.idle,
      c.walk,
      c.run,
      ...c.attack,
      c.death,
      ...(c.hit ?? []),
      c.cast ?? '',
      ...Object.values(c.attackByAbility ?? {}),
      ...Object.values(c.castByAbility ?? {}),
      ...Object.values(def.phaseClips ?? {}).flatMap((p) => [p.clips.idle, p.enter ?? c.idle]),
    ];
    for (const clip of bound) expect(names, clip).toContain(clip);
    expect(json.extensionsRequired).toContain('KHR_texture_basisu');
    expect((json.images ?? []).every((i) => i.mimeType === 'image/ktx2')).toBe(true);
    const meshNodes = json.nodes.filter((n) => n.mesh !== undefined).map((n) => n.name);
    for (const el of FINAL_BODY_ELEMENTS)
      for (const node of FINAL_BODY_NODES[el]) expect(meshNodes, node).toContain(node);
    for (const n of json.nodes.filter((x) => x.mesh !== undefined)) expect(n.skin).toBeDefined();
  });

  it('plays its own clip for every bar and the frontal, timed to the bar end', () => {
    const c = def.clips;
    expect(c.attackByAbility?.[FORGE_FIST_CUE]).toBe('Slam');
    expect(c.attackByAbility?.[FINAL_BODY_GESTURES.shift]).toBe('Shift');
    for (const id of [FINAL_CASTS.fist, FINAL_CASTS.anvil])
      expect(c.castByAbility?.[id]).toBe('Wrath');
    expect(c.castByAbility?.[FINAL_CASTS.bolt]).toBe('Pour');
    expect(def.castClipSync).toEqual(
      expect.arrayContaining([FINAL_CASTS.fist, FINAL_CASTS.anvil, FINAL_CASTS.bolt]),
    );
    // Basalt Fist's 3 s bar: the slam's beat lands on its end.
    expect(c.castTimeScaleByAbility?.[FINAL_CASTS.fist]).toBeCloseTo(FINAL_BODY_CLIP.wrath / 3, 6);
  });

  it('binds one show and one hide gesture per element body, and the whole model', () => {
    const toggles = def.meshToggles ?? [];
    expect(toggles[0]).toMatchObject({
      nodes: ['*'],
      hideNow: FINAL_BODY_GESTURES.hide,
      showNow: FINAL_BODY_GESTURES.show,
    });
    for (const el of FINAL_BODY_ELEMENTS) {
      const t = toggles.find((x) => x.showNow === FINAL_BODY_GESTURES.on[el]);
      expect(t?.hideNow).toBe(FINAL_BODY_GESTURES.off[el]);
      expect(t?.nodes).toEqual(FINAL_BODY_NODES[el]);
    }
    const all = [
      FINAL_BODY_GESTURES.hide,
      FINAL_BODY_GESTURES.show,
      FINAL_BODY_GESTURES.shift,
      FINAL_BODY_GESTURES.charge,
      FINAL_BODY_GESTURES.kneel,
      FINAL_BODY_GESTURES.stand,
      ...Object.values(FINAL_BODY_GESTURES.on),
      ...Object.values(FINAL_BODY_GESTURES.off),
    ];
    expect(new Set(all).size).toBe(all.length);
    expect(def.glowPulses?.pulses[0].gesture).toBe(FINAL_BODY_GESTURES.charge);
    expect(def.phaseClips?.[FINAL_BODY_GESTURES.kneel]?.clips.idle).toBe('KneelIdle');
    expect(def.phaseClips?.[FINAL_BODY_GESTURES.stand]?.clips).toBe(def.clips);
  });
});

describe('the element bodies and the transformation (final_body_core)', () => {
  it('wears its quarter, the Hammer basalt in the ring', () => {
    expect(finalBodyElement('heat')).toBe('heat');
    expect(finalBodyElement('quench')).toBe('quench');
    expect(finalBodyElement('breath')).toBe('breath');
    expect(finalBodyElement('hammer')).toBe('hammer');
    expect(finalBodyElement('ring')).toBe('hammer');
  });

  it('transforms only between two elements of a body seen whole', () => {
    expect(finalShiftStarts('hammer', 'heat', true)).toBe(true);
    expect(finalShiftStarts('heat', 'heat', true)).toBe(false);
    expect(finalShiftStarts(null, 'heat', true)).toBe(false);
    expect(finalShiftStarts('hammer', 'heat', false)).toBe(false);
  });

  it('runs charge, burst, crown, settle in order and bursts on the roar', () => {
    expect(FINAL_SHIFT.burst).toBeCloseTo(FINAL_BODY_CLIP.shiftBurst, 6);
    expect(finalShiftStage(0.1).stage).toBe('charge');
    expect(finalShiftStage(FINAL_SHIFT.burst + 0.05).stage).toBe('burst');
    expect(finalShiftStage(FINAL_SHIFT.burst + 0.3).stage).toBe('crown');
    expect(finalShiftStage(FINAL_SHIFT.crownEnd + 0.1).stage).toBe('settle');
    expect(finalShiftStage(FINAL_SHIFT.settleEnd + 0.1).stage).toBe('done');
    // The old aura dies through the charge; the new one floods in hot, then settles.
    expect(finalShiftAura(0)).toEqual([1, 0]);
    const [oldK, hot] = finalShiftAura(FINAL_SHIFT.burst + 0.01);
    expect(oldK).toBe(0);
    expect(hot).toBeGreaterThan(2);
    expect(finalShiftAura(FINAL_SHIFT.settleEnd)).toEqual([0, 1]);
  });

  it('keeps the storm and the cold apart: arcs are the Breath alone', () => {
    expect(FINAL_ELEMENT_LOOK.breath.bolts).toBe(true);
    expect(FINAL_ELEMENT_LOOK.quench.bolts).toBe(false);
    expect(FINAL_ELEMENT_LOOK.breath.light).not.toBe(FINAL_ELEMENT_LOOK.quench.light);
    const lights = FINAL_BODY_ELEMENTS.map((e) => FINAL_ELEMENT_LOOK[e].light);
    expect(new Set(lights).size).toBe(4);
  });

  it('places anchors in the body frame (forward, left, up) at any facing', () => {
    const out = { x: 0, y: 0, z: 0 };
    // Facing +z: the heart is ahead (+z) and up; the left shoulder is +x.
    finalBodyPoint('heart', 0, 0, 0, 0, 20, out);
    expect(out.z).toBeGreaterThan(0);
    expect(out.y).toBeCloseTo(20 * 0.69, 6);
    finalBodyPoint('shoulderL', 0, 0, 0, 0, 20, out);
    expect(out.x).toBeGreaterThan(0);
    // Facing +x: the heart is ahead on +x.
    finalBodyPoint('heart', 10, 1, 5, Math.PI / 2, 20, out);
    expect(out.x).toBeGreaterThan(10);
    expect(out.z).toBeCloseTo(5, 6);
  });

  it('draws a bolt whose ends are its endpoints', () => {
    const o = { x: 0, y: 0, z: 0 };
    boltJoint(0, 0, 0, 10, 2, 0, 0, 7, 3.3, 2, o);
    expect([o.x, o.y, o.z]).toEqual([0, 0, 0]);
    boltJoint(0, 0, 0, 10, 2, 0, 7, 7, 3.3, 2, o);
    expect(o.x).toBeCloseTo(10, 6);
    expect(o.y).toBeCloseTo(2, 6);
  });
});
