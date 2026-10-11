// The Hollow Crypt's boss HUD copy: the encounter alert
// (src/ui/hud/dungeon/crypt_alert_view.ts and its scene scan), pure and driven
// from real fights (it reads only the auras, bars and encounter objects the
// sim sets, so a real Sim drives it exactly as the HUD sees it, offline or
// mirrored online), the boss-aura tooltips (src/ui/crypt_aura_effect.ts: every
// number from the encounter tuning, and the heroic numbers from the same
// factor combat applies, checked against the damage combat deals), the relight
// copy of the use prompt (kit_use_prompt_view.ts), and the Lady's loot display
// names (the spider placeholder's leftovers renamed, ids frozen).

import { describe, expect, it, vi } from 'vitest';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import { ITEMS } from '../src/sim/data';
import {
  BELL_YARD,
  BONECHILL_RAVINE,
  CHORISTER_ID,
  candleBodySpot,
  cryptDevTrigger,
  GRAVE_LANTERNS,
  ILVANE_CRESCENDO,
  ILVANE_DIRGE_SILENCE,
  ILVANE_HARMONY,
  ILVANE_ID,
  ILVANE_TUNING,
  inKnellHalf,
  KNELL_HALF_MARK_TEMPLATE,
  KNELL_TUNING,
  KNELLWYRM_AIRBORNE,
  KNELLWYRM_ID,
  KNELLWYRM_KNELL_MARK,
  KNELLWYRM_TUNING,
  knellHalfYaw,
  LADY_BRIDES_LAMENT,
  LADY_EMBRACE_HOLD,
  LADY_EMBRACED,
  LADY_FROZEN_EMBRACE,
  LADY_ID,
  LADY_LAMENT_DREAD,
  LADY_LINGERING_LAMENT,
  LADY_TUNING,
  MARROW_BLOW_STACKS,
  MARROW_DIRT_IN_EYES,
  MARROW_GRAVE_DIRT,
  MARROW_GRAVE_VIGOR,
  MARROW_ID,
  MARROW_MEASURE,
  MARROW_MEASURED,
  MARROW_TOLLING,
  MARROW_TUNING,
  MORTHEN_CANDLE_ID,
  MORTHEN_GORGED,
  MORTHEN_GRASP_MARK,
  MORTHEN_GRASP_ROOT,
  MORTHEN_GRASP_TEMPLATE,
  MORTHEN_GRAVE_CHILL,
  MORTHEN_ID,
  MORTHEN_REAP,
  MORTHEN_RELIGHT_CAST,
  MORTHEN_RITE_BROKEN,
  MORTHEN_SHATTERED,
  MORTHEN_SOUL_TEMPLATE,
  MORTHEN_SPOT,
  MORTHEN_TUNING,
  MORTHEN_UNQUIET_WARD,
  RITE_CANDLE_DARK,
  RITE_CANDLE_LIT,
  RITE_CANDLE_NAMED,
  RITE_CANDLE_SPOTS,
  RITE_RING,
} from '../src/sim/encounters/hollow_crypt';
import { SLIPPERY_DEFAULT_GRIP, SLIPPERY_GROUND_AURA } from '../src/sim/slippery_ground';
import { DT, type Entity } from '../src/sim/types';
import { type AuraEffectInput, auraEffectDescriptor } from '../src/ui/aura_effect';
import {
  cryptAuraEffectDescriptor,
  cryptHeroicAmount,
  cryptHeroicFactor,
} from '../src/ui/crypt_aura_effect';
import {
  CryptAlertSceneScan,
  type CryptSceneEntity,
  type CryptSceneWorld,
} from '../src/ui/hud/dungeon/crypt_alert_scene_core';
import {
  buildCryptAlertView,
  CRYPT_ALERT_KINDS,
  CRYPT_SOFT_ALERT_KINDS,
  type CryptAlertEntity,
  type CryptAlertInput,
  type CryptAlertScene,
  type CryptAlertView,
  EMPTY_CRYPT_SCENE,
  inMarkedHalf,
  SOUL_ALERT_RADIUS,
} from '../src/ui/hud/dungeon/crypt_alert_view';
import {
  buildKitUsePromptView,
  KitUseSceneScan,
  type KitUseSceneWorld,
} from '../src/ui/hud/dungeon/kit_use_prompt_view';
import { t } from '../src/ui/i18n';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';
import { en } from '../src/ui/i18n.resolved.generated/en';
import {
  aura,
  boss,
  cryptFight,
  type Fight,
  live as liveMobs,
  put,
  run,
  took,
  until,
} from './helpers/crypt_boss_fight';

vi.setConfig({ testTimeout: 90_000 });

const M = MARROW_TUNING;
const L = LADY_TUNING;
const I = ILVANE_TUNING;
const MT = MORTHEN_TUNING;
/** The Knellwyrm carries no MECHANIC override: its kit rides its own boss
 *  melee entry (the heroic pack budget moved the trash-wide factor off it). */
const WYRM_HEROIC = HEROIC_DUNGEON_TUNING.hollow_crypt?.damageMultiplierByMob?.crypt_knellwyrm ?? 0;

function input(over: Partial<CryptAlertInput>): CryptAlertInput {
  return { auras: [], targetId: null, entity: () => null, ...over };
}

function live(v: CryptAlertView) {
  if (!v.visible) throw new Error('hidden');
  return v;
}

const kind = (over: Partial<CryptAlertInput>) => {
  const v = buildCryptAlertView(input(over));
  return v.visible ? v.kind : null;
};

describe('the crypt alert view (pure)', () => {
  it('hides when no Crypt mechanic concerns the player', () => {
    expect(buildCryptAlertView(input({})).visible).toBe(false);
    // The Dirge's silence is a plain silence: no alert.
    expect(kind({ auras: [{ id: ILVANE_DIRGE_SILENCE, remaining: 3, duration: 4 }] })).toBeNull();
  });

  it('the grave mark: title, line, and the bar is the time left', () => {
    const v = live(
      buildCryptAlertView(input({ auras: [{ id: MARROW_MEASURED, remaining: 1, duration: 4 }] })),
    );
    expect(v.kind).toBe('measured');
    expect(v.title).toBe(t('hudChrome.cryptAlert.measuredTitle'));
    expect(v.line).toBe(t('hudChrome.cryptAlert.measuredLine'));
    expect(v.progress).toBe(0.25);
    expect(v.progressAria).toBe(t('hudChrome.cryptAlert.timeAria', { seconds: '1' }));
    expect(v.pressable).toBe(false);
  });

  it("the Lament's line follows its value2 hint: 1 hold still, 0 get into the light", () => {
    const at = (value2: number) =>
      live(
        buildCryptAlertView(
          input({ auras: [{ id: LADY_LAMENT_DREAD, remaining: 1.5, duration: 3, value2 }] }),
        ),
      );
    expect(at(1).kind).toBe('lament-sheltered');
    expect(at(1).line).toBe(t('hudChrome.cryptAlert.lamentShelteredLine'));
    expect(at(0).kind).toBe('lament-open');
    expect(at(0).line).toBe(t('hudChrome.cryptAlert.lamentOpenLine'));
    expect(at(0).title).toBe(t('hudChrome.cryptAlert.lamentTitle'));
    expect(at(0).progress).toBe(0.5);
  });

  it('the grave underfoot carries no bar; the Embrace carries its own', () => {
    const grave = live(buildCryptAlertView(input({ auras: [{ id: MARROW_GRAVE_DIRT }] })));
    expect(grave.kind).toBe('grave');
    expect(grave.progress).toBeNull();
    const held = live(
      buildCryptAlertView(input({ auras: [{ id: LADY_EMBRACED, remaining: 3, duration: 12 }] })),
    );
    expect(held.kind).toBe('embraced');
    expect(held.progress).toBe(0.25);
  });

  it('priority: the mark over the Embrace over the Lament over the grave over the target', () => {
    const all = [
      { id: MARROW_MEASURED, remaining: 2, duration: 4 },
      { id: LADY_EMBRACED, remaining: 2, duration: 4 },
      { id: LADY_LAMENT_DREAD, remaining: 2, duration: 3, value2: 0 },
      { id: MARROW_GRAVE_DIRT },
    ];
    const tolling: CryptAlertEntity = { templateId: MARROW_ID, auras: [{ id: MARROW_TOLLING }] };
    const target = { targetId: 9, entity: () => tolling };
    expect(kind({ auras: all, ...target })).toBe('measured');
    expect(kind({ auras: all.slice(1), ...target })).toBe('embraced');
    expect(kind({ auras: all.slice(2), ...target })).toBe('lament-open');
    expect(kind({ auras: all.slice(3), ...target })).toBe('grave');
    expect(kind({ auras: [], ...target })).toBe('toll');
  });

  it('target readouts: only the right boss, alive, with the aura on', () => {
    const harmony = (value: number, templateId = ILVANE_ID, dead = false) =>
      kind({
        targetId: 3,
        entity: () => ({ templateId, dead, auras: [{ id: ILVANE_HARMONY, value }] }),
      });
    expect(harmony(0.6)).toBe('harmony');
    expect(harmony(0)).toBeNull();
    expect(harmony(0.6, CHORISTER_ID)).toBeNull();
    expect(harmony(0.6, ILVANE_ID, true)).toBeNull();
    const v = live(
      buildCryptAlertView(
        input({
          targetId: 3,
          entity: () => ({ templateId: ILVANE_ID, auras: [{ id: ILVANE_HARMONY, value: 0.3 }] }),
        }),
      ),
    );
    expect(v.line).toBe(t('hudChrome.cryptAlert.harmonyLine', { pct: '30' }));
    expect(v.progress).toBeNull();
    // A Tolling aura on anyone but Marrow reads nothing.
    expect(
      kind({
        targetId: 3,
        entity: () => ({ templateId: LADY_ID, auras: [{ id: MARROW_TOLLING }] }),
      }),
    ).toBeNull();
  });

  it('every kind it can return has a class the painter toggles', () => {
    expect([...CRYPT_ALERT_KINDS].sort()).toEqual(
      [
        'measured',
        'embraced',
        'lament-sheltered',
        'lament-open',
        'grave',
        'knell',
        'grasp',
        'reap',
        'toll',
        'harmony',
        'rite',
        'rite-named',
        'soul',
      ].sort(),
    );
    // Only the two reminders give the slot to the use prompt.
    expect([...CRYPT_SOFT_ALERT_KINDS].sort()).toEqual(['rite', 'rite-named', 'soul']);
  });
});

describe('the crypt alert over real fights', () => {
  const viewFor = (f: Fight, p: Entity, targetId: number | null = null) =>
    buildCryptAlertView({
      auras: p.auras,
      targetId,
      entity: (id) => f.sim.ctx.entities.get(id),
    });

  function holdAll(f: Fight): () => void {
    const hold = [f.tank, ...f.others].map((p) => [p, p.pos.x - f.ox, p.pos.z - f.oz] as const);
    return () => {
      for (const [p, x, z] of hold) if (p.carriedBy === undefined) put(f, p, x, z);
    };
  }

  function marrowFight(difficulty: 'normal' | 'heroic' = 'normal') {
    const f = cryptFight(difficulty, 3, new Set([MARROW_ID]));
    const marrow = boss(f, MARROW_ID);
    put(f, marrow, BELL_YARD.x, BELL_YARD.z);
    put(f, f.tank, BELL_YARD.x, BELL_YARD.z - 2.5);
    const rim = [
      [BELL_YARD.x - 17, BELL_YARD.z + 6],
      [BELL_YARD.x + 17, BELL_YARD.z + 6],
      [BELL_YARD.x, BELL_YARD.z + 18],
    ];
    for (const [i, p] of f.others.entries()) put(f, p, rim[i][0], rim[i][1]);
    marrow.maxHp = 1e6;
    marrow.hp = marrow.maxHp;
    f.sim.ctx.aggroMob(marrow, f.tank, false);
    return { f, marrow };
  }

  it('Marrow: the marked player sees the mark, then the grave; the tank on him sees the Toll', () => {
    const { f, marrow } = marrowFight();
    const keep = holdAll(f);
    expect(until(f, () => marrow.castingAbility === MARROW_MEASURE, M.measureFirst + 1, keep)).toBe(
      true,
    );
    const victim = f.others.find((p) => p.id === marrow.castTargetId) as Entity;
    expect(until(f, () => aura(victim, MARROW_MEASURED) !== undefined, 2, keep)).toBe(true);
    const mark = live(viewFor(f, victim));
    expect(mark.kind).toBe('measured');
    expect(mark.progress).toBeGreaterThan(0.9);
    // Nobody else is warned.
    expect(viewFor(f, f.tank).visible).toBe(false);
    run(f, M.markSeconds + 0.5, keep);
    expect(aura(victim, MARROW_MEASURED)).toBeUndefined();
    expect(live(viewFor(f, victim)).kind).toBe('grave');
    // At 66 percent he strides to the rope, immune: the tank on him reads it.
    marrow.hp = Math.floor(marrow.maxHp * 0.65);
    run(f, DT * 2, keep);
    expect(aura(marrow, MARROW_TOLLING)).toBeDefined();
    expect(live(viewFor(f, f.tank, marrow.id)).kind).toBe('toll');
  });

  it('heroic Grave Dirt burns for exactly the heroic number the tooltip states', () => {
    const { f, marrow } = marrowFight('heroic');
    const keep = holdAll(f);
    run(f, DT, keep);
    const st = marrow.cryptBossFight;
    if (st?.kind !== 'marrow') throw new Error('no fight');
    const victim = f.others[0];
    st.marks.push({ playerId: victim.id, remaining: DT });
    run(f, DT * 2, keep);
    const from = f.hits.length;
    run(f, 2.1, keep);
    const ticks = f.hits
      .slice(from)
      .filter((h) => h.targetId === victim.id && h.ability === 'Grave Dirt');
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    const d = cryptAuraEffectDescriptor({
      id: MARROW_GRAVE_DIRT,
      kind: 'slow',
      value: M.graveSlow,
    });
    for (const h of ticks) expect(h.amount).toBe(d?.nums?.heroic);
  });

  function ladyFight() {
    const f = cryptFight('normal', 3, new Set([LADY_ID]));
    const lady = boss(f, LADY_ID);
    put(f, lady, BONECHILL_RAVINE.x, BONECHILL_RAVINE.z);
    put(f, f.tank, BONECHILL_RAVINE.x, BONECHILL_RAVINE.z - 2.5);
    const spots = [
      [BONECHILL_RAVINE.x - 6, BONECHILL_RAVINE.z + 4],
      [BONECHILL_RAVINE.x + 6, BONECHILL_RAVINE.z + 4],
      [BONECHILL_RAVINE.x, BONECHILL_RAVINE.z + 7],
    ];
    for (const [i, p] of f.others.entries()) put(f, p, spots[i][0], spots[i][1]);
    lady.maxHp = 1e6;
    lady.hp = lady.maxHp;
    f.sim.ctx.aggroMob(lady, f.tank, false);
    return { f, lady };
  }

  it('the Lament: the sheltered hold still, the rest are sent to the light; the wail lands in range', () => {
    const { f, lady } = ladyFight();
    const l0 = GRAVE_LANTERNS[0];
    put(f, f.others[0], l0.x + 0.5, l0.z);
    put(f, f.others[1], l0.x - 0.5, l0.z);
    put(f, f.others[2], l0.x, l0.z + 2.5);
    const keep = holdAll(f);
    expect(
      until(f, () => lady.castingAbility === LADY_BRIDES_LAMENT, L.lamentFirst + 1, keep),
    ).toBe(true);
    run(f, 0.5, keep);
    expect(live(viewFor(f, f.others[0])).kind).toBe('lament-sheltered');
    expect(live(viewFor(f, f.others[1])).kind).toBe('lament-sheltered');
    // Third in the light: the lantern is full, so the hint sends them on.
    expect(live(viewFor(f, f.others[2])).kind).toBe('lament-open');
    expect(live(viewFor(f, f.tank)).kind).toBe('lament-open');
    const from = f.hits.length;
    expect(until(f, () => lady.castingAbility !== LADY_BRIDES_LAMENT, L.lamentCast, keep)).toBe(
      true,
    );
    run(f, DT, keep);
    // The first Lament on a fresh player lands inside the tooltip's normal range.
    const d = cryptAuraEffectDescriptor({ id: LADY_LAMENT_DREAD, kind: 'slow', value: 1 });
    const hit = took(f, f.others[2], "Bride's Lament", from);
    expect(hit).toBeGreaterThanOrEqual(d?.nums?.min ?? Number.NaN);
    expect(hit).toBeLessThanOrEqual(d?.nums?.max ?? Number.NaN);
    // The wail is over: the warning is gone, the Lingering Lament remains.
    expect(viewFor(f, f.others[2]).visible).toBe(false);
    const linger = aura(f.others[2], LADY_LINGERING_LAMENT);
    expect(linger).toBeDefined();
    const ld = auraEffectDescriptor({
      id: LADY_LINGERING_LAMENT,
      kind: 'slow',
      value: 1,
      value2: linger?.value2,
      stacks: linger?.stacks,
    });
    expect(ld?.key).toBe('hudChrome.auraEffect.crypt.lingering');
    expect(ld?.nums?.pct).toBe(Math.round(L.lingerPerStack * 100));
  });

  it('the Embrace: the held player sees it while she holds them', () => {
    const { f, lady } = ladyFight();
    const keep = holdAll(f);
    run(f, DT, keep);
    const s = lady.cryptBossFight;
    if (s?.kind !== 'lady') throw new Error('no lady fight');
    s.lamentTimer = 999;
    s.embraceTimer = 0;
    expect(until(f, () => lady.castingAbility === LADY_FROZEN_EMBRACE, 1, keep)).toBe(true);
    const victim = f.others.find((p) => p.id === lady.castTargetId) as Entity;
    expect(
      until(f, () => lady.castingAbility === LADY_EMBRACE_HOLD, L.embraceCast + 0.2, keep),
    ).toBe(true);
    run(f, L.embraceRise + 0.1, keep);
    expect(aura(victim, LADY_EMBRACED)).toBeDefined();
    expect(live(viewFor(f, victim)).kind).toBe('embraced');
  });

  it('Ilvane: targeting her while her Choristers live reads Harmony with their live share', () => {
    const f = cryptFight('normal', 3, new Set([ILVANE_ID, CHORISTER_ID]));
    const ilvane = boss(f, ILVANE_ID);
    const choir = liveMobs(f, CHORISTER_ID).filter((c) => f.inst.mobIds.includes(c.id));
    put(f, ilvane, 0, 163);
    put(f, f.tank, 0, 160.5);
    f.sim.ctx.aggroMob(ilvane, f.tank, false);
    for (const c of choir) f.sim.ctx.aggroMob(c, f.tank, false);
    run(f, DT * 2);
    const share = aura(ilvane, ILVANE_HARMONY)?.value ?? 0;
    expect(share).toBeCloseTo(choir.length * I.harmonyPer, 9);
    const v = live(viewFor(f, f.tank, ilvane.id));
    expect(v.kind).toBe('harmony');
    expect(v.line).toBe(
      t('hudChrome.cryptAlert.harmonyLine', { pct: String(Math.round(share * 100)) }),
    );
    // Targeting a Chorister reads nothing.
    expect(viewFor(f, f.tank, choir[0].id).visible).toBe(false);
  });
});

describe('the crypt aura tooltips', () => {
  const heroic = (mob: string, n: number) =>
    Math.round(n * (HEROIC_DUNGEON_TUNING.hollow_crypt?.mechanicDamageMultiplierByMob?.[mob] ?? 0));
  const pct = (frac: number) => Math.round(frac * 100);

  const cases: { a: AuraEffectInput; key: string; nums: Record<string, number> }[] = [
    {
      a: { id: MARROW_MEASURED, kind: 'slow', value: 1, value2: M.graveRadius },
      key: 'measured',
      nums: {
        radius: M.graveRadius,
        min: M.graveOpenMin,
        max: M.graveOpenMax,
        heroicMin: heroic(MARROW_ID, M.graveOpenMin),
        heroicMax: heroic(MARROW_ID, M.graveOpenMax),
      },
    },
    {
      a: { id: MARROW_GRAVE_DIRT, kind: 'slow', value: M.graveSlow },
      key: 'graveDirt',
      nums: {
        slow: pct(1 - M.graveSlow),
        damage: M.graveDirtPerSecond,
        heroic: heroic(MARROW_ID, M.graveDirtPerSecond),
        linger: M.unquietLinger,
      },
    },
    {
      a: { id: MARROW_DIRT_IN_EYES, kind: 'slow', value: M.shovelSlow },
      key: 'dirtInEyes',
      nums: { pct: pct(1 - M.shovelSlow) },
    },
    {
      a: {
        id: MARROW_BLOW_STACKS,
        kind: 'vulnerability',
        value: M.blowVulnPerStack * 3,
        stacks: 3,
      },
      key: 'blow',
      nums: {
        pct: pct(M.blowVulnPerStack * 3),
        per: pct(M.blowVulnPerStack),
        stacks: 3,
        max: M.blowMaxStacks,
        seconds: M.blowSeconds,
      },
    },
    {
      a: { id: MARROW_GRAVE_VIGOR, kind: 'buff_haste', value: M.graveVigorHaste },
      key: 'graveVigor',
      nums: { pct: pct(M.graveVigorHaste - 1) },
    },
    {
      a: { id: MARROW_TOLLING, kind: 'buff_dr', value: 0 },
      key: 'tolling',
      nums: {
        min: M.tollMin,
        max: M.tollMax,
        heroicMin: heroic(MARROW_ID, M.tollMin),
        heroicMax: heroic(MARROW_ID, M.tollMax),
      },
    },
    {
      a: { id: LADY_EMBRACED, kind: 'stun', value: 0 },
      key: 'embraced',
      nums: {
        tick: L.embracePerSecond,
        tickHeroic: heroic(LADY_ID, L.embracePerSecond),
        share: pct(L.embraceBreakShare),
        hold: L.embraceHold,
        min: L.dropMin,
        max: L.dropMax,
        heroicMin: heroic(LADY_ID, L.dropMin),
        heroicMax: heroic(LADY_ID, L.dropMax),
      },
    },
    {
      a: { id: LADY_LAMENT_DREAD, kind: 'slow', value: 1, value2: 0 },
      key: 'lament',
      nums: {
        radius: L.lanternRadius,
        cap: L.lanternCap,
        min: L.lamentMin,
        max: L.lamentMax,
        heroicMin: heroic(LADY_ID, L.lamentMin),
        heroicMax: heroic(LADY_ID, L.lamentMax),
      },
    },
    {
      a: {
        id: LADY_LINGERING_LAMENT,
        kind: 'slow',
        value: 1,
        value2: L.lingerPerStack * 2,
        stacks: 2,
      },
      key: 'lingering',
      nums: { pct: pct(L.lingerPerStack * 2), per: pct(L.lingerPerStack), max: L.lingerMaxStacks },
    },
    {
      a: { id: SLIPPERY_GROUND_AURA, kind: 'slow', value: 1, value2: L.iceGrip },
      key: 'slippery',
      nums: { grip: L.iceGrip },
    },
    {
      a: { id: ILVANE_HARMONY, kind: 'buff_dr', value: I.harmonyPer * 2 },
      key: 'harmony',
      nums: { pct: pct(I.harmonyPer * 2), per: pct(I.harmonyPer) },
    },
    {
      a: { id: ILVANE_CRESCENDO, kind: 'buff_haste', value: 1 },
      key: 'crescendo',
      nums: {
        cast: I.dirgeCastCrescendo,
        castNormal: I.dirgeCast,
        every: I.dirgeEveryCrescendo,
        everyNormal: I.dirgeEvery,
        waves: I.organWaveAtCrescendo.length,
        wavesNormal: I.organWaveAt.length,
      },
    },
    {
      a: {
        id: MORTHEN_GORGED,
        kind: 'buff_dmg_done',
        value: MT.gorgedPct * 3,
        stacks: 3,
      },
      key: 'gorged',
      nums: {
        pct: pct(MT.gorgedPct * 3),
        per: pct(MT.gorgedPct),
        stacks: 3,
        max: MT.gorgedMaxStacks,
        heal: pct(MT.gorgedHeal),
      },
    },
    {
      a: { id: MORTHEN_UNQUIET_WARD, kind: 'buff_dr', value: 0, value2: 2 },
      key: 'unquietWard',
      nums: {
        lit: 2,
        total: RITE_CANDLE_SPOTS.length,
        channel: MT.relightChannel,
        drain: pct(MT.relightDrainPct),
        drainHeroic: pct(MT.relightDrainPctHeroic),
        wrongMin: heroic(MORTHEN_ID, MT.wrongCandleMin),
        wrongMax: heroic(MORTHEN_ID, MT.wrongCandleMax),
      },
    },
    {
      a: { id: MORTHEN_RITE_BROKEN, kind: 'stun', value: 0 },
      key: 'riteBroken',
      nums: { seconds: MT.brokenSeconds },
    },
    {
      a: { id: MORTHEN_SHATTERED, kind: 'vulnerability', value: MT.brokenVuln },
      key: 'shatteredWard',
      nums: { pct: pct(MT.brokenVuln), seconds: MT.brokenSeconds },
    },
    {
      a: { id: MORTHEN_GRAVE_CHILL, kind: 'slow', value: 1, value2: MT.chillBase + 2 },
      key: 'graveChill',
      nums: {
        bite: MT.chillBase + 2,
        biteHeroic: heroic(MORTHEN_ID, MT.chillBase + 2),
        step: MT.chillStep,
        stepHeroic: heroic(MORTHEN_ID, MT.chillStep),
        every: MT.chillEvery,
      },
    },
    {
      a: { id: MORTHEN_GRASP_MARK, kind: 'slow', value: 1, value2: MT.graspRadius },
      key: 'graspMark',
      nums: {
        fuse: MT.graspFuse,
        radius: MT.graspRadius,
        root: MT.graspRootSeconds,
        min: heroic(MORTHEN_ID, MT.graspMin),
        max: heroic(MORTHEN_ID, MT.graspMax),
      },
    },
    {
      a: { id: MORTHEN_GRASP_ROOT, kind: 'root', value: 0 },
      key: 'graspRoot',
      nums: { seconds: MT.graspRootSeconds },
    },
    {
      a: { id: KNELLWYRM_AIRBORNE, kind: 'buff_dr', value: 0 },
      key: 'knellAirborne',
      nums: {
        mark: KNELL_TUNING.markSeconds,
        min: Math.round(KNELL_TUNING.fireMin * WYRM_HEROIC),
        max: Math.round(KNELL_TUNING.fireMax * WYRM_HEROIC),
        breaths: KNELL_TUNING.breaths,
      },
    },
  ];

  it.each(cases)('$key states its rule with the live numbers', ({ a, key, nums }) => {
    const d = auraEffectDescriptor(a);
    expect(d?.key).toBe(`hudChrome.auraEffect.crypt.${key}`);
    expect(d?.nums).toEqual(nums);
    const text = (hudChromeStrings.auraEffect.crypt as Record<string, string>)[key];
    // Every placeholder is a number the descriptor supplies, every number it
    // supplies is printed, and the copy hardcodes no number of its own.
    const tokens = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    expect(new Set(tokens)).toEqual(new Set(Object.keys(nums)));
    expect(text.replace(/\{\w+\}/g, '')).not.toMatch(/\d/);
  });

  it('the heroic factor is the one combat stamps on the heroic bosses', () => {
    for (const mob of [MARROW_ID, LADY_ID, ILVANE_ID, MORTHEN_ID]) {
      const mult = HEROIC_DUNGEON_TUNING.hollow_crypt?.mechanicDamageMultiplierByMob?.[mob];
      expect(mult).toBeGreaterThan(1);
      expect(cryptHeroicAmount(mob, 10)).toBe(Math.round(10 * (mult ?? 0)));
    }
    // The Knellwyrm has no mechanic override: its kit rides its per-mob boss
    // entry, held at the pre-retune 20 when the heroic pack budget lowered the
    // trash-wide factor (it spawns with no add role, so without the entry it
    // would have fallen to the trash value).
    const crypt = HEROIC_DUNGEON_TUNING.hollow_crypt;
    expect(crypt?.mechanicDamageMultiplierByMob?.[KNELLWYRM_ID]).toBeUndefined();
    expect(crypt?.damageMultiplierByMob?.[KNELLWYRM_ID]).toBe(20);
    expect(WYRM_HEROIC).toBe(20);
    expect(cryptHeroicFactor(KNELLWYRM_ID)).toBe(WYRM_HEROIC);
  });

  it('the live per-aura state reads off the aura: blow stacks, Harmony share, the grip', () => {
    const one = cryptAuraEffectDescriptor({
      id: MARROW_BLOW_STACKS,
      kind: 'vulnerability',
      value: M.blowVulnPerStack,
      stacks: 1,
    });
    expect(one?.nums?.pct).toBe(pct(M.blowVulnPerStack));
    expect(one?.nums?.stacks).toBe(1);
    const lone = cryptAuraEffectDescriptor({ id: ILVANE_HARMONY, kind: 'buff_dr', value: 0.3 });
    expect(lone?.nums?.pct).toBe(30);
    const bare = cryptAuraEffectDescriptor({ id: SLIPPERY_GROUND_AURA, kind: 'slow', value: 1 });
    expect(bare?.nums?.grip).toBe(SLIPPERY_DEFAULT_GRIP);
    // The Dirge's silence keeps the generic silence line; anything else falls through.
    expect(cryptAuraEffectDescriptor({ id: ILVANE_DIRGE_SILENCE, kind: 'silence', value: 0 })).toBe(
      null,
    );
    expect(auraEffectDescriptor({ id: ILVANE_DIRGE_SILENCE, kind: 'silence', value: 0 })?.key).toBe(
      'hudChrome.auraEffect.silence',
    );
  });
});

describe("the Lady's loot: the spider leftovers carry bridal frost names", () => {
  const RENAMED: Record<string, string> = {
    bonechill_carapace_vest: 'Bonechill Hauberk',
    rimeweb_hunters_leggings: 'Rime-Laced Leggings',
    rimeweb_fang: "Bride's Icicle",
  };

  it('renames the display names in both English layers, ids frozen', () => {
    const names = en.entities.items as Record<string, { name: string }>;
    for (const [id, name] of Object.entries(RENAMED)) {
      expect(ITEMS[id]?.name).toBe(name);
      expect(names[id]?.name).toBe(name);
    }
    // The heroic twin reads its base name (generated variants never carry their own).
    expect(ITEMS.heroic_rimeweb_fang?.name).toBe("Bride's Icicle");
    // Rimesilk fits a bride's silk and stays.
    expect(ITEMS.rimesilk_mantle?.name).toBe('Rimesilk Mantle');
  });

  it('no Hollow Crypt display name keeps the spider words', () => {
    for (const id of Object.keys(RENAMED))
      expect(ITEMS[id]?.name).not.toMatch(/Rimeweb|Carapace|Fang|Hunter/);
  });
});

// ---- Morthen's Rite Ring and the Knellwyrm's Burning Knell ------------------------

const sceneOf = (over: Partial<CryptAlertScene>): CryptAlertScene => ({
  ...EMPTY_CRYPT_SCENE,
  ...over,
});

describe('the crypt alert view: the Rite Ring (pure)', () => {
  const me = { x: 0, z: 0 };
  const at = (over: Partial<CryptAlertInput>) =>
    buildCryptAlertView(input({ selfId: 1, selfPos: me, ...over }));
  const kindAt = (over: Partial<CryptAlertInput>) => {
    const v = at(over);
    return v.visible ? v.kind : null;
  };

  it('a marked half: inside it (the side its facing points to, within reach) only', () => {
    const half: CryptAlertEntity = {
      templateId: KNELL_HALF_MARK_TEMPLATE,
      pos: { x: 0, z: -10 },
      facing: 0,
      scale: 20,
    };
    // North of the centre is the marked side (yaw 0 faces +z).
    expect(inMarkedHalf(half, { x: 0, z: -2 })).toBe(true);
    expect(inMarkedHalf(half, { x: 5, z: -16 })).toBe(false);
    // Past the reach nothing burns.
    expect(inMarkedHalf(half, { x: 0, z: 12 })).toBe(false);
    // Far under the ring's floor (the Choir Loft below the rim): no warning.
    if (half.pos) {
      const floor = { ...half.pos, y: 24 };
      const marked = { ...half, pos: floor };
      expect(inMarkedHalf(marked, { x: 0, y: 24, z: -2 })).toBe(true);
      expect(inMarkedHalf(marked, { x: 0, y: 5, z: -2 })).toBe(false);
    }
    const wyrm: CryptAlertEntity = {
      castingAbility: KNELLWYRM_KNELL_MARK,
      castRemaining: 1.5,
      castTotal: 4.5,
    };
    const v = live(at({ scene: sceneOf({ halves: [half], knellwyrm: wyrm }) }));
    expect(v.kind).toBe('knell');
    expect(v.title).toBe(t('hudChrome.cryptAlert.knellTitle'));
    expect(v.line).toBe(t('hudChrome.cryptAlert.knellLine'));
    expect(v.progress).toBeCloseTo(1 / 3, 9);
    expect(v.progressAria).toBe(t('hudChrome.cryptAlert.timeAria', { seconds: '2' }));
    // Once it burns the warning is gone (the fire's template is not the mark's).
    const burning = { ...half, templateId: 'crypt_knell_half_fire' };
    expect(at({ scene: sceneOf({ halves: [burning] }) }).visible).toBe(false);
  });

  it("a gathering Grasp ring under the player, anyone's: the bar is their own mark", () => {
    const ring: CryptAlertEntity = {
      templateId: MORTHEN_GRASP_TEMPLATE,
      pos: { x: 3, z: 0 },
      scale: MT.graspRadius,
    };
    const mine = live(
      at({
        auras: [{ id: MORTHEN_GRASP_MARK, remaining: 0.75, duration: MT.graspFuse }],
        scene: sceneOf({ grasps: [ring] }),
      }),
    );
    expect(mine.kind).toBe('grasp');
    expect(mine.line).toBe(t('hudChrome.cryptAlert.graspLine'));
    expect(mine.progress).toBe(0.5);
    // Someone else's ring under the player: the same call, no bar of theirs.
    const theirs = live(at({ scene: sceneOf({ grasps: [ring] }) }));
    expect(theirs.kind).toBe('grasp');
    expect(theirs.progress).toBeNull();
    // Out of the ring (a yard of margin past its radius): nothing, mark or not.
    const far = { ...ring, pos: { x: MT.graspRadius + 1.5, z: 0 } };
    expect(
      at({
        auras: [{ id: MORTHEN_GRASP_MARK, remaining: 1, duration: MT.graspFuse }],
        scene: sceneOf({ grasps: [far] }),
      }).visible,
    ).toBe(false);
    // Erupted hands are a root already, not a ring to leave.
    const hands = { ...ring, templateId: 'crypt_morthen_grasp_hands' };
    expect(at({ scene: sceneOf({ grasps: [hands] }) }).visible).toBe(false);
  });

  it('the Reap: in its arc and not its mark; the tank and anyone behind him see nothing', () => {
    const morthen = (castTargetId: number): CryptAlertEntity => ({
      templateId: MORTHEN_ID,
      pos: { x: 0, z: 8 },
      facing: Math.PI, // toward -z, the player
      castingAbility: MORTHEN_REAP,
      castTargetId,
      castRemaining: 1,
      castTotal: MT.reapCast,
    });
    const v = live(at({ scene: sceneOf({ morthen: morthen(7) }) }));
    expect(v.kind).toBe('reap');
    expect(v.line).toBe(t('hudChrome.cryptAlert.reapLine'));
    expect(v.progress).toBe(0.5);
    // The sweep's own mark (the tank) cannot step out of it.
    expect(at({ scene: sceneOf({ morthen: morthen(1) }) }).visible).toBe(false);
    // Behind him, or past its reach.
    expect(at({ selfPos: { x: 0, z: 14 }, scene: sceneOf({ morthen: morthen(7) }) }).visible).toBe(
      false,
    );
    expect(
      at({
        selfPos: { x: 0, z: 8 - MT.reapRange - 2 },
        scene: sceneOf({ morthen: morthen(7) }),
      }).visible,
    ).toBe(false);
    // A Shadow Pulse bar is not the Reap.
    const pulse = { ...morthen(7), castingAbility: 'crypt_morthen_shadow_pulse' };
    expect(at({ scene: sceneOf({ morthen: pulse }) }).visible).toBe(false);
  });

  it('the Rite: the candles lit out of all of them; on heroic, the Ledger line', () => {
    const chill = [{ id: MORTHEN_GRAVE_CHILL, value: 1, value2: 3 }];
    const candles = (named: boolean): CryptAlertEntity[] => [
      { templateId: RITE_CANDLE_LIT },
      { templateId: named ? RITE_CANDLE_NAMED : RITE_CANDLE_DARK },
      { templateId: RITE_CANDLE_DARK },
      { templateId: RITE_CANDLE_DARK },
    ];
    const normal = live(at({ auras: chill, scene: sceneOf({ candles: candles(false) }) }));
    expect(normal.kind).toBe('rite');
    expect(normal.title).toBe(t('hudChrome.cryptAlert.riteTitle'));
    expect(normal.line).toBe(t('hudChrome.cryptAlert.riteLine', { lit: '1', total: '4' }));
    expect(normal.progress).toBeNull();
    const heroic = live(at({ auras: chill, scene: sceneOf({ candles: candles(true) }) }));
    expect(heroic.kind).toBe('rite-named');
    expect(heroic.line).toBe(t('hudChrome.cryptAlert.riteNamedLine', { lit: '1', total: '4' }));
    // No Grave Chill, no Rite readout.
    expect(at({ scene: sceneOf({ candles: candles(false) }) }).visible).toBe(false);
  });

  it('a Bound Soul in flight within reach of the call', () => {
    const soul = (x: number): CryptAlertEntity => ({
      templateId: MORTHEN_SOUL_TEMPLATE,
      pos: { x, z: 0 },
    });
    const v = live(at({ scene: sceneOf({ souls: [soul(10)] }) }));
    expect(v.kind).toBe('soul');
    expect(v.line).toBe(t('hudChrome.cryptAlert.soulLine'));
    expect(at({ scene: sceneOf({ souls: [soul(SOUL_ALERT_RADIUS + 1)] }) }).visible).toBe(false);
  });

  it('priority: the floor strikes over the target readouts over the soft reminders', () => {
    const ring: CryptAlertEntity = {
      templateId: MORTHEN_GRASP_TEMPLATE,
      pos: { x: 0, z: 0 },
      scale: MT.graspRadius,
    };
    const half: CryptAlertEntity = {
      templateId: KNELL_HALF_MARK_TEMPLATE,
      pos: { x: 0, z: 0 },
      facing: 0,
      scale: 20,
    };
    const soul: CryptAlertEntity = { templateId: MORTHEN_SOUL_TEMPLATE, pos: { x: 1, z: 1 } };
    const tolling: CryptAlertEntity = { templateId: MARROW_ID, auras: [{ id: MARROW_TOLLING }] };
    const chill = [{ id: MORTHEN_GRAVE_CHILL, value: 1, value2: 3 }];
    const target = { targetId: 9, entity: () => tolling };
    const all = sceneOf({ halves: [half], grasps: [ring], souls: [soul] });
    expect(kindAt({ auras: chill, ...target, scene: all })).toBe('knell');
    expect(kindAt({ auras: chill, ...target, scene: { ...all, halves: [] } })).toBe('grasp');
    expect(kindAt({ auras: chill, ...target, scene: sceneOf({ souls: [soul] }) })).toBe('toll');
    expect(kindAt({ auras: chill, scene: sceneOf({ souls: [soul] }) })).toBe('rite');
    expect(kindAt({ scene: sceneOf({ souls: [soul] }) })).toBe('soul');
    // A wing-boss mark still outranks the ring.
    expect(
      kindAt({ auras: [{ id: MARROW_MEASURED, remaining: 1, duration: 4 }], scene: all }),
    ).toBe('measured');
    // Without the player's position the floor reads stay quiet.
    expect(
      buildCryptAlertView(input({ scene: sceneOf({ grasps: [ring], halves: [half] }) })).visible,
    ).toBe(false);
  });

  it('the scene scan walks the roster only when it changes and reads templates live', () => {
    const candle = { kind: 'object', templateId: RITE_CANDLE_DARK };
    const soul = { kind: 'object', templateId: MORTHEN_SOUL_TEMPLATE };
    const lord = { kind: 'mob', templateId: MORTHEN_ID };
    const fallen = { kind: 'mob', templateId: MORTHEN_ID, dead: true };
    const entities = new Map<number, CryptSceneEntity>([
      [1, candle],
      [2, soul],
      [3, fallen],
      [4, lord],
    ]);
    const scan = new CryptAlertSceneScan();
    const scene = scan.update({ entities, entityRosterVersion: 1 });
    expect(scene.candles).toEqual([candle]);
    expect(scene.souls).toEqual([soul]);
    expect(scene.morthen).toBe(lord);
    // A candle catching changes its template, not the roster: read live.
    candle.templateId = RITE_CANDLE_LIT;
    entities.delete(2);
    const same = scan.update({ entities, entityRosterVersion: 1 });
    expect(same).toBe(scene);
    expect(same.candles[0].templateId).toBe(RITE_CANDLE_LIT);
    expect(same.souls).toHaveLength(1);
    // The roster moved: rescanned.
    expect(scan.update({ entities, entityRosterVersion: 2 }).souls).toHaveLength(0);
  });
});

describe('the Rite Ring alert over real fights', () => {
  function sceneWorld(f: Fight): CryptSceneWorld {
    return {
      entities: f.sim.ctx.entities as unknown as CryptSceneWorld['entities'],
      entityRosterVersion: Number.NaN,
    };
  }

  const viewFor = (f: Fight, p: Entity, targetId: number | null = null) =>
    buildCryptAlertView({
      selfId: p.id,
      selfPos: p.pos,
      auras: p.auras,
      targetId,
      entity: (id) => f.sim.ctx.entities.get(id),
      // A fresh scan each read (no roster version to key on in the bare Sim).
      scene: new CryptAlertSceneScan().update(sceneWorld(f)),
    });

  const useViewFor = (f: Fight, p: Entity) =>
    buildKitUsePromptView({
      self: p,
      bodies: new KitUseSceneScan().update({
        entities: f.sim.ctx.entities as unknown as KitUseSceneWorld['entities'],
        entityRosterVersion: Number.NaN,
      }),
      entity: (id) => f.sim.ctx.entities.get(id),
      interactKey: 'F',
      touch: false,
    });

  function morthenFight(difficulty: 'normal' | 'heroic' = 'normal') {
    const f = cryptFight(difficulty, 3, new Set([MORTHEN_ID]));
    cryptDevTrigger(f.sim.ctx, f.inst, 'skip');
    const m = boss(f, MORTHEN_ID);
    put(f, m, MORTHEN_SPOT.x, MORTHEN_SPOT.z);
    put(f, f.tank, MORTHEN_SPOT.x, MORTHEN_SPOT.z - 4);
    const spots = [
      [-24, 205],
      [24, 205],
      [0, 181],
    ];
    for (const [i, p] of f.others.entries()) put(f, p, spots[i][0], spots[i][1]);
    m.maxHp = 1e6;
    m.hp = m.maxHp;
    f.sim.ctx.aggroMob(m, f.tank, false);
    f.sim.drainEvents();
    return { f, m };
  }

  function holdAll(f: Fight): () => void {
    const hold = [f.tank, ...f.others].map((p) => [p, p.pos.x - f.ox, p.pos.z - f.oz] as const);
    return () => {
      for (const [p, x, z] of hold) put(f, p, x, z);
    };
  }

  it('the Rite: everyone reads the candle count, a lighter is offered the relight copy', () => {
    const { f, m } = morthenFight();
    m.hp = Math.floor(m.maxHp * 0.64);
    run(f, 1.1);
    const v = live(viewFor(f, f.others[2]));
    expect(v.kind).toBe('rite');
    expect(v.line).toBe(t('hudChrome.cryptAlert.riteLine', { lit: '0', total: '4' }));
    // The Grave Chill the player wears states the bite they take.
    const d = cryptAuraEffectDescriptor({
      id: MORTHEN_GRAVE_CHILL,
      kind: 'slow',
      value: 1,
      value2: aura(f.others[2], MORTHEN_GRAVE_CHILL)?.value2,
    });
    expect(d?.nums?.bite).toBe(MT.chillBase);
    cryptDevTrigger(f.sim.ctx, f.inst, 'candle');
    run(f, DT);
    expect(live(viewFor(f, f.others[2])).line).toBe(
      t('hudChrome.cryptAlert.riteLine', { lit: '1', total: '4' }),
    );
    // The ward's tooltip counts the same candle.
    const ward = cryptAuraEffectDescriptor({
      id: MORTHEN_UNQUIET_WARD,
      kind: 'buff_dr',
      value: 0,
      value2: aura(m, MORTHEN_UNQUIET_WARD)?.value2,
    });
    expect(ward?.nums?.lit).toBe(1);
    // At a dark candle's foot the use prompt offers the relight, in its own words.
    const lighter = f.others[0];
    const spot = candleBodySpot(1);
    const c = RITE_CANDLE_SPOTS[1];
    const dl = Math.hypot(spot.x - c.x, spot.z - c.z);
    const stand = {
      x: spot.x + ((spot.x - c.x) / dl) * 1.5,
      z: spot.z + ((spot.z - c.z) / dl) * 1.5,
    };
    put(f, lighter, stand.x, stand.z);
    const offer = useViewFor(f, lighter);
    if (!offer.visible || offer.kind !== 'use') throw new Error('no relight offer');
    expect(offer.line).toBe(t('hudChrome.kitUse.relightLine'));
    expect(f.sim.ctx.entities.get(offer.bodyId)?.templateId).toBe(MORTHEN_CANDLE_ID);
    const name = t('entities.mobs.crypt_remembrance_candle.name');
    expect(offer.hint).toBe(t('hudChrome.kitUse.relightKey', { name }));
    expect(offer.buttonAria).toBe(t('hudChrome.kitUse.relightAria', { name }));
    // The relight running: its bar and what does (and does not) break it.
    lighter.targetId = offer.bodyId;
    f.sim.interact(lighter.id);
    expect(lighter.castingAbility).toBe(MORTHEN_RELIGHT_CAST);
    const from = f.hits.length;
    run(f, 1.1, () => put(f, lighter, stand.x, stand.z));
    const using = useViewFor(f, lighter);
    if (!using.visible) throw new Error('no relight bar');
    expect(using.kind).toBe('using');
    expect(using.line).toBe(t('hudChrome.kitUse.relightUsingLine'));
    expect(using.title).toBe(t('abilityUi.cast.kituse_crypt_relight_candle'));
    // The drain the copy names is the lighter's own share, every second.
    const bite = Math.round(lighter.maxHp * MT.relightDrainPct);
    const drains = f.hits
      .slice(from)
      .filter((h) => h.targetId === lighter.id && h.ability === "Candle's Price");
    expect(drains.length).toBeGreaterThanOrEqual(1);
    for (const h of drains) expect(h.amount).toBe(bite);
  });

  it('heroic: the Rite names the Ledger, and Grave Chill bites for the heroic number', () => {
    const { f, m } = morthenFight('heroic');
    const keep = holdAll(f);
    m.hp = Math.floor(m.maxHp * 0.64);
    run(f, DT, keep);
    const from = f.hits.length;
    run(f, 1.05, keep);
    const p = f.others[2];
    expect(live(viewFor(f, p)).kind).toBe('rite-named');
    const d = cryptAuraEffectDescriptor({
      id: MORTHEN_GRAVE_CHILL,
      kind: 'slow',
      value: 1,
      value2: aura(p, MORTHEN_GRAVE_CHILL)?.value2,
    });
    const ticks = f.hits
      .slice(from)
      .filter((h) => h.targetId === p.id && h.ability === 'Grave Chill');
    expect(ticks.length).toBeGreaterThanOrEqual(1);
    for (const h of ticks) expect(h.amount).toBe(d?.nums?.biteHeroic);
  });

  it('the Reap: the player in its arc is warned and hit; the tank and the one behind are not warned', () => {
    const { f, m } = morthenFight();
    const front = f.others[0];
    const behind = f.others[1];
    const hold = () => {
      put(f, f.tank, MORTHEN_SPOT.x, MORTHEN_SPOT.z - 4);
      put(f, front, MORTHEN_SPOT.x + 2, MORTHEN_SPOT.z - 9);
      put(f, behind, MORTHEN_SPOT.x, MORTHEN_SPOT.z + 6);
      put(f, f.others[2], -24, 205);
    };
    hold();
    run(f, DT, hold);
    expect(cryptDevTrigger(f.sim.ctx, f.inst, 'reap')).toMatch(/begins/);
    expect(m.castingAbility).toBe(MORTHEN_REAP);
    run(f, 0.5, hold);
    const v = live(viewFor(f, front));
    expect(v.kind).toBe('reap');
    expect(v.progress).toBeGreaterThan(0);
    expect(viewFor(f, f.tank).visible).toBe(false);
    expect(viewFor(f, behind).visible).toBe(false);
    const from = f.hits.length;
    run(f, MT.reapCast, hold);
    const hit = took(f, front, 'Reap the Unquiet', from);
    expect(hit).toBeGreaterThanOrEqual(MT.reapMin);
    expect(hit).toBeLessThanOrEqual(MT.reapMax);
    expect(took(f, behind, 'Reap the Unquiet', from)).toBe(0);
  });

  it('heroic Grasp: the marked player is told to step out; out of it, the hands miss', () => {
    const { f } = morthenFight('heroic');
    const keep = holdAll(f);
    run(f, DT, keep);
    expect(cryptDevTrigger(f.sim.ctx, f.inst, 'grasp')).toMatch(/Grasp/);
    const marked = f.others.filter((p) => aura(p, MORTHEN_GRASP_MARK));
    expect(marked).toHaveLength(2);
    const [stays, leaves] = marked;
    const v = live(viewFor(f, stays));
    expect(v.kind).toBe('grasp');
    expect(v.progress).toBeGreaterThan(0.9);
    // Ten yards on, out of the ring: the call is gone though the mark runs on.
    const out = { x: leaves.pos.x - f.ox + 10, z: leaves.pos.z - f.oz };
    const hold = () => {
      keep();
      put(f, leaves, out.x, out.z);
    };
    hold();
    expect(aura(leaves, MORTHEN_GRASP_MARK)).toBeDefined();
    expect(viewFor(f, leaves).visible).toBe(false);
    const from = f.hits.length;
    run(f, MT.graspFuse + 0.1, hold);
    const d = cryptAuraEffectDescriptor({ id: MORTHEN_GRASP_MARK, kind: 'slow', value: 1 });
    const hit = took(f, stays, 'Grasp of the Grave', from);
    expect(hit).toBeGreaterThanOrEqual(d?.nums?.min ?? Number.NaN);
    expect(hit).toBeLessThanOrEqual(d?.nums?.max ?? Number.NaN);
    expect(aura(stays, MORTHEN_GRASP_ROOT)).toBeDefined();
    expect(took(f, leaves, 'Grasp of the Grave', from)).toBe(0);
    // Once the hands hold, the ring's call is over.
    expect(viewFor(f, stays).visible).toBe(false);
  });

  it('a Bound Soul on its way is called out', () => {
    const { f } = morthenFight();
    const keep = holdAll(f);
    run(f, DT, keep);
    cryptDevTrigger(f.sim.ctx, f.inst, 'gravecall');
    run(f, DT, keep);
    expect(live(viewFor(f, f.others[0])).kind).toBe('soul');
  });

  it('heroic Burning Knell: the half it marks is warned and burns; the other half is quiet', () => {
    const f = cryptFight('heroic', 3, new Set([MORTHEN_ID]));
    cryptDevTrigger(f.sim.ctx, f.inst, 'skip');
    const m = boss(f, MORTHEN_ID);
    for (const p of [f.tank, ...f.others]) put(f, p, 0, 196);
    run(f, DT);
    f.sim.ctx.handleDeath(m, f.tank);
    run(
      f,
      KNELLWYRM_TUNING.pyreSeconds +
        KNELLWYRM_TUNING.arriveSeconds +
        KNELLWYRM_TUNING.settleSeconds +
        0.5,
    );
    const w = boss(f, KNELLWYRM_ID);
    w.maxHp = 1e7;
    w.hp = w.maxHp;
    f.sim.ctx.aggroMob(w, f.tank, false);
    run(f, DT);
    expect(w.mechanicDamageMult).toBe(cryptHeroicFactor(KNELLWYRM_ID));
    expect(cryptDevTrigger(f.sim.ctx, f.inst, 'knell')).toMatch(/takes wing/);
    run(f, KNELL_TUNING.riseSeconds + DT);
    expect(w.castingAbility).toBe(KNELLWYRM_KNELL_MARK);
    const k = w.knellwyrmFight?.knell;
    if (!k) throw new Error('no knell');
    const yaw = knellHalfYaw(k.half);
    const inside = f.others[0];
    const safe = f.others[1];
    const hot = { x: RITE_RING.x + Math.sin(yaw) * 14, z: RITE_RING.z + Math.cos(yaw) * 14 };
    const hold = () => {
      put(f, inside, hot.x, hot.z);
      put(f, safe, RITE_RING.x - Math.sin(yaw) * 14, RITE_RING.z - Math.cos(yaw) * 14);
      put(f, f.tank, RITE_RING.x - Math.sin(yaw) * 10, RITE_RING.z - Math.cos(yaw) * 10);
      put(f, f.others[2], RITE_RING.x - Math.sin(yaw) * 6, RITE_RING.z - Math.cos(yaw) * 6);
    };
    hold();
    expect(inKnellHalf(k.half, hot.x, hot.z)).toBe(true);
    const v = live(viewFor(f, inside));
    expect(v.kind).toBe('knell');
    expect(v.progress).toBeGreaterThan(0.9);
    expect(viewFor(f, safe).visible).toBe(false);
    expect(viewFor(f, f.tank).visible).toBe(false);
    // The wyrm's airborne aura states the fire it pours, at its heroic factor.
    const d = cryptAuraEffectDescriptor({ id: KNELLWYRM_AIRBORNE, kind: 'buff_dr', value: 0 });
    const from = f.hits.length;
    run(f, KNELL_TUNING.markSeconds + 0.1, hold);
    const burn = took(f, inside, 'Burning Knell', from);
    expect(burn).toBeGreaterThanOrEqual(d?.nums?.min ?? Number.NaN);
    expect(burn).toBeLessThanOrEqual(d?.nums?.max ?? Number.NaN);
    expect(took(f, safe, 'Burning Knell', from)).toBe(0);
    // The half burns now: no warning left to give.
    expect(viewFor(f, inside).visible).toBe(false);
  });
});
