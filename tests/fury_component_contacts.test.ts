import { expect, it, vi } from 'vitest';
import { FuryAudioQueue } from '../src/render/ability_vfx/fury_audio';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import { ArchetypeSequencer, type SequencerHost } from '../src/render/ability_vfx/sequencer';
import type { AbilityVfxFullSpec } from '../src/render/ability_vfx_core';
import { ABILITIES } from '../src/sim/data';

function performance(variant = 'red_harvest') {
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
    fx: new Proxy(
      {
        update: (dt: number) => sequencer.update(host, dt),
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
      { get: (t, k) => (k in t ? Reflect.get(t, k) : Reflect.get(host, k)) },
    ),
    audioReady: (key: string) => key.includes('red_harvest'),
    vfx: {},
    anchor: () => ({ x: 0, y: 0, z: 0 }),
    localPlayerId: () => 1,
    visualVariantOf: (id: string) => (id === 'red_harvest' ? variant : id),
    hasGestureClip: () => true,
    triggerAttack: vi.fn(),
  } as unknown as AbilityVfxDeps;
  return { host, sequencer, deps, painter: new AbilityVfx(deps, () => 0) };
}

it('preserves Twinstrike component order and collapses every Harvest hit/miss combination to one confirmed finale', () => {
  for (const [id, cuts] of [
    ['raging_gale', 2],
    ['red_harvest', 3],
  ] as const) {
    for (let mask = 0; mask < 1 << cuts; mask++) {
      const { host, painter } = performance();
      if (id === 'red_harvest')
        painter.handleSpellfx({
          ability: id,
          fx: 'selfCast',
          sourceId: 1,
          targetId: 2,
          school: 'physical',
        });
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
      for (let frame = 0; frame < 46; frame++) painter.update(1 / 60);
      const expected =
        id === 'red_harvest'
          ? mask
            ? [2]
            : []
          : Array.from({ length: cuts }, (_, i) => i).filter((i) => mask & (1 << i));
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
        if (id === 'red_harvest')
          expect(vi.mocked(host.crestAt!).mock.calls.map((call) => call[7])).toEqual([
            'harvest_cut',
            'harvest_cut',
          ]);
        else expect(host.crestAt).not.toHaveBeenCalled();
        expect(host.shakeAt).not.toHaveBeenCalled();
      }
    }
  }
});

it('shows an absorbed contact without blood, a flesh wound or victim hitstop', () => {
  const { host, painter } = performance();
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
  for (let frame = 0; frame < 46; frame++) painter.update(1 / 60);
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
    const { host, painter } = performance();
    if (id === 'red_harvest')
      painter.handleSpellfx({
        ability: id,
        fx: 'selfCast',
        sourceId: 1,
        targetId: 2,
        school: 'physical',
      });

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

    for (let frame = 0; frame < 46; frame++) painter.update(1 / 60);

    const contacts = vi.mocked(host.contact!).mock.calls;
    const t2Contacts = contacts.filter((c) => c[1] === 2);
    const t3Contacts = contacts.filter((c) => c[1] === 3);

    const t2HitBeats =
      id === 'red_harvest'
        ? [2]
        : t2Out.map((o, i) => (o === 'hit' ? i : -1)).filter((b) => b >= 0);
    const t3HitBeats =
      id === 'red_harvest'
        ? [2]
        : t3Out.map((o, i) => (o === 'hit' ? i : -1)).filter((b) => b >= 0);

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
      id === 'red_harvest' ? 0 : t2Out.filter((o) => o === 'absorbed').length,
    );
    expect(shields.filter((c) => c[0] === 5)).toHaveLength(
      0, // Twinstrike has no secondary absorption here; Harvest merges it into its real hit.
    );

    // weaponTrail fires from the primary slot's physicalRelease only (both hands = 2 calls).
    expect(host.weaponTrail, `${id}: primary-only weaponTrail`).toHaveBeenCalledTimes(2);

    // Red Harvest reserves its camera impulse for a successful final primary
    // contact. A missed/absorbed finale must not invent a camera impact.
    const shakes = vi.mocked(host.shakeAt!).mock.calls;
    expect(shakes.length, `${id}: shake count matches primary hit count`).toBe(
      id === 'red_harvest' ? t2HitBeats.filter((beat) => beat === 2).length : t2HitBeats.length,
    );
    for (const s of shakes) expect(s[0], `${id}: shake x at target 2`).toBeCloseTo(2, 1);
  }
});

it('overflow cannot wrap Twinstrike into an earlier beat or duplicate a Harvest explosion', () => {
  for (const id of ['raging_gale', 'red_harvest'] as const) {
    const { host, painter } = performance();
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
    for (let frame = 0; frame < 46; frame++) painter.update(1 / 60);
    expect(vi.mocked(host.contact!).mock.calls.map((c) => c[5])).toEqual(
      id === 'red_harvest' ? [2] : [1],
    );
    expect(vi.mocked(host.burstAt!).mock.calls.filter((c) => c[6] === 'blood')).toHaveLength(1);
  }
});

it.each([1 / 60, 0.05, 0.1, 0.25, 0.6])(
  'keeps every recorded cut on its visual frame at dt %s',
  (dt) => {
    for (const [id, count] of [
      ['raging_gale', 2],
      ['red_harvest', 3],
    ] as const) {
      const { host, painter } = performance();
      const queue = new FuryAudioQueue();
      for (let cut = 0; cut < count; cut++) {
        const event = {
          abilityId: id,
          ability: ABILITIES[id].name,
          sourceId: 1,
          targetId: 2,
          school: 'physical' as const,
          amount: 150,
          kind: 'hit' as const,
          crit: false,
        };
        painter.onDamage(event);
        if (id !== 'red_harvest')
          expect(queue.reserve(host, event, id, 1, 2, 1, () => true)).toBe(true);
      }
      let contacts = 0,
        recordings = 0;
      for (let age = 0; age < 0.8; age += dt) {
        painter.update(dt);
        queue.update(host, dt);
        const nextContacts = vi.mocked(host.contact!).mock.calls.length;
        const nextRecordings = vi
          .mocked(host.abilityAudio!)
          .mock.calls.filter((call) => call[0] === 'impact' && call[6]?.sample).length;
        expect(nextRecordings - recordings, `${id} at ${age + dt}`).toBe(nextContacts - contacts);
        contacts = nextContacts;
        recordings = nextRecordings;
      }
      expect(contacts).toBe(id === 'red_harvest' ? 1 : count);
    }
  },
);

const harvestStart = {
  ability: 'red_harvest',
  fx: 'selfCast' as const,
  sourceId: 1,
  targetId: 2,
  school: 'physical' as const,
};
const harvestHit = {
  abilityId: 'red_harvest',
  ability: 'Red Harvest',
  sourceId: 1,
  targetId: 2,
  school: 'physical' as const,
  amount: 150,
  kind: 'hit' as const,
  crit: false,
};

it('preserves the opening, plays its recording, and creates no early wound before the authoritative batch', () => {
  const { host, deps, painter } = performance();
  painter.handleSpellfx(harvestStart);
  for (let i = 1; i <= 9; i++) {
    painter.update(0.05);
    expect(host.crestAt).toHaveBeenCalledTimes(i < 3 ? 0 : i < 7 ? 1 : 2);
  }
  expect(vi.mocked(host.crestAt!).mock.calls.map((call) => [call[7], call[10]])).toEqual([
    ['harvest_cut', -0.66],
    ['harvest_cut', 0.58],
  ]);
  expect(deps.triggerAttack).toHaveBeenCalledExactlyOnceWith(1, 'red_harvest');
  expect(host.weaponTrail).toHaveBeenCalledTimes(2);
  expect(host.contact).not.toHaveBeenCalled();
  expect(host.burstAt).not.toHaveBeenCalled();
  expect(host.shakeAt).not.toHaveBeenCalled();
  expect(vi.mocked(host.abilityAudio!).mock.calls.filter((c) => c[0] === 'release')).toEqual([
    expect.arrayContaining([
      expect.objectContaining({ sample: 'melee_warrior_red_harvest_release' }),
    ]),
  ]);
  for (let i = 0; i < 3; i++) painter.onDamage({ ...harvestHit });
  painter.update(0.05);
  expect(host.contact).toHaveBeenCalledTimes(1);
  expect(deps.triggerAttack).toHaveBeenCalledTimes(1);
  expect(host.crestAt).toHaveBeenCalledTimes(2);
  const impact = vi.mocked(host.abilityAudio!).mock.calls.filter((c) => c[0] === 'impact');
  expect(impact).toHaveLength(1);
  expect(impact[0][6]?.sample).toBe('impact_warrior_red_harvest_finish');
});

it('shows blood for partially blocked damage and a shield-only response for full absorption', () => {
  const { host, painter } = performance();
  painter.onDamage({ ...harvestHit, kind: 'block' });
  painter.update(0.05);
  expect(host.contact).toHaveBeenCalledTimes(1);
  vi.mocked(host.contact!).mockClear();
  vi.mocked(host.burstAt).mockClear();
  vi.mocked(host.crestAt!).mockClear();
  painter.onDamage({ ...harvestHit, amount: 0, absorbed: 150 });
  painter.update(0.05);
  expect(host.contact).not.toHaveBeenCalled();
  expect(host.burstAt).not.toHaveBeenCalled();
  expect(host.crestAt).not.toHaveBeenCalled();
  expect(vi.mocked(host.flipbookAt).mock.calls.at(-1)?.[5]).toBe('contact_crush');
});

it('separates two true casts delivered together during network catch-up', () => {
  const { host, painter } = performance();
  painter.handleSpellfx(harvestStart);
  for (let i = 0; i < 3; i++) painter.onDamage({ ...harvestHit });
  painter.handleSpellfx(harvestStart);
  for (let i = 0; i < 3; i++) painter.onDamage({ ...harvestHit });
  painter.update(0.05);
  expect(host.contact).toHaveBeenCalledTimes(2);
  expect(vi.mocked(host.abilityAudio!).mock.calls.filter((c) => c[0] === 'impact')).toHaveLength(2);
});

it('clears pending Harvest impacts when the preview world is replaced', () => {
  const { host, painter } = performance();
  painter.onDamage(harvestHit);
  painter.resetPresentation();
  painter.update(0.05);
  expect(host.contact).not.toHaveBeenCalled();
  expect(host.abilityAudio).not.toHaveBeenCalled();
});

it('retains confirmed impact audio coordinates if the recipient view disappears before rendering', () => {
  const { host, deps, painter } = performance();
  deps.anchor = () => ({ x: 7, y: 8, z: 9 });
  painter.onDamage({ ...harvestHit });
  host.anchorOf = () => null;
  painter.update(0.05);
  const calls = vi.mocked(host.abilityAudio!).mock.calls.filter((c) => c[0] === 'impact');
  expect(calls).toHaveLength(1);
  expect(calls[0].slice(3, 6)).toEqual([7, 8, 9]);
});

it('retains a later component anchor when the first component had no audio anchor', () => {
  const { host, deps, painter } = performance();
  deps.anchor = () => null;
  painter.onDamage({ ...harvestHit });
  deps.anchor = () => ({ x: 17, y: 18, z: 19 });
  painter.onDamage({ ...harvestHit });
  host.anchorOf = () => null;
  painter.update(0.05);
  const calls = vi.mocked(host.abilityAudio!).mock.calls.filter((c) => c[0] === 'impact');
  expect(calls).toHaveLength(1);
  expect(calls[0].slice(3, 6)).toEqual([17, 18, 19]);
});
