import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ClaudiumSnapshot,
  ClaudiumWindow,
  type ClaudiumWindowDeps,
} from '../src/ui/claudium_window';

// ClaudiumWindow is DOM-touching HUD wiring, so this suite stays in the default
// Node environment and models only the small element surface the window uses.
// Setting the root shell HTML creates stable fake nodes for the body, close
// button, refresh indicator, and assistive live status. Body HTML remains opaque:
// these tests care whether an established pack view is replaced, not its parser.

class FakeClassList {
  private readonly names = new Set<string>();

  add(...names: string[]): void {
    for (const name of names) this.names.add(name);
  }

  toggle(name: string, force?: boolean): boolean {
    const enabled = force ?? !this.names.has(name);
    if (enabled) this.names.add(name);
    else this.names.delete(name);
    return enabled;
  }

  contains(name: string): boolean {
    return this.names.has(name);
  }
}

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly classList = new FakeClassList();
  readonly dataset: Record<string, string> = {};
  readonly style = { display: '' };
  textContent = '';
  disabled = false;
  htmlWrites = 0;
  private html = '';
  private readonly listeners = new Map<string, Array<() => void>>();
  private readonly children = new Map<string, FakeElement>();

  set innerHTML(value: string) {
    this.html = value;
    this.htmlWrites += 1;
  }

  get innerHTML(): string {
    return this.html;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click(): void {
    if (this.disabled) return;
    for (const listener of this.listeners.get('click') ?? []) listener();
  }

  focus(): void {
    fakeDocument.activeElement = this;
  }

  contains(element: unknown): boolean {
    return element === this;
  }

  querySelector(selector: string): FakeElement | null {
    return this.children.get(selector) ?? null;
  }

  querySelectorAll(_selector: string): FakeElement[] {
    return [];
  }

  setChild(selector: string, child: FakeElement): void {
    this.children.set(selector, child);
  }
}

class FakeBody extends FakeElement {
  private rails: FakeElement[] = [];
  private skus: FakeElement[] = [];

  override set innerHTML(value: string) {
    super.innerHTML = value;
    this.rails = [];
    this.skus = [];
    const buttons = value.matchAll(
      /<button\b([^>]*)data-(rail|sku)="([^"]+)"([^>]*)>([\s\S]*?)<\/button>/g,
    );
    for (const match of buttons) {
      const [, before, kind, value, after, content] = match;
      const attributes = `${before}data-${kind}="${value}"${after}`;
      const button = new FakeElement();
      button.dataset[kind] = value;
      button.disabled = /(?:^|\s)disabled(?:\s|$)/.test(attributes);
      const pressed = attributes.match(/aria-pressed="([^"]+)"/)?.[1];
      if (pressed) button.setAttribute('aria-pressed', pressed);
      const classNames = attributes.match(/class="([^"]+)"/)?.[1].split(/\s+/) ?? [];
      button.classList.add(...classNames);
      if (kind === 'sku') {
        const buy = new FakeElement();
        buy.innerHTML = content.match(/<span class="cl-sku-buy">([\s\S]*)<\/span>/)?.[1] ?? '';
        button.setChild('.cl-sku-buy', buy);
        this.skus.push(button);
      } else {
        this.rails.push(button);
      }
    }
  }

  override get innerHTML(): string {
    return super.innerHTML;
  }

  override contains(element: unknown): boolean {
    return (
      element === this ||
      this.rails.includes(element as FakeElement) ||
      this.skus.includes(element as FakeElement)
    );
  }

  override querySelector(selector: string): FakeElement | null {
    if (selector === '[data-rail][aria-pressed="true"]:not(:disabled)') {
      return (
        this.rails.find(
          (button) => button.getAttribute('aria-pressed') === 'true' && !button.disabled,
        ) ?? null
      );
    }
    return super.querySelector(selector);
  }

  override querySelectorAll(selector: string): FakeElement[] {
    if (selector === '[data-rail]') return this.rails;
    if (selector === '[data-sku]') return this.skus;
    if (selector === '[data-rail], [data-sku]') return [...this.rails, ...this.skus];
    return [];
  }

  rail(value = 'stripe'): FakeElement {
    const rail = this.rails.find((button) => button.dataset.rail === value);
    if (!rail) throw new Error(`missing fake rail: ${value}`);
    return rail;
  }

  sku(value = 'claudium_500'): FakeElement {
    const sku = this.skus.find((button) => button.dataset.sku === value);
    if (!sku) throw new Error(`missing fake sku: ${value}`);
    return sku;
  }
}

class FakeRoot extends FakeElement {
  readonly body = new FakeBody();
  readonly closeButton = new FakeElement();
  readonly refreshStatus = new FakeElement();
  readonly liveStatus = new FakeElement();

  override set innerHTML(value: string) {
    super.innerHTML = value;
  }

  override get innerHTML(): string {
    return super.innerHTML;
  }

  override contains(element: unknown): boolean {
    return (
      element === this ||
      element === this.body ||
      element === this.closeButton ||
      element === this.refreshStatus ||
      element === this.liveStatus ||
      this.body.contains(element)
    );
  }

  override querySelector(selector: string): FakeElement | null {
    if (selector === '.cl-body') return this.innerHTML ? this.body : null;
    if (selector === '[data-close]') return this.innerHTML ? this.closeButton : null;
    if (selector === '[data-refresh-status]') return this.innerHTML ? this.refreshStatus : null;
    if (selector === '[data-cl-live-status]') return this.innerHTML ? this.liveStatus : null;
    return null;
  }

  override querySelectorAll(selector: string): FakeElement[] {
    return this.body.querySelectorAll(selector);
  }
}

const fakeDocument = { activeElement: null as FakeElement | null };

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function snapshot(balance: number): ClaudiumSnapshot {
  return {
    balance,
    skus: [{ sku: 'claudium_500', usd: 4.99, claudium: 500 }],
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

const asHtml = (element: FakeElement): HTMLElement => element as unknown as HTMLElement;

afterEach(() => {
  fakeDocument.activeElement = null;
  vi.unstubAllGlobals();
});

describe('ClaudiumWindow refresh stability', () => {
  it('does not rebuild pack nodes for an unchanged successful refresh', async () => {
    vi.stubGlobal('document', fakeDocument);
    const root = new FakeRoot();
    root.style.display = 'block';
    const reads = [Promise.resolve(snapshot(500)), Promise.resolve(snapshot(500))];
    const deps: ClaudiumWindowDeps = {
      root: () => asHtml(root),
      closeOthers: () => {},
      captureFocus: () => null,
      restoreFocus: () => {},
      snapshot: () => reads.shift() ?? Promise.reject(new Error('unexpected snapshot read')),
      buy: () => Promise.resolve(),
    };
    const window = new ClaudiumWindow(deps);

    await window.render();
    const settledWrites = root.body.htmlWrites;
    const settledSku = root.body.sku();

    await window.render();

    expect(root.body.htmlWrites).toBe(settledWrites);
    expect(root.body.sku()).toBe(settledSku);
    expect(root.body.sku().disabled).toBe(false);
  });

  it('keeps the last good pack view mounted across a pending and unavailable refresh', async () => {
    vi.stubGlobal('document', fakeDocument);
    const root = new FakeRoot();
    root.style.display = 'block';
    const first = deferred<ClaudiumSnapshot>();
    const unavailableRefresh = deferred<ClaudiumSnapshot>();
    const recovered = deferred<ClaudiumSnapshot>();
    const reads = [first.promise, unavailableRefresh.promise, recovered.promise];
    const deps: ClaudiumWindowDeps = {
      root: () => asHtml(root),
      closeOthers: () => {},
      captureFocus: () => null,
      restoreFocus: () => {},
      snapshot: () => reads.shift() ?? Promise.reject(new Error('unexpected snapshot read')),
      buy: () => Promise.resolve(),
    };
    const window = new ClaudiumWindow(deps);

    const initialRender = window.render();
    expect(root.body.innerHTML).toContain('cl-loading');
    first.resolve(snapshot(500));
    await initialRender;

    const settledHtml = root.body.innerHTML;
    const settledWrites = root.body.htmlWrites;
    expect(settledHtml).toContain('data-sku="claudium_500"');

    const refresh = window.render();
    expect(root.body.innerHTML).toBe(settledHtml);
    expect(root.body.htmlWrites).toBe(settledWrites);
    expect(root.body.getAttribute('aria-busy')).toBe('true');
    expect(root.refreshStatus.classList.contains('active')).toBe(true);

    unavailableRefresh.resolve({
      available: false,
      balance: null,
      skus: [],
      nativeRails: { sol: false, woc: false },
    });
    await refresh;
    expect(root.body.innerHTML).toBe(settledHtml);
    expect(root.body.htmlWrites).toBe(settledWrites);
    expect(root.body.getAttribute('aria-busy')).toBe('false');
    expect(root.refreshStatus.classList.contains('failed')).toBe(true);
    expect(root.liveStatus.textContent.length).toBeGreaterThan(0);

    const retry = window.render();
    expect(root.body.innerHTML).toBe(settledHtml);
    recovered.resolve(snapshot(750));
    await retry;
    expect(root.body.htmlWrites).toBe(settledWrites + 1);
    expect(root.body.innerHTML).not.toBe(settledHtml);
    expect(root.refreshStatus.classList.contains('failed')).toBe(false);
  });

  it('keeps controls stable through refresh failure and an inline pending purchase', async () => {
    vi.stubGlobal('document', fakeDocument);
    const root = new FakeRoot();
    root.style.display = 'block';
    const unavailableRefresh = deferred<ClaudiumSnapshot>();
    const purchase = deferred<void>();
    const authoritativeRefresh = deferred<ClaudiumSnapshot>();
    let snapshotCalls = 0;
    const reads: Array<Promise<ClaudiumSnapshot>> = [
      Promise.resolve(snapshot(500)),
      unavailableRefresh.promise,
      Promise.resolve(snapshot(750)),
      authoritativeRefresh.promise,
      Promise.resolve(snapshot(1_250)),
    ];
    const buys: Array<{ rail: string; sku: string }> = [];
    const deps: ClaudiumWindowDeps = {
      root: () => asHtml(root),
      closeOthers: () => {},
      captureFocus: () => null,
      restoreFocus: () => {},
      snapshot: () => {
        snapshotCalls += 1;
        return reads.shift() ?? Promise.reject(new Error('unexpected snapshot read'));
      },
      buy: (rail, sku) => {
        buys.push({ rail, sku });
        return purchase.promise;
      },
    };
    const window = new ClaudiumWindow(deps);

    await window.render();
    const settledRail = root.body.rail();
    const settledSku = root.body.sku();
    expect(settledRail.disabled).toBe(false);
    expect(settledSku.disabled).toBe(false);

    const failingRefresh = window.render();
    expect(root.body.rail()).toBe(settledRail);
    expect(root.body.sku()).toBe(settledSku);
    expect(settledRail.disabled).toBe(false);
    expect(settledSku.disabled).toBe(true);

    unavailableRefresh.resolve({
      available: false,
      balance: null,
      skus: [],
      nativeRails: { sol: false, woc: false },
    });
    await failingRefresh;
    await flushMicrotasks();
    expect(root.body.rail()).toBe(settledRail);
    expect(root.body.sku()).toBe(settledSku);
    expect(settledRail.disabled).toBe(false);
    expect(settledSku.disabled).toBe(true);
    expect(root.liveStatus.textContent.length).toBeGreaterThan(0);

    await window.render();
    const recoveredRail = root.body.rail();
    const recoveredSku = root.body.sku();
    const idleBuyHtml = recoveredSku.querySelector('.cl-sku-buy')?.innerHTML;
    expect(recoveredRail.disabled).toBe(false);
    expect(recoveredSku.disabled).toBe(false);
    recoveredSku.focus();

    recoveredSku.click();
    await flushMicrotasks();
    const pendingBuyHtml = recoveredSku.querySelector('.cl-sku-buy')?.innerHTML;
    expect(buys).toEqual([{ rail: 'stripe', sku: 'claudium_500' }]);
    expect(recoveredRail.disabled).toBe(true);
    expect(recoveredSku.disabled).toBe(true);
    expect(recoveredSku.classList.contains('pending')).toBe(true);
    expect(pendingBuyHtml).not.toBe(idleBuyHtml);
    expect(pendingBuyHtml).toContain('cl-sku-buy-spinner');
    expect(root.liveStatus.textContent.length).toBeGreaterThan(0);

    purchase.resolve();
    await flushMicrotasks();
    expect(snapshotCalls).toBe(4);
    authoritativeRefresh.resolve({
      available: false,
      balance: null,
      skus: [],
      nativeRails: { sol: false, woc: false },
    });
    await flushMicrotasks();

    const finalRail = root.body.rail();
    const finalSku = root.body.sku();
    expect(finalRail).not.toBe(recoveredRail);
    expect(finalSku).not.toBe(recoveredSku);
    expect(finalRail.disabled).toBe(false);
    expect(finalSku.disabled).toBe(true);
    expect(finalSku.classList.contains('pending')).toBe(false);
    expect(finalSku.querySelector('.cl-sku-buy')?.innerHTML).toBe(idleBuyHtml);
    expect(fakeDocument.activeElement).toBe(finalRail);
    expect(root.liveStatus.textContent.length).toBeGreaterThan(0);

    await window.render();
    expect(snapshotCalls).toBe(5);
    expect(root.body.rail().disabled).toBe(false);
    expect(root.body.sku().disabled).toBe(false);
    expect(fakeDocument.activeElement).toBe(root.body.rail());
    expect(root.liveStatus.textContent).toBe('');
  });
});
