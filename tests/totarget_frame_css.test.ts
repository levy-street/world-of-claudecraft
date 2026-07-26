// Regression pins for the compact target-of-target satellite introduced by the
// premium unit-frame pass. The legacy #totarget-frame duplicated the full unit
// frame and competed with the target aura band. The replacement is one compact,
// clickable .tf-target-target button beside the frame while both target aura rows
// remain above it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const flat = (css: string): string =>
  css.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');
const hudCss = flat(readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8'));
const hudMobileCss = flat(
  readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8'),
);

const rule = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped} \\{([^}]*)\\}`));
  return match?.[1] ?? '';
};

describe('compact target-of-target satellite', () => {
  const satellite = rule(hudCss, '.tf-target-target');

  it('anchors on the open side of the target frame', () => {
    expect(satellite).toContain('position: absolute;');
    expect(satellite).toContain('left: calc(100% + 7px);');
    expect(satellite).toContain('top: 29px;');
    expect(satellite).toContain('width: 132px;');
    expect(satellite).toContain('height: 36px;');
  });

  it('keeps target buffs and debuffs above the frame', () => {
    expect(rule(hudCss, '#target-frame > #tf-debuffs')).toContain(
      'bottom: calc(100% + 8px);',
    );
    expect(rule(hudCss, '#target-frame > #tf-buffs')).toContain(
      'bottom: calc(100% + 52px);',
    );
    expect(rule(hudCss, '#target-frame:has(> #tf-debuffs:empty) > #tf-buffs')).toContain(
      'bottom: calc(100% + 8px);',
    );
  });

  it('uses a compact portrait and HP rail without recreating a full unit frame', () => {
    expect(rule(hudCss, '.tf-tot-portrait')).toContain('width: 28px;');
    expect(rule(hudCss, '.tf-tot-portrait')).toContain('height: 28px;');
    expect(rule(hudCss, '.tf-tot-hp')).toContain('height: 5px;');
    expect(hudCss).not.toContain('#target-frame > #totarget-frame');
  });

  it('keeps the satellite keyboard visible and clickable', () => {
    expect(satellite).toContain('cursor: var(--cursor-point);');
    expect(rule(hudCss, '.tf-target-target:focus-visible')).toContain(
      'outline: 2px solid var(--color-border-focus);',
    );
  });

  it('distinguishes self-target and dangerous health states', () => {
    expect(rule(hudCss, '.tf-target-target.is-self')).toContain('--tot-accent: var(--gold);');
    expect(rule(hudCss, '.tf-target-target.health-danger .tf-tot-hp-fill')).toContain(
      'background: linear-gradient(180deg, #ef5b4f, #9d241d);',
    );
  });

  it('rank chrome binds only to the target portrait', () => {
    expect(hudCss).toContain('#target-frame.elite > .portrait-wrap .portrait {');
    expect(hudCss).toContain('#target-frame.boss > .portrait-wrap::before {');
    expect(hudCss).toContain('#target-frame.boss > .portrait-wrap .portrait {');
    expect(hudCss).not.toContain('#target-frame.elite .portrait {');
    expect(hudCss).not.toContain('#target-frame.boss .portrait {');
  });

  it('makes a deliberate compact mobile placement', () => {
    const mobile = rule(hudMobileCss, 'body.mobile-touch .tf-target-target');
    expect(mobile).toContain('left: calc(100% - 2px);');
    expect(mobile).toContain('width: 116px;');
  });
});
