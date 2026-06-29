// auras core (auras_view): the debuff allowlist classification, same-input ->
// same-output determinism, the ClientWorld-vs-Sim parity assertion (the
// online wire omits stacks when 1), and the reused-buffer allocation budget (the
// proxy). The DOM half (the keyed pool, the mutable-slot tooltip) is in
// tests/auras_painter.test.ts.

import { describe, expect, it } from 'vitest';
import {
  type AuraInput,
  type AuraMode,
  type AurasDeps,
  type AurasEntityInput,
  createAurasView,
  DEBUFF_AURA_KINDS,
  isAuraDebuff,
} from '../src/ui/auras_view';
import { assertAllocationStable } from './util/alloc_probe';

// Deterministic deps: the icon id mirrors the host (ability id, else `aura_<kind>`),
// the name echoes the source name, the stack formatter is a plain String() (the real
// host wraps formatNumber). No randomness/time, so same input -> same output.
function deps(): AurasDeps {
  return {
    iconId: (a) => (a.id.startsWith('aura_') ? `aura_${a.kind}` : a.id),
    auraName: (a) => `name:${a.name}`,
    formatStacks: (n) => String(n),
    durationUnitSuffix: () => 's',
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

  it('matches the exact set of kinds the old inline allowlist named', () => {
    expect([...DEBUFF_AURA_KINDS].sort()).toEqual(
      [
        'attackspeed',
        'blind',
        'cost_tax',
        'critvuln',
        'debuff_ap',
        'disarm',
        'dot',
        'expose',
        'heal_absorb',
        'hex',
        'incapacitate',
        'lockout',
        'mortal_wound',
        'polymorph',
        'root',
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
      aura({ id: 'rend', kind: 'dot', value: 5 }),
      aura({ id: 'sunder', kind: 'sunder', value: 0, stacks: 3 }),
    ];
    const all = createAurasView('all', deps()).tick(entity(auras));
    expect(all.count).toBe(3);

    const debuffs = createAurasView('debuffs', deps()).tick(entity(auras));
    expect(debuffs.count).toBe(2);
    expect(debuffs.slots.slice(0, 2).map((s) => s.key)).toEqual(['rend', 'sunder']);
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
        aura({ id: 'rend', name: 'Rend', kind: 'dot', remaining: 4.2, value: 5, stacks: 5 }),
      ]),
    );
    const s = state.slots[0];
    expect(s.key).toBe('rend');
    expect(s.iconKey).toBe('rend');
    expect(s.isDebuff).toBe(true);
    expect(s.durationText).toBe('5s'); // ceil(4.2) = 5
    expect(s.stacksText).toBe('5');
    expect(s.name).toBe('name:Rend');
    expect(s.remaining).toBe(4.2);
  });

  it('appends the INJECTED duration unit suffix (so an in-game language switch lands next tick)', () => {
    // The suffix is a fired dep, not a hardcoded 's': a localized host swaps it per language.
    const localized: AurasDeps = { ...deps(), durationUnitSuffix: () => ' sec' };
    const state = createAurasView('all', localized).tick(
      entity([aura({ id: 'a', remaining: 4.2 })]),
    );
    expect(state.slots[0].durationText).toBe('5 sec'); // ceil(4.2)=5 + injected suffix
  });

  it('hides the duration label at/above the permanent threshold (>= 99s)', () => {
    const v = createAurasView('all', deps());
    expect(v.tick(entity([aura({ id: 'a', remaining: 98 })])).slots[0].durationText).toBe('98s');
    expect(v.tick(entity([aura({ id: 'a', remaining: 99 })])).slots[0].durationText).toBe('');
    expect(v.tick(entity([aura({ id: 'a', remaining: 9999 })])).slots[0].durationText).toBe('');
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
        entity([aura({ id: 'might', value: 50 }), aura({ id: 'rend', kind: 'dot', value: 5 })]),
      );
      // Snapshot the PRIMITIVE fields (the slots are reused objects, so deep-compare
      // values, never the slot references).
      return state.slots.slice(0, state.count).map((s) => ({ ...s }));
    };
    expect(build()).toEqual(build());
  });
});

describe('Sim-shaped and ClientWorld-mirror-shaped auras derive identically', () => {
  it('a Sim aura {stacks:1} and a ClientWorld-mirror aura {stacks:undefined} yield the same slot', () => {
    // The wire omits stacks when 1 (server_i18n: WireAura.stacks sent only > 1), so the
    // online mirror presents stacks:undefined where the Sim presents stacks:1. Both must
    // render no stacks badge and otherwise identical state.
    const simShaped = aura({
      id: 'rend',
      name: 'Rend',
      kind: 'dot',
      remaining: 6,
      value: 5,
      stacks: 1,
    });
    const clientShaped = aura({ id: 'rend', name: 'Rend', kind: 'dot', remaining: 6, value: 5 });
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
          aura({ id: 'rend', kind: 'dot', value: 5, remaining: 12 - frame * 0.05, stacks: frame }),
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
