// @vitest-environment happy-dom
// The Social window's presence setting (server/presence_privacy.ts): the Friends
// footer selector, its frame decode, and the /presence command it sends.
import { describe, expect, it, vi } from 'vitest';
import { socialInfoFromFrame } from '../src/net/social_frame_wire';
import { presenceSettingHtml, SocialWindow, type SocialWindowDeps } from '../src/ui/social_window';
import type { IWorld, SocialInfo } from '../src/world_api';

describe('the Social window Friends footer', () => {
  it('decodes the viewer’s own setting from the social frame, only when it is a known value', () => {
    expect(socialInfoFromFrame({ presenceMode: 'friends' }).presenceMode).toBe('friends');
    expect(socialInfoFromFrame({ presenceMode: 'invisible' }).presenceMode).toBeUndefined();
    expect('presenceMode' in socialInfoFromFrame({})).toBe(false);
  });

  it('renders the three choices with the current one selected', () => {
    const html = presenceSettingHtml('none');
    expect(html).toContain('Show me online to');
    expect(html).toContain('<option value="everyone">Everyone</option>');
    expect(html).toContain('<option value="friends">Friends only</option>');
    expect(html).toContain('<option value="none" selected>No one</option>');
  });

  function open(socialInfo: SocialInfo, chat: (text: string) => void): HTMLElement {
    document.body.innerHTML = '';
    const root = document.createElement('div');
    root.id = 'social-window';
    document.body.appendChild(root);
    const noop = (): void => {};
    const deps: SocialWindowDeps = {
      root: () => root,
      world: () =>
        ({
          playerId: 7,
          player: { id: 7, name: 'Aleron' },
          realm: 'Ashenvale',
          socialInfo,
          partyInfo: null,
          searchCharacters: async () => [],
          chat,
        }) as unknown as IWorld,
      closeOthers: noop,
      hideTooltip: noop,
      captureFocus: () => null,
      restoreFocus: noop,
      showPrompt: noop,
      startWhisper: noop,
      openSelfMenu: noop,
      openUnitMenu: noop,
      openNameMenu: noop,
      isMobileLayout: () => false,
    };
    new SocialWindow(deps).toggle();
    return root;
  }

  const roster: SocialInfo = { friends: [], blocks: [], ignores: [], guild: null, myPledge: null };

  it('sends the same /presence command a player can type when the choice changes', () => {
    const chat = vi.fn();
    const root = open({ ...roster, presenceMode: 'everyone' }, chat);
    const select = root.querySelector('select[data-field="presence"]') as HTMLSelectElement;
    expect(select, 'the Friends tab footer carries the setting').not.toBeNull();
    expect(select.value).toBe('everyone');
    select.value = 'friends';
    select.dispatchEvent(new Event('change'));
    expect(chat).toHaveBeenCalledWith('/presence friends');
  });

  it('shows no control when the server sent no setting (an older server)', () => {
    const root = open(roster, vi.fn());
    expect(root.querySelector('select[data-field="presence"]')).toBeNull();
  });
});
