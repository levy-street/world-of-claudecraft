import { describe, expect, it } from 'vitest';
import { objectDisplayName } from '../src/render/entity_labels';
import {
  createForgeWorkshop,
  FORGE_HEAT_FLOOR,
  forgeNeedleAt,
} from '../src/sim/minigames/forge_workshop';
import type { Entity, WorldQuestProgress } from '../src/sim/types';
import { entityDisplayName } from '../src/ui/entity_display_core';
import {
  createForgeActionBarView,
  forgeInstructionLines,
  forgeMeterView,
  forgeObjectLabel,
  forgeSpeechText,
} from '../src/ui/world_quest_forge_view';

function progress(): WorldQuestProgress {
  return {
    questId: 'wq_evergarden_forging',
    state: 'active',
    count: 0,
    forging: createForgeWorkshop(42, 100),
  };
}

function session(p: WorldQuestProgress) {
  if (!p.forging) throw new Error('Missing forge fixture');
  return p.forging;
}

describe('forge workshop instructions', () => {
  it('starts a three-second countdown even when the authoritative realm has been running for hours', () => {
    const p = progress();
    p.forging = createForgeWorkshop(42, 36000);
    expect(forgeSpeechText(p)).toBe('Ready your hands! Starting in 3s.');
    // The wire carries this clock inside the owner session. No assumed IWorld
    // implementation property or browser frame clock enters the projection.
    expect(forgeInstructionLines(structuredClone(p))).toEqual(forgeInstructionLines(p));
  });

  it('coaches the needle once working, and calls for a stoke when the forge runs cold', () => {
    const p = progress();
    expect(forgeSpeechText(p)).toBe('Ready your hands! Starting in 3s.');
    session(p).observedAt = 101;
    expect(forgeSpeechText(p)).toBe('Ready your hands! Starting in 2s.');
    session(p).phase = 'working';
    session(p).observedAt = 103;
    expect(forgeSpeechText(p)).toBe('Watch the needle. Strike inside the dark band!');
    session(p).feedback = 'hit';
    expect(forgeSpeechText(p)).toBe('Clean blow! The band narrows.');
    session(p).feedback = 'miss';
    expect(forgeSpeechText(p)).toBe('Missed the band! +3s.');
    session(p).heat = FORGE_HEAT_FLOOR - 5;
    session(p).heatAt = 103;
    expect(forgeSpeechText(p)).toBe('The forge is cooling! Stoke the fire before you strike.');
  });

  it('tracks strikes, heat and mistakes while working, and hides thresholds until a finish', () => {
    const p = progress();
    session(p).phase = 'working';
    session(p).observedAt = 110;
    session(p).strikes = 4;
    session(p).mistakes = 2;
    session(p).heat = 90;
    session(p).heatAt = 110;
    const before = structuredClone(p);
    const lines = forgeInstructionLines(p);
    expect(lines[0]).toBe('Strikes: 4/10');
    expect(lines[1]).toBe('Forge heat: 90% (keep above 70%)');
    expect(lines[2]).toBe('Mistakes: 2');
    expect(lines.join(' ')).not.toContain('Gold');
    expect(p).toEqual(before);
  });

  it('shows the latest practice result rather than a saved better score', () => {
    const p = progress();
    p.state = 'completed';
    p.forgeResult = { elapsed: 20, mistakes: 0, adjustedTime: 20, rating: 'gold' };
    session(p).phase = 'success';
    session(p).strikes = 10;
    session(p).result = { elapsed: 50, mistakes: 3, adjustedTime: 59, rating: 'silver' };
    const lines = forgeInstructionLines(p);
    expect(lines[0]).toBe('Silver! 59s. Mistakes: 3.');
    expect(lines[1]).toBe('Gold: 40s or less. Silver: 60s or less.');
    delete p.forging;
    expect(forgeInstructionLines(p)[0]).toBe('Gold! 20s. Mistakes: 0.');
  });

  it('projects the meter from the authoritative clock: needle, band, heat and warmth', () => {
    const p = progress();
    const s = session(p);
    const idle = forgeMeterView(s, 101);
    expect(idle.working).toBe(false);
    expect(idle.needle).toBe(0);
    expect(idle.heat).toBe(100);
    s.phase = 'working';
    const t = s.readyAt + 1.2;
    const live = forgeMeterView(s, t);
    expect(live.working).toBe(true);
    expect(live.needle).toBeCloseTo(forgeNeedleAt(s, t), 9);
    expect(live.bandStart).toBeCloseTo(s.band - s.bandHalf, 9);
    expect(live.bandEnd).toBeCloseTo(s.band + s.bandHalf, 9);
    expect(live.inBand).toBe(Math.abs(live.needle - s.band) <= s.bandHalf);
    expect(live.heat).toBeCloseTo(100 - 7 * 1.2, 6);
    expect(live.warm).toBe(true);
    s.heat = 60;
    s.heatAt = t;
    expect(forgeMeterView(s, t).warm).toBe(false);
  });

  it('paints Strike and Stoke as two slots usable only while working', () => {
    const p = progress();
    const s = session(p);
    const view = createForgeActionBarView();
    const idle = view.tick(s, 101, (slot) => String(slot + 1));
    expect(idle.slots.map((slot) => slot.abilityId)).toEqual(['forge_strike', 'forge_stoke']);
    expect(idle.slots.map((slot) => slot.keybindLabel)).toEqual(['1', '2']);
    expect(idle.slots.map((slot) => slot.usable)).toEqual([false, false]);
    s.phase = 'working';
    const live = view.tick(s, s.readyAt + 0.5, (slot) => String(slot + 1));
    expect(live).toBe(idle);
    expect(live.slots.map((slot) => slot.usable)).toEqual([true, true]);
    s.stokeReadyAt = s.readyAt + 2;
    expect(view.tick(s, s.readyAt + 0.5, () => '').slots[1].usable).toBe(false);
    expect(view.tick(s, s.readyAt + 0.5, () => '').slots[1].cdText).toBe('2');
  });

  it('labels the four world click targets without relabeling unrelated objects', () => {
    expect(forgeObjectLabel('forge_fuel')).toBe('Woodpile');
    expect(forgeObjectLabel('forge_tools')).toBe('Anvil');
    expect(forgeObjectLabel('leyline_cache')).toBeNull();
    const anvil = {
      kind: 'object',
      templateId: 'ground_forge_tools',
      objectItemId: 'forge_tools',
    } as Entity;
    expect(entityDisplayName(anvil)).toBe('Anvil');
    expect(objectDisplayName(anvil)).toBe('Anvil');
  });
});
