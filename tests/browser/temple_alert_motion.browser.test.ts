import { afterEach, describe, expect, it } from 'vitest';
import css from '../../src/styles/components.css?raw';

afterEach(() => {
  document.querySelector('#temple-alert')?.remove();
  document.querySelector('#wildheart-alert')?.remove();
  document.querySelector('#temple-motion-styles')?.remove();
});

describe('Encounter alert reduced-motion cascade', () => {
  it.each([
    ...['false', 'step-off', 'broken'].map((kind) => ['temple-alert', `is-score-${kind}`]),
    ...['prey', 'prey-alone', 'breath', 'pinned', 'pinned-self', 'stalked', 'sunstruck'].map(
      (kind) => ['wildheart-alert', `is-${kind}`],
    ),
  ])('stops the %s %s pulse without hiding its text', (id, className) => {
    const style = document.createElement('style');
    style.id = 'temple-motion-styles';
    style.textContent = css;
    document.head.append(style);
    const panel = document.createElement('div');
    panel.id = id;
    panel.className = className;
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
