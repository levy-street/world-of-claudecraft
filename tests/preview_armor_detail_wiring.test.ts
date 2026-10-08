// The call sites that put the preview's armor detail rule to work
// (src/render/characters/preview_armor_detail_core.ts). The rule and the preview are pinned
// through real objects (tests/preview_armor_detail.test.ts); what those cannot see is that the
// two hosts still CALL them. Character creation in src/main.ts must stage a class through the
// creator's own entry: staging it as a real character's look fetches the top file of every
// class flipped through again, with every other suite green. And the HUD must hand the shared
// turntable its subject through applyPreviewSubject alone, with the Inspect stage named as
// such: that call is where a stage says whose character it shows.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { methodBody } from './helpers/method_body';
import { stripComments } from './helpers/strip_comments';

const main = stripComments(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'));
const hud = stripComments(readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8'));

/** A top-level function of src/main.ts, from its opener through its own closing brace. */
function topLevel(source: string, opener: string): string {
  const start = source.indexOf(opener);
  if (start === -1) throw new Error(`anchor not found: ${opener}`);
  const end = source.indexOf('\n}', start);
  if (end === -1) throw new Error(`no top-level close after: ${opener}`);
  return source.slice(start, end);
}

const count = (source: string, needle: string): number => source.split(needle).length - 1;

describe('character creation stages its classes through the creator entry', () => {
  it('previewClassBody, the one function every class chip and stage change goes through', () => {
    const body = topLevel(main, 'function previewClassBody(');
    expect(body).toContain('characterPreview.setCreationClass(look.app, look.worn, cls)');
    expect(body).not.toContain('setModular(');
  });

  it('the appearance editor of the creation panels: its stage, and every look it stages', () => {
    const body = topLevel(main, 'function syncAppearanceUi(');
    // the stage the face builder tells when the player chooses the character on it
    expect(body).toContain('stage: () => characterPreview');
    expect(body).toContain('characterPreview?.setCreationClass(next, creationLoadout(c), c)');
    expect(body).toContain(
      'characterPreview?.setCreationClass(modularAppearance, creationLoadout(c), c)',
    );
    expect(body).not.toContain('setModular(');
  });

  it('and nowhere else: a real character is never staged as a class being browsed', () => {
    expect(count(main, 'setCreationClass(')).toBe(3);
    for (const opener of ['function showCharselectCharacter(', 'const redesignEditor = new ']) {
      const body = topLevel(main, opener);
      expect(body, opener).toContain('characterPreview.setModular(');
      expect(body, opener).not.toContain('setCreationClass(');
    }
    // the roster's pick and the redesign draft are the only looks staged as a character's own
    expect(count(main, 'characterPreview.setModular(')).toBe(2);
    expect(count(main, 'characterPreview?.setModular(')).toBe(0);
  });
});

describe('the HUD says whose character its shared turntable shows', () => {
  it('mounts every subject through applyPreviewSubject, where the stage is told', () => {
    expect(methodBody(hud, 'private mountSharedPreview(')).toContain(
      'applyPreviewSubject(this.charPreview, opts)',
    );
    // a subject mounted any other way would keep whatever the last stage said
    expect(hud).not.toMatch(
      /charPreview\??\.(setModular|setClass|setAppearance|setVisualKey|setCreationClass|setArmorSurface)\(/,
    );
  });

  it('names the Inspect stage and the own sheet by their framing', () => {
    const inspect = methodBody(hud, 'private mountInspectPreview(');
    expect(inspect).toContain('this.mountSharedPreview(container, {');
    expect(inspect).toContain("framing: 'inspect'");
    expect(inspect).not.toContain("framing: 'sheet'");
    const sheet = methodBody(hud, 'private mountCharPreview(');
    expect(sheet).toContain('this.mountSharedPreview(container, {');
    expect(sheet).toContain("framing: 'sheet'");
    expect(sheet).not.toContain("framing: 'inspect'");
  });
});
