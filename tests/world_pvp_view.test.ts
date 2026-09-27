// @vitest-environment happy-dom
// Pins for the World PvP tab's pure view core (src/ui/hud/world_pvp/), its
// painter's markup and button wiring, the shared client hostility verdict
// (src/ui/pvp_hostile_core.ts), the ClientWorld decode of the wpvp self key
// (src/net/social_self_wire.ts), and the sim-string matcher rules that
// re-localize the flag's notices and kill lines (src/ui/sim_i18n.ts).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applySocialSelfWire, type SocialSelfMirrors } from '../src/net/social_self_wire';
import { ZONES } from '../src/sim/data';
import {
  WORLD_PVP_DISARM_SECONDS,
  WORLD_PVP_DR_WINDOW_SECONDS,
  WORLD_PVP_KILL_HONOR,
  WORLD_PVP_MIN_LEVEL,
  WORLD_PVP_STAKE_CAP_COPPER,
  worldPvpPairMultiplier,
} from '../src/sim/pvp';
import {
  WORLD_PVP_AIDED_LINE,
  WORLD_PVP_FFA_ENTER_LINE,
  WORLD_PVP_FFA_LEAVE_LINE,
  WORLD_PVP_MARKED_LINE,
  WORLD_PVP_SANCTUARY_LINE,
  worldPvpDefeatLine,
  worldPvpKillLine,
} from '../src/sim/pvp/world_pvp';
import type { Entity } from '../src/sim/types';
import {
  buildWorldPvpWindowView,
  disarmClockText,
  WORLD_PVP_STAKES,
  wireWorldPvpPanel,
  worldPvpAction,
  worldPvpBodyHtml,
} from '../src/ui/hud/world_pvp';
import { setLanguage } from '../src/ui/i18n';
import {
  isPvpHostilePlayer,
  isPvpHostileTargetId,
  type PvpHostileWorld,
} from '../src/ui/pvp_hostile_core';
import { localizeSimText } from '../src/ui/sim_i18n';
import type { WorldPvpInfo } from '../src/world_api';

// Thornpeak Heights (contested), the Drakelands (free-for-all) and
// Eastbrook Vale (a sanctuary), by the zone table's own rectangles.
const CONTESTED_SPOT = { x: 0, y: 0, z: 700 };
const FFA_SPOT = { x: 360, y: 0, z: 2100 };
const SANCTUARY_SPOT = { x: 0, y: 0, z: 0 };

const info = (over: Partial<WorldPvpInfo> = {}): WorldPvpInfo => ({
  flagged: false,
  disarmRemaining: null,
  kills: 0,
  deaths: 0,
  levelLocked: false,
  zone: 'contested',
  enabled: true,
  ...over,
});

describe('buildWorldPvpWindowView', () => {
  it('is pending until the readout arrives', () => {
    const view = buildWorldPvpWindowView({ info: null, honor: 0, confirming: false });
    expect(view).toEqual({ kind: 'pending', sig: 'world-pending' });
  });

  it('offers enable when down, disable when up, keep-up mid-countdown, locked under level', () => {
    expect(worldPvpAction(info())).toBe('enable');
    expect(worldPvpAction(info({ flagged: true }))).toBe('disable');
    expect(worldPvpAction(info({ flagged: true, disarmRemaining: 42 }))).toBe('keepUp');
    expect(worldPvpAction(info({ levelLocked: true }))).toBe('locked');
    // A flagged player who somehow reads level-locked is still flagged: disable wins.
    expect(worldPvpAction(info({ flagged: true, levelLocked: true }))).toBe('disable');
  });

  it('carries the resolved stakes from the sim rules, never literals', () => {
    expect(WORLD_PVP_STAKES).toEqual({
      stakeCapCopper: WORLD_PVP_STAKE_CAP_COPPER,
      stakePercent: 10,
      killHonor: WORLD_PVP_KILL_HONOR,
      disarmMinutes: WORLD_PVP_DISARM_SECONDS / 60,
      greyLevelGap: 5,
      minLevel: WORLD_PVP_MIN_LEVEL,
      repeatSecondPercent: 50,
      repeatThirdPercent: 25,
      repeatWindowSeconds: WORLD_PVP_DR_WINDOW_SECONDS,
    });
    expect(WORLD_PVP_STAKES.minLevel).toBe(10);
    // The repeat ladder is the rules function's, not a copy of it: the pinned
    // 50/25 above are what worldPvpPairMultiplier actually pays, and the window
    // the copy spells is the one the sim clears the counter on.
    expect(worldPvpPairMultiplier(1)).toBe(0.5);
    expect(worldPvpPairMultiplier(2)).toBe(0.25);
    expect(worldPvpPairMultiplier(3)).toBe(0);
    expect(WORLD_PVP_STAKES.repeatWindowSeconds).toBe(60 * 60);
    const view = buildWorldPvpWindowView({ info: info(), honor: 12, confirming: false });
    expect(view.kind === 'live' && view.stakes).toBe(WORLD_PVP_STAKES);
  });

  it('only the raise carries the confirm step, and the signature tracks every input', () => {
    const base = { info: info(), honor: 5, confirming: true };
    const raising = buildWorldPvpWindowView(base);
    expect(raising.kind === 'live' && raising.confirming).toBe(true);
    const lowering = buildWorldPvpWindowView({ ...base, info: info({ flagged: true }) });
    expect(lowering.kind === 'live' && lowering.confirming).toBe(false);
    const sigs = new Set(
      [
        base,
        { ...base, confirming: false },
        { ...base, honor: 6 },
        { ...base, info: info({ kills: 1 }) },
        { ...base, info: info({ deaths: 1 }) },
        { ...base, info: info({ flagged: true }) },
        { ...base, info: info({ flagged: true, disarmRemaining: 10.2 }) },
        { ...base, info: info({ levelLocked: true }) },
        // The zone layer's two inputs: crossing into a new ground policy and a
        // realm whose kill switch is set both have to repaint the card.
        { ...base, info: info({ zone: 'ffa' }) },
        { ...base, info: info({ enabled: false }) },
      ].map((input) => buildWorldPvpWindowView(input).sig),
    );
    expect(sigs.size).toBe(10);
    // The countdown is whole seconds (ceil) so the strip does not rebuild 20x a second.
    const a = buildWorldPvpWindowView({
      ...base,
      info: info({ flagged: true, disarmRemaining: 10.2 }),
    });
    const b = buildWorldPvpWindowView({
      ...base,
      info: info({ flagged: true, disarmRemaining: 10.9 }),
    });
    expect(a.sig).toBe(b.sig);
    expect(a.kind === 'live' && a.disarmRemaining).toBe(11);
  });
});

describe('worldPvpBodyHtml', () => {
  it('formats the disarm clock as m:ss through the formatters', () => {
    setLanguage('en');
    expect(disarmClockText(300)).toBe('5:00');
    expect(disarmClockText(61)).toBe('1:01');
    expect(disarmClockText(9)).toBe('0:09');
    expect(disarmClockText(-3)).toBe('0:00');
  });

  it('renders the pending note, then the live panel with the right action button', () => {
    setLanguage('en');
    expect(worldPvpBodyHtml({ kind: 'pending', sig: 'x' })).toContain(
      'Waiting for your PvP status',
    );
    const down = worldPvpBodyHtml(
      buildWorldPvpWindowView({ info: info(), honor: 3, confirming: false }),
    );
    expect(down).toContain('data-act="pvp-enable"');
    expect(down).not.toContain('data-act="pvp-disable"');
    expect(down).toContain('Your PvP flag is down.');
    expect(down).toContain('Record: 0 kills, 0 deaths');
    expect(down).toContain('Honor: 3');
    expect(down).toContain('5g'); // the stake cap, through the money formatter
    expect(down).toContain('10%'); // the fraction, through the percent formatter
    expect(down).toContain('/pvp toggles the flag');
    expect(down).toContain('data-focus-key="wpvp-action"');
    const confirming = worldPvpBodyHtml(
      buildWorldPvpWindowView({ info: info(), honor: 3, confirming: true }),
    );
    expect(confirming).toContain('data-act="pvp-confirm"');
    expect(confirming).toContain('data-act="pvp-cancel"');
    expect(confirming).not.toContain('data-act="pvp-enable"');
    // The action focus key follows the press onto the SAFE button of the
    // confirm step (Cancel), never onto Raise Flag, which carries its own key.
    expect(confirming).toContain('data-act="pvp-cancel" data-focus-key="wpvp-action"');
    expect(confirming).toContain('data-act="pvp-confirm" data-focus-key="wpvp-confirm"');
    expect(confirming).not.toContain('data-act="pvp-confirm" data-focus-key="wpvp-action"');
    const up = worldPvpBodyHtml(
      buildWorldPvpWindowView({ info: info({ flagged: true }), honor: 0, confirming: false }),
    );
    expect(up).toContain('data-act="pvp-disable"');
    expect(up).toContain('is-on');
    const disarming = worldPvpBodyHtml(
      buildWorldPvpWindowView({
        info: info({ flagged: true, disarmRemaining: 125 }),
        honor: 0,
        confirming: false,
      }),
    );
    expect(disarming).toContain('data-act="pvp-keep"');
    expect(disarming).toContain('2:05');
    const locked = worldPvpBodyHtml(
      buildWorldPvpWindowView({ info: info({ levelLocked: true }), honor: 0, confirming: false }),
    );
    // Inert but still in the tab order (aria-disabled, never the native
    // attribute), so a keyboard user can reach the reason under it.
    expect(locked).toContain(
      'data-act="pvp-enable" data-focus-key="wpvp-action" aria-disabled="true"',
    );
    expect(locked).not.toMatch(/<button[^>]* disabled[ >]/);
    // The inert look is the shared class, never a global aria-disabled rule
    // (the Harvest button keeps its appearance under aria-disabled on purpose).
    expect(locked).toContain('ui-btn--red ui-btn--dis');
    expect(locked).toContain(`Requires level ${WORLD_PVP_MIN_LEVEL}.`);
    expect(locked).toContain('Requires level 10.');
  });
});

describe('wireWorldPvpPanel', () => {
  function mount(view: ReturnType<typeof buildWorldPvpWindowView>) {
    setLanguage('en');
    const el = document.createElement('div');
    el.innerHTML = worldPvpBodyHtml(view);
    const flags: boolean[] = [];
    const confirms: boolean[] = [];
    wireWorldPvpPanel(el, {
      world: () => ({ setWorldPvpFlag: (on: boolean) => flags.push(on) }) as never,
      setConfirming: (c) => confirms.push(c),
    });
    const click = (act: string) => {
      const btn = el.querySelector<HTMLElement>(`[data-act="${act}"]`);
      if (!btn) throw new Error(`no ${act} button`);
      btn.click();
    };
    return { el, click, flags, confirms };
  }

  it('the raise is a two-step confirm; lowering and keeping are one press each', () => {
    const down = mount(buildWorldPvpWindowView({ info: info(), honor: 0, confirming: false }));
    down.click('pvp-enable');
    expect(down.confirms).toEqual([true]);
    expect(down.flags).toEqual([]);
    const confirming = mount(buildWorldPvpWindowView({ info: info(), honor: 0, confirming: true }));
    confirming.click('pvp-cancel');
    expect(confirming.confirms).toEqual([false]);
    expect(confirming.flags).toEqual([]);
    confirming.click('pvp-confirm');
    expect(confirming.confirms).toEqual([false, false]);
    expect(confirming.flags).toEqual([true]);
    const up = mount(
      buildWorldPvpWindowView({ info: info({ flagged: true }), honor: 0, confirming: false }),
    );
    up.click('pvp-disable');
    expect(up.flags).toEqual([false]);
    const disarming = mount(
      buildWorldPvpWindowView({
        info: info({ flagged: true, disarmRemaining: 30 }),
        honor: 0,
        confirming: false,
      }),
    );
    disarming.click('pvp-keep');
    expect(disarming.flags).toEqual([true]);
  });

  it('a locked raise button is inert, and so is the realm-off one, while both stay focusable', () => {
    for (const over of [{ levelLocked: true }, { enabled: false }]) {
      const locked = mount(
        buildWorldPvpWindowView({ info: info(over), honor: 0, confirming: false }),
      );
      const btn = locked.el.querySelector<HTMLButtonElement>('[data-act="pvp-enable"]');
      expect(btn?.hasAttribute('disabled')).toBe(false);
      expect(btn?.getAttribute('aria-disabled')).toBe('true');
      locked.click('pvp-enable');
      expect(locked.confirms).toEqual([]);
      expect(locked.flags).toEqual([]);
    }
  });
});

describe('applySocialSelfWire: the wpvp self key (the ClientWorld mirror)', () => {
  const mirrors = (): SocialSelfMirrors => ({
    tradeInfo: null,
    duelInfo: null,
    arenaInfo: null,
    bgInfo: null,
    dungeonFinderInfo: null,
    dungeonFinderBoard: null,
    cardMinigameInfo: { queued: false, available: true, match: null },
    honor: 0,
    lifetimeHonor: 0,
    marketInfo: null,
    marketCollectPending: false,
    mailInfo: null,
    mailUnread: 0,
    worldPvpInfo: null,
    hillInfo: null,
  });

  it('adopts a readout, keeps it when the key is omitted, clears it on null', () => {
    const target = mirrors();
    const readout = info({ flagged: true, kills: 2 });
    applySocialSelfWire(target, { wpvp: readout });
    expect(target.worldPvpInfo).toBe(readout);
    applySocialSelfWire(target, { honor: 5 });
    expect(target.worldPvpInfo).toBe(readout);
    expect(target.honor).toBe(5);
    applySocialSelfWire(target, { wpvp: null });
    expect(target.worldPvpInfo).toBeNull();
  });
});

describe('isPvpHostilePlayer (the shared client verdict)', () => {
  const player = (id: number, extra: Partial<Entity> = {}): Entity =>
    ({
      id,
      kind: 'player',
      dead: false,
      guild: '',
      level: 20,
      pos: { ...CONTESTED_SPOT },
      ...extra,
    }) as Entity;
  const worldOf = (
    self: Entity,
    others: Entity[],
    over: Partial<PvpHostileWorld> = {},
  ): PvpHostileWorld => ({
    playerId: self.id,
    entities: new Map([self, ...others].map((e) => [e.id, e])),
    duelInfo: null,
    arenaInfo: null,
    bgInfo: null,
    partyInfo: null,
    worldPvpInfo: null,
    ...over,
  });

  it('two flagged strangers are hostile; one-sided flags, self, corpses and party mates are not', () => {
    const me = player(1, { pvpFlag: true });
    const stranger = player(2, { pvpFlag: true });
    const unflagged = player(3);
    const corpse = player(4, { pvpFlag: true, dead: true });
    const world = worldOf(me, [stranger, unflagged, corpse]);
    expect(isPvpHostilePlayer(world, stranger)).toBe(true);
    expect(isPvpHostileTargetId(world, 2)).toBe(true);
    expect(isPvpHostilePlayer(world, unflagged)).toBe(false);
    expect(isPvpHostilePlayer(world, me)).toBe(false);
    expect(isPvpHostilePlayer(world, corpse)).toBe(false);
    expect(isPvpHostileTargetId(world, null)).toBe(false);
    expect(isPvpHostileTargetId(world, 99)).toBe(false);
    const grouped = worldOf(me, [stranger], {
      partyInfo: { members: [{ pid: 2 }] } as unknown as PvpHostileWorld['partyInfo'],
    });
    expect(isPvpHostilePlayer(grouped, stranger)).toBe(false);
  });

  it('an unflagged local player sees nobody as world-hostile, but a duel opponent stays red', () => {
    const me = player(1);
    const flagged = player(2, { pvpFlag: true });
    expect(isPvpHostilePlayer(worldOf(me, [flagged]), flagged)).toBe(false);
    const duel = worldOf(me, [flagged], {
      duelInfo: { state: 'active', otherPid: 2 } as unknown as PvpHostileWorld['duelInfo'],
    });
    expect(isPvpHostilePlayer(duel, flagged)).toBe(true);
  });

  it('inside a live battleground or arena the world arm is off (a flagged teammate is never red)', () => {
    const me = player(1, { pvpFlag: true });
    const teammate = player(2, { pvpFlag: true });
    const inBg = worldOf(me, [teammate], {
      bgInfo: {
        match: { state: 'active', myTeam: 0, players: [{ pid: 2, team: 0 }] },
      } as unknown as PvpHostileWorld['bgInfo'],
    });
    expect(isPvpHostilePlayer(inBg, teammate)).toBe(false);
    const inArena = worldOf(me, [teammate], {
      arenaInfo: {
        match: { state: 'active', oppPid: 7, enemies: [] },
      } as unknown as PvpHostileWorld['arenaInfo'],
    });
    expect(isPvpHostilePlayer(inArena, teammate)).toBe(false);
  });
});

describe('sim_i18n matcher: the World PvP lines round-trip', () => {
  it('re-localizes every notice, kill and defeat shape (English resolves to itself)', () => {
    setLanguage('en');
    const lines = [
      'World PvP enabled: other flagged players can attack you.',
      // The four lines the zone layer added, read off the sim constants rather
      // than retyped: a reworded notice must move its sim_i18n row in the same
      // change or this pin reds instead of the line shipping raw English.
      WORLD_PVP_AIDED_LINE,
      WORLD_PVP_MARKED_LINE,
      WORLD_PVP_FFA_ENTER_LINE,
      WORLD_PVP_FFA_LEAVE_LINE,
      WORLD_PVP_SANCTUARY_LINE,
      'World PvP disabled.',
      'World PvP stays enabled.',
      'World PvP will be disabled in 5 minutes.',
      'World PvP is already enabled.',
      'World PvP is already disabled.',
      'World PvP is already switching off.',
      'World PvP is disabled on this realm.',
      'World PvP: wait a moment before switching again.',
      `You must be at least level ${WORLD_PVP_MIN_LEVEL} to enable World PvP.`,
      'Usage: /pvp, /pvp on, or /pvp off.',
      worldPvpKillLine('Bet', 0, 1),
      worldPvpKillLine('Bet', 1_234, 1),
      worldPvpKillLine('Bet', 50_000, 3),
      worldPvpDefeatLine('Aleph', 0, 1),
      worldPvpDefeatLine('Aleph', 700, 1),
      worldPvpDefeatLine('Aleph', 0, 2),
      worldPvpDefeatLine('Aleph', 700, 2),
      worldPvpDefeatLine('Aleph', 0, 3),
      worldPvpDefeatLine('Aleph', 700, 3),
    ];
    for (const line of lines) {
      const localized = localizeSimText(line);
      expect(localized, line).not.toBeNull();
    }
    // Names splice through verbatim and the money re-formats through the locale.
    expect(localizeSimText(worldPvpKillLine('Bet', 1_234, 1))).toContain('Bet');
    expect(localizeSimText(worldPvpDefeatLine('Aleph', 700, 3))).toContain('Aleph and 2 others');
    expect(localizeSimText(worldPvpDefeatLine('Aleph', 700, 2))).toContain('Aleph and 1 other');
  });
});

describe('isPvpHostilePlayer: the ground on the client', () => {
  const player = (id: number, extra: Partial<Entity> = {}): Entity =>
    ({
      id,
      kind: 'player',
      dead: false,
      guild: '',
      level: 20,
      pos: { ...CONTESTED_SPOT },
      ...extra,
    }) as Entity;
  const worldOf = (self: Entity, others: Entity[], over: Partial<PvpHostileWorld> = {}) =>
    ({
      playerId: self.id,
      entities: new Map([self, ...others].map((e) => [e.id, e])),
      duelInfo: null,
      arenaInfo: null,
      bgInfo: null,
      partyInfo: null,
      worldPvpInfo: null,
      ...over,
    }) as PvpHostileWorld;

  it('a sanctuary under either player is never red, flags or not', () => {
    const self = player(1, { pvpFlag: true, pos: { ...SANCTUARY_SPOT } });
    const other = player(2, { pvpFlag: true });
    expect(isPvpHostilePlayer(worldOf(self, [other]), other)).toBe(false);
    const selfOut = player(1, { pvpFlag: true });
    const otherIn = player(2, { pvpFlag: true, pos: { ...SANCTUARY_SPOT } });
    expect(isPvpHostilePlayer(worldOf(selfOut, [otherIn]), otherIn)).toBe(false);
  });

  it('a free-for-all zone under both is red with no flag; a party mate stays grey', () => {
    const self = player(1, { pos: { ...FFA_SPOT } });
    const other = player(2, { pos: { x: FFA_SPOT.x + 3, y: 0, z: FFA_SPOT.z } });
    expect(isPvpHostilePlayer(worldOf(self, [other]), other)).toBe(true);
    expect(isPvpHostileTargetId(worldOf(self, [other]), 2)).toBe(true);
    const party = { members: [{ pid: 2 }] } as unknown as PvpHostileWorld['partyInfo'];
    expect(isPvpHostilePlayer(worldOf(self, [other], { partyInfo: party }), other)).toBe(false);
    // One side outside the zone: only the flags count.
    const outside = player(3);
    expect(isPvpHostilePlayer(worldOf(self, [outside]), outside)).toBe(false);
  });

  it('a realm whose switch is off has no world arm at all', () => {
    const self = player(1, { pvpFlag: true, pos: { ...FFA_SPOT } });
    const other = player(2, { pvpFlag: true, pos: { ...FFA_SPOT } });
    expect(isPvpHostilePlayer(worldOf(self, [other]), other)).toBe(true);
    const closed = worldOf(self, [other], { worldPvpInfo: info({ enabled: false }) });
    expect(isPvpHostilePlayer(closed, other)).toBe(false);
    const open = worldOf(self, [other], { worldPvpInfo: info({ enabled: true }) });
    expect(isPvpHostilePlayer(open, other)).toBe(true);
  });

  it('reads both grounds off the positions, never the readout zone', () => {
    // The readout lags the local player's own movement by a snapshot; a
    // stranger who can already open on you must read red the frame you cross.
    const self = player(1, { pos: { ...FFA_SPOT } });
    const other = player(2, { pos: { x: FFA_SPOT.x + 3, y: 0, z: FFA_SPOT.z } });
    const stale = worldOf(self, [other], { worldPvpInfo: info({ zone: 'contested' }) });
    expect(isPvpHostilePlayer(stale, other)).toBe(true);
    const selfOut = player(1, { pos: { ...CONTESTED_SPOT } });
    const early = worldOf(selfOut, [other], { worldPvpInfo: info({ zone: 'ffa' }) });
    expect(isPvpHostilePlayer(early, other)).toBe(false);
  });
});

describe('the World PvP tab: the ground line and the realm switch', () => {
  const body = (over: Partial<WorldPvpInfo> = {}, confirming = false): string => {
    setLanguage('en');
    return worldPvpBodyHtml(buildWorldPvpWindowView({ info: info(over), honor: 0, confirming }));
  };

  it('carries the ground and the realm switch onto the live view', () => {
    const view = buildWorldPvpWindowView({
      info: info({ zone: 'ffa' }),
      honor: 0,
      confirming: false,
    });
    expect(view.kind === 'live' && view.zone).toBe('ffa');
    expect(view.kind === 'live' && view.realmEnabled).toBe(true);
    const closed = buildWorldPvpWindowView({
      info: info({ enabled: false }),
      honor: 0,
      confirming: false,
    });
    expect(closed.kind === 'live' && closed.realmEnabled).toBe(false);
  });

  it('the realm switch outranks every other action arm', () => {
    expect(worldPvpAction(info({ enabled: false }))).toBe('realmOff');
    expect(worldPvpAction(info({ enabled: false, levelLocked: true }))).toBe('realmOff');
    expect(worldPvpAction(info({ enabled: false, flagged: true }))).toBe('realmOff');
    expect(worldPvpAction(info({ enabled: false, flagged: true, disarmRemaining: 9 }))).toBe(
      'realmOff',
    );
    // The switch is the ONLY thing that produces it: an ordinary realm never does.
    expect(worldPvpAction(info())).toBe('enable');
    // A readout with no switch at all (an older server) reads as open, the
    // hostility core's own `=== false` reading.
    expect(worldPvpAction(info({ enabled: undefined as never }))).toBe('enable');
    // A raise can never be half-confirmed behind a dead button.
    const closed = buildWorldPvpWindowView({
      info: info({ enabled: false }),
      honor: 0,
      confirming: true,
    });
    expect(closed.kind === 'live' && closed.confirming).toBe(false);
  });

  it('paints one ground line per zone policy, free-for-all in the hostile tone', () => {
    const contested = body();
    expect(contested).toContain('Contested ground: only flagged players fight here.');
    // Only the hostile state carries a tone class: the class is chosen from the
    // union, never interpolated from the wire.
    expect(contested).toContain('<span class="wpvp-zone">');
    expect(contested).not.toContain('is-ffa');
    expect(contested).toContain('Your PvP flag is down. You cannot attack or be attacked');

    const sanctuary = body({ zone: 'sanctuary' });
    expect(sanctuary).toContain('Sanctuary: no world PvP here.');
    expect(sanctuary).toContain('<span class="wpvp-zone">');
    expect(sanctuary).not.toContain('Contested ground');

    const ffa = body({ zone: 'ffa' });
    expect(ffa).toContain('Free-for-all ground: everyone here is fair game.');
    expect(ffa).toContain('class="wpvp-zone is-ffa"');
    // The flag-down sentence must not promise an immunity this ground denies.
    expect(ffa).toContain('on free-for-all ground you can still attack and be attacked');
    expect(ffa).not.toContain('You cannot attack or be attacked in the open world.');
  });

  it('a flagged player still reads the ground under them', () => {
    const up = body({ flagged: true, zone: 'ffa' });
    expect(up).toContain('Your PvP flag is up.');
    expect(up).toContain('Free-for-all ground: everyone here is fair game.');
    expect(up).toContain('data-act="pvp-disable"');
  });

  it('an under-level player on free-for-all ground reads the plain flag-down sentence', () => {
    // The sim's pair rule keeps them outside the free-for-all arm, so the
    // ground sentence would promise a fight they can neither start nor suffer.
    const lockedFfa = body({ zone: 'ffa', levelLocked: true });
    expect(lockedFfa).toContain('You cannot attack or be attacked in the open world.');
    expect(lockedFfa).not.toContain('on free-for-all ground you can still attack and be attacked');
    expect(lockedFfa).toContain('Requires level 10.');
  });

  it('a realm with the switch set locks the action and says so, and no press lands', () => {
    const closed = body({ enabled: false });
    expect(closed).toContain('data-act="pvp-enable"');
    expect(closed).toContain('aria-disabled="true"');
    expect(closed).not.toMatch(/<button[^>]* disabled[ >]/);
    // The reason is stated ONCE, beside the control it explains.
    expect(closed.split('World PvP is disabled on this realm.').length - 1).toBe(1);
    expect(closed).toContain(
      `<div class="bg-note bg-level-req">World PvP is disabled on this realm.</div>`,
    );
    // No ground line: with the switch set no zone policy is live to report.
    expect(closed).not.toContain('wpvp-zone');
    expect(closed).not.toContain('Contested ground');
    // /pvp is refused too, so the chat hint would only lead to an error line.
    expect(closed).not.toContain('/pvp toggles the flag');
    expect(body({})).toContain('/pvp toggles the flag'); // the positive control
    // Even standing on free-for-all ground, nothing there is live: no ground
    // line, and the flag-down sentence keeps its plain form.
    const closedFfa = body({ enabled: false, zone: 'ffa' });
    expect(closedFfa).not.toContain('Free-for-all ground');
    expect(closedFfa).not.toContain('wpvp-zone');
    expect(closedFfa).toContain('You cannot attack or be attacked in the open world.');
    expect(closedFfa).toContain('World PvP is disabled on this realm.');

    setLanguage('en');
    const el = document.createElement('div');
    el.innerHTML = closed;
    const flags: boolean[] = [];
    const confirms: boolean[] = [];
    wireWorldPvpPanel(el, {
      world: () => ({ setWorldPvpFlag: (on: boolean) => flags.push(on) }) as never,
      setConfirming: (c) => confirms.push(c),
    });
    el.querySelector<HTMLElement>('[data-act="pvp-enable"]')?.click();
    expect(confirms).toEqual([]);
    expect(flags).toEqual([]);
  });
});

describe('the World PvP tab: the stakes list states the live rules', () => {
  const stakesHtml = (): string => {
    setLanguage('en');
    return worldPvpBodyHtml(buildWorldPvpWindowView({ info: info(), honor: 0, confirming: false }));
  };

  it('names all three kinds of ground, and the zones that are not contested', () => {
    const html = stakesHtml();
    expect(html).toContain('The Proving Shore and Eastbrook Vale are sanctuaries');
    expect(html).toContain('Everywhere else is contested: only two flagged players can fight.');
    expect(html).toContain(
      'The Drakelands, the Frostveil Reach and the Amberfall are free-for-all',
    );
    expect(html).toContain(
      'Party and raid members are never hostile to each other. Guildmates outside your group can fight.',
    );
    // The names in the copy follow the zone table: a policy moved in
    // src/sim/content/ must move the sentence with it.
    const lower = html.toLowerCase();
    for (const zone of ZONES.filter((z) => z.worldPvp === 'ffa')) {
      expect(lower).toContain(zone.name.replace(/^The /, '').toLowerCase());
    }
    for (const zone of ZONES.filter((z) => z.worldPvp === 'sanctuary')) {
      expect(lower).toContain(zone.name.replace(/^The /, '').toLowerCase());
    }
  });

  it('states what raises your flag for you: the first strike and aid to a flagged ally', () => {
    const html = stakesHtml();
    expect(html).toContain(
      'Attacking an unflagged player there raises your own flag; attacking a flagged one never does.',
    );
    expect(html).toContain(
      'Healing, shielding or buffing a flagged player in a world fight raises your flag.',
    );
  });

  it('states what a kill moves, and that an unflagged victim pays nothing', () => {
    const html = stakesHtml();
    expect(html).toContain('5g'); // the cap, through the money formatter
    expect(html).toContain('10%'); // the fraction, through the percent formatter
    expect(html).toContain('An unflagged player killed on free-for-all ground loses no gold.');
    expect(html).toContain(
      'An unflagged fighter takes no gold either: it only moves between two flagged players.',
    );
    expect(html).toContain('10 Honor per kill, split between everyone who helped.');
  });

  it('states the per-victim decay with its ladder and its hour-long window', () => {
    const html = stakesHtml();
    expect(html).toContain(
      'Repeat kills of one player pay 50%, then 25%, then nothing; the count clears 1 hour after the first kill.',
    );
  });

  it('states the five-minute disarm, resolved from the sim constant', () => {
    const html = stakesHtml();
    expect(WORLD_PVP_DISARM_SECONDS / 60).toBe(5);
    expect(html).toContain('Switching off takes 5 minutes and waits for combat to end.');
  });
});

describe('the World PvP tab: the free-for-all tone', () => {
  it('is the hostile token, pinned in the stylesheet', () => {
    const css = readFileSync('src/styles/components.css', 'utf8'); // vitest runs at the repo root
    const at = css.indexOf('.wpvp-zone.is-ffa');
    expect(at).toBeGreaterThan(-1);
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toContain('var(--color-hostile)');
  });
});
