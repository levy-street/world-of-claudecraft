import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SETTING_RANGES } from '../src/game/settings';
import { CHAT_UNREAD_CHANNELS } from '../src/ui/hud/chat/chat_unread_core';
import { COMPACT_MAX_HEIGHT_PX } from '../src/ui/mobile_hud_layout';

// The unread chat box's SEAT. The touch HUD's top-left column belongs to the
// target frame (plus its aura strip and the party stack under it), so the box
// hangs over the Quick Actions control at the bottom-left instead. These pins
// hold the two halves of "it can never sit on the target frame":
//   1. structure: the box is bottom-anchored to a bottom-anchored seat, the
//      target frame is top-anchored, and the box lives in the touch-controls
//      layer, which stacks UNDER the #ui layer the frame lives in;
//   2. geometry: on the shortest supported screens, at the largest button
//      scale, with every row lit, the box's top edge still clears the target
//      seat's bottom edge. The numbers are read out of the stylesheet, so
//      retuning a tier moves the proof with it.
// The model was checked against a real browser at 844x390, 667x375, 900x600
// and 1180x820 (the box's measured top matched it to the pixel).

const css = readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);

/** The declarations of the FIRST rule whose selector list is exactly `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = css.match(new RegExp(`\\n\\s*${escaped} \\{([^}]*)\\}`))?.[1];
  expect(body, `no rule for ${selector}`).toBeTruthy();
  return body ?? '';
}
const px = (text: string, pattern: RegExp): number => {
  const m = text.match(pattern);
  expect(m, `${pattern} not found`).toBeTruthy();
  return Number(m?.[1] ?? Number.NaN);
};

const BOX = 'body.mobile-touch #chat-unread-box';
const SEAT = 'body.mobile-touch #mobile-combat-controls';
const COMPACT_SEAT = 'body.mobile-touch.hud-mobile-compact #mobile-combat-controls';
const TABLET_SEAT = 'body.mobile-touch.hud-mobile-tablet #mobile-combat-controls';

describe('unread chat box seat', () => {
  it('hangs over the Quick Actions seat, out of flow, anchored by its bottom edge', () => {
    const box = ruleBody(BOX);
    expect(box).toMatch(/position:\s*absolute/);
    // The seat's own height (anchor, plus the Seeker chest when one is stacked
    // over it) plus the growth --btn-scale adds to the anchor about its bottom.
    expect(box).toMatch(
      /bottom:\s*calc\(100% \+ var\(--menu-btn-size\) \* \(var\(--btn-scale, 1\) - 1\) \+ 8px\)/,
    );
    expect(box).not.toMatch(/\btop:/);
    // It grows AWAY from the move wheel, which sits on the seat's other side.
    expect(box).toMatch(/left:\s*0;/);
    const mirrored = ruleBody('body.mobile-touch.mobile-left-handed #chat-unread-box');
    expect(mirrored).toMatch(/left:\s*auto/);
    expect(mirrored).toMatch(/right:\s*0;/);
  });

  it('sits in a bottom-anchored seat while the target frame is top-anchored', () => {
    for (const selector of [SEAT, COMPACT_SEAT, TABLET_SEAT]) {
      const seat = ruleBody(selector);
      expect(seat).toMatch(/bottom:\s*calc\(/);
      expect(seat).not.toMatch(/\btop:/);
    }
    // Every target-frame seat in the sheet is pinned to the top edge.
    const targetSeats = [...css.matchAll(/\n\s*body\.mobile-touch #target-frame \{([^}]*)\}/g)]
      .map((m) => m[1])
      .filter((body) => /\b(?:top|bottom):/.test(body));
    expect(targetSeats.length).toBeGreaterThanOrEqual(2);
    for (const body of targetSeats) {
      expect(body).toMatch(/top:\s*max\(\d+px, env\(safe-area-inset-top\)\)/);
      expect(body).not.toMatch(/\bbottom:/);
    }
  });

  it('lives in the touch-controls layer, which stacks under the #ui frames', () => {
    const controlsZ = px(
      ruleBody('body.mobile-touch.game-active #mobile-controls'),
      /z-index:\s*(\d+)/,
    );
    const uiZ = px(ruleBody('body.mobile-touch.game-active #ui'), /z-index:\s*(\d+)/);
    // Target frame, party frames, cast bar and minimap are #ui children: the
    // box can end up UNDER one of them in a crowded raid, never over it.
    expect(uiZ).toBeGreaterThan(controlsZ);
    for (const entry of ['index.html', 'play.html']) {
      const html = readFileSync(new URL(`../${entry}`, import.meta.url), 'utf8');
      const ui = html.indexOf('<div id="ui"');
      const controls = html.indexOf('id="mobile-controls"');
      expect(ui).toBeGreaterThan(-1);
      expect(controls).toBeGreaterThan(ui);
      for (const id of ['target-frame', 'party-frames', 'castbar', 'minimap-wrap']) {
        const at = html.indexOf(`id="${id}"`);
        expect(at, `${entry}: #${id} is a #ui child`).toBeGreaterThan(ui);
        expect(at, `${entry}: #${id} is a #ui child`).toBeLessThan(controls);
      }
      const seat = html.indexOf('id="mobile-combat-controls"');
      expect(seat, `${entry}: the seat is in the controls layer`).toBeGreaterThan(controls);
    }
  });

  it('steps aside while chat or the Quick Actions row is open, and when empty', () => {
    const hidden = css.match(
      /body\.mobile-touch #chat-unread-box\[hidden\],\s*body\.mobile-touch\.mobile-chat-open #chat-unread-box,\s*body\.mobile-touch #mobile-menu-anchor\[aria-expanded="true"\] ~ #chat-unread-box \{([^}]*)\}/,
    )?.[1];
    expect(hidden).toMatch(/display:\s*none/);
  });

  it('keeps every row a 40px touch target and drops names and header on compact', () => {
    const button = ruleBody(`${BOX} button`);
    expect(px(button, /min-height:\s*(\d+)px/)).toBeGreaterThanOrEqual(40);
    expect(px(button, /min-width:\s*(\d+)px/)).toBeGreaterThanOrEqual(40);
    const compact = css.match(
      /body\.mobile-touch\.hud-mobile-compact #chat-unread-box \.chat-unread-head,\s*body\.mobile-touch\.hud-mobile-compact #chat-unread-box \.chat-unread-name \{([^}]*)\}/,
    )?.[1];
    expect(compact).toMatch(/display:\s*none/);
  });

  it('tells the channels apart by shape, not hue alone, and survives forced colors', () => {
    expect(ruleBody(`${BOX} [data-chan="party"] .chat-unread-dot`)).toMatch(/border-radius:\s*1px/);
    expect(ruleBody(`${BOX} [data-chan="general"] .chat-unread-dot`)).toMatch(
      /transform:\s*rotate\(45deg\)/,
    );
    expect(css).toMatch(
      /@media \(forced-colors: active\) \{\s*body\.mobile-touch #chat-unread-box \.chat-unread-dot \{\s*border:\s*2px solid CanvasText;/,
    );
    // The box joins the shared touch focus ring rather than minting its own.
    expect(css).toMatch(
      /body\.mobile-touch #chat-unread-box button:focus-visible \{\s*outline:\s*2px solid var\(--color-border-focus\);/,
    );
  });

  it('is steady: no animation, and the idle fade is off under reduced motion', () => {
    const start = css.indexOf('/* Unread chat box (chat_unread_box.ts)');
    const end = css.indexOf('/* The cancel X sits directly ON the control', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = css.slice(start, end);
    expect(block).not.toMatch(/animation|@keyframes|transform:\s*scale/);
    expect(ruleBody(BOX)).toMatch(/transition:\s*opacity/);
    expect(block).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*body\.mobile-touch #chat-unread-box \{\s*transition:\s*none;/,
    );
    expect(ruleBody('body.mobile-touch.mobile-chrome-idle #chat-unread-box')).toMatch(/opacity/);
  });

  describe('clears the target frame seat in normal and compact layouts', () => {
    const chrome = px(css, /--mobile-chrome-scale:\s*([\d.]+);/);
    const rowHeight = px(ruleBody(`${BOX} button`), /min-height:\s*(\d+)px/);
    const lift = px(ruleBody(BOX), /\+ (\d+)px\)/);
    const seatTerms = (selector: string) => {
      const body = ruleBody(selector);
      return { inset: px(body, /calc\(\s*(\d+)px \+/), centre: px(body, /\((\d+)px \* var/) };
    };
    const menuSize = (tier: string) =>
      px(
        css,
        new RegExp(
          `body\\.mobile-touch${tier.replace('.', '\\.')} \\{\\s*--menu-btn-size:\\s*calc\\((\\d+)px \\*`,
        ),
      );
    // The target seat's bottom edge, as the stylesheet itself states it: the
    // held party-below-target fallback "tracks the target seat's own top band".
    const targetBands = [
      ...css.matchAll(
        /--party-below-target-bottom, calc\(max\((\d+)px, env\(safe-area-inset-top\)\) \+ (\d+)px\)\)/g,
      ),
    ].map((m) => Number(m[1]) + Number(m[2]));
    const targetBottom = Math.max(...targetBands);

    /** The box's top edge, in px from the viewport TOP, with every row lit. */
    function boxTop(
      tier: 'compact' | 'standard' | 'tablet',
      vh: number,
      btnScale: number,
      stackedAbove = 0,
    ): number {
      const seat = seatTerms(
        tier === 'compact' ? COMPACT_SEAT : tier === 'tablet' ? TABLET_SEAT : SEAT,
      );
      const menu =
        menuSize(
          tier === 'compact'
            ? '.hud-mobile-compact'
            : tier === 'tablet'
              ? '.hud-mobile-tablet'
              : '',
        ) * chrome;
      const seatBottom = seat.inset + btnScale * (seat.centre * chrome - menu / 2);
      // Compact drops the header; the other tiers carry it above the rows.
      const rows = CHAT_UNREAD_CHANNELS.length + (tier === 'compact' ? 0 : 1);
      return vh - (seatBottom + menu * btnScale + stackedAbove + lift + rows * rowHeight);
    }

    it('reads a plausible target band out of the stylesheet', () => {
      expect(targetBands.length).toBeGreaterThanOrEqual(2);
      expect(targetBottom).toBeGreaterThan(40);
      expect(targetBottom).toBeLessThan(120);
    });

    it('matches the real-browser measurements the model was checked against', () => {
      expect(Math.round(boxTop('compact', 390, 1))).toBe(193);
      expect(Math.round(boxTop('compact', 375, 1))).toBe(178);
      expect(Math.round(boxTop('standard', 600, 1))).toBe(342);
      expect(Math.round(boxTop('tablet', 820, 1))).toBe(550);
    });

    const scales = [
      SETTING_RANGES.actionButtonScale.min,
      SETTING_RANGES.actionButtonScale.def,
      SETTING_RANGES.actionButtonScale.max,
    ];
    // Compact covers every hand-held phone in landscape; 320 is the shortest
    // screen the touch HUD is tuned for. Standard starts just above the
    // compact height cap.
    const cases: Array<['compact' | 'standard' | 'tablet', number]> = [
      ['compact', 320],
      ['compact', 360],
      ['compact', 390],
      ['compact', COMPACT_MAX_HEIGHT_PX],
      ['standard', COMPACT_MAX_HEIGHT_PX + 1],
      ['standard', 600],
      ['tablet', 768],
    ];
    for (const [tier, vh] of cases) {
      it(`${tier} at ${vh}px tall: the full box stays below the target seat`, () => {
        for (const scale of scales) {
          // 16px of air: the target's aura strip hangs just under the frame.
          expect(boxTop(tier, vh, scale), `button scale ${scale}`).toBeGreaterThan(
            targetBottom + 16,
          );
        }
      });
    }

    it('still clears it on a Seeker build, where the daily chest is stacked over the control', () => {
      const chest = ruleBody(
        'body.mobile-touch.seeker-wallet-enabled\n    #mobile-combat-controls\n    #mobile-daily-rewards:not([hidden])',
      );
      const stacked =
        px(chest, /\bheight:\s*(\d+)px/) +
        px(ruleBody('body.mobile-touch #mobile-combat-controls'), /gap:\s*(\d+)px/);
      // The Seeker phone is about 400 CSS px tall in landscape.
      for (const scale of scales) {
        expect(boxTop('compact', 400, scale, stacked), `button scale ${scale}`).toBeGreaterThan(
          targetBottom + 16,
        );
      }
    });
  });
});
