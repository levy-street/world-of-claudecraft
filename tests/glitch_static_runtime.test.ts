import { describe, expect, it } from 'vitest';
import { cursorUrlForBase, installCursorCssVariables } from '../src/game/cursors';
import { sitePresenceEndpoint } from '../src/site_presence';

describe('Glitch static runtime URLs', () => {
  it('posts site presence to the configured API origin instead of the asset host', () => {
    expect(
      sitePresenceEndpoint(
        { hostname: 'glitch-game-content.s3.amazonaws.com' } as Location,
        'https://worldofclaudecraft.com/',
      ),
    ).toBe('https://worldofclaudecraft.com/api/site-presence');
  });

  it('skips site presence on Glitch static hosting when no API origin is configured', () => {
    expect(
      sitePresenceEndpoint({ hostname: 'glitch-game-content.s3.amazonaws.com' } as Location, ''),
    ).toBeNull();
  });

  it('keeps regular same-origin site presence relative', () => {
    expect(sitePresenceEndpoint({ hostname: 'worldofclaudecraft.com' } as Location, '')).toBe(
      '/api/site-presence',
    );
  });

  it('keeps runtime cursor URLs document-relative for nested Glitch build pages', () => {
    expect(cursorUrlForBase('gauntlet.png', 6, 4, 'pointer', './')).toBe(
      'url("./ui/cursors/gauntlet.png") 6 4, pointer',
    );
  });

  it('can override CSS cursor variables with document-relative URLs', () => {
    const values = new Map<string, string>();
    installCursorCssVariables({ setProperty: (name, value) => values.set(name, value) }, './');

    expect(values.get('--cursor-arrow')).toBe('url("./ui/cursors/arrow.png") 7 2, default');
    expect(values.get('--cursor-point')).toBe('url("./ui/cursors/gauntlet.png") 6 4, pointer');
    expect(values.get('--cursor-grab')).toBe('url("./ui/cursors/hand-grab.png") 11 16, grabbing');
  });
});
