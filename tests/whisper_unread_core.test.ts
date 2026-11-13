import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  WHISPER_UNREAD_BADGE_CAP,
  whisperUnreadBadge,
} from '../src/ui/hud/chat/whisper_unread_core';

// The badge's print rule. The count it prints is the whisper slot of the
// unread counter, whose rules are pinned in chat_unread_core.test.ts.

describe('whisper unread badge print rule', () => {
  it('prints the count up to the cap, then the overflow form', () => {
    expect(WHISPER_UNREAD_BADGE_CAP).toBe(9);
    expect(whisperUnreadBadge(0)).toBeNull();
    expect(whisperUnreadBadge(1)).toEqual({ shown: 1, overflow: false });
    expect(whisperUnreadBadge(9)).toEqual({ shown: 9, overflow: false });
    expect(whisperUnreadBadge(10)).toEqual({ shown: 9, overflow: true });
    expect(whisperUnreadBadge(250)).toEqual({ shown: 9, overflow: true });
  });
});

describe('hud.ts wiring', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

  it('reports a whisper only from the RECEIVED branch, never the "To X" echo', () => {
    expect(hud.split("noteChatReceived('whisper'").length - 1).toBe(1);
    const start = hud.indexOf("case 'whisper':");
    const branch = hud.slice(start, hud.indexOf('break;', start));
    const echo = branch.indexOf('CHAT_TEMPLATE_KEYS.toWhisper');
    const otherwise = branch.indexOf('else {');
    const note = branch.indexOf("this.chatWindow.noteChatReceived('whisper', ev.from);");
    expect(echo).toBeGreaterThan(-1);
    expect(otherwise).toBeGreaterThan(echo);
    expect(note).toBeGreaterThan(otherwise);
  });

  it('reports party lines only when another player sent them, and never General', () => {
    const start = hud.indexOf("case 'party':", hud.indexOf("case 'chat': {"));
    const branch = hud.slice(start, hud.indexOf('break;', start));
    expect(branch).toContain(
      "if (ev.fromPid !== this.sim.playerId) this.chatWindow.noteChatReceived('party');",
    );
    // Whisper and party are the only channels that feed the touch unread badge.
    expect(hud.split('noteChatReceived(').length - 1).toBe(2);
    expect(hud).not.toContain("noteChatReceived('general')");
  });
});
