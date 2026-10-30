// The character sheet's progression-block refresh signature, and the HUD latch
// that consumes it.
//
// The defect this closes (deferred from Phase 19 QA, widened at Phase 20 QA): the
// character sheet is a COLD window absent from the HUD's 2 Hz slow band, and the
// surfaces that move its progression block take no optimistic write, so an
// already-open sheet kept showing PREVIOUS state until it was closed and
// reopened. Three rows had the bug, not one: the Book of Deeds picker repaints
// only itself (the active-title line and the border badge row's "worn" word), and
// a relic fill repaints only the tracker (the Reliquary completion pair and the
// Curator rank).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalogCharacterCompletion, isCataloguedRelicItem } from '../src/sim/reliquary';
import type { Aura } from '../src/sim/types';
import {
  type CharSheetSigWorld,
  charSheetRefreshSig,
  charSheetRefreshSigFor,
} from '../src/ui/char_sheet_sig_core';

const readRaw = (rel: string): string =>
  readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
// LINE comments only, deliberately: the naive block-comment strip these suites
// usually share treats the `/\/\*...\*\//` regex literals inside a test file as an
// open comment and swallows the rest of the file, which would turn every pin
// below into a vacuous pass. Line stripping cannot false-open.
const read = (rel: string): string => readRaw(rel).replace(/(^|[^:])\/\/.*$/gm, '$1');
// The CORE is read with BOTH comment forms stripped. The line-only reader above
// left the core's own JSDoc and header block as live text, so the purity pin
// below was really scanning prose: a doc sentence that happened to mention
// `document` or `Date.now` would have failed it, and (the direction that
// matters) a future doc rewrite could have kept it green while describing what
// the code no longer does. Block stripping is safe HERE and nowhere else in this
// file: the core is 80 lines of JSDoc and one JSON.stringify, with no regex
// literal anywhere for `/*` to false-open on. Asserted, not assumed, below.
const readCore = (rel: string): string =>
  readRaw(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** A full parts object; each test moves exactly ONE field off this baseline. */
const base = {
  activeTitle: 'prog_veteran' as string | null,
  activeBorder: 'deepward' as string | null,
  deedsEarned: 12,
  itemsDiscovered: 40,
  marks: 3,
  mounts: 5,
};

describe('charSheetRefreshSig', () => {
  it('is stable for equal input, so an unchanged pass never repaints', () => {
    expect(charSheetRefreshSig(base)).toBe(charSheetRefreshSig({ ...base }));
    const empty = {
      activeTitle: null,
      activeBorder: null,
      deedsEarned: 0,
      itemsDiscovered: 0,
      marks: 0,
      mounts: 0,
    };
    expect(charSheetRefreshSig(empty)).toBe(charSheetRefreshSig({ ...empty }));
  });

  // Per-field negative cases, one per signed field, not one "something changed"
  // case: a signature that dropped any single field would still pass a combined
  // test. Each case holds the other five fixed, so it names the field it covers.
  it('moves when the worn TITLE changes', () => {
    expect(charSheetRefreshSig(base)).not.toBe(
      charSheetRefreshSig({ ...base, activeTitle: 'prog_champion' }),
    );
  });

  it('moves when the worn BORDER changes', () => {
    expect(charSheetRefreshSig(base)).not.toBe(
      charSheetRefreshSig({ ...base, activeBorder: 'col_reliquary_rank_5' }),
    );
  });

  it('moves when a BORDER DEED is earned (the badge row was stale before)', () => {
    // Earning a border deed with the sheet open repainted nothing until this
    // field joined the signature: the row is built by filtering deedsEarned.
    expect(charSheetRefreshSig(base)).not.toBe(
      charSheetRefreshSig({ ...base, deedsEarned: base.deedsEarned + 1 }),
    );
  });

  it('moves when an ITEM RELIC fills (the Reliquary pair was stale before)', () => {
    expect(charSheetRefreshSig(base)).not.toBe(
      charSheetRefreshSig({ ...base, itemsDiscovered: base.itemsDiscovered + 1 }),
    );
  });

  it('moves when a MARK fills', () => {
    expect(charSheetRefreshSig(base)).not.toBe(
      charSheetRefreshSig({ ...base, marks: base.marks + 1 }),
    );
  });

  it('moves when a MOUNT relic is gained or lost', () => {
    // Mounts are the one signed surface that can shrink (reins sold or banked
    // away), so both directions are covered.
    expect(charSheetRefreshSig(base)).not.toBe(
      charSheetRefreshSig({ ...base, mounts: base.mounts + 1 }),
    );
    expect(charSheetRefreshSig(base)).not.toBe(
      charSheetRefreshSig({ ...base, mounts: base.mounts - 1 }),
    );
  });

  it('distinguishes worn from unworn in BOTH id slots (the take-off edge)', () => {
    // Taking a title or a border OFF is the same staleness bug in reverse; the
    // sheet must converge on the way down too.
    expect(charSheetRefreshSig({ ...base, activeTitle: null })).not.toBe(
      charSheetRefreshSig({ ...base, activeTitle: null, activeBorder: null }),
    );
    expect(charSheetRefreshSig({ ...base, activeBorder: null })).not.toBe(
      charSheetRefreshSig({ ...base, activeTitle: null, activeBorder: null }),
    );
  });

  it('never lets the two ID slots swap into the same signature', () => {
    // A signature that concatenated the ids would read the same for a swapped
    // pair; the fixed slot array is what keeps them distinct.
    expect(
      charSheetRefreshSig({ ...base, activeTitle: 'deepward', activeBorder: 'prog_veteran' }),
    ).not.toBe(
      charSheetRefreshSig({ ...base, activeTitle: 'prog_veteran', activeBorder: 'deepward' }),
    );
  });

  it('never lets two COUNT slots swap into the same signature', () => {
    // Four numeric slots is where a summed or concatenated signature would go
    // wrong: 40 discovered + 3 marks and 3 discovered + 40 marks are different
    // collections that a sum would read as one.
    expect(charSheetRefreshSig({ ...base, itemsDiscovered: 40, marks: 3 })).not.toBe(
      charSheetRefreshSig({ ...base, itemsDiscovered: 3, marks: 40 }),
    );
    expect(charSheetRefreshSig({ ...base, deedsEarned: 12, mounts: 5 })).not.toBe(
      charSheetRefreshSig({ ...base, deedsEarned: 5, mounts: 12 }),
    );
  });

  // The two blind spots the core's own comment names and ACCEPTS. Pinned so a
  // later reader meets the documented behavior as a test rather than as prose,
  // and so a future widening that closes one has to move a pin on purpose.
  it('accepts the cancelling-mount blind spot: a swap inside ONE band is invisible', () => {
    // From the core: "a mount add plus a mount remove inside ONE 500 ms band
    // cancel out, the same documented blind spot the tracker's signature
    // carries". The latch samples at band boundaries only, so selling one set of
    // reins and buying another inside a single band leaves the signed SIZE where
    // it started and the sheet keeps the old row until the next real change.
    const start = charSheetRefreshSig(base);
    // The add on its own really does move it (the control that keeps the
    // equality below from being a comparison of a constant with itself) ...
    expect(charSheetRefreshSig({ ...base, mounts: base.mounts + 1 })).not.toBe(start);
    // ... and the matching removal inside the same band puts it back.
    expect(charSheetRefreshSig({ ...base, mounts: base.mounts + 1 - 1 })).toBe(start);
  });

  it('accepts the non-catalogued discovery blind spot: sig moves, the PAIR does not', () => {
    // Also from the core: "a discovery that is not a catalogued relic moves the
    // signature without moving the pair, which costs one repaint of identical
    // HTML". Driven against the real completion helper, so the claim is about
    // what the sheet would print and not only about the counts.
    expect(isCataloguedRelicItem('cryptbone_helm'), 'fixture: a catalogued relic').toBe(true);
    expect(isCataloguedRelicItem('rusty_dagger'), 'fixture: outside the catalog').toBe(false);
    const discovered = new Set(['cryptbone_helm']);
    const pairBefore = catalogCharacterCompletion({ itemsDiscovered: discovered });
    const sigBefore = charSheetRefreshSig({ ...base, itemsDiscovered: discovered.size });

    discovered.add('rusty_dagger');
    const pairAfter = catalogCharacterCompletion({ itemsDiscovered: discovered });
    const sigAfter = charSheetRefreshSig({ ...base, itemsDiscovered: discovered.size });

    expect(pairAfter, 'the pair the sheet prints must not move').toEqual(pairBefore);
    expect(pairAfter.owned, 'and it is a real pair, not two zeroes').toBe(1);
    expect(sigAfter, 'but the size-based signature does, costing one repaint').not.toBe(sigBefore);
  });

  it('is pure: no DOM, no i18n, no world import', () => {
    const src = readCore('src/ui/char_sheet_sig_core.ts');
    // The stripper is only safe while the core stays regex-free; if a regex
    // literal ever lands there, `/*` inside it could false-open and swallow the
    // rest of the file, making every token check below pass vacuously.
    expect(src, 'the core must stay regex-free for the block stripper to be safe').not.toMatch(
      /=\s*\//,
    );
    expect(src.length, 'block stripping must not have swallowed the file').toBeGreaterThan(200);
    expect(src, 'the stripped core must still contain its one expression').toContain(
      'JSON.stringify',
    );
    for (const token of ['document', 'window', './i18n', 'sim/sim', 'Date.now']) {
      expect(src, `the core must not reach ${token}`).not.toContain(token);
    }
  });

  it('is registered as a pure core in the architecture sweep', () => {
    // Anchored to a whole list line, so a commented-out registration
    // (`// 'src/ui/...'`) cannot satisfy it.
    expect(readRaw('tests/architecture.test.ts')).toMatch(
      /^\s*'src\/ui\/char_sheet_sig_core\.ts',$/m,
    );
  });
});

describe('the latch that converges the open character sheet', () => {
  const hud = read('src/ui/hud.ts');
  const win = read('src/ui/char_window.ts');

  it('reads every signed surface from the world and latches the signature', () => {
    // The latch lives on CharWindow: the window owns its signature, so every
    // paint (open, tab click, language switch) re-latches and the next poll
    // compares equal instead of buying a second rebuild.
    const at = win.indexOf('refreshIfChanged(): void {');
    expect(at, 'CharWindow.refreshIfChanged is missing').toBeGreaterThan(-1);
    const body = win.slice(at, win.indexOf('\n  }\n', at));
    // Closed reads nothing, and an equal signature returns before any paint.
    expect(body).toContain('if (!this.isOpen || this.refreshSig() === this.lastSig) return;');
    expect(body).toContain('this.render();');
    expect(body).not.toContain('/*');
    // The tab-aware form with the clock, fed the window's own tab: the clock is
    // what signs the Reputation countdown's displayed minute, so the union form
    // would freeze it.
    expect(win).toContain("return this.deps.refreshSig?.(this.sidebarTab) ?? '';");
    expect(hud).toContain(
      'refreshSig: (tab) => charSheetRefreshSigFor(this.sim, tab, Date.now()),',
    );
    // Every paint latches what it drew from.
    const renderAt = win.indexOf('  render(): void {');
    expect(win.indexOf('this.lastSig = this.refreshSig();', renderAt)).toBeGreaterThan(renderAt);
    const core = read('src/ui/char_sheet_sig_core.ts');
    const coreAt = core.indexOf('export function charSheetRefreshSigFor(');
    expect(coreAt).toBeGreaterThan(-1);
    const reader = core.slice(coreAt, core.indexOf('export function charSheetRefreshSig(', coreAt));
    // Every field the core signs has to actually be fed from the world, or the
    // widening is cosmetic: a reader that passed a constant would keep the
    // core's own per-field tests green while the sheet stayed stale.
    expect(reader).toContain('activeTitle: world.activeTitle,');
    expect(reader).toContain('activeBorder: world.activeBorder,');
    expect(reader).toContain('deedsEarned: world.deedsEarned.size,');
    expect(reader).toContain('itemsDiscovered: world.deedStats.itemsDiscovered.size,');
    expect(reader).toContain('marks: world.reliquaryMarks.size,');
    expect(reader).toContain('mounts: world.ownedMounts().length,');
    expect(reader).toContain(
      'accountEntries: world.reliquaryAccountFinds.size + world.accountDeeds.size,',
    );
  });

  it('rides the 2 Hz slow band beside its profession sibling', () => {
    expect(hud).toContain('if (slowHud) this.charWindow.refreshIfChanged();');
    // Adjacency to the sibling is the design claim (same band, same cadence),
    // so pin the order rather than mere presence.
    const sibling = hud.indexOf('if (slowHud) this.refreshOpenProfessionSurfacesIfChanged();');
    const mine = hud.indexOf('if (slowHud) this.charWindow.refreshIfChanged();');
    expect(sibling).toBeGreaterThan(-1);
    expect(mine).toBeGreaterThan(sibling);
  });

  it('takes NO optimistic write: the picker still repaints only itself', () => {
    // Both hosts converge through the signature instead (offline the sim setter
    // is synchronous, online the atitle/aborder echo lands inside one band), so
    // the deeds picker must not have grown a charWindow repaint of its own.
    const picker = read('src/ui/deeds_window.ts');
    // Positive control, added at Phase 20 QA: `charWindow` is a token that never
    // appeared in this file, so on its own the negative below is a dead
    // alternate that would stay green over an empty read or a mistyped path.
    // The picker's OWN repaint is what proves the read reached the right source.
    expect(picker, 'the picker must repaint itself').toContain('this.render()');
    expect(picker).not.toContain('charWindow');
  });

  it('the sheet rebuild is a FULL render, so every progression row comes back fresh', () => {
    // The bug spans the whole block (the border badge's worn word, the active
    // title line, the Reliquary pair and rank); a partial repaint would fix one
    // and leave the others. The window's renderIfOpen delegates to the
    // whole-sheet render.
    const win = read('src/ui/char_window.ts');
    const at = win.indexOf('renderIfOpen()');
    expect(at).toBeGreaterThan(-1);
    expect(win.slice(at, at + 160)).toContain('this.render()');
    // And every signed row is painted from the same progression block the HUD
    // builds, which is what makes ONE signature the right shape for all of them.
    // The progression block moved out of the hud.ts coordinator into the pure
    // view module (the monolith-ratchet payment); the pin follows the code.
    const view = read('src/ui/character_progression_view.ts');
    const progression = view.slice(
      view.indexOf('export function progressionHtml(sim: IWorld, level: number): string {'),
    );
    const body = progression.slice(0, 2600);
    expect(body).toContain('sim.activeBorder');
    expect(body).toContain('sim.activeTitle');
    // Account-wide: the border row reads the union of the character's own
    // earns and the account ledger (src/sim/account_ledger.ts).
    expect(body).toContain('accountDeedLookup(sim.deedsEarned, { deeds: sim.accountDeeds })');
    expect(body).toContain('earnedBorders.has(id)');
    expect(body).toContain('reliquarySheetProgressionHtml(buildReliquarySheetModel(sim))');
  });
});

// The widened signature (the "separate decision" the first header deferred, now
// made): every board the sheet paints, signed off the RAW inputs. Each case below
// moves exactly ONE input off a full fake world, so a signature that dropped any
// single input fails the case that names it.
describe('charSheetRefreshSigFor: the whole sheet', () => {
  function fakeWorld(): CharSheetSigWorld {
    return {
      activeTitle: 'prog_veteran',
      activeBorder: null,
      deedsEarned: new Set(['a']),
      deedStats: { itemsDiscovered: new Set(['x']) },
      reliquaryMarks: new Set(),
      ownedMounts: () => [],
      reliquaryAccountFinds: new Set(),
      accountDeeds: new Set(),
      player: {
        name: 'Aurelia',
        level: 20,
        skin: 0,
        stats: {
          str: 50,
          agi: 30,
          sta: 40,
          int: 20,
          spi: 25,
          armor: 900,
          pvpOffense: 0,
          pvpDefense: 0,
          pvpVitality: 0,
        },
        attackPower: 140,
        spellPower: 0,
        healPower: 0,
        critChance: 0.05,
        dodgeChance: 0.04,
        critRating: 0,
        hasteRating: 0,
        hitRating: 0,
        auras: [],
        sharedCritBonus: 0,
      },
      equipment: { mainhand: 'rusty_dagger' },
      talentSpec: 'arms',
      archetypeTitle: null,
      hobbyCraft: null,
      honor: 10,
      lifetimeHonor: 30,
      heroicMarks: 2,
      delveMarks: 1,
      factions: { rift_watch: 100, church_order: 0, automatons: 0 },
      factionCurrencies: { rift_watch: 3, church_order: 0, automatons: 0 },
      worldQuestLog: new Map(),
      worldQuestExpiresAtMs: 10 * 60_000,
      lifetimeXp: 12_345,
      prestigeRank: 0,
      unlockedMilestones: [],
      playtimeSeconds: 3_600,
    };
  }

  const moves = (
    mutate: (w: CharSheetSigWorld) => void,
    tab?: Parameters<typeof charSheetRefreshSigFor>[1],
    nowMs?: number,
  ): boolean => {
    const w = fakeWorld();
    const before = charSheetRefreshSigFor(w, tab, nowMs);
    mutate(w);
    return charSheetRefreshSigFor(w, tab, nowMs) !== before;
  };

  it('is stable for an unchanged world (a repeated poll never repaints)', () => {
    const w = fakeWorld();
    expect(charSheetRefreshSigFor(w)).toBe(charSheetRefreshSigFor(w));
    expect(charSheetRefreshSigFor(w, 'reputation', 1_000)).toBe(
      charSheetRefreshSigFor(w, 'reputation', 1_000),
    );
  });

  it('still moves for the original deeds and Reliquary terms', () => {
    expect(moves((w) => (w.activeTitle = null))).toBe(true);
    expect(moves((w) => (w.activeBorder = 'deepward'))).toBe(true);
    expect(moves((w) => (w.deedsEarned = new Set(['a', 'b'])))).toBe(true);
    expect(moves((w) => (w.ownedMounts = () => ['m']))).toBe(true);
  });

  it.each([
    ['player name (a rename)', (w: CharSheetSigWorld) => (w.player.name = 'Aurelian')],
    ['level up', (w: CharSheetSigWorld) => (w.player.level = 21)],
    ['portrait skin', (w: CharSheetSigWorld) => (w.player.skin = 2)],
    ['archetype title', (w: CharSheetSigWorld) => (w.archetypeTitle = 'smith_miner')],
    ['hobby craft', (w: CharSheetSigWorld) => (w.hobbyCraft = 'cooking')],
    ['honor balance in the header', (w: CharSheetSigWorld) => (w.honor = 11)],
    ['worn equipment', (w: CharSheetSigWorld) => (w.equipment = { mainhand: 'other_blade' })],
  ])('moves on the always-shown header and paperdoll: %s', (_name, mutate) => {
    // On every tab, including a narrowed one that is not the stats board.
    expect(moves(mutate)).toBe(true);
    expect(moves(mutate, 'currencies')).toBe(true);
  });

  it.each([
    ['strength (a buff or proc)', (w: CharSheetSigWorld) => (w.player.stats.str = 55)],
    ['agility', (w: CharSheetSigWorld) => (w.player.stats.agi = 35)],
    ['stamina', (w: CharSheetSigWorld) => (w.player.stats.sta = 45)],
    ['intellect', (w: CharSheetSigWorld) => (w.player.stats.int = 25)],
    ['spirit', (w: CharSheetSigWorld) => (w.player.stats.spi = 30)],
    ['armor', (w: CharSheetSigWorld) => (w.player.stats.armor = 950)],
    ['warfare offense', (w: CharSheetSigWorld) => (w.player.stats.pvpOffense = 0.012)],
    ['warfare defense', (w: CharSheetSigWorld) => (w.player.stats.pvpDefense = 0.012)],
    ['warfare vitality', (w: CharSheetSigWorld) => (w.player.stats.pvpVitality = 0.012)],
    ['attack power', (w: CharSheetSigWorld) => (w.player.attackPower = 175)],
    ['spell power', (w: CharSheetSigWorld) => (w.player.spellPower = 10)],
    ['heal power', (w: CharSheetSigWorld) => (w.player.healPower = 10)],
    ['crit chance', (w: CharSheetSigWorld) => (w.player.critChance = 0.06)],
    ['dodge chance', (w: CharSheetSigWorld) => (w.player.dodgeChance = 0.041)],
    ['crit rating', (w: CharSheetSigWorld) => (w.player.critRating = 5)],
    ['haste rating', (w: CharSheetSigWorld) => (w.player.hasteRating = 5)],
    ['hit rating', (w: CharSheetSigWorld) => (w.player.hitRating = 5)],
    ['shared crit bonus', (w: CharSheetSigWorld) => (w.player.sharedCritBonus = 0.01)],
    ['talent spec', (w: CharSheetSigWorld) => (w.talentSpec = 'fury')],
  ])('moves on the stat boards: %s', (_name, mutate) => {
    expect(moves(mutate)).toBe(true);
    expect(moves(mutate, 'stats')).toBe(true);
  });

  it('does NOT move on aura churn that moves no displayed number', () => {
    // The sheet draws no aura: a mob DoT landing, a debuff stacking, or a timer
    // ticking must not rebuild it in combat.
    const w = fakeWorld();
    const aura = (id: string, kind: string, value: number, remaining: number) =>
      ({ id, kind, value, remaining }) as unknown as Aura;
    w.player.auras = [aura('renew', 'hot', 30, 12)];
    const before = charSheetRefreshSigFor(w, 'stats');
    w.player.auras = [aura('renew', 'hot', 30, 11.5), aura('rend', 'dot', 9, 6)];
    expect(charSheetRefreshSigFor(w, 'stats')).toBe(before);
    w.player.auras = [];
    expect(charSheetRefreshSigFor(w, 'stats')).toBe(before);
    // Control: the buff's effect on a shown number does move it.
    w.player.attackPower += 55;
    expect(charSheetRefreshSigFor(w, 'stats')).not.toBe(before);
  });

  it('moves on a spell crit aura (the Spell Crit cell adds it at paint time), not on its timer', () => {
    const w = fakeWorld();
    const aura = (kind: string, value: number, remaining: number, value2?: number) =>
      ({ id: kind, kind, value, value2, remaining }) as unknown as Aura;
    const before = charSheetRefreshSigFor(w, 'stats');
    w.player.auras = [aura('buff_spellcrit', 0.05, 30)];
    const buffed = charSheetRefreshSigFor(w, 'stats');
    expect(buffed).not.toBe(before);
    w.player.auras = [aura('buff_spellcrit', 0.05, 29.5)];
    expect(charSheetRefreshSigFor(w, 'stats')).toBe(buffed);
    // Sacred form's spell crit rides value2, so it signs too.
    w.player.auras = [aura('sacred_form', 0, 60, 0.08)];
    expect(charSheetRefreshSigFor(w, 'stats')).not.toBe(before);
    // Off the Stats tab the cell is not on screen, so the aura is not signed.
    w.player.auras = [];
    const rep = charSheetRefreshSigFor(w, 'reputation');
    w.player.auras = [aura('buff_spellcrit', 0.05, 30)];
    expect(charSheetRefreshSigFor(w, 'reputation')).toBe(rep);
  });

  it('signs the stat boards only where they show', () => {
    const w = fakeWorld();
    const before = charSheetRefreshSigFor(w, 'reputation');
    w.player.attackPower += 55;
    w.talentSpec = 'fury';
    expect(charSheetRefreshSigFor(w, 'reputation')).toBe(before);
  });

  it('does NOT move for a sub-display stat wobble', () => {
    expect(moves((w) => (w.player.attackPower = 140.0001))).toBe(false);
    expect(moves((w) => (w.player.critChance = 0.0500001))).toBe(false);
  });

  it.each([
    [
      'faction standing',
      (w: CharSheetSigWorld) => (w.factions = { ...w.factions, rift_watch: 150 }),
    ],
    [
      'a world quest completed',
      (w: CharSheetSigWorld) =>
        (w.worldQuestLog = new Map([['wq1', { state: 'completed' } as never]])),
    ],
    [
      // worldQuestLog.size alone: the done count stays 0, only the size moves.
      'a new world quest taken (not completed)',
      (w: CharSheetSigWorld) =>
        (w.worldQuestLog = new Map([['wq1', { state: 'active' } as never]])),
    ],
  ])('moves on the Reputation board: %s', (_name, mutate) => {
    expect(moves(mutate)).toBe(true);
    expect(moves(mutate, 'reputation')).toBe(true);
    // Narrowed to another board, the hidden tab's move costs no repaint.
    expect(moves(mutate, 'stats')).toBe(false);
  });

  it('signs the Reputation reset countdown by its displayed minute, only with a clock', () => {
    const w = fakeWorld();
    const at = (now: number) => charSheetRefreshSigFor(w, 'reputation', now);
    // The countdown rounds UP to whole minutes: 10:00 left and 9:30 left both
    // print "10 minutes", so polls inside that minute compare equal ...
    expect(at(0)).toBe(at(30_000));
    // ... and crossing into the next displayed minute (9:00 left) moves it.
    expect(at(60_000)).not.toBe(at(30_000));
    // Past the deadline the countdown reads its unknown face; still signed.
    expect(at(11 * 60_000)).not.toBe(at(60_000));
    // Without a clock, no countdown term: the union form stays clock-free.
    expect(charSheetRefreshSigFor(w)).toBe(charSheetRefreshSigFor(w));
  });

  it.each([
    ['heroic marks', (w: CharSheetSigWorld) => (w.heroicMarks = 3)],
    ['lifetime honor', (w: CharSheetSigWorld) => (w.lifetimeHonor = 31)],
    ['delve marks', (w: CharSheetSigWorld) => (w.delveMarks = 2)],
    [
      'a faction currency',
      (w: CharSheetSigWorld) => (w.factionCurrencies = { ...w.factionCurrencies, automatons: 1 }),
    ],
  ])('moves on the Currencies board: %s', (_name, mutate) => {
    expect(moves(mutate)).toBe(true);
    expect(moves(mutate, 'currencies')).toBe(true);
    expect(moves(mutate, 'progression')).toBe(false);
  });

  it.each([
    ['total XP (and so the virtual level)', (w: CharSheetSigWorld) => (w.lifetimeXp = 12_400)],
    ['prestige rank', (w: CharSheetSigWorld) => (w.prestigeRank = 1)],
    ['a milestone unlock', (w: CharSheetSigWorld) => (w.unlockedMilestones = ['m1'])],
    ['the Time Played minute', (w: CharSheetSigWorld) => (w.playtimeSeconds = 3_660)],
  ])('moves on the Progression board: %s', (_name, mutate) => {
    expect(moves(mutate)).toBe(true);
    expect(moves(mutate, 'progression')).toBe(true);
    expect(moves(mutate, 'reputation', 0)).toBe(false);
  });

  it('does NOT move inside one Time Played minute', () => {
    expect(moves((w) => (w.playtimeSeconds = 3_659), 'progression')).toBe(false);
  });
});
