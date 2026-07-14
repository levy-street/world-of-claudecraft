// Determinism + faithfulness guard for the pure FCT spawn-descriptor core.
// Proves describeFct() is a pure function (same event + same
// injected jitter -> identical descriptor, no Math.random / Date.now / performance.now /
// DOM), that crit flips only the crit flag (not the color token), that each kind maps to
// its documented color token, that the injected jitter spans the documented min/max, and
// that the anchor reads identically off a Sim-shaped and a ClientWorld-mirror-shaped
// entity. The UI-purity guard (tests/architecture.test.ts) is the registered enforcement;
// the source scan here is a second, self-contained line of defense.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DAMAGE_FCT_KINDS,
  describeFct,
  FCT_ANCHOR_HEAD_OFFSET,
  FCT_JITTER_RANGE,
  FCT_RISE_PX,
  FCT_TTL_MS,
  type FctColorToken,
  type FctEvent,
  type FctKind,
  isDamageFctKind,
} from '../src/ui/fct_core';

const CORE_SRC = fileURLToPath(new URL('../src/ui/fct_core.ts', import.meta.url));

function makeEvent(overrides: Partial<FctEvent> = {}): FctEvent {
  return {
    kind: 'damage-done-ability',
    text: '123',
    target: { pos: { x: 10, y: 2, z: -3 }, scale: 1 },
    crit: false,
    isSelf: false,
    ...overrides,
  };
}

describe('describeFct: determinism (same input -> same output)', () => {
  it('returns a byte-identical descriptor for the same event + same injected jitter', () => {
    const event = makeEvent({ kind: 'heal', text: '+88', crit: true });
    const a = describeFct(event, 0.37);
    const b = describeFct(event, 0.37);
    expect(a).toEqual(b);
    // Pin the full shape so a future change to the descriptor is a deliberate edit.
    expect(a).toEqual({
      text: '+88',
      colorToken: 'heal',
      crit: true,
      anchor: { x: 10, y: 2 + FCT_ANCHOR_HEAD_OFFSET, z: -3 },
      jitterOffset: 0.37 * FCT_JITTER_RANGE - FCT_JITTER_RANGE / 2,
      ttlMs: FCT_TTL_MS,
    });
  });

  it('has no Math.random / Date.now / performance.now / DOM in the core source', () => {
    const src = readFileSync(CORE_SRC, 'utf8');
    // Strip line + block comments so the rationale comments (which name these on purpose)
    // do not trip the scan; only real code lines should match.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/Math\.random/);
    expect(code).not.toMatch(/Date\.now/);
    expect(code).not.toMatch(/performance\.now/);
    expect(code).not.toMatch(/\b(document|window|navigator|globalThis)\b/);
  });
});

describe('describeFct: color token by kind + flags', () => {
  const expected: Record<FctKind, { self: FctColorToken; other: FctColorToken }> = {
    miss: { self: 'miss-self', other: 'miss-other' },
    dodge: { self: 'dodge-self', other: 'dodge-other' },
    resist: { self: 'miss-self', other: 'miss-other' },
    'damage-done-ability': { self: 'damage-done-ability', other: 'damage-done-ability' },
    'damage-done-auto': { self: 'damage-done-auto', other: 'damage-done-auto' },
    'damage-taken': { self: 'damage-taken', other: 'damage-taken' },
    heal: { self: 'heal', other: 'heal' },
    xp: { self: 'xp', other: 'xp' },
    'rested-xp': { self: 'rested-xp', other: 'rested-xp' },
    honor: { self: 'honor', other: 'honor' },
    'self-note': { self: 'self-note', other: 'self-note' },
  };

  it('maps each kind (+ isSelf) to its documented color token', () => {
    for (const kind of Object.keys(expected) as FctKind[]) {
      expect(describeFct(makeEvent({ kind, isSelf: true }), 0.5).colorToken).toBe(
        expected[kind].self,
      );
      expect(describeFct(makeEvent({ kind, isSelf: false }), 0.5).colorToken).toBe(
        expected[kind].other,
      );
    }
  });

  it('only miss/dodge/resist change color with isSelf; every other kind ignores it', () => {
    for (const kind of Object.keys(expected) as FctKind[]) {
      const selfToken = describeFct(makeEvent({ kind, isSelf: true }), 0.5).colorToken;
      const otherToken = describeFct(makeEvent({ kind, isSelf: false }), 0.5).colorToken;
      // resist reuses the miss token (self grey / other white), so it varies with isSelf too.
      if (kind === 'miss' || kind === 'dodge' || kind === 'resist')
        expect(selfToken).not.toBe(otherToken);
      else expect(selfToken).toBe(otherToken);
    }
  });

  it('crit flips only the crit flag; the color token is unchanged by crit', () => {
    for (const kind of Object.keys(expected) as FctKind[]) {
      const plain = describeFct(makeEvent({ kind, crit: false }), 0.5);
      const crit = describeFct(makeEvent({ kind, crit: true }), 0.5);
      expect(crit.crit).toBe(true);
      expect(plain.crit).toBe(false);
      expect(crit.colorToken).toBe(plain.colorToken);
      // Everything except the crit flag is identical for a crit vs a non-crit of one kind.
      expect({ ...crit, crit: false }).toEqual({ ...plain, crit: false });
    }
  });
});

describe('describeFct: ttl is a pure function of kind (constant across kinds)', () => {
  it('emits the named ttl constant for every kind, regardless of crit/jitter', () => {
    for (const kind of [
      'miss',
      'dodge',
      'damage-done-ability',
      'damage-done-auto',
      'damage-taken',
      'heal',
      'xp',
      'rested-xp',
      'honor',
      'self-note',
    ] as FctKind[]) {
      const d = describeFct(makeEvent({ kind, crit: true }), 0.9);
      expect(d.ttlMs).toBe(FCT_TTL_MS);
    }
  });

  it('pins the named constants to the live fct() values', () => {
    expect(FCT_JITTER_RANGE).toBe(30);
    expect(FCT_TTL_MS).toBe(1250);
    expect(FCT_ANCHOR_HEAD_OFFSET).toBe(2.2);
    expect(FCT_RISE_PX).toBe(76);
  });

  it('pins FCT_RISE_PX against the live hud.css @keyframes rise distance', () => {
    // FCT_RISE_PX feeds no production code (the painter rises off the .fct / .fct.crit CSS class),
    // so this scan is what actually ties the documentary constant to the CSS rise preserved here:
    // @keyframes fct-rise rises FCT_RISE_PX (76px) and fct-crit rises 86px. A future CSS edit that
    // changes either fails here instead of silently drifting from the constant.
    const css = readFileSync(
      fileURLToPath(new URL('../src/styles/hud.css', import.meta.url)),
      'utf8',
    );
    expect(css).toContain(`calc(-50% - ${FCT_RISE_PX}px)`); // @keyframes fct-rise 'to'
    expect(css).toContain('calc(-50% - 86px)'); // @keyframes fct-crit '100%' (the larger crit rise)
  });
});

describe('describeFct: injected jitter maps to the documented horizontal offset', () => {
  it('jitter01 of 0 and 1 give the min/max offset; 0.5 gives 0', () => {
    expect(describeFct(makeEvent(), 0).jitterOffset).toBe(-FCT_JITTER_RANGE / 2);
    expect(describeFct(makeEvent(), 1).jitterOffset).toBe(FCT_JITTER_RANGE / 2);
    expect(describeFct(makeEvent(), 0.5).jitterOffset).toBe(0);
  });
});

describe('describeFct: head-offset anchor', () => {
  it('lifts the anchor by FCT_ANCHOR_HEAD_OFFSET * scale on y; passes x/z through', () => {
    const d = describeFct(makeEvent({ target: { pos: { x: 4, y: 5, z: 6 }, scale: 2 } }), 0.5);
    expect(d.anchor).toEqual({ x: 4, y: 5 + FCT_ANCHOR_HEAD_OFFSET * 2, z: 6 });
  });
});

describe('describeFct: ClientWorld-vs-Sim parity', () => {
  // The structural FctAnchorSource type (pos + scale only) is the real enforcing guard --
  // the core cannot read a Sim-only field without a cast. This test documents the intent
  // and pins that both world shapes, sharing the same pos + scale, produce one descriptor.
  it('reads the anchor identically off a Sim-shaped and a ClientWorld-mirror-shaped entity', () => {
    // A Sim entity carries many extra fields; the core must read only pos + scale.
    const simEntity = {
      id: 42,
      type: 'mob',
      pos: { x: 7, y: 3, z: -1 },
      vel: { x: 0, y: 0, z: 0 },
      scale: 1.4,
      hp: 80,
      maxHp: 120,
      level: 5,
    };
    // A ClientWorld mirror carries a different (smaller, wire-derived) field set, but the
    // SAME pos + scale; if the core ever leaned on a Sim-only field it would diverge here.
    const mirrorEntity = {
      id: 42,
      pos: { x: 7, y: 3, z: -1 },
      scale: 1.4,
      name: 'Rotbark',
      wireFlags: 0,
    };
    const fromSim = describeFct(makeEvent({ target: simEntity, kind: 'damage-taken' }), 0.25);
    const fromMirror = describeFct(makeEvent({ target: mirrorEntity, kind: 'damage-taken' }), 0.25);
    expect(fromSim).toEqual(fromMirror);
  });
});

describe('isDamageFctKind: the combat-damage taxonomy (damage-number classifier)', () => {
  it('classifies exactly the three damage-number kinds as damage', () => {
    expect([...DAMAGE_FCT_KINDS].sort()).toEqual([
      'damage-done-ability',
      'damage-done-auto',
      'damage-taken',
    ]);
    for (const kind of DAMAGE_FCT_KINDS) expect(isDamageFctKind(kind)).toBe(true);
  });

  it('treats informational / avoidance floaters as NON-damage (kept on low)', () => {
    // These are the low-volume floaters the low-tier drop must NOT shed: progression,
    // the self-note UX hint, heals, and avoidance words.
    const nonDamage: FctKind[] = ['miss', 'dodge', 'heal', 'xp', 'rested-xp', 'honor', 'self-note'];
    for (const kind of nonDamage) expect(isDamageFctKind(kind)).toBe(false);
  });
});
