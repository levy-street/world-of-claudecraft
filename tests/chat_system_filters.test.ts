import { describe, expect, it } from 'vitest';
import {
  classifyLowPrioritySystemChatMessage,
  shouldShowSystemChatMessage,
} from '../src/ui/chat_system_filters';

describe('chat system message filters', () => {
  it('classifies low-priority player presence messages', () => {
    expect(classifyLowPrioritySystemChatMessage('Mira has entered World of ClaudeCraft.')).toBe(
      'joinLeave',
    );
    expect(classifyLowPrioritySystemChatMessage('Bob has left the world. (disconnected)')).toBe(
      'joinLeave',
    );
  });

  it('classifies informational duel and arena messages', () => {
    expect(classifyLowPrioritySystemChatMessage('You have challenged Mira to a duel.')).toBe(
      'duelArena',
    );
    expect(classifyLowPrioritySystemChatMessage('Mira declines your challenge.')).toBe('duelArena');
    expect(classifyLowPrioritySystemChatMessage('The duel has begun!')).toBe('duelArena');
    expect(
      classifyLowPrioritySystemChatMessage(
        'You join the Ashen Coliseum queue. Stand by for a worthy opponent...',
      ),
    ).toBe('duelArena');
  });

  it('leaves important system messages visible', () => {
    const prefs = {
      hideJoinLeaveSystemMessages: true,
      hideDuelArenaSystemMessages: true,
    };

    expect(shouldShowSystemChatMessage('Quest completed: The Lost Satchel', prefs)).toBe(true);
    expect(shouldShowSystemChatMessage("No character named 'Zzz' exists.", prefs)).toBe(true);
    expect(shouldShowSystemChatMessage('You have been invited to a party.', prefs)).toBe(true);
  });

  it('hides only the categories the player toggled off', () => {
    expect(
      shouldShowSystemChatMessage('Mira has entered World of ClaudeCraft.', {
        hideJoinLeaveSystemMessages: true,
        hideDuelArenaSystemMessages: false,
      }),
    ).toBe(false);
    expect(
      shouldShowSystemChatMessage('The duel has begun!', {
        hideJoinLeaveSystemMessages: true,
        hideDuelArenaSystemMessages: false,
      }),
    ).toBe(true);
    expect(
      shouldShowSystemChatMessage('The duel has begun!', {
        hideJoinLeaveSystemMessages: false,
        hideDuelArenaSystemMessages: true,
      }),
    ).toBe(false);
  });
});
