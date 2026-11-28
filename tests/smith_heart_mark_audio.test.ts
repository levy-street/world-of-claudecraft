// The Smith's Heart's shared sound seams: the personal marks heard in the
// marked player's ear (src/game/smith_heart_mark_audio.ts), the one claim
// every fight's cues share against the HUD's generic sounds
// (src/game/smith_heart_audio_claims.ts), the voices kept back for a mechanic
// in a busy raid (src/game/sfx.ts voiceCapFor), and the catalog's two
// families: every warning prompt asks for no hit, every take ships.

import { describe, expect, it } from 'vitest';
import { SMITH_HEART_MECHANIC_SFX } from '../scripts/sfx/smith_heart_mechanic_sfx.mjs';
import { PRIORITY_VOICE_HEADROOM, voiceCapFor } from '../src/game/sfx';
import { SFX_CLIPS } from '../src/game/sfx_manifest.generated';
import { smithHeartSoundClaims } from '../src/game/smith_heart_audio_claims';
import {
  HEART_MARK,
  HeartMarkEar,
  type HeartMarkSink,
  markMask,
  markSound,
} from '../src/game/smith_heart_mark_audio';
import { BREATH_CUES } from '../src/sim/encounters/smith_heart/breath_ids';
import { COUNCIL_CUES } from '../src/sim/encounters/smith_heart/council_ids';
import { FINAL_CUES } from '../src/sim/encounters/smith_heart/final_ids';
import { HEAT_CUES } from '../src/sim/encounters/smith_heart/heat_ids';
import { QUENCH_CUES } from '../src/sim/encounters/smith_heart/quench_ids';
import type { Entity } from '../src/sim/types';

describe('smith_heart_mark_audio', () => {
  it('reads a bit per mark, and hears each arrive once in my ear', () => {
    const ids = ['a', 'b'];
    expect(markMask(ids, [{ id: 'b' }, { id: 'x' }])).toBe(0b10);
    expect(markMask(ids, [])).toBe(0);
    const plays: { key: string; rate?: number; priority?: boolean }[] = [];
    const sink: HeartMarkSink = {
      playAt: (key, _x, _y, _z, o) => {
        plays.push({ key, rate: o?.rate, priority: o?.priority });
        return true;
      },
    };
    const ear = new HeartMarkEar({ a: HEART_MARK.stone, b: markSound(HEART_MARK.stone, 1, 0.8) });
    const me = (...auras: string[]) =>
      ({
        pos: { x: 0, y: 0, z: 0 },
        dead: false,
        auras: auras.map((id) => ({ id })),
      }) as unknown as Entity;
    ear.update(me(), sink);
    ear.update(me('a'), sink);
    ear.update(me('a'), sink);
    ear.update(me('a', 'b'), sink);
    ear.update(null, sink);
    ear.update(me('a'), sink);
    expect(plays.map((p) => p.rate)).toEqual([1, 0.8, 1]);
    for (const p of plays) expect(p.priority).toBe(true);
    expect(ear.keys()).toEqual(['heart_mark_stone', 'heart_mark_stone']);
  });
});

describe('smith_heart_audio_claims', () => {
  it("claims every fight's cues and nothing else", () => {
    for (const cue of [
      COUNCIL_CUES.rushWindup,
      BREATH_CUES.knotBurst,
      QUENCH_CUES.cross,
      HEAT_CUES.ignite,
      FINAL_CUES.anvil,
    ])
      expect(smithHeartSoundClaims(cue), cue).toBe(true);
    expect(smithHeartSoundClaims('frost_nova')).toBe(false);
    expect(smithHeartSoundClaims(undefined)).toBe(false);
  });
});

describe('the priority voices', () => {
  it('keep a bounded headroom past the ordinary cap for a mechanic cue', () => {
    expect(PRIORITY_VOICE_HEADROOM).toBeGreaterThan(0);
    expect(voiceCapFor(true)).toBe(voiceCapFor(false) + PRIORITY_VOICE_HEADROOM);
    expect(voiceCapFor(undefined)).toBe(voiceCapFor(false));
  });
});

describe('smith_heart_mechanic_sfx', () => {
  it('ships every take, and keeps the warnings and the impacts two families', () => {
    let warnings = 0;
    let impacts = 0;
    for (const e of SMITH_HEART_MECHANIC_SFX) {
      expect(Object.hasOwn(SFX_CLIPS, e.key), `${e.key} in the manifest`).toBe(true);
      expect(e.key.startsWith('heart_'), e.key).toBe(true);
      expect(e.prompt).toMatch(/No music, no voice\.$/);
      // A warning swells (never authored as a single hit); an impact is one event.
      if (/_(warn|windup|charge|fuse|strain|build|rising)$|^heart_mark_/.test(e.key)) {
        warnings++;
        expect(e.prompt, e.key).not.toMatch(/Single event\./);
      }
      if (/_(burst|fall|land|impact|erupt|shock)$/.test(e.key)) {
        impacts++;
        expect(e.prompt, e.key).toMatch(/Single event\./);
      }
    }
    expect(warnings).toBeGreaterThanOrEqual(15);
    expect(impacts).toBeGreaterThanOrEqual(10);
  });
});
