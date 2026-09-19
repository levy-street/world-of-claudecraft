// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  INSPECT_OVERLAY_SELECTOR,
  MODAL_PROMPT_SELECTOR,
  releaseStorePromptHost,
  resolveStorePromptHost,
  STORE_PROMPT_HOST_ID,
} from '../src/ui/store_prompt_host';

function mountInspector(className = 'armory-inspect-overlay open'): HTMLElement {
  const inspector = document.createElement('div');
  inspector.className = className;
  document.body.appendChild(inspector);
  return inspector;
}

describe('resolveStorePromptHost', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="ui"><div id="prompt-stack"></div></div>';
  });

  it('is #prompt-stack while no inspect overlay is open', () => {
    expect(resolveStorePromptHost()).toBe(document.getElementById('prompt-stack'));
    expect(document.getElementById(STORE_PROMPT_HOST_ID)).toBeNull();
  });

  it('is null when the page has no #prompt-stack at all, inspector or not', () => {
    document.body.innerHTML = '';
    expect(resolveStorePromptHost()).toBeNull();
    mountInspector();
    expect(resolveStorePromptHost()).toBeNull();
    expect(document.getElementById(STORE_PROMPT_HOST_ID)).toBeNull();
  });

  it('mints a body-level host while an Armory inspect overlay is open', () => {
    mountInspector();
    const host = resolveStorePromptHost() as HTMLElement;
    expect(host.id).toBe(STORE_PROMPT_HOST_ID);
    // A SIBLING of #ui on <body>, never a descendant: only a body-level element
    // can outrank the body-level overlay (see the module header).
    expect(host.parentElement).toBe(document.body);
    expect(document.getElementById('ui')?.contains(host)).toBe(false);
  });

  it('serves the mount inspector too (it wears the shared overlay class)', () => {
    mountInspector('armory-inspect-overlay mount-inspect-overlay open');
    expect(resolveStorePromptHost()?.id).toBe(STORE_PROMPT_HOST_ID);
  });

  it('reuses an existing host rather than minting a second one', () => {
    mountInspector();
    const first = resolveStorePromptHost();
    const second = resolveStorePromptHost();
    expect(second).toBe(first);
    expect(document.querySelectorAll(`#${STORE_PROMPT_HOST_ID}`)).toHaveLength(1);
  });

  it('pins the overlay selector both inspectors stamp', () => {
    expect(INSPECT_OVERLAY_SELECTOR).toBe('.armory-inspect-overlay');
  });
});

describe('releaseStorePromptHost', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="ui"><div id="prompt-stack"></div></div>';
  });

  it('removes an empty body-level host', () => {
    mountInspector();
    const host = resolveStorePromptHost() as HTMLElement;
    releaseStorePromptHost(host);
    expect(document.getElementById(STORE_PROMPT_HOST_ID)).toBeNull();
  });

  it('keeps a host that still holds a prompt', () => {
    mountInspector();
    const host = resolveStorePromptHost() as HTMLElement;
    host.appendChild(document.createElement('div'));
    releaseStorePromptHost(host);
    expect(document.getElementById(STORE_PROMPT_HOST_ID)).toBe(host);
  });

  it('never removes #prompt-stack, empty or not', () => {
    const stack = resolveStorePromptHost() as HTMLElement;
    expect(stack.id).toBe('prompt-stack');
    releaseStorePromptHost(stack);
    expect(document.getElementById('prompt-stack')).toBe(stack);
  });
});

describe('MODAL_PROMPT_SELECTOR', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="ui"><div id="prompt-stack"></div></div>' +
      `<div id="${STORE_PROMPT_HOST_ID}"></div>`;
  });

  function modalPrompt(): HTMLElement {
    const prompt = document.createElement('div');
    prompt.className = 'prompt';
    prompt.setAttribute('aria-modal', 'true');
    return prompt;
  }

  it('matches an aria-modal prompt in either host and nothing else', () => {
    expect(document.querySelector(MODAL_PROMPT_SELECTOR)).toBeNull();
    const inStack = modalPrompt();
    document.getElementById('prompt-stack')?.appendChild(inStack);
    expect(document.querySelector(MODAL_PROMPT_SELECTOR)).toBe(inStack);
    inStack.remove();
    const inHost = modalPrompt();
    document.getElementById(STORE_PROMPT_HOST_ID)?.appendChild(inHost);
    expect(document.querySelector(MODAL_PROMPT_SELECTOR)).toBe(inHost);
    // A non-modal prompt (party invite, trade) stays outside the gate.
    inHost.setAttribute('aria-modal', 'false');
    expect(document.querySelector(MODAL_PROMPT_SELECTOR)).toBeNull();
  });
});
