import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const componentsCss = readFileSync(
  new URL('../src/styles/components.css', import.meta.url),
  'utf8',
);
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

describe('mobile bag item detail layout', () => {
  it('uses two independently scrollable columns above the narrow breakpoint', () => {
    expect(componentsCss).toMatch(
      /\.bag-item-action-layout\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1\.15fr\) minmax\(240px, 0\.85fr\);/s,
    );
    expect(componentsCss).toMatch(/\.bag-item-action-details\s*\{[^}]*overflow-y:\s*auto;/s);
    expect(componentsCss).toMatch(/\.bag-item-action-controls\s*\{[^}]*overflow-y:\s*auto;/s);
  });

  it('stacks detail before controls at 620px without horizontal overflow', () => {
    expect(componentsCss).toMatch(
      /@media \(max-width:\s*620px\)[\s\S]*?\.bag-item-action-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    expect(componentsCss).toMatch(
      /@media \(max-width:\s*620px\)[\s\S]*?\.bag-item-action-sheet\s*\{[^}]*overflow-y:\s*auto;/,
    );
  });

  it('opens the real mobile chat composer before an inserted item link takes focus', () => {
    expect(hud).toContain('this.onOpenChatComposer?.();');
    expect(main).toContain('hud.onOpenChatComposer = () => {');
    expect(main).toContain("document.body.classList.add('mobile-chat-open');");
    expect(main).toContain('openChat();');
  });
});
