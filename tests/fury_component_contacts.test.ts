import { expect, it, vi } from 'vitest';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import { ArchetypeSequencer, type SequencerHost } from '../src/render/ability_vfx/sequencer';
import type { AbilityVfxFullSpec } from '../src/render/ability_vfx_core';
import { ABILITIES } from '../src/sim/data';

function performance() {
  const host = new Proxy(
    {
      anchorOf: (id: number, fraction: number, out = { x: 0, y: 0, z: 0 }) =>
        Object.assign(out, { x: id === 1 ? 0 : id === 2 ? 2 : 5, y: fraction * 2, z: 2 }),
      groundYAt: () => 0,
      heldCcBand: () => false,
      overlayCells: () => ({ glow: 0, star: 1, rune: 2, spark: 3 }),
    } as unknown as SequencerHost,
    {
      get(t, k) {
        if (!(k in t)) (t as unknown as Record<PropertyKey, unknown>)[k] = vi.fn();
        return Reflect.get(t, k);
      },
    },
  );
  const sequencer = new ArchetypeSequencer();
  const deps = {
    fx: {
      setDelegates: vi.fn(),
      sequenceInstant: (
        id: string,
        spec: AbilityVfxFullSpec,
        source: number,
        target: number,
        color: number,
        tier: number,
        delay: number,
        outcome: 0 | 1 | 2,
      ) =>
        sequencer.start(
          host,
          id,
          spec,
          source,
          target,
          color,
          tier,
          false,
          delay,
          undefined,
          outcome,
        ),
    },
    vfx: {},
    anchor: () => ({ x: 0, y: 0, z: 0 }),
    localPlayerId: () => 1,
    visualVariantOf: (id: string) => id,
  } as unknown as AbilityVfxDeps;
  return { host, sequencer, painter: new AbilityVfx(deps, () => 0) };
}

it('preserves component order through the real painter and sequencer for every hit/miss combination', () => {
  for (const [id, cuts] of [
    ['raging_gale', 2],
    ['red_harvest', 3],
  ] as const) {
    for (let mask = 0; mask < 1 << cuts; mask++) {
      const { host, sequencer, painter } = performance();
      for (let cut = 0; cut < cuts; cut++) {
        const hit = (mask & (1 << cut)) !== 0;
        expect(
          painter.onDamage({
            abilityId: id,
            ability: ABILITIES[id].name,
            sourceId: 1,
            targetId: 2,
            school: 'physical',
            amount: hit ? 150 : 0,
            kind: hit ? 'hit' : 'miss',
            crit: false,
          }),
        ).toBe(true);
      }
      for (let frame = 0; frame < 46; frame++) sequencer.update(host, 1 / 60);
      const expected = Array.from({ length: cuts }, (_, i) => i).filter((i) => mask & (1 << i));
      expect(
        vi.mocked(host.contact!).mock.calls.map((call) => call[5]),
        `${id}:${mask}`,
      ).toEqual(expected);
      expect(
        vi.mocked(host.abilityAudio!).mock.calls.filter((call) => call[0] === 'impact'),
      ).toHaveLength(expected.length);
      expect(host.weaponTrail).toHaveBeenCalledTimes(2);
      if (!mask) {
        expect(host.burstAt).not.toHaveBeenCalled();
        expect(host.crestAt).not.toHaveBeenCalled();
        expect(host.shakeAt).not.toHaveBeenCalled();
      }
    }
  }
});

it('shows an absorbed contact without blood, a flesh wound or victim hitstop', () => {
  const { host, sequencer, painter } = performance();
  for (let cut = 0; cut < 2; cut++)
    painter.onDamage({
      abilityId: 'raging_gale',
      ability: ABILITIES.raging_gale.name,
      sourceId: 1,
      targetId: 2,
      school: 'physical',
      amount: 0,
      absorbed: 150,
      kind: 'hit',
      crit: false,
    });
  for (let frame = 0; frame < 46; frame++) sequencer.update(host, 1 / 60);
  expect(host.flipbookAt).toHaveBeenCalledTimes(2);
  expect(host.contact).not.toHaveBeenCalled();
  expect(host.burstAt).not.toHaveBeenCalled();
  expect(host.crestAt).not.toHaveBeenCalled();
});

it('attributes contacts to the correct target when primary and secondary events are interleaved with hit, miss, and absorbed outcomes', () => {
  // raging_gale: t2=[hit,absorbed], t3=[miss,hit]; red_harvest: t2=[hit,miss,absorbed], t3=[absorbed,hit,miss].
  // Events for t2 and t3 are interleaved one-per-cut so the sameCast dedup window is always open.
  // The host anchor returns x=2 for target 2 and x=5 for target 3, so blood and shake positions
  // are unambiguously attributable. Secondary fury slots never call shakeAt but do mark their own hit victims - only
  // the primary slot's physicalRelease fires weaponTrail and only the primary hit path calls both.
  const plans = [
    {
      id: 'raging_gale' as const,
      t2: ['hit', 'absorbed'] as const,
      t3: ['miss', 'hit'] as const,
    },
    {
      id: 'red_harvest' as const,
      t2: ['hit', 'miss', 'absorbed'] as const,
      t3: ['absorbed', 'hit', 'miss'] as const,
    },
  ];

  for (const { id, t2: t2Out, t3: t3Out } of plans) {
    const { host, sequencer, painter } = performance();

    const send = (targetId: number, outcome: 'hit' | 'miss' | 'absorbed') =>
      painter.onDamage({
        abilityId: id,
        ability: ABILITIES[id].name,
        sourceId: 1,
        targetId,
        school: 'physical',
        amount: outcome === 'hit' ? 150 : 0,
        ...(outcome === 'absorbed' ? { absorbed: 150 } : {}),
        kind: outcome === 'miss' ? 'miss' : 'hit',
        crit: false,
      });

    for (let cut = 0; cut < t2Out.length; cut++) {
      send(2, t2Out[cut]);
      send(3, t3Out[cut]);
    }

    for (let frame = 0; frame < 46; frame++) sequencer.update(host, 1 / 60);

    const contacts = vi.mocked(host.contact!).mock.calls;
    const t2Contacts = contacts.filter((c) => c[1] === 2);
    const t3Contacts = contacts.filter((c) => c[1] === 3);

    const t2HitBeats = t2Out.map((o, i) => (o === 'hit' ? i : -1)).filter((b) => b >= 0);
    const t3HitBeats = t3Out.map((o, i) => (o === 'hit' ? i : -1)).filter((b) => b >= 0);

    // Contacts carry the correct targetId and beat index for every hit outcome.
    expect(
      t2Contacts.map((c) => c[5]),
      `${id}: t2 contact beats`,
    ).toEqual(t2HitBeats);
    expect(
      t3Contacts.map((c) => c[5]),
      `${id}: t3 contact beats`,
    ).toEqual(t3HitBeats);

    // Wounds belong to each successful recipient, including secondary victims.
    const blood = vi.mocked(host.burstAt!).mock.calls.filter((c) => c[6] === 'blood');
    expect(blood.filter((c) => Math.abs(c[0] - 2) < 0.01)).toHaveLength(t2HitBeats.length);
    expect(blood.filter((c) => Math.abs(c[0] - 5) < 0.01)).toHaveLength(t3HitBeats.length);
    expect(blood).toHaveLength(t2HitBeats.length + t3HitBeats.length);
    const shields = vi.mocked(host.flipbookAt).mock.calls.filter((c) => c[5] === 'contact_crush');
    expect(shields.filter((c) => c[0] === 2)).toHaveLength(
      t2Out.filter((o) => o === 'absorbed').length,
    );
    expect(shields.filter((c) => c[0] === 5)).toHaveLength(
      t3Out.filter((o) => o === 'absorbed').length,
    );

    // weaponTrail fires from the primary slot's physicalRelease only (both hands = 2 calls).
    expect(host.weaponTrail, `${id}: primary-only weaponTrail`).toHaveBeenCalledTimes(2);

    // shakeAt fires on primary hits only; secondary furyBeat path omits it.
    const shakes = vi.mocked(host.shakeAt!).mock.calls;
    expect(shakes.length, `${id}: shake count matches primary hit count`).toBe(t2HitBeats.length);
    for (const s of shakes) expect(s[0], `${id}: shake x at target 2`).toBeCloseTo(2, 1);
  }
});

it('overflow cannot wrap a later hit into an earlier missed component', () => {
  for (const id of ['raging_gale', 'red_harvest'] as const) {
    const { host, sequencer, painter } = performance();
    // The seventeenth hit would OR into beat zero without the component cap.
    // A zero outcome cannot demonstrate this bug: OR-ing zero changes nothing.
    for (let event = 0; event < 17; event++) {
      const hit = event === 1 || event === 16;
      painter.onDamage({
        abilityId: id,
        ability: ABILITIES[id].name,
        sourceId: 1,
        targetId: 2,
        school: 'physical',
        amount: hit ? 150 : 0,
        kind: hit ? 'hit' : 'miss',
        crit: false,
      });
    }
    for (let frame = 0; frame < 46; frame++) sequencer.update(host, 1 / 60);
    expect(vi.mocked(host.contact!).mock.calls.map((c) => c[5])).toEqual([1]);
    expect(vi.mocked(host.burstAt!).mock.calls.filter((c) => c[6] === 'blood')).toHaveLength(1);
  }
});
