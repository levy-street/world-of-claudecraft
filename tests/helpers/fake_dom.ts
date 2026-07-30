export class FakeStyle {
  display = '';
  color = '';
  left = '';
  top = '';
  right = '';
  bottom = '';
  width = '';
  height = '';
  transform = '';
  private readonly custom = new Map<string, string>();

  setProperty(property: string, value: string): void {
    this.custom.set(property, value);
  }

  getPropertyValue(property: string): string {
    return this.custom.get(property) ?? '';
  }

  removeProperty(property: string): string {
    const previous = this.custom.get(property) ?? '';
    this.custom.delete(property);
    if (property in this) (this as unknown as Record<string, string>)[property] = '';
    return previous;
  }
}

export class FakeClassList {
  private readonly values = new Set<string>();

  replaceFrom(className: string): void {
    this.values.clear();
    for (const value of className.split(/\s+/)) if (value) this.values.add(value);
  }

  add(...values: string[]): void {
    for (const value of values) this.values.add(value);
  }

  remove(...values: string[]): void {
    for (const value of values) this.values.delete(value);
  }

  contains(value: string): boolean {
    return this.values.has(value);
  }

  toggle(value: string, force?: boolean): boolean {
    const enabled = force ?? !this.values.has(value);
    if (enabled) this.values.add(value);
    else this.values.delete(value);
    return enabled;
  }

  toString(): string {
    return [...this.values].join(' ');
  }
}

export class FakeElement extends EventTarget {
  readonly style = new FakeStyle();
  readonly classList = new FakeClassList();
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  textContent: string | null = null;
  title = '';
  type = '';
  value = '';
  placeholder = '';
  tabIndex = 0;
  scrollTop = 0;
  scrollHeight = 0;
  scrollWidth = 0;
  clientWidth = 0;
  focused = false;
  private html = '';
  private classes = '';
  private rect = { left: 0, top: 0, width: 0, height: 0 };

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {
    super();
  }

  set className(value: string) {
    this.classes = value;
    this.classList.replaceFrom(value);
  }

  get className(): string {
    return this.classes;
  }

  set innerHTML(value: string) {
    this.html = value;
    for (const child of this.children) child.parentElement = null;
    this.children.length = 0;
  }

  get innerHTML(): string {
    return this.html;
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) this.appendChild(node);
  }

  appendChild<T extends FakeElement>(node: T): T {
    node.parentElement?.removeChild(node);
    node.parentElement = this;
    this.children.push(node);
    return node;
  }

  removeChild<T extends FakeElement>(node: T): T {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentElement = null;
    return node;
  }

  remove(): void {
    this.parentElement?.removeChild(this);
  }

  contains(node: unknown): boolean {
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }

  closest(selector: string): FakeElement | null {
    if (selector === 'button' && this.tagName === 'BUTTON') return this;
    return this.parentElement?.closest(selector) ?? null;
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

  querySelectorAll<T extends Element = Element>(selector: string): T[] {
    const className = selector.startsWith('.') ? selector.slice(1) : null;
    const matches: FakeElement[] = [];
    const visit = (element: FakeElement): void => {
      for (const child of element.children) {
        if (className && child.classList.contains(className)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches as unknown as T[];
  }

  querySelector<T extends Element = Element>(selector: string): T | null {
    return this.querySelectorAll<T>(selector)[0] ?? null;
  }

  setRect(rect: { left: number; top: number; width: number; height: number }): void {
    this.rect = { ...rect };
  }

  getBoundingClientRect(): DOMRect {
    const { left, top, width, height } = this.rect;
    return {
      x: left,
      y: top,
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      toJSON: () => ({}),
    } as DOMRect;
  }

  focus(): void {
    this.focused = true;
  }

  setPointerCapture(_pointerId: number): void {}
}

export class FakeDocument extends EventTarget {
  readonly documentElement = new FakeElement('HTML', this);
  readonly body = new FakeElement('BODY', this);
  private readonly byId = new Map<string, FakeElement>();

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName.toUpperCase(), this);
  }

  getElementById(id: string): FakeElement | null {
    return this.byId.get(id) ?? null;
  }

  element(id: string, tagName = 'div'): FakeElement {
    const element = this.createElement(tagName);
    this.byId.set(id, element);
    return element;
  }
}

export class FakeWindow extends EventTarget {
  constructor(
    public innerWidth: number,
    public innerHeight: number,
  ) {
    super();
  }
}

export function pointerEvent(
  type: string,
  init: {
    pointerId: number;
    clientX: number;
    clientY: number;
    button?: number;
  },
): Event {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries({ button: 0, ...init })) {
    Object.defineProperty(event, key, { configurable: true, value });
  }
  return event;
}
