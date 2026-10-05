// Pointing the shared turntable at a subject (src/ui/preview_subject.ts): the
// precedence the world applies (composed look, then an explicit key, then the
// class rig), the mech's borrowed hand layout, the worn set a WOC body dresses
// from, and whose character the stage shows (the armor detail its body is built
// at). Driven through a recording fake so the order the HUD used to spell inline
// is the order the module keeps.
import { describe, expect, it } from 'vitest';
import { mechHeldWeaponOverride } from '../src/render/characters/manifest';
import { DEFAULT_APPEARANCE } from '../src/render/characters/modular';
import {
  applyPreviewSubject,
  type PreviewSubject,
  type PreviewSubjectTarget,
  previewStageSurface,
  wocPreviewKey,
} from '../src/ui/preview_subject';

function recorder(): PreviewSubjectTarget & { calls: [string, ...unknown[]][] } {
  const calls: [string, ...unknown[]][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  return {
    calls,
    setModular: record('setModular'),
    setVisualKey: record('setVisualKey'),
    setClass: record('setClass'),
    setSkin: record('setSkin'),
    setWeaponSkin: record('setWeaponSkin'),
    setWocEquipment: record('setWocEquipment'),
    setFraming: record('setFraming'),
    setWocAppearance: record('setWocAppearance'),
    setArmorSurface: record('setArmorSurface'),
  };
}

/** The calls that mount the subject: everything after the stage was told what it shows. */
const mounted = (p: { calls: [string, ...unknown[]][] }) =>
  p.calls.filter(([name]) => name !== 'setArmorSurface');

const base: PreviewSubject = {
  cls: 'warrior',
  skin: 2,
  mainhand: 'worn_sword',
  offhand: null,
  weaponSkinId: null,
  framing: 'sheet',
};

describe('applyPreviewSubject', () => {
  it('mounts the plain class rig with no look or key, then skin, weapon skin, framing', () => {
    // No worn set supplied: the body keeps its assembly default (the full kit),
    // so no dressing call is made at all (an inspect stage that forwards
    // nothing must never strip a peer bare).
    const p = recorder();
    applyPreviewSubject(p, base);
    expect(p.calls).toEqual([
      ['setArmorSurface', 'own'],
      ['setClass', 'warrior', 'worn_sword', null],
      ['setSkin', 2],
      ['setWeaponSkin', null],
      ['setFraming', 'sheet'],
    ]);
  });

  it('dresses bare on an EXPLICIT empty worn set, distinct from an absent one', () => {
    const p = recorder();
    applyPreviewSubject(p, { ...base, wornEquipment: {} });
    expect(p.calls).toContainEqual(['setWocEquipment', {}, false]);
    const q = recorder();
    applyPreviewSubject(q, { ...base, wornEquipment: null });
    expect(q.calls).toContainEqual(['setWocEquipment', null, false]);
  });

  it('lets a composed look win over an explicit key', () => {
    const p = recorder();
    const look = { app: DEFAULT_APPEARANCE, worn: { head: 'knight' } } as never;
    applyPreviewSubject(p, { ...base, cls: 'mage', look, previewKey: 'player_mech' });
    expect(mounted(p)[0]).toEqual([
      'setModular',
      DEFAULT_APPEARANCE,
      { head: 'knight' },
      'mage',
      'worn_sword',
      null,
    ]);
    expect(p.calls.some(([name]) => name === 'setVisualKey' || name === 'setClass')).toBe(false);
  });

  it('mounts an explicit key, borrowing the wearer class hand layout only for the mech', () => {
    const p = recorder();
    applyPreviewSubject(p, { ...base, cls: 'rogue', previewKey: 'player_mech' });
    expect(mounted(p)[0]).toEqual([
      'setVisualKey',
      'player_mech',
      'worn_sword',
      mechHeldWeaponOverride('rogue'),
      null,
    ]);
    const q = recorder();
    applyPreviewSubject(q, { ...base, previewKey: 'player_paladin' });
    expect(mounted(q)[0]).toEqual(['setVisualKey', 'player_paladin', 'worn_sword', null, null]);
  });

  it('forwards the worn set and helm bit a WOC body dresses from', () => {
    const p = recorder();
    const wornEquipment = { helmet: 'mistveil_cord', chest: 'worn_mail' };
    applyPreviewSubject(p, { ...base, wornEquipment, helmHidden: true, weaponSkinId: 'skin_x' });
    expect(p.calls).toContainEqual(['setWocEquipment', wornEquipment, true]);
    expect(p.calls).toContainEqual(['setWeaponSkin', 'skin_x']);
  });
});

describe('wocPreviewKey', () => {
  const classes = [
    'warrior',
    'paladin',
    'hunter',
    'rogue',
    'mage',
    'priest',
    'warlock',
    'druid',
    'shaman',
  ] as const;

  it.each(classes)('selects the female %s body for an explicit female appearance', (cls) => {
    expect(wocPreviewKey(cls, { gender: 'female' })).toBe(`player_${cls}_female`);
  });

  it.each(classes)('keeps the default %s body for male, absent, or invalid appearances', (cls) => {
    for (const appearance of [undefined, null, {}, { gender: 'male' }, { gender: 'FEMALE' }]) {
      expect(wocPreviewKey(cls, appearance)).toBe(`player_${cls}`);
    }
  });
});

describe('a WOC body on a keyed stage wears its stored look', () => {
  it('hands the look over BEFORE the mount, so a rebuilt body picks it up as it is built', () => {
    const t = recorder();
    const app = { gender: 'female', headHair: 'curls' } as never;
    applyPreviewSubject(t, { ...base, previewKey: 'player_warrior_female', wocAppearance: app });
    const names = t.calls.map((c) => c[0]);
    expect(names.indexOf('setWocAppearance')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('setWocAppearance')).toBeLessThan(names.indexOf('setVisualKey'));
    expect(t.calls.find((c) => c[0] === 'setWocAppearance')?.[1]).toBe(app);
  });

  it('leaves the stage alone when no look is given, and when a composed look wins', () => {
    const bare = recorder();
    applyPreviewSubject(bare, { ...base, previewKey: 'player_warrior' });
    expect(bare.calls.some((c) => c[0] === 'setWocAppearance')).toBe(false);
    const composed = recorder();
    applyPreviewSubject(composed, {
      ...base,
      look: { app: {} as never, worn: {} },
      wocAppearance: { gender: 'male' } as never,
    });
    expect(composed.calls.some((c) => c[0] === 'setWocAppearance')).toBe(false);
  });
});

describe('whose character a HUD stage shows', () => {
  it("names the inspect stage as someone else's and every other stage as the player's own", () => {
    expect(previewStageSurface('inspect')).toBe('inspect');
    expect(previewStageSurface('sheet')).toBe('own');
  });

  // every arm of the subject precedence: the body any of them builds must already know
  // which armor detail to ask for, or an inspected player's top files are fetched first
  const arms: [string, Partial<PreviewSubject>, string][] = [
    ['the class rig', {}, 'setClass'],
    ['an explicit key', { previewKey: 'player_warrior_female' }, 'setVisualKey'],
    ['a composed look', { look: { app: DEFAULT_APPEARANCE, worn: {} } as never }, 'setModular'],
  ];

  it.each(arms)(
    'tells the inspect stage what it shows BEFORE it mounts %s',
    (_name, over, mount) => {
      const p = recorder();
      applyPreviewSubject(p, { ...base, ...over, framing: 'inspect' });
      expect(p.calls[0]).toEqual(['setArmorSurface', 'inspect']);
      const names = p.calls.map(([name]) => name);
      expect(names.indexOf('setArmorSurface')).toBeLessThan(names.indexOf(mount));
      expect(names.filter((name) => name === 'setArmorSurface')).toHaveLength(1);
    },
  );

  it.each(arms)('hands the sheet back to the own character before it mounts %s', (_name, over) => {
    // the shared turntable comes back from the inspect stage: the next mount must say so
    const p = recorder();
    applyPreviewSubject(p, { ...base, ...over, framing: 'inspect' });
    applyPreviewSubject(p, { ...base, ...over, framing: 'sheet' });
    const surfaces = p.calls.filter(([name]) => name === 'setArmorSurface').map((c) => c[1]);
    expect(surfaces).toEqual(['inspect', 'own']);
  });
});
