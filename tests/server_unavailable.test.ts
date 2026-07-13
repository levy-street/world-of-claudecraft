import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../public/server-unavailable.html', import.meta.url), 'utf8');

describe('server unavailable fallback page', () => {
  it('uses branded static assets and clear downtime copy', () => {
    expect(html).toContain('/loading-screen-v1.webp');
    expect(html).toContain('/site/worldofclaudecraft-logo.webp');
    expect(html).toContain('The realm is temporarily unavailable.');
    expect(html).toContain('Back soon');
    expect(html).toContain('http-equiv="refresh" content="30"');
  });
});
