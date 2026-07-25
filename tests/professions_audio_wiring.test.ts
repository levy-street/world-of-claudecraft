// Source-guard for the gatherResult/craftResult/masterwork audio wiring
// (the player_death_audio.test.ts pattern): pins that gathering plays a
// dedicated node-type cue (audio.gather), that a successful craft resolves
// the recipe's professionId to its own ui_craft_<family> cue via
// audio.craftSuccess(), and that a masterwork proc LAYERS audio.masterwork()
// alongside that cue rather than replacing it. Every professions grant also
// suppresses the generic loot ding at the source (Sim.addItem/addItemInstance
// opts.silent, see tests/professions_silent_loot.test.ts) so it never stacks
// with these dedicated cues; the corresponding hud.ts case 'loot' half of
// that contract is pinned below.
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

describe('gather-cast tool-out audio wiring', () => {
  it('plays a node-type-keyed cue on a gather cast start, not the flat fallback', () => {
    // hud.ts has two 'castStart' cases (a spatial cast-loop handler, and this
    // personal-cue one); anchor on GATHER_CAST_ID, unique to the latter.
    const start = hud.indexOf('ev.ability === GATHER_CAST_ID');
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    const body = hud.slice(start, end);
    expect(body).toContain('audio.gatherCast(ev.gatherNodeType)');
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

describe('the generic loot cue respects ev.silent', () => {
  it('skips both audio.coin() and audio.lootItem() when the loot event is silent, but still logs the text', () => {
    const start = hud.indexOf("case 'loot':");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    const body = hud.slice(start, end);
    expect(body).toContain('if (!ev.silent)');
    // The log line (feedback text) must sit OUTSIDE (before) the silent
    // guard, so a professions grant's "You receive:" line still prints even
    // though its audio is suppressed.
    const silentGuardIndex = body.indexOf('if (!ev.silent)');
    const logIndex = body.indexOf('this.log(');
    expect(logIndex).toBeGreaterThan(-1);
    expect(logIndex).toBeLessThan(silentGuardIndex);
  });
});

describe('disenchantResult audio wiring', () => {
  // disenchantItem is called from the bag item action menu
  // (src/ui/bag_item_action_menu.ts); the success (toast.sink === 'log') arm
  // plays audio.disenchant(), a denial (showError) never does.
  it('plays the disenchant cue on a successful disenchant, not on a denial', () => {
    const start = hud.indexOf("case 'disenchantResult':");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    const body = hud.slice(start, end);
    expect(body).toContain("if (toast.sink === 'log') {");
    expect(body).toContain('audio.disenchant();');
    // The disenchant call must sit inside the log (success) arm, before the
    // else (showError/denial) branch.
    expect(body.indexOf('audio.disenchant();')).toBeLessThan(body.indexOf('else'));
  });
});

describe('salvageResult audio wiring', () => {
  // salvageItem is called from the bag item action menu, same shape as
  // disenchantResult above.
  it('plays the salvage cue on a successful salvage, not on a denial', () => {
    const start = hud.indexOf("case 'salvageResult':");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    const body = hud.slice(start, end);
    expect(body).toContain("if (toast.sink === 'log') {");
    expect(body).toContain('audio.salvage();');
    expect(body.indexOf('audio.salvage();')).toBeLessThan(body.indexOf('else'));
  });
});

describe('enchantResult audio wiring', () => {
  // applyEnchant is called from the bag item action menu, same shape as
  // disenchantResult above.
  it('plays the enchant cue on a successful apply-enchant, not on a denial', () => {
    const start = hud.indexOf("case 'enchantResult':");
    expect(start).toBeGreaterThan(-1);
    const end = hud.indexOf('break;', start);
    const body = hud.slice(start, end);
    expect(body).toContain("if (toast.sink === 'log') {");
    expect(body).toContain('audio.enchant();');
    expect(body.indexOf('audio.enchant();')).toBeLessThan(body.indexOf('else'));
  });
});
