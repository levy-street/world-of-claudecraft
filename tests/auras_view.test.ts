// auras core (auras_view): the debuff allowlist classification, same-input ->
// same-output determinism, the ClientWorld-vs-Sim parity assertion (the
// online wire omits stacks when 1), and the reused-buffer allocation budget (the
// proxy). The DOM half (the keyed pool, the mutable-slot tooltip) is in
// tests/auras_painter.test.ts.

import { describe, expect, it } from 'vitest';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import {
  type AuraInput,
  type AuraMode,
  type AurasDeps,
  type AurasEntityInput,
  compactAuraDuration,
  createAurasView,
  DEBUFF_AURA_KINDS,
  isAuraDebuff,
} from '../src/ui/auras_view';
import { assertAllocationStable } from './util/alloc_probe';

// The "local player" id the isOwn dep compares against (the real host compares
// aura.sourceId to IWorld.playerId).
const OWN_PLAYER_ID = 7;

// Deterministic deps: the icon id mirrors the host (ability id, else `aura_<kind>`),
// the name echoes the source name, the stack formatter is a plain String() (the real
// host wraps formatNumber). No randomness/time, so same input -> same output.
function deps(): AurasDeps {
  return {
    iconId: (a) => (a.id.startsWith('aura_') ? `aura_${a.kind}` : a.id),
    auraName: (a) => `name:${a.name}`,
    formatStacks: (n) => String(n),
    isOwn: (a) => a.sourceId === OWN_PLAYER_ID,
    durationUnits: () => ({ s: 's', m: 'm', h: 'h', d: 'd' }),
    auraEffectHtml: () => '',
  };
}

function aura(over: Partial<AuraInput> & { id: string }): AuraInput {
  return {
    name: over.id,
    kind: 'buff_ap',
    remaining: 10,
    value: 1,
    ...over,
  };
}

function entity(auras: AuraInput[]): AurasEntityInput {
  return { auras };
}

describe('isAuraDebuff: the allowlist classification (lifted into the core)', () => {
  it('classifies every allowlisted debuff kind as a debuff', () => {
    for (const kind of DEBUFF_AURA_KINDS) {
      expect(isAuraDebuff(aura({ id: 'x', kind }))).toBe(true);
    }
  });

  it('classifies a plain buff as not a debuff, but a NEGATIVE-value buff_* as a debuff', () => {
    expect(isAuraDebuff(aura({ id: 'x', kind: 'buff_ap', value: 50 }))).toBe(false);
    expect(isAuraDebuff(aura({ id: 'x', kind: 'buff_armor', value: 100 }))).toBe(false);
    // A buff_* kind whose value saps (a stat-draining curse) reads as a debuff.
    expect(isAuraDebuff(aura({ id: 'x', kind: 'buff_ap', value: -50 }))).toBe(true);
    expect(isAuraDebuff(aura({ id: 'x', kind: 'buff_int', value: -20 }))).toBe(true);
  });

  // The view re-exports the shared sim classification set. Pin its exact contents
  // so an accidental removal changes every consumer loudly.
  it('matches the exact shared set of harmful kinds', () => {
    expect([...DEBUFF_AURA_KINDS].sort()).toEqual(
      [
        'attackspeed',
        'blind',
        'bleed_vuln',
        'cauterize_fatigue',
        'corrode',
        'cost_tax',
        'critvuln',
        'debuff_ap',
        'disarm',
        'dot',
        'expose',
        'faerie_fire',
        'heal_absorb',
        'hex',
        'incapacitate',
        'lockout',
        'mortal_wound',
        'polymorph',
        'root',
        'sated',
        'silence',
        'slow',
        'spellvuln',
        'stun',
        'sunder',
        'tongues',
        'vulnerability',
      ].sort(),
    );
  });
});

describe('createAurasView: derivation per mode', () => {
  it("mode 'all' keeps every aura; mode 'debuffs' keeps only debuffs", () => {
    const auras = [
      aura({ id: 'might', kind: 'buff_ap', value: 50 }),
      aura({ id: 'deep_wounds', kind: 'dot', value: 5 }),
      aura({ id: 'sunder', kind: 'sunder', value: 0, stacks: 3 }),
    ];
    const all = createAurasView('all', deps()).tick(entity(auras));
    expect(all.count).toBe(3);

    const debuffs = createAurasView('debuffs', deps()).tick(entity(auras));
    expect(debuffs.count).toBe(2);
    expect(debuffs.slots.slice(0, 2).map((s) => s.key)).toEqual(['deep_wounds', 'sunder']);
  });

  it('renders bleed vulnerability as a non-cancelable debuff, never a helpful buff', () => {
    const bleedVulnerability = aura({
      id: 'hemorrhage_bleed_vuln',
      kind: 'bleed_vuln',
      value: 0.4,
    });

    const all = createAurasView('all', deps()).tick(entity([bleedVulnerability]));
    expect(all.slots[0]).toMatchObject({ isDebuff: true, cancelable: false });
    expect(createAurasView('buffs', deps()).tick(entity([bleedVulnerability])).count).toBe(0);
    expect(createAurasView('debuffs', deps()).tick(entity([bleedVulnerability])).count).toBe(1);
  });

  it('emits one slot PER aura even when two share an id (no core-side dedup)', () => {
    // The sim dedups by id+sourceId, so one entity can carry two auras with the same id
    // from different sources. The core must NOT collapse them (that is the painter's job,
    // by per-frame occurrence): it emits a slot per aura so the painter can disambiguate.
    const state = createAurasView('all', deps()).tick(
      entity([
        aura({ id: 'corruption', name: 'A', kind: 'dot', remaining: 6 }),
        aura({ id: 'corruption', name: 'B', kind: 'dot', remaining: 12 }),
      ]),
    );
    expect(state.count).toBe(2);
    expect(state.slots.slice(0, 2).map((s) => s.key)).toEqual(['corruption', 'corruption']);
    expect(state.slots.slice(0, 2).map((s) => s.name)).toEqual(['name:A', 'name:B']);
  });

  it('derives icon key, debuff flag, duration text, stacks text, name, and remaining', () => {
    const state = createAurasView('all', deps()).tick(
      entity([
        aura({
          id: 'deep_wounds',
          name: 'Gaping Wounds',
          kind: 'dot',
          remaining: 4.2,
          value: 5,
          stacks: 5,
        }),
      ]),
    );
    const s = state.slots[0];
    expect(s.key).toBe('deep_wounds');
    expect(s.iconKey).toBe('deep_wounds');
    expect(s.isDebuff).toBe(true);
    expect(s.durationText).toBe('5s'); // ceil(4.2) = 5
    expect(s.stacksText).toBe('5');
    expect(s.name).toBe('name:Gaping Wounds');
    expect(s.remaining).toBe(4.2);
  });

  it('renders Elemental Convergence effect text through the real top-right buff view path', () => {
    const convergence = aura({
      id: 'elemental_convergence',
      name: 'Elemental Convergence',
      kind: 'buff_dmg_done',
      value: 0.15,
    });
    const viewDeps: AurasDeps = {
      ...deps(),
      auraEffectHtml: (input) => {
        const descriptor = auraEffectDescriptor(input);
        return descriptor ? `${descriptor.key}:${descriptor.nums?.pct ?? ''}` : '';
      },
    };

    const slot = createAurasView('buffs', viewDeps).tick(entity([convergence])).slots[0];
    expect(slot.effectHtml).toBe('hudChrome.auraEffect.dmgDone:15');
  });

  it('explains the first Elemental Convergence school marker in the top-right buff view', () => {
    const primed = aura({
      id: 'convergence_mark',
      name: 'Elemental Convergence',
      kind: 'internal_cd',
      value: 0,
    });
    const viewDeps: AurasDeps = {
      ...deps(),
      auraEffectHtml: (input) => auraEffectDescriptor(input)?.key ?? '',
    };

    const slot = createAurasView('buffs', viewDeps).tick(entity([primed])).slots[0];
    expect(slot.effectHtml).toBe('hudChrome.auraEffect.elementalConvergencePrimed');
  });

  it('derives the debuff school for the border tint (physical fallback; buffs carry none)', () => {
    const state = createAurasView('all', deps()).tick(
      entity([
        aura({ id: 'venom', kind: 'dot', school: 'nature' }),
        // No school on the aura (the wire omits 'physical') -> the physical fallback.
        aura({ id: 'deep_wounds', kind: 'dot' }),
        // A buff never tints: school stays '' even when the aura carries one.
        aura({ id: 'might', kind: 'buff_ap', value: 50, school: 'holy' }),
      ]),
    );
    expect(state.slots.slice(0, 3).map((s) => s.school)).toEqual(['nature', 'physical', '']);
  });

  it('appends the INJECTED duration units (so an in-game language switch lands next tick)', () => {
    // The units are a fired dep, not hardcoded letters: a localized host swaps them per language.
    const localized: AurasDeps = {
      ...deps(),
      durationUnits: () => ({ s: ' sec', m: ' min', h: ' hr', d: ' day' }),
    };
    const v = createAurasView('all', localized);
    expect(v.tick(entity([aura({ id: 'a', remaining: 4.2 })])).slots[0].durationText).toBe(
      '5 sec', // ceil(4.2)=5 + injected suffix
    );
    expect(v.tick(entity([aura({ id: 'a', remaining: 300 })])).slots[0].durationText).toBe('5 min');
  });

  it('renders the WoW-style compact duration per magnitude (20s / 5m / 1h / 2d)', () => {
    const v = createAurasView('all', deps());
    const text = (remaining: number) =>
      v.tick(entity([aura({ id: 'a', remaining })])).slots[0].durationText;
    expect(text(20)).toBe('20s');
    expect(text(4.2)).toBe('5s'); // seconds round UP: never a premature 0s
    expect(text(300)).toBe('5m');
    expect(text(1800)).toBe('30m'); // a long food/scroll buff finally reads its minutes
    expect(text(3600)).toBe('1h'); // Devotion Aura reads 1h, never 3600s
    expect(text(2 * 86400)).toBe('2d');
    expect(text(Number.POSITIVE_INFINITY)).toBe(''); // truly permanent: no label
  });

  it('hides the countdown under toggle auras (stealth / forms / stance / Ghost Wolf)', () => {
    const v = createAurasView('all', deps());
    // The sim backs each toggle with a long finite duration (3600s), but a mode
    // shows no countdown (WoW parity): stealth by kind, Ghost Wolf by id (its
    // aura rides the generic buff_speed kind that Sprint also uses).
    expect(
      v.tick(entity([aura({ id: 'stealth', kind: 'stealth', remaining: 3600 })])).slots[0]
        .durationText,
    ).toBe('');
    expect(
      v.tick(entity([aura({ id: 'bear_form', kind: 'form_bear', remaining: 3600 })])).slots[0]
        .durationText,
    ).toBe('');
    expect(
      v.tick(entity([aura({ id: 'moonkin_form', kind: 'form_moonkin', remaining: 3600 })])).slots[0]
        .durationText,
    ).toBe('');
    expect(
      v.tick(entity([aura({ id: 'shadowform', kind: 'form_shadow', remaining: 3600 })])).slots[0]
        .durationText,
    ).toBe('');
    expect(
      v.tick(entity([aura({ id: 'ghost_wolf', kind: 'buff_speed', remaining: 3600 })])).slots[0]
        .durationText,
    ).toBe('');
    // Sprint shares buff_speed but is a real timed buff: its countdown stays.
    expect(
      v.tick(entity([aura({ id: 'sprint', kind: 'buff_speed', remaining: 15 })])).slots[0]
        .durationText,
    ).toBe('15s');
    // Greater Invisibility rides the stealth kind for its vanish but is a fixed
    // 20s timed buff, so it overrides the kind suppression and shows its countdown.
    expect(
      v.tick(entity([aura({ id: 'greater_invisibility', kind: 'stealth', remaining: 20 })]))
        .slots[0].durationText,
    ).toBe('20s');
  });

  it('compactAuraDuration boundaries: seconds round UP, larger units to nearest', () => {
    const U = { s: 's', m: 'm', h: 'h', d: 'd' };
    expect(compactAuraDuration(59.9, U)).toBe('60s');
    expect(compactAuraDuration(60, U)).toBe('1m');
    expect(compactAuraDuration(90, U)).toBe('2m'); // nearest, so half rounds up
    expect(compactAuraDuration(3599, U)).toBe('1h'); // 60m promotes, never prints
    expect(compactAuraDuration(5400, U)).toBe('2h');
    expect(compactAuraDuration(86399, U)).toBe('1d'); // 24h promotes the same way
    expect(compactAuraDuration(86400, U)).toBe('1d');
  });

  it('shows a stacks label only when stacks > 1', () => {
    const v = createAurasView('all', deps());
    expect(v.tick(entity([aura({ id: 'a', stacks: undefined })])).slots[0].stacksText).toBe('');
    expect(v.tick(entity([aura({ id: 'a', stacks: 1 })])).slots[0].stacksText).toBe('');
    expect(v.tick(entity([aura({ id: 'a', stacks: 4 })])).slots[0].stacksText).toBe('4');
  });

  it('badges remaining charges (shown even at 1) and prefers charges over stacks', () => {
    // A charge-limited aura (Lightning Shield) badges its charge count, unlike stacks it
    // shows at 1, and when both are present charges wins (it is the meaningful count).
    const v = createAurasView('all', deps());
    expect(v.tick(entity([aura({ id: 'lightning_shield', charges: 3 })])).slots[0].stacksText).toBe(
      '3',
    );
    expect(v.tick(entity([aura({ id: 'lightning_shield', charges: 1 })])).slots[0].stacksText).toBe(
      '1',
    );
    expect(
      v.tick(entity([aura({ id: 'lightning_shield', charges: 2, stacks: 5 })])).slots[0].stacksText,
    ).toBe('2');
  });

  it('is deterministic: identical inputs produce deep-equal slot state', () => {
    const build = () => {
      const state = createAurasView('all', deps()).tick(
        entity([
          aura({ id: 'might', value: 50 }),
          aura({ id: 'deep_wounds', kind: 'dot', value: 5 }),
        ]),
      );
      // Snapshot the PRIMITIVE fields (the slots are reused objects, so deep-compare
      // values, never the slot references).
      return state.slots.slice(0, state.count).map((s) => ({ ...s }));
    };
    expect(build()).toEqual(build());
  });
});

describe("ownFirst (the target strip): the local player's auras lead and mark own", () => {
  it('sorts own auras first (group-stable) and flags them; others stay unflagged', () => {
    const view = createAurasView('all', deps(), { ownFirst: true });
    const state = view.tick(
      entity([
        aura({ id: 'mob_frenzy', kind: 'buff_haste', sourceId: 99 }),
        aura({ id: 'my_dot', kind: 'dot', sourceId: OWN_PLAYER_ID }),
        aura({ id: 'other_dot', kind: 'dot', sourceId: 42 }),
        aura({ id: 'my_hot', kind: 'hot', sourceId: OWN_PLAYER_ID }),
      ]),
    );
    expect(state.count).toBe(4);
    const keys = state.slots.slice(0, 4).map((s) => s.key);
    // own auras lead in their application order, then the rest in theirs
    expect(keys).toEqual(['my_dot', 'my_hot', 'mob_frenzy', 'other_dot']);
    expect(state.slots.slice(0, 4).map((s) => s.own)).toEqual([true, true, false, false]);
  });

  it('a missing or zero sourceId (an old server mirror) is never own', () => {
    const view = createAurasView('all', deps(), { ownFirst: true });
    const state = view.tick(
      entity([
        aura({ id: 'no_src', kind: 'dot' }),
        aura({ id: 'zero_src', kind: 'dot', sourceId: 0 }),
      ]),
    );
    expect(state.slots.slice(0, state.count).every((s) => !s.own)).toBe(true);
  });

  it("a non-ownFirst view never flags own even for the player's own auras", () => {
    const view = createAurasView('all', deps());
    const state = view.tick(entity([aura({ id: 'my_dot', kind: 'dot', sourceId: OWN_PLAYER_ID })]));
    expect(state.slots[0].own).toBe(false);
  });
});

describe('Sim-shaped and ClientWorld-mirror-shaped auras derive identically', () => {
  it('a Sim aura {stacks:1} and a ClientWorld-mirror aura {stacks:undefined} yield the same slot', () => {
    // The wire omits stacks when 1 (server_i18n: WireAura.stacks sent only > 1), so the
    // online mirror presents stacks:undefined where the Sim presents stacks:1. Both must
    // render no stacks badge and otherwise identical state.
    const simShaped = aura({
      id: 'deep_wounds',
      name: 'Gaping Wounds',
      kind: 'dot',
      remaining: 6,
      value: 5,
      stacks: 1,
    });
    const clientShaped = aura({
      id: 'deep_wounds',
      name: 'Gaping Wounds',
      kind: 'dot',
      remaining: 6,
      value: 5,
    });
    const fromSim = createAurasView('all', deps()).tick(entity([simShaped])).slots[0];
    const fromClient = createAurasView('all', deps()).tick(entity([clientShaped])).slots[0];
    expect({ ...fromClient }).toEqual({ ...fromSim });
    expect(fromSim.stacksText).toBe('');
  });

  it('value-based debuff classification now AGREES across the wire (the negative value is sent)', () => {
    // A negative-value buff_* aura (a mob stat-sap, e.g. enfeeble on buff_int or Withering
    // Wail on buff_ap) reads as a debuff via the value < 0 branch. The wire now carries the
    // value SPARSELY (server/game.ts sends it only when negative; src/net/online.ts decodes
    // `a.value ?? 0`), so the ClientWorld mirror presents the SAME negative value the Sim
    // does and both worlds classify the sap as a debuff. (The end-to-end encode/decode round
    // trip is proven in tests/snapshots.test.ts; here we pin the pure classification over
    // the two shapes the wire now produces.)
    const simSap = aura({
      id: 'enfeeble',
      name: 'Enfeeble',
      kind: 'buff_int',
      remaining: 8,
      value: -30,
    });
    const clientSap = aura({
      id: 'enfeeble',
      name: 'Enfeeble',
      kind: 'buff_int',
      remaining: 8,
      value: -30,
    });
    expect(isAuraDebuff(simSap)).toBe(true); // offline: debuff border
    expect(isAuraDebuff(clientSap)).toBe(true); // online: the wire now sends the value
    // A POSITIVE buff value is omitted by the sparse wire and decodes to 0, so a real buff
    // stays a buff in both worlds.
    expect(isAuraDebuff(aura({ id: 'might', kind: 'buff_ap', value: 50 }))).toBe(false);
    expect(isAuraDebuff(aura({ id: 'might', kind: 'buff_ap', value: 0 }))).toBe(false);
    // Allowlisted kinds do NOT depend on value, so they stay a debuff under BOTH shapes
    // (the parity-safe path the rest of the strip relies on).
    expect(isAuraDebuff(aura({ id: 'rip', kind: 'dot', value: 0 }))).toBe(true);
    expect(isAuraDebuff(aura({ id: 'sap', kind: 'debuff_ap', value: 0 }))).toBe(true);
  });

  it('marks a wire-faithful mirror sap isDebuff via the real view, so the low cap keeps it', () => {
    // The painter's debuff-priority low cap keys on slot.isDebuff (auras_painter.ts: a
    // debuff is never culled). Now that the wire carries the negative value, a mirror sap
    // flows through the REAL view as isDebuff:true, exactly as the Sim aura does, so the low
    // preset can no longer hide it. (The cap half -- a debuff past the buff budget still
    // renders on low -- is pinned in tests/auras_painter.test.ts.)
    const mirrorSap = aura({ id: 'enfeeble', kind: 'buff_int', value: -30 });
    const slot = createAurasView('all', deps()).tick(entity([mirrorSap])).slots[0];
    expect(slot.isDebuff).toBe(true);
  });
});

describe('allocation budget (the reused-reference proxy)', () => {
  const drive = (mode: AuraMode) => {
    const view = createAurasView(mode, deps());
    // Vary the aura data each call (remaining ticks down, stacks change) so the probe
    // proves the reused slots are mutated in place, not reallocated.
    let frame = 0;
    return () => {
      frame += 1;
      return view.tick(
        entity([
          aura({ id: 'might', value: 50, remaining: 30 - frame * 0.1 }),
          aura({
            id: 'deep_wounds',
            kind: 'dot',
            value: 5,
            remaining: 12 - frame * 0.05,
            stacks: frame,
          }),
        ]),
      );
    };
  };

  it("the 'all' view reuses its container AND its slot array across frames", () => {
    const tick = drive('all');
    expect(() => assertAllocationStable(tick)).not.toThrow();
    expect(() => assertAllocationStable(() => tick().slots)).not.toThrow();
  });

  it("the 'debuffs' view reuses its container AND its slot array across frames", () => {
    const tick = drive('debuffs');
    expect(() => assertAllocationStable(tick)).not.toThrow();
    expect(() => assertAllocationStable(() => tick().slots)).not.toThrow();
  });
});
