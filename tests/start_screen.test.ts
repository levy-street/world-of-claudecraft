import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('start screen mode actions', () => {
  it('uses semantic buttons for primary play mode actions', () => {
    expect(indexHtml).toContain('<button type="button" class="mode-card panel" id="btn-online"');
    expect(indexHtml).toContain('<button type="button" class="mode-card panel" id="btn-offline"');
    expect(indexHtml).not.toContain('id="btn-online" role="button"');
    expect(indexHtml).not.toContain('id="btn-offline" role="button"');
    expect(indexHtml).not.toContain('<h2>Play Online</h2>');
    expect(indexHtml).not.toContain('<p>Log in to the realm.');
  });
});
