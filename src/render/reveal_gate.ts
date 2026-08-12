// Host adapter over reveal_gate_core: wires a cull's first-reveal hold to the
// renderer's live compile gate. One gate instance per consumer (the props
// far-cell swap, each town's static cull), each with its own key namespace
// and roots provider. The compile itself rides the caller-supplied host, so
// this module owns only the settle plumbing, and its contract is absolute:
// every requested key MUST settle, whatever the compiles do, or scenery
// stays hidden forever. Three independent escapes guarantee it: per-root
// rejections and synchronous throws are absorbed (this runs inside a
// per-frame cull consult, so nothing may escape), and a cancelable watchdog
// covers a link that never resolves (compile-gate timeouts are
// diagnostic-only and cannot resolve early; see compile_gate.ts). The timer
// is cleared on the winning path so a settled key leaves nothing pending,
// and a watchdog reveal says so on the dev channel (the gated_scene_attach
// shape).

import { createRevealGateCore, type RevealGateCore } from './reveal_gate_core';

export const REVEAL_GATE_WATCHDOG_MS = 10_000;

export interface RevealCompileHost {
  /** Compile one root's programs; resolves (or rejects) when settled. */
  compile(root: object): Promise<unknown>;
  /** Injectable watchdog scheduler; returns a cancel function. Defaults to
   *  setTimeout/clearTimeout. */
  schedule?: (onTimeout: () => void, ms: number) => () => void;
}

const defaultSchedule = (onTimeout: () => void, ms: number): (() => void) => {
  const timer = setTimeout(onTimeout, ms);
  return () => clearTimeout(timer);
};

export function createRevealGate(
  host: RevealCompileHost,
  rootsFor: (key: string) => readonly object[],
): RevealGateCore {
  const schedule = host.schedule ?? defaultSchedule;
  const gate: RevealGateCore = createRevealGateCore((key) => {
    let roots: readonly object[] = [];
    try {
      roots = rootsFor(key);
    } catch (error) {
      console.error('Reveal gate roots lookup failed', key, error);
    }
    const compiles = roots.map((root) => {
      try {
        return Promise.resolve(host.compile(root)).catch(() => undefined);
      } catch (error) {
        console.error('Reveal gate compile request failed', key, error);
        return undefined;
      }
    });
    let settled = false;
    const cancelWatchdog = schedule(() => {
      if (settled) return;
      settled = true;
      console.warn(`Reveal gate watchdog revealed ${key} before its compiles settled`);
      gate.settle(key);
    }, REVEAL_GATE_WATCHDOG_MS);
    void Promise.all(compiles).then(() => {
      cancelWatchdog();
      if (settled) return;
      settled = true;
      gate.settle(key);
    });
  });
  return gate;
}
