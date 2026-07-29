// @vitest-environment happy-dom
//
// The deed chat link (src/ui/hud/chat/deed_chat_line.ts): the clickable
// [Deed Name] segment the unlock and broadcast announcements splice into
// their localized templates, and the splice itself. Pins the a11y wiring
// (role, tab stop, click plus Enter/Space), the token splice around real
// prose, the mangled-locale fallback (prose kept, link appended), and the
// no-raw-HTML contract (nodes only, never innerHTML).

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DEED_NAME_TOKEN, deedChatLinkEl, deedLineNodes } from '../src/ui/hud/chat/deed_chat_line';

const texts = (nodes: Node[]): string[] => nodes.map((n) => n.textContent ?? '');

it('pins the splice sentinel literal (both sides of every splice test use the constant)', () => {
  expect(DEED_NAME_TOKEN).toBe('__WOC_DEED_NAME__');
});

describe('deedChatLinkEl', () => {
  it('builds a focusable role=button span with the bracketed label', () => {
    const link = deedChatLinkEl(document, 'Veteran', () => {});
    expect(link.className).toBe('chat-deed-link');
    expect(link.textContent).toBe('[Veteran]');
    expect(link.getAttribute('role')).toBe('button');
    expect(link.tabIndex).toBe(0);
  });

  it('fires onOpen for click, Enter, and Space, and for no other key', () => {
    const onOpen = vi.fn();
    const link = deedChatLinkEl(document, 'Veteran', onOpen);
    document.body.append(link);
    link.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(onOpen).toHaveBeenCalledTimes(2);
    link.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', cancelable: true }));
    expect(onOpen).toHaveBeenCalledTimes(3);
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it('a hostile label lands as text, never markup', () => {
    const link = deedChatLinkEl(document, '<img src=x onerror=alert(1)>', () => {});
    expect(link.querySelector('img')).toBeNull();
    expect(link.textContent).toBe('[<img src=x onerror=alert(1)>]');
  });
});

describe('deedLineNodes', () => {
  it('splices the link at the token slot, prose intact on both sides', () => {
    const link = deedChatLinkEl(document, 'Veteran', () => {});
    const nodes = deedLineNodes(document, `Deed accomplished: ${DEED_NAME_TOKEN}!`, () => link);
    expect(texts(nodes)).toEqual(['Deed accomplished: ', '[Veteran]', '!']);
    expect(nodes[1]).toBe(link);
  });

  it('a token at the head of the template emits no empty leading text node', () => {
    const nodes = deedLineNodes(document, `${DEED_NAME_TOKEN} earned`, () =>
      deedChatLinkEl(document, 'Veteran', () => {}),
    );
    expect(texts(nodes)).toEqual(['[Veteran]', ' earned']);
  });

  it('a locale that repeats the slot gets a fresh link node per occurrence', () => {
    const makeLink = vi.fn(() => deedChatLinkEl(document, 'Veteran', () => {}));
    const nodes = deedLineNodes(document, `${DEED_NAME_TOKEN} and ${DEED_NAME_TOKEN}`, makeLink);
    expect(makeLink).toHaveBeenCalledTimes(2);
    expect(texts(nodes)).toEqual(['[Veteran]', ' and ', '[Veteran]']);
    expect(nodes[0]).not.toBe(nodes[2]);
  });

  it('a locale that dropped the slot keeps its prose and appends the link', () => {
    const nodes = deedLineNodes(document, 'Deed accomplished', () =>
      deedChatLinkEl(document, 'Veteran', () => {}),
    );
    expect(texts(nodes)).toEqual(['Deed accomplished ', '[Veteran]']);
  });

  it('an empty rendered template degrades to the bare link', () => {
    const nodes = deedLineNodes(document, '', () => deedChatLinkEl(document, 'V', () => {}));
    expect(texts(nodes)).toEqual(['[V]']);
  });
});

describe('no-raw-HTML contract', () => {
  it('the module builds nodes only, never innerHTML', () => {
    // Comment-stripped, so the header's own "never innerHTML" prose cannot
    // trip (or ever satisfy) the pin; only CODE is scanned. cwd-relative path:
    // happy-dom rewrites import.meta.url to an http scheme.
    const src = readFileSync('src/ui/hud/chat/deed_chat_line.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toContain('innerHTML');
    expect(src).not.toContain('insertAdjacentHTML');
  });
});
