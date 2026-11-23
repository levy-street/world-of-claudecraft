// The Drowned Temple's encounter alert (src/ui/hud/dungeon/temple_alert_view.ts):
// Choirmother Selthe's Score. The melody says watch (and on heroic, remember),
// the answer says which tile comes next and how many are sounded, a player
// standing on the wanted tile is told to step off and on, a False Note says the
// answer starts over, and her broken voice opens the damage window. Driven from
// a real fight too, so the view reads exactly the bars, auras and tile
// templates the sim mirrors.

import { describe, expect, it } from 'vitest';
import { HEROIC_DUNGEON_TUNING } from '../src/sim/content/dungeon_difficulty';
import {
  moonTileTemplate,
  SELTHE_BROKEN_VOICE,
  SELTHE_BROKEN_VOICE_EXPOSED,
  SELTHE_ID,
  SELTHE_SCORE,
  SELTHE_SCORE_ANSWER,
  SELTHE_SCORE_WARD,
  SELTHE_TUNING,
} from '../src/sim/encounters/drowned_temple';
import type { Entity, SeltheFightState } from '../src/sim/types';
import { type AuraEffectInput, auraEffectDescriptor } from '../src/ui/aura_effect';
import { castDisplayName } from '../src/ui/cast_display_name';
import { TempleAlertSceneScan } from '../src/ui/hud/dungeon/temple_alert_scene_core';
import {
  buildTempleAlertView,
  TEMPLE_ALERT_KINDS,
  type TempleAlertEntity,
  type TempleAlertScene,
} from '../src/ui/hud/dungeon/temple_alert_view';
import { setLanguage, t } from '../src/ui/i18n';
import { boss, engage, type Fight, fight, put, run, tick } from './helpers/temple_fight';

setLanguage('en');

const T = SELTHE_TUNING;

function tile(state: Parameters<typeof moonTileTemplate>[0], place = 0, x = 0): TempleAlertEntity {
  return { templateId: moonTileTemplate(state, place), pos: { x, z: 0 } };
}

function selthe(over: Partial<TempleAlertEntity>): TempleAlertEntity {
  return { templateId: SELTHE_ID, auras: [], castingAbility: null, ...over };
}

function ward(notes: number, dark: boolean) {
  return {
    id: SELTHE_SCORE_WARD,
    stacks: notes,
    value2: dark ? 1 : 0,
    remaining: 20,
    duration: 20,
  };
}

function view(scene: TempleAlertScene, selfPos = { x: 50, z: 50 }) {
  return buildTempleAlertView({ scene, selfPos });
}

describe('the Temple alert view: Selthe’s Score', () => {
  it('hides with no Selthe, a dead Selthe, or a Selthe singing nothing of the Score', () => {
    expect(buildTempleAlertView({}).visible).toBe(false);
    expect(view({ selthe: null, tiles: [] }).visible).toBe(false);
    expect(
      view({ selthe: selthe({ dead: true, castingAbility: SELTHE_SCORE }), tiles: [] }).visible,
    ).toBe(false);
    expect(
      view({ selthe: selthe({ castingAbility: 'temple_mere_surge' }), tiles: [] }).visible,
    ).toBe(false);
  });

  it('the melody: watch, with the bar her own; on heroic, remember', () => {
    const scene: TempleAlertScene = {
      selthe: selthe({
        castingAbility: SELTHE_SCORE,
        castRemaining: 2.55,
        castTotal: 5.1,
        auras: [ward(3, false)],
      }),
      tiles: [tile('note', 1), tile('dark'), tile('dark')],
    };
    const v = view(scene);
    expect(v.visible && v.kind).toBe('score-melody');
    expect(v.visible && v.title).toBe(t('hudChrome.templeAlert.melodyTitle'));
    expect(v.visible && v.line).toBe(t('hudChrome.templeAlert.melodyLine'));
    expect(v.visible && v.progress).toBeCloseTo(0.5, 6);
    expect(v.visible && v.progressAria).toBe(t('hudChrome.templeAlert.timeAria', { seconds: '3' }));
    expect(v.visible && v.pressable).toBe(false);
    const heroic = view({ ...scene, selthe: { ...scene.selthe, auras: [ward(3, true)] } });
    expect(heroic.visible && heroic.kind).toBe('score-melody');
    expect(heroic.visible && heroic.line).toBe(t('hudChrome.templeAlert.melodyDarkLine'));
    expect(t('hudChrome.templeAlert.melodyDarkLine')).not.toBe(
      t('hudChrome.templeAlert.melodyLine'),
    );
  });

  it('the answer names the next tile’s mark and counts what is sounded', () => {
    const scene: TempleAlertScene = {
      selthe: selthe({
        castingAbility: SELTHE_SCORE_ANSWER,
        castRemaining: 7,
        castTotal: 14,
        auras: [ward(4, false)],
      }),
      tiles: [tile('done', 1), tile('next', 2, 10), tile('lit', 3), tile('lit', 4), tile('dark')],
    };
    const v = view(scene);
    expect(v.visible && v.kind).toBe('score-answer');
    expect(v.visible && v.title).toBe(t('hudChrome.templeAlert.answerTitle'));
    expect(v.visible && v.line).toBe(
      t('hudChrome.templeAlert.answerLine', { place: '2', done: '1', total: '4' }),
    );
    expect(v.visible && v.line).toContain('2');
    expect(v.visible && v.progress).toBeCloseTo(0.5, 6);
  });

  it('standing on the wanted tile: step off and back on (the sim’s own rim)', () => {
    const scene: TempleAlertScene = {
      selthe: selthe({
        castingAbility: SELTHE_SCORE_ANSWER,
        castRemaining: 7,
        castTotal: 14,
        auras: [ward(3, false)],
      }),
      tiles: [tile('next', 1, 10), tile('lit', 2), tile('lit', 3)],
    };
    const rim = T.scoreTileRadius + T.scoreTileLeave;
    const on = view(scene, { x: 10 + rim - 0.05, z: 0 });
    expect(on.visible && on.kind).toBe('score-step-off');
    expect(on.visible && on.title).toBe(t('hudChrome.templeAlert.stepOffTitle'));
    expect(on.visible && on.line).toBe(t('hudChrome.templeAlert.stepOffLine'));
    const off = view(scene, { x: 10 + rim + 0.05, z: 0 });
    expect(off.visible && off.kind).toBe('score-answer');
  });

  it('a soured tile outranks everything: the answer starts over', () => {
    const v = view(
      {
        selthe: selthe({
          castingAbility: SELTHE_SCORE_ANSWER,
          castRemaining: 5,
          castTotal: 14,
          auras: [ward(3, false)],
        }),
        tiles: [tile('next', 1, 10), tile('sour'), tile('lit', 3)],
      },
      { x: 10, z: 0 },
    );
    expect(v.visible && v.kind).toBe('score-false');
    expect(v.visible && v.title).toBe(t('hudChrome.templeAlert.falseTitle'));
    expect(v.visible && v.line).toBe(t('hudChrome.templeAlert.falseLine'));
  });

  it('heroic answer: the tiles are dark, so only the count is told, never the next tile', () => {
    const v = view({
      selthe: selthe({
        castingAbility: SELTHE_SCORE_ANSWER,
        castRemaining: 12,
        castTotal: 16,
        auras: [ward(4, true)],
      }),
      tiles: [tile('done', 1), tile('done', 2), tile('dark'), tile('dark'), tile('dark')],
    });
    expect(v.visible && v.kind).toBe('score-answer-dark');
    expect(v.visible && v.line).toBe(
      t('hudChrome.templeAlert.answerDarkLine', { place: '0', done: '2', total: '4' }),
    );
    expect(v.visible && v.line).toContain('2');
    expect(v.visible && v.line).toContain('4');
    expect(v.visible && v.line).toContain('Step off before stepping onto a tile again');
  });

  it('her broken voice opens the window: the bar is the aura’s own time left', () => {
    const v = view({
      selthe: selthe({
        auras: [
          { id: SELTHE_BROKEN_VOICE, remaining: 1, duration: 4 },
          { id: SELTHE_BROKEN_VOICE_EXPOSED, remaining: 7.5, duration: 10 },
        ],
      }),
      tiles: [tile('dark')],
    });
    expect(v.visible && v.kind).toBe('score-broken');
    expect(v.visible && v.title).toBe(t('hudChrome.templeAlert.brokenTitle'));
    expect(v.visible && v.line).toBe(t('hudChrome.templeAlert.brokenLine', { pct: '20' }));
    expect(v.visible && v.progress).toBeCloseTo(0.75, 6);
  });

  it('every kind the view can return is a class the painter toggles', () => {
    expect([...TEMPLE_ALERT_KINDS].sort()).toEqual(
      [
        'score-answer',
        'score-answer-dark',
        'score-broken',
        'score-false',
        'score-melody',
        'score-spent',
        'score-step-off',
      ].sort(),
    );
  });
});

describe('the Temple alert reads the live fight', () => {
  function state(b: Entity): SeltheFightState {
    const st = b.templeFight;
    if (st?.kind !== 'selthe') throw new Error('no selthe fight');
    return st;
  }

  function live(difficulty: 'normal' | 'heroic') {
    const f = fight(difficulty);
    const b = boss(f, SELTHE_ID);
    put(f, f.tank, 0, 6);
    put(f, f.others[0], -10, -6);
    put(f, f.others[1], 10, -6);
    engage(f, b);
    run(f, 0.05);
    const st = state(b);
    st.chorusTimer = 999;
    st.soloTimer = 999;
    st.surgeTimer = 999;
    st.ariaTimer = 999;
    const scan = new TempleAlertSceneScan();
    const world = () => ({
      entities: f.sim.ctx.entities as unknown as ReadonlyMap<
        number,
        TempleAlertEntity & { kind?: string; templateId: string }
      >,
      entityRosterVersion: f.sim.entityRosterVersion,
    });
    const look = (p: Entity) => {
      const v = buildTempleAlertView({
        scene: scan.update(world()),
        selfPos: { x: p.pos.x, z: p.pos.z },
        auras: p.auras,
      });
      return v.visible ? v : null;
    };
    return { f, b, st, look, scan, world };
  }

  function stepOn(f: Fight, st: SeltheFightState, p: Entity, tileIndex: number): void {
    put(f, p, 3, 4);
    tick(f);
    put(f, p, st.tiles[tileIndex].x, st.tiles[tileIndex].z);
    tick(f);
  }

  it('normal: melody, answer with the next mark, step-off, false note, broken voice', () => {
    const { f, b, st, look, scan, world } = live('normal');
    // The scan finds her and her five tiles off the roster.
    const scene = scan.update(world());
    expect(scene.selthe).toBe(b);
    expect(scene.tiles).toHaveLength(5);
    expect(look(f.tank)).toBeNull();
    f.sim.chat('/dev temple trigger score', f.tank.id);
    tick(f);
    expect(look(f.tank)?.kind).toBe('score-melody');
    expect(look(f.tank)?.line).toBe(t('hudChrome.templeAlert.melodyLine'));
    while (st.score?.phase === 'melody') tick(f);
    const order = [...(st.score?.order ?? [])];
    const answer = look(f.tank);
    expect(answer?.kind).toBe('score-answer');
    expect(answer?.line).toBe(
      t('hudChrome.templeAlert.answerLine', { place: '1', done: '0', total: '3' }),
    );
    // A player standing on the wanted tile is told to step off.
    put(f, f.others[0], st.tiles[order[0]].x, st.tiles[order[0]].z);
    expect(look(f.others[0])?.kind).toBe('score-step-off');
    stepOn(f, st, f.others[0], order[0]);
    expect(look(f.others[0])?.kind).toBe('score-spent');
    expect(look(f.tank)?.line).toBe(
      t('hudChrome.templeAlert.answerLine', { place: '2', done: '1', total: '3' }),
    );
    // A tile out of turn.
    stepOn(f, st, f.others[1], order[2]);
    expect(look(f.tank)?.kind).toBe('score-false');
    run(f, T.scoreSourSeconds + 0.1);
    expect(look(f.tank)?.kind).toBe('score-answer');
    for (let i = 0; i < order.length; i++) stepOn(f, st, f.others[(i + 1) % 2], order[i]);
    const broken = look(f.tank);
    expect(broken?.kind).toBe('score-broken');
    expect(broken?.progress).toBeGreaterThan(0.9);
  });

  it('heroic: the melody says remember, and the answer never names a tile', () => {
    const { f, st, look } = live('heroic');
    f.sim.chat('/dev temple trigger score2', f.tank.id);
    tick(f);
    expect(look(f.tank)?.line).toBe(t('hudChrome.templeAlert.melodyDarkLine'));
    while (st.score?.phase === 'melody') tick(f);
    const order = [...(st.score?.order ?? [])];
    expect(look(f.tank)?.kind).toBe('score-answer-dark');
    // Standing on the first tile of the hidden order gives nothing away.
    put(f, f.others[0], st.tiles[order[0]].x, st.tiles[order[0]].z);
    expect(look(f.others[0])?.kind).toBe('score-answer-dark');
    stepOn(f, st, f.others[0], order[0]);
    expect(look(f.tank)?.line).toBe(
      t('hudChrome.templeAlert.answerDarkLine', { place: '0', done: '1', total: '4' }),
    );
  });
});

describe('the Temple aura tooltips and bar names say the live rule', () => {
  it('the Score ward says she takes no damage and what Discord costs, at both difficulties', () => {
    const d = auraEffectDescriptor({
      id: SELTHE_SCORE_WARD,
      kind: 'buff_dr',
      value: 0,
    } as AuraEffectInput);
    expect(d?.key).toBe('hudChrome.auraEffect.temple.scoreWard');
    const mult =
      HEROIC_DUNGEON_TUNING.drowned_temple?.mechanicDamageMultiplierByMob?.[SELTHE_ID] ?? 1;
    expect(mult).toBeGreaterThan(1);
    expect(d?.nums).toEqual({
      min: T.discordMin,
      max: T.discordMax,
      heroicMin: Math.round(T.discordMin * mult),
      heroicMax: Math.round(T.discordMax * mult),
    });
    const text = t('hudChrome.auraEffect.temple.scoreWard', {
      min: '150',
      max: '170',
      heroicMin: '675',
      heroicMax: '765',
    });
    expect(text).toContain('150 to 170 Frost damage');
    expect(text).toContain('no damage');
  });

  it('the broken voice says the share the damage roll really applies', () => {
    const d = auraEffectDescriptor({
      id: SELTHE_BROKEN_VOICE_EXPOSED,
      kind: 'vulnerability',
      value: T.brokenVuln,
    } as AuraEffectInput);
    expect(d).toEqual({ key: 'hudChrome.auraEffect.temple.brokenVoice', nums: { pct: 20 } });
  });

  it('her two Score bars carry their own names', () => {
    expect(castDisplayName(SELTHE_SCORE)).toBe('The Score');
    expect(castDisplayName(SELTHE_SCORE_ANSWER)).toBe('Answer the Score');
  });
});
