// The Fire and Fly seat HUD's stylesheet contract (turret_hud_painter.ts builds the
// DOM these rules dress): the strip and the rail never take the aim's pointer, only
// Leave does; the seat hides the player frame and the XP rail while the cannon keeps
// its own lift; touch keeps Leave at the 40px floor; forced colors keep the rail
// readable. Pinned by text because a dropped or renamed rule fails silently in the
// browser.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TURRET_SEATED_CLASS } from '../src/ui/hud/vehicle/turret_hud_controller';
import { TURRET_HUD_ID, TURRET_RAIL_ID } from '../src/ui/hud/vehicle/turret_hud_painter';
import { TURRET_WEAPONS_ID } from '../src/ui/hud/vehicle/turret_weapon_bar_painter';

const flat = (path: string) =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');
const hud = flat('src/styles/hud.css');
const mobile = flat('src/styles/hud.mobile.css');

/** The declarations of the rule whose WHOLE selector is `selector` (never one arm of a list). */
function declarationsFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|[{}]) ?${escaped} \\{`).exec(css);
  expect(match, `no rule for ${selector}`).not.toBeNull();
  const open = css.indexOf('{', (match?.index ?? 0) + 1 + selector.length);
  return css.slice(open + 1, css.indexOf('}', open)).trim();
}

describe('the Fire and Fly seat HUD stylesheet', () => {
  it('keeps the strip and the rail pointer-inert, with Leave and Replay the live targets', () => {
    expect(declarationsFor(hud, `#${TURRET_HUD_ID}`)).toContain('pointer-events: none;');
    expect(declarationsFor(hud, `#${TURRET_RAIL_ID}`)).toContain('pointer-events: none;');
    expect(declarationsFor(hud, '.turret-leave')).toContain('pointer-events: auto;');
    expect(declarationsFor(hud, '.turret-replay')).toContain('pointer-events: auto;');
  });

  it('centres Replay and Leave as one pair under the ended card', () => {
    const ended = declarationsFor(hud, `#${TURRET_HUD_ID}.ended`);
    expect(ended).toContain('grid-template-columns: minmax(0, 1fr) auto auto minmax(0, 1fr);');
    expect(ended).toContain('grid-template-areas: "card card card card" ". replay leave .";');
    expect(declarationsFor(hud, '.turret-replay')).toContain('grid-area: replay;');
    expect(declarationsFor(hud, '.turret-replay')).not.toContain('justify-self');
  });

  it('seats the strip at the top centre and the rail on the action-rail width at the bottom', () => {
    const strip = declarationsFor(hud, `#${TURRET_HUD_ID}`);
    expect(strip).toContain('top: 8px;');
    expect(strip).toContain('left: 50%;');
    expect(strip).toContain('transform: translateX(-50%);');
    const rail = declarationsFor(hud, `#${TURRET_RAIL_ID}`);
    expect(rail).toContain('bottom: 26px;');
    expect(rail).toContain('var(--action-rail-w)');
  });

  it('hides the player frame and the XP rail only under the seat class', () => {
    expect(declarationsFor(hud, `body.${TURRET_SEATED_CLASS} :is(#player-frame, #xpbar)`)).toBe(
      'display: none !important;',
    );
    expect(
      declarationsFor(
        hud,
        `body.operating-vehicle:not(.${TURRET_SEATED_CLASS}) #player-frame:not(.pf-detached)`,
      ),
    ).toBe('margin-bottom: 250px;');
    expect(hud).not.toContain('turret-bar');
    expect(mobile).not.toContain('turret-bar');
  });

  it('keeps the rail number outside the fill and lays the hit glow on the unclipped wrapper', () => {
    expect(declarationsFor(hud, '.turret-rail-value')).toContain('left: calc(100% + 10px);');
    expect(declarationsFor(hud, '.turret-rail-caption')).toContain('right: calc(100% + 10px);');
    const wrapper = declarationsFor(hud, '.turret-rail-bar');
    expect(wrapper).toContain('box-shadow:');
    expect(wrapper).toContain('translate:');
    expect(declarationsFor(hud, '.turret-rail-fill')).toContain(
      'transform: scaleX(var(--turret-integrity, 1));',
    );
  });

  it('unfolds the result card only in the ended state', () => {
    expect(declarationsFor(hud, '.turret-card')).toContain('display: none;');
    expect(declarationsFor(hud, `#${TURRET_HUD_ID}.ended .turret-card`)).toContain(
      'display: grid;',
    );
    expect(
      declarationsFor(hud, `#${TURRET_HUD_ID}.ended :is(.turret-strip-wave, .turret-strip-slot)`),
    ).toBe('display: none;');
  });

  it("tints the card's medal line with the rankings' medal colours, never the name alone", () => {
    const tints = {
      gold: 'var(--color-wq-ranking-gilt)',
      silver: 'var(--color-ranking-place-second)',
      bronze: 'var(--color-ranking-place-third)',
    };
    for (const [medal, tint] of Object.entries(tints)) {
      expect(declarationsFor(hud, `.turret-card-medal--${medal}`)).toContain(
        `--turret-medal-tint: ${tint};`,
      );
    }
    expect(declarationsFor(hud, '.turret-card-medal-icon')).toContain(
      'background: var(--turret-medal-tint, var(--color-border-default));',
    );
    expect(declarationsFor(hud, '.turret-card-total')).toBe('grid-column: 1 / -1;');
  });

  it('keeps the card, medal and points included, above the rail on a short screen', () => {
    const compact = /@media \(max-height: (\d+)px\) \{ #turret-hud\.ended \.turret-card \{/.exec(
      hud,
    );
    expect(compact).not.toBeNull();
    const side = hud.slice(compact?.index);
    expect(declarationsFor(side, '.turret-card-kicker')).toBe('display: none;');
    expect(declarationsFor(side, '.turret-card-stats')).toBe('--stat-row-h: 16px;');
    expect(declarationsFor(side, '.turret-card-stats .ui-stat-row')).toBe('line-height: 16px;');
    expect(declarationsFor(side, `#${TURRET_HUD_ID}.ended .turret-card`)).toBe('gap: 4px;');
    // The first desktop height the full card shows at, laid under the banner lane, clears
    // the rail: the card's height as the result probe measured it at 1920x1080.
    const fullCardPx = 313;
    const first = Number(compact?.[1]) + 1;
    const top = /top: calc\((\d+)% \+ (\d+)px\);/.exec(
      declarationsFor(
        hud.slice(hud.indexOf('@media (max-height: 820px) {')),
        `#${TURRET_HUD_ID}.ended`,
      ),
    );
    const railBottom = Number(
      /bottom: (\d+)px;/.exec(declarationsFor(hud, `#${TURRET_RAIL_ID}`))?.[1],
    );
    const railHeight = Number(
      /height: (\d+)px;/.exec(declarationsFor(hud, '.turret-rail-bevel'))?.[1],
    );
    const cardBottom = (first * Number(top?.[1])) / 100 + Number(top?.[2]) + fullCardPx;
    expect(cardBottom).toBeLessThanOrEqual(first - railBottom - railHeight);
  });

  it('drops the result card under the banner lane on a short screen', () => {
    const bannerTop = /top: (\d+%);/.exec(declarationsFor(hud, '#banner'))?.[1];
    expect(bannerTop).toBe('28%');
    const short = hud.slice(hud.indexOf('@media (max-height: 820px) {'));
    expect(declarationsFor(short, `#${TURRET_HUD_ID}.ended`)).toBe(
      `top: calc(${bannerTop} + 56px);`,
    );
  });

  it('folds the rail caption and number inside the rail band on a narrower desktop', () => {
    const narrow = hud.slice(hud.indexOf('@media (max-width: 1600px) {'));
    expect(declarationsFor(narrow, `body:not(.mobile-touch) #${TURRET_RAIL_ID}`)).toContain(
      'display: flex;',
    );
    expect(
      declarationsFor(
        narrow,
        'body:not(.mobile-touch) :is(.turret-rail-caption, .turret-rail-value)',
      ),
    ).toBe('position: static; transform: none;');
    expect(declarationsFor(narrow, 'body:not(.mobile-touch) .turret-rail-bar')).toContain(
      'flex: 1;',
    );
    expect(declarationsFor(narrow, 'body:not(.mobile-touch) .turret-rail-value')).toBe(
      'min-width: 7ch;',
    );
  });

  it('gives the rail a forced-colors meter', () => {
    const forced = hud.slice(hud.indexOf('.turret-rail-bevel { forced-color-adjust: none;'));
    expect(forced).toContain('border: 1px solid CanvasText;');
    expect(declarationsFor(forced, '.turret-rail-fill')).toBe('background: Highlight;');
  });

  it('keeps Leave at the touch floor without a keycap, and the card under the touch banner', () => {
    const leave = declarationsFor(mobile, 'body.mobile-touch .turret-leave');
    expect(leave).toContain('min-width: 40px;');
    expect(leave).toContain('height: 40px;');
    expect(declarationsFor(mobile, 'body.mobile-touch .turret-leave .ui-keycap')).toBe(
      'display: none;',
    );
    const replay = declarationsFor(mobile, 'body.mobile-touch .turret-replay');
    expect(replay).toContain('min-width: 40px;');
    expect(replay).toContain('height: 40px;');
    expect(declarationsFor(mobile, `body.mobile-touch #${TURRET_HUD_ID}.ended`)).toContain(
      'top: calc(18% + 44px);',
    );
  });

  it('keeps the whole card, countdown included, on screen and clear of the rail on a phone on its side', () => {
    const at = mobile.indexOf('@media (max-height: 480px) { body.mobile-touch #turret-hud.ended {');
    expect(at).toBeGreaterThan(-1);
    const short = mobile.slice(at, mobile.indexOf('body.mobile-touch #turret-rail {', at));
    const ended = `body.mobile-touch #${TURRET_HUD_ID}.ended`;
    const block = declarationsFor(short, ended);
    expect(block).toContain('max-width: min(400px, calc(100% - 24px));');
    expect(block).toContain('row-gap: 6px;');
    expect(block).toContain('padding: 6px 12px 8px;');
    const card = declarationsFor(short, `${ended} .turret-card`);
    expect(card).toContain('display: flex;');
    expect(card).toContain('flex-wrap: wrap;');
    expect(card).toContain('gap: 3px 12px;');
    expect(
      declarationsFor(
        short,
        `${ended} .turret-card > :not(.turret-card-verdict, .turret-card-medal)`,
      ),
    ).toBe('flex-basis: 100%;');
    expect(declarationsFor(short, `${ended} .turret-card-verdict`)).toBe(
      'font-size: 17px; line-height: 20px;',
    );
    expect(declarationsFor(short, `${ended} .turret-card-medal`)).toBe('font-size: 14px;');
    expect(declarationsFor(short, `${ended} .turret-card-stats`)).toBe('--stat-row-h: 14px;');
    expect(declarationsFor(short, `${ended} .turret-card-stats .ui-stat-row`)).toBe(
      'line-height: 14px;',
    );
    expect(declarationsFor(short, `${ended} .turret-card-leaving`)).toBe(
      'font-size: 11px; line-height: 13px;',
    );
    // The card's top follows the height but its rows do not, so on the shortest phones
    // it reaches the rail: the rail steps aside once the run is over.
    expect(declarationsFor(short, `${ended} ~ #${TURRET_RAIL_ID}`)).toBe('display: none;');
    // Replay and Leave keep the 40px touch floor: the short block never resizes them.
    expect(short).not.toMatch(/turret-(leave|replay)/);
    // The card with its countdown line, as the result probe measured it under the
    // declarations pinned above, stays on screen at 320px, the small-android profile
    // (scripts/mobile_input_zoom_check.mjs) on its side.
    const cardWithCountdownPx = 210;
    const height = 320;
    const top = /top: calc\((\d+)% \+ (\d+)px\);/.exec(declarationsFor(mobile, ended));
    const cardBottom = (height * Number(top?.[1])) / 100 + Number(top?.[2]) + cardWithCountdownPx;
    expect(cardBottom).toBeLessThanOrEqual(height);
  });

  it('seats the two 44px weapon sockets 6px above the rail, the row inert and each socket live', () => {
    const row = declarationsFor(hud, `#${TURRET_WEAPONS_ID}`);
    // The rail sits at 26px with an 18px bevel: 26 + 18 + 6.
    expect(row).toContain('bottom: 50px;');
    expect(row).toContain('left: 50%;');
    expect(row).toContain('transform: translateX(-50%);');
    expect(row).toContain('gap: 8px;');
    expect(row).toContain('pointer-events: none;');
    const socket = declarationsFor(hud, `#${TURRET_WEAPONS_ID} .turret-weapon`);
    expect(socket).toContain('--ui-socket-size: 44px;');
    expect(socket).toContain('pointer-events: auto;');
  });

  it("puts the touch sockets in the idle move stick's corner, at 48px and keyless", () => {
    expect(
      declarationsFor(
        mobile,
        `body.mobile-touch.${TURRET_SEATED_CLASS} :is(#mobile-move-zone, #mobile-move-joystick)`,
      ),
    ).toBe('display: none;');
    const row = declarationsFor(mobile, `body.mobile-touch #${TURRET_WEAPONS_ID}`);
    expect(row).toContain('left: max(18px, env(safe-area-inset-left));');
    expect(row).toContain('bottom: calc(26px + env(safe-area-inset-bottom));');
    expect(row).toContain('transform: none;');
    expect(
      declarationsFor(mobile, `body.mobile-touch.mobile-left-handed #${TURRET_WEAPONS_ID}`),
    ).toContain('right: max(18px, env(safe-area-inset-right));');
    expect(
      declarationsFor(mobile, `body.mobile-touch #${TURRET_WEAPONS_ID} .turret-weapon`),
    ).toContain('--ui-socket-size: 48px;');
    expect(declarationsFor(mobile, `body.mobile-touch #${TURRET_WEAPONS_ID} .keybind`)).toBe(
      'display: none;',
    );
  });
});
