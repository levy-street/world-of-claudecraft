// @vitest-environment jsdom
//
// Where the [AI] account tag lands in a chat line. The channel templates are
// localized prose around two slots ('[General] {name}: {message}'), so a tag
// appended at the head of the line would read as part of the CHANNEL PREFIX, not
// as a mark on the sender. It has to sit immediately before the name, at the
// {name} slot, in every channel and in every locale.
//
// Also pins the no-raw-HTML contract: the line is assembled from nodes, never
// innerHTML, so a hostile display name or message can carry no markup into it.

import { describe, expect, it } from 'vitest';
import {
  appendChatLineParts,
  CHAT_MESSAGE_TOKEN,
  CHAT_NAME_TOKEN,
  chatAiTagEl,
} from '../src/ui/chat_line';

/** The rendered form of a channel template, with its two slots tokenized. */
const template = (prefix: string) => `${prefix}${CHAT_NAME_TOKEN}: ${CHAT_MESSAGE_TOKEN}`;

function line(rendered: string, opts: { ai?: boolean; name?: string; message?: string } = {}) {
  const div = document.createElement('div');
  const sender = document.createElement('span');
  sender.className = 'chat-player-name';
  sender.textContent = opts.name ?? 'Zyx';
  appendChatLineParts(div, rendered, {
    aiTag: opts.ai ? chatAiTagEl(document) : null,
    sender,
    appendBody: (parent) => parent.append(document.createTextNode(opts.message ?? 'hello')),
  });
  return div;
}

describe('chat line [AI] tag placement', () => {
  it('renders no tag for a normal sender', () => {
    const div = line(template('[General] '));

    expect(div.querySelector('.ai-tag')).toBeNull();
    expect(div.textContent).toBe('[General] Zyx: hello');
  });

  it('renders the tag immediately before the name, not before the channel prefix', () => {
    const div = line(template('[General] '), { ai: true });
    const tag = div.querySelector('.ai-tag');
    const sender = div.querySelector('.chat-player-name');

    expect(tag?.textContent).toBe('[AI]');
    // adjacency is the whole point: the tag's next sibling IS the name
    expect(tag?.nextSibling).toBe(sender);
    // and the channel prefix still leads the line, ahead of the tag
    expect(div.textContent).toBe('[General] [AI]Zyx: hello');
    expect(div.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(div.firstChild?.textContent).toBe('[General] ');
  });

  it('keeps the tag beside the name on a prefix-free channel (/say)', () => {
    const div = line(template(''), { ai: true });

    expect(div.firstChild).toBe(div.querySelector('.ai-tag'));
    expect(div.querySelector('.ai-tag')?.nextSibling).toBe(div.querySelector('.chat-player-name'));
  });

  // A locale that loses a slot must not lose the message. The fallback rebuilds the
  // plain "name: message" form, and the tag has to survive it in the same place.
  it('keeps the tag beside the name in the broken-template fallback', () => {
    const div = line('a template that dropped both slots', { ai: true });

    expect(div.textContent).toBe('[AI]Zyx: hello');
    expect(div.querySelector('.ai-tag')?.nextSibling).toBe(div.querySelector('.chat-player-name'));
  });

  it('injects no markup: the tag and the name are text nodes, not raw HTML', () => {
    const div = line(template('[General] '), {
      ai: true,
      name: '<img src=x onerror=alert(1)>',
      message: '<script>alert(2)</script>',
    });

    // the hostile strings survive verbatim as TEXT, and create no elements
    expect(div.querySelector('img')).toBeNull();
    expect(div.querySelector('script')).toBeNull();
    expect(div.querySelector('.chat-player-name')?.textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
    // the tag itself is the ONLY element the flair adds
    expect(div.querySelectorAll('.ai-tag')).toHaveLength(1);
    expect(div.querySelector('.ai-tag')?.children).toHaveLength(0);
  });

  it('titles the tag so a player can find out what it means', () => {
    const tag = chatAiTagEl(document);

    expect(tag.className).toBe('ai-tag');
    expect(tag.textContent).toBe('[AI]');
    expect(tag.title).toBe('AI-operated account');
  });
});

// The [AI] mark is a DISCLOSURE, not decoration: its entire job is telling a player
// they are talking to a bot. The visible glyphs are the bare literal "[AI]", and a
// `title` on a non-focusable span is announced inconsistently by assistive tech (often
// not at all), so title-only would leave a screen-reader user hearing the player's name
// with no hint an AI is behind it. That is the one failure mode this tag exists to
// prevent, so the accessible name is pinned rather than left to a code comment.
describe('the [AI] tag is announced as a disclosure, not as "[AI]"', () => {
  it('carries an accessible name that states the MEANING, not the abbreviation', () => {
    const tag = chatAiTagEl(document);
    expect(tag.getAttribute('role')).toBe('img');
    const label = tag.getAttribute('aria-label') ?? '';
    expect(label).not.toBe('');
    // the accessible name must say more than the glyphs do
    expect(label).not.toBe(tag.textContent);
    expect(label.toLowerCase()).toContain('ai');
    expect(label.length).toBeGreaterThan(String(tag.textContent).length);
  });

  it('keeps the title for the mouse as well as the aria-label for AT', () => {
    const tag = chatAiTagEl(document);
    expect(tag.title).toBe(tag.getAttribute('aria-label'));
  });
});
