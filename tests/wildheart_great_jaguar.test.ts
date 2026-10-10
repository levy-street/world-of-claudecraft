// The Fanglord's Great Jaguar's Blender body in game (src/render/wildheart_basin/
// jaguar_model_core.ts, src/render/characters/wildheart_creature_looks.ts and
// stun_idle_core.ts): both shipped GLBs (the gold cat and its jade spirit) carry
// every clip the looks play, the cat draws at its authored size over the sim's
// scale, Heel!'s leap lands its forepaws on the bar's last frame, and a stunned
// body holds its dazed loop whatever stun laid it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VISUALS, visualKeyFor } from '../src/render/characters/manifest';
import { stunIdleClip } from '../src/render/characters/stun_idle_core';
import {
  BOND_CORD,
  braidRadius,
  cordPoint,
  cordSag,
} from '../src/render/wildheart_basin/bond_cord_core';
import {
  heelPounceTimeScale,
  JAGUAR_CLIP,
  JAGUAR_MODEL,
  JAGUAR_SIM_SCALE,
  jaguarBondAnchor,
  jaguarLookHeight,
} from '../src/render/wildheart_basin/jaguar_model_core';
import {
  AVATAR_LOOK,
  avatarFade,
  avatarGait,
  avatarGaitRate,
  turnToward,
} from '../src/render/wildheart_basin/zulgar_avatar_core';
import { MOBS } from '../src/sim/data';
import { BEAST_HEEL, BEAST_TUNING } from '../src/sim/encounters/wildheart_basin/ids';
import type { Entity } from '../src/sim/types';

interface GlbJson {
  animations: { name: string; samplers: { input: number }[] }[];
  accessors: { max?: number[] }[];
  materials: { name: string; alphaMode?: string; emissiveTexture?: unknown }[];
  images?: { mimeType?: string }[];
}

function glbJson(url: string): GlbJson {
  const buf = readFileSync(`public/${url}`);
  return JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12))) as GlbJson;
}

function clipLength(json: GlbJson, name: string): number {
  const a = json.animations.find((x) => x.name === name);
  if (!a) return 0;
  return Math.max(...a.samplers.map((s) => json.accessors[s.input].max?.[0] ?? 0));
}

const key = (templateId: string) => visualKeyFor({ kind: 'mob', templateId } as unknown as Entity);

describe('the Great Jaguar', () => {
  it('maps the Fanglord jaguar to its Blender body at its authored size', () => {
    expect(key('fanglord_jaguar')).toBe('wildheart_fanglord_jaguar');
    expect(MOBS.fanglord_jaguar.scale).toBe(JAGUAR_SIM_SCALE);
    const def = VISUALS.wildheart_fanglord_jaguar;
    expect(def.url).toBe(JAGUAR_MODEL.url);
    expect(def.height * JAGUAR_SIM_SCALE).toBeCloseTo(JAGUAR_MODEL.idleBoundsHeight, 6);
    expect(def.height).toBeCloseTo(jaguarLookHeight(), 6);
  });

  it('both bodies carry every clip the looks name', () => {
    for (const k of ['wildheart_fanglord_jaguar', 'wildheart_spirit_jaguar']) {
      const def = VISUALS[k];
      const json = glbJson(def.url);
      const c = def.clips;
      for (const clip of [
        c.idle,
        c.walk,
        c.run,
        c.death,
        c.cast,
        c.stunned,
        c.flourish,
        ...c.attack,
        ...(c.hit ?? []),
        ...Object.values(c.castByAbility ?? {}),
        ...Object.values(c.attackByAbility ?? {}),
      ])
        expect(clipLength(json, clip ?? ''), `${k} ${clip}`).toBeGreaterThan(0.5);
      expect((json.images ?? []).every((i) => i.mimeType === 'image/ktx2')).toBe(true);
    }
  });

  it("lands Heel!'s forepaws on the bar's last frame", () => {
    const c = VISUALS.wildheart_fanglord_jaguar.clips;
    expect(c.castByAbility?.[BEAST_HEEL]).toBe('Pounce');
    const rate = c.castTimeScaleByAbility?.[BEAST_HEEL] ?? 1;
    expect(rate).toBeCloseTo(heelPounceTimeScale(BEAST_TUNING.heelCast), 6);
    expect(BEAST_TUNING.heelCast * rate).toBeCloseTo(JAGUAR_CLIP.pounceLand, 6);
    expect(c.castPlayOut).toContain('Pounce');
  });

  it('the collar ring rides the nape, the bond cord tied there', () => {
    // The art-guide cat's plumed headdress sweeps back over its shoulders, so
    // the collar's ring sits under it on the nape: over the jaws, behind the
    // muzzle, ahead of the forelegs, under the plumes' top.
    const a = jaguarBondAnchor(JAGUAR_SIM_SCALE);
    expect(a.up).toBeGreaterThan(JAGUAR_MODEL.mouth.up);
    expect(a.up).toBeLessThan(JAGUAR_MODEL.withers);
    expect(a.forward).toBeGreaterThan(JAGUAR_MODEL.forePaw.z);
    expect(a.forward).toBeLessThan(JAGUAR_MODEL.mouth.forward);
  });

  it('the Whistle spirit is the jade variant, translucent and self-lit', () => {
    expect(key('guardian_fanglords_spirit_jaguar')).toBeDefined();
    const def = VISUALS.wildheart_spirit_jaguar;
    expect(def.url).toBe(JAGUAR_MODEL.spiritUrl);
    const json = glbJson(def.url);
    expect(json.materials).toHaveLength(1);
    expect(json.materials[0].alphaMode).toBe('BLEND');
    expect(json.materials[0].emissiveTexture).toBeDefined();
  });
});

describe('the dazed loop', () => {
  it('any stun or incapacitate holds it, whatever ability laid it', () => {
    expect(stunIdleClip('Stunned', [{ kind: 'stun', remaining: 1.2 }])).toBe('Stunned');
    expect(stunIdleClip('Stunned', [{ kind: 'buff_dr' }, { kind: 'incapacitate' }])).toBe(
      'Stunned',
    );
  });

  it('nothing else, nor a spent stun, nor a rig without the loop', () => {
    expect(stunIdleClip('Stunned', [{ kind: 'root', remaining: 2 }])).toBeNull();
    expect(stunIdleClip('Stunned', [{ kind: 'stun', remaining: 0 }])).toBeNull();
    expect(stunIdleClip(undefined, [{ kind: 'stun', remaining: 2 }])).toBeNull();
    expect(stunIdleClip('Stunned', [])).toBeNull();
    expect(stunIdleClip('Stunned', undefined)).toBeNull();
  });
});

describe("Zulgar's Jaguar Avatar", () => {
  it('fades in with the hunt and out after it', () => {
    let f = 0;
    for (let i = 0; i < 20; i++) f = avatarFade(f, true, 0.05);
    expect(f).toBe(1);
    f = avatarFade(f, false, AVATAR_LOOK.fadeOut / 2);
    expect(f).toBeCloseTo(0.5, 6);
    expect(avatarFade(0, false, 1)).toBe(0);
  });

  it('runs at his hunting pace with its paws planted, idles when he stands', () => {
    expect(avatarGait(0)).toBe('Idle');
    expect(avatarGait(2.5)).toBe('Walk');
    const pace = 7 * 1.1;
    expect(avatarGait(pace)).toBe('Run');
    const rate = avatarGaitRate('Run', pace);
    expect(rate).toBeGreaterThanOrEqual(0.6);
    expect(rate).toBeLessThan(1);
  });

  it('turns the short way round', () => {
    expect(turnToward(3, -3, 10)).toBe(-3);
    expect(turnToward(3, -3, 0.1)).toBeCloseTo(3.1, 6);
    expect(turnToward(0, 1, 0.25)).toBeCloseTo(0.25, 6);
  });
});

describe('the Pack Bond cord', () => {
  it('hangs a little, tauter as they close, pinched at both ends', () => {
    expect(cordSag(10, 1)).toBeLessThan(cordSag(10, 0));
    expect(cordSag(10, 0.5)).toBeGreaterThan(0);
    expect(braidRadius(0, 1)).toBe(0);
    expect(braidRadius(1, 1)).toBeCloseTo(0, 6);
    expect(braidRadius(0.5, 1)).toBeCloseTo(BOND_CORD.braid, 6);
    expect(braidRadius(0.5, 0)).toBeLessThan(braidRadius(0.5, 1));
  });

  it('runs from end to end, lowest in the middle', () => {
    const a = { x: 0, y: 4, z: 0 };
    const b = { x: 10, y: 4, z: 0 };
    const out = { x: 0, y: 0, z: 0 };
    expect(cordPoint(a, b, 0, 1, out)).toEqual({ x: 0, y: 4, z: 0 });
    expect(cordPoint(a, b, 1, 1, out).x).toBe(10);
    expect(cordPoint(a, b, 0.5, 1, out).y).toBeCloseTo(3, 6);
  });
});
