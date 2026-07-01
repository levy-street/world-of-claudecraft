import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../public/server-unavailable.html', import.meta.url), 'utf8');

describe('server unavailable fallback page', () => {
  it('uses branded static assets and clear downtime copy', () => {
    expect(html).toContain('/loading-screen.jpg');
    expect(html).toContain('/worldofclaudecraft-logo.png');
    expect(html).toContain('The realm is temporarily unavailable.');
    expect(html).toContain('Back soon');
    expect(html).toContain('http-equiv="refresh" content="30"');
  });
  it('compensates eyebrow letter spacing so the maintenance label stays centered', () => {
    const eyebrowRule = html.match(/\.eyebrow\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
    const maxWidth = eyebrowRule.match(/max-width:\s*(?<value>[^;]+);/)?.groups?.value;
    const letterSpacing = eyebrowRule.match(/letter-spacing:\s*(?<value>[^;]+);/)?.groups?.value;
    const textIndent = eyebrowRule.match(/text-indent:\s*(?<value>[^;]+);/)?.groups?.value;

    expect(maxWidth).toBe('none');
    expect(letterSpacing).toBe('0.16em');
    expect(textIndent).toBe(letterSpacing);
  });
});
