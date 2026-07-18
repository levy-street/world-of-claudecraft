// Source-guard for the gatherResult/craftResult/masterwork audio wiring
// (the player_death_audio.test.ts pattern): pins that gathering plays a real
// cue (previously it was completely silent, despite the gatherResult sim
// event being built specifically for this, see src/sim/professions/gathering.ts),
// that a successful craft resolves the recipe's professionId to its own
// ui_craft_<family> cue via audio.craftSuccess(), and that a masterwork proc
// LAYERS audio.masterwork() alongside that cue rather than replacing it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const hud = readFileSync(join(__dirname, '../src/ui/hud.ts'), 'utf8');

describe('gatherResult audio wiring', () => {
  it('plays a gather cue keyed off the node type, not silence', () => {
    const start = hud.indexOf("case 'gatherResult':");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    const body = hud.slice(start, end);
    expect(body).toContain('audio.gather(ev.nodeType)');
  });
});

describe('craftResult audio wiring', () => {
  it('resolves the recipe to its craft family instead of always playing the loot ding', () => {
    const start = hud.indexOf("case 'craftResult':");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf("case 'lootRoll'", start);
    const body = hud.slice(start, end);
    expect(body).toContain('audio.craftSuccess(');
    expect(body).not.toContain('audio.lootItem()');
  });

  it('layers the masterwork sting alongside the family cue, gated on ev.masterwork', () => {
    const start = hud.indexOf("case 'craftResult':");
    const end = hud.indexOf("case 'lootRoll'", start);
    const body = hud.slice(start, end);
    expect(body).toContain('if (ev.masterwork) audio.masterwork();');
    // The masterwork call must come strictly after the craftSuccess call, so
    // it layers on top rather than replacing it.
    expect(body.indexOf('audio.craftSuccess(')).toBeLessThan(body.indexOf('audio.masterwork();'));
  });
});

describe('disenchantResult audio wiring', () => {
  // No client UI calls disenchantItem() yet (as of 2026-07-18: the sim event/
  // IWorld/wire plumbing landed ahead of a UI trigger), but the sound is
  // wired and ready the moment one exists.
  it('plays the disenchant cue on a successful disenchant, not on a denial', () => {
    const start = hud.indexOf("case 'disenchantResult':");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    const body = hud.slice(start, end);
    expect(body).toContain('if (ev.ok) audio.disenchant();');
  });
});
