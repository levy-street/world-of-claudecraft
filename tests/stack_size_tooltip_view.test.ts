// Max-stack tooltip line: the pure string-builder composed inside
// Hud.itemTooltip (the elixir_tooltip_view.test.ts idiom: English copy
// asserted directly). The number must come from the one stacking rule the
// bags actually enforce (sim/bags.ts stackSizeOf), so the potion pins below
// go through real shipped defs, the whole-catalog biconditional proves the
// line is a pure function of that rule (a kind-restricted reimplementation
// that only served potions would strip 200+ shipped stackables and stay
// green against sampled pins alone), and the unstackable-kind pins prove
// gear never grows a noise line. The line exists for the player who owns
// ONE copy: with no stack badge to learn from, the tooltip is how they find
// out the item stacks at all.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stackSizeOf } from '../src/sim/bags';
import { ITEMS } from '../src/sim/data';
import type { ItemDef } from '../src/sim/types';
import { ensureLocaleLoaded, formatNumber, setLanguage } from '../src/ui/i18n';
import { stackSizeTooltipLine } from '../src/ui/stack_size_tooltip_view';

describe('stackSizeTooltipLine', () => {
  afterEach(() => setLanguage('en'));

  it('a vendor potion states the default 20-per-slot cap', () => {
    expect(stackSizeTooltipLine(ITEMS.minor_healing_potion)).toBe(
      '<div class="tt-sub">Max stack: 20</div>',
    );
  });

  it('every potion and elixir in the item catalog states the same cap', () => {
    // The warlock overhaul's Soul Stone is kind 'potion' with a deliberate
    // authored 3-cap (a class utility, not part of the alchemy ladders), so
    // it is exempt from the shared 20 sweep and pinned separately below.
    const consumables = Object.values(ITEMS).filter(
      (def) => (def.kind === 'potion' || def.kind === 'elixir') && def.id !== 'soul_stone',
    );
    // 16 at authoring time (the vendor ladders, the crafted alchemy ladder,
    // and the combo elixirs); a floor rather than an exact pin so new potion
    // content does not break an unrelated tooltip sweep.
    expect(consumables.length).toBeGreaterThanOrEqual(16);
    for (const def of consumables) {
      expect(stackSizeTooltipLine(def), `${def.id} must state its stack cap`).toBe(
        '<div class="tt-sub">Max stack: 20</div>',
      );
    }
    expect(stackSizeTooltipLine(ITEMS.soul_stone)).toBe('<div class="tt-sub">Max stack: 3</div>');
  });

  it('the line is a biconditional of the real bag rule over the WHOLE catalog', () => {
    // Every shipped def, both directions: anything 1-per-slot (or a mount)
    // renders nothing, everything else renders the exact line carrying its
    // own stackSizeOf value. This is what fails a reimplementation that
    // serves only some stackable kinds; the literal copy pins above keep the
    // shared expected-string honest.
    for (const def of Object.values(ITEMS)) {
      const size = stackSizeOf(def);
      const expected =
        def.kind === 'mount' || size <= 1
          ? ''
          : `<div class="tt-sub">Max stack: ${formatNumber(size, { maximumFractionDigits: 0 })}</div>`;
      expect(stackSizeTooltipLine(def), def.id).toBe(expected);
    }
  });

  it('renders nothing for one id of each UNSTACKED kind, kinds asserted', () => {
    // The kind assertion keeps each probe honest: if a def is ever retyped,
    // the test says so instead of silently losing that kind's coverage.
    // (tool is not uniformly 1-per-slot: heroic_mark below opts back in via
    // explicit stackSize, which is exactly why the kinds are pinned here.)
    const probes: Array<[string, ItemDef['kind']]> = [
      ['worn_sword', 'weapon'],
      ['recruit_tunic', 'armor'],
      ['valefire_lantern', 'held_offhand'],
      ['silkspun_satchel', 'bag'],
      ['riding_training', 'tool'],
    ];
    for (const [id, kind] of probes) {
      const def = ITEMS[id];
      expect(def, `${id} must exist`).toBeDefined();
      expect(def.kind, `${id} must stay kind ${kind}`).toBe(kind);
      expect(stackSizeOf(def), `${id} must be 1-per-slot`).toBe(1);
      expect(stackSizeTooltipLine(def), `${id} must render no line`).toBe('');
    }
  });

  it('a REAL explicit stackSize on an otherwise-unstackable kind states the cap (heroic_mark)', () => {
    // The shipped def where stackSize flips a tool back to stackable; a
    // kind-set reimplementation of the suppression rule drops this line
    // while every kind-default probe stays green.
    expect(ITEMS.heroic_mark.kind).toBe('tool');
    expect(ITEMS.heroic_mark.stackSize).toBe(20);
    expect(stackSizeTooltipLine(ITEMS.heroic_mark)).toBe('<div class="tt-sub">Max stack: 20</div>');
  });

  it('renders nothing for mount reins even though their bag cap is really 20', () => {
    const mounts = Object.values(ITEMS).filter((def) => def.kind === 'mount');
    // 9 at authoring time; floored so new mounts extend the sweep for free.
    expect(mounts.length).toBeGreaterThanOrEqual(9);
    for (const def of mounts) {
      // The cap pin proves the mount GUARD does the suppressing: if it read
      // 1 here, the guard would be dead code and this test vacuous.
      expect(stackSizeOf(def), `${def.id} bag cap`).toBe(20);
      expect(stackSizeTooltipLine(def), `${def.id} must render no line`).toBe('');
    }
  });

  it('an explicit def stackSize wins over the kind default, formatter grouped', () => {
    const probe: ItemDef = { ...ITEMS.minor_healing_potion, stackSize: 1000 };
    expect(stackSizeTooltipLine(probe)).toBe('<div class="tt-sub">Max stack: 1,000</div>');
  });

  it('an explicit stackSize of 1 on a stackable kind also renders nothing', () => {
    const probe: ItemDef = { ...ITEMS.minor_healing_potion, stackSize: 1 };
    expect(stackSizeTooltipLine(probe)).toBe('');
  });

  it('a charge-bearing payload suppresses the line: its slot really holds ONE copy', () => {
    // bags.ts instancedCountCap pins a charge payload to 1 per slot no
    // matter the def cap, so quoting the def cap here would lie.
    expect(stackSizeTooltipLine(ITEMS.minor_healing_potion, { charges: { probe: 3 } })).toBe('');
  });

  it('a mergeable signed payload keeps the line: same-signer copies really stack', () => {
    expect(stackSizeTooltipLine(ITEMS.sunpetal_healing_draught, { signer: 'Adventurer' })).toBe(
      '<div class="tt-sub">Max stack: 20</div>',
    );
  });

  it('the five M16 non-Latin fills resolve through the live t() path', async () => {
    // One probe per required fill so a wrong overlay key path (which would
    // silently show English) goes red. Native punctuation is part of the
    // pin: full-width colons in zh, plain colon plus space elsewhere. The
    // locale tables load lazily, so each probe awaits its table first; a
    // hardcoded-English reimplementation of the view also dies here.
    const fills: Array<[string, string]> = [
      ['zh_CN', '最大堆叠：20'],
      ['zh_TW', '最大堆疊：20'],
      ['ja_JP', 'スタック上限: 20'],
      ['ko_KR', '최대 중첩: 20'],
      ['ru_RU', 'Максимум в стопке: 20'],
    ];
    for (const [locale, text] of fills) {
      const lang = locale as Parameters<typeof setLanguage>[0];
      await ensureLocaleLoaded(lang);
      setLanguage(lang);
      expect(stackSizeTooltipLine(ITEMS.minor_healing_potion), locale).toBe(
        `<div class="tt-sub">${text}</div>`,
      );
    }
  });

  it('the view escapes the localized copy (source pin)', () => {
    // Escaping is unobservable today (every fill is digits plus safe copy),
    // so a behavior pin cannot exist yet; pin the esc() wrap in the source
    // instead, whole-line // comments stripped like the hud pin below, so a
    // future locale fill carrying an apostrophe stays safe.
    const viewSrc = readFileSync(
      path.join(__dirname, '../src/ui/stack_size_tooltip_view.ts'),
      'utf8',
    ).replace(/^\s*\/\/.*$/gm, '');
    expect(viewSrc).toContain('${esc(text)}');
  });

  it('Hud.itemTooltip composes the max-stack line (method-scoped source pin)', () => {
    // Whole-line // comments are stripped before scanning so the pin is not
    // satisfied by prose (the comment-gameable trap; block comments are left
    // alone: a /* strip would misfire on string and regex literals). Scoped
    // to the itemTooltip method body so the call cannot drift into some
    // other surface and still pass.
    const hudSrc = readFileSync(path.join(__dirname, '../src/ui/hud.ts'), 'utf8').replace(
      /^\s*\/\/.*$/gm,
      '',
    );
    const start = hudSrc.indexOf('private itemTooltip(');
    const end = hudSrc.indexOf('private itemProcBlock(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(hudSrc.slice(start, end)).toContain('html += stackSizeTooltipLine(item, instance);');
  });
});
