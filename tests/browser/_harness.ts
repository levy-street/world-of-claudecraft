// Shared harness for the opt-in browser-mode a11y suite. Runs IN the browser (Vitest 4
// Browser Mode), so it imports the real style barrel once (Lightning-processed exactly as the
// app build does it, so axe-core sees the real computed colors, tokens, and forced-colors
// rules) and renders the real window PAINTERS into a host element, the same Humble-Object
// consumers the app uses. Each window is fed a fixture IWorld + a stub deps bag; ClientWorld-vs-Sim
// parity is honored by driving the async windows under BOTH a Sim-shaped and a ClientWorld-mirror
// shaped fixture. The 3D world / canvas pixels stay OUT of scope: canvas host
// windows get a label + honest summary, never faked per-marker aria.

import axe from 'axe-core';
import '../../src/styles/index.css';

export type AxeViolation = {
  id: string;
  impact: string | null | undefined;
  help: string;
  nodes: { target: unknown[] }[];
};

// Run axe over `el` against the WCAG 2.0/2.1/2.2 A + AA rule tags and return only the serious
// and critical violations (the gate). Lower-impact best-practice findings (e.g. the
// role=option-on-button precedent) are not gated here.
export async function axeSeriousViolations(el: HTMLElement): Promise<AxeViolation[]> {
  const results = await axe.run(el, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  });
  return (results.violations as unknown as AxeViolation[]).filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
}

export function formatViolations(vs: AxeViolation[]): string {
  return vs.map((v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`).join('\n');
}

// A host element with the right id/class for a window painter to fill. Appended to <body> so
// it participates in the real layout + cascade (axe reads computed styles).
export function host(id: string, className = 'window panel'): HTMLElement {
  const el = document.createElement('div');
  el.id = id;
  el.className = className;
  el.style.display = 'block';
  document.body.appendChild(el);
  return el;
}

export function cleanup(): void {
  document.body.innerHTML = '';
}

// A stub deps bag: the painter's interface is large, but only a few members are exercised by
// an initial open()+render() (the rest are interaction callbacks: dialogs, dropdowns, cross
// -window commands). Override the members render() needs to return a real value; every other
// accessed member resolves to a no-op returning undefined. T is inferred from the call site
// (the window constructor's deps parameter) via NoInfer, so the overrides are type-checked
// against the FULL deps interface even though only a subset is supplied.
export function stubDeps<T extends object>(overrides: Partial<NoInfer<T>>): T {
  const noop = () => undefined;
  return new Proxy(overrides as Record<string, unknown>, {
    get(target, prop: string) {
      return prop in target ? target[prop] : noop;
    },
    has() {
      return true;
    },
  }) as unknown as T;
}

// Two fixture "world shapes" for ClientWorld-vs-Sim parity. Sim-shaped fixtures may carry extra
// fields the core ignores; the ClientWorld mirror carries only the wire-decoded fields. For
// most windows the rendered DOM is identical under both, which is the point: an offline-only
// shape assumption is what the dual run catches.
export type WorldShape = 'sim' | 'client';
