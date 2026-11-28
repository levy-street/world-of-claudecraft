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
import type { Entity } from '../src/sim/types';
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
  setPingIconImg: (img: HTMLImageElement, kind: number) => {
    img.src = `data:ping-${kind}`;
  },
  pingIconCanvas: () => document.createElement('canvas'),
  onPingIconArt: () => () => {},
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
  const state = {
    enabled,
    chat: true,
    pings: [] as PartyPing[],
    entities: new Map<number, Entity>(),
    attackable: new Set<number>(),
  };
  const logs: string[] = [];
  const lines: HTMLElement[] = [];
  const sounds: string[] = [];
  const menus: string[] = [];
  const feed = new PingFeedController({
    doc: document,
    writers,
    world: () => ({
      partyPings: () => state.pings,
      player: { pos: { x: 0, z: 0 } },
      entities: state.entities,
    }),
    enabled: () => state.enabled,
    chatEnabled: () => state.chat,
    attackable: (e) => state.attackable.has(e.id),
    openPlayerMenu: (name) => menus.push(name),
    log: (nodes, plain) => {
      const div = document.createElement('div');
      for (const n of nodes) div.append(n);
      // The plain text is the line's own text: the announcer reads the same words.
      expect(div.textContent).toBe(plain);
      lines.push(div);
      logs.push(plain);
    },
    sound: (k) => sounds.push(k),
    minimapScale: () => 1.7,
    minimapHost: () => disc,
  });
  return { feed, state, logs, lines, sounds, menus, disc };
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
    expect(h.sounds).toEqual(['ui_ping_warning']);
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
    expect(h.sounds).toEqual(['ui_ping_attack']);
  });

  it("the sender's own ping sounds and logs on the sender's client too", () => {
    const h = feedHarness();
    // The feed never filters by sender: a ping from the local player plays.
    h.state.pings = [ping({ from: 1, fromName: 'Me', kind: PING_ASSIST })];
    h.feed.frame();
    expect(h.sounds).toEqual(['ui_ping_assist']);
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

function unit(id: number, kind: Entity['kind'], name: string, hostile = false): Entity {
  return { id, kind, name, hostile, dead: false, pos: { x: 5, y: 0, z: 5 } } as unknown as Entity;
}

describe('the chat callout line', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('an Attack on a hostile mob: badge, sender, callout in the kind colour, red unit name', () => {
    const h = feedHarness();
    h.state.entities.set(7, unit(7, 'mob', 'Ridge Wolf', true));
    h.state.attackable.add(7);
    h.state.pings = [ping({ kind: PING_ATTACK, target: 7, targetKind: 'mob', targetName: 'x' })];
    h.feed.frame();
    expect(h.logs).toEqual(['Jose: Attack Ridge Wolf']);
    const line = h.lines[0].querySelector<HTMLElement>('.ping-chat-line');
    expect(line?.classList.contains('ping-kind-1')).toBe(true);
    const icon = line?.querySelector<HTMLImageElement>('img.ping-chat-icon');
    expect(icon?.getAttribute('src')).toBe('data:ping-1');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(line?.querySelector('.ping-chat-sender')?.textContent).toBe('Jose');
    expect(line?.querySelector('.ping-chat-callout')?.textContent).toBe('Attack ');
    const target = line?.querySelector<HTMLElement>('.ping-chat-target');
    expect(target?.textContent).toBe('Ridge Wolf');
    expect(target?.classList.contains('is-hostile')).toBe(true);
    // A mob's name is not a player: it opens no player menu.
    expect(target?.getAttribute('role')).toBeNull();
  });

  it('an attackable mob that is not wild hostile reads neutral; a friend green', () => {
    const h = feedHarness();
    h.state.entities.set(7, unit(7, 'mob', 'Training Effigy', false));
    h.state.attackable.add(7);
    h.state.entities.set(8, unit(8, 'player', 'Bet'));
    h.state.pings = [
      ping({ kind: PING_ATTACK, target: 7, targetKind: 'mob' }),
      ping({ id: 2, kind: PING_ASSIST, target: 8, targetKind: 'player', targetName: 'Bet' }),
    ];
    h.feed.frame();
    expect(h.logs).toEqual(['Jose: Attack Training Effigy', 'Jose: Assist Bet']);
    const [effigy, bet] = h.lines.map((l) => l.querySelector<HTMLElement>('.ping-chat-target'));
    expect(effigy?.classList.contains('is-neutral')).toBe(true);
    expect(bet?.classList.contains('is-friendly')).toBe(true);
    expect(h.lines[1].querySelector('.ping-chat-line')?.classList.contains('ping-kind-4')).toBe(
      true,
    );
  });

  it('a ground ping is the sender and the callout, nothing else', () => {
    const h = feedHarness();
    h.state.pings = [ping({ kind: PING_LOOK })];
    h.feed.frame();
    expect(h.logs).toEqual(['Jose: Look Here']);
    const line = h.lines[0].querySelector<HTMLElement>('.ping-chat-line');
    expect(line?.classList.contains('ping-kind-0')).toBe(true);
    expect(line?.querySelector('.ping-chat-target')).toBeNull();
    expect(line?.querySelector('.ping-chat-callout')?.textContent).toBe('Look Here');
  });

  it("the sender's name, and a pinged player's, open the player menu like any chat name", () => {
    const h = feedHarness();
    h.state.pings = [
      ping({ kind: PING_ASSIST, target: 8, targetKind: 'player', targetName: 'Bet' }),
    ];
    h.feed.frame();
    const sender = h.lines[0].querySelector<HTMLElement>('.ping-chat-sender');
    const target = h.lines[0].querySelector<HTMLElement>('.ping-chat-target');
    expect(sender?.classList.contains('chat-player-name')).toBe(true);
    expect(sender?.getAttribute('role')).toBe('button');
    sender?.click();
    target?.click();
    expect(h.menus).toEqual(['Jose', 'Bet']);
  });

  it('solo: your own ping writes its line to yourself', () => {
    // A solo player's group is themself (the sim's solo:<pid> key): the view
    // holds their own pings and the feed never filters by sender.
    const h = feedHarness();
    h.state.pings = [ping({ from: 1, fromName: 'Me', kind: PING_LOOK })];
    h.feed.frame();
    expect(h.logs).toEqual(['Me: Look Here']);
  });

  it('Show Pings in Chat off: the sound still plays, no line, and no backlog on return', () => {
    const h = feedHarness();
    h.state.chat = false;
    h.state.pings = [ping({ kind: PING_ATTACK })];
    h.feed.frame();
    expect(h.sounds).toEqual(['ui_ping_attack']);
    expect(h.logs).toEqual([]);
    expect(h.disc.querySelectorAll('.ping-minimap-mark')).toHaveLength(1);
    h.state.chat = true;
    h.feed.frame();
    expect(h.logs).toEqual([]);
    h.state.pings = [ping({ kind: PING_ATTACK }), ping({ id: 2, kind: PING_WARNING })];
    h.feed.frame();
    expect(h.logs).toEqual(['Jose: Warning']);
  });
});

describe('solo on the real Sim', () => {
  it('a solo ground ping reaches the feed and writes its line', async () => {
    const { Sim } = await import('../src/sim/sim');
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const at = sim.player.pos;
    sim.sendPing(PING_LOOK, null, at.x + 4, at.y, at.z);
    const logs: string[] = [];
    const feed = new PingFeedController({
      doc: document,
      writers,
      world: () => sim,
      enabled: () => true,
      log: (_n, plain) => logs.push(plain),
      sound: () => {},
      minimapScale: () => 1.7,
      minimapHost: () => null,
    });
    feed.frame();
    expect(logs).toEqual([`${sim.player.name}: Look Here`]);
  });
});

describe('Enable Pings setting', () => {
  it('Show Pings in Chat defaults on and persists off', () => {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, v),
      removeItem: (k: string) => map.delete(k),
    });
    expect(new Settings().get('partyPingsChat')).toBe(true);
    new Settings().set('partyPingsChat', false);
    expect(new Settings().get('partyPingsChat')).toBe(false);
    vi.unstubAllGlobals();
  });

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
    expect(hud).toContain('private openChatPlayerContextMenu(');
  });
  it('composes the pings and ticks them on the fast band', () => {
    expect(hud).toContain('readonly pings = createHudPings(this);');
    expect(hud).toContain('this.pings.frame();');
  });
});
