// Gaoler Ossick's chain alert (src/ui/hud/dungeon/gaol_chain_view.ts), pure and
// end to end: the view reads only the auras the sim sets (the Anchored aura
// naming the anchor, the Shackled aura naming the partner and carrying the
// reach), so a real fight drives it exactly as the HUD sees it, offline or
// mirrored online.

import { describe, expect, it, vi } from 'vitest';
import {
  DROWNED_ANCHOR_ID,
  OSSICK_ANCHORED,
  OSSICK_ID,
  OSSICK_SHACKLE,
  OSSICK_SHACKLED,
  OSSICK_TUNING,
} from '../src/sim/encounters/sunken_bastion';
import { DT, type Entity } from '../src/sim/types';
import {
  buildGaolChainView,
  type GaolChainEntity,
  type GaolChainInput,
  type GaolChainView,
  wardHealthText,
  wardHitText,
} from '../src/ui/hud/dungeon/gaol_chain_view';
import { aura, boss, engage, type Fight, fight, put, run } from './helpers/bastion_fight';

vi.setConfig({ testTimeout: 60_000 });

function live(v: GaolChainView) {
  if (!v.visible) throw new Error('hidden');
  return v;
}

describe('the chain alert view (pure)', () => {
  const ent = (over: Partial<GaolChainEntity> = {}): GaolChainEntity => ({
    name: 'Tidewren',
    pos: { x: 0, z: 0 },
    hp: 12,
    maxHp: 12,
    ...over,
  });
  const base: GaolChainInput = {
    selfId: 1,
    selfPos: { x: 0, z: 0 },
    auras: [],
    entity: () => undefined,
    party: null,
  };

  it('hides with no chain on the player or the party', () => {
    expect(buildGaolChainView(base).visible).toBe(false);
    expect(
      buildGaolChainView({ ...base, auras: [{ id: 'bastion_caged', sourceId: 3 }] }).visible,
    ).toBe(false);
  });

  it('anchored: the chain broken so far is the anchor body health lost', () => {
    const v = live(
      buildGaolChainView({
        ...base,
        auras: [{ id: OSSICK_ANCHORED, sourceId: 9 }],
        entity: (id) => (id === 9 ? ent({ hp: 3, maxHp: 12 }) : undefined),
      }),
    );
    expect(v.kind).toBe('anchored');
    expect(v.progress).toBeCloseTo(0.75, 6);
    expect(v.title).toContain('Drowned Anchor');
    // Its health is its links: the alert counts them and states the rule.
    expect(v.count).toBe('Chain links left: 3 of 12');
    expect(v.hint).toContain('one link');
  });

  it('the anchor reads as links everywhere: the target frame and a hit', () => {
    expect(wardHealthText({ templateId: DROWNED_ANCHOR_ID, hp: 9, maxHp: 12 })).toBe(
      '9 of 12 links',
    );
    expect(wardHealthText({ templateId: DROWNED_ANCHOR_ID, hp: 16, maxHp: 16 })).toBe(
      '16 of 16 links',
    );
    // Any other body keeps its usual health text and its number.
    expect(wardHealthText({ templateId: 'gaoler_ossick', hp: 9, maxHp: 12 })).toBeNull();
    expect(wardHitText({ templateId: DROWNED_ANCHOR_ID })).toBe('Link broken!');
    expect(wardHitText({ templateId: 'gaoler_ossick' })).toBeNull();
    expect(wardHitText(null)).toBeNull();
  });

  it('shackled: names the partner and the reach, and turns strained past it', () => {
    const near = live(
      buildGaolChainView({
        ...base,
        auras: [{ id: OSSICK_SHACKLED, sourceId: 4, value2: 8 }],
        entity: (id) => (id === 4 ? ent({ pos: { x: 6, z: 0 } }) : undefined),
      }),
    );
    expect(near.kind).toBe('shackled');
    expect(near.title).toContain('Tidewren');
    expect(near.line).toContain('8');
    expect(near.line).toContain('6');
    expect(near.progress).toBeCloseTo(0.75, 6);
    const far = live(
      buildGaolChainView({
        ...base,
        auras: [{ id: OSSICK_SHACKLED, sourceId: 4, value2: 6 }],
        entity: (id) => (id === 4 ? ent({ pos: { x: 7, z: 0 } }) : undefined),
      }),
    );
    expect(far.kind).toBe('strained');
    expect(far.progress).toBe(1);
    expect(far.line).not.toBe(near.line);
  });

  it('an anchor on the player outranks the shackle; an ally anchor shows last', () => {
    const both = live(
      buildGaolChainView({
        ...base,
        auras: [
          { id: OSSICK_SHACKLED, sourceId: 4, value2: 8 },
          { id: OSSICK_ANCHORED, sourceId: 9 },
        ],
        entity: (id) => ent(id === 9 ? { hp: 12 } : {}),
      }),
    );
    expect(both.kind).toBe('anchored');
    const ally = live(
      buildGaolChainView({
        ...base,
        party: [{ pid: 1 }, { pid: 5 }],
        entity: (id) =>
          id === 5
            ? ent({ name: 'Saltmarrow', auras: [{ id: OSSICK_ANCHORED, sourceId: 9 }] })
            : id === 9
              ? ent({ hp: 6, maxHp: 12 })
              : undefined,
      }),
    );
    expect(ally.kind).toBe('ally');
    expect(ally.line).toContain('Saltmarrow');
    expect(ally.progress).toBeCloseTo(0.5, 6);
  });
});

describe('the chain alert over a real Ossick fight', () => {
  function yard(): { f: Fight; ossick: Entity } {
    const f = fight('normal');
    const ossick = boss(f, OSSICK_ID);
    put(f, ossick, -2, 12);
    put(f, f.tank, -2, 9);
    for (const [i, p] of f.others.entries()) put(f, p, -16 + i * 16, 38);
    engage(f, ossick);
    return { f, ossick };
  }

  const viewFor = (f: Fight, p: Entity) =>
    buildGaolChainView({
      selfId: p.id,
      selfPos: p.pos,
      auras: p.auras,
      entity: (id) => f.sim.ctx.entities.get(id),
      party: [f.tank, ...f.others].map((e) => ({ pid: e.id })),
    });

  it('the hooked player sees the anchor, the group sees the ally, and hits fill the bar', () => {
    const { f } = yard();
    run(f, OSSICK_TUNING.anchorFirst + OSSICK_TUNING.anchorCast + DT * 3);
    const victim = f.others.find((p) => aura(p, OSSICK_ANCHORED));
    if (!victim) throw new Error('nobody anchored');
    const mine = live(viewFor(f, victim));
    expect(mine.kind).toBe('anchored');
    expect(mine.progress).toBe(0);
    const theirs = live(viewFor(f, f.tank));
    expect(theirs.kind).toBe('ally');
    expect(theirs.line).toContain(victim.name);
    // Four hits from the tank break a third of the normal chain.
    const anchor = f.sim.ctx.entities.get(aura(victim, OSSICK_ANCHORED)?.sourceId ?? -1);
    if (!anchor) throw new Error('no anchor');
    for (let i = 0; i < 4; i++)
      f.sim.dealDamage(f.tank, anchor, 500, false, 'physical', 'Strike', 'hit', false);
    expect(live(viewFor(f, victim)).progress).toBeCloseTo(4 / OSSICK_TUNING.anchorHits, 6);
  });

  it('the shackled pair see each other, calm close together and strained apart', () => {
    const { f, ossick } = yard();
    ossick.bastionFight = undefined;
    run(f, DT * 2);
    const st = ossick.bastionFight as Entity['bastionFight'];
    if (st?.kind !== 'ossick') throw new Error('no fight');
    st.anchorTimer = 999;
    st.shackleTimer = 0;
    run(f, DT * 2);
    expect(ossick.castingAbility).toBe(OSSICK_SHACKLE);
    run(f, OSSICK_TUNING.shackleCast + DT);
    const [a, b] = [f.tank, ...f.others].filter((p) => aura(p, OSSICK_SHACKLED));
    put(f, a, -10, 36);
    put(f, b, -4, 36);
    const calm = live(viewFor(f, a));
    expect(calm.kind).toBe('shackled');
    expect(calm.title).toContain(b.name);
    put(f, b, 2, 36);
    expect(live(viewFor(f, a)).kind).toBe('strained');
    expect(live(viewFor(f, b)).kind).toBe('strained');
  });
});
