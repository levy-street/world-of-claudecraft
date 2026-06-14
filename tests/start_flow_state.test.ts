import { describe, expect, it } from 'vitest';
import { startFlowStatusText } from '../src/ui/start_flow_state';

describe('startFlowStatusText', () => {
  it('names the auth transition while login is in flight', () => {
    expect(startFlowStatusText({
      state: 'authenticating',
      panel: '#login-panel',
      hasGame: false,
    })).toBe('Online: signing in...');
  });

  it('includes the selected realm while characters are loading', () => {
    expect(startFlowStatusText({
      state: 'character-loading',
      panel: '#charselect-panel',
      hasGame: false,
      realm: 'Azeroth',
    })).toBe('Online: loading characters on Azeroth...');
  });

  it('distinguishes an empty character list from a hidden or blank panel', () => {
    expect(startFlowStatusText({
      state: 'character-empty',
      panel: '#charselect-panel',
      hasGame: false,
      realm: 'Azeroth',
      characterCount: 0,
    })).toBe('Online: no characters on Azeroth yet.');
  });

  it('reports character load failures without implying the game has started', () => {
    expect(startFlowStatusText({
      state: 'character-error',
      panel: '#charselect-panel',
      hasGame: false,
      error: 'not authenticated',
    })).toBe('Online: could not load characters: not authenticated');
  });
});
