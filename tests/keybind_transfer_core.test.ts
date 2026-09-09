// The pure envelope behind the Key Bindings panel's hotkey-setup export/import
// (src/ui/keybind_transfer_core.ts): round-trips, shape sanitizing (the model
// owns the semantic checks), and the three distinct rejections (not a code, a
// settings/frames code, nothing usable).
import { describe, expect, it } from 'vitest';
import { buildKeybindCode, parseKeybindCode } from '../src/ui/keybind_transfer_core';
import { TRANSFER_CODE_MAX_CHARS } from '../src/ui/settings_transfer_core';

const SETUP = {
  slot0: ['KeyR', null],
  slot1: ['Digit1', 'Numpad1'],
  jump: ['Space', null],
  autorun: [null, null],
};

describe('keybind_transfer_core', () => {
  it('round-trips a setup, keeping deliberately unbound rows', () => {
    const parsed = parseKeybindCode(buildKeybindCode(SETUP));
    expect(parsed).toEqual({ ok: true, binds: SETUP });
  });

  it('the code is a JSON envelope with its own marker and version', () => {
    const env = JSON.parse(buildKeybindCode(SETUP));
    expect(env.woc).toBe('woc-keybinds');
    expect(typeof env.v).toBe('number');
    expect(env.binds).toEqual(SETUP);
  });

  it('sanitizes shape on both sides: bad rows dropped, bad cells read as null, extras trimmed', () => {
    const raw = {
      slot0: ['KeyR', 7, 'KeyX'], // third entry dropped, number reads as null
      slot1: 'Digit1', // not an array: dropped
      slot2: [null, { code: 'KeyQ' }], // object cell reads as null: kept as unbound
      slot3: ['', 'KeyT'], // empty string reads as null
      constructor: ['KeyC', null],
    } as unknown as Record<string, (string | null)[]>;
    const expected = {
      slot0: ['KeyR', null],
      slot2: [null, null],
      slot3: [null, 'KeyT'],
    };
    expect(JSON.parse(buildKeybindCode(raw)).binds).toEqual(expected);
    const crafted = JSON.stringify({ woc: 'woc-keybinds', v: 1, binds: raw });
    expect(parseKeybindCode(crafted)).toEqual({ ok: true, binds: expected });
    // Neither side lets a prototype key through, including one only JSON can spell.
    const proto = crafted.replace('"constructor"', '"__proto__"');
    const parsed = parseKeybindCode(proto);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(Object.keys(parsed.binds)).toEqual(Object.keys(expected));
  });

  it('rejects text that is not a code as format', () => {
    for (const text of ['', 'hello', '[]', '42', '{"binds":{}}', '{"woc":"woc-keybinds"}']) {
      expect(parseKeybindCode(text)).toEqual({ ok: false, reason: 'format' });
    }
    expect(parseKeybindCode(JSON.stringify({ woc: 'woc-keybinds', v: 1, binds: [] }))).toEqual({
      ok: false,
      reason: 'format',
    });
  });

  it('names a settings or frame-layout code as the wrong kind', () => {
    const settings = JSON.stringify({
      woc: 'woc-transfer',
      v: 1,
      kind: 'settings',
      data: { woc_keybinds: '{}' },
    });
    expect(parseKeybindCode(settings)).toEqual({ ok: false, reason: 'kind' });
  });

  it('rejects a well-formed code carrying no usable row as empty', () => {
    const empty = JSON.stringify({ woc: 'woc-keybinds', v: 1, binds: { slot0: 'KeyR' } });
    expect(parseKeybindCode(empty)).toEqual({ ok: false, reason: 'empty' });
    expect(parseKeybindCode(JSON.stringify({ woc: 'woc-keybinds', v: 1, binds: {} }))).toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('tolerates surrounding whitespace from a paste', () => {
    expect(parseKeybindCode(`\n  ${buildKeybindCode(SETUP)}  \n`)).toEqual({
      ok: true,
      binds: SETUP,
    });
  });

  it('with the known actions given, a code naming none of them is hollow (it would import as a reset)', () => {
    const known = new Set(['slot0', 'jump']);
    const alien = JSON.stringify({ woc: 'woc-keybinds', v: 1, binds: { foo: ['KeyR', null] } });
    expect(parseKeybindCode(alien, known)).toEqual({ ok: false, reason: 'empty' });
    // One known row is enough; the unknown ones ride along for the model to ignore.
    const mixed = JSON.stringify({
      woc: 'woc-keybinds',
      v: 1,
      binds: { foo: ['KeyR', null], jump: ['KeyY', null] },
    });
    expect(parseKeybindCode(mixed, known)).toEqual({
      ok: true,
      binds: { foo: ['KeyR', null], jump: ['KeyY', null] },
    });
    // Without the set the check is off (the core alone knows no registry).
    expect(parseKeybindCode(alien).ok).toBe(true);
  });

  it('shares the settings code size bound', () => {
    const code = buildKeybindCode(SETUP);
    expect(parseKeybindCode(`${code}${' '.repeat(TRANSFER_CODE_MAX_CHARS)}`)).toEqual({
      ok: false,
      reason: 'format',
    });
    expect(parseKeybindCode(code).ok).toBe(true);
  });
});
