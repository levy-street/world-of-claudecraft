// @vitest-environment happy-dom
// The Guardian of the Quench's screen effects (src/ui/hud/dungeon/
// quench_screen_view.ts + quench_screen_painter.ts):
//   - the frost border creeps in with the local player's cold bar, sits at its
//     deepest frozen solid (the bar resets to zero as they freeze), and goes
//     with the shatter;
//   - in a hole of freezing water the screen takes the blue tint;
//   - hidden out of the fight and dead;
//   - read off a REAL fight's mirrored auras, not hand-built ones only;
//   - the painter writes nothing on a still frame and mounts one overlay;
//   - the stylesheet keeps the screen's middle clear and the overlay under
//     the HUD frames (the raid stays in view).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUENCH_AURAS, QUENCH_TUNING as T } from '../src/sim/encounters/smith_heart/quench_ids';
import { DT, type Entity } from '../src/sim/types';
import { QuenchScreenOverlay } from '../src/ui/hud/dungeon/quench_screen_painter';
import {
  buildQuenchScreenView,
  frostReach,
  makeQuenchScreenView,
  QUENCH_FROST_STEPS,
} from '../src/ui/hud/dungeon/quench_screen_view';
import { makeWriterFacet } from '../src/ui/painter_host';
import { type QuenchFight, quenchFight } from './helpers/quench_fight';

const ticks = (s: number) => Math.round(s / DT);

function pulled(n = 6): QuenchFight {
  const f = quenchFight(n);
  expect(f.dev('/dev heart quench pull')).toBe(true);
  f.tick(ticks(T.rimRise) + 2);
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.breathTimer = 999;
  return f;
}

function setCold(f: QuenchFight, e: Entity, v: number): void {
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.chill[e.id] = { cold: v, frozen: 0 };
}

const viewOf = (e: Entity) =>
  buildQuenchScreenView({ auras: e.auras, dead: e.dead }, makeQuenchScreenView());

describe('Guardian of the Quench: the screen view', () => {
  it('is hidden with no fight aura, and when dead', () => {
    expect(viewOf({ auras: [], dead: false } as unknown as Entity).visible).toBe(false);
    const dead = buildQuenchScreenView(
      { auras: [{ id: QUENCH_AURAS.cold, value: 60 }], dead: true },
      makeQuenchScreenView(),
    );
    expect(dead).toMatchObject({ visible: false, frost: 0, frozen: false, submerged: false });
  });

  it("the frost's reach follows the bar, stepped, clamped to the bar's range", () => {
    const at = (cold: number) =>
      buildQuenchScreenView(
        { auras: [{ id: QUENCH_AURAS.cold, value: cold }] },
        makeQuenchScreenView(),
      );
    expect(at(0)).toMatchObject({ visible: true, frost: 0, frozen: false, submerged: false });
    expect(at(T.coldMax / 4).frost).toBeCloseTo(0.25);
    expect(at(T.coldMax / 2).frost).toBeCloseTo(0.5);
    expect(at(T.coldMax * 2).frost).toBe(1);
    expect(at(-5).frost).toBe(0);
    // Monotonic: a colder bar never shows less frost.
    let last = -1;
    for (let c = 0; c <= T.coldMax; c++) {
      const r = frostReach(c);
      expect(r).toBeGreaterThanOrEqual(last);
      expect(r * QUENCH_FROST_STEPS).toBeCloseTo(Math.round(r * QUENCH_FROST_STEPS), 9);
      last = r;
    }
  });

  it('frozen solid holds the frost at full even though the bar reset to zero', () => {
    const v = buildQuenchScreenView(
      {
        auras: [
          { id: QUENCH_AURAS.cold, value: 0 },
          { id: QUENCH_AURAS.frozen, value: 1 },
        ],
      },
      makeQuenchScreenView(),
    );
    expect(v).toMatchObject({ visible: true, frost: 1, frozen: true, submerged: false });
  });

  it('the water tints the screen; out of it the tint goes', () => {
    const inWater = buildQuenchScreenView(
      {
        auras: [
          { id: QUENCH_AURAS.cold, value: 40 },
          { id: QUENCH_AURAS.trapped, value: 0 },
        ],
      },
      makeQuenchScreenView(),
    );
    expect(inWater).toMatchObject({ visible: true, submerged: true, frozen: false });
    expect(inWater.frost).toBeCloseTo(0.4);
    // The same model, rewritten: a stale flag never survives the next frame.
    const out = buildQuenchScreenView({ auras: [{ id: QUENCH_AURAS.cold, value: 40 }] }, inWater);
    expect(out).toBe(inWater);
    expect(out.submerged).toBe(false);
  });

  it('reads a real fight: the bar rising, the freeze, the shatter, the water', () => {
    const f = pulled(6);
    const p = f.players[2];
    f.put(p, 182, 14);
    f.tick(1);
    // Alone, the cold rises and the frost creeps in with it.
    const a = viewOf(p);
    expect(a.visible).toBe(true);
    f.tick(ticks(4));
    const b = viewOf(p);
    expect(b.frost).toBeGreaterThan(a.frost);
    expect(b.frost).toBeCloseTo(frostReach(f.cold(p) ?? 0));
    // Full: frozen solid, the frost at its deepest though the bar is back at zero.
    setCold(f, p, T.coldMax - 0.1);
    f.tick(2);
    expect(f.cold(p)).toBe(0);
    expect(viewOf(p)).toMatchObject({ visible: true, frost: 1, frozen: true });
    // The ice shatters: the frost goes with it.
    f.tick(ticks(T.freezeSeconds) + 2);
    expect(viewOf(p).frozen).toBe(false);
    expect(viewOf(p).frost).toBeLessThan(1);
    // A hole under the player: in the water, the tint is on; climbed out, off.
    const w = f.players[3];
    f.put(w, 186, 14);
    f.tick(1);
    f.dev('/dev heart quench hole', w.id);
    f.tick(1, false);
    expect(viewOf(w).submerged).toBe(true);
    f.tick(ticks(T.trapSeconds) + 4, false);
    expect(viewOf(w).submerged).toBe(false);
  });
});

describe('Guardian of the Quench: the screen painter', () => {
  it('mounts one aria-hidden overlay and writes nothing on a still frame', () => {
    const layer = document.createElement('div');
    document.body.append(layer);
    let writes = 0;
    const facet = makeWriterFacet(
      new WeakMap() as never,
      new WeakMap(),
      new WeakMap(),
      new WeakMap(),
      () => {
        writes++;
      },
      () => {},
    );
    const overlay = new QuenchScreenOverlay({ layer: () => layer, writers: facet });
    // Hidden before the fight: nothing is mounted.
    overlay.paint(makeQuenchScreenView());
    expect(layer.querySelector('#heart-quench-screen')).toBeNull();
    const view = buildQuenchScreenView(
      { auras: [{ id: QUENCH_AURAS.cold, value: 50 }] },
      makeQuenchScreenView(),
    );
    overlay.paint(view);
    const el = layer.querySelector('#heart-quench-screen') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('.hqs-frost')).not.toBeNull();
    expect(el.querySelector('.hqs-water')).not.toBeNull();
    expect(el.style.getPropertyValue('--hqs-frost')).toBe('0.50');
    expect(el.classList.contains('is-submerged')).toBe(false);
    const first = writes;
    let mutations = 0;
    const obs = new MutationObserver((m) => {
      mutations += m.length;
    });
    obs.observe(el, { attributes: true, childList: true, subtree: true, characterData: true });
    overlay.paint(buildQuenchScreenView({ auras: [{ id: QUENCH_AURAS.cold, value: 50 }] }, view));
    expect(obs.takeRecords().length + mutations).toBe(0);
    expect(writes).toBe(first);
    // Frozen and in the water: the classes flip; one overlay still.
    overlay.paint(
      buildQuenchScreenView(
        {
          auras: [
            { id: QUENCH_AURAS.frozen, value: 1 },
            { id: QUENCH_AURAS.trapped, value: 0 },
          ],
        },
        view,
      ),
    );
    expect(el.classList.contains('is-frozen')).toBe(true);
    expect(el.classList.contains('is-submerged')).toBe(true);
    expect(el.style.getPropertyValue('--hqs-frost')).toBe('1.00');
    expect(layer.querySelectorAll('#heart-quench-screen').length).toBe(1);
    overlay.paint(buildQuenchScreenView({ auras: [] }, view));
    expect(el.style.display).toBe('none');
    overlay.dispose();
    expect(layer.querySelector('#heart-quench-screen')).toBeNull();
  });
});

describe('Guardian of the Quench: the screen stylesheet', () => {
  const css = readFileSync('src/styles/hud.css', 'utf8');
  const start = css.indexOf('/* ---------- Quench frost and water screen effects ---------- */');
  const body = css.slice(start, css.indexOf('/* ---------- death overlay', start));

  it('keeps the middle of the screen clear at full frost', () => {
    expect(start).toBeGreaterThan(0);
    // The clear middle shrinks with the frost to 42 percent of the corner
    // distance at its deepest, never to nothing.
    const m = body.match(/--hqs-clear: calc\((\d+)% - var\(--hqs-frost\) \* (\d+)%\)/);
    expect(m).not.toBeNull();
    expect(Number(m?.[1]) - Number(m?.[2])).toBeGreaterThanOrEqual(40);
    expect(body).toContain('transparent var(--hqs-clear)');
  });

  it('sits under the HUD frames and never takes the pointer', () => {
    const z = Number(body.match(/#heart-quench-screen \{[^}]*z-index: (\d+);/)?.[1]);
    const vignette = Number(css.match(/#low-health-vignette \{[^}]*z-index: (\d+);/)?.[1]);
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThanOrEqual(vignette);
    expect(body).toMatch(/#heart-quench-screen \{[^}]*pointer-events: none;/);
  });
});
