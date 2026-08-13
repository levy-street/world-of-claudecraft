// The Rising Phoenix proc overlay: the pure state cores (fire Heating Up / Hot
// Streak, and the Chronomancy 4-charge variant) plus the thin painter's class
// mapping. No DOM: the painter routes through a fake writer that records the
// toggled classes, so the quarter-by-quarter reveal is pinned.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PainterHostWriters } from '../src/ui/painter_host';
import { ProcOverlayPainter } from '../src/ui/proc_overlay_painter';
import {
  chronoOverlayCharges,
  combustionOverlayActive,
  frostOverlayCharges,
  necromancyOverlayCharges,
  procOverlayState,
} from '../src/ui/proc_overlay_view';

describe('procOverlayState (fire)', () => {
  it('maps Heating Up / Hot Streak / none', () => {
    expect(procOverlayState([])).toBe('none');
    expect(procOverlayState([{ id: 'heating_up' }])).toBe('heating');
    expect(procOverlayState([{ id: 'hot_streak' }])).toBe('hot');
    // Hot Streak wins over Heating Up.
    expect(procOverlayState([{ id: 'heating_up' }, { id: 'hot_streak' }])).toBe('hot');
  });
});

describe('combustionOverlayActive (Fire cooldown)', () => {
  it('pins the Fire phoenix only while Combustion is worn', () => {
    expect(combustionOverlayActive([])).toBe(false);
    expect(combustionOverlayActive([{ id: 'heating_up' }])).toBe(false);
    expect(combustionOverlayActive([{ id: 'combustion' }])).toBe(true);
  });
});

describe('chronoOverlayCharges (Chronomancy 4-charge variant)', () => {
  it('reads the Aether Surge charge count (0-4) off the arcane_surge aura', () => {
    expect(chronoOverlayCharges([])).toBe(0);
    expect(chronoOverlayCharges([{ id: 'arcane_surge', value: 1 }])).toBe(1);
    expect(chronoOverlayCharges([{ id: 'arcane_surge', value: 3 }])).toBe(3);
    expect(chronoOverlayCharges([{ id: 'arcane_surge', value: 4 }])).toBe(4);
  });

  it('clamps to 0-4 and ignores unrelated auras', () => {
    expect(chronoOverlayCharges([{ id: 'temporal_echo', value: 1 }])).toBe(0);
    expect(chronoOverlayCharges([{ id: 'arcane_surge', value: 9 }])).toBe(4);
    expect(chronoOverlayCharges([{ id: 'arcane_surge' }])).toBe(0); // no value -> 0
  });
});

describe('frostOverlayCharges (Frost 5-Icicle variant)', () => {
  it('reads the Icicle stack, including the wire-defaulted first stack', () => {
    expect(frostOverlayCharges([])).toBe(0);
    expect(frostOverlayCharges([{ id: 'icicles' }])).toBe(1);
    expect(frostOverlayCharges([{ id: 'icicles', stacks: 3 }])).toBe(3);
    expect(frostOverlayCharges([{ id: 'icicles', stacks: 5 }])).toBe(5);
  });

  it('clamps malformed mirrored values and ignores unrelated auras', () => {
    expect(frostOverlayCharges([{ id: 'fingers_of_frost', stacks: 2 }])).toBe(0);
    expect(frostOverlayCharges([{ id: 'icicles', stacks: 99 }])).toBe(5);
    expect(frostOverlayCharges([{ id: 'icicles', stacks: -2 }])).toBe(0);
  });
});

describe('necromancyOverlayCharges (Soul Fragment bank)', () => {
  it('reads the Soul Fragment stack, including the wire-defaulted first stack', () => {
    expect(necromancyOverlayCharges([])).toBe(0);
    expect(necromancyOverlayCharges([{ id: 'soul_fragments' }])).toBe(1);
    expect(necromancyOverlayCharges([{ id: 'soul_fragments', stacks: 3 }])).toBe(3);
    expect(necromancyOverlayCharges([{ id: 'soul_fragments', stacks: 5 }])).toBe(5);
  });

  it('clamps malformed mirrored values and ignores unrelated auras', () => {
    expect(necromancyOverlayCharges([{ id: 'form_lich', stacks: 2 }])).toBe(0);
    expect(necromancyOverlayCharges([{ id: 'soul_fragments', stacks: 99 }])).toBe(5);
    expect(necromancyOverlayCharges([{ id: 'soul_fragments', stacks: -2 }])).toBe(0);
  });
});

function fakeWriters() {
  const classes = new Map<string, boolean>();
  const attrs = new Map<string, string>();
  const writers = {
    toggleClass: (_el: HTMLElement, cls: string, on: boolean) => {
      classes.set(cls, on);
    },
    setAttr: (_el: HTMLElement, name: string, value: string) => {
      attrs.set(name, value);
    },
  } as unknown as PainterHostWriters;
  return { writers, classes, attrs };
}

describe('ProcOverlayPainter class mapping', () => {
  it('lights one quarter per charge and clears the fire classes', () => {
    const { writers, classes } = fakeWriters();
    const painter = new ProcOverlayPainter(writers, {} as HTMLElement);

    painter.paintChronoCharges(2);
    expect(classes.get('chrono')).toBe(true);
    expect(classes.get('c1')).toBe(true);
    expect(classes.get('c2')).toBe(true);
    expect(classes.get('c3')).toBe(false);
    expect(classes.get('c4')).toBe(false);
    expect(classes.get('heating')).toBe(false);
    expect(classes.get('hot')).toBe(false);

    painter.paintChronoCharges(4); // full bird
    expect(classes.get('c3')).toBe(true);
    expect(classes.get('c4')).toBe(true);

    painter.paintChronoCharges(0); // Aether Darts spent them -> off
    expect(classes.get('c1')).toBe(false);
    expect(classes.get('c4')).toBe(false);
    expect(classes.get('chrono')).toBe(true); // theme stays; opacity handles hiding
  });

  it('the fire path clears every Chronomancy class', () => {
    const { writers, classes } = fakeWriters();
    const painter = new ProcOverlayPainter(writers, {} as HTMLElement);
    painter.paintChronoCharges(4);
    painter.paint('hot');
    expect(classes.get('chrono')).toBe(false);
    expect(classes.get('c1')).toBe(false);
    expect(classes.get('c2')).toBe(false);
    expect(classes.get('c3')).toBe(false);
    expect(classes.get('c4')).toBe(false);
    expect(classes.get('hot')).toBe(true);
  });

  it('lights one frozen section per Icicle and clears other themes', () => {
    const { writers, classes } = fakeWriters();
    const painter = new ProcOverlayPainter(writers, {} as HTMLElement);

    painter.paintFrostCharges(3);
    expect(classes.get('frost')).toBe(true);
    expect(classes.get('f1')).toBe(true);
    expect(classes.get('f2')).toBe(true);
    expect(classes.get('f3')).toBe(true);
    expect(classes.get('f4')).toBe(false);
    expect(classes.get('f5')).toBe(false);
    expect(classes.get('chrono')).toBe(false);
    expect(classes.get('hot')).toBe(false);

    painter.paintFrostCharges(5);
    expect(classes.get('f4')).toBe(true);
    expect(classes.get('f5')).toBe(true);

    painter.paintFrostCharges(0);
    expect(classes.get('f1')).toBe(false);
    expect(classes.get('f5')).toBe(false);
  });

  it('clears every Frost class when another theme takes ownership', () => {
    const { writers, classes } = fakeWriters();
    const painter = new ProcOverlayPainter(writers, {} as HTMLElement);
    painter.paintFrostCharges(5);

    painter.paintChronoCharges(2);
    expect(classes.get('frost')).toBe(false);
    expect(classes.get('f1')).toBe(false);
    expect(classes.get('f5')).toBe(false);
    expect(classes.get('chrono')).toBe(true);

    painter.paintFrostCharges(5);
    painter.paint('hot');
    expect(classes.get('frost')).toBe(false);
    expect(classes.get('f1')).toBe(false);
    expect(classes.get('f5')).toBe(false);
    expect(classes.get('hot')).toBe(true);
  });

  it('lights one soul crystal per fragment and clears other themes', () => {
    const { writers, classes, attrs } = fakeWriters();
    const painter = new ProcOverlayPainter(writers, {} as HTMLElement);

    painter.paintNecromancyCharges(3, 'Soul Fragments', '3 of 5 Soul Fragments');
    expect(classes.get('necromancy')).toBe(true);
    expect(classes.get('n1')).toBe(true);
    expect(classes.get('n2')).toBe(true);
    expect(classes.get('n3')).toBe(true);
    expect(classes.get('n4')).toBe(false);
    expect(classes.get('n5')).toBe(false);
    expect(classes.get('frost')).toBe(false);
    expect(classes.get('chrono')).toBe(false);
    expect(classes.get('hot')).toBe(false);
    expect(attrs.get('aria-hidden')).toBe('false');
    expect(attrs.get('aria-valuenow')).toBe('3');

    painter.paintNecromancyCharges(5, 'Soul Fragments', '5 of 5 Soul Fragments');
    expect(classes.get('n4')).toBe(true);
    expect(classes.get('n5')).toBe(true);

    painter.paintNecromancyCharges(0, 'Soul Fragments', '0 of 5 Soul Fragments');
    expect(classes.get('necromancy')).toBe(true);
    expect(classes.get('n1')).toBe(false);
    expect(classes.get('n5')).toBe(false);
  });

  it('exposes a live valuetext distinct from the stable meter label', () => {
    // The regression this pins: aria-valuetext used to be set to the SAME
    // static label as aria-label, which masked aria-valuenow from screen
    // readers (the count never changed even as n changed). aria-label must
    // stay the stable meter name while aria-valuetext tracks n every call.
    const { writers, attrs } = fakeWriters();
    const painter = new ProcOverlayPainter(writers, {} as HTMLElement);

    for (let amount = 0; amount <= 5; amount++) {
      painter.paintNecromancyCharges(amount, 'Soul Fragments', `${amount} of 5 Soul Fragments`);
      expect(attrs.get('aria-valuenow')).toBe(String(amount));
      expect(attrs.get('aria-valuetext')).toBe(`${amount} of 5 Soul Fragments`);
      expect(attrs.get('aria-label')).toBe('Soul Fragments');
    }
  });

  it('clears every Necromancy class when another theme takes ownership', () => {
    const { writers, classes, attrs } = fakeWriters();
    const painter = new ProcOverlayPainter(writers, {} as HTMLElement);
    painter.paintNecromancyCharges(5, 'Soul Fragments', '5 of 5 Soul Fragments');

    painter.paintFrostCharges(2);
    expect(classes.get('necromancy')).toBe(false);
    expect(classes.get('n1')).toBe(false);
    expect(classes.get('n5')).toBe(false);
    expect(classes.get('frost')).toBe(true);
    expect(attrs.get('aria-hidden')).toBe('true');
  });

  it('lights every Destruction threshold, exposes a stable meter name, and clears other themes', () => {
    const { writers, classes, attrs } = fakeWriters();
    const painter = new ProcOverlayPainter(writers, {} as HTMLElement);

    for (let amount = 0; amount <= 5; amount++) {
      painter.paintDestructionMarks(amount, 'Ruin', `${amount} of 5 Ruin`);
      expect(classes.get('destruction')).toBe(true);
      for (let mark = 1; mark <= 5; mark++) {
        expect(classes.get(`r${mark}`)).toBe(mark <= amount);
      }
    }

    expect(classes.get('necromancy')).toBe(false);
    expect(classes.get('frost')).toBe(false);
    expect(classes.get('chrono')).toBe(false);
    expect(classes.get('hot')).toBe(false);
    expect(attrs.get('aria-hidden')).toBe('false');
    expect(attrs.get('aria-valuenow')).toBe('5');
    expect(attrs.get('aria-valuetext')).toBe('5 of 5 Ruin');
    expect(attrs.get('aria-label')).toBe('Ruin');
    expect(attrs.get('tabindex')).toBe('0');
  });

  it('clears every Destruction mark and restores the meter label on a theme switch', () => {
    const { writers, classes, attrs } = fakeWriters();
    const painter = new ProcOverlayPainter(writers, {} as HTMLElement);
    painter.paintDestructionMarks(5, 'Ruin', '5 of 5 Ruin');

    painter.paintNecromancyCharges(2, 'Soul Fragments', '2 of 5 Soul Fragments');
    expect(classes.get('destruction')).toBe(false);
    for (let mark = 1; mark <= 5; mark++) {
      expect(classes.get(`r${mark}`)).toBe(false);
    }
    expect(classes.get('necromancy')).toBe(true);
    expect(attrs.get('aria-label')).toBe('Soul Fragments');
    expect(attrs.get('aria-valuetext')).toBe('2 of 5 Soul Fragments');
  });

  it('clears every Destruction mark from each non-Destruction painter path', () => {
    const paintOtherThemes = [
      (painter: ProcOverlayPainter) => painter.paint('hot'),
      (painter: ProcOverlayPainter) => painter.paintChronoCharges(2),
      (painter: ProcOverlayPainter) => painter.paintFrostCharges(2),
      (painter: ProcOverlayPainter) =>
        painter.paintNecromancyCharges(2, 'Soul Fragments', '2 of 5 Soul Fragments'),
    ];

    for (const paintOtherTheme of paintOtherThemes) {
      const { writers, classes } = fakeWriters();
      const painter = new ProcOverlayPainter(writers, {} as HTMLElement);
      painter.paintDestructionMarks(5, 'Ruin', '5 of 5 Ruin');
      paintOtherTheme(painter);
      expect(classes.get('destruction')).toBe(false);
      for (let mark = 1; mark <= 5; mark++) {
        expect(classes.get(`r${mark}`)).toBe(false);
      }
    }
  });

  it('pins the Fire phoenix during Combustion without requiring Hot Streak', () => {
    const { writers, classes } = fakeWriters();
    const painter = new ProcOverlayPainter(writers, {} as HTMLElement);
    painter.paint('none', true);
    expect(classes.get('combustion')).toBe(true);
    expect(classes.get('combustion-enter')).toBe(true);
    expect(classes.get('heating')).toBe(false);
    expect(classes.get('hot')).toBe(false);

    painter.paint('hot', true);
    expect(classes.get('combustion')).toBe(true);
    expect(classes.get('hot')).toBe(true);

    painter.paint('none', false);
    expect(classes.get('combustion')).toBe(false);
    expect(classes.get('combustion-enter')).toBe(false);
  });
});

describe('Frost phoenix visual progression', () => {
  it('keeps the complete phoenix silhouette at every Icicle count', () => {
    const css = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
    for (const part of ['tail', 'left', 'right', 'core']) {
      const rule = css.match(new RegExp(`#proc-overlay\\.frost \\.frost-${part} \\{([^}]*)\\}`));
      expect(rule?.[1]).toBeDefined();
      expect(rule?.[1]).not.toContain('clip-path');
    }
  });

  it('renders one independently lit crown crystal per Icicle', () => {
    const domSource = readFileSync(
      new URL('../src/ui/proc_overlay_dom.ts', import.meta.url),
      'utf8',
    );
    const css = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');

    expect(domSource.match(/class="frost-crystal frost-crystal-[1-5]"/g)).toHaveLength(5);
    for (let stack = 1; stack <= 5; stack++) {
      expect(css).toContain(`#proc-overlay.frost.f${stack} .frost-crystal-${stack}`);
    }
  });
});

describe('Necromancy Soul Fragment visual progression', () => {
  it('renders five independently lit soul shards on a horizontal rail', () => {
    const domSource = readFileSync(
      new URL('../src/ui/proc_overlay_dom.ts', import.meta.url),
      'utf8',
    );
    const css = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
    const bankRule = css.match(/#proc-overlay \.necromancy-bank\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(domSource).toContain('class="soul-rail"');
    expect(domSource.match(/class="soul-crystal soul-crystal-[1-5]"/g)).toHaveLength(5);
    expect(bankRule).toContain('width: 250px');
    expect(bankRule).toContain('height: 86px');
    for (let stack = 1; stack <= 5; stack++) {
      expect(css).toContain(`#proc-overlay.necromancy.n${stack} .soul-crystal-${stack}`);
      const positionRule =
        css.match(
          new RegExp(`#proc-overlay\\.necromancy \\.soul-crystal-${stack}\\s*\\{([^}]*)\\}`),
        )?.[1] ?? '';
      expect(positionRule).toContain('top: 50%');
    }
  });

  it('keeps the empty bank visible and makes only its artwork draggable', () => {
    const css = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
    const rule = css.match(/#proc-overlay\.necromancy\s*\{([^}]*)\}/)?.[1] ?? '';
    const artworkRule =
      css.match(
        /#proc-overlay\.necromancy \.soul-rail,\s*#proc-overlay\.necromancy \.soul-crystal\s*\{([^}]*)\}/,
      )?.[1] ?? '';

    expect(rule).toContain('opacity: 0.72');
    expect(rule).toContain('pointer-events: none');
    expect(artworkRule).toContain('pointer-events: auto');
    expect(artworkRule).toContain('cursor: grab');
  });

  it('adds a stronger persistent full-bank glow at five fragments', () => {
    const css = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
    const fullRule = css.match(/#proc-overlay\.necromancy\.n5\s*\{([^}]*)\}/)?.[1] ?? '';
    const flareRule =
      css.match(/#proc-overlay\.necromancy\.n5 \.necromancy-bank::after\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(fullRule).toContain('opacity: 1');
    expect(flareRule).toContain('opacity: 0.9');
    expect(flareRule).toContain('animation: soul-bank-full-flare');
  });
});

describe('Destruction Ruin visual progression', () => {
  it('renders five independently lit marks in a dedicated ritual bank', () => {
    const domSource = readFileSync(
      new URL('../src/ui/proc_overlay_dom.ts', import.meta.url),
      'utf8',
    );
    const css = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
    const hudSource = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

    expect(domSource).toContain('class="ruin-ritual"');
    expect(domSource.match(/class="ruin-mark ruin-mark-[1-5]"/g)).toHaveLength(5);
    for (let stack = 1; stack <= 5; stack++) {
      expect(domSource.match(new RegExp(`class="ruin-mark ruin-mark-${stack}"`, 'g'))).toHaveLength(
        1,
      );
      expect(css).toContain(`#proc-overlay.destruction.r${stack} .ruin-mark-${stack}`);
    }
    expect(hudSource).toContain('const ruinPips = destructionRuinPips');
    expect(hudSource).toMatch(/paintDestructionMarks\(\s*ruinPips/);
    expect(hudSource).toContain("t('hudChrome.procOverlay.ruinMeter')");
    expect(hudSource).toContain("t('hudChrome.procOverlay.ruinStatus'");
    expect(css).not.toContain('.combo-row.ruin');
  });

  it('exposes a bounded keyboard-movable meter and honors motion preferences', () => {
    const domSource = readFileSync(
      new URL('../src/ui/proc_overlay_dom.ts', import.meta.url),
      'utf8',
    );
    const dragSource = readFileSync(
      new URL('../src/ui/proc_overlay_drag.ts', import.meta.url),
      'utf8',
    );
    const css = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');

    expect(domSource).toContain("el.setAttribute('role', 'meter')");
    expect(domSource).toContain("el.setAttribute('aria-valuemin', '0')");
    expect(domSource).toContain("el.setAttribute('aria-valuemax', '5')");
    expect(domSource).toContain("el.setAttribute('tabindex', '-1')");
    expect(domSource).toContain("el.setAttribute('aria-keyshortcuts'");
    expect(dragSource).toContain("el.addEventListener('keydown'");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?#proc-overlay\.destruction[\s\S]*?transition: none !important;/,
    );
    expect(css).toMatch(
      /body\.reduce-motion #proc-overlay\.destruction[\s\S]*?transition: none !important;/,
    );
  });

  it('keeps the empty bank visible, draggable, and gives the full bank a flare', () => {
    const css = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
    const rootRule = css.match(/#proc-overlay\.destruction\s*\{([^}]*)\}/)?.[1] ?? '';
    const artworkRule =
      css.match(
        /#proc-overlay\.destruction \.ruin-ritual,\s*#proc-overlay\.destruction \.ruin-mark\s*\{([^}]*)\}/,
      )?.[1] ?? '';
    const fullRule = css.match(/#proc-overlay\.destruction\.r5\s*\{([^}]*)\}/)?.[1] ?? '';
    const flareRule =
      css.match(/#proc-overlay\.destruction\.r5 \.ruin-ritual::after\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(rootRule).toContain('opacity: 0.76');
    expect(rootRule).toContain('pointer-events: none');
    expect(artworkRule).toContain('pointer-events: auto');
    expect(artworkRule).toContain('cursor: grab');
    expect(fullRule).toContain('opacity: 1');
    expect(flareRule).toContain('animation: ruin-bank-full-flare');
  });
});

describe('Phoenix mobile size', () => {
  it('scales the shared proc overlay down only in touch layout', () => {
    const desktopCss = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
    const mobileCss = readFileSync(
      new URL('../src/styles/hud.mobile.css', import.meta.url),
      'utf8',
    );
    const baseRule = desktopCss.match(/#proc-overlay\s*\{([^}]*)\}/)?.[1] ?? '';
    const mobileRule = mobileCss.match(/body\.mobile-touch #proc-overlay\s*\{([^}]*)\}/)?.[1] ?? '';
    const necromancyMobileRule =
      mobileCss.match(/body\.mobile-touch #proc-overlay\.necromancy\s*\{([^}]*)\}/)?.[1] ?? '';
    const destructionMobileRule =
      mobileCss.match(/body\.mobile-touch #proc-overlay\.destruction\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(baseRule).toContain('width: 300px');
    expect(baseRule).toContain('height: 232px');
    expect(baseRule).not.toContain('scale: 0.2');
    expect(mobileRule).toContain('scale: 0.2');
    expect(necromancyMobileRule).toContain('scale: 0.55');
    expect(destructionMobileRule).toContain('scale: 0.6');
  });
});
