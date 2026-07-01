import { describe, expect, it, vi } from 'vitest';
import { type ItemChatLinkClick, maybeInsertItemChatLink } from '../src/ui/item_chat_link';

function click(shiftKey: boolean): ItemChatLinkClick {
  return {
    shiftKey,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

describe('maybeInsertItemChatLink', () => {
  it('inserts an item link and consumes shift-clicks', () => {
    const ev = click(true);
    const insert = vi.fn();

    expect(maybeInsertItemChatLink(ev, 'sword_iron', insert)).toBe(true);

    expect(insert).toHaveBeenCalledWith('sword_iron');
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(ev.stopPropagation).toHaveBeenCalled();
  });

  it('leaves ordinary clicks alone', () => {
    const ev = click(false);
    const insert = vi.fn();

    expect(maybeInsertItemChatLink(ev, 'sword_iron', insert)).toBe(false);

    expect(insert).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(ev.stopPropagation).not.toHaveBeenCalled();
  });

  it('ignores missing item ids', () => {
    const ev = click(true);
    const insert = vi.fn();

    expect(maybeInsertItemChatLink(ev, '', insert)).toBe(false);

    expect(insert).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(ev.stopPropagation).not.toHaveBeenCalled();
  });
});
