import { describe, expect, it } from 'vitest';
import { cursorUrlForBase } from '../src/game/cursors';
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

  it('does not send WOC site presence to Glitch platform web origins', () => {
    expect(
      sitePresenceEndpoint(
        {
          hostname: 'world-of-claudecraft-node.graywater-acc59434.eastus.azurecontainerapps.io',
        } as Location,
        'https://www.glitch.fun',
      ),
    ).toBe('/api/site-presence');
  });

  it('keeps runtime cursor URLs document-relative for nested Glitch build pages', () => {
    expect(cursorUrlForBase('gauntlet.png', 6, 4, 'pointer', './')).toBe(
      'url("./ui/cursors/gauntlet.png") 6 4, pointer',
    );
  });

  it('does not runtime-override stylesheet cursor variables', () => {
    expect(cursorUrlForBase('arrow.png', 7, 2, 'default', './')).toBe(
      'url("./ui/cursors/arrow.png") 7 2, default',
    );
  });
});
