// Fixed test-first: the emote-editor and inputDialog title-bar close
// controls each used to render as a bare `<span data-close>` /
// `<span data-cancel>`, giving them zero accessible name and no keyboard
// reachability (Tab could never land on them and a screen reader announced
// nothing). confirmDialog, defined one function above inputDialog in the
// same file, already used a real `<button type="button" aria-label="...">`
// for the identical title-bar control. This pins both stragglers to the
// same shape: the exact literal survives in hud.ts (so a future edit that
// regresses the tag is caught even before rendering), and parsing that
// literal's opening tag proves it is a real `<button>` carrying a non-empty
// aria-label.
//
// Kept in the default Node environment (no jsdom/happy-dom): the assertion
// only needs the opening tag of a known, self-contained literal, so a tiny
// regex parse is enough and avoids opting a pure source-pin test into a DOM
// environment for no reason (see tests/CLAUDE.md, "DOM in tests").

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const HUD_SRC = readFileSync(join(process.cwd(), 'src/ui/hud.ts'), 'utf8');

interface CloseControl {
  tag: string;
  attrs: Record<string, string>;
}

// Resolves every `${...}` interpolation in a literal template-literal source
// snippet to a distinct, deterministic, non-empty placeholder, so the result
// parses the same shape a real render would produce without hardcoding each
// interpolation's exact expression text (which would itself read as a
// template-string placeholder to the linter).
function resolveInterpolations(literal: string): string {
  let n = 0;
  return literal.replace(/\$\{[^}]*\}/g, () => `X${n++}`);
}

// Parses the single opening tag that carries `dataAttr` out of a literal
// HTML string, e.g. '<button type="button" ... data-close aria-label="X">'.
// Every title-bar close control in this file is one self-contained tag with
// no nested angle brackets in its attribute values, so this stays a plain
// regex rather than a real HTML parser.
function closeControlTag(html: string, dataAttr: 'data-close' | 'data-cancel'): CloseControl {
  const tagMatch = html.match(new RegExp(`<([a-zA-Z]+)([^>]*\\b${dataAttr}\\b[^>]*)>`));
  if (!tagMatch) throw new Error(`no ${dataAttr} control found in: ${html}`);
  const [, tag, rest] = tagMatch;
  const attrs: Record<string, string> = {};
  const attrRe = /([a-zA-Z-]+)(?:="([^"]*)")?/g;
  let attrMatch: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec-loop idiom
  while ((attrMatch = attrRe.exec(rest))) {
    attrs[attrMatch[1]] = attrMatch[2] ?? '';
  }
  return { tag: tag.toLowerCase(), attrs };
}

describe('emote editor + inputDialog title-bar close controls have real button semantics', () => {
  it('renderEmoteEditor emits a real button with a non-empty aria-label (source pin + parse)', () => {
    const literal =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal copy of hud.ts's real template-literal source, asserted verbatim below.
      '<div class="panel-title"><span>${esc(t(\'hudChrome.emoteEditor.title\'))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t(\'hudChrome.emoteEditor.close\'))}">${svgIcon(\'close\')}</button></div>';
    expect(HUD_SRC).toContain(literal);

    // Resolve the interpolations generically: proves the control is a real
    // <button>, not styling on a <span>, and carries a real accessible name,
    // without re-asserting the exact translated copy here.
    const control = closeControlTag(resolveInterpolations(literal), 'data-close');
    expect(control.tag).toBe('button');
    expect(control.attrs.type).toBe('button');
    expect(control.attrs['aria-label']).toBeTruthy();
  });

  it('inputDialog emits a real button with a non-empty aria-label, matching confirmDialog (source pin + parse)', () => {
    const literal =
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal copy of hud.ts's real template-literal source, asserted verbatim below.
      '<div class="panel-title"><span id="confirm-dialog-title">${esc(opts.title)}</span><button type="button" class="x-btn" data-cancel aria-label="${esc(opts.cancelText ?? t(\'game.talents.cancel\'))}">${svgIcon(\'close\')}</button></div>';
    expect(HUD_SRC).toContain(literal);

    const control = closeControlTag(resolveInterpolations(literal), 'data-cancel');
    expect(control.tag).toBe('button');
    expect(control.attrs.type).toBe('button');
    expect(control.attrs['aria-label']).toBeTruthy();
  });

  it('neither title-bar close control regresses to a bare <span> (the original bug shape)', () => {
    expect(HUD_SRC).not.toMatch(/<span class="x-btn" data-close>/);
    expect(HUD_SRC).not.toMatch(/<span class="x-btn" data-cancel>/);
  });
});
