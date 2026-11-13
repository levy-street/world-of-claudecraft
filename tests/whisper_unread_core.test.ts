import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  WHISPER_UNREAD_BADGE_CAP,
  type WhisperViewState,
  whispersInView,
  whisperUnreadAfterReceive,
  whisperUnreadAfterViewChange,
  whisperUnreadBadge,
} from '../src/ui/hud/chat/whisper_unread_core';

const closed: WhisperViewState = { touch: true, logVisible: false, activeTab: 'all' };
const view = (over: Partial<WhisperViewState>): WhisperViewState => ({ ...closed, ...over });

describe('whisper unread rules', () => {
  it('counts each received whisper while the touch chat is closed', () => {
    let count = 0;
    count = whisperUnreadAfterReceive(count, closed);
    expect(count).toBe(1);
    count = whisperUnreadAfterReceive(count, closed);
    count = whisperUnreadAfterReceive(count, closed);
    expect(count).toBe(3);
  });

  it('counts with the chat closed whatever tab was left active', () => {
    expect(whisperUnreadAfterReceive(0, view({ activeTab: 'whisper' }))).toBe(1);
    expect(whisperUnreadAfterReceive(0, view({ activeTab: 'combat' }))).toBe(1);
  });

  it('counts while the open log is filtered to a tab that hides whispers', () => {
    for (const activeTab of ['say', 'general', 'party', 'combat'] as const) {
      expect(whisperUnreadAfterReceive(2, view({ logVisible: true, activeTab }))).toBe(3);
    }
  });

  it('does not count a whisper the player is already looking at', () => {
    expect(whisperUnreadAfterReceive(0, view({ logVisible: true, activeTab: 'all' }))).toBe(0);
    expect(whisperUnreadAfterReceive(0, view({ logVisible: true, activeTab: 'whisper' }))).toBe(0);
  });

  it('never counts on desktop, where the log is always on screen', () => {
    expect(whisperUnreadAfterReceive(0, view({ touch: false }))).toBe(0);
    expect(whisperUnreadAfterReceive(4, view({ touch: false }))).toBe(0);
  });

  it('clears when the log comes up on All or Whisper, and only then', () => {
    expect(whisperUnreadAfterViewChange(5, view({ logVisible: true, activeTab: 'all' }))).toBe(0);
    expect(whisperUnreadAfterViewChange(5, view({ logVisible: true, activeTab: 'whisper' }))).toBe(
      0,
    );
    expect(whisperUnreadAfterViewChange(5, view({ logVisible: true, activeTab: 'say' }))).toBe(5);
    expect(whisperUnreadAfterViewChange(5, view({ logVisible: true, activeTab: 'combat' }))).toBe(
      5,
    );
    // Switching tabs behind a closed panel shows the player nothing.
    expect(whisperUnreadAfterViewChange(5, view({ activeTab: 'whisper' }))).toBe(5);
    expect(whisperUnreadAfterViewChange(5, closed)).toBe(5);
  });

  it('drops the count when the layout leaves touch', () => {
    expect(whisperUnreadAfterViewChange(5, view({ touch: false }))).toBe(0);
  });

  it('whispersInView needs BOTH a visible log and a whisper-showing tab', () => {
    expect(whispersInView(view({ logVisible: true, activeTab: 'all' }))).toBe(true);
    expect(whispersInView(view({ logVisible: false, activeTab: 'all' }))).toBe(false);
    expect(whispersInView(view({ logVisible: true, activeTab: 'guild' }))).toBe(false);
  });

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
    expect(hud.split('noteWhisperReceived(').length - 1).toBe(1);
    const start = hud.indexOf("case 'whisper':");
    const branch = hud.slice(start, hud.indexOf('break;', start));
    const echo = branch.indexOf('CHAT_TEMPLATE_KEYS.toWhisper');
    const otherwise = branch.indexOf('else {');
    const note = branch.indexOf('this.chatWindow.noteWhisperReceived();');
    expect(echo).toBeGreaterThan(-1);
    expect(otherwise).toBeGreaterThan(echo);
    expect(note).toBeGreaterThan(otherwise);
  });
});
