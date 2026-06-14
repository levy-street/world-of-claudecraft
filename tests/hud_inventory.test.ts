import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { Hud } from '../src/ui/hud';

type Listener = () => void;

class FakeElement {
  id = '';
  className = '';
  style: Record<string, string> = {};
  parent: FakeElement | null = null;
  children: FakeElement[] = [];
  private html = '';
  private text = '';
  private listeners = new Map<string, Listener[]>();

  set innerHTML(value: string) {
    this.html = value;
    this.text = stripTags(value);
    this.children = [];
    if (value.includes('id="equip-col"')) {
      const equipCol = new FakeElement();
      equipCol.id = 'equip-col';
      this.appendChild(equipCol);
    }
  }

  get innerHTML(): string {
    return this.html;
  }

  set textContent(value: string | null) {
    this.text = value ?? '';
    this.html = this.text;
    this.children = [];
  }

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('');
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) this.appendChild(node);
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const matches: FakeElement[] = [];
    const visit = (el: FakeElement) => {
      if (matchesSelector(el, selector)) matches.push(el);
      for (const child of el.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return matches;
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click(): void {
    for (const listener of this.listeners.get('click') ?? []) listener();
  }
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function matchesSelector(el: FakeElement, selector: string): boolean {
  if (selector.startsWith('#')) return el.id === selector.slice(1);
  if (selector.startsWith('.')) return el.className.split(/\s+/).includes(selector.slice(1));
  if (selector === '[data-close]') return el.innerHTML.includes('data-close');
  return false;
}

function installDocument(elements: Map<string, FakeElement>): void {
  (globalThis as any).document = {
    body: { classList: { contains: () => false } },
    createElement: () => new FakeElement(),
    querySelector: (selector: string) => {
      if (selector.startsWith('#')) return elements.get(selector.slice(1)) ?? null;
      for (const el of elements.values()) {
        const match = el.querySelector(selector);
        if (match) return match;
      }
      return null;
    },
  };
}

function panelText(id: string): string {
  return ((document.querySelector(`#${id}`) as unknown as FakeElement).textContent ?? '').replace(/\s+/g, ' ');
}

describe('HUD inventory panels', () => {
  const previousDocument = (globalThis as any).document;

  beforeEach(() => {
    const elements = new Map<string, FakeElement>();
    for (const id of ['bags', 'char-window']) {
      const el = new FakeElement();
      el.id = id;
      el.style.display = 'block';
      elements.set(id, el);
    }
    installDocument(elements);
  });

  afterEach(() => {
    (globalThis as any).document = previousDocument;
  });

  it('refreshes the open character window after equipping an item from bags', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', playerName: 'Tester' });
    sim.addItem('redbrook_blade', 1);
    // Keep every paperdoll slot occupied so this unit test does not need the
    // canvas-backed empty-slot icon renderer.
    sim.equipment.legs = 'quilted_trousers';
    sim.equipment.feet = 'oiled_boots';

    const hud = Object.create(Hud.prototype) as any;
    hud.sim = sim;
    (hud as any).openVendorNpcId = null;
    (hud as any).itemIcon = (item: { name: string }) => `<img alt="${item.name}">`;
    (hud as any).attachTooltip = () => {};

    hud.renderChar();
    hud.renderBags();

    expect(panelText('char-window')).toContain('Worn Shortsword');

    const bagItem = document.querySelector('#bags')!.querySelector('.bag-item') as unknown as FakeElement;
    bagItem.click();

    expect(sim.equipment.mainhand).toBe('redbrook_blade');
    expect(panelText('bags')).toContain('Worn Shortsword');
    expect(panelText('char-window')).toContain('Redbrook Militia Blade');
    expect(panelText('char-window')).not.toContain('Worn Shortsword');
  });
});
