// @vitest-environment happy-dom
//
// The shared rebuild-refocus helper (#2528), extracted from about ten hand-rolled
// copies in src/ui. Two halves, tested here against the shapes the real callers hand
// it rather than against invented ones:
//
//  - captureFocusKey: the activeElement narrowing, the containment check, and the
//    dataset read. The containment check is the acceptance criterion of the extraction:
//    mailbox_window and town_focus_window key their steppers under the SAME
//    `data-focus-key` attribute in the same `<id>:<role>` shape, so ONE flat namespace
//    is shared across windows and a copy that forgot the check would let its own
//    repaint pull focus out of the other window. That is what the cross-window case
//    below plants.
//  - restoreFirstEnabled: the walk and the disabled skip. Every rung the two migrated
//    callers actually pass is represented: a button (both), an `<input type=number>`
//    (mailbox's quantity field), a `null` hole (town focus's `querySelector` miss) and
//    an `undefined` one (mailbox's `Map.get` / optional-field miss).
//
// jsdom rather than the fake-element harness tests/dialog_root.test.ts uses:
// captureFocusKey's whole job is `document.activeElement` plus a real
// `instanceof HTMLElement`, and a fake document cannot pin either.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureFocusKey,
  findFocusKey,
  focusedWithin,
  restoreFirstEnabled,
} from '../src/ui/focus_restore';
import { tsFilesUnder } from './helpers/ts_files_under';

afterEach(() => {
  document.body.innerHTML = '';
  restoreActiveElement();
});

/** A window root holding one keyed, focusable button. */
function windowWithKeyedButton(key: string): { root: HTMLElement; btn: HTMLButtonElement } {
  const root = document.createElement('div');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.focusKey = key;
  root.appendChild(btn);
  document.body.appendChild(root);
  return { root, btn };
}

// Overriding document.activeElement is the only way to reach the non-HTMLElement
// branch: jsdom will not put focus on an element that has no focus() of its own, and
// the point of the branch is precisely an activeElement the DOM handed back that is not
// an HTMLElement. Restored after every test so no later case inherits the stub.
let activeElementStubbed = false;
function stubActiveElement(value: Element | null): void {
  Object.defineProperty(document, 'activeElement', { get: () => value, configurable: true });
  activeElementStubbed = true;
}
function restoreActiveElement(): void {
  if (!activeElementStubbed) return;
  activeElementStubbed = false;
  // The own property has to be GONE, not undefined, or the native prototype getter
  // stays shadowed and every later case reads `undefined` as its activeElement.
  delete (document as unknown as Record<string, unknown>).activeElement;
}

/**
 * A candidate that records every focus() call AND its arguments, for the order,
 * stop-at-first and bare-call pins. The arguments matter: a real element's focus()
 * accepts FocusOptions, so a count alone cannot tell a bare `focus()` from a
 * `focus({ preventScroll: true })`, which is the decision the module claims to settle.
 */
function fakeCandidate(disabled?: boolean): {
  disabled?: boolean;
  focus(...args: unknown[]): void;
  calls: number;
  args: unknown[][];
} {
  return {
    disabled,
    calls: 0,
    args: [],
    focus(...args: unknown[]) {
      this.calls++;
      this.args.push(args);
    },
  };
}

describe('captureFocusKey', () => {
  it('carries the key of the focused control inside the root', () => {
    const { root, btn } = windowWithKeyedButton('mail_wolf_fang:plus');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    expect(captureFocusKey(root)).toBe('mail_wolf_fang:plus');
  });

  it('refuses a keyed control in ANOTHER window, even with the identical key', () => {
    // The extraction's acceptance criterion. Two windows, one shared key namespace:
    // the mailbox parcel stepper and the town focus stepper really are both
    // `<id>:<role>` under `data-focus-key`. Focus is in window B; window A repaints.
    // A returns null, so A's ladder never runs and focus stays where the player put
    // it. Note the key is the SAME string in both, which is what makes this a refusal
    // by CONTAINMENT and not by key mismatch.
    const a = windowWithKeyedButton('hide:inc');
    const b = windowWithKeyedButton('hide:inc');
    b.btn.focus();
    expect(captureFocusKey(a.root)).toBeNull();
    // ...and the window that DOES contain it still gets it, so the refusal above is
    // not simply "this helper never returns anything in a two-window document".
    expect(captureFocusKey(b.root)).toBe('hide:inc');
  });

  it('carries nothing when the focused control inside the root has no key', () => {
    const root = document.createElement('div');
    const btn = document.createElement('button');
    root.appendChild(btn);
    document.body.appendChild(root);
    btn.focus();
    expect(document.activeElement).toBe(btn);
    expect(captureFocusKey(root)).toBeNull();
  });

  it("reads the focused node's OWN key, never an ancestor's", () => {
    // No `closest()` walk, which is right for both callers (the key sits on the focusable
    // control itself) and needs its own case: the key-free case above uses a key-free
    // root, so it would still pass if someone added an ancestor walk. A keyed WRAPPER
    // around a key-free focused button is the shape that tells the two apart.
    const root = document.createElement('div');
    const wrapper = document.createElement('div');
    wrapper.dataset.focusKey = 'wolf_fang:minus';
    const btn = document.createElement('button');
    wrapper.appendChild(btn);
    root.appendChild(wrapper);
    document.body.appendChild(root);
    btn.focus();
    expect(document.activeElement).toBe(btn);
    expect(wrapper.dataset.focusKey).toBe('wolf_fang:minus');
    expect(captureFocusKey(root)).toBeNull();
  });

  it('carries nothing when focus is on <body> (nothing in the window was focused)', () => {
    const { root } = windowWithKeyedButton('save');
    expect(document.activeElement).toBe(document.body);
    expect(captureFocusKey(root)).toBeNull();
  });

  it('carries nothing when activeElement is null, as WebKit can report', () => {
    const { root } = windowWithKeyedButton('save');
    stubActiveElement(null);
    expect(captureFocusKey(root)).toBeNull();
  });

  it('carries nothing from a non-HTMLElement, even one inside the root carrying a key', () => {
    // The narrowing, and the one case a plain `as HTMLElement` cast (what most of the
    // hand-rolled copies did, mailbox_window included) got wrong: an SVGElement is
    // contained, is not an HTMLElement, and still answers `dataset`. So the cast would
    // read a key here and the ladder would run off it.
    const root = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-focus-key', 'wolf_fang:remove');
    root.appendChild(svg);
    document.body.appendChild(root);
    // Proof the case is the one described: contained, keyed, and NOT an HTMLElement.
    expect(root.contains(svg)).toBe(true);
    expect(svg.getAttribute('data-focus-key')).toBe('wolf_fang:remove');
    expect(svg instanceof HTMLElement).toBe(false);
    stubActiveElement(svg);
    expect(captureFocusKey(root)).toBeNull();
  });
});

describe('focusedWithin', () => {
  it('returns the focused control inside the root', () => {
    const { root, btn } = windowWithKeyedButton('k');
    btn.focus();
    expect(focusedWithin(root)).toBe(btn);
  });

  it('returns null when the ROOT ITSELF holds focus (pointer focus parked there by pointer_blur.ts)', () => {
    // The park slot is not a control: a ladder that read it as one would resolve no
    // key and land on its Close rung after every mouse click in the window.
    const { root } = windowWithKeyedButton('k');
    root.tabIndex = -1;
    root.focus();
    expect(document.activeElement).toBe(root);
    expect(focusedWithin(root)).toBeNull();
  });

  it('returns null for a dialog root NESTED inside the root (the park lands on the nearest one)', () => {
    // dropPointerFocus parks on closest([role="dialog"]); a window that nests a
    // second dialog root would otherwise see the inner root as a keyless control
    // and fall through to Close.
    const { root } = windowWithKeyedButton('k');
    const inner = document.createElement('div');
    inner.setAttribute('role', 'dialog');
    inner.tabIndex = -1;
    root.appendChild(inner);
    inner.focus();
    expect(document.activeElement).toBe(inner);
    expect(focusedWithin(root)).toBeNull();
  });

  it('never hands back <body>, even for a Document root (the one ParentNode that contains it)', () => {
    const { btn } = windowWithKeyedButton('k');
    btn.blur();
    expect(document.activeElement).toBe(document.body);
    expect(focusedWithin(document)).toBeNull();
    btn.focus();
    expect(focusedWithin(document)).toBe(btn);
  });

  it('returns null when focus is on <body> or in another window', () => {
    const { root } = windowWithKeyedButton('k');
    const other = windowWithKeyedButton('elsewhere');
    other.btn.focus();
    expect(focusedWithin(root)).toBeNull();
    other.btn.blur();
    expect(focusedWithin(root)).toBeNull();
  });
});

describe('findFocusKey', () => {
  it('resolves by exact dataset equality without selector interpolation', () => {
    const hostile = 'vault:row:pooled:a"b]';
    const { root, btn } = windowWithKeyedButton(hostile);
    const neighbor = document.createElement('button');
    neighbor.dataset.focusKey = 'vault:row:pooled:copper_ore';
    root.appendChild(neighbor);

    expect(() => findFocusKey(root, hostile)).not.toThrow();
    expect(findFocusKey(root, hostile)).toBe(btn);
    expect(findFocusKey(root, `${hostile}:missing`)).toBeNull();
  });
});

describe('restoreFirstEnabled', () => {
  it('focuses the first candidate when it is enabled', () => {
    const { btn } = windowWithKeyedButton('a');
    restoreFirstEnabled([btn]);
    expect(document.activeElement).toBe(btn);
  });

  it('skips a candidate that came back DISABLED and takes the next one', () => {
    // The whole reason a bare `candidates[0]?.focus()` will not do: the control the
    // player just activated is exactly the one the rebuild can disable.
    const first = windowWithKeyedButton('inc').btn;
    const second = windowWithKeyedButton('dec').btn;
    first.disabled = true;
    restoreFirstEnabled([first, second]);
    expect(document.activeElement).toBe(second);
  });

  it('skips null AND undefined holes, both of which the real callers pass', () => {
    const btn = windowWithKeyedButton('save').btn;
    restoreFirstEnabled([null, undefined, btn]);
    expect(document.activeElement).toBe(btn);
  });

  it('focuses an <input>, the rung mailbox_window most wants to keep', () => {
    // Not every candidate is a button: mailbox's ladder falls back to the parcel's
    // typed quantity field, because a number input fires `change` WITHOUT blurring,
    // so the repaint runs while the input is focused.
    const root = document.createElement('div');
    const qty = document.createElement('input');
    qty.type = 'number';
    root.appendChild(qty);
    document.body.appendChild(root);
    restoreFirstEnabled([qty]);
    expect(document.activeElement).toBe(qty);
  });

  it('treats a candidate with no `disabled` property at all as enabled', () => {
    // A focusable non-form node reads `disabled === undefined`, which must not be
    // mistaken for disabled. A forward contract rather than a shipped rung: neither
    // migrated caller passes one today (mailbox paints a `tabIndex = 0` item-name chip,
    // but it is never entered into the controls map and so is never a candidate), and the
    // optional property is what lets a caller pass one at all.
    const root = document.createElement('div');
    const chip = document.createElement('span');
    chip.tabIndex = 0;
    root.appendChild(chip);
    document.body.appendChild(root);
    expect((chip as unknown as { disabled?: boolean }).disabled).toBeUndefined();
    restoreFirstEnabled([chip]);
    expect(document.activeElement).toBe(chip);
  });

  it('focuses NOBODY when every candidate is absent or disabled', () => {
    // The real disabled button is the WEAK half here: jsdom refuses to focus a disabled
    // control on its own, so that arm would hold even with the skip deleted. The fake
    // candidate is what gives this case teeth on the disabled dimension, by proving
    // focus() was never CALLED rather than merely that it had no effect.
    const disabled = windowWithKeyedButton('inc').btn;
    disabled.disabled = true;
    const fake = fakeCandidate(true);
    restoreFirstEnabled([null, disabled, undefined, fake]);
    expect(fake.calls).toBe(0);
    expect(document.activeElement).toBe(document.body);
  });

  it('accepts an empty candidate list without throwing', () => {
    // Titled for what it can actually catch. `document.activeElement === document.body`
    // is already true before the call, so this case cannot see the walk or the skip; a
    // caller whose ladder resolved to nothing (every rung absent) reaching here must not
    // be an error, and that is the whole claim.
    expect(() => restoreFirstEnabled([])).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });

  it('stops at the first enabled candidate and never touches a later one', () => {
    // Order is the caller's degradation ladder, so "first" has to mean first and the
    // walk has to stop: focusing every candidate would leave the player on the LAST
    // rung (Close) instead of the one their key resolved to.
    const first = fakeCandidate();
    const second = fakeCandidate();
    restoreFirstEnabled([first, second]);
    expect(first.calls).toBe(1);
    expect(second.calls).toBe(0);
  });

  it('walks the ladder in the given order, skipping only the disabled rungs', () => {
    const rungs = [fakeCandidate(true), fakeCandidate(true), fakeCandidate(), fakeCandidate()];
    restoreFirstEnabled(rungs);
    expect(rungs.map((r) => r.calls)).toEqual([0, 0, 1, 0]);
  });

  it('calls focus() BARE, never with FocusOptions', () => {
    // See also the module-contract scans below, which pin the same policy from the source
    // side. This one is the behavioral half.
    // The seam's scroll policy, which the module states as a contract: a caller restores
    // its scroll offset and then relies on focus() scrolling a degraded target into view,
    // so passing { preventScroll: true } here would silently break focus visibility for
    // every caller at once. A call COUNT cannot see it, hence the recorded arguments.
    const only = fakeCandidate();
    restoreFirstEnabled([only]);
    expect(only.args).toEqual([[]]);
  });
});

// ---------------------------------------------------------------------------
// Module contract, from the source side.
//
// Two of this module's promises cannot be reached behaviorally, and both would fail
// SILENTLY, which is what earns them a scan:
//
//  1. NO FORCED-REFLOW READ. focus_restore.ts is a shared helper on the rebuild path of
//     two cold painters, and tests/hud_perf_budget.test.ts scans for layout reads PER
//     FILE, with exact-count grants per painter. A getClientRects() added HERE (the
//     tempting one: it is FocusManager.canFocus's own visibility predicate) is charged to
//     nobody, and both painters' grants stay green. The gate's own comment says as much:
//     "a read moved into a NEW un-named helper is still out of reach."
//  2. NO DEFERRAL. The focus is synchronous, unlike FocusManager.restore's setTimeout(0),
//     and town_focus_window's documented scroll-then-focus ordering depends on it.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(__dirname, '..');
const moduleSrc = readFileSync(path.join(repoRoot, 'src/ui/focus_restore.ts'), 'utf8');

/** Comment-stripped, so the header's own prose about these tokens cannot satisfy a scan. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const moduleCode = stripComments(moduleSrc);

/**
 * The forced-reflow token names read OUT of the painter gate rather than copied, so the
 * two lists cannot drift: a token added there is covered here the same day.
 */
function forcedReflowTokens(): string[] {
  const gate = readFileSync(path.join(repoRoot, 'tests/hud_perf_budget.test.ts'), 'utf8');
  const start = gate.indexOf('const FORCED_REFLOW_READS');
  expect(start, 'FORCED_REFLOW_READS is no longer declared in the painter gate').toBeGreaterThan(
    -1,
  );
  const end = gate.indexOf('\n];', start);
  expect(
    end,
    'the FORCED_REFLOW_READS array is unterminated, so the slice is unbounded',
  ).toBeGreaterThan(start);
  return [...gate.slice(start, end).matchAll(/\[\s*'([^']+)'\s*,/g)].map((m) => m[1]);
}

describe('focus_restore module contract (source scans)', () => {
  it('reads the painter gate real token list (anti-vacuity)', () => {
    const tokens = forcedReflowTokens();
    // Without this the scan below could pass over an empty list forever. Named literals,
    // not a count: these two are the exact tokens the migrated painters hold grants for,
    // plus the one this module is most likely to reach for.
    expect(tokens.length).toBeGreaterThan(10);
    expect(tokens).toContain('.scrollTop');
    expect(tokens).toContain('.getBoundingClientRect');
    expect(tokens).toContain('.getClientRects');
  });

  it('makes no forced-reflow layout read', () => {
    const found = forcedReflowTokens().filter((token) =>
      moduleCode.includes(token.startsWith('.') ? token : `${token}(`),
    );
    expect(
      found,
      `focus_restore.ts must make no forced-reflow read: the painter gate scans PER FILE, so a read here is charged to no painter and both migrated painters' exact-count grants stay green:\n${found.join('\n')}`,
    ).toEqual([]);
  });

  it('and that refusal really would catch one', () => {
    // The arm that would be dead if the matcher were wrong, driven over synthetic source.
    const planted = stripComments('function f(el) {\n  return el.getClientRects().length > 0;\n}');
    expect(forcedReflowTokens().filter((t) => planted.includes(t))).toEqual(['.getClientRects']);
  });

  it('focuses synchronously, with no deferral of its own', () => {
    for (const token of [
      'setTimeout',
      'setInterval',
      'queueMicrotask',
      'requestAnimationFrame',
      'requestIdleCallback',
      'Promise',
      'await',
    ]) {
      expect(moduleCode, `focus_restore.ts must not defer: found ${token}`).not.toContain(token);
    }
  });

  it('reaches the host ONLY for document.activeElement', () => {
    // UI_DOM_MODULES is a blanket exemption from the architecture host scan, so nothing
    // else stops this module from growing a second browser reach. Its whole claim to the
    // registration is one read, so pin that it stays one read.
    expect([...moduleCode.matchAll(/\bdocument\b/g)]).toHaveLength(1);
    expect(moduleCode).toContain('document.activeElement');
    for (const host of ['window.', 'navigator.', 'localStorage', 'globalThis', 'getComputedStyle'])
      expect(moduleCode, `unexpected host reach: ${host}`).not.toContain(host);
  });

  it('never passes FocusOptions to focus()', () => {
    expect(moduleCode).toContain('candidate.focus();');
    expect(moduleCode).not.toContain('preventScroll');
  });

  it('refuses a parked root by the SAME selector the pointer drop parks on (no drift)', () => {
    // pointer_blur.ts exports the park selector so its readers cannot desync from it;
    // a literal 'dialog' here would silently diverge the day the park widens.
    expect(moduleCode).toContain("import { POINTER_FOCUS_PARK_SELECTOR } from './pointer_blur';");
    expect(moduleCode).toContain('active.matches(POINTER_FOCUS_PARK_SELECTOR)');
  });
});

describe('bare containment reads of the active element stay out of repaint ladders', () => {
  // The durability half of the parked-root rule: a repaint ladder that hand-rolls
  // `root.contains(active)` reads a parked dialog root as a focused control and falls
  // through to Close. The reads that remain are listed with the reason each is not a
  // ladder; a new one must route through focusedWithin or be added here with its reason.
  const KNOWN_BARE_CONTAINMENT_READS: Record<string, string> = {
    'armory_inspect.ts': 'overlay Tab-trap boundary check, not a restore ladder',
    'claudium_window.ts': 'dataset-keyed read on a sub-root; a parked root resolves nothing',
    'desktop_update_toast.ts': 'do-not-steal-focus check, never focuses anything',
    'dialog_key_activation.ts': 'keyboard activation guard, requires a button',
    'focus_manager.ts': 'the Tab trap itself (armed while focus is inside the root)',
    'focus_restore.ts': 'the helper',
    'hud/vendor/buy_quantity_prompt_window.ts': 'do-not-steal-focus check, never focuses anything',
    'spellbook_window.ts':
      'dataset/class-keyed read with no Close rung; a parked root resolves nothing',
  };
  const uiFiles = tsFilesUnder(path.join(repoRoot, 'src/ui')).map((f) => ({
    ...f,
    code: stripComments(readFileSync(f.full, 'utf8')),
  }));
  const readers = uiFiles
    .filter((f) => /\.contains\((?:active|document\.activeElement)\)/.test(f.code))
    .map((f) => f.file)
    .sort();

  it('finds the known readers (anti-vacuity)', () => {
    expect(readers).toContain('focus_manager.ts');
    expect(readers).toContain('spellbook_window.ts');
  });

  it('every bare read is a listed non-ladder, and every listed one still exists', () => {
    expect(readers).toEqual(Object.keys(KNOWN_BARE_CONTAINMENT_READS).sort());
  });
});

describe('the data-focus-key namespace has exactly one reader', () => {
  // The durability half of the extraction, and the answer to "what stops copy #11": any
  // src/ui module that reads the shared focus-key attribute has to come through this
  // helper, so it cannot hand-roll the containment check that keeps two windows with the
  // same key from stealing focus from each other.
  const uiFiles = tsFilesUnder(path.join(repoRoot, 'src/ui')).map((f) => ({
    ...f,
    code: stripComments(readFileSync(f.full, 'utf8')),
  }));

  it('sweeps a real, non-empty slice of src/ui (anti-vacuity)', () => {
    expect(uiFiles.length).toBeGreaterThan(200);
    expect(uiFiles.map((f) => f.file)).toContain('focus_restore.ts');
    expect(uiFiles.map((f) => f.file)).toContain('hud/vendor/vendor_window.ts');
  });

  it('finds the readers it is supposed to find (anti-vacuity)', () => {
    const readers = uiFiles.filter((f) => /dataset\.focusKey|data-focus-key/.test(f.code));
    // Named literals rather than a count, so migrating a third window is not a test edit.
    expect(readers.map((f) => f.file)).toContain('mailbox_window.ts');
    expect(readers.map((f) => f.file)).toContain('town_focus_window.ts');
  });

  it('every module that touches the attribute goes through the helper', () => {
    const offenders = uiFiles
      .filter((f) => f.file !== 'focus_restore.ts')
      .filter((f) => /dataset\.focusKey|data-focus-key/.test(f.code))
      .filter((f) => !/from '\.{1,2}(?:\/\.\.)*\/?focus_restore'/.test(f.code))
      .map((f) => f.file);
    expect(
      offenders,
      `these src/ui modules use the shared data-focus-key namespace without importing ./focus_restore, so they hand-roll the containment check that keeps one window's repaint from stealing focus from another (#2528):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
