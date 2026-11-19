// Combat Text Colors (Interface > Combat): the colour-slot model, its storage parse, the
// publish step, and the contracts that tie it to hud.css (one gated override rule per
// slot), tokens.css (each Default swatch is the colour the vivid look really draws), the
// English catalog (one label per slot), and the options window wiring.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyFctColors,
  FCT_COLOR_DEFAULTS,
  FCT_COLOR_SLOTS,
  FCT_COLORS_STORE_KEY,
  type FctColorTarget,
  fctColorClass,
  fctColorVar,
  parseFctColors,
  serializeFctColors,
} from '../src/ui/fct_colors';

const hudCss = readFileSync('src/styles/hud.css', 'utf8');
const tokensCss = readFileSync('src/styles/tokens.css', 'utf8');

function fakeDoc() {
  const vars = new Map<string, string>();
  const classes = new Set<string>();
  const doc: FctColorTarget = {
    documentElement: {
      style: {
        setProperty: (n, v) => void vars.set(n, v),
        removeProperty: (n) => void vars.delete(n),
      },
    },
    body: {
      classList: {
        toggle: (token, force) => {
          if (force) classes.add(token);
          else classes.delete(token);
          return !!force;
        },
      },
    },
  };
  return { doc, vars, classes };
}

describe('fct colour slots', () => {
  it('names a CSS variable and a body class per slot, in kebab case', () => {
    expect(fctColorVar('white')).toBe('--fct-user-white');
    expect(fctColorVar('abilityCrit')).toBe('--fct-user-ability-crit');
    expect(fctColorClass('hotCrit')).toBe('fct-c-hot-crit');
    expect(new Set(FCT_COLOR_SLOTS.map(fctColorClass)).size).toBe(FCT_COLOR_SLOTS.length);
  });

  it('covers the asked-for rows plus the missing kinds', () => {
    expect([...FCT_COLOR_SLOTS]).toEqual([
      'white',
      'whiteCrit',
      'ability',
      'abilityCrit',
      'dot',
      'dotCrit',
      'heal',
      'healCrit',
      'hot',
      'hotCrit',
      'pet',
      'petCrit',
      'block',
      'avoid',
      'absorb',
      'taken',
      'takenCrit',
    ]);
  });
});

describe('parseFctColors / serializeFctColors', () => {
  it('keeps known slots with a valid hex and lowercases them', () => {
    expect(parseFctColors({ white: '#AABBCC', heal: '#00ff00' })).toEqual({
      white: '#aabbcc',
      heal: '#00ff00',
    });
  });

  it('drops unknown slots, bad colours and non-objects (each reads as Default)', () => {
    expect(parseFctColors({ nope: '#ffffff', white: 'red', heal: '#fff', dot: 12 })).toEqual({});
    expect(parseFctColors(null)).toEqual({});
    expect(parseFctColors('{"white":"#ffffff"}')).toEqual({});
    expect(parseFctColors(['#ffffff'])).toEqual({});
  });

  it('round-trips through its own serialization', () => {
    const state = { whiteCrit: '#123456', hot: '#abcdef' };
    expect(parseFctColors(JSON.parse(serializeFctColors(state)))).toEqual(state);
  });

  it('stores under its own key, which the all-settings export carries', () => {
    expect(FCT_COLORS_STORE_KEY).toBe('woc_fct_colors');
    expect(readFileSync('src/ui/settings_transfer_core.ts', 'utf8')).toContain(
      `'${FCT_COLORS_STORE_KEY}'`,
    );
  });
});

describe('applyFctColors', () => {
  it('publishes a Custom slot as its variable and body class', () => {
    const { doc, vars, classes } = fakeDoc();
    applyFctColors(doc, { dotCrit: '#ff00ff' });
    expect(vars.get('--fct-user-dot-crit')).toBe('#ff00ff');
    expect(classes.has('fct-c-dot-crit')).toBe(true);
    expect(classes.size).toBe(1);
    expect(vars.size).toBe(1);
  });

  it('clears a slot that went back to Default', () => {
    const { doc, vars, classes } = fakeDoc();
    applyFctColors(doc, { heal: '#00ff00' });
    applyFctColors(doc, {});
    expect(vars.size).toBe(0);
    expect(classes.size).toBe(0);
  });
});

describe('hud.css override rules', () => {
  it('has one rule per slot, gated on its body class, reading its variable over a token', () => {
    for (const slot of FCT_COLOR_SLOTS) {
      // The fallback token keeps every var() read resolvable (tests/css_token_resolution);
      // the variable itself is only ever set together with the body class.
      const re = new RegExp(
        `body\\.${fctColorClass(slot)}\\s[^{]*\\{\\s*color: var\\(${fctColorVar(slot)}, var\\(--color-fct-[a-z-]+\\)\\);\\s*\\}`,
      );
      expect(hudCss, slot).toMatch(re);
    }
  });

  it('never applies an override without its body class (Default changes nothing)', () => {
    const uses = hudCss.match(/var\(--fct-user-[a-z-]+,/g) ?? [];
    expect(uses.length).toBe(FCT_COLOR_SLOTS.length);
    expect(hudCss).not.toMatch(/^\s*\.fct[^{]*\{\s*color: var\(--fct-user-/m);
  });
});

describe('Default swatches mirror the colours the vivid look draws', () => {
  const token = (name: string) => {
    const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6});`).exec(tokensCss);
    if (!m) throw new Error(`token ${name} missing`);
    const hex = m[1].toLowerCase();
    return hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
  };

  it.each([
    ['white', 'color-fct-damage-done-auto'],
    ['whiteCrit', 'color-fct-damage-done-auto'],
    ['ability', 'color-fct-vivid-ability'],
    ['abilityCrit', 'color-fct-vivid-ability'],
    ['dot', 'color-fct-vivid-ability'],
    ['dotCrit', 'color-fct-vivid-ability'],
    ['heal', 'color-fct-heal'],
    ['healCrit', 'color-fct-heal'],
    ['hot', 'color-fct-heal'],
    ['hotCrit', 'color-fct-heal'],
    ['pet', 'color-fct-vivid-pet-ability'],
    ['petCrit', 'color-fct-vivid-pet-ability'],
    ['block', 'color-fct-vivid-block'],
    ['avoid', 'color-fct-vivid-avoid'],
    ['absorb', 'color-fct-absorb'],
    ['taken', 'color-fct-damage-taken'],
    ['takenCrit', 'color-fct-damage-taken'],
  ] as const)('%s defaults to --%s', (slot, name) => {
    expect(FCT_COLOR_DEFAULTS[slot]).toBe(token(name));
  });
});

describe('Combat Text Colors panel wiring', () => {
  const catalog = readFileSync('src/ui/i18n.catalog/hud_chrome.ts', 'utf8');
  const windowTs = readFileSync('src/ui/options_window.ts', 'utf8');

  it('has an English label for every slot', () => {
    const block = catalog.slice(catalog.indexOf('  fctColors: {'));
    for (const slot of FCT_COLOR_SLOTS)
      expect(block, slot).toMatch(new RegExp(`\\n\\s+${slot}: '`));
  });

  it('opens from the Combat tab and closes on every way out of it', () => {
    expect(windowTs).toContain(
      "if (tab === 'combat' && fctColorsPanel(body, hooks?.fctColors, () => this.render())) return;",
    );
    expect(windowTs).toContain(
      "if (tab === 'combat') fctColorsEntryRow(body, hooks?.fctColors, () => this.render());",
    );
    // Reopening the window, switching tab, and Back.
    expect(windowTs.match(/closeFctColorsPanel\(\);/g)?.length).toBe(3);
    // The Combat tab's Reset to Defaults also puts every colour back on Default.
    expect(windowTs).toContain("if (tab === 'combat') hooks.fctColors?.reset();");
  });
});
