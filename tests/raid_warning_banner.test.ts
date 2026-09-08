// RaidWarningBanner (src/ui/hud/chat/raid_warning_banner.ts): the WoW-style raid warning
// banner stack. Pins the stack contract: lines prepend in order (newest on top,
// "el segundo se pone encima del primero"), the oldest line drops past maxLines,
// and each line fades then removes on its own timer. Driven over a fake DOM + fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RAID_WARNING_FADE_MS,
  RAID_WARNING_LINE_MS,
  RAID_WARNING_MAX_LINES,
  RaidWarningBanner,
} from '../src/ui/hud/chat/raid_warning_banner';

interface FakeEl {
  className: string;
  textContent: string;
  children: FakeEl[];
  parentEl: FakeEl | null;
  firstElementChild: FakeEl | null;
  lastElementChild: FakeEl | null;
  ownerDocument: { createElement(tag: string): FakeEl };
  classList: { add(c: string): void; contains(c: string): boolean };
  prepend(kid: FakeEl): void;
  remove(): void;
}

function fakeEl(): FakeEl {
  const classes = new Set<string>();
  const el: FakeEl = {
    className: '',
    textContent: '',
    children: [],
    parentEl: null,
    get firstElementChild() {
      return el.children[0] ?? null;
    },
    get lastElementChild() {
      return el.children[el.children.length - 1] ?? null;
    },
    ownerDocument: { createElement: () => fakeEl() },
    classList: {
      add: (c) => classes.add(c),
      contains: (c) => classes.has(c),
    },
    prepend(kid) {
      kid.parentEl = el;
      el.children.unshift(kid);
    },
    remove() {
      const p = el.parentEl;
      if (!p) return;
      const i = p.children.indexOf(el);
      if (i >= 0) p.children.splice(i, 1);
      el.parentEl = null;
    },
  };
  return el;
}

describe('RaidWarningBanner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('prepends a line per raid warning event, newest first (encima del primero)', () => {
    const host = fakeEl();
    const banner = new RaidWarningBanner(host as unknown as HTMLElement);
    banner.show('Primer mensaje');
    banner.show('Segundo mensaje');
    expect(host.children.map((c) => c.textContent)).toEqual(['Segundo mensaje', 'Primer mensaje']);
    expect(host.children[0].className).toBe('raid-warning-line');
  });

  it('drops the OLDEST line when the stack overflows maxLines', () => {
    const host = fakeEl();
    const banner = new RaidWarningBanner(host as unknown as HTMLElement);
    for (let i = 1; i <= RAID_WARNING_MAX_LINES + 2; i++) banner.show(`Alerta ${i}`);
    expect(host.children).toHaveLength(RAID_WARNING_MAX_LINES);
    // Oldest were Alerta 1 and Alerta 2; newest are Alerta 5, 4, 3 (newest at top)
    expect(host.children[0].textContent).toBe(`Alerta ${RAID_WARNING_MAX_LINES + 2}`);
    expect(host.children.at(-1)?.textContent).toBe('Alerta 3');
  });

  it('fades a line after its visible window, then removes it after the fade', () => {
    const host = fakeEl();
    const banner = new RaidWarningBanner(host as unknown as HTMLElement);
    banner.show('Cuidado con el fuego!');
    const line = host.children[0];
    vi.advanceTimersByTime(RAID_WARNING_LINE_MS - 1);
    expect(line.classList.contains('fade')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(line.classList.contains('fade')).toBe(true);
    expect(host.children).toHaveLength(1);
    vi.advanceTimersByTime(RAID_WARNING_FADE_MS);
    expect(host.children).toHaveLength(0);
  });

  it('sequential messages fade in chronological FIFO order (oldest first)', () => {
    const host = fakeEl();
    const banner = new RaidWarningBanner(host as unknown as HTMLElement);
    banner.show('Primero');
    vi.advanceTimersByTime(1000);
    banner.show('Segundo');

    expect(host.children.map((c) => c.textContent)).toEqual(['Segundo', 'Primero']);

    // Advance to when Primero expires (total 3500ms since Primero, 2500ms since Segundo)
    vi.advanceTimersByTime(RAID_WARNING_LINE_MS - 1000);
    const primero = host.children.find((c) => c.textContent === 'Primero');
    const segundo = host.children.find((c) => c.textContent === 'Segundo');
    expect(primero).toBeDefined();
    expect(segundo).toBeDefined();
    expect(primero?.classList.contains('fade')).toBe(true);
    expect(segundo?.classList.contains('fade')).toBe(false);

    // Fade completes for Primero
    vi.advanceTimersByTime(RAID_WARNING_FADE_MS);
    expect(host.children.map((c) => c.textContent)).toEqual(['Segundo']);

    // Advance until Segundo reaches its expiration
    vi.advanceTimersByTime(1000 - RAID_WARNING_FADE_MS);
    expect(segundo?.classList.contains('fade')).toBe(true);

    // Fade completes for Segundo
    vi.advanceTimersByTime(RAID_WARNING_FADE_MS);
    expect(host.children).toHaveLength(0);
  });

  it('a line already dropped by overflow does not throw when its fade timer fires', () => {
    const host = fakeEl();
    const banner = new RaidWarningBanner(host as unknown as HTMLElement, 1);
    banner.show('primero');
    banner.show('segundo');
    expect(host.children.map((c) => c.textContent)).toEqual(['segundo']);
    vi.advanceTimersByTime(RAID_WARNING_LINE_MS + RAID_WARNING_FADE_MS);
    expect(host.children).toHaveLength(0);
  });
});
