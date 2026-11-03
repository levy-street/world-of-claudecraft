// The Guardian of the Quench's frost pass (team feedback of 2026-11-04, on a
// REAL Sim via tests/helpers/quench_fight.ts; encounters/smith_heart/
// quench_cold.ts, quench_bite.ts, quench_cold_dev.ts):
//   - immunities are never warmth: each class immunity and defensive, one by
//     one, neither lowers the bar nor skips the freeze, and a stasis body
//     gives and takes no warmth; Cold Coffin (the real cast) cannot clear the
//     cold and is cracked by the rime, before the freeze and inside it;
//   - the stickier cold (faster alone, slower in a huddle), pinned to its
//     literals;
//   - the harsher freeze: 6 s, double damage taken while encased, a bigger
//     shatter that is still not lethal on Normal for a topped-up cloth body;
//   - the splash: its mark, one per tick, and a chain that stays bounded;
//   - the dev verbs and what the player's own alert says.

import { describe, expect, it } from 'vitest';
import { TEMPORAL_HOURGLASS_ID } from '../src/sim/combat/temporal_hourglass';
import { ABILITIES } from '../src/sim/content/classes';
import { TRINKET_AURA } from '../src/sim/content/trinkets';
import {
  QUENCH_AURAS,
  QUENCH_CUES,
  QUENCH_DIFFICULTY,
  QUENCH_NAMES,
  QUENCH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { warded } from '../src/sim/encounters/smith_heart/quench_bite';
import { type Aura, DT, type Entity, type SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { buildQuenchAlertView } from '../src/ui/hud/dungeon/quench_alert_view';
import { t } from '../src/ui/i18n';
import { hitsOf } from './helpers/council_fight';
import { type QuenchFight, quenchFight } from './helpers/quench_fight';

const has = (e: Entity, id: string) => e.auras.some((a) => a.id === id);
const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);
const ticks = (s: number) => Math.round(s / DT);

function pulled(n = 6, seed = 29, classes: Parameters<typeof quenchFight>[2] = []): QuenchFight {
  const f = quenchFight(n, seed, classes);
  expect(f.dev('/dev heart quench pull')).toBe(true);
  f.tick(ticks(T.rimRise) + 2);
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.breathTimer = 999;
  st.slashTimer = 999;
  return f;
}

const coldOf = (f: QuenchFight, e: Entity) => f.state()?.chill[e.id]?.cold ?? 0;
function setCold(f: QuenchFight, e: Entity, v: number): void {
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.chill[e.id] = { cold: v, frozen: 0 };
}

/** The auras an ability's own effects put on its caster (content data, so a
 *  balance change to the ability is what the test sees). */
function aurasOf(abilityId: string, casterId: number): Aura[] {
  const def = ABILITIES[abilityId];
  if (!def) throw new Error(`no ability ${abilityId}`);
  const out: Aura[] = [];
  def.effects.forEach((eff, i) => {
    const e = eff as {
      type: string;
      kind?: Aura['kind'];
      value?: number;
      amount?: number;
      duration?: number;
    };
    const base = {
      remaining: e.duration ?? 10,
      duration: e.duration ?? 10,
      sourceId: casterId,
      school: def.school,
    };
    if (e.type === 'selfBuff' || e.type === 'buffTarget')
      out.push({
        ...base,
        id: `${abilityId}_${i}`,
        name: def.name,
        kind: e.kind as Aura['kind'],
        value: e.value ?? 0,
      });
    else if (e.type === 'absorb')
      out.push({
        ...base,
        id: `${abilityId}_${i}`,
        name: def.name,
        kind: 'absorb',
        value: e.amount ?? 300,
      });
  });
  if (out.length === 0) throw new Error(`${abilityId} puts no aura on its caster`);
  return out;
}

/** Three players in a huddle (a, b, c), the rest far apart. */
function huddle(f: QuenchFight): [Entity, Entity, Entity] {
  const [, , a, b, c] = f.players;
  f.put(a, 184, 14);
  f.put(b, 186, 14);
  f.put(c, 185, 16);
  f.tick(1);
  return [a, b, c];
}

describe('Quench frost pass: the stickier cold', () => {
  it('rises faster alone and falls slower in a huddle than before (fill 30 s to 24 s, fall 6 to 4)', () => {
    expect(T.coldMax / T.coldRise).toBeCloseTo(24);
    expect(T.coldFall).toBe(4);
    expect(T.coldMax / T.coldRise).toBeLessThan(30);
    expect(T.coldFall).toBeLessThan(6);
  });
});

describe('Quench frost pass: immunities are never warmth', () => {
  // Every class immunity, damage cut, absorb and cheat-death a raider can
  // press in this fight: none moves the bar, none skips the freeze.
  const DEFENSIVES = [
    'shellskin', // hunter: 60% damage cut
    'deterrence', // hunter: Bristleguard
    'cloak_of_shadows', // rogue: Shadecloak
    'divine_protection', // paladin: Ward of Faith
    'sacred_bulwark', // paladin: cheat-death ward
    'martyrs_aegis', // priest
    'power_word_shield', // priest
    'elemental_trance', // shaman
    'cinderhide', // warlock
    'furious_mending', // warrior
  ];

  for (const id of DEFENSIVES) {
    it(`${id}: the bar rises alone exactly as bare, and a full bar still freezes`, () => {
      const f = pulled(6);
      const [, , a, b] = f.players;
      f.put(a, 182, 14);
      f.put(b, 214, 14);
      f.tick(1);
      for (const x of aurasOf(id, a.id)) f.sim.ctx.applyAura(a, { ...x, remaining: 60 });
      setCold(f, a, 40);
      setCold(f, b, 40);
      f.tick(ticks(2));
      expect(coldOf(f, a)).toBeCloseTo(coldOf(f, b), 5);
      expect(coldOf(f, a)).toBeGreaterThan(40);
      setCold(f, a, T.coldMax - 0.05);
      f.tick(2);
      expect(has(a, QUENCH_AURAS.frozen)).toBe(true);
    });
  }

  it('a body in stasis (Temporal Hourglass) gives no warmth and takes none: its bar rises in a huddle', () => {
    const f = pulled(6);
    const [a, b, c] = huddle(f);
    expect(has(a, QUENCH_AURAS.warmth)).toBe(true);
    setCold(f, a, 50);
    setCold(f, b, 50);
    f.sim.ctx.applyAura(a, {
      id: TEMPORAL_HOURGLASS_ID,
      name: 'Temporal Hourglass',
      kind: 'stasis',
      remaining: 6,
      duration: 6,
      value: 0,
      sourceId: c.id,
      school: 'arcane',
    });
    expect(warded(a)).toBe(true);
    f.tick(ticks(2));
    // a rises as if alone; b, with only c left as a warm body, rises too.
    expect(coldOf(f, a)).toBeGreaterThan(50 + T.coldRise * 1.8);
    expect(has(a, QUENCH_AURAS.warmth)).toBe(false);
    expect(coldOf(f, b)).toBeGreaterThan(50);
    expect(has(b, QUENCH_AURAS.warmth)).toBe(false);
  });

  it('a scripted damage immunity is no warmth either', () => {
    const f = pulled(6);
    const [a] = huddle(f);
    setCold(f, a, 30);
    a.damageImmune = true;
    f.tick(ticks(1));
    expect(coldOf(f, a)).toBeGreaterThan(30);
    a.damageImmune = false;
  });

  it('Cold Coffin (the real cast) cannot clear the cold, and a full bar inside it freezes and cracks it', () => {
    const f = pulled(6, 29, ['warrior', 'warrior', 'mage']);
    const m = f.players[2];
    f.sim.setPlayerLevel(20, m.id);
    f.put(m, 182, 14);
    f.tick(1);
    setCold(f, m, 80);
    f.tick(1);
    m.gcdRemaining = 0;
    m.resource = m.maxResource;
    f.sim.castAbility('ice_block', m.id);
    expect(m.auras.some((a) => a.kind === 'stasis')).toBe(true);
    // The cleanse took nothing of the cold.
    expect(has(m, QUENCH_AURAS.cold)).toBe(true);
    expect(coldOf(f, m)).toBeGreaterThan(79);
    // It keeps rising inside the coffin, then the rime takes over.
    const ev: SimEvent[] = [];
    for (let i = 0; i < ticks(6) && !has(m, QUENCH_AURAS.frozen); i++) ev.push(...f.tick(1));
    expect(has(m, QUENCH_AURAS.frozen)).toBe(true);
    expect(m.auras.some((a) => a.kind === 'stasis')).toBe(false);
    expect(
      ev.some((e) => e.type === 'spellfx' && e.ability === QUENCH_CUES.bite && e.targetId === m.id),
    ).toBe(true);
    // The shatter's hit lands in full (no stasis to eat it).
    const out = f.tick(ticks(T.freezeSeconds) + 2);
    expect(hitsOf(out, QUENCH_NAMES.shatter, m.id).some((n) => n > 0)).toBe(true);
    expect(aura(m, QUENCH_AURAS.brittle)?.value).toBeCloseTo(T.brittlePct);
  });

  it('Cold Coffin pressed inside the ice is cracked at once: the frozen still take the shatter', () => {
    const f = pulled(6, 29, ['warrior', 'warrior', 'mage']);
    const m = f.players[2];
    f.sim.setPlayerLevel(20, m.id);
    f.put(m, 182, 14);
    f.tick(1);
    f.dev('/dev heart quench burst', m.id);
    f.tick(2);
    expect(has(m, QUENCH_AURAS.frozen)).toBe(true);
    m.gcdRemaining = 0;
    m.resource = m.maxResource;
    f.sim.castAbility('ice_block', m.id);
    // The frozen aura is unbreakable: the cleanse left it.
    expect(has(m, QUENCH_AURAS.frozen)).toBe(true);
    f.tick(1);
    expect(m.auras.some((a) => a.kind === 'stasis')).toBe(false);
    const out = f.tick(ticks(T.freezeSeconds));
    expect(hitsOf(out, QUENCH_NAMES.shatter, m.id).some((n) => n > 0)).toBe(true);
  });

  it("an unbreakable stasis (the Barrowstone statue's death save) is the owner's and stays", () => {
    const f = pulled(6);
    const a = f.players[2];
    f.put(a, 182, 14);
    f.tick(1);
    f.sim.ctx.applyAura(a, {
      id: TRINKET_AURA.stoneStatue,
      name: 'Stone Statue',
      kind: 'stasis',
      remaining: 5,
      duration: 5,
      value: 0,
      sourceId: a.id,
      school: 'physical',
      unbreakableControl: true,
    });
    f.dev('/dev heart quench burst', a.id);
    expect(has(a, TRINKET_AURA.stoneStatue)).toBe(true);
  });

  it('no dispel or cleanse takes the cold, the freeze, the brittle or the splash mark', () => {
    for (const id of [
      QUENCH_AURAS.cold,
      QUENCH_AURAS.frozen,
      QUENCH_AURAS.brittle,
      QUENCH_AURAS.splashed,
      QUENCH_AURAS.trapped,
    ]) {
      const f = pulled(6);
      const a = f.players[2];
      f.put(a, 182, 14);
      f.tick(1);
      if (id === QUENCH_AURAS.frozen || id === QUENCH_AURAS.brittle)
        f.dev('/dev heart quench burst', a.id);
      else if (id === QUENCH_AURAS.splashed) {
        f.put(f.players[3], 183, 14);
        f.dev('/dev heart quench splash', f.players[3].id);
      } else if (id === QUENCH_AURAS.trapped) {
        f.dev('/dev heart quench hole', a.id);
        f.tick(2);
      }
      const x = aura(a, id);
      expect(x, id).toBeDefined();
      expect(x?.undispellable || x?.unbreakableControl, id).toBe(true);
    }
  });
});

describe('Quench frost pass: the harsher freeze', () => {
  it('lasts 6 s and doubles every hit taken while encased; the shatter lands on the plain body', () => {
    const f = pulled(6);
    const [, , a, b] = f.players;
    f.put(a, 182, 14);
    f.put(b, 214, 14);
    f.tick(1);
    const hit = (e: Entity) => {
      e.hp = 5000;
      const before = e.hp;
      f.sim.ctx.dealDamage(f.boss(), e, 100, false, 'frost', 'Test', 'hit', true);
      return before - e.hp;
    };
    const plain = hit(b);
    f.dev('/dev heart quench burst', a.id);
    expect(aura(a, QUENCH_AURAS.frozen)?.remaining).toBeCloseTo(T.freezeSeconds);
    expect(hit(a)).toBeCloseTo(plain * (1 + T.frozenPct), -1);
    expect(T.freezeSeconds).toBe(6);
    expect(T.frozenPct).toBe(1);
  });

  it('the shatter is never lethal alone on Normal for a topped-up level-20 cloth body, but hurts', () => {
    const CLOTH = 1135;
    expect(T.shatterMax * QUENCH_DIFFICULTY.normal.damageMult).toBeLessThan(CLOTH * 0.4);
    expect(T.shatterMax * QUENCH_DIFFICULTY.heroic.damageMult).toBeLessThan(CLOTH * 0.5);
    expect(T.shatterMin).toBeGreaterThan(260);
    // The real roll on a 1,135-health body.
    const f = pulled(6);
    const a = f.players[2];
    f.put(a, 182, 14);
    f.tick(1);
    f.dev('/dev heart quench burst', a.id);
    a.maxHp = CLOTH;
    a.hp = CLOTH;
    const out: SimEvent[] = [];
    for (let i = 0; i < ticks(T.freezeSeconds) + 2; i++) out.push(...f.sim.tick());
    expect(a.dead).toBe(false);
    const dealt = hitsOf(out, QUENCH_NAMES.shatter, a.id);
    expect(dealt.length).toBe(1);
    expect(dealt[0]).toBeGreaterThanOrEqual(T.shatterMin - 1);
  });
});

describe('Quench frost pass: the splash', () => {
  it('marks each ally it struck with the cold it added and whose ice broke', () => {
    const f = pulled(6);
    const [, , a, b, c] = f.players;
    f.put(a, 182, 14);
    f.put(b, 184, 14);
    f.put(c, 182 + QUENCH_DIFFICULTY.normal.splashR + 3, 14);
    f.tick(1);
    setCold(f, b, 10);
    f.dev('/dev heart quench splash', a.id);
    const mark = aura(b, QUENCH_AURAS.splashed);
    expect(mark?.value).toBe(QUENCH_DIFFICULTY.normal.splashCold);
    expect(mark?.value2).toBe(a.id);
    expect(mark?.remaining).toBeCloseTo(T.splashMarkSeconds);
    expect(has(c, QUENCH_AURAS.splashed)).toBe(false);
    expect(coldOf(f, b)).toBeCloseTo(10 + QUENCH_DIFFICULTY.normal.splashCold, 0);
    // Stronger than before (25 normal, 45 heroic).
    expect(QUENCH_DIFFICULTY.normal.splashCold).toBe(35);
    expect(QUENCH_DIFFICULTY.heroic.splashCold).toBe(55);
  });

  it('heroic: a whole huddle shattering at once splashes each player once, and nobody refreezes', () => {
    const f = pulled(8);
    f.dev('/dev heart quench heroic');
    const ring = f.players.slice(2);
    ring.forEach((p, i) => {
      f.put(p, 190 + (i % 3) * 2, 14 + Math.floor(i / 3) * 2);
    });
    f.tick(1);
    // Everyone freezes in the same tick (a careless huddle at full).
    const st = f.state();
    if (!st) throw new Error('no fight');
    for (const p of ring) f.dev('/dev heart quench burst', p.id);
    expect(st.chill[ring[0].id].frozen).toBe(st.chill[ring[ring.length - 1].id].frozen);
    f.tick(2);
    for (const p of ring) expect(has(p, QUENCH_AURAS.frozen)).toBe(true);
    // The wave: all shatter in one tick.
    const out = f.tick(ticks(T.freezeSeconds) + 1);
    for (const p of ring) {
      expect(hitsOf(out, QUENCH_NAMES.shatter, p.id).length).toBe(1);
      expect(has(p, QUENCH_AURAS.frozen)).toBe(false);
      // One splash only, stopped short of full by the brittle.
      expect(coldOf(f, p)).toBeLessThanOrEqual(QUENCH_DIFFICULTY.heroic.splashCold + 1);
      expect(coldOf(f, p)).toBeLessThan(T.coldMax);
    }
    // And the wave never comes back while the brittle lasts.
    const later = f.tick(ticks(8));
    for (const p of ring) expect(hitsOf(later, QUENCH_NAMES.shatter, p.id)).toEqual([]);
  });

  it('a Frost-Brittle player is never frozen by a splash (one short of full); a bare one is', () => {
    const f = pulled(6);
    f.dev('/dev heart quench heroic');
    const [, , a, b, c] = f.players;
    f.put(a, 182, 14);
    f.put(b, 184, 14);
    f.put(c, 183, 16);
    f.tick(1);
    f.sim.ctx.applyAura(b, {
      id: QUENCH_AURAS.brittle,
      name: QUENCH_NAMES.brittle,
      kind: 'vulnerability',
      remaining: 10,
      duration: 10,
      value: T.brittlePct,
      sourceId: f.boss().id,
      school: 'frost',
      undispellable: true,
    });
    setCold(f, b, 90);
    setCold(f, c, 90);
    f.dev('/dev heart quench splash', a.id);
    expect(has(b, QUENCH_AURAS.frozen)).toBe(false);
    expect(coldOf(f, b)).toBeCloseTo(T.coldMax - 1, 5);
    expect(has(c, QUENCH_AURAS.frozen)).toBe(true);
  });
});

describe('Quench frost pass: dev verbs and the own alert', () => {
  it('immune, splash, chain and huddle each do what they say', () => {
    const f = pulled(6);
    const me = f.players[0];
    f.put(me, 182, 14);
    f.tick(1);
    expect(f.dev('/dev heart quench huddle', me.id)).toBe(true);
    f.tick(2);
    expect(has(me, QUENCH_AURAS.warmth)).toBe(true);
    expect(f.dev('/dev heart quench immune', me.id)).toBe(true);
    expect(me.auras.some((a) => a.kind === 'stasis')).toBe(true);
    const c0 = coldOf(f, me);
    f.tick(ticks(1));
    expect(coldOf(f, me)).toBeGreaterThan(c0);
    expect(has(me, QUENCH_AURAS.warmth)).toBe(false);
    expect(f.dev('/dev heart quench chain 95', me.id)).toBe(true);
    expect(has(me, QUENCH_AURAS.frozen)).toBe(true);
    expect(me.auras.some((a) => a.kind === 'stasis')).toBe(false);
    for (const p of f.players.slice(1)) expect(coldOf(f, p)).toBeGreaterThanOrEqual(94);
    f.tick(ticks(T.freezeSeconds) + 1);
    expect(f.players.slice(1).some((p) => has(p, QUENCH_AURAS.frozen))).toBe(true);
    expect(f.dev('/dev heart quench splash', f.players[5].id)).toBe(true);
  });

  it("the player's own alert says the splash and that an immunity does not stop the cold", () => {
    const base = [{ id: QUENCH_AURAS.cold, value: 40, value2: 1 }];
    const plain = buildQuenchAlertView({ auras: base });
    const splashed = buildQuenchAlertView({
      auras: [...base, { id: QUENCH_AURAS.splashed, value: 35, value2: 9 }],
    });
    const sealed = buildQuenchAlertView({ auras: [...base, { id: 'ice_block', kind: 'stasis' }] });
    if (!plain.visible || !splashed.visible || !sealed.visible) throw new Error('hidden');
    expect(splashed.title).toBe(t('hudChrome.quenchAlert.splashTitle', { cold: '35' }));
    expect(splashed.title).toContain('35');
    expect(sealed.line).toBe(t('hudChrome.quenchAlert.immuneLine'));
    expect(plain.line).not.toBe(sealed.line);
  });

  it('the tooltips say the new rules with the live numbers', () => {
    const say = (id: string, value?: number) => {
      const d = auraEffectDescriptor({ id, kind: 'internal_cd', value: value ?? 0 });
      const text = t(d?.key as never, d?.nums as never);
      expect(text).not.toMatch(/\{\w+\}/);
      return text;
    };
    const frozen = say(QUENCH_AURAS.frozen, 6);
    expect(frozen).toContain(`${Math.round(T.frozenPct * 100)}% more damage`);
    expect(frozen).toContain(`${T.shatterMin} to ${T.shatterMax}`);
    expect(frozen).toContain(
      `${Math.round(T.brittlePct * 100)}% more damage for ${T.brittleSeconds} sec`,
    );
    expect(frozen).toContain('no immunity holds');
    expect(say(QUENCH_AURAS.cold, 20)).toContain('Cold Coffin');
    expect(say(QUENCH_AURAS.brittle, 0.3)).toContain('30% more damage');
    expect(say(QUENCH_AURAS.splashed, 35)).toContain('+35 cold');
  });
});
