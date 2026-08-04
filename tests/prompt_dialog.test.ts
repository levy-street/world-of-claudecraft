// @vitest-environment happy-dom
// Direct behavioral pins for the shared modal prompt recipe
// (src/ui/prompt_dialog.ts), the rule-of-three extraction behind the bags,
// bank, and vendor quantity/confirm prompts. The three windows pin their
// DELEGATION to the module (source pins plus the vendor painter's behavioral
// drive); this suite pins the recipe itself, so a semantic break that keeps
// the source tokens still fails somewhere.
import { describe, expect, it } from 'vitest';
import { installPromptDialog } from '../src/ui/prompt_dialog';

function rig(withInputAriaLabel = false) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const opener = document.createElement('button');
  root.appendChild(opener);
  const prompt = document.createElement('div');
  prompt.className = 'prompt';
  prompt.innerHTML = '<div class="prompt-text">How many?</div>';
  const input = document.createElement('input');
  input.className = 'prompt-number';
  input.type = 'number';
  if (withInputAriaLabel) input.setAttribute('aria-label', 'Amount');
  const confirm = document.createElement('button');
  confirm.textContent = 'Ok';
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  prompt.append(input, confirm, cancel);
  document.body.appendChild(prompt);
  let closed = 0;
  const close = () => {
    closed += 1;
    prompt.remove();
  };
  const handle = installPromptDialog(prompt, opener, close, {
    inertRoot: root,
    idPrefix: 'test-prompt-title',
  });
  return {
    root,
    opener,
    prompt,
    input,
    confirm,
    cancel,
    handle,
    closedCount: () => closed,
    cleanup: () => {
      prompt.remove();
      root.remove();
    },
  };
}

describe('installPromptDialog: the shared modal recipe', () => {
  it('wires role, aria-modal, aria-labelledby, and names an unlabeled quantity input', () => {
    const r = rig();
    try {
      expect(r.prompt.getAttribute('role')).toBe('dialog');
      expect(r.prompt.getAttribute('aria-modal')).toBe('true');
      const title = r.prompt.querySelector('.prompt-text') as HTMLElement;
      expect(title.id).toMatch(/^test-prompt-title-\d+$/);
      expect(r.prompt.getAttribute('aria-labelledby')).toBe(title.id);
      // The anonymous number input is named by the prompt's own question.
      expect(r.input.getAttribute('aria-labelledby')).toBe(title.id);
    } finally {
      r.cleanup();
    }
  });

  it('leaves an input that carries its own aria-label alone (the better name wins)', () => {
    const r = rig(true);
    try {
      expect(r.input.getAttribute('aria-label')).toBe('Amount');
      expect(r.input.getAttribute('aria-labelledby')).toBeNull();
    } finally {
      r.cleanup();
    }
  });

  it('marks the window root inert on install; dismiss clears inert and runs the close exactly once', () => {
    const r = rig();
    try {
      expect(r.root.inert).toBe(true);
      r.handle.dismiss();
      expect(r.root.inert).toBe(false);
      expect(r.closedCount()).toBe(1);
      expect(r.prompt.isConnected).toBe(false);
    } finally {
      r.cleanup();
    }
  });

  it('dismissAndReturn clears inert BEFORE refocusing the opener (a focus into an inert subtree is dropped)', () => {
    const r = rig();
    try {
      r.input.focus();
      r.handle.dismissAndReturn();
      expect(r.root.inert).toBe(false);
      expect(document.activeElement).toBe(r.opener);
    } finally {
      r.cleanup();
    }
  });

  it('Escape tears down, returns focus, and stops both the default and the bubble', () => {
    const r = rig();
    try {
      const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      let reachedWindow = false;
      const windowSpy = () => {
        reachedWindow = true;
      };
      window.addEventListener('keydown', windowSpy);
      r.input.dispatchEvent(e);
      window.removeEventListener('keydown', windowSpy);
      expect(e.defaultPrevented).toBe(true);
      // The bubble must stop at the prompt: the input layer's window-level
      // keydown runs the global escape action (closeAll) regardless of
      // defaultPrevented, so one keypress would also shut the whole window.
      expect(reachedWindow).toBe(false);
      expect(r.closedCount()).toBe(1);
      expect(r.root.inert).toBe(false);
      expect(document.activeElement).toBe(r.opener);
    } finally {
      r.cleanup();
    }
  });

  it('Enter keeps its default while the prompt is attached and cancels it once detached', () => {
    const r = rig();
    try {
      const attached = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      let reachedWindow = false;
      const windowSpy = () => {
        reachedWindow = true;
      };
      window.addEventListener('keydown', windowSpy);
      r.confirm.dispatchEvent(attached);
      window.removeEventListener('keydown', windowSpy);
      // Native activation must survive (Enter on the confirm button)...
      expect(attached.defaultPrevented).toBe(false);
      // ...but the bubble must still stop: without it the same press reaches
      // the global chat/jump bind and steals the WCAG 2.4.3 focus return.
      expect(reachedWindow).toBe(false);
      // A submit handler at the target phase can remove the prompt DURING the
      // dispatch; the listener still runs (the event path is fixed at
      // dispatch) and must THEN cancel the default, or the browser runs the
      // activation against the freshly re-landed focus.
      r.prompt.remove();
      const detached = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      r.prompt.dispatchEvent(detached);
      expect(detached.defaultPrevented).toBe(true);
    } finally {
      r.cleanup();
    }
  });

  it('Space stops its bubble too (prompt buttons are not tag-exempt at the input layer)', () => {
    const r = rig();
    try {
      const space = new KeyboardEvent('keydown', {
        key: ' ',
        code: 'Space',
        bubbles: true,
        cancelable: true,
      });
      let reachedWindow = false;
      const windowSpy = () => {
        reachedWindow = true;
      };
      window.addEventListener('keydown', windowSpy);
      r.cancel.dispatchEvent(space);
      window.removeEventListener('keydown', windowSpy);
      expect(space.defaultPrevented).toBe(false);
      expect(reachedWindow).toBe(false);
    } finally {
      r.cleanup();
    }
  });

  it('Tab cycles inside the prompt: shift-Tab on the first control wraps to the last, Tab on the last wraps to the first', () => {
    const r = rig();
    try {
      r.input.focus();
      const back = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      r.input.dispatchEvent(back);
      expect(back.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(r.cancel);
      const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      r.cancel.dispatchEvent(forward);
      expect(forward.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(r.input);
    } finally {
      r.cleanup();
    }
  });
});
