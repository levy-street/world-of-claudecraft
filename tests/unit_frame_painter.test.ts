// Routing + no-magic-values guard for the unit_frame painter.
// A recording facet captures every writer call so we can assert the painter drives
// the SIX elided writers with byte-identical values (the Top-risk-1 guard against a
// non-byte-identical cache key), including the FOLDED absorb transform + overshield
// toggle and the resource-type class that replaced the raw updateAbsorb /
// `className` writes. A source scan proves it makes NO raw DOM write and carries no
// literal color. It also pins the instance-parameterized contract: the player path
// stays byte-faithful (no name on the hot path, no dead/oor classes), while a
// fuller instance (target/party) opts into name, the shownDisplay hide path, the
// dead/out-of-range state classes, and the portrait repaint gate.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { borderAccent } from '../src/ui/deed_border_view';
import type { PainterHostWriters } from '../src/ui/painter_host';
import { makeWriterFacet } from '../src/ui/painter_host';
import { type UnitFrameDescriptor, unitFrameView } from '../src/ui/unit_frame';
import {
  PORTRAIT_BORDER_ATTR,
  PORTRAIT_BORDER_EDGE_PROP,
  PORTRAIT_BORDER_FRAME_PROP,
  PORTRAIT_BORDER_GLOW_PROP,
  type UnitFrameElements,
  type UnitFrameOptions,
  UnitFramePainter,
} from '../src/ui/unit_frame_painter';

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

const FRAME = { tag: 'frame' } as unknown as HTMLElement;
const NAME = { tag: 'name' } as unknown as HTMLElement;
const LEVEL = { tag: 'level' } as unknown as HTMLElement;
const HP_FILL = { tag: 'hpFill' } as unknown as HTMLElement;
const HP_TEXT = { tag: 'hpText' } as unknown as HTMLElement;
const ABSORB = { tag: 'absorb' } as unknown as HTMLElement;
const RES_CONTAINER = { tag: 'resContainer' } as unknown as HTMLElement;
const RES_FILL = { tag: 'resFill' } as unknown as HTMLElement;
const RES_TEXT = { tag: 'resText' } as unknown as HTMLElement;

// The PLAYER element set: absorb + resource present, but NO name (static, set at
// login) so the player path stays byte-faithful to the old inline block.
const PLAYER_ELEMENTS: UnitFrameElements = {
  frame: FRAME,
  level: LEVEL,
  hpFill: HP_FILL,
  hpText: HP_TEXT,
  absorb: ABSORB,
  resource: { container: RES_CONTAINER, fill: RES_FILL, text: RES_TEXT },
};

// A FULL element set (a target/party instance): adds the per-unit name node.
const FULL_ELEMENTS: UnitFrameElements = { ...PLAYER_ELEMENTS, name: NAME };

function playerDescriptor(over: Partial<UnitFrameDescriptor> = {}): UnitFrameDescriptor {
  return {
    present: true,
    hpFrac: 300 / 600,
    hpText: '300 / 600',
    resourceKind: 'mana',
    resFrac: 80 / 100,
    resText: '80 / 100',
    levelText: '60',
    name: 'Aerwynn',
    portraitKey: 'player',
    absorb: { hp: 300, maxHp: 600, auras: [] },
    dead: false,
    outOfRange: false,
    ...over,
  };
}

function paint(
  desc: UnitFrameDescriptor,
  elements: UnitFrameElements = PLAYER_ELEMENTS,
  opts: UnitFrameOptions = {},
): Call[] {
  const { calls, writers } = recordingFacet();
  new UnitFramePainter(writers, elements, opts).paint(unitFrameView(desc));
  return calls;
}

describe('UnitFramePainter: the player instance routes every write through the elided writers', () => {
  it('paints level, hp, absorb, resource type/fill/text and NOTHING else (byte-faithful)', () => {
    const calls = paint(playerDescriptor());
    // absorb { hp: 300, maxHp: 600, auras: [] } -> fillFrac = 300/600 = 0.5 (no shield).
    // No setDisplay (CSS owns it), no name (static, set at login), no dead/oor
    // (player frame never carries them): exactly the inline block + the absorb /
    // resource-type folds.
    expect(calls).toEqual([
      { m: 'setText', args: [LEVEL, '60'] },
      { m: 'setTransform', args: [HP_FILL, 'scaleX(0.5)'] },
      { m: 'setText', args: [HP_TEXT, '300 / 600'] },
      { m: 'setTransform', args: [ABSORB, 'scaleX(0.5)'] },
      { m: 'toggleClass', args: [ABSORB, 'overshield', false] },
      { m: 'toggleClass', args: [RES_CONTAINER, 'rage', false] },
      { m: 'toggleClass', args: [RES_CONTAINER, 'energy', false] },
      { m: 'toggleClass', args: [RES_CONTAINER, 'focus', false] },
      { m: 'toggleClass', args: [RES_CONTAINER, 'mana', true] },
      { m: 'setTransform', args: [RES_FILL, 'scaleX(0.8)'] },
      { m: 'setText', args: [RES_TEXT, '80 / 100'] },
    ]);
  });

  it('never writes display, name, or dead/oor for the player', () => {
    const calls = paint(playerDescriptor({ dead: true, outOfRange: true }));
    expect(calls.some((c) => c.m === 'setDisplay')).toBe(false);
    expect(calls.some((c) => c.args[0] === NAME)).toBe(false);
    expect(calls.some((c) => c.args[1] === 'dead' || c.args[1] === 'oor')).toBe(false);
  });

  it('drives the rage, energy, and focus discriminator exclusively', () => {
    const rage = paint(playerDescriptor({ resourceKind: 'rage' }));
    expect(rage).toContainEqual({ m: 'toggleClass', args: [RES_CONTAINER, 'rage', true] });
    expect(rage).toContainEqual({ m: 'toggleClass', args: [RES_CONTAINER, 'mana', false] });
    const energy = paint(playerDescriptor({ resourceKind: 'energy' }));
    expect(energy).toContainEqual({ m: 'toggleClass', args: [RES_CONTAINER, 'energy', true] });
    const focus = paint(playerDescriptor({ resourceKind: 'focus' }));
    expect(focus).toContainEqual({ m: 'toggleClass', args: [RES_CONTAINER, 'focus', true] });
    expect(focus).toContainEqual({ m: 'toggleClass', args: [RES_CONTAINER, 'mana', false] });
  });

  it('folds the absorb overshield toggle onto the elided writers', () => {
    // hp 590 + shield 50 over 600 -> overshield, fillFrac clamped to 1.
    const calls = paint(
      playerDescriptor({
        absorb: {
          hp: 590,
          maxHp: 600,
          auras: [
            {
              id: 'power_word_shield',
              name: 'Power Word: Shield',
              kind: 'absorb',
              remaining: 30,
              duration: 30,
              value: 50,
              sourceId: 1,
              school: 'holy',
            },
          ],
        },
      }),
    );
    expect(calls).toContainEqual({ m: 'setTransform', args: [ABSORB, 'scaleX(1)'] });
    expect(calls).toContainEqual({ m: 'toggleClass', args: [ABSORB, 'overshield', true] });
  });
});

describe('UnitFramePainter: the instance-parameterized contract (target / party / hidden)', () => {
  it('a fuller instance writes display, name, and the dead/out-of-range state classes', () => {
    const calls = paint(playerDescriptor({ dead: true, outOfRange: true }), FULL_ELEMENTS, {
      shownDisplay: 'flex',
      stateClasses: true,
    });
    expect(calls[0]).toEqual({ m: 'setDisplay', args: [FRAME, 'flex'] });
    expect(calls).toContainEqual({ m: 'setText', args: [NAME, 'Aerwynn'] });
    expect(calls).toContainEqual({ m: 'toggleClass', args: [FRAME, 'dead', true] });
    expect(calls).toContainEqual({ m: 'toggleClass', args: [FRAME, 'oor', true] });
  });

  it('a target-like frame with no resource group writes no resource calls', () => {
    const targetElements: UnitFrameElements = {
      frame: FRAME,
      name: NAME,
      level: LEVEL,
      hpFill: HP_FILL,
      hpText: HP_TEXT,
      absorb: ABSORB,
      // no resource group
    };
    const calls = paint(
      playerDescriptor({ resourceKind: 'none', resText: '', resFrac: 0 }),
      targetElements,
      { shownDisplay: 'flex' },
    );
    expect(calls).toContainEqual({ m: 'setDisplay', args: [FRAME, 'flex'] });
    // No write ever targets the resource container / fill / text.
    expect(calls.some((c) => c.args[0] === RES_CONTAINER)).toBe(false);
    expect(calls.some((c) => c.args[0] === RES_FILL)).toBe(false);
    expect(calls.some((c) => c.args[0] === RES_TEXT)).toBe(false);
  });

  it('a party-like frame with no absorb group writes no absorb calls', () => {
    const partyElements: UnitFrameElements = {
      frame: FRAME,
      name: NAME,
      level: LEVEL,
      hpFill: HP_FILL,
      hpText: HP_TEXT,
      // no absorb
      resource: { container: RES_CONTAINER, fill: RES_FILL, text: RES_TEXT },
    };
    const calls = paint(playerDescriptor({ outOfRange: true }), partyElements, {
      shownDisplay: 'flex',
      stateClasses: true,
    });
    expect(calls.some((c) => c.args[0] === ABSORB)).toBe(false);
    expect(calls).toContainEqual({ m: 'toggleClass', args: [FRAME, 'oor', true] });
  });

  it('hides a shownDisplay frame when the unit is absent (only setDisplay none)', () => {
    const calls = paint(playerDescriptor({ present: false }), FULL_ELEMENTS, {
      shownDisplay: 'flex',
    });
    expect(calls).toEqual([{ m: 'setDisplay', args: [FRAME, 'none'] }]);
  });

  it('writes nothing for an absent unit when the frame owns no display (the player)', () => {
    const calls = paint(playerDescriptor({ present: false }));
    expect(calls).toEqual([]);
  });

  it('writes an empty level string when the level is hidden (levelText null, the party path)', () => {
    // levelText ?? '' is the painter's ONLY non-passthrough transform. The player
    // always passes a numeric string, but a party member may hide the level, so pin
    // the null -> '' coercion here (a regression to `?? '0'` or a dropped `??` would
    // otherwise survive every existing painter test).
    const calls = paint(playerDescriptor({ levelText: null }));
    expect(calls).toContainEqual({ m: 'setText', args: [LEVEL, ''] });
  });
});

describe('UnitFramePainter: the portrait repaint gate (lastPortraitTarget path)', () => {
  it('repaints only when the identity key changes', () => {
    const repaintPortrait = vi.fn();
    const { writers } = recordingFacet();
    const painter = new UnitFramePainter(writers, FULL_ELEMENTS, { repaintPortrait });
    painter.paint(unitFrameView(playerDescriptor({ portraitKey: 'mob:a' })));
    painter.paint(unitFrameView(playerDescriptor({ portraitKey: 'mob:a' })));
    expect(repaintPortrait).toHaveBeenCalledTimes(1);
    expect(repaintPortrait).toHaveBeenLastCalledWith('mob:a');
    painter.paint(unitFrameView(playerDescriptor({ portraitKey: 'mob:b' })));
    expect(repaintPortrait).toHaveBeenCalledTimes(2);
    expect(repaintPortrait).toHaveBeenLastCalledWith('mob:b');
  });

  it('repaints again when the same unit re-appears after being hidden (the -999 reset)', () => {
    // The old target block reset lastPortraitTarget to -999 on no-target, so
    // re-acquiring the SAME target (or a new mob reusing its entity id) redrew the
    // portrait. The painter folds that into the !present path: hiding clears the gate
    // so the next present paint with the same key repaints.
    const repaintPortrait = vi.fn();
    const painter = new UnitFramePainter(recordingFacet().writers, FULL_ELEMENTS, {
      shownDisplay: 'flex',
      repaintPortrait,
    });
    painter.paint(unitFrameView(playerDescriptor({ portraitKey: 'mob:5' })));
    expect(repaintPortrait).toHaveBeenCalledTimes(1);
    painter.paint(unitFrameView(playerDescriptor({ present: false }))); // hidden
    painter.paint(unitFrameView(playerDescriptor({ portraitKey: 'mob:5' }))); // same id back
    expect(repaintPortrait).toHaveBeenCalledTimes(2);
  });

  it('invalidatePortrait forces the next present paint to repaint even with an unchanged key', () => {
    // The Hud calls invalidatePortrait() when the 3D portrait ASSETS load after mount
    // (onPortraitsReady), where the inline block reset its -999 sentinel.
    const repaintPortrait = vi.fn();
    const painter = new UnitFramePainter(recordingFacet().writers, FULL_ELEMENTS, {
      repaintPortrait,
    });
    painter.paint(unitFrameView(playerDescriptor({ portraitKey: 'mob:7' })));
    painter.paint(unitFrameView(playerDescriptor({ portraitKey: 'mob:7' })));
    expect(repaintPortrait).toHaveBeenCalledTimes(1); // gated: same key
    painter.invalidatePortrait();
    painter.paint(unitFrameView(playerDescriptor({ portraitKey: 'mob:7' })));
    expect(repaintPortrait).toHaveBeenCalledTimes(2); // forced repaint, same key
  });

  it('never repaints when no callback is wired (the player frame)', () => {
    // Drive ONE no-callback instance across frames with a CHANGING key (not two fresh
    // instances): the gate must run on the stateful lastPortraitKey, not throw (the
    // optional-chain no-op when repaintPortrait is undefined), and add no writer call
    // for the key change (the portrait canvas is never routed through the elided
    // writers). So the second paint emits exactly the same writer calls as the first.
    const { calls, writers } = recordingFacet();
    const painter = new UnitFramePainter(writers, PLAYER_ELEMENTS);
    painter.paint(unitFrameView(playerDescriptor({ portraitKey: 'k1' })));
    const first = calls.length;
    painter.paint(unitFrameView(playerDescriptor({ portraitKey: 'k2' })));
    expect(calls.length - first).toBe(first); // the changing key added nothing
  });
});

describe('UnitFramePainter: no raw DOM writes, no magic values', () => {
  const src = readFileSync(new URL('../src/ui/unit_frame_painter.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('makes no raw style / textContent / className / classList / setAttribute / setProperty write', () => {
    expect(code).not.toMatch(/\.style\b/);
    expect(code).not.toMatch(/\.textContent\b/);
    // .className is the exact raw write folded into toggleClass (the old
    // `pfResourceEl.className = 'bar rage|energy|mana'` swap); guard it explicitly.
    expect(code).not.toMatch(/\.className\b/);
    expect(code).not.toMatch(/\.classList\b/);
    expect(code).not.toMatch(/\.setAttribute\b/);
    expect(code).not.toMatch(/\.setProperty\b/);
  });

  it('carries no literal hex / rgb / px value (scaleX VALUE strings excepted)', () => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    // No magic values (hex / px / color): the painter drives tokens, never a px
    // literal. scaleX VALUE strings carry no px, so this stays green.
    const px = code.match(/\b\d+px\b/g) ?? [];
    expect(hex, `hex: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb: ${rgb.join(', ')}`).toEqual([]);
    expect(px, `px: ${px.join(', ')}`).toEqual([]);
  });
});

describe('UnitFramePainter: the title-decoration spans (Book of Deeds)', () => {
  const TITLE_PRE = { tag: 'titlePre' } as unknown as HTMLElement;
  const TITLE_POST = { tag: 'titlePost' } as unknown as HTMLElement;
  const TITLED_ELEMENTS: UnitFrameElements = {
    ...FULL_ELEMENTS,
    titlePre: TITLE_PRE,
    titlePost: TITLE_POST,
  };

  it('writes both decoration strings on an instance that supplies the spans', () => {
    const calls = paint(
      playerDescriptor({ titlePre: '', titlePost: ' [Veteran]' }),
      TITLED_ELEMENTS,
      { shownDisplay: 'flex' },
    );
    expect(calls).toContainEqual({ m: 'setText', args: [NAME, 'Aerwynn'] });
    expect(calls).toContainEqual({ m: 'setText', args: [TITLE_PRE, ''] });
    expect(calls).toContainEqual({ m: 'setText', args: [TITLE_POST, ' [Veteran]'] });
  });

  it('writes empty strings for an untitled unit (the spans collapse, height unchanged)', () => {
    const calls = paint(playerDescriptor(), TITLED_ELEMENTS, { shownDisplay: 'flex' });
    expect(calls).toContainEqual({ m: 'setText', args: [TITLE_PRE, ''] });
    expect(calls).toContainEqual({ m: 'setText', args: [TITLE_POST, ''] });
  });

  it('an instance without the spans pays zero title writes even when the view carries one', () => {
    const calls = paint(
      playerDescriptor({ titlePre: '[Pre] ', titlePost: ' [Post]' }),
      FULL_ELEMENTS,
      { shownDisplay: 'flex' },
    );
    expect(calls.some((c) => c.args[0] === TITLE_PRE || c.args[0] === TITLE_POST)).toBe(false);
    expect(calls.some((c) => c.args[1] === '[Pre] ' || c.args[1] === ' [Post]')).toBe(false);
  });
});

describe('UnitFramePainter: the portrait border ring (Book of Deeds)', () => {
  const PORTRAIT_BORDER = { tag: 'portraitBorder' } as unknown as HTMLElement;
  const BORDERED_ELEMENTS: UnitFrameElements = {
    ...FULL_ELEMENTS,
    portraitBorder: PORTRAIT_BORDER,
  };
  const ACCENT = borderAccent('reliquary_gilt');

  it('writes the slug attribute and the palette custom properties through the writers', () => {
    const calls = paint(playerDescriptor({ borderSlug: 'reliquary_gilt' }), BORDERED_ELEMENTS, {
      shownDisplay: 'flex',
    });
    expect(ACCENT).not.toBeNull();
    expect(calls).toContainEqual({
      m: 'setAttr',
      args: [PORTRAIT_BORDER, PORTRAIT_BORDER_ATTR, 'reliquary_gilt'],
    });
    expect(calls).toContainEqual({
      m: 'setStyleProp',
      args: [PORTRAIT_BORDER, PORTRAIT_BORDER_FRAME_PROP, ACCENT?.frame],
    });
    expect(calls).toContainEqual({
      m: 'setStyleProp',
      args: [PORTRAIT_BORDER, PORTRAIT_BORDER_EDGE_PROP, ACCENT?.edge],
    });
    expect(calls).toContainEqual({
      m: 'setStyleProp',
      args: [PORTRAIT_BORDER, PORTRAIT_BORDER_GLOW_PROP, ACCENT?.glow],
    });
  });

  it('clears all four slots for a borderless unit (a cleared border removes the ring)', () => {
    // '' is also what a stale id and a title-reward deed resolve to at the call
    // site, so this one arm covers every no-accent case the view can carry.
    const calls = paint(playerDescriptor({ borderSlug: '' }), BORDERED_ELEMENTS, {
      shownDisplay: 'flex',
    });
    expect(calls).toContainEqual({
      m: 'setAttr',
      args: [PORTRAIT_BORDER, PORTRAIT_BORDER_ATTR, ''],
    });
    for (const prop of [
      PORTRAIT_BORDER_FRAME_PROP,
      PORTRAIT_BORDER_EDGE_PROP,
      PORTRAIT_BORDER_GLOW_PROP,
    ]) {
      expect(calls).toContainEqual({ m: 'setStyleProp', args: [PORTRAIT_BORDER, prop, ''] });
    }
  });

  it('renders an unknown slug as borderless: the palette gates the attribute (content drift)', () => {
    // A slug with no palette (a drifted id the table cannot color) writes '' into
    // the gate attribute AND the three props, so the CSS :not([data-border=""])
    // gate stays closed and no transparent ::after box paints. This matches the
    // nameplate, which early-returns to nothing for the same case, so both
    // surfaces of one identity render a drifted id identically.
    const calls = paint(playerDescriptor({ borderSlug: 'slug_with_no_palette' }), BORDERED_ELEMENTS)
      .filter((c) => c.args[0] === PORTRAIT_BORDER)
      .map((c) => c.args[2]);
    expect(calls).toEqual(['', '', '', '']);
  });

  it('elides every border write on a repeat paint (the facet caches, no local field)', () => {
    // The painter holds NO lastBorderSlug: the multi-slot writer caches own the
    // elision, so a steady frame costs zero DOM writes. This drives the REAL
    // makeWriterFacet over element stubs rather than the recording facet, which
    // records but never elides.
    const attrs: Record<string, string> = {};
    const props: Record<string, string> = {};
    const stub = (): HTMLElement =>
      ({
        style: {
          setProperty: (prop: string, value: string) => {
            props[prop] = value;
          },
        },
        classList: { toggle: () => {} },
        setAttribute: (name: string, value: string) => {
          attrs[name] = value;
        },
      }) as unknown as HTMLElement;
    let writes = 0;
    let skips = 0;
    const host = stub();
    const facet = makeWriterFacet(
      new Map(),
      new Map(),
      new Map(),
      new Map(),
      () => {
        writes++;
      },
      () => {
        skips++;
      },
    );
    const elements: UnitFrameElements = {
      frame: stub(),
      name: stub(),
      level: stub(),
      hpFill: stub(),
      hpText: stub(),
      portraitBorder: host,
    };
    const painter = new UnitFramePainter(facet, elements, { shownDisplay: 'flex' });
    const view = unitFrameView(playerDescriptor({ borderSlug: 'deepward' }));

    painter.paint(view);
    expect(attrs[PORTRAIT_BORDER_ATTR]).toBe('deepward');
    expect(props[PORTRAIT_BORDER_FRAME_PROP]).toBe(borderAccent('deepward')?.frame);
    const firstWrites = writes;
    const firstSkips = skips;

    painter.paint(view);
    expect(writes).toBe(firstWrites);
    expect(skips).toBeGreaterThan(firstSkips);

    // A real change still lands, and the palette follows the slug.
    painter.paint(unitFrameView(playerDescriptor({ borderSlug: 'prestige_laurels' })));
    expect(attrs[PORTRAIT_BORDER_ATTR]).toBe('prestige_laurels');
    expect(props[PORTRAIT_BORDER_FRAME_PROP]).toBe(borderAccent('prestige_laurels')?.frame);
    expect(writes).toBeGreaterThan(firstWrites);
  });

  it('an instance without the border host pays zero border writes', () => {
    const calls = paint(playerDescriptor({ borderSlug: 'deepward' }), FULL_ELEMENTS, {
      shownDisplay: 'flex',
    });
    expect(calls.some((c) => c.args[0] === PORTRAIT_BORDER)).toBe(false);
    expect(calls.some((c) => c.m === 'setAttr' || c.m === 'setStyleProp')).toBe(false);
  });

  it('writes nothing but the hide when the unit is absent (the family contract)', () => {
    // Hiding stays byte-faithful to every other field: nothing is cleared while the
    // frame is display:none. The reset lands on the next PRESENT paint, which
    // always rewrites all four slots (the borderless arm above).
    const calls = paint(
      playerDescriptor({ present: false, borderSlug: 'deepward' }),
      BORDERED_ELEMENTS,
      {
        shownDisplay: 'flex',
      },
    );
    expect(calls).toEqual([{ m: 'setDisplay', args: [FRAME, 'none'] }]);
  });
});
