import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROMPT_TIMEOUT_MS } from '../src/ui/prompt_dialog';

// The #prompt-stack countdown bar (party invite, trade request, duel challenge,
// ready check) is drawn in CSS and dismissed in TypeScript, so its duration lives
// in two homes. They were 28s and 28000 with nothing tying them together: a bar
// that drains early, or one still half full when the prompt vanishes, is the
// failure this file exists to catch.
//
// The reduced-motion arms are pinned here too, because the old freeze-at-62% was
// the same lie in a different form: with no animation the bar reported "most of
// the time left" right up to the silent auto-dismiss, so it is hidden instead.

const read = (rel: string) =>
  readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const tokens = read('src/styles/tokens.css');
const hudCss = read('src/styles/hud.css');

describe('the prompt countdown bar and its timeout agree', () => {
  it('drains over the same duration the prompt lives for', () => {
    const declared = tokens.match(/--prompt-timeout-dur:\s*([\d.]+)(m?s);/);
    expect(declared, '--prompt-timeout-dur missing from tokens.css').toBeTruthy();
    const ms = Number(declared?.[1]) * (declared?.[2] === 's' ? 1000 : 1);
    expect(ms, 'the sheet and PROMPT_TIMEOUT_MS disagree').toBe(PROMPT_TIMEOUT_MS);
    // Anti-vacuity: a plausible real duration, not a zero that would satisfy any
    // constant, and the constant is what actually dismisses the prompt.
    expect(PROMPT_TIMEOUT_MS).toBe(28_000);
    expect(read('src/ui/hud.ts')).toContain('}, PROMPT_TIMEOUT_MS);');
  });

  it('animates the fill from the token rather than a second literal', () => {
    expect(hudCss).toContain(
      'animation: prompt-timeout var(--prompt-timeout-dur) linear forwards;',
    );
    expect(hudCss, 'a literal duration crept back into the sheet').not.toMatch(
      /animation: prompt-timeout \d/,
    );
  });

  it('hides the bar under reduced motion instead of freezing it part-drained', () => {
    expect(hudCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.prompt-timeout \{\s*display: none;/,
    );
    expect(hudCss).toMatch(/body\.reduce-motion \.prompt-timeout \{\s*display: none;/);
    // The frozen fill must be gone from BOTH arms: a leftover width would keep
    // painting a stale readout under the hidden bar the day the hide is relaxed.
    expect(hudCss).not.toMatch(/\.prompt-timeout \.ui-bar-fill \{\s*width: 62%;/);
  });
});
