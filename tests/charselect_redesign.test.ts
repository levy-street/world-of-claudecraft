// @vitest-environment jsdom
//
// The one-shot redesign editor. The token is the point: a character gets ONE
// free appearance change, so every path that could spend it without the player
// getting the design they chose (or that could leave it unspent while the
// player believes it landed) is a bug worth a test rather than a click.
//
// Pinned here: the stage always shows the DRAFT while the editor is open, a
// rejected save keeps both the token and the draft, Cancel writes nothing at
// all, and the helmet toggle is part of what Save posts (it is the character's
// standing wardrobe preference, exactly as it is at creation, not a turntable
// view that evaporates).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  relocalizeAppearancePanels,
  resetAppearancePanelsForTests,
} from '../src/ui/appearance_panel_locale';
import {
  CharselectRedesignEditor,
  type RedesignEditorDeps,
  type RedesignTarget,
} from '../src/ui/charselect_redesign';
import * as i18nModule from '../src/ui/i18n';

const TARGET: RedesignTarget = {
  id: 42,
  name: 'Oldtimer',
  class: 'rogue',
  appearance: null,
  mainhandItemId: 'dagger',
  weaponSkinId: null,
};

/** The char-select markup the editor drives, reduced to the ids it reads. */
function mountShell(): void {
  document.body.innerHTML = `
    <div id="charselect-news"></div>
    <div id="charselect-reroll" hidden>
      <div id="charselect-reroll-title"></div>
      <div id="charselect-reroll-host"></div>
      <div id="charselect-reroll-error"></div>
      <button id="btn-reroll-save"></button>
      <button id="btn-reroll-cancel"></button>
    </div>`;
}

/** A host of spies. Typed loosely on purpose: the tests read `.mock.calls` off
 *  them, which the RedesignEditorDeps signatures alone do not carry. */
function fakeDeps(over: Record<string, unknown> = {}) {
  return {
    previewModular: vi.fn(),
    restoreStage: vi.fn(),
    setPreviewName: vi.fn(),
    saveAppearance: vi.fn(async (_id: number, _app: unknown, _helmHidden: boolean) => {}),
    refreshRoster: vi.fn(async () => {}),
    errorText: (err: unknown) => String((err as Error)?.message ?? err),
    ...over,
  };
}

/** The editor takes the spy host; the cast is the test-double seam, not a
 *  loosening of the interface (a missing member still fails tsc below). */
function editorWith(deps: ReturnType<typeof fakeDeps>): CharselectRedesignEditor {
  return new CharselectRedesignEditor(deps as unknown as RedesignEditorDeps);
}

beforeEach(() => {
  mountShell();
  resetAppearancePanelsForTests();
});

describe('opening', () => {
  it('shows the panel over the news feed and drives the stage with the draft', () => {
    const deps = fakeDeps();
    editorWith(deps).open(TARGET);
    expect(document.getElementById('charselect-reroll')?.hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('charselect-news')?.hasAttribute('hidden')).toBe(true);
    expect(deps.setPreviewName).toHaveBeenCalledWith('Oldtimer');
    expect(deps.previewModular).toHaveBeenCalled();
    // The character's own gear rides the preview, not a generic class body.
    const [, , cls, mainhand] = deps.previewModular.mock.calls[0];
    expect(cls).toBe('rogue');
    expect(mainhand).toBe('dagger');
  });

  it('seeds the helm from the character rather than forcing it open', () => {
    // The toggle is a SAVED preference now, not a turntable preview, so opening
    // the editor must not decide it. A character wearing its helm opens wearing
    // it, and Save is a no-op on this field unless the player moves the row.
    const shown = fakeDeps();
    editorWith(shown).open({ ...TARGET, helmHidden: false });
    expect((shown.previewModular.mock.calls[0][1] as { head?: unknown }).head).not.toBeNull();

    const hidden = fakeDeps();
    editorWith(hidden).open({ ...TARGET, helmHidden: true });
    expect((hidden.previewModular.mock.calls[0][1] as { head?: unknown }).head).toBeNull();
  });

  it('saves the helm it was opened with when the player never touches it', async () => {
    const deps = fakeDeps();
    const editor = editorWith(deps);
    editor.open({ ...TARGET, helmHidden: false });
    await editor.save();
    // Not `true`: a redesign must not hide a helm the player never hid.
    expect(deps.saveAppearance.mock.calls[0][2]).toBe(false);
  });

  it('opening on a second character discards the first draft', () => {
    const deps = fakeDeps();
    const editor = editorWith(deps);
    editor.open(TARGET);
    editor.open({ ...TARGET, id: 43, name: 'Another' });
    expect(deps.setPreviewName).toHaveBeenLastCalledWith('Another');
    expect(editor.isOpen).toBe(true);
  });

  it('returns focus to the row that opened it, not the row before', () => {
    // Opening on a second character closes the first, and close() hands focus
    // back to whoever opened THAT one. Reading document.activeElement after the
    // close therefore captured row A's button while row B was being opened, so
    // closing B dropped a keyboard user back onto A.
    const rowA = document.createElement('button');
    const rowB = document.createElement('button');
    rowA.id = 'row-a';
    rowB.id = 'row-b';
    document.body.append(rowA, rowB);

    const editor = editorWith(fakeDeps());
    rowA.focus();
    editor.open(TARGET);
    rowB.focus();
    editor.open({ ...TARGET, id: 43, name: 'Another' });
    editor.close(true);

    expect(document.activeElement).toBe(rowB);
  });

  it('returns focus to the button that opened it on the REAL shipped path', () => {
    // The direct-open test above proves the returnFocus handoff in isolation,
    // but the actual char-select click handler is main.ts:6611-6621: it calls
    // selectRow() BEFORE open(c, opener), and selectRow's own first statement
    // is redesignEditor.close(false) on whatever editor is already open. That
    // close(false) hands focus to WHATEVER ROW OPENED THAT ONE before this
    // open() ever runs, so a fallback to document.activeElement inside open()
    // would read the wrong row. Reproduce that exact sequence: row A's editor
    // is open, then an external close(false) (standing in for selectRow) runs
    // BEFORE row B's open(), and open() is given B's button directly rather
    // than relying on activeElement (deliberately never focused here, so a
    // regression to the activeElement fallback would leave focus on A).
    const rowA = document.createElement('button');
    const rowB = document.createElement('button');
    rowA.id = 'row-a';
    rowB.id = 'row-b';
    document.body.append(rowA, rowB);

    const editor = editorWith(fakeDeps());
    rowA.focus();
    editor.open(TARGET, rowA);
    editor.close(false); // selectRow()'s close(false), external to open()
    editor.open({ ...TARGET, id: 43, name: 'Another' }, rowB);
    editor.close(true);

    expect(document.activeElement).toBe(rowB);
  });

  it('does nothing at all when the panel is not in the document', () => {
    document.body.innerHTML = '';
    const deps = fakeDeps();
    const editor = editorWith(deps);
    editor.open(TARGET);
    expect(editor.isOpen).toBe(false);
    expect(deps.previewModular).not.toHaveBeenCalled();
  });
});

describe('mobile and keyboard focus into the panel', () => {
  it('moves focus into the panel, not just to whatever opened it', () => {
    // On mobile the reroll dock flows below the roster, so a tap on a long
    // roster can leave the freshly shown panel offscreen with nothing
    // telling the player anything happened. This is the fix, on ALL form
    // factors: land focus on the panel's first control, not just the row.
    const editor = editorWith(fakeDeps());
    editor.open(TARGET);
    const panel = document.getElementById('charselect-reroll');
    expect(panel?.contains(document.activeElement)).toBe(true);
  });

  // fullyVisible is a four-conjunct AND (top >= 0 && left >= 0 && bottom <=
  // viewportHeight && right <= viewportWidth); each case below violates
  // exactly ONE conjunct while keeping the other three inside the bounds the
  // "already fully visible" test below confirms are safe, so a mutant that
  // dropped or flipped any single conjunct fails on that case alone.
  it.each([
    ['top', { top: -80, left: 0, bottom: 200, right: 320, width: 320, height: 280, x: 0, y: -80 }],
    ['left', { top: 0, left: -40, bottom: 200, right: 320, width: 360, height: 200, x: -40, y: 0 }],
    [
      'bottom',
      { top: 0, left: 0, bottom: 100_000, right: 320, width: 320, height: 100_000, x: 0, y: 0 },
    ],
    [
      'right',
      { top: 0, left: 0, bottom: 200, right: 100_000, width: 100_000, height: 200, x: 0, y: 0 },
    ],
  ])('scrolls the panel into view when %s is out of the viewport', (_dimension, rect) => {
    const panel = document.getElementById('charselect-reroll') as HTMLElement;
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      ...rect,
      toJSON: () => ({}),
    } as DOMRect);
    // jsdom ships no scrollIntoView; stub one so the call is observable.
    const scrollIntoView = vi.fn();
    (panel as unknown as { scrollIntoView: typeof scrollIntoView }).scrollIntoView = scrollIntoView;

    editorWith(fakeDeps()).open(TARGET);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('does not scroll when the panel is already fully visible', () => {
    const panel = document.getElementById('charselect-reroll') as HTMLElement;
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      top: 10,
      left: 10,
      bottom: 200,
      right: 320,
      width: 310,
      height: 190,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    } as DOMRect);
    const scrollIntoView = vi.fn();
    (panel as unknown as { scrollIntoView: typeof scrollIntoView }).scrollIntoView = scrollIntoView;

    editorWith(fakeDeps()).open(TARGET);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('escape', () => {
  it('closes and discards the draft, exactly like Cancel', () => {
    const deps = fakeDeps();
    const editor = editorWith(deps);
    editor.open(TARGET);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(editor.isOpen).toBe(false);
    expect(deps.saveAppearance).not.toHaveBeenCalled();
    expect(deps.restoreStage).toHaveBeenCalledTimes(1);
    expect(document.getElementById('charselect-reroll')?.hasAttribute('hidden')).toBe(true);
    expect(document.getElementById('charselect-news')?.hasAttribute('hidden')).toBe(false);
  });

  it('is a no-op when nothing is open', () => {
    const deps = fakeDeps();
    editorWith(deps); // never opened
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(deps.restoreStage).not.toHaveBeenCalled();
    expect(deps.saveAppearance).not.toHaveBeenCalled();
  });

  it('does not double-fire after two open/close cycles (listener leak guard)', () => {
    const deps = fakeDeps();
    const editor = editorWith(deps);
    editor.open(TARGET);
    editor.close(true);
    editor.open({ ...TARGET, id: 43, name: 'Another' });
    editor.close(true);
    deps.restoreStage.mockClear();

    // If close() failed to remove its listener, both cycles would still have
    // one attached to document, and one Escape would fire close(true) twice.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(deps.restoreStage).not.toHaveBeenCalled();
  });

  it('does not double-fire after two open/close(false) cycles either', () => {
    // close(false) is the selectRow() path (see charselect_redesign.ts
    // open()): it must remove the Escape listener exactly like close(true)
    // does. If it did not, two cycles here would leave TWO listeners on
    // document, so a bare Escape with nothing open would still find (and
    // call into) a stale one instead of being the no-op it should be.
    const deps = fakeDeps();
    const editor = editorWith(deps);
    editor.open(TARGET);
    editor.close(false);
    editor.open({ ...TARGET, id: 43, name: 'Another' });
    editor.close(false);
    deps.restoreStage.mockClear();

    expect(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
    ).not.toThrow();
    expect(deps.restoreStage).not.toHaveBeenCalled();
  });
});

describe('saving', () => {
  it('posts the draft with the helm choice, then closes and re-pulls the roster', async () => {
    const deps = fakeDeps();
    const editor = editorWith(deps);
    editor.open(TARGET);
    await editor.save();
    expect(deps.saveAppearance).toHaveBeenCalledTimes(1);
    const [characterId, app, helmHidden] = deps.saveAppearance.mock.calls[0];
    expect(characterId).toBe(42);
    expect(app).toMatchObject({ gender: expect.any(String) });
    // The helmet toggle IS saved, matching creation. It is not a preview, and
    // its value is the character's, not a default this editor invented.
    expect(helmHidden).toBe(false);
    expect(deps.refreshRoster).toHaveBeenCalledTimes(1);
    expect(editor.isOpen).toBe(false);
    expect(document.getElementById('charselect-reroll')?.hasAttribute('hidden')).toBe(true);
  });

  it('keeps the editor open with its draft when the server rejects', async () => {
    const deps = fakeDeps({
      saveAppearance: vi.fn(async () => {
        throw new Error('reroll unavailable');
      }),
    });
    const editor = editorWith(deps);
    editor.open(TARGET);
    await editor.save();
    expect(editor.isOpen).toBe(true);
    expect(deps.refreshRoster).not.toHaveBeenCalled();
    expect(document.getElementById('charselect-reroll-error')?.textContent).toBe(
      'reroll unavailable',
    );
    // Re-enabled, or a player who hit a transient error could never retry.
    expect((document.getElementById('btn-reroll-save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('posts exactly the draft the player authored, not a default', async () => {
    // Mutation check this closes: making save() post DEFAULT_APPEARANCE
    // instead of the draft stayed green, because nothing drove the customizer
    // before saving. Drive a real control (the gender row), then assert the
    // POSTED document carries the change and IS the last previewed draft.
    const deps = fakeDeps();
    const editor = editorWith(deps);
    editor.open(TARGET);
    const before = deps.previewModular.mock.calls.at(-1)![0] as { gender: string };
    const flipTo = before.gender === 'female' ? 'Male' : 'Female';
    const btn = [...document.querySelectorAll('#charselect-reroll-host button')].find(
      (b) => b.textContent?.trim() === flipTo,
    ) as HTMLButtonElement;
    expect(btn, 'gender control not found in the mounted customizer').toBeTruthy();
    btn.click();
    const previewed = deps.previewModular.mock.calls.at(-1)![0] as { gender: string };
    expect(previewed.gender).not.toBe(before.gender); // the draft really moved
    await editor.save();
    expect(deps.saveAppearance.mock.calls[0][1]).toEqual(previewed);
  });

  it('a rejected save keeps the DRAFT itself, not just the panel', async () => {
    const deps = fakeDeps({
      saveAppearance: vi
        .fn()
        .mockRejectedValueOnce(new Error('reroll unavailable'))
        .mockResolvedValueOnce(undefined),
    });
    const editor = editorWith(deps);
    editor.open(TARGET);
    const btn = [...document.querySelectorAll('#charselect-reroll-host button')].find(
      (b) => b.textContent?.trim() === 'Female',
    ) as HTMLButtonElement;
    btn.click();
    const authored = deps.previewModular.mock.calls.at(-1)![0];
    await editor.save(); // rejected
    await editor.save(); // retried
    // The retry posts the SAME authored draft: a failure did not reset it.
    const calls = (deps.saveAppearance as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toEqual(authored);
    expect(calls[1][1]).toEqual(calls[0][1]);
  });

  it('is a no-op with no editor open, so a stray click cannot spend a token', async () => {
    const deps = fakeDeps();
    await editorWith(deps).save();
    expect(deps.saveAppearance).not.toHaveBeenCalled();
  });
});

describe('cancelling', () => {
  it('writes nothing and puts the stage back on the roster selection', () => {
    const deps = fakeDeps();
    const editor = editorWith(deps);
    editor.open(TARGET);
    editor.close(true);
    expect(deps.saveAppearance).not.toHaveBeenCalled();
    expect(editor.isOpen).toBe(false);
    expect(deps.restoreStage).toHaveBeenCalledTimes(1);
    expect(document.getElementById('charselect-news')?.hasAttribute('hidden')).toBe(false);
  });

  it('leaves the stage alone when the caller is about to drive it itself', () => {
    const deps = fakeDeps();
    const editor = editorWith(deps);
    editor.open(TARGET);
    editor.close(false);
    expect(deps.restoreStage).not.toHaveBeenCalled();
  });
});

describe('drivePreview', () => {
  it('is a no-op when nothing is being redesigned', () => {
    const deps = fakeDeps();
    editorWith(deps).drivePreview();
    expect(deps.previewModular).not.toHaveBeenCalled();
  });
});

describe('title bake (locale-sweep re-mount)', () => {
  it('re-bakes the reroll title when a locale sweep re-mounts a stale panel', () => {
    // The title bakes inside mountCustomizer, not open(), so the locale-sweep
    // rebuild callback (registered via noteAppearancePanelMounted, which
    // re-invokes mountCustomizer) re-labels it too. Prove that with a real
    // re-mount rather than a static assertion: clear the baked text, force
    // the panel to read stale so relocalizeAppearancePanels() actually
    // rebuilds it, then confirm only that rebuild could have restored it.
    // Moving the bake back into open() (which a sweep never re-runs) would
    // leave the cleared text empty here.
    const deps = fakeDeps();
    const editor = editorWith(deps);
    editor.open(TARGET);
    const titleEl = document.getElementById('charselect-reroll-title') as HTMLElement;
    expect(titleEl.textContent).toContain(TARGET.name);

    titleEl.textContent = '';
    const otherLanguage = i18nModule.getLanguage() === 'de_DE' ? 'fr_FR' : 'de_DE';
    // A changed getLanguage() reading is one of the two real staleness
    // triggers the probe compares on (appearance_panel_locale.test.ts pins
    // the other: an unchanged language whose resolved TABLE moved). Spied
    // across the module boundary the same way player_look_core.test.ts spies
    // sameAppearance: appearance_panel_locale.ts imports getLanguage from a
    // different file than this test, so the spy is observed there.
    const getLanguageSpy = vi
      .spyOn(i18nModule, 'getLanguage')
      .mockReturnValue(otherLanguage as ReturnType<typeof i18nModule.getLanguage>);
    relocalizeAppearancePanels();
    getLanguageSpy.mockRestore();

    expect(titleEl.textContent).toContain(TARGET.name);
  });
});
