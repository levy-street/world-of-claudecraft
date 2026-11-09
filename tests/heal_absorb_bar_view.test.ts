// The heal-absorb overlay on unit frames (Living Rime, Stone Shell, every
// `kind: 'heal_absorb'` aura): the pure segment/number core, its wiring through
// the unit_frame family core (player/target read the live entity, a party row
// its own pre-summed total that Show Absorb Shields never hides), the painter's
// elided writes, the one-time DOM builder, and the hud.css contract the painter
// writes against.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Aura } from '../src/sim/types';
import {
  HEAL_ABSORB_OFF,
  healAbsorbBarView,
  healAbsorbBarViewInto,
  healAbsorbTotal,
  newHealAbsorbBarView,
} from '../src/ui/heal_absorb_bar_view';
import {
  createHealAbsorbOverlay,
  HEAL_ABSORB_FILL_CLASS,
  HEAL_ABSORB_ROOT_CLASS,
  HEAL_ABSORB_TEXT_CLASS,
} from '../src/ui/heal_absorb_overlay';
import { makeWriterFacet } from '../src/ui/painter_host';
import { partyFrameSignature } from '../src/ui/party_frames';
import {
  newUnitFrameBuffer,
  type UnitFrameDescriptor,
  unitFrameView,
  unitFrameViewInto,
} from '../src/ui/unit_frame';
import {
  HEAL_ABSORB_END_PROP,
  HEAL_ABSORB_ON_CLASS,
  HEAL_ABSORB_START_PROP,
  type UnitFrameElements,
  UnitFramePainter,
} from '../src/ui/unit_frame_painter';
import { assertAllocationStable } from './util/alloc_probe';

function healAbsorb(value: number, id = 'smith_heart_quench_rime'): Aura {
  return {
    id,
    name: 'Living Rime',
    kind: 'heal_absorb',
    remaining: 10,
    duration: 10,
    value,
    sourceId: 1,
    school: 'frost',
  };
}

function shield(value: number): Aura {
  return { ...healAbsorb(value, 'power_word_shield'), name: 'Shield', kind: 'absorb' };
}

describe('healAbsorbBarView: the segment and the number', () => {
  it('no heal absorb: off, no segment, no number', () => {
    const v = healAbsorbBarView({ hp: 800, maxHp: 1000, auras: [shield(200)] });
    expect(v.on).toBe(false);
    expect(v.total).toBe(0);
    expect(v.sizeFrac).toBe(0);
    expect(v.text).toBe('');
  });

  it('partial: covers the health edge inward by the absorb, number is the remaining', () => {
    // 800 / 1000 health, 300 locked: the hatch runs 50% to 80%.
    const v = healAbsorbBarView({ hp: 800, maxHp: 1000, auras: [healAbsorb(300)] });
    expect(v.on).toBe(true);
    expect(v.total).toBe(300);
    expect(v.startFrac).toBeCloseTo(0.5, 9);
    expect(v.sizeFrac).toBeCloseTo(0.3, 9);
    expect(v.start).toBe('50.0%');
    expect(v.end).toBe('80.0%');
    expect(v.text).toBe('300');
  });

  it('larger than current health: the segment clamps to health, the number does not', () => {
    const v = healAbsorbBarView({ hp: 200, maxHp: 1000, auras: [healAbsorb(900)] });
    expect(v.on).toBe(true);
    expect(v.startFrac).toBe(0);
    expect(v.sizeFrac).toBeCloseTo(0.2, 9);
    expect(v.start).toBe('0.0%');
    expect(v.end).toBe('20.0%');
    // A healer still has to land the whole 900.
    expect(v.text).toBe('900');
  });

  it('broken (spent to zero, or gone) and a dead unit: off', () => {
    expect(healAbsorbBarView({ hp: 800, maxHp: 1000, auras: [healAbsorb(0)] }).on).toBe(false);
    expect(healAbsorbBarView({ hp: 800, maxHp: 1000, auras: [] }).on).toBe(false);
    expect(healAbsorbBarView({ hp: 0, maxHp: 1000, auras: [healAbsorb(300)] }).on).toBe(false);
    expect(healAbsorbBarView(null)).toMatchObject({ on: false, text: '', sizeFrac: 0 });
  });

  it('sums every heal absorb, ignores shields, and ceils a last sliver to 1', () => {
    expect(healAbsorbTotal([healAbsorb(120), healAbsorb(80, 'stone_shell'), shield(500)])).toBe(
      200,
    );
    const v = healAbsorbBarView({ hp: 500, maxHp: 1000, auras: [healAbsorb(0.4)] });
    expect(v.on).toBe(true);
    expect(v.text).toBe('1');
  });

  it('a pre-summed party total wins over auras', () => {
    const v = healAbsorbBarView({ hp: 600, maxHp: 1000, healTotal: 450 });
    expect(v.text).toBe('450');
    expect(v.startFrac).toBeCloseTo(0.15, 9);
  });

  it('shrinks as healing lands, and the strings only change when their value does', () => {
    const out = newHealAbsorbBarView();
    const input = { hp: 800, maxHp: 1000, auras: [healAbsorb(300)] };
    healAbsorbBarViewInto(out, input);
    const start = out.start;
    const text = out.text;
    healAbsorbBarViewInto(out, input);
    expect(out.start).toBe(start);
    expect(out.text).toBe(text);
    input.auras[0].value = 100;
    healAbsorbBarViewInto(out, input);
    expect(out.start).toBe('70.0%');
    expect(out.text).toBe('100');
    input.auras.length = 0;
    healAbsorbBarViewInto(out, input);
    expect(out.on).toBe(false);
    expect(out.text).toBe('');
  });

  it('allocates nothing on a steady frame', () => {
    const out = newHealAbsorbBarView();
    const input = { hp: 800, maxHp: 1000, auras: [healAbsorb(300)] };
    expect(() =>
      assertAllocationStable(() => healAbsorbBarViewInto(out, input), 64, 'heal absorb view'),
    ).not.toThrow();
  });

  it('the shared off view is frozen', () => {
    expect(Object.isFrozen(HEAL_ABSORB_OFF)).toBe(true);
    expect(HEAL_ABSORB_OFF.on).toBe(false);
  });
});

function descriptor(over: Partial<UnitFrameDescriptor> = {}): UnitFrameDescriptor {
  return {
    present: true,
    hpFrac: 0.8,
    hpText: '800 / 1000',
    resourceKind: 'mana',
    resFrac: 1,
    resText: '',
    levelText: '60',
    name: 'Raider',
    portraitKey: 'p',
    absorb: { hp: 800, maxHp: 1000, auras: [healAbsorb(300)] },
    dead: false,
    outOfRange: false,
    ...over,
  };
}

describe('unit_frame core: the heal absorb rides every frame instance', () => {
  it('player / target: read from the live entity the shield input already carries', () => {
    const v = unitFrameView(descriptor());
    expect(v.healAbsorb.on).toBe(true);
    expect(v.healAbsorb.text).toBe('300');
    // The buffered per-frame path agrees.
    const b = unitFrameViewInto(newUnitFrameBuffer(), descriptor());
    expect(b.healAbsorb.text).toBe('300');
    expect(b.healAbsorb.start).toBe('50.0%');
  });

  it('party: its own total shows even when Show Absorb Shields nulls the shield input', () => {
    const v = unitFrameView(
      descriptor({ absorb: null, healAbsorb: { hp: 800, maxHp: 1000, healTotal: 300 } }),
    );
    expect(v.absorbSizeFrac).toBe(0);
    expect(v.healAbsorb.on).toBe(true);
    expect(v.healAbsorb.text).toBe('300');
    // An explicit null switches it off.
    expect(unitFrameView(descriptor({ healAbsorb: null })).healAbsorb.on).toBe(false);
  });

  it('a hidden frame carries the off view', () => {
    expect(unitFrameView(descriptor({ present: false })).healAbsorb.on).toBe(false);
    const b = newUnitFrameBuffer();
    unitFrameViewInto(b, descriptor());
    expect(unitFrameViewInto(b, descriptor({ present: false })).healAbsorb.on).toBe(false);
  });
});

describe('UnitFramePainter: heal-absorb writes', () => {
  function stubs() {
    const props = new Map<HTMLElement, Record<string, string>>();
    const classes = new Map<HTMLElement, Set<string>>();
    const texts = new Map<HTMLElement, string>();
    const stub = (): HTMLElement => {
      const el = {
        style: {
          setProperty: (prop: string, value: string) => {
            const p = props.get(el) ?? {};
            p[prop] = value;
            props.set(el, p);
          },
        },
        classList: {
          toggle: (cls: string, on?: boolean) => {
            const s = classes.get(el) ?? new Set<string>();
            if (on) s.add(cls);
            else s.delete(cls);
            classes.set(el, s);
            return !!on;
          },
        },
        setAttribute: () => {},
        set textContent(v: string) {
          texts.set(el, v);
        },
      } as unknown as HTMLElement;
      return el;
    };
    return { props, classes, texts, stub };
  }

  it('paints the on class, both edges and the number, then elides a steady frame', () => {
    const { props, classes, texts, stub } = stubs();
    let writes = 0;
    const facet = makeWriterFacet(
      new Map(),
      new WeakMap(),
      new WeakMap(),
      new WeakMap(),
      () => {
        writes++;
      },
      () => {},
    );
    const root = stub();
    const text = stub();
    const elements: UnitFrameElements = {
      frame: stub(),
      level: stub(),
      hpFill: stub(),
      healAbsorb: { root, text },
    };
    const painter = new UnitFramePainter(facet, elements);
    const buffer = newUnitFrameBuffer();
    const auras = [healAbsorb(300)];
    const d = descriptor({ absorb: { hp: 800, maxHp: 1000, auras } });
    painter.paint(unitFrameViewInto(buffer, d));
    expect(classes.get(root)?.has(HEAL_ABSORB_ON_CLASS)).toBe(true);
    expect(props.get(root)?.[HEAL_ABSORB_START_PROP]).toBe('50.0%');
    expect(props.get(root)?.[HEAL_ABSORB_END_PROP]).toBe('80.0%');
    expect(texts.get(text)).toBe('300');

    // The same frame again: zero DOM writes.
    const before = writes;
    painter.paint(unitFrameViewInto(buffer, d));
    expect(writes).toBe(before);

    // Healing lands: only the moved edge and the number are rewritten.
    auras[0].value = 120;
    painter.paint(unitFrameViewInto(buffer, d));
    expect(writes).toBe(before + 2);
    expect(props.get(root)?.[HEAL_ABSORB_START_PROP]).toBe('68.0%');
    expect(texts.get(text)).toBe('120');

    // It breaks: the overlay switches off and the number clears.
    auras.length = 0;
    painter.paint(unitFrameViewInto(buffer, d));
    expect(classes.get(root)?.has(HEAL_ABSORB_ON_CLASS)).toBe(false);
    expect(texts.get(text)).toBe('');
  });

  it('a frame without the overlay pays no heal-absorb write', () => {
    const { stub } = stubs();
    const seen: string[] = [];
    const facet = makeWriterFacet(
      new Map(),
      new WeakMap(),
      new WeakMap(),
      new WeakMap(),
      () => {},
      () => {},
    );
    const spy = {
      ...facet,
      setStyleProp: (el: HTMLElement, prop: string, v: string) => {
        seen.push(prop);
        facet.setStyleProp(el, prop, v);
      },
    };
    new UnitFramePainter(spy, { frame: stub(), level: stub(), hpFill: stub() }).paint(
      unitFrameView(descriptor()),
    );
    expect(seen).not.toContain(HEAL_ABSORB_START_PROP);
    expect(seen).not.toContain(HEAL_ABSORB_END_PROP);
  });
});

describe('createHealAbsorbOverlay: the one-time DOM', () => {
  it('builds root > fill + text, aria-hidden like the shield hatch', () => {
    type El = {
      className: string;
      kids: El[];
      attrs: Record<string, string>;
      append: (...k: El[]) => void;
      setAttribute: (k: string, v: string) => void;
    };
    const make = (): El => {
      const el: El = {
        className: '',
        kids: [],
        attrs: {},
        append: (...k) => el.kids.push(...k),
        setAttribute: (k, v) => {
          el.attrs[k] = v;
        },
      };
      return el;
    };
    const doc = { createElement: () => make() } as unknown as Document;
    const { root, text } = createHealAbsorbOverlay(doc);
    const r = root as unknown as El;
    expect(r.className).toBe(HEAL_ABSORB_ROOT_CLASS);
    expect(r.attrs['aria-hidden']).toBe('true');
    expect(r.kids.map((k) => k.className)).toEqual([
      HEAL_ABSORB_FILL_CLASS,
      HEAL_ABSORB_TEXT_CLASS,
    ]);
    expect(r.kids[1]).toBe(text);
  });
});

describe('hud.css: the heal-absorb contract', () => {
  const css = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
  const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf(`.${HEAL_ABSORB_ROOT_CLASS} {`));

  it('shows only under the on class, and reads the two edges the painter writes', () => {
    expect(css).toContain(`.${HEAL_ABSORB_ROOT_CLASS}.${HEAL_ABSORB_ON_CLASS} {`);
    expect(block).toContain(`var(${HEAL_ABSORB_START_PROP}`);
    expect(block).toContain(`var(${HEAL_ABSORB_END_PROP}`);
    expect(css).toContain(`.${HEAL_ABSORB_TEXT_CLASS}:empty {`);
  });

  it('is never hidden by the Show Absorb Shields gate or a graphics tier', () => {
    expect(css).not.toMatch(/absorb-shields-hidden[^{]*bar-heal-absorb/);
    expect(css).not.toMatch(/data-fx-level[^{]*bar-heal-absorb/);
  });

  it('every heal-absorb color is a token declared in tokens.css', () => {
    const used = new Set(block.slice(0, 2500).match(/--color-heal-absorb-[a-z]+/g) ?? []);
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) expect(tokens).toContain(`${name}:`);
  });

  it('the party signature repaints a row when the heal absorb changes', () => {
    const base = {
      leader: 1,
      raid: true,
      master: { enabled: false, looter: 0, threshold: 'uncommon' as const },
      members: [
        {
          pid: 2,
          name: 'A',
          cls: 'priest' as const,
          level: 60,
          hp: 500,
          mhp: 1000,
          res: 0,
          mres: 0,
          rtype: null,
          x: 0,
          z: 0,
          dead: 0,
          inCombat: 1,
          group: 1 as const,
          absorb: 0,
        },
      ],
    };
    const sig = (healAbsorb?: number) =>
      partyFrameSignature(
        { ...base, members: [{ ...base.members[0], healAbsorb }] },
        1,
        { x: 0, z: 0 },
        100,
      );
    expect(sig(300)).not.toBe(sig(120));
    expect(sig(undefined)).toBe(sig(0));
  });
});

describe('online-shaped inputs (ClientWorld mirror)', () => {
  it('a heal absorb decoded from the server aura wire draws the same as offline', async () => {
    const { wireAura } = await import('../server/snapshot_timer_wire');
    const { applyAuraWire } = await import('../src/net/aura_wire_decode');
    const offline = [healAbsorb(420)];
    const mirrored = applyAuraWire([], offline.map(wireAura) as never, {
      mode: 'legacy',
      time: null,
    });
    const input = (auras: readonly Aura[]) => ({ hp: 800, maxHp: 1000, auras });
    expect(healAbsorbBarView(input(mirrored))).toEqual(healAbsorbBarView(input(offline)));
    expect(healAbsorbBarView(input(mirrored)).text).toBe('420');
    // A broken crust leaves the wire (value 0 is omitted) and decodes as none.
    const spent = applyAuraWire([], [wireAura(healAbsorb(0))] as never, {
      mode: 'legacy',
      time: null,
    });
    expect(healAbsorbBarView(input(spent)).on).toBe(false);
  });

  it('a mirrored party row without the field (older server, or none up) reads none', () => {
    const v = unitFrameView(
      descriptor({ absorb: null, healAbsorb: { hp: 800, maxHp: 1000, healTotal: undefined } }),
    );
    expect(v.healAbsorb.on).toBe(false);
  });
});
