import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Aura } from '../src/sim/types';
import { createShadowChargeMeter } from '../src/ui/hud/priest/shadow_charge_meter';
import {
  type ShadowChargeElements,
  ShadowChargePainter,
} from '../src/ui/hud/priest/shadow_charge_painter';
import {
  createShadowChargeView,
  type ShadowChargePlayer,
} from '../src/ui/hud/priest/shadow_charge_view';
import { makeWriterFacet } from '../src/ui/painter_host';
import { FakeDocument, type FakeElement } from './helpers/fake_dom';
import { assertAllocationStable } from './util/alloc_probe';

const formatters = {
  count: (value: number, max: number) => `${value} / ${max}`,
  gloomStatus: (value: number, max: number) => `Gloom ${value} of ${max}`,
  bombStatus: (value: number, max: number) => `Bomb ${value} of ${max}`,
};

function player(gloom = 0, bomb = 0): ShadowChargePlayer {
  const aura = (id: string, kind: Aura['kind'], stacks: number): Aura => ({
    id,
    kind,
    name: id,
    duration: 1,
    remaining: 1,
    value: 0,
    sourceId: 7,
    school: 'shadow',
    stacks,
  });
  return {
    id: 7,
    templateId: 'priest',
    level: 20,
    auras: [
      aura('gloomtithe', 'gloomtithe', gloom),
      aura('spirit_bomb_progress', 'spirit_bomb_charge', bomb),
    ],
  };
}

function painterHarness() {
  const doc = new FakeDocument();
  const el = () => doc.createElement('div') as unknown as HTMLElement;
  const elements: ShadowChargeElements = {
    frame: el(),
    gloomRoot: el(),
    gloomCount: el(),
    gloomPips: [el(), el(), el(), el(), el()],
    bombRoot: el(),
    bombFill: el(),
    bombOrbFill: el(),
    bombCount: el(),
    readyLabel: el(),
  };
  let writes = 0;
  const writers = makeWriterFacet(
    new WeakMap(),
    new WeakMap(),
    new WeakMap(),
    new WeakMap(),
    () => writes++,
    () => {},
  );
  return {
    elements,
    writers,
    painter: new ShadowChargePainter(writers, elements),
    writes: () => writes,
  };
}

describe('Shadow Priest charge HUD', () => {
  it('separates the five spendable charges from the twenty-generation bomb bank', () => {
    const view = createShadowChargeView(formatters);
    const input = player(5, 19);
    expect(view.tick(input, 'shadow')).toMatchObject({
      visible: true,
      bombVisible: true,
      gloomtithe: 5,
      bombProgress: 19,
      bombFill: 0.95,
      ready: false,
    });
    input.auras[1].stacks = 20;
    expect(view.tick(input, 'shadow')).toMatchObject({
      gloomtithe: 5,
      bombProgress: 20,
      ready: true,
    });
    input.auras[0].stacks = 0;
    expect(view.tick(input, 'shadow')).toMatchObject({
      gloomtithe: 0,
      bombProgress: 20,
      ready: true,
    });
  });

  it('shows only learned resources for Shadow and hides other classes and specs', () => {
    const view = createShadowChargeView(formatters);
    const input = player();
    input.level = 9;
    expect(view.tick(input, 'shadow').visible).toBe(false);
    input.level = 10;
    expect(view.tick(input, 'shadow')).toMatchObject({ visible: true, bombVisible: false });
    input.level = 19;
    expect(view.tick(input, 'shadow').bombVisible).toBe(false);
    input.level = 20;
    expect(view.tick(input, 'shadow').bombVisible).toBe(true);
    expect(view.tick(input, 'holy').visible).toBe(false);
    expect(view.tick(input, 'discipline').visible).toBe(false);
    expect(view.tick(input, null).visible).toBe(false);
    input.templateId = 'warlock';
    expect(view.tick(input, 'shadow').visible).toBe(false);
  });

  it('ignores another source and clamps malformed replicated counts', () => {
    const view = createShadowChargeView(formatters);
    const input = player(99, -1);
    expect(view.tick(input, 'shadow')).toMatchObject({ gloomtithe: 5, bombProgress: 0 });
    input.auras[0].sourceId = 8;
    input.auras[1].stacks = Number.NaN;
    expect(view.tick(input, 'shadow')).toMatchObject({ gloomtithe: 0, bombProgress: 0 });
    input.auras[1].stacks = 99;
    expect(view.tick(input, 'shadow').bombProgress).toBe(20);
    input.auras[1].sourceId = 8;
    expect(view.tick(input, 'shadow')).toMatchObject({ bombProgress: 0, ready: false });
  });

  it('reuses its state for local and replicated entity snapshots', () => {
    const view = createShadowChargeView(formatters);
    const local = player(3, 11);
    const mirrored = { ...local, auras: local.auras.map((aura) => ({ ...aura })) };
    const expected = { ...view.tick(local, 'shadow') };
    expect(view.tick(mirrored, 'shadow')).toEqual(expected);
    assertAllocationStable(() => view.tick(mirrored, 'shadow'));
  });

  it('formats only changed visible counts and invalidates labels when the locale changes', () => {
    let locale = 'en';
    const count = vi.fn((value: number, max: number) => `${locale}:${value}/${max}`);
    const gloomStatus = vi.fn((value: number) => `${locale}:gloom:${value}`);
    const bombStatus = vi.fn((value: number) => `${locale}:bomb:${value}`);
    const view = createShadowChargeView({ count, gloomStatus, bombStatus });
    const input = player(2, 7);
    view.tick(input, 'holy');
    expect(count).not.toHaveBeenCalled();
    view.tick(input, 'shadow');
    expect(count).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 30; i++) view.tick(input, 'shadow');
    expect(count).toHaveBeenCalledTimes(2);
    expect(gloomStatus).toHaveBeenCalledTimes(1);
    expect(bombStatus).toHaveBeenCalledTimes(1);
    input.auras[0].stacks = 3;
    view.tick(input, 'shadow');
    expect(count).toHaveBeenCalledTimes(3);
    expect(bombStatus).toHaveBeenCalledTimes(1);
    locale = 'es';
    view.invalidateLabels();
    expect(view.tick(input, 'shadow')).toMatchObject({
      gloomCount: 'es:3/5',
      bombCount: 'es:7/20',
      gloomStatus: 'es:gloom:3',
      bombStatus: 'es:bomb:7',
    });
    expect(count).toHaveBeenCalledTimes(5);
    expect(view.tick(input, 'holy')).toMatchObject({ gloomCount: '', bombCount: '', ready: false });
    expect(count).toHaveBeenCalledTimes(5);
  });

  it('paints readable counts and readiness and elides every repeated frame', () => {
    const harness = painterHarness();
    const state = createShadowChargeView(formatters).tick(player(3, 20), 'shadow');
    harness.painter.paint(state);
    const initialWrites = harness.writes();
    expect(initialWrites).toBeGreaterThan(0);
    harness.painter.paint(state);
    expect(harness.writes()).toBe(initialWrites);
    const gloomRoot = harness.elements.gloomRoot as unknown as FakeElement;
    const bombRoot = harness.elements.bombRoot as unknown as FakeElement;
    expect(gloomRoot.getAttribute('aria-valuenow')).toBe('3');
    expect(bombRoot.getAttribute('aria-valuetext')).toBe('Bomb 20 of 20');
    expect(bombRoot.classList.contains('ready')).toBe(true);
    expect(harness.elements.bombCount.textContent).toBe('20 / 20');
    expect(harness.elements.gloomPips.map((pip) => pip.classList.contains('on'))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(
      (harness.elements.readyLabel as unknown as FakeElement).style.getPropertyValue('visibility'),
    ).toBe('visible');
  });

  it('hides an unlearned bomb and clears readiness after consumption or a reset', () => {
    const harness = painterHarness();
    const view = createShadowChargeView(formatters);
    const input = player(5, 20);
    harness.painter.paint(view.tick(input, 'shadow'));
    input.auras[1].stacks = 0;
    harness.painter.paint(view.tick(input, 'shadow'));
    expect(harness.elements.bombRoot.classList.contains('ready')).toBe(false);
    expect(
      (harness.elements.bombFill as unknown as FakeElement).style.getPropertyValue(
        '--priest-progress',
      ),
    ).toBe('0.000');
    input.level = 19;
    harness.painter.paint(view.tick(input, 'shadow'));
    expect((harness.elements.bombRoot as unknown as FakeElement).style.display).toBe('none');
    expect(harness.elements.bombRoot.getAttribute('aria-hidden')).toBe('true');
  });

  it('builds keyboard-focusable localized meters and attaches both tooltips', () => {
    const doc = new FakeDocument();
    const frame = doc.createElement('div');
    Object.assign(frame, { querySelector: () => null });
    const harness = painterHarness();
    const attached: { element: HTMLElement; html: () => string }[] = [];
    const meter = createShadowChargeMeter(
      doc as unknown as Document,
      frame as unknown as HTMLElement,
      harness.writers,
      {
        ...formatters,
        gloomLabel: () => 'Gloom',
        bombLabel: () => 'Bomb',
        readyLabel: () => 'Ready',
        gloomTooltip: () => 'Spendable',
        bombTooltip: () => 'Generated',
      },
      (element, html) => attached.push({ element, html }),
    );
    meter.paint(player(2, 7), 'shadow');
    expect(attached).toHaveLength(2);
    expect(attached.map((entry) => entry.html())).toEqual(['Spendable', 'Generated']);
    for (const { element } of attached) {
      expect(element.tabIndex).toBe(0);
      expect(element.getAttribute('role')).toBe('meter');
      expect(element.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('keeps actionable state independent of quality and honors touch and reduced motion', () => {
    const css = readFileSync(new URL('../src/styles/hud.priest.css', import.meta.url), 'utf8');
    expect(css).toContain('body.mobile-touch .priest-charge-frame');
    expect(css).toContain('min-height: 40px');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('transition: none');
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).not.toMatch(/fx-tier|graphics-preset|display:\s*none[^}]*mobile-touch/);
  });

  it('keeps the independent mobile medallion targets large enough at minimum UI scale', () => {
    const css = readFileSync(new URL('../src/styles/hud.priest.css', import.meta.url), 'utf8');
    const frame = css.match(/body\.mobile-touch \.priest-charge-frame\s*\{([^}]+)\}/)?.[1];
    expect(frame).toContain('flex-direction: column');
    expect(frame).toContain('align-items: center');
    const meters = css.match(
      /body\.mobile-touch \.priest-gloom-meter,\s*body\.mobile-touch \.priest-bomb-meter\s*\{([^}]+)\}/,
    )?.[1];
    expect(meters).toContain('min-width: calc(40px / var(--priest-touch-scale))');
    expect(meters).toContain('min-height: calc(40px / var(--priest-touch-scale))');
    const count = css.match(/\.priest-charge-count\s*\{([^}]+)\}/)?.[1];
    expect(count).toContain('flex: 0 0 auto');
    expect(count).toContain('white-space: nowrap');
    expect(css).not.toContain('--player-frame-scale');
    expect(css).toContain('.priest-charge-frame.hud-frame-detached');
  });
});
