// The Studio-merge sim lines re-localize on the client: the Tidehold deed
// refusals (src/sim/plots.ts buyPlot) and the authored-map flag rehearsal's
// announcements and flag names (src/sim/social/map_objectives_run.ts). Every
// line is harvested from the REAL sim path, then run through the real client
// matchers, so a rewording on either side fails here and not in a player's log.
//
// The S3 drift guard (tests/localization_fixes.test.ts) proves each literal is
// registered; this file proves the localized output, in English and in a locale
// that already carries the battleground flag-log fills the rehearsal reuses.

import { afterEach, describe, expect, it } from 'vitest';
import { customMapToWorldContent } from '../src/editor/custom_map';
import { thornhollowMap } from '../src/editor/shipped_thornhollow';
import { setActiveWorldContent } from '../src/sim/data';
import { RING_PLOT_DEEDS } from '../src/sim/deepglass/citadel_ring';
import { buildDeepglassWorld } from '../src/sim/deepglass/world';
import { plotSignEntityId } from '../src/sim/plots';
import { Sim } from '../src/sim/sim';
import { mapObjectiveFlagAction, objectiveRun } from '../src/sim/social/map_objectives_run';
import type { Entity, SimEvent } from '../src/sim/types';
import { entityDisplayName } from '../src/ui/entity_display_core';
import { type ErrorTextLockoutDeps, localizeErrorText } from '../src/ui/error_text_i18n_core';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import { localizeSimText } from '../src/ui/sim_i18n';

const deps: ErrorTextLockoutDeps = {
  raidLockouts: () => [],
  formatLockoutDuration: (ms) => `<${ms}ms>`,
};

afterEach(() => {
  setLanguage('en');
  setActiveWorldContent(null);
});

function errors(sim: Sim): string[] {
  return sim
    .drainEvents()
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error')
    .map((e) => e.text);
}

describe('Tidehold deed refusals', () => {
  function plotSim() {
    setActiveWorldContent(buildDeepglassWorld());
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      devCommands: true,
      world: buildDeepglassWorld(),
    });
    const sign = sim.entities.get(plotSignEntityId(0)) as Entity;
    const p = sim.entities.get(sim.primaryId) as Entity;
    p.pos = { x: sign.pos.x + 1.5, y: sign.pos.y, z: sign.pos.z };
    sim.drainEvents();
    const meta = sim.meta(sim.primaryId);
    if (!meta) throw new Error('no player meta');
    return { sim, sign, meta };
  }

  it('emits the three refusals the client matcher resolves to their keys', () => {
    const { sim, sign, meta } = plotSim();
    const deed = RING_PLOT_DEEDS[0];

    expect(sim.buyPlot(deed.id)).toBe(false);
    const [poor] = errors(sim);
    expect(poor).toBe("You can't afford this plot.");
    expect(localizeErrorText(poor, deps)).toBe(t('hudChrome.plotSign.errCannotAfford'));

    meta.copper = deed.priceCopper * 2;
    expect(sim.buyPlot(deed.id)).toBe(true);
    sim.drainEvents();
    expect(sim.buyPlot(deed.id)).toBe(false);
    const [held] = errors(sim);
    expect(held).toBe('You already hold this deed.');
    expect(localizeErrorText(held, deps)).toBe(t('hudChrome.plotSign.errAlreadyHeld'));

    // Another character holds it: the sign carries their name.
    meta.ownedPlots = [];
    sign.plotOwner = { characterId: 987_654, name: 'Wren' };
    expect(sim.buyPlot(deed.id)).toBe(false);
    const [other] = errors(sim);
    expect(other).toBe('Wren holds this deed.');
    expect(localizeErrorText(other, deps)).toBe(
      t('hudChrome.plotSign.errHeldBy', { name: 'Wren' }),
    );
    expect(t('hudChrome.plotSign.errHeldBy', { name: 'Wren' })).toBe('Wren holds this deed.');
  });

  it('refuses a deed whose reserved sign id holds something that is not a plot sign', () => {
    const { sim, sign, meta } = plotSim();
    const deed = RING_PLOT_DEEDS[0];
    meta.copper = deed.priceCopper + 5;
    sign.templateId = 'not_a_plot_sign';
    expect(sim.buyPlot(deed.id)).toBe(false);
    expect(meta.copper).toBe(deed.priceCopper + 5);
    expect(meta.ownedPlots ?? []).toEqual([]);
    expect(sign.plotOwner ?? null).toBeNull();
    expect(sim.drainEvents().some((e) => e.type === 'plotSign')).toBe(false);
  });
});

describe('authored-map flag rehearsal text', () => {
  const map = thornhollowMap('Thornhollow', 'obj_i18n_test', 1);
  const world = customMapToWorldContent(map);

  function place(ctx: Sim['ctx'], e: Entity, x: number, z: number): void {
    e.pos = ctx.groundPos(x, z);
    e.prevPos = { ...e.pos };
    ctx.rebucket(e);
  }

  /** Drive a take, a drop, the clock's return, a touch return and a capture,
   *  and collect every log line the rehearsal sent the watching player. */
  function rehearse(): { lines: string[]; flagEntities: Entity[] } {
    setActiveWorldContent(world);
    const sim = new Sim({ seed: map.meta.seed, playerClass: 'warrior', noPlayer: true, world });
    const ctx = sim.ctx;
    const runnerPid = sim.addPlayer('warrior', 'Maker');
    const watcherPid = sim.addPlayer('warrior', 'Watcher');
    const runner = ctx.entities.get(runnerPid) as Entity;
    const watcher = ctx.entities.get(watcherPid) as Entity;
    place(ctx, runner, 0, -150); // Crimson end
    place(ctx, watcher, 0, 150); // Azure end
    sim.tick();
    const run = objectiveRun(ctx);
    if (!run) throw new Error('no run');
    const lines: string[] = [];
    // Sim.tick() hands back the tick's events, so every tick is collected.
    const tick = () => {
      for (const e of sim.tick()) if (e.type === 'log' && e.pid === watcherPid) lines.push(e.text);
    };
    // Take Azure's flag, then die with it: dropped, then home on the clock.
    place(ctx, runner, 0, 167);
    mapObjectiveFlagAction(ctx, runner.id);
    tick();
    place(ctx, runner, 0, 40);
    tick();
    runner.dead = true;
    tick();
    for (let i = 0; i < 21 * 20; i++) tick();
    // Azure's own runner returns it by touch.
    run.flags[1].state = 'dropped';
    run.flags[1].dropTimer = 20;
    run.flags[1].pos = ctx.groundPos(0, 20);
    place(ctx, watcher, 0, 20);
    tick();
    // Revive the runner and capture.
    runner.dead = false;
    runner.hp = runner.maxHp;
    place(ctx, watcher, 0, 150);
    place(ctx, runner, 0, 167);
    mapObjectiveFlagAction(ctx, runner.id);
    tick();
    place(ctx, runner, 0, -167);
    tick();
    const flagEntities = run.flags.map((f) => ctx.entities.get(f.entityId) as Entity);
    return { lines, flagEntities };
  }

  it('says the five flag calls in the battleground voice and resolves every one', async () => {
    const { lines, flagEntities } = rehearse();
    expect(lines).toEqual([
      'Maker has taken the Azure flag!',
      'Maker dropped the Azure flag.',
      'The Azure flag was returned.',
      'Watcher returned the Azure flag.',
      'Maker has taken the Azure flag!',
      'Maker captured the Azure flag. Score 1:0.',
    ]);
    // English: each line resolves through a rule, to itself.
    for (const line of lines) expect(localizeSimText(line)).toBe(line);

    await ensureLocaleLoaded('de_DE');
    setLanguage('de_DE');
    const azure = t('hudChrome.bg.azure');
    expect(azure).not.toBe('Azure');
    expect(localizeSimText(lines[0])).toBe(
      t('hudChrome.bg.flagTakenLog', { name: 'Maker', team: azure }),
    );
    expect(localizeSimText(lines[1])).toBe(
      t('hudChrome.bg.flagDroppedByLog', { name: 'Maker', team: azure }),
    );
    expect(localizeSimText(lines[2])).toBe(t('hudChrome.bg.flagReturnedLog', { team: azure }));
    expect(localizeSimText(lines[3])).toBe(
      t('hudChrome.bg.flagReturnedByLog', { name: 'Watcher', team: azure }),
    );
    expect(localizeSimText(lines[5])).toBe(
      t('hudChrome.bg.capturedLog', { name: 'Maker', team: azure, crimson: '1', azure: '0' }),
    );
    // The three reused battleground keys already carry their German fill.
    for (const i of [0, 2, 5]) expect(localizeSimText(lines[i])).not.toBe(lines[i]);

    // The flag objects name their side through the entity-name path.
    expect(flagEntities.map((e) => e.name)).toEqual(['Crimson Flag', 'Azure Flag']);
    expect(flagEntities.map(entityDisplayName)).toEqual([
      t('hudChrome.bg.flagNameCrimson'),
      t('hudChrome.bg.flagNameAzure'),
    ]);
    setLanguage('en');
    expect(flagEntities.map(entityDisplayName)).toEqual(['Crimson Flag', 'Azure Flag']);
  });

  it('leaves a non-flag object, and an unknown side, on its wire name', () => {
    const base = { kind: 'object', templateId: 'bg_flag', name: 'Violet Flag' } as Entity;
    expect(entityDisplayName(base)).toBe('Violet Flag');
    const notFlag = { ...base, templateId: 'some_prop', name: 'Crimson Flag' } as Entity;
    expect(entityDisplayName(notFlag)).toBe('Crimson Flag');
  });
});
