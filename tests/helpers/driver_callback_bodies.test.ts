import { describe, expect, it } from 'vitest';
import { readDriverCallbacks } from './driver_callback_bodies';

// The paired test for the driver-callback resolver. Synthetic sources ONLY, on purpose: the
// consumer (tests/hud_perf_budget.test.ts) resolves its own input from src/ui, and a producer
// that reads its own input can only ever be proven against the tree it already passes on
// (#2497, #2499, #2502). Every shape below is one the walk has to get right for the gate on
// top of it to mean anything.

const DRIVERS = ['requestAnimationFrame', 'requestIdleCallback', 'setInterval'];

const read = (source: string, stopAt: string[] = []) =>
  readDriverCallbacks('probe.ts', source, DRIVERS, stopAt);

describe('readDriverCallbacks: which call sites it finds', () => {
  it('finds the bare and the member form of every driver, and no teardown', () => {
    const found = read(`
      setInterval(() => {}, 100);
      window.setInterval(() => {}, 200);
      requestAnimationFrame(() => {});
      window.requestAnimationFrame(() => {});
      requestIdleCallback(() => {});
      window.requestIdleCallback(() => {});
      clearInterval(handle);
      cancelAnimationFrame(handle);
      cancelIdleCallback(handle);
      setTimeout(() => {}, 100);
    `);
    expect(found.map((f) => f.driver)).toEqual([
      'setInterval',
      'setInterval',
      'requestAnimationFrame',
      'requestAnimationFrame',
      'requestIdleCallback',
      'requestIdleCallback',
    ]);
  });

  it('reads the cadence literal, underscores included, and null where there is none', () => {
    const found = read(`
      setInterval(() => {}, 100);
      setInterval(() => {}, 15_000);
      setInterval(() => {}, delayFromConfig);
      requestAnimationFrame(() => {});
    `);
    expect(found.map((f) => f.delayMs)).toEqual([100, 15000, null, null]);
  });

  // A cadence hoisted into a constant still resolves, which is what keeps the pin from being
  // escapable by a one-line refactor. src/ui/reconnect_overlay.ts already writes this shape.
  it('resolves a cadence hoisted into a module-level const', () => {
    const found = read(`
      const TICK_MS = 250;
      const SLOW_MS = 30_000;
      setInterval(render, TICK_MS);
      setInterval(render, SLOW_MS);
      function render(): void {}
    `);
    expect(found.map((f) => f.delayMs)).toEqual([250, 30000]);
  });

  it('reports the line of the driver call, so a failure can be found', () => {
    const found = read('const a = 1;\n\nsetInterval(() => {}, 10);');
    expect(found[0]?.line).toBe(3);
  });

  it('finds a driver armed anywhere in the file, not only at top level', () => {
    const found = read(`
      export class W {
        private arm(): void {
          if (this.live) {
            this.iv = window.setInterval(() => this.tick(), 50);
          }
        }
        private tick(): void { this.el.textContent = 'x'; }
      }
    `);
    expect(found).toHaveLength(1);
    expect(found[0]?.delayMs).toBe(50);
    expect(found[0]?.reached).toEqual(['tick']);
  });
});

describe('readDriverCallbacks: what one tick reaches', () => {
  // THE CASE THE WHOLE THING EXISTS FOR. A body-only scan of lockpick_window's clock saw a
  // guard, a subtraction and two method calls, and every write and every re-query the issue
  // is about sat one call away in paintTimer.
  it('follows a call out of the callback body into a same-module method', () => {
    const found = read(`
      export class W {
        private arm(): void {
          this.iv = window.setInterval(() => {
            if (gen !== this.gen) return;
            this.paintTimer(remaining);
          }, 100);
        }
        private paintTimer(remaining: number): void {
          const bar = this.panel.querySelector('.bar');
          if (bar) bar.style.width = '50%';
        }
        private unrelated(): void { this.el.innerHTML = 'never reached'; }
      }
    `);
    expect(found[0]?.reached).toEqual(['paintTimer']);
    expect(found[0]?.code).toContain('querySelector');
    expect(found[0]?.code).not.toContain('never reached');
  });

  it('follows transitively, and survives a cycle', () => {
    const found = read(`
      export class W {
        private arm(): void { setInterval(() => this.a(), 10); }
        private a(): void { this.b(); }
        private b(): void { this.a(); this.c(); }
        private c(): void { this.el.textContent = 'deep'; }
      }
    `);
    expect(found[0]?.reached).toEqual(['a', 'b', 'c']);
    expect(found[0]?.code).toContain('deep');
  });

  it('follows a getter, because `if (this.isOpen)` runs a body', () => {
    const found = read(`
      export class W {
        private arm(): void { setInterval(() => { if (this.isOpen) this.noop(); }, 10); }
        get isOpen(): boolean { return this.root().style.display === 'block'; }
        private noop(): void {}
      }
    `);
    expect(found[0]?.reached).toEqual(['isOpen', 'noop']);
    expect(found[0]?.code).toContain('style.display');
  });

  // The over-approximating half of the rule, and the reason it is that way: excluding nested
  // function bodies would put every write one `forEach` away from the scan.
  it('follows a callee named inside a nested callback', () => {
    const found = read(`
      export class W {
        private arm(): void { setInterval(() => { this.paint(); }, 10); }
        private paint(): void { this.rows.forEach(() => this.write()); }
        private write(): void { this.el.textContent = 'inside a nested arrow'; }
      }
    `);
    expect(found[0]?.reached).toEqual(['paint', 'write']);
    expect(found[0]?.code).toContain('inside a nested arrow');
  });

  it('follows a call in an argument position and a module-level function', () => {
    const found = read(`
      function label(n: number): string { return String(n); }
      const paint = (el: HTMLElement, s: string): void => { el.textContent = s; };
      setInterval(() => { paint(node, label(1)); }, 10);
    `);
    expect(found[0]?.reached).toEqual(['label', 'paint']);
    expect(found[0]?.code).toContain('el.textContent = s;');
  });

  it('pulls in EVERY body when a name is ambiguous, rather than guessing one', () => {
    const found = read(`
      export class A { paint(): void { this.el.textContent = 'from A'; } }
      export class B { paint(): void { this.el.innerHTML = 'from B'; } }
      setInterval(() => { thing.paint(); }, 10);
    `);
    // A bare `thing.paint()` is not a `this` call, so it is not followed at all...
    expect(found[0]?.reached).toEqual([]);
    const both = read(`
      export class A { paint(): void { this.el.textContent = 'from A'; } }
      export class B { paint(): void { this.el.innerHTML = 'from B'; } }
      export class C { arm(): void { setInterval(() => this.paint(), 10); } }
    `);
    // ...but a `this.paint()` whose name matches two declarations scans both, since
    // picking one would silently scan the wrong body.
    expect(both[0]?.reached).toEqual(['paint']);
    expect(both[0]?.code).toContain('from A');
    expect(both[0]?.code).toContain('from B');
  });

  // THE SAME-MODULE ESCAPES, each of which resolved to nothing before they were closed. All
  // three are one keystroke away from the shape the walk already followed, which is exactly the
  // kind of gap a gate ships with and never notices: a NEW driver written this way would pass
  // with an empty allowance and a wholly unscanned tick.
  it('follows a call through a local bound to `this`', () => {
    const found = read(`
      export class W {
        private arm(): void {
          const self = this;
          setInterval(() => { self.paintTimer(); }, 100);
        }
        private paintTimer(): void { this.el.style.width = '1px'; }
      }
    `);
    expect(found[0]?.reached).toEqual(['paintTimer']);
    expect(found[0]?.code).toContain("style.width = '1px'");
  });

  it('follows a COMPUTED call on `this`, the escape every write family already closes', () => {
    const found = read(`
      export class W {
        private arm(): void { setInterval(() => { this['paintTimer'](); }, 100); }
        private paintTimer(): void { this.el.textContent = 'computed callee'; }
      }
    `);
    expect(found[0]?.reached).toEqual(['paintTimer']);
    expect(found[0]?.code).toContain('computed callee');
  });

  it('follows an object-literal method', () => {
    const found = read(`
      const ui = {
        paint(): void { node.textContent = 'from an object literal'; },
        fmt: () => 'x',
      };
      setInterval(() => { ui.paint(); }, 100);
    `);
    expect(found[0]?.reached).toEqual(['paint']);
    expect(found[0]?.code).toContain('from an object literal');
  });

  it('does not leave this module: a call through an injected dep is out of reach', () => {
    const found = read(`
      export class W {
        private arm(): void { setInterval(() => { this.deps.repaint(); }, 10); }
      }
    `);
    expect(found[0]?.reached).toEqual([]);
  });

  // The limits the header states, pinned as the CURRENT behavior rather than left as prose a
  // reader has to trust. If a later change closes one of these, this test is where it is
  // noticed, and the header paragraph moves with it.
  it('records the stated limits: a dynamic key and a detached method reference', () => {
    expect(
      read(`
        export class W {
          private arm(): void { setInterval(() => { this[key](); }, 10); }
          private paint(): void { this.el.textContent = 'unreachable through a dynamic key'; }
        }
      `)[0]?.reached,
    ).toEqual([]);
    expect(
      read(`
        export class W {
          private arm(): void {
            const fn = this.deps.paint;
            setInterval(() => { fn(); }, 10);
          }
        }
      `)[0]?.reached,
    ).toEqual([]);
  });
});

describe('readDriverCallbacks: the declared cut', () => {
  it('stops at a named method and reports the cut, without cutting its siblings', () => {
    const source = `
      export class W {
        private arm(): void { setInterval(() => { this.render(); this.tick(); }, 10); }
        private render(): void { this.el.innerHTML = 'the whole window'; }
        private tick(): void { this.el.textContent = 'the tick'; }
      }
    `;
    const cut = read(source, ['render']);
    expect(cut[0]?.reached).toEqual(['tick']);
    expect(cut[0]?.stopped).toEqual(['render']);
    expect(cut[0]?.code).not.toContain('the whole window');
    expect(cut[0]?.code).toContain('the tick');
    // Uncut, the same source reaches both, so the cut is doing the work and not the walk.
    expect(read(source)[0]?.reached).toEqual(['render', 'tick']);
  });

  it('reports no cut for a name the callback never reaches, so a dead cut is visible', () => {
    const found = read(
      'export class W { arm(): void { setInterval(() => this.tick(), 10); } tick(): void {} }',
      ['renderCurrent'],
    );
    expect(found[0]?.stopped).toEqual([]);
  });

  it('cuts a method reached deeper than the callback body', () => {
    const found = read(
      `export class W {
         arm(): void { setInterval(() => this.a(), 10); }
         a(): void { this.render(); }
         render(): void { this.el.innerHTML = 'deep render'; }
       }`,
      ['render'],
    );
    expect(found[0]?.reached).toEqual(['a']);
    expect(found[0]?.stopped).toEqual(['render']);
    expect(found[0]?.code).not.toContain('deep render');
  });
});

describe('readDriverCallbacks: it refuses rather than scanning nothing', () => {
  // The standing anti-vacuity rule for a source guard: a resolver that shrugged at a shape it
  // could not follow would hand the gate above an empty, passing scan.
  it('throws when the callback is an unresolvable expression', () => {
    expect(() => read('setInterval(makeTick(this), 100);')).toThrow(
      /does not resolve to a function in this module/,
    );
  });

  it('throws when the callback names a function that is not in this module', () => {
    expect(() => read("import { tick } from './tick';\nsetInterval(tick, 100);")).toThrow(
      /does not resolve to a function in this module/,
    );
  });

  it('throws when the driver is armed with no callback at all', () => {
    expect(() => read('setInterval();')).toThrow(/armed with no callback argument/);
  });

  it('scans EVERY body when the callback reference itself is ambiguous', () => {
    const found = read(`
      export class A { tick(): void { this.el.textContent = 'from A'; } }
      export class B { tick(): void { this.el.innerHTML = 'from B'; } }
      export class C { arm(): void { setInterval(this.tick, 10); } }
    `);
    // Both, for the same reason an ambiguous CALLEE pulls in both: picking one would silently
    // scan the wrong tick, and over-scanning is the safe direction for a budget.
    expect(found[0]?.code).toContain('from A');
    expect(found[0]?.code).toContain('from B');
  });

  it('resolves a reference to a same-module function, and does not re-add it as its own callee', () => {
    const found = read(`
      export class W {
        private arm(): void { setInterval(this.tick, 100); }
        private tick(): void { this.tick(); this.paint(); }
        private paint(): void { this.el.textContent = 'x'; }
      }
    `);
    expect(found[0]?.reached).toEqual(['paint']);
    expect(found[0]?.code).toContain("this.el.textContent = 'x';");
  });

  it('resolves a bound reference and a module-level arrow', () => {
    expect(
      read(`
        export class W {
          private arm(): void { setInterval(this.tick.bind(this), 100); }
          private tick(): void { this.paint(); }
          private paint(): void {}
        }
      `)[0]?.reached,
    ).toEqual(['paint']);
    expect(
      read('const tick = () => { node.textContent = "x"; };\nsetInterval(tick, 100);')[0]?.code,
    ).toContain('node.textContent');
  });

  it('scans an expression-bodied arrow, not just a block', () => {
    const found = read('setInterval(() => node.classList.toggle("on", x), 100);');
    expect(found[0]?.code).toContain('classList.toggle');
  });
});
