// WCAG-chrome + no-magic source guard for the Vale Cup DOM painters
// (tests/arena_window.test.ts pattern): the queue window (vale_cup_window.ts),
// the persistent indicator button (vale_cup_indicator.ts), the in-match strip
// (vale_cup_hud.ts), and the flag chip builder (vale_cup_flag.ts).
//
// The painters' DOM methods need a document, so they are not exercised in this
// Node suite; the pure decisions they render are covered by
// tests/vale_cup_window_view.test.ts + tests/vale_cup_hud_view.test.ts. This
// guard pins the a11y-bearing markup (focusable controls + aria labels +
// focus-return), the no-magic-values contract (no literal colors in TS: the
// nation flag colors are DERIVED from the VC_NATIONS data record), the
// write-elision routing of the two per-frame painters, and the hud.ts call
// sites (mediumHud cadence, Esc routing, kickoff auto-close, relocalize
// fan-out, the offline pid filter, and the Sowfield music arm).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const windowSrc = strip(read('src/ui/vale_cup_window.ts'));
const indicatorSrc = strip(read('src/ui/vale_cup_indicator.ts'));
const hudStripSrc = strip(read('src/ui/vale_cup_hud.ts'));
const briefingSrc = strip(read('src/ui/vale_cup_briefing.ts'));
const bettingSrc = strip(read('src/ui/vale_cup_betting.ts'));
const chargeSrc = strip(read('src/ui/vale_cup_charge.ts'));
const flagSrc = strip(read('src/ui/vale_cup_flag.ts'));
const hud = read('src/ui/hud.ts');

const ALL_PAINTERS: [name: string, code: string][] = [
  ['vale_cup_window.ts', windowSrc],
  ['vale_cup_indicator.ts', indicatorSrc],
  ['vale_cup_hud.ts', hudStripSrc],
  ['vale_cup_briefing.ts', briefingSrc],
  ['vale_cup_betting.ts', bettingSrc],
  ['vale_cup_charge.ts', chargeSrc],
  ['vale_cup_flag.ts', flagSrc],
];

describe('vale_cup_window: WCAG chrome (focusable controls + focus-return)', () => {
  it('drives the panel from the pure view core', () => {
    expect(windowSrc).toContain('buildVcupView(');
  });

  it('gives the close control a real button via the shared frame builder', () => {
    // The chrome (titlebar + close button) is stamped by the shared window-frame
    // builder; the window names its own close aria key on the descriptor.
    expect(windowSrc).toContain('renderWindowFrame(');
    expect(windowSrc).toContain("closeLabelKey: 'hudChrome.vcup.close'");
  });

  it('renders bracket tabs, the nation flag grid, and roles as real buttons with aria-pressed', () => {
    for (const attr of ['data-bracket=', 'data-nation=', 'data-role=']) {
      expect(windowSrc).toContain(attr);
    }
    expect(windowSrc.match(/aria-pressed=/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    // grouped pickers carry accessible group labels
    expect(windowSrc.match(/role="group" aria-label=/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('routes every close path through close() so focus returns to the opener', () => {
    // The frame builder wires its close control to the injected onClose, which the
    // window points at close() (WCAG 2.4.3 focus-return).
    expect(windowSrc).toContain('() => this.close()');
    expect(windowSrc).toContain('this.deps.restoreFocus(this.openerFocus)');
    expect(windowSrc).toContain('this.openerFocus = this.deps.captureFocus()');
  });

  it('marks the dialog root once on open, never inside render()', () => {
    const toggle = windowSrc.slice(windowSrc.indexOf('toggle():'), windowSrc.indexOf('close():'));
    expect(toggle).toContain('markDialogRoot(');
    const render = windowSrc.slice(windowSrc.indexOf('render():'));
    expect(render).not.toContain('markDialogRoot(');
  });

  it('keeps the offline / not-yet-synced unavailable note', () => {
    expect(windowSrc).toContain("t('hudChrome.vcup.offlineNote')");
  });

  it('uses a named offline sentinel sig the live JSON sig can never collide with', () => {
    const m = windowSrc.match(/VCUP_OFFLINE_SIG\s*=\s*'([^']*)'/);
    expect(m, 'VCUP_OFFLINE_SIG literal').not.toBeNull();
    const sentinel = m ? m[1] : '';
    expect(sentinel.length).toBeGreaterThan(0);
    expect(sentinel.startsWith('[')).toBe(false);
    expect(windowSrc).toContain('this.lastSig === VCUP_OFFLINE_SIG');
    expect(windowSrc).toContain('this.lastSig = VCUP_OFFLINE_SIG');
  });
});

describe('vale_cup painters: no magic values', () => {
  it.each(ALL_PAINTERS)('%s carries no literal hex or rgb color in TS', (_name, code) => {
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    expect(hex, `hex colors: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb colors: ${rgb.join(', ')}`).toEqual([]);
  });

  it('derives the flag colors from the VC_NATIONS data record, not literals', () => {
    expect(flagSrc).toContain("from '../sim/content/vale_cup'");
    expect(flagSrc).toContain('toString(16)');
    expect(flagSrc).toContain('--vcup-field');
    expect(flagSrc).toContain('--vcup-accent');
  });

  it('escapes every interpolated name in the window painter', () => {
    // player names on the winners board + localized strings pass through esc()
    expect(windowSrc).toContain('esc(row.name)');
    expect(windowSrc).not.toMatch(/\$\{row\.name\}/);
  });
});

describe('vale_cup per-frame painters: write-elision routing', () => {
  // The indicator + match strip run from hud.update()'s mediumHud band, so
  // their per-tick writes must ride the PainterHost elided writers; the only
  // raw DOM write is the sig-gated structural innerHTML rebuild.
  it.each([
    ['vale_cup_indicator.ts', indicatorSrc],
    ['vale_cup_hud.ts', hudStripSrc],
    ['vale_cup_betting.ts', bettingSrc],
  ] as [string, string][])('%s routes per-tick writes through the writer facet', (_name, code) => {
    expect(code).toContain('writers');
    expect(code).toContain('.setText(');
    expect(code).toContain('.setDisplay(');
    // no raw per-frame style/text writes (innerHTML is the sig-gated rebuild)
    expect(code).not.toMatch(/\.textContent\s*=/);
    expect(code).not.toMatch(/\.style\.[a-zA-Z]+\s*=/);
    // the structural rebuild is gated on the text-independent sig
    expect(code).toContain('view.sig !== this.lastSig');
  });

  it('keeps the indicator a BUTTON wired once (no per-frame re-query or rebind)', () => {
    expect(indicatorSrc).toContain("addEventListener('click'");
    // resolved once in the constructor, not per update()
    expect(indicatorSrc).toContain('this.root = deps.root()');
  });

  it('keeps the match strip screen-reader calm (status role, no live spam)', () => {
    expect(hudStripSrc).toContain("setAttribute('role', 'status')");
    expect(hudStripSrc).toContain("setAttribute('aria-live', 'off')");
  });

  it('routes the shoot power meter per-tick writes through the writer facet', () => {
    // No sig here (nothing structural moves per tick): the fill width and the
    // two tint classes ride elided writers; the only raw DOM writes are the
    // one-time mount and the relocalize() remount, and the meter stays
    // aria-hidden (it visualizes a HELD key, no focusable control).
    expect(chargeSrc).toContain('writers');
    expect(chargeSrc).toContain('.setWidth(');
    expect(chargeSrc).toContain('.toggleClass(');
    expect(chargeSrc).toContain('.setDisplay(');
    expect(chargeSrc).not.toMatch(/\.textContent\s*=/);
    expect(chargeSrc).not.toMatch(/\.style\.(?!display)[a-zA-Z]+\s*=/);
    expect(chargeSrc).toContain("setAttribute('aria-hidden', 'true')");
  });
});

describe('vale_cup_briefing: WCAG overlay + write-elision', () => {
  it('drives the overlay from the pure view core', () => {
    expect(briefingSrc).toContain('VcupBriefingView');
  });

  it('shows/hides itself off view.visible (no external toggle wiring)', () => {
    expect(briefingSrc).toContain('if (!view.visible)');
    expect(briefingSrc).toContain('.setDisplay(');
  });

  it('gives the Ready button a real <button> with an aria-label, wired once', () => {
    expect(briefingSrc).toContain('class="btn vcupb-ready"');
    expect(briefingSrc).toContain("t('hudChrome.vcup.briefing.readyAria')");
    // wired inside the sig-gated skeleton branch, not per-update
    expect(briefingSrc).toContain("addEventListener('click'");
    expect(briefingSrc).toContain('this.deps.onReady()');
  });

  it('marks the dialog root once on mount, never inside update()', () => {
    const ensure = briefingSrc.slice(
      briefingSrc.indexOf('ensureRoot('),
      briefingSrc.indexOf('headerHtml('),
    );
    expect(ensure).toContain('markDialogRoot(');
    const update = briefingSrc.slice(
      briefingSrc.indexOf('update('),
      briefingSrc.indexOf('relocalize('),
    );
    expect(update).not.toContain('markDialogRoot(');
  });

  it('keeps the countdown a status region and focuses the Ready button on open', () => {
    expect(briefingSrc).toContain('role="status"');
    expect(briefingSrc).toContain('.focus()');
  });

  it('routes per-tick writes through the writer facet (sig-gated innerHTML only)', () => {
    expect(briefingSrc).toContain('writers');
    expect(briefingSrc).toContain('.setText(');
    expect(briefingSrc).toContain('.toggleClass(');
    expect(briefingSrc).not.toMatch(/\.textContent\s*=/);
    expect(briefingSrc).not.toMatch(/\.style\.[a-zA-Z]+\s*=/);
    expect(briefingSrc).toContain('view.sig !== this.lastSig');
  });

  it('teaches the kit via the ability icon system and localizes names/descriptions', () => {
    expect(briefingSrc).toContain("iconDataUrl('ability'");
    expect(briefingSrc).toContain("field: 'name'");
    expect(briefingSrc).toContain("field: 'description'");
  });

  it('escapes interpolated player names on the team sheet', () => {
    expect(briefingSrc).toContain('esc(p.name)');
    expect(briefingSrc).not.toMatch(/\$\{p\.name\}/);
  });
});

describe('vale_cup_betting: locked stakes are disabled controls, not just pointer-blocked', () => {
  // `.locked` only sets pointer-events: none, which a Tab + Enter walks straight
  // past. The stake buttons must also carry the real `disabled` attribute (the
  // window painter precedent) and the once-wired handler must refuse a locked side.
  it('writes the disabled property on lock transitions for both sides', () => {
    // The lock DECISION lives in the pure core (view.lockA/lockB, unit-tested
    // in tests/vale_cup_betting_view.test.ts); the painter only applies it.
    expect(bettingSrc).toContain('btn.disabled = view.lockA');
    expect(bettingSrc).toContain('btn.disabled = view.lockB');
  });

  it('re-applies the lock to freshly rebuilt stake buttons', () => {
    expect(bettingSrc).toContain('this.lockedA = null');
    expect(bettingSrc).toContain('this.lockedB = null');
  });

  it('early-returns a click on a locked side (keyboard defense in depth)', () => {
    // Pin the guard INCLUDING its return, so dropping the verb (leaving a
    // bare expression statement) reddens here.
    expect(bettingSrc).toContain("if (side === 'A' ? this.lockedA : this.lockedB) return;");
  });
});

describe('vale_cup_charge: painter and stylesheet stay coupled', () => {
  // The meter id and tint classes are string-coupled across hud.ts, the painter
  // markup, and components.css; a typo in any of the three silently unstyles
  // the meter, so pin all three sides here.
  const css = read('src/styles/components.css');

  it('mounts the id the stylesheet targets', () => {
    expect(hud).toContain("rootId: 'vcup-charge'");
    expect(css).toContain('#vcup-charge {');
  });

  it('renders the fill and label classes the stylesheet styles', () => {
    for (const cls of ['vcup-charge-fill', 'vcup-charge-label']) {
      expect(chargeSrc).toContain(`class="${cls}"`);
      expect(css).toContain(`.${cls}`);
    }
  });

  it('toggles the tint classes the stylesheet defines', () => {
    expect(chargeSrc).toContain("'over', view.over");
    expect(chargeSrc).toContain("'ideal', view.ideal");
    expect(css).toContain('.vcup-charge-fill.over');
    expect(css).toContain('.vcup-charge-fill.ideal');
  });
});

describe('vale_cup hud.ts call sites', () => {
  it("redraws the open window + both painters from hud.update()'s mediumHud band", () => {
    expect(hud).toContain(
      "if ($('#valecup-window').style.display === 'block') this.valeCupWindow.render();",
    );
    expect(hud).toContain(
      'this.vcupIndicator.update(buildVcupIndicatorView(this.sim.cupInfo, atSowfield));',
    );
    expect(hud).toContain('this.vcupMatchHud.update(buildVcupHudView(this.sim.cupInfo));');
    expect(hud).toContain('this.vcupBriefing.update(buildVcupBriefingView(this.sim.cupInfo));');
  });

  it('routes Esc through the painter close() (focus-return), never a raw hide', () => {
    expect(hud).toContain("case 'valecup-window':");
    expect(hud).toContain('this.valeCupWindow.close();');
    expect(hud).not.toContain("'#valecup-window').style.display = 'none'");
  });

  it('auto-closes the queue window on kickoff via close() (arena pattern)', () => {
    expect(hud).toContain(
      "if (inVcupMatch && !this.vcupMatchSeen && $('#valecup-window').style.display === 'block') {",
    );
  });

  it('re-localizes every Vale Cup surface on a language switch', () => {
    expect(hud).toContain('this.valeCupWindow.relocalize();');
    expect(hud).toContain('this.vcupIndicator.relocalize();');
    expect(hud).toContain('this.vcupMatchHud.relocalize();');
    expect(hud).toContain('this.vcupBriefing.relocalize();');
    expect(hud).toContain('this.vcupBetting.relocalize();');
    expect(hud).toContain('this.vcupCharge.relocalize();');
  });

  it('drives the shoot power meter from the pure view core, cancel clears the hold', () => {
    // The charge input state (slot + start clock) stays on the Hud; the DOM is
    // the ValeCupCharge painter fed by buildVcupChargeView, and the core's
    // cancel decision is what drops a charge held past death or match end.
    expect(hud).toContain('buildVcupChargeView(');
    expect(hud).toContain('this.vcupCharge.update(view);');
    expect(hud).toContain('if (view.cancel) this.shootChargeSlot = null;');
  });

  it('filters pid-scoped personal events of OTHER players (offline practice bots)', () => {
    // The offline loop hands the whole tick batch to handleEvents; a bot's
    // personal events must not surface on the local HUD. pid-less anchored
    // vcup theatre events pass through to walk-up bystanders.
    expect(hud).toContain('if (ev.pid !== undefined && ev.pid !== sim.playerId) continue;');
    // Cross-host parity: online the server delivers a pid-tagged event only to
    // its owner, which is what makes the offline gate correct for EVERY
    // pid-tagged event kind (types.ts: pid marks a personal, owner-only
    // event), not just the vcup ones. If either side's rule changes, change
    // both or the hosts drift.
    const serverSrc = read('server/game.ts');
    expect(serverSrc).toContain('if (ev.pid === anchorPid) {');
  });

  it('arms every vcup SimEvent kind in handleEvents', () => {
    for (const kind of [
      'vcupQueued',
      'vcupUnqueued',
      'vcupFound',
      'vcupCountdown',
      'vcupKickoff',
      'vcupGoal',
      'vcupSave',
      'vcupGolden',
      'vcupEnd',
      'vcupResult',
    ]) {
      expect(hud, `missing handleEvents arm for ${kind}`).toContain(`case '${kind}':`);
    }
  });

  it('plays the Sowfield match theme inside the stadium footprint', () => {
    expect(hud).toContain('isAtSowfield(p.pos.x, p.pos.z)');
    expect(hud).toContain("? 'vale_cup'");
  });

  it('seeds the sport hotbar form off the IWorld snapshot (cupInfo.match + my roster)', () => {
    // No phase check on purpose: the sim restores the class kit in the SAME
    // tick it nulls the match, so the form must hold through 'over' or
    // syncSlotMap would wipe the saved class bar against the sport known list.
    expect(hud).toContain("if (cupMatch && cupMatch.team !== null) return 'sport';");
    expect(hud).not.toContain("cupMatch.phase !== 'over'");
    // the sport bar never inherits the class bar, and sport ids never pollute it
    expect(hud).toContain("if (form === 'sport') return !!SPORT_ABILITIES[id];");
  });
});
