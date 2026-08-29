// The three chat-log tones the $WOC money surfaces write with have ONE home
// (src/ui/woc_log_tones.ts), which is why src/styles/CLAUDE.md lists that module
// as a sanctioned colour-literal exception: a chat line is written as an inline
// colour on a span the log owns, so it cannot read a stylesheet rule.
//
// The pin is scoped to the $WOC surfaces on purpose. The same three values also
// appear across src/ui/hud.ts for the pre-existing HUD log calls; that is
// separate debt this packet does not own, and widening the scan to it would
// make this guard fail for a reason nobody here can fix.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WOC_LOG_BAD, WOC_LOG_GOOD, WOC_LOG_NOTE } from '../src/ui/woc_log_tones';
import { stripComments } from './helpers/strip_comments';

const WOC_SURFACES = [
  'src/ui/hud/woc_trade/woc_trade_controller.ts',
  'src/ui/hud/woc_trade/woc_trade_offer_view.ts',
  'src/ui/trade_woc_arm_painter.ts',
  'src/ui/woc_market_window.ts',
];

describe('the $WOC log tones are named once', () => {
  it('keeps the three values a retune has to change deliberately', () => {
    // Spelled out rather than compared to themselves: a self-comparison would
    // pass for any value, including a typo.
    expect(WOC_LOG_GOOD).toBe('#7fdc4f');
    expect(WOC_LOG_BAD).toBe('#ff6b6b');
    expect(WOC_LOG_NOTE).toBe('#ffd100');
  });

  it('no $WOC surface re-spells a tone instead of importing it', () => {
    // The defect this replaced: the same triple copied across 34 call sites in
    // one controller, so a retune meant a sweep and any miss read as a
    // deliberate difference. Comments are stripped first, or a doc comment
    // quoting a value would satisfy (or falsely red) the scan.
    for (const file of WOC_SURFACES) {
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const tone of [WOC_LOG_GOOD, WOC_LOG_BAD, WOC_LOG_NOTE]) {
        expect(src, `${file} must import the tone, not spell ${tone}`).not.toContain(tone);
      }
    }
  });

  it('positive control: the scan sees a literal it is given', () => {
    expect(stripComments(`const c = '${WOC_LOG_GOOD}';`)).toContain(WOC_LOG_GOOD);
    expect(stripComments(`// ${WOC_LOG_GOOD}\nconst c = 1;`)).not.toContain(WOC_LOG_GOOD);
  });
});
