// @vitest-environment jsdom

// The draft carrier three windows use to survive the woc:languagechange rebuild
// (#2529). The windows' own arms in language_fanout_relocalize.test.ts prove the
// happy path end to end; what is pinned here is the behavior at the edges, where
// getting it wrong is silent: a key that is not stable, a field whose `.value` is
// not its state, a focus restore that fires when focus was somewhere else, and a
// number input that throws on a selection range.

import { afterEach, describe, expect, it } from 'vitest';
import { captureFormDraft, restoreFormDraft } from '../src/ui/form_draft';

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe('form_draft: what it carries', () => {
  it('captures text inputs and textareas by id and by data-field', () => {
    const root = mount(
      '<input id="a" type="text"><textarea id="b"></textarea><input data-field="c">',
    );
    (root.querySelector<HTMLInputElement>('#a') as HTMLInputElement).value = 'one';
    (root.querySelector<HTMLTextAreaElement>('#b') as HTMLTextAreaElement).value = 'two';
    (root.querySelector<HTMLInputElement>('[data-field="c"]') as HTMLInputElement).value = 'three';
    const draft = captureFormDraft(root);

    // The rebuild: same fields, all emitted empty, exactly as innerHTML does it.
    root.innerHTML = '<input id="a" type="text"><textarea id="b"></textarea><input data-field="c">';
    restoreFormDraft(root, draft);

    expect(root.querySelector<HTMLInputElement>('#a')?.value).toBe('one');
    expect(root.querySelector<HTMLTextAreaElement>('#b')?.value).toBe('two');
    expect(root.querySelector<HTMLInputElement>('[data-field="c"]')?.value).toBe('three');
  });

  it('prefers the id when a field carries both, so one key finds it again', () => {
    const root = mount('<input id="a" data-field="other">');
    (root.querySelector<HTMLInputElement>('#a') as HTMLInputElement).value = 'kept';
    const draft = captureFormDraft(root);
    expect([...draft.values.keys()]).toEqual(['[id="a"]']);
  });

  it('skips a field with no stable key rather than guessing at its position', () => {
    const root = mount('<input type="text"><input id="a" type="text">');
    root.querySelectorAll('input')[0].value = 'anonymous';
    (root.querySelector<HTMLInputElement>('#a') as HTMLInputElement).value = 'named';
    const draft = captureFormDraft(root);
    expect([...draft.values.keys()]).toEqual(['[id="a"]']);

    // Rebuilt in the OTHER order: an index-keyed restore would put "named" into
    // the anonymous field. Keying on identity cannot.
    root.innerHTML = '<input id="a" type="text"><input type="text">';
    restoreFormDraft(root, draft);
    expect(root.querySelector<HTMLInputElement>('#a')?.value).toBe('named');
    expect(root.querySelectorAll('input')[1].value).toBe('');
  });

  it('leaves a checkbox alone: its state is .checked, not .value', () => {
    const root = mount('<input id="a" type="checkbox" value="on">');
    const box = root.querySelector<HTMLInputElement>('#a') as HTMLInputElement;
    box.checked = true;
    const draft = captureFormDraft(root);
    expect(draft.values.size).toBe(0);
  });

  it('carries a number input, which the coin and hour fields are', () => {
    const root = mount('<input id="g" type="number" value="0">');
    (root.querySelector<HTMLInputElement>('#g') as HTMLInputElement).value = '42';
    const draft = captureFormDraft(root);
    root.innerHTML = '<input id="g" type="number" value="0">';
    restoreFormDraft(root, draft);
    expect(root.querySelector<HTMLInputElement>('#g')?.value).toBe('42');
  });

  it('records the first of two fields sharing a key, the one a restore would find', () => {
    const root = mount('<input id="dup" type="text"><input id="dup" type="text">');
    const inputs = root.querySelectorAll<HTMLInputElement>('input');
    inputs[0].value = 'first';
    inputs[1].value = 'second';
    expect(captureFormDraft(root).values.get('[id="dup"]')).toBe('first');
  });

  it('survives an id and a data-field that are not legal CSS identifiers', () => {
    // A leading digit is a legal HTML id and an ILLEGAL CSS identifier, so an
    // unescaped `#2fa` makes querySelector throw SyntaxError, and that throw
    // would unwind out of relocalize and take the rest of the language fan-out
    // with it. Same for a quote or a bracket inside a data-field value.
    const root = mount('<input id="2fa" type="text"><input data-field=\'a"b]c\' type="text">');
    (root.querySelector<HTMLInputElement>('input') as HTMLInputElement).value = 'code';
    (root.querySelectorAll<HTMLInputElement>('input')[1] as HTMLInputElement).value = 'odd';
    const draft = captureFormDraft(root);
    expect(draft.values.size).toBe(2);

    root.innerHTML = '<input id="2fa" type="text"><input data-field=\'a"b]c\' type="text">';
    expect(() => restoreFormDraft(root, draft)).not.toThrow();
    const rebuilt = root.querySelectorAll<HTMLInputElement>('input');
    expect(rebuilt[0].value).toBe('code');
    expect(rebuilt[1].value).toBe('odd');
  });

  it('falls back to a data attribute of any name, including a valueless one', () => {
    // The windows key their controls on whatever data-* they already carry
    // (data-tab, data-cal-day, data-close), not on data-field specifically.
    const root = mount('<button data-close>x</button><input data-cal-day="2026-07-27">');
    (root.querySelector<HTMLInputElement>('[data-cal-day]') as HTMLInputElement).value = 'noted';
    const draft = captureFormDraft(root);
    expect([...draft.values.keys()]).toEqual(['[data-cal-day="2026-07-27"]']);

    root.innerHTML = '<button data-close>x</button><input data-cal-day="2026-07-27">';
    restoreFormDraft(root, draft);
    expect(root.querySelector<HTMLInputElement>('[data-cal-day]')?.value).toBe('noted');
  });

  it('drops a field the rebuild did not bring back rather than recreating it', () => {
    const root = mount('<input id="a" type="text">');
    (root.querySelector<HTMLInputElement>('#a') as HTMLInputElement).value = 'gone';
    const draft = captureFormDraft(root);
    root.innerHTML = '<div>read only now</div>';
    expect(() => restoreFormDraft(root, draft)).not.toThrow();
    expect(root.querySelector('#a')).toBeNull();
  });

  it('does not write a value onto a DIFFERENT element that reused the key', () => {
    const root = mount('<input id="a" type="text">');
    (root.querySelector<HTMLInputElement>('#a') as HTMLInputElement).value = 'typed';
    const draft = captureFormDraft(root);
    // The rebuild turned the editable field into read-only markup under the same
    // id (the calendar does exactly this when management rights drop).
    root.innerHTML = '<div id="a">read only now</div>';
    restoreFormDraft(root, draft);
    expect(root.querySelector('#a')?.textContent).toBe('read only now');
  });
});

describe('form_draft: focus', () => {
  it('restores focus and the caret when focus was inside the root', () => {
    const root = mount('<input id="a" type="text">');
    const input = root.querySelector<HTMLInputElement>('#a') as HTMLInputElement;
    input.value = 'Mirabel';
    input.focus();
    input.setSelectionRange(3, 5);
    const draft = captureFormDraft(root);
    expect(draft.focusKey).toBe('[id="a"]');

    root.innerHTML = '<input id="a" type="text">';
    restoreFormDraft(root, draft);
    const rebuilt = root.querySelector<HTMLInputElement>('#a') as HTMLInputElement;
    expect(document.activeElement).toBe(rebuilt);
    expect([rebuilt.selectionStart, rebuilt.selectionEnd]).toEqual([3, 5]);
  });

  it('restores focus to a BUTTON, not only to a text field', () => {
    // These windows install a Tab trap that only arms while focus is inside the
    // root, so a rebuild that dropped focus to <body> would let the next Tab
    // walk the player straight out of an open dialog.
    const root = mount('<button data-tab="send">Send</button><input id="a" type="text">');
    const button = root.querySelector('button') as HTMLButtonElement;
    button.focus();
    const draft = captureFormDraft(root);
    expect(draft.focusKey).toBe('[data-tab="send"]');
    expect(draft.selection, 'a button has no caret to record').toBeNull();

    root.innerHTML = '<button data-tab="send">Enviar</button><input id="a" type="text">';
    restoreFormDraft(root, draft);
    expect(document.activeElement).toBe(root.querySelector('button'));
  });

  it('does NOT steal focus when the player was typing somewhere else', () => {
    // The live case: the language picker is in the Options window, so at the
    // moment of the switch focus is over there, and yanking the caret into a
    // mailbox field would be worse than the stale label.
    const root = mount('<input id="a" type="text">');
    (root.querySelector<HTMLInputElement>('#a') as HTMLInputElement).value = 'draft';
    const elsewhere = document.createElement('input');
    document.body.appendChild(elsewhere);
    elsewhere.focus();

    const draft = captureFormDraft(root);
    expect(draft.focusKey).toBeNull();
    root.innerHTML = '<input id="a" type="text">';
    restoreFormDraft(root, draft);

    expect(root.querySelector<HTMLInputElement>('#a')?.value).toBe('draft');
    expect(document.activeElement).toBe(elsewhere);
  });

  it('does not focus a control the rebuild came back disabled', () => {
    // Inherited from focus_restore's restoreFirstEnabled (#2528): a disabled
    // control cannot take focus, so focusing it anyway silently drops the player
    // to <body>, which is the exact failure the whole idiom exists to prevent.
    const root = mount('<button data-act="send">Send</button>');
    (root.querySelector('button') as HTMLButtonElement).focus();
    const draft = captureFormDraft(root);
    expect(draft.focusKey).toBe('[data-act="send"]');

    root.innerHTML = '<button data-act="send" disabled>Enviar</button>';
    restoreFormDraft(root, draft);
    expect(document.activeElement).toBe(document.body);
  });

  it('leaves focus alone when the rebuild dropped the field that had it', () => {
    const root = mount('<input id="a" type="text">');
    const input = root.querySelector<HTMLInputElement>('#a') as HTMLInputElement;
    input.focus();
    const draft = captureFormDraft(root);
    root.innerHTML = '<div>gone</div>';
    expect(() => restoreFormDraft(root, draft)).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });

  it('records no caret for a number input, the shape the DOM reports as null', () => {
    // The everyday jsdom/browser shape for a non-text input, distinct from the
    // throwing shape below: selectionStart simply reads null.
    const root = mount('<input id="g" type="number" value="0">');
    const input = root.querySelector<HTMLInputElement>('#g') as HTMLInputElement;
    input.focus();
    const draft = captureFormDraft(root);
    expect(draft.focusKey).toBe('[id="g"]');
    expect(draft.selection).toBeNull();
  });

  it('survives a focused number input, whose selection range the DOM refuses', () => {
    const root = mount('<input id="g" type="number" value="0">');
    const input = root.querySelector<HTMLInputElement>('#g') as HTMLInputElement;
    input.value = '9';
    input.focus();
    // Chromium and Firefox throw InvalidStateError on both of these for a
    // number input; jsdom reports null instead, so force the throwing shape.
    Object.defineProperty(input, 'selectionStart', {
      get() {
        throw new DOMException('not a text input', 'InvalidStateError');
      },
    });
    const draft = captureFormDraft(root);
    expect(draft.focusKey).toBe('[id="g"]');
    expect(draft.selection).toBeNull();

    root.innerHTML = '<input id="g" type="number" value="0">';
    const rebuilt = root.querySelector<HTMLInputElement>('#g') as HTMLInputElement;
    rebuilt.setSelectionRange = () => {
      throw new DOMException('not a text input', 'InvalidStateError');
    };
    expect(() => restoreFormDraft(root, { ...draft, selection: [0, 1] })).not.toThrow();
    expect(rebuilt.value).toBe('9');
  });
});
