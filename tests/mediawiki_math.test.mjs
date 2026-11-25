import { describe, expect, it } from 'vitest';
import { parseMath, renderMath, renderScale } from '../mediawiki/reader/math.js';
import { bonus, math, scaledStat, share } from '../scripts/mediawiki/math_markup';

const inner = (s) => s.replace(/^<woc-math[^>]*>|<\/woc-math>$/g, '');
const label = (s) => /label="([^"]*)"/.exec(s)?.[1];

describe('encyclopedia formulas', () => {
  it('writes the factors in order and states the combined multiplier', () => {
    const heal = inner(scaledStat('Healing Power', [2, { frac: [1.5, 3.5] }]));
    expect(heal).toBe('Healing Power × 2 × frac(1.5, 3.5) ≈ Healing Power × 0.8571');
    expect(inner(scaledStat('Spell Power', [{ frac: [1.75, 3.5] }]))).toBe(
      'Spell Power × frac(1.75, 3.5) = Spell Power × 0.5',
    );
    expect(inner(scaledStat('Spell Power', [{ frac: [3, 3.5] }, { div: 3 }]))).toBe(
      'Spell Power × frac(3, 3.5) ÷ 3 ≈ Spell Power × 0.2857',
    );
    // A single plain factor needs no combined value.
    expect(inner(scaledStat('Attack Power', [0.15]))).toBe('Attack Power × 0.15');
    expect(math('x')).toBe('<woc-math>x</woc-math>');
    expect(share(0.08, 'Ranged Attack Power')).toBe(
      '<woc-math label="+ 8% Ranged Attack Power">Ranged Attack Power × 0.08</woc-math>',
    );
    expect(bonus('7.1% of AP', 'frac(AP, 14)', 'A note.')).toBe(
      '<woc-math label="+ 7.1% of AP" note="A note.">frac(AP, 14)</woc-math>',
    );
    expect(scaledStat('Spell Power', [0.5])).toContain(
      'note="Rounded to the nearest whole number."',
    );
    // The page shows a short percent label; the working rides along for the hover.
    expect(label(scaledStat('Healing Power', [2, { frac: [1.5, 3.5] }]))).toBe(
      '+ 85.7% Healing Power',
    );
    expect(label(scaledStat('Spell Power', [{ frac: [1.75, 3.5] }]))).toBe('+ 50% Spell Power');
    expect(label(scaledStat('Attack Power', [0.15]))).toBe('+ 15% Attack Power');
    expect(label(scaledStat('Spell Power', []))).toBe('+ 100% Spell Power');
  });

  it('draws fractions stacked, keeps a readable text form and nests calls', () => {
    const html = renderMath('Healing Power × 2 × frac(1.5, 3.5)');
    expect(html).toContain(
      '<span class="woc-frac-top" aria-hidden="true">1.5</span><span class="woc-frac-bottom" aria-hidden="true">3.5</span>',
    );
    expect(html).toContain('<span class="woc-math-text">(1.5) ÷ (3.5)</span>');
    expect(html.startsWith('<span class="woc-math">Healing Power × 2 × ')).toBe(true);

    const elo = parseMath('E = frac(1, 1 + pow(10, (a − b) ÷ 400))');
    expect(elo.text).toBe('E = (1) ÷ (1 + 10^((a − b) ÷ 400))');
    expect(elo.html).toContain('10<sup>(a − b) ÷ 400</sup>');

    // Brackets inside an argument do not end it early.
    expect(parseMath('frac(armor, (armor + 85) × 2)').text).toBe('(armor) ÷ ((armor + 85) × 2)');
  });

  it('escapes formula text', () => {
    const html = renderMath('frac(<b>x</b>, "y") & z');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('&quot;y&quot;');
    expect(html).toContain('&amp; z');
  });

  it('shows a power bonus as a label with its working in a pop-up', () => {
    const html = renderScale(
      '+ 85.7% <b>',
      'Healing Power × 2 × frac(1.5, 3.5)',
      'Rounded to the nearest whole number.',
    );
    expect(html.startsWith('<span class="woc-scale" tabindex="0">(+ 85.7% &lt;b&gt;)')).toBe(true);
    expect(html).toContain('<span class="woc-scale-tip" role="tooltip"><span class="woc-math">');
    expect(html).toContain('<span class="woc-frac-top" aria-hidden="true">1.5</span>');
    expect(html).toContain('<small>Rounded to the nearest whole number.</small>');
    // A bonus with no note shows only its working.
    expect(renderScale('+ 8% X', 'X × 0.08')).not.toContain('<small>');
  });
});
