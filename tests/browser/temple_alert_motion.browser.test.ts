import { afterEach, describe, expect, it } from 'vitest';
import css from '../../src/styles/components.css?raw';

afterEach(() => {
  document.querySelector('#temple-alert')?.remove();
  document.querySelector('#temple-motion-styles')?.remove();
});

describe('Temple alert reduced-motion cascade', () => {
  it.each(['false', 'step-off', 'broken'])('stops the %s pulse without hiding its text', (kind) => {
    const style = document.createElement('style');
    style.id = 'temple-motion-styles';
    style.textContent = css;
    document.head.append(style);
    const panel = document.createElement('div');
    panel.id = 'temple-alert';
    panel.className = `is-score-${kind}`;
    panel.style.display = 'flex';
    panel.textContent = 'Encounter instruction';
    document.body.append(panel);

    // Force the media condition through CSSOM, leaving shipping selectors,
    // declarations and cascade order untouched. This tests real browser
    // specificity rather than a text match for the presence of a reset.
    const motionRules: CSSMediaRule[] = [];
    const visit = (rules: CSSRuleList): void => {
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule && rule.conditionText.includes('prefers-reduced-motion')) {
          motionRules.push(rule);
        } else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules);
      }
    };
    if (!style.sheet) throw new Error('Temple alert stylesheet did not load');
    visit(style.sheet.cssRules);
    expect(motionRules.length).toBeGreaterThan(0);
    for (const rule of motionRules) rule.media.mediaText = 'not all';
    expect(getComputedStyle(panel).animationName).toBe('bce-throb');
    for (const rule of motionRules) rule.media.mediaText = 'all';
    expect(getComputedStyle(panel).animationName).toBe('none');
    expect(getComputedStyle(panel).display).toBe('flex');
    expect(panel.textContent).toBe('Encounter instruction');
  });
});
