// Routing + no-magic-values guard for the cast_bar painter plus
// the instance-parameterized contract: one painter, a PLAYER instance
// (localized label + eat/drink overlay + clear-on-hide) and a TARGET instance (raw
// label, no eat/drink, display-only hide), each byte-faithful to its inline block.
// A recording facet captures every writer call so we assert the painter drives the
// elided writers with byte-identical values in the exact inline order (the
// Top-risk-1 guard against a non-byte-identical cache key), including the `.channel`
// class routed through toggleClass. A source scan proves it makes NO raw DOM write
// and carries no literal color/px.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CastBarState, ConsumeBarState } from '../src/render/cast_bar';
import {
  type CastBarElements,
  type CastBarOptions,
  CastBarPainter,
  type CastBarPaintInput,
} from '../src/ui/cast_bar_painter';
import { formatNumber, t } from '../src/ui/i18n';
import type { PainterHostWriters } from '../src/ui/painter_host';

type Call = { m: keyof PainterHostWriters; args: unknown[] };

function recordingFacet() {
  const calls: Call[] = [];
  const writers: PainterHostWriters = {
    setText: (el, text) => {
      calls.push({ m: 'setText', args: [el, text] });
    },
    setDisplay: (el, display) => {
      calls.push({ m: 'setDisplay', args: [el, display] });
    },
    setTransform: (el, transform) => {
      calls.push({ m: 'setTransform', args: [el, transform] });
    },
    setWidth: (el, width) => {
      calls.push({ m: 'setWidth', args: [el, width] });
    },
    setStyleProp: (el, prop, value) => {
      calls.push({ m: 'setStyleProp', args: [el, prop, value] });
    },
    toggleClass: (el, cls, on) => {
      calls.push({ m: 'toggleClass', args: [el, cls, on] });
    },
    setAttr: (el, name, value) => {
      calls.push({ m: 'setAttr', args: [el, name, value] });
    },
  };
  return { calls, writers };
}

const BAR = { tag: 'bar' } as unknown as HTMLElement;
const FILL = { tag: 'fill' } as unknown as HTMLElement;
const LABEL = { tag: 'label' } as unknown as HTMLElement;
const TIMER = { tag: 'timer' } as unknown as HTMLElement;
const ELEMENTS: CastBarElements = { bar: BAR, fill: FILL, label: LABEL, timer: TIMER };

// The player localizes the cast id; we stand in a marker resolver for castDisplayName
// so the test proves the painter routes the label through the instance resolver.
const PLAYER_OPTS: CastBarOptions = {
  resolveCastLabel: (s) => `LOC:${s.label}`,
  clearOnHide: true,
};
// The target shows the raw cast id (identity resolver), byte-faithful to its inline
// block, and does NOT clear on hide (it only set display:none).
const TARGET_OPTS: CastBarOptions = { resolveCastLabel: (s) => s.label };

function castState(over: Partial<CastBarState> = {}): CastBarState {
  return { visible: true, channel: false, fill: 0.8, label: 'fireball', fishing: false, ...over };
}
function consumeState(over: Partial<ConsumeBarState> = {}): ConsumeBarState {
  return { visible: true, fill: 0.5, mode: 'eat', remaining: 9, ...over };
}
const HIDDEN_CAST: CastBarState = {
  visible: false,
  channel: false,
  fill: 0,
  label: '',
  fishing: false,
};

function paint(input: CastBarPaintInput, opts: CastBarOptions): Call[] {
  const { calls, writers } = recordingFacet();
  new CastBarPainter(writers, ELEMENTS, opts).paint(input);
  return calls;
}

// The timer is formatted exactly as the inline block did; compute the expected via
// the same formatter so the assertion is locale-independent.
const timer = (s: number) =>
  formatNumber(Math.max(0, s), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

describe('CastBarPainter: the player instance routes every write through the elided writers', () => {
  it('paints a hardcast: display, channel-off, width, localized label, timer (inline order)', () => {
    const calls = paint({ cast: castState(), castRemaining: 0.5 }, PLAYER_OPTS);
    expect(calls).toEqual([
      { m: 'setDisplay', args: [BAR, 'block'] },
      { m: 'toggleClass', args: [BAR, 'channel', false] },
      { m: 'setWidth', args: [FILL, '80.0%'] },
      { m: 'setText', args: [LABEL, 'LOC:fireball'] },
      { m: 'setText', args: [TIMER, timer(0.5)] },
      { m: 'setAttr', args: [BAR, 'aria-valuenow', '80'] },
    ]);
  });

  it('paints a channel with the channel class on', () => {
    const calls = paint(
      {
        cast: castState({ channel: true, fill: 0.5, label: 'arcane_missiles' }),
        castRemaining: 1.5,
      },
      PLAYER_OPTS,
    );
    expect(calls).toContainEqual({ m: 'toggleClass', args: [BAR, 'channel', true] });
    expect(calls).toContainEqual({ m: 'setText', args: [LABEL, 'LOC:arcane_missiles'] });
  });

  it('paints the eat/drink overlay from the mode discriminator via t(), channel on', () => {
    const eat = paint(
      { cast: HIDDEN_CAST, castRemaining: 0, consume: consumeState() },
      PLAYER_OPTS,
    );
    expect(eat).toEqual([
      { m: 'setDisplay', args: [BAR, 'block'] },
      { m: 'toggleClass', args: [BAR, 'channel', true] },
      { m: 'setWidth', args: [FILL, '50.0%'] },
      { m: 'setText', args: [LABEL, t('hud.core.eating')] },
      { m: 'setText', args: [TIMER, timer(9)] },
      { m: 'setAttr', args: [BAR, 'aria-valuenow', '50'] },
    ]);
    const drink = paint(
      { cast: HIDDEN_CAST, castRemaining: 0, consume: consumeState({ mode: 'drink' }) },
      PLAYER_OPTS,
    );
    expect(drink).toContainEqual({ m: 'setText', args: [LABEL, t('hud.core.drinking')] });
    const both = paint(
      { cast: HIDDEN_CAST, castRemaining: 0, consume: consumeState({ mode: 'eatdrink' }) },
      PLAYER_OPTS,
    );
    expect(both).toContainEqual({ m: 'setText', args: [LABEL, t('hud.core.eatingDrinking')] });
  });

  it('cast wins over eat/drink (the consume branch is only reached when not casting)', () => {
    const calls = paint(
      { cast: castState(), castRemaining: 0.5, consume: consumeState() },
      PLAYER_OPTS,
    );
    // The cast label, never the eat label, is written.
    expect(calls).toContainEqual({ m: 'setText', args: [LABEL, 'LOC:fireball'] });
    expect(calls.some((c) => c.args[1] === t('hud.core.eating'))).toBe(false);
  });

  it('clears the bar on hide: display none, channel off, width 0%, empty label + timer', () => {
    const calls = paint(
      { cast: HIDDEN_CAST, castRemaining: 0, consume: consumeState({ visible: false }) },
      PLAYER_OPTS,
    );
    expect(calls).toEqual([
      { m: 'setDisplay', args: [BAR, 'none'] },
      { m: 'toggleClass', args: [BAR, 'channel', false] },
      { m: 'setWidth', args: [FILL, '0%'] },
      { m: 'setText', args: [LABEL, ''] },
      { m: 'setText', args: [TIMER, ''] },
    ]);
  });
});

describe('CastBarPainter: the target instance (raw label, no eat/drink, display-only hide)', () => {
  it('paints a target cast with the RAW cast id (no localization), inline order', () => {
    const calls = paint(
      {
        cast: castState({ channel: false, fill: 0.5, label: 'nythraxis_deathless_rage' }),
        castRemaining: 5,
      },
      TARGET_OPTS,
    );
    expect(calls).toEqual([
      { m: 'setDisplay', args: [BAR, 'block'] },
      { m: 'toggleClass', args: [BAR, 'channel', false] },
      { m: 'setWidth', args: [FILL, '50.0%'] },
      { m: 'setText', args: [LABEL, 'nythraxis_deathless_rage'] },
      { m: 'setText', args: [TIMER, timer(5)] },
      { m: 'setAttr', args: [BAR, 'aria-valuenow', '50'] },
    ]);
  });

  it('hides with ONLY setDisplay none (no clear, byte-faithful to the target block)', () => {
    const calls = paint({ cast: HIDDEN_CAST, castRemaining: 0 }, TARGET_OPTS);
    expect(calls).toEqual([{ m: 'setDisplay', args: [BAR, 'none'] }]);
  });

  it('never renders eat/drink: with no consume input the consume branch is unreachable', () => {
    // The target paint input omits `consume`, so even a hidden cast falls straight to
    // the hide path; the target can never paint the eat/drink label.
    const calls = paint({ cast: HIDDEN_CAST, castRemaining: 0 }, TARGET_OPTS);
    expect(calls.some((c) => c.args[1] === t('hud.core.eating'))).toBe(false);
    expect(calls.some((c) => c.m === 'setWidth')).toBe(false);
  });
});

describe('CastBarPainter: no raw DOM writes, no magic values', () => {
  const src = readFileSync(new URL('../src/ui/cast_bar_painter.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('makes no raw style / textContent / className / classList / setAttribute / setProperty write', () => {
    expect(code).not.toMatch(/\.style\b/);
    expect(code).not.toMatch(/\.textContent\b/);
    expect(code).not.toMatch(/\.className\b/);
    expect(code).not.toMatch(/\.classList\b/);
    expect(code).not.toMatch(/\.setAttribute\b/);
    expect(code).not.toMatch(/\.setProperty\b/);
  });

  it('carries no literal hex / rgb / px value (the fill color is the .channel CSS class)', () => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    const px = code.match(/\b\d+px\b/g) ?? [];
    expect(hex, `hex: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb: ${rgb.join(', ')}`).toEqual([]);
    expect(px, `px: ${px.join(', ')}`).toEqual([]);
  });
});
