// @vitest-environment happy-dom
// The party pings on the HUD (src/ui/hud/pings/): the Ping key and wheel
// controller (tap pings contextually, hold opens the wheel, the lit wedge is
// sent, the centre and Escape cancel), the feed (a new ping sounds and logs
// once, and sits on the minimap), the Enable Pings gate over both, the
// keyboard and pad routing through the targeting slice, and the Hud members
// the factory reads (welded to hud.ts here, the hud_world_markers pattern).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from '../src/game/settings';
import { dispatchTargetingAction, targetingInputCallbacks } from '../src/game/targeting_actions';
import {
  type PartyPing,
  PING_ASSIST,
  PING_ATTACK,
  PING_LOOK,
  PING_WARNING,
} from '../src/sim/social/party_pings';
import { PingFeedController } from '../src/ui/hud/pings/ping_feed_controller';
import { PingWheelController } from '../src/ui/hud/pings/ping_wheel_controller';
import {
  PING_TAP_MAX_MS,
  type PingContext,
  type PingSend,
} from '../src/ui/hud/pings/ping_wheel_core';
import { setLanguage } from '../src/ui/i18n';
import type { PainterHostWriters } from '../src/ui/painter_host';

setLanguage('en');

// happy-dom has no 2D canvas: the badge art is the icons module's own concern.
vi.mock('../src/ui/ping_icons', () => ({
  pingIconUrl: (kind: number) => `data:ping-${kind}`,
  pingIconCanvas: () => document.createElement('canvas'),
}));

const writers: PainterHostWriters = {
  setText: (el, v) => {
    el.textContent = v;
  },
  setDisplay: (el, v) => {
    el.style.display = v;
  },
  setTransform: (el, v) => {
    el.style.transform = v;
  },
  setWidth: (el, v) => {
    el.style.width = v;
  },
  setStyleProp: (el, p, v) => {
    el.style.setProperty(p, v);
  },
  toggleClass: (el, c, on) => {
    el.classList.toggle(c, on);
  },
  setAttr: (el, n, v) => {
    if (v === null) el.removeAttribute(n);
    else el.setAttribute(n, v);
  },
};

function wheelHarness(ctx: PingContext, enabled = true) {
  let now = 0;
  let pending: (() => void) | null = null;
  const sent: PingSend[] = [];
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const state = { enabled };
  const wheel = new PingWheelController({
    doc: document,
    writers,
    mount: () => mount,
    now: () => now,
    viewport: () => ({ width: 1920, height: 1080 }),
    enabled: () => state.enabled,
    pick: () => ctx,
    targetContext: () => ctx,
    send: (p) => sent.push(p),
    later: (fn) => {
      pending = fn;
      return () => {
        pending = null;
      };
    },
  });
  return {
    wheel,
    sent,
    mount,
    state,
    advance(ms: number) {
      now += ms;
      if (ms >= PING_TAP_MAX_MS && pending) {
        const fn = pending;
        pending = null;
        fn();
      }
    },
  };
}

const enemy: PingContext = { kind: 'unit', id: 9, hostile: true, x: 1, y: 2, z: 3 };
const ground: PingContext = { kind: 'ground', x: 10, y: 0, z: -4 };

function move(x: number, y: number) {
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }));
}

describe('ping wheel controller', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('a tap on an enemy sends Attack on it, and opens no wheel', () => {
    const h = wheelHarness(enemy);
    h.wheel.key('down', 500, 400);
    h.advance(80);
    h.wheel.key('up', 500, 400);
    expect(h.sent).toEqual([{ kind: PING_ATTACK, target: 9, x: 1, y: 2, z: 3 }]);
    expect(h.mount.querySelector('#ping-wheel')).toBeNull();
  });

  it('a tap on the ground sends Look Here at the point', () => {
    const h = wheelHarness(ground);
    h.wheel.key('down', 500, 400);
    h.wheel.key('up', 500, 400);
    expect(h.sent).toEqual([{ kind: PING_LOOK, target: null, x: 10, y: 0, z: -4 }]);
  });

  it('a hold opens the wheel at the cursor; the lit wedge is what the release sends', () => {
    const h = wheelHarness(enemy);
    h.wheel.key('down', 500, 400);
    h.advance(PING_TAP_MAX_MS);
    const root = h.mount.querySelector<HTMLElement>('#ping-wheel');
    expect(root).not.toBeNull();
    expect(h.wheel.isOpen()).toBe(true);
    expect(root?.style.display).toBe('block');
    expect(root?.classList.contains('is-open')).toBe(true);
    expect(root?.style.transform).toBe('translate(500px, 400px)');
    // Four wedges with their labels, plus the cancel centre.
    expect(root?.querySelectorAll('.ping-wheel-wedge')).toHaveLength(4);
    const labels = [...(root?.querySelectorAll('.ping-wheel-label') ?? [])].map(
      (l) => l.textContent,
    );
    expect(labels).toEqual(['Warning', 'Attack', 'On My Way', 'Assist']);
    move(500, 400 - 90); // up: Warning
    const lit = root?.querySelector('.ping-wheel-wedge.is-lit');
    expect(lit?.classList.contains(`ping-kind-${PING_WARNING}`)).toBe(true);
    move(500, 400 + 90); // down: Assist
    h.wheel.key('up', 500, 490);
    expect(h.sent).toEqual([{ kind: PING_ASSIST, target: 9, x: 1, y: 2, z: 3 }]);
    expect(root?.style.display).toBe('none');
    expect(h.wheel.isOpen()).toBe(false);
  });

  it('releasing over the centre cancels', () => {
    const h = wheelHarness(enemy);
    h.wheel.key('down', 500, 400);
    h.advance(PING_TAP_MAX_MS);
    move(505, 402);
    expect(h.mount.querySelector('#ping-wheel')?.classList.contains('is-center')).toBe(true);
    h.wheel.key('up', 505, 402);
    expect(h.sent).toEqual([]);
  });

  it('Escape cancels an open wheel, and the later release sends nothing', () => {
    const h = wheelHarness(enemy);
    h.wheel.key('down', 500, 400);
    h.advance(PING_TAP_MAX_MS);
    move(500, 300);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(h.wheel.isOpen()).toBe(false);
    h.wheel.key('up', 500, 300);
    expect(h.sent).toEqual([]);
  });

  it('a lost press (cancel) sends nothing', () => {
    const h = wheelHarness(ground);
    h.wheel.key('down', 500, 400);
    h.wheel.key('cancel', 500, 400);
    h.wheel.key('up', 500, 400);
    expect(h.sent).toEqual([]);
  });

  it('with pings off, the key does nothing at all', () => {
    const h = wheelHarness(enemy, false);
    h.wheel.key('down', 500, 400);
    h.advance(PING_TAP_MAX_MS);
    h.wheel.key('up', 500, 400);
    h.wheel.padPing();
    expect(h.sent).toEqual([]);
    expect(h.mount.querySelector('#ping-wheel')).toBeNull();
  });

  it('the pad press pings the current target', () => {
    const h = wheelHarness(enemy);
    h.wheel.padPing();
    expect(h.sent).toEqual([{ kind: PING_ATTACK, target: 9, x: 1, y: 2, z: 3 }]);
  });
});

function ping(over: Partial<PartyPing> = {}): PartyPing {
  return {
    id: 1,
    kind: PING_WARNING,
    from: 3,
    fromName: 'Jose',
    target: null,
    targetKind: null,
    targetTemplate: '',
    targetName: '',
    x: 5,
    y: 0,
    z: 5,
    ...over,
  };
}

function feedHarness(enabled = true) {
  const disc = document.createElement('div');
  document.body.appendChild(disc);
  const state = { enabled, pings: [] as PartyPing[] };
  const logs: string[] = [];
  const sounds: string[] = [];
  const feed = new PingFeedController({
    doc: document,
    writers,
    world: () => ({
      partyPings: () => state.pings,
      player: { pos: { x: 0, z: 0 } },
      entities: new Map(),
    }),
    enabled: () => state.enabled,
    log: (t) => logs.push(t),
    sound: (k) => sounds.push(k),
    minimapScale: () => 1.7,
    minimapHost: () => disc,
  });
  return { feed, state, logs, sounds, disc };
}

describe('ping feed controller', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('a new ping sounds and logs once, and sits on the minimap while it lives', () => {
    const h = feedHarness();
    h.state.pings = [ping()];
    h.feed.frame();
    h.feed.frame();
    expect(h.logs).toEqual(['Jose: Warning']);
    expect(h.sounds).toEqual(['ui_aura_hard_bell']);
    const marks = h.disc.querySelectorAll<HTMLElement>('.ping-minimap-mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].style.display).toBe('block');
    h.state.pings = [];
    h.feed.frame();
    expect(marks[0].style.display).toBe('none');
  });

  it('a ping already live at a (re)connect draws on the minimap but never replays', () => {
    const h = feedHarness();
    h.state.pings = [ping({ known: true })];
    h.feed.frame();
    expect(h.logs).toEqual([]);
    expect(h.sounds).toEqual([]);
    expect(h.disc.querySelectorAll('.ping-minimap-mark')).toHaveLength(1);
    h.state.pings = [ping({ known: true }), ping({ id: 2, kind: PING_ATTACK })];
    h.feed.frame();
    expect(h.logs).toEqual(['Jose: Attack']);
    expect(h.sounds).toEqual(['ui_aura_sword_draw']);
  });

  it("the sender's own ping sounds and logs on the sender's client too", () => {
    const h = feedHarness();
    // The feed never filters by sender: a ping from the local player plays.
    h.state.pings = [ping({ from: 1, fromName: 'Me', kind: PING_ASSIST })];
    h.feed.frame();
    expect(h.sounds).toEqual(['ui_aura_soft_chime']);
    expect(h.logs).toEqual(['Me: Assist']);
  });

  it('a ping far away neither sounds, logs nor marks the minimap', () => {
    const h = feedHarness();
    h.state.pings = [ping({ x: 5000 })];
    h.feed.frame();
    expect(h.logs).toEqual([]);
    expect(h.sounds).toEqual([]);
    expect(h.disc.querySelectorAll('.ping-minimap-mark')).toHaveLength(0);
  });

  it('with pings off nothing shows or sounds, and turning them on replays nothing', () => {
    const h = feedHarness(false);
    h.state.pings = [ping()];
    h.feed.frame();
    expect(h.logs).toEqual([]);
    expect(h.sounds).toEqual([]);
    expect(h.disc.querySelectorAll('.ping-minimap-mark')).toHaveLength(0);
    h.state.enabled = true;
    h.feed.frame();
    expect(h.logs).toEqual([]);
    h.state.pings = [
      ping(),
      ping({ id: 2, kind: PING_ATTACK, target: 8, targetName: 'Bet', targetKind: 'player' }),
    ];
    h.feed.frame();
    expect(h.logs).toEqual(['Jose: Attack Bet']);
  });
});

describe('Enable Pings setting', () => {
  it('defaults on and persists off', () => {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, v),
      removeItem: (k: string) => map.delete(k),
    });
    expect(new Settings().get('partyPings')).toBe(true);
    new Settings().set('partyPings', false);
    expect(new Settings().get('partyPings')).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('routing through the targeting slice', () => {
  it('the keyboard Ping reaches the HUD key, the pad press its pad ping', () => {
    const key = vi.fn();
    const padPing = vi.fn();
    const hud = { targetOwnPet: vi.fn(), pings: { key, padPing } };
    const cbs = targetingInputCallbacks({} as never, hud, undefined);
    cbs.onPing?.('down', 4, 5);
    expect(key).toHaveBeenCalledWith('down', 4, 5);
    expect(dispatchTargetingAction('ping', {} as never, hud, undefined)).toBe(true);
    expect(padPing).toHaveBeenCalled();
  });
});

describe('the Hud members the factory reads (welded to hud.ts)', () => {
  const hud = readFileSync(join(process.cwd(), 'src/ui/hud.ts'), 'utf8');
  it('exist under the names hud_pings.ts reads', () => {
    expect(hud).toContain('private sim: IWorld,');
    expect(hud).toContain('private renderer: Renderer,');
    expect(hud).toMatch(/writerFacet\b/);
    expect(hud).toContain('private minimapZoom = MINIMAP_ZOOM_DEFAULT;');
    expect(hud).toMatch(/\n {2}log\(\n/);
  });
  it('composes the pings and ticks them on the fast band', () => {
    expect(hud).toContain('readonly pings = createHudPings(this);');
    expect(hud).toContain('this.pings.frame();');
  });
});
