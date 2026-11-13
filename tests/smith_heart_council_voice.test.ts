// What the Hammer Council's members say (src/sim/encounters/smith_heart/
// council_voice.ts) over a REAL Sim claim, and the mythic soul rule in the
// player text (the Falling Rock and Resonance tooltips, the personal alert):
// every line is a catalog key with the same English, the pull's two lines a
// breath apart, a job line only from its own member and never chattering, a
// fall's line (its soul's on mythic) and a survivor's memory, the last fall's
// defeat and a wipe's line.

import { describe, expect, it } from 'vitest';
import {
  COUNCIL_AURAS,
  COUNCIL_DIFFICULTY,
  COUNCIL_ROLES,
  type CouncilFightState,
  type CouncilRole,
  COUNCIL_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import {
  COUNCIL_LINES,
  type CouncilMoment,
  councilLineKey,
  PULL_FIRST,
  PULL_GAP,
  SAY_EVERY,
} from '../src/sim/encounters/smith_heart/council_voice';
import type { Entity, SimEvent } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { buildCouncilAlertView } from '../src/ui/hud/dungeon/council_alert_view';
import { t } from '../src/ui/i18n';
import { type CouncilFight, councilFight } from './helpers/council_fight';

type Yell = Extract<SimEvent, { type: 'chat' }>;

/** The council's yells among `events`, once each (the claim's first player's
 *  copy). */
function yells(f: CouncilFight, events: readonly SimEvent[]): Yell[] {
  return events.filter(
    (e): e is Yell =>
      e.type === 'chat' &&
      e.channel === 'yell' &&
      (e as Yell).textKey?.startsWith('hudChrome.council.say.') === true &&
      (e as Yell & { pid?: number }).pid === f.pids[0],
  );
}
const keysOf = (ys: readonly Yell[]) => ys.map((y) => y.textKey);

function quiet(st: CouncilFightState): void {
  st.weightTimer = 999;
  st.wakeTimer = 999;
  st.rockTimer = 999;
  st.boltTimer = 999;
  st.songTimer = 999;
  st.songDue = null;
  st.pulseTimer = 999;
  st.rushTimer = 999;
  st.energy = 0;
}

function pulled(tier: 'normal' | 'mythic' = 'normal'): {
  f: CouncilFight;
  st: CouncilFightState;
  ev: SimEvent[];
} {
  const f = councilFight(6);
  if (tier !== 'normal') f.dev(`/dev heart council ${tier} on`);
  f.dev('/dev heart council pull');
  const ev = f.tick();
  const st = f.state();
  if (!st) throw new Error('no pull');
  quiet(st);
  return { f, st, ev };
}

function kill(f: CouncilFight, role: CouncilRole): SimEvent[] {
  f.sim.ctx.handleDeath(f.bodies()[role] as Entity, f.players[0]);
  return f.tick();
}

describe('Hammer Council lines', () => {
  it('every line is its catalog key, with the same English', () => {
    let n = 0;
    for (const role of COUNCIL_ROLES)
      for (const [moment, text] of Object.entries(COUNCIL_LINES[role])) {
        expect(t(councilLineKey(role, moment as CouncilMoment) as never)).toBe(text);
        n++;
      }
    expect(n).toBe(23);
  });

  it('the pull: each member once, the Guardian first, a breath apart', () => {
    const { f, ev } = pulled();
    const all = [
      ...yells(f, ev),
      ...yells(f, f.tick(Math.ceil((PULL_FIRST + PULL_GAP * 2) * 20) + 4)),
    ];
    expect(keysOf(all)).toEqual([
      'hudChrome.council.say.guardian_pull',
      'hudChrome.council.say.singer_pull',
    ]);
    expect(all[0].text).toBe(COUNCIL_LINES.guardian.pull);
    expect(all[0].entityId).toBe(f.bodies().guardian?.id);
    expect(keysOf(yells(f, f.tick(20 * 10)))).toEqual([]);
  });

  it('a job line comes from its own member, at most once in SAY_EVERY seconds', () => {
    const { f, st } = pulled();
    f.tick(20 * 6);
    // Due inside a tick (a dev line runs outside one, whose events no tick returns).
    const due = (timer: 'wakeTimer' | 'rockTimer') => {
      quiet(st);
      st[timer] = 0;
      return keysOf(yells(f, f.tick(2)));
    };
    expect(due('wakeTimer')).toEqual(['hudChrome.council.say.singer_wake']);
    // The rock is its own line; a second rock inside SAY_EVERY says nothing.
    f.tick(20 * 8);
    expect(due('rockTimer')).toEqual(['hudChrome.council.say.singer_rock']);
    f.tick(20 * 8);
    expect(due('rockTimer')).toEqual([]);
    f.tick(20 * SAY_EVERY);
    expect(due('rockTimer')).toEqual(['hudChrome.council.say.singer_rock']);
  });

  it('an heir casting an inherited job says nothing of it', () => {
    const { f, st } = pulled();
    f.tick(20 * 6);
    kill(f, 'guardian');
    quiet(st);
    st.energy = T.energyMax;
    const heard = keysOf(yells(f, f.tick(4)));
    expect(st.bars.singer?.castId).toBe('heart_mountains_wrath');
    expect(heard.some((k) => k?.endsWith('_wrath'))).toBe(false);
  });

  it("a fall: its death line and the first survivor's memory; the last says its defeat", () => {
    const { f } = pulled();
    f.tick(20 * 6);
    expect(keysOf(yells(f, kill(f, 'singer')))).toEqual([
      'hudChrome.council.say.singer_death',
      'hudChrome.council.say.guardian_remember',
    ]);
    // The second fall is the last: its defeat line.
    expect(keysOf(yells(f, kill(f, 'guardian')))).toEqual([
      'hudChrome.council.say.guardian_defeat',
    ]);
  });

  it('on mythic a fallen member speaks as its soul takes the stone', () => {
    const { f } = pulled('mythic');
    f.tick(20 * 6);
    expect(keysOf(yells(f, kill(f, 'singer')))).toEqual([
      'hudChrome.council.say.singer_soul',
      'hudChrome.council.say.guardian_remember',
    ]);
  });

  it('a wipe: a survivor says so, once', () => {
    const { f } = pulled();
    f.tick(20 * 6);
    const heard: Yell[] = [];
    for (const p of f.players) f.sim.ctx.handleDeath(p, null);
    for (let i = 0; i < 20 * 60 && f.state(); i++) heard.push(...yells(f, f.sim.tick()));
    expect(f.state()).toBeNull();
    expect(keysOf(heard)).toEqual(['hudChrome.council.say.guardian_wipe']);
  });
});

describe('Hammer Council mythic in the player text', () => {
  it('the Falling Rock tooltip states the soul pip rule with live numbers', () => {
    const rock = auraEffectDescriptor({
      id: COUNCIL_AURAS.rockMark,
      kind: 'vulnerability',
      value: 0,
    });
    const rockText = t(rock?.key as never, rock?.nums as never);
    expect(rockText).toContain(
      `Mythic: a soul pillar within ${T.soulRockReach} yd loses a soul pip`,
    );
    // Each tier's resolved share, never a bare percent (heart_tier_damage.ts).
    expect(rockText).toContain(
      `Heroic and Mythic: ${Math.round(T.rockTotal * COUNCIL_DIFFICULTY.heroic.damageMult)} damage shared`,
    );
    // Resonance is a spread now: it never touches a pillar, soul or not.
    const res = auraEffectDescriptor({
      id: COUNCIL_AURAS.resonance,
      kind: 'vulnerability',
      value: 0,
    });
    const resText = t(res?.key as never, res?.nums as never);
    expect(resText).not.toContain('soul pip');
    expect(resText).not.toMatch(/\{\w+\}/);
  });

  it('the alert stays a short title over its bar whether or not a soul pillar stands', () => {
    // The soul pillar's second duty (break its soul pips) is the Falling Rock
    // tooltip's (above) and the world's (the pips on the pillar): the alert
    // carries no sentence (the owner's rule of 2026-11-03, kept on 2026-11-09).
    const mark = (id: string) => ({ id, remaining: 3, duration: 5 });
    for (const id of [COUNCIL_AURAS.rockMark, COUNCIL_AURAS.resonance]) {
      const v = buildCouncilAlertView({ auras: [mark(id)] });
      expect(v.visible && v.line, id).toBe('');
      expect(v.visible && v.barLabel, id).toBe('3s');
    }
  });
});
