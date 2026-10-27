// What the Hammer Council's members say (src/sim/encounters/smith_heart/
// council_voice.ts) over a REAL Sim claim, and the mythic soul rule in the
// player text (the Falling Rock and Resonance tooltips, the personal alert):
// every line is a catalog key with the same English, the pull's three lines a
// breath apart, a job line only from its own member and never chattering, a
// fall's line (its soul's on mythic) and a survivor's memory, the last fall's
// defeat and a wipe's line.

import { describe, expect, it } from 'vitest';
import {
  COUNCIL_AURAS,
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
import { buildCouncilAlertView, CouncilSoulScan } from '../src/ui/hud/dungeon/council_alert_view';
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
    expect(n).toBe(22);
  });

  it('the pull: each member once, the Guardian first, a breath apart', () => {
    const { f, ev } = pulled();
    const all = [
      ...yells(f, ev),
      ...yells(f, f.tick(Math.ceil((PULL_FIRST + PULL_GAP * 2) * 20) + 4)),
    ];
    expect(keysOf(all)).toEqual([
      'hudChrome.council.say.guardian_pull',
      'hudChrome.council.say.slabwright_pull',
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
    expect(due('wakeTimer')).toEqual(['hudChrome.council.say.slabwright_wake']);
    // The rock is its own line; a second rock inside SAY_EVERY says nothing.
    f.tick(20 * 8);
    expect(due('rockTimer')).toEqual(['hudChrome.council.say.slabwright_rock']);
    f.tick(20 * 8);
    expect(due('rockTimer')).toEqual([]);
    f.tick(20 * SAY_EVERY);
    expect(due('rockTimer')).toEqual(['hudChrome.council.say.slabwright_rock']);
  });

  it('an heir casting an inherited job says nothing of it', () => {
    const { f, st } = pulled();
    f.tick(20 * 6);
    kill(f, 'guardian');
    quiet(st);
    st.energy = T.energyMax;
    const heard = keysOf(yells(f, f.tick(4)));
    expect(st.bars.slabwright?.castId ?? st.bars.singer?.castId).toBe('heart_mountains_wrath');
    expect(heard.some((k) => k?.endsWith('_wrath'))).toBe(false);
  });

  it("a fall: its death line and the first survivor's memory; the last says its defeat", () => {
    const { f } = pulled();
    f.tick(20 * 6);
    expect(keysOf(yells(f, kill(f, 'singer')))).toEqual([
      'hudChrome.council.say.singer_death',
      'hudChrome.council.say.guardian_remember',
    ]);
    // The second fall: the survivor who has not said it yet.
    expect(keysOf(yells(f, kill(f, 'guardian')))).toEqual([
      'hudChrome.council.say.guardian_death',
      'hudChrome.council.say.slabwright_remember',
    ]);
    expect(keysOf(yells(f, kill(f, 'slabwright')))).toEqual([
      'hudChrome.council.say.slabwright_defeat',
    ]);
  });

  it('on mythic a fallen member speaks as its soul takes the stone', () => {
    const { f } = pulled('mythic');
    f.tick(20 * 6);
    expect(keysOf(yells(f, kill(f, 'slabwright')))).toEqual([
      'hudChrome.council.say.slabwright_soul',
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
  it('the Falling Rock and Resonance tooltips state the soul pip rule with live numbers', () => {
    // The Resonance tooltip says "the same wait": the soul pillar's own reach
    // and pace must stay those of a plain pillar's crack.
    expect(T.soulResonanceSeconds).toBe(T.resonanceCrackSeconds);
    expect(T.soulResonanceReach).toBe(T.resonanceReach);
    const rock = auraEffectDescriptor({
      id: COUNCIL_AURAS.rockMark,
      kind: 'vulnerability',
      value: 0,
    });
    const rockText = t(rock?.key as never, rock?.nums as never);
    expect(rockText).toContain(
      `Mythic: a soul pillar within ${T.soulRockReach} yd loses a soul pip`,
    );
    expect(rockText).toContain('Heroic and Mythic: 25% more damage');
    const res = auraEffectDescriptor({
      id: COUNCIL_AURAS.resonance,
      kind: 'vulnerability',
      value: 0,
    });
    const resText = t(res?.key as never, res?.nums as never);
    expect(resText).toContain('soul pip');
    expect(resText).toContain(`${T.singerSoulResonanceSeconds} sec by the Seam Singer's`);
    expect(resText).not.toMatch(/\{\w+\}/);
  });

  it('the alert names the second duty while a soul pillar stands', () => {
    const scan = new CouncilSoulScan();
    const soul = { kind: 'object', templateId: 'sh_council_soul_guardian_c_3' };
    const plain = { kind: 'object', templateId: 'sh_council_pillar_2' };
    const world = (rows: [number, { kind: string; templateId: string }][]) => ({
      entities: new Map(rows),
    });
    const mark = (id: string, value = 0, value2 = 0) => ({
      id,
      remaining: 3,
      duration: 5,
      value,
      value2,
    });
    const line = (v: ReturnType<typeof buildCouncilAlertView>) => (v.visible ? v.line : '');
    const kindOf = (v: ReturnType<typeof buildCouncilAlertView>) => (v.visible ? v.kind : '');
    const none = world([[7, plain]]);
    const some = world([
      [7, plain],
      [9, soul],
    ]);
    const rock = [mark(COUNCIL_AURAS.rockMark)];
    expect(line(buildCouncilAlertView({ auras: rock, soul: scan.frame(none) }))).toBe(
      t('hudChrome.council.alert.rockLine'),
    );
    expect(line(buildCouncilAlertView({ auras: rock, soul: scan.frame(some) }))).toBe(
      t('hudChrome.council.alert.rockLineSoul'),
    );
    const res = [mark(COUNCIL_AURAS.resonance)];
    expect(line(buildCouncilAlertView({ auras: res, soul: scan.frame(some) }))).toBe(
      t('hudChrome.council.alert.resonanceLineSoul'),
    );
    // Climbing on a soul pillar is the point: stay; on a plain one: move.
    const onSoul = buildCouncilAlertView({
      auras: [mark(COUNCIL_AURAS.resonance, 0.4, 9)],
      soul: scan.frame(some),
    });
    expect(line(onSoul)).toBe(t('hudChrome.council.alert.resonanceBreaking'));
    expect(kindOf(onSoul)).toBe('resonance');
    const onPlain = buildCouncilAlertView({
      auras: [mark(COUNCIL_AURAS.resonance, 0.4, 7)],
      soul: scan.frame(some),
    });
    expect(line(onPlain)).toBe(t('hudChrome.council.alert.resonanceCracking'));
    expect(kindOf(onPlain)).toBe('cracking');
    // Without a world (the old call) nothing changes.
    expect(line(buildCouncilAlertView({ auras: rock }))).toBe(
      t('hudChrome.council.alert.rockLine'),
    );
  });
});
