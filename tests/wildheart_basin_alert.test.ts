// The Wildheart Basin's encounter alert (src/ui/hud/dungeon/
// wildheart_alert_view.ts): Zulgar's Prey runs him through the glyphs (and on
// heroic Twin Prey hears whether he chases them now), the jaguar's prey kites
// it, a pollinated player stays off the seeds, and a target bound by Pack Bond
// says pull them apart; the priority is Prey, Stalk, pollen, bond. Zulgar's
// hunt rework adds the Idol's Breath, the Pinned player and the spear, the
// Sunstruck window and the sun glyphs to light. Driven from real fights too,
// so the view reads exactly the auras and bodies the sim mirrors.

import { describe, expect, it } from 'vitest';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import {
  BEAST_PACK_BOND,
  BEAST_STALKED,
  BEAST_TUNING,
  BEASTMASTER_ID,
  BLOOM_POLLINATED,
  BLOOM_TUNING,
  FANGLORD_JAGUAR_ID,
  WILDHEART_GLYPH_COLD,
  WILDHEART_GLYPH_KINDLE,
  WILDHEART_IDOL_BREATH,
  WILDHEART_IDOL_BREATH_WARNING,
  WILDHEART_SUN_GLYPH_DARK,
  WILDHEART_SUN_GLYPH_LIT,
  ZULGAR_AVATAR,
  ZULGAR_ID,
  ZULGAR_IDOL_AWAKE,
  ZULGAR_PINNED,
  ZULGAR_PREY,
  ZULGAR_SUN_WARY,
  ZULGAR_SUNSTRUCK,
  ZULGAR_SUNSTRUCK_EXPOSED,
  ZULGAR_TUNING,
} from '../src/sim/encounters/wildheart_basin';
import type { Aura, Entity } from '../src/sim/types';
import { type AuraEffectInput, auraEffectDescriptor } from '../src/ui/aura_effect';
import { WildheartAlertSceneScan } from '../src/ui/hud/dungeon/wildheart_alert_scene_core';
import {
  buildWildheartAlertView,
  WILDHEART_ALERT_KINDS,
  WILDHEART_SOFT_ALERT_KINDS,
  type WildheartAlertEntity,
  type WildheartAlertInput,
  type WildheartAlertScene,
} from '../src/ui/hud/dungeon/wildheart_alert_view';
import { setLanguage, t } from '../src/ui/i18n';
import { boss, engage, type Fight, fight, put, run, tick } from './helpers/wildheart_fight';

setLanguage('en');

function input(over: Partial<WildheartAlertInput>): WildheartAlertInput {
  return { auras: [], targetId: null, entity: () => null, ...over };
}

function kind(over: Partial<WildheartAlertInput>): string {
  const v = buildWildheartAlertView(input(over));
  return v.visible ? v.kind : 'hidden';
}

describe('the Wildheart alert view', () => {
  it('hides when no Basin mechanic concerns the player', () => {
    expect(buildWildheartAlertView(input({})).visible).toBe(false);
  });

  it('the Prey runs; on Twin Prey the waiting one hears it', () => {
    const v = buildWildheartAlertView(
      input({ auras: [{ id: ZULGAR_PREY, remaining: 10, duration: 20, value2: 1 }] }),
    );
    expect(v.visible && v.kind).toBe('prey');
    expect(v.visible && v.title).toBe(t('hudChrome.wildheartAlert.preyTitle'));
    expect(v.visible && v.line).toBe(t('hudChrome.wildheartAlert.preyLine'));
    expect(v.visible && v.progress).toBe(0.5);
    expect(kind({ auras: [{ id: ZULGAR_PREY, remaining: 10, duration: 20, value2: 0 }] })).toBe(
      'prey-wait',
    );
  });

  it('the Stalk, the pollen and the bond each read their own line', () => {
    expect(kind({ auras: [{ id: BEAST_STALKED, remaining: 4, duration: 10 }] })).toBe('stalked');
    expect(kind({ auras: [{ id: BLOOM_POLLINATED, remaining: 4, duration: 8 }] })).toBe(
      'pollinated',
    );
    const bound = { templateId: FANGLORD_JAGUAR_ID, auras: [{ id: BEAST_PACK_BOND }] };
    expect(kind({ targetId: 7, entity: () => bound })).toBe('bonded');
    // The bond is read only off the pair, and only while it holds.
    expect(
      kind({ targetId: 7, entity: () => ({ templateId: ZULGAR_ID, auras: bound.auras }) }),
    ).toBe('hidden');
    expect(kind({ targetId: 7, entity: () => ({ templateId: BEASTMASTER_ID, auras: [] }) })).toBe(
      'hidden',
    );
  });

  it('priority: Prey over Stalk over pollen over bond', () => {
    const all = [
      { id: BLOOM_POLLINATED, remaining: 4, duration: 8 },
      { id: BEAST_STALKED, remaining: 4, duration: 10 },
      { id: ZULGAR_PREY, remaining: 4, duration: 20, value2: 1 },
    ];
    expect(kind({ auras: all })).toBe('prey');
    expect(kind({ auras: all.slice(0, 2) })).toBe('stalked');
    expect(kind({ auras: all.slice(0, 1) })).toBe('pollinated');
  });

  it('reads the live fight: the jaguar prey sees the Stalk, the tank on the master sees the bond', () => {
    const f = fight();
    const bm = boss(f, BEASTMASTER_ID);
    put(f, bm, -86, 58);
    put(f, f.tank, -86, 61);
    put(f, f.others[0], -86, 22);
    put(f, f.others[1], -104, 38);
    put(f, f.others[2], -68, 38);
    engage(f, bm);
    run(f, 0.2);
    const entity = (id: number) => f.sim.ctx.entities.get(id);
    f.tank.targetId = bm.id;
    expect(kind({ auras: f.tank.auras, targetId: bm.id, entity })).toBe('bonded');
    run(f, 3);
    const prey = f.others.find((p) => p.auras.some((a) => a.id === BEAST_STALKED));
    expect(prey).toBeDefined();
    if (prey) expect(kind({ auras: prey.auras, targetId: null, entity })).toBe('stalked');
  });
});

// ---- Zulgar's hunt rework ------------------------------------------------------------

const TERRACE = { x: 500, z: 220 };

function glyph(over: Partial<WildheartAlertEntity> = {}): WildheartAlertEntity {
  return { templateId: WILDHEART_SUN_GLYPH_DARK, pos: { x: TERRACE.x, z: TERRACE.z - 2 }, ...over };
}

function scene(over: Partial<WildheartAlertScene> = {}): WildheartAlertScene {
  return { zulgar: null, glyphs: [], spears: [], breaths: [], players: [], ...over };
}

const HUNTING: WildheartAlertEntity = {
  templateId: ZULGAR_ID,
  auras: [{ id: ZULGAR_AVATAR, remaining: 10, duration: 20 }],
};

describe("the Wildheart alert view: Zulgar's hunt rework", () => {
  it('every new kind is a painter class, and only the two spear kinds are soft', () => {
    for (const k of [
      'breath',
      'prey-alone',
      'pinned',
      'pinned-self',
      'sunstruck',
      'spear',
      'glyph',
    ])
      expect(WILDHEART_ALERT_KINDS).toContain(k);
    expect([...WILDHEART_SOFT_ALERT_KINDS].sort()).toEqual(['pinned-self', 'spear']);
  });

  it('a non-Prey player is told to light the dark glyphs while he hunts, and only then', () => {
    const line = t('hudChrome.wildheartAlert.glyphLine', {
      seconds: String(ZULGAR_TUNING.glyphKindleSeconds),
      pct: String(Math.round(ZULGAR_TUNING.sunstruckVuln * 100)),
      duration: String(ZULGAR_TUNING.sunstruckSeconds),
    });
    const v = buildWildheartAlertView(
      input({ scene: scene({ zulgar: HUNTING, glyphs: [glyph()] }) }),
    );
    expect(v.visible && v.kind).toBe('glyph');
    expect(v.visible && v.line).toBe(line);
    expect(line).toContain('2 sec');
    expect(line).toContain('25%');
    // Not hunting: nothing to light.
    const resting = { templateId: ZULGAR_ID, auras: [] };
    expect(kind({ scene: scene({ zulgar: resting, glyphs: [glyph()] }) })).toBe('hidden');
    // Every glyph lit, or the only dark one still cold: nothing to light.
    const lit = glyph({ templateId: WILDHEART_SUN_GLYPH_LIT });
    expect(kind({ scene: scene({ zulgar: HUNTING, glyphs: [lit] }) })).toBe('hidden');
    const cold = glyph({ castingAbility: WILDHEART_GLYPH_COLD, castRemaining: 5, castTotal: 8 });
    expect(kind({ scene: scene({ zulgar: HUNTING, glyphs: [cold] }) })).toBe('hidden');
  });

  it('the one lighting a glyph sees its bar fill', () => {
    const mine = glyph({
      castingAbility: WILDHEART_GLYPH_KINDLE,
      castTargetId: 7,
      castRemaining: 0.5,
      castTotal: 2,
    });
    const v = buildWildheartAlertView(
      input({ selfId: 7, scene: scene({ zulgar: HUNTING, glyphs: [mine] }) }),
    );
    expect(v.visible && v.kind).toBe('glyph-lighting');
    expect(v.visible && v.progress).toBe(0.75);
    // Someone else's glyph is only another glyph being lit.
    expect(kind({ selfId: 8, scene: scene({ zulgar: HUNTING, glyphs: [mine] }) })).toBe('glyph');
  });

  it('the Prey with nobody else free on the terrace is told to light for themself', () => {
    const prey = [{ id: ZULGAR_PREY, remaining: 10, duration: 20, value2: 1 }];
    const me = { id: 7, pos: { x: TERRACE.x, z: TERRACE.z }, auras: prey };
    const mate = { id: 8, pos: { x: TERRACE.x + 10, z: TERRACE.z }, auras: [] };
    const alone = scene({ zulgar: HUNTING, glyphs: [glyph()], players: [me] });
    const v = buildWildheartAlertView(input({ auras: prey, selfId: 7, scene: alone }));
    expect(v.visible && v.kind).toBe('prey-alone');
    expect(v.visible && v.line).toContain(`${ZULGAR_TUNING.glyphKindleAloneSeconds} sec`);
    // A free teammate on the terrace: the ordinary Prey line.
    const grouped = scene({ zulgar: HUNTING, glyphs: [glyph()], players: [me, mate] });
    expect(kind({ auras: prey, selfId: 7, scene: grouped })).toBe('prey');
    // A teammate who is dead, off the terrace, or marked too does not count.
    for (const other of [
      { ...mate, dead: true },
      { ...mate, pos: { x: TERRACE.x + 80, z: TERRACE.z } },
      { ...mate, auras: prey },
    ]) {
      const s2 = scene({ zulgar: HUNTING, glyphs: [glyph()], players: [me, other] });
      expect(kind({ auras: prey, selfId: 7, scene: s2 })).toBe('prey-alone');
    }
  });

  it('Sunstruck opens the window for everyone but the Prey', () => {
    const struck = {
      templateId: ZULGAR_ID,
      auras: [
        { id: ZULGAR_AVATAR, remaining: 10, duration: 20 },
        { id: ZULGAR_SUNSTRUCK_EXPOSED, remaining: 1.5, duration: 3 },
      ],
    };
    const v = buildWildheartAlertView(
      input({ scene: scene({ zulgar: struck, glyphs: [glyph()] }) }),
    );
    expect(v.visible && v.kind).toBe('sunstruck');
    expect(v.visible && v.progress).toBe(0.5);
    expect(v.visible && v.line).toContain('25%');
    const prey = [{ id: ZULGAR_PREY, remaining: 10, duration: 20, value2: 1 }];
    expect(kind({ auras: prey, scene: scene({ zulgar: struck }) })).not.toBe('sunstruck');
  });

  it('Pinned: a teammate must pull it, or, alone, the pull is yours; an ally sees the spear', () => {
    const live = { templateId: ZULGAR_ID, auras: [] };
    const body = { templateId: 'wildheart_hunting_spear', hp: 50 };
    const s1 = scene({ zulgar: live, spears: [body] });
    const held = [{ id: ZULGAR_PINNED, remaining: 5, duration: 10, value2: 0 }];
    const self = [{ id: ZULGAR_PINNED, remaining: 5, duration: 10, value2: 1 }];
    expect(kind({ auras: held, scene: s1 })).toBe('pinned');
    expect(kind({ auras: self, scene: s1 })).toBe('pinned-self');
    expect(kind({ scene: s1 })).toBe('spear');
    // A spear already pulled (its body spent) calls nobody.
    expect(kind({ scene: scene({ zulgar: live, spears: [{ ...body, dead: true }] }) })).toBe(
      'hidden',
    );
  });

  it("the Idol's Breath warns only the half it marks, over everything else", () => {
    const awake = {
      templateId: ZULGAR_ID,
      auras: [{ id: ZULGAR_AVATAR }, { id: ZULGAR_IDOL_AWAKE }],
    };
    const east = {
      templateId: WILDHEART_IDOL_BREATH_WARNING,
      pos: { x: TERRACE.x, z: TERRACE.z },
      facing: Math.PI / 2,
      castRemaining: 2,
      castTotal: 5,
    };
    const s1 = scene({ zulgar: awake, breaths: [east] });
    const prey = [{ id: ZULGAR_PREY, remaining: 4, duration: 8, value2: 1 }];
    const inside = { x: TERRACE.x + 6, z: TERRACE.z + 3 };
    const outside = { x: TERRACE.x - 6, z: TERRACE.z + 3 };
    const v = buildWildheartAlertView(input({ auras: prey, selfPos: inside, scene: s1 }));
    expect(v.visible && v.kind).toBe('breath');
    // The bar is the warning left.
    expect(v.visible && v.progress).toBeCloseTo(0.4, 6);
    expect(kind({ auras: prey, selfPos: outside, scene: s1 })).toBe('prey');
    // The breath already landed: nothing left to dodge.
    const landed = { ...east, templateId: WILDHEART_IDOL_BREATH };
    expect(kind({ selfPos: inside, scene: scene({ zulgar: awake, breaths: [landed] }) })).toBe(
      'hidden',
    );
  });
});

describe('the Wildheart alert reads the live reworked fight', () => {
  function view(f: Fight, p: Entity, scan: WildheartAlertSceneScan) {
    const world = f.sim as unknown as Parameters<WildheartAlertSceneScan['update']>[0];
    return buildWildheartAlertView({
      auras: p.auras,
      targetId: null,
      entity: (id) => f.sim.ctx.entities.get(id),
      selfId: p.id,
      selfPos: p.pos,
      scene: scan.update(world),
    });
  }

  function pull(f: Fight): Entity {
    const z = boss(f, ZULGAR_ID);
    put(f, z, 0, 218);
    put(f, f.tank, 0, 214);
    put(f, f.others[0], -20, 204);
    put(f, f.others[1], 20, 204);
    put(f, f.others[2], 0, 234);
    engage(f, z);
    tick(f);
    return z;
  }

  const dev = (f: Fight, what: string) => f.sim.chat(`/dev wildheart trigger ${what}`, f.tank.id);

  it('the hunt: the Prey runs, the others light; the spear; the breath', () => {
    const f = fight();
    const z = pull(f);
    const scan = new WildheartAlertSceneScan();
    dev(f, 'pin');
    tick(f, () => put(f, z, 0, 218));
    const victim = [f.tank, ...f.others].find((p) => p.auras.some((a) => a.id === ZULGAR_PINNED));
    expect(victim).toBeDefined();
    if (!victim) return;
    const pinnedView = view(f, victim, scan);
    expect(pinnedView.visible && pinnedView.kind).toBe('pinned');
    const helper = view(f, f.tank, scan);
    expect(helper.visible && helper.kind).toBe('spear');
    dev(f, 'prey');
    tick(f, () => put(f, z, 0, 218));
    const prey = f.others.find((p) => p.auras.some((a) => a.id === ZULGAR_PREY)) as Entity;
    const preyView = view(f, prey, scan);
    expect(preyView.visible && preyView.kind).toBe('prey');
    const lighter = view(f, f.tank, scan);
    expect(lighter.visible && lighter.kind).toBe('glyph');
    dev(f, 'breath');
    tick(f, () => put(f, z, 0, 218));
    const kinds = [f.tank, ...f.others].map((p) => {
      const v = view(f, p, scan);
      return v.visible ? v.kind : 'hidden';
    });
    // Whoever stands in the marked half is told to cross; nobody else is.
    const half = f.inst.objectIds
      .map((id) => f.sim.ctx.entities.get(id))
      .find((e) => e?.templateId === WILDHEART_IDOL_BREATH_WARNING) as Entity;
    const east = Math.sin(half.facing) > 0;
    [f.tank, ...f.others].forEach((p, i) => {
      const x = p.pos.x - half.pos.x;
      const marked = east ? x > 0 : x < 0;
      expect(kinds[i] === 'breath', `player ${i} at x ${x}`).toBe(marked);
    });
    expect(kinds).toContain('breath');
  });
});

describe('the Basin aura tooltips say the live rule', () => {
  function text(id: string, kind: Aura['kind'], value = 0): string {
    const d = auraEffectDescriptor({ id, kind, value } as AuraEffectInput);
    expect(d, id).not.toBeNull();
    if (!d) return '';
    const nums: Record<string, string> = {};
    for (const [k, v] of Object.entries(d.nums ?? {})) nums[k] = String(v);
    return t(d.key as never, nums);
  }

  it('a mark never claims a 0 percent damage change', () => {
    for (const id of [BEAST_STALKED, ZULGAR_PREY, BLOOM_POLLINATED]) {
      const line = text(id, 'vulnerability', 0);
      expect(line).not.toMatch(/(^|[^0-9])0%/);
      expect(line).not.toMatch(/\{\w+\}/);
    }
  });

  it('the numbers are the ones combat uses, heroic included', () => {
    const heroicJaguar =
      HEROIC_DUNGEON_TUNING.wildheart_basin.mechanicDamageMultiplierByMob?.fanglord_jaguar ?? 1;
    const stalked = text(BEAST_STALKED, 'vulnerability');
    expect(stalked).toContain(`${BEAST_TUNING.biteMin} to ${BEAST_TUNING.biteMax}`);
    expect(stalked).toContain(`${Math.round(BEAST_TUNING.biteMin * heroicJaguar)} to`);
    const prey = text(ZULGAR_PREY, 'vulnerability');
    expect(prey).toContain(`${ZULGAR_TUNING.maulDamage} damage`);
    expect(prey).toContain(`${Math.round(ZULGAR_TUNING.sunstruckSlow * 100)}%`);
    expect(text(BEAST_PACK_BOND, 'buff_dr', BEAST_TUNING.bondDr)).toContain('50% less damage');
    expect(text(ZULGAR_AVATAR, 'buff_speed', ZULGAR_TUNING.huntSpeedMult)).toContain('10% faster');
    expect(text(BLOOM_POLLINATED, 'vulnerability')).toContain(`${BLOOM_TUNING.podSprout} sec`);
  });

  it("Zulgar's hunt rework: Sunstruck, Wary of the Sun, Pinned and The Idol Wakes", () => {
    const T = ZULGAR_TUNING;
    const heroic =
      HEROIC_DUNGEON_TUNING.wildheart_basin.mechanicDamageMultiplierByMob?.wildheart_high_priest ??
      1;
    expect(heroic).toBeGreaterThan(1);
    expect(text(ZULGAR_SUNSTRUCK, 'slow', 1 - T.sunstruckSlow)).toContain('60% slower');
    expect(text(ZULGAR_SUNSTRUCK_EXPOSED, 'vulnerability', T.sunstruckVuln)).toContain(
      '25% more damage',
    );
    expect(text(ZULGAR_SUN_WARY, 'buff_dr', 0)).not.toMatch(/(^|[^0-9])0%/);
    const pinned = text(ZULGAR_PINNED, 'root', 0);
    expect(pinned).toContain(`${T.pinBleed} Physical damage`);
    expect(pinned).toContain(`${Math.round(T.pinBleed * heroic)} on Heroic`);
    expect(pinned).toContain(`every ${T.pinBleedEvery} sec`);
    expect(pinned).toContain('50% more damage');
    expect(pinned).toContain(`in ${T.spearPullSeconds} sec`);
    expect(pinned).toContain(`in ${T.spearWrenchSeconds} sec`);
    expect(pinned).toContain(`after ${T.pinSeconds} sec`);
    const idol = text(ZULGAR_IDOL_AWAKE, 'buff_dr', 0);
    expect(idol).not.toMatch(/(^|[^0-9])0%/);
    expect(idol).toContain(`Every ${T.breathEvery} sec`);
    expect(idol).toContain(`${T.breathWarning} sec warning`);
    expect(idol).toContain(`${T.breathMin} to ${T.breathMax} Nature damage`);
    expect(idol).toContain(
      `${Math.round(T.breathMin * heroic)} to ${Math.round(T.breathMax * heroic)} on Heroic`,
    );
    expect(idol).toContain(`every ${T.finalPreySeconds} sec`);
    expect(idol).toContain(`${T.twinSwitch * 2} sec on Heroic`);
    for (const line of [pinned, idol]) expect(line).not.toMatch(/\{\w+\}/);
  });
});
