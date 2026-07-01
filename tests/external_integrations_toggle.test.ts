import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainTs = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const hudTs = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
const optionsWindowTs = readFileSync(
  new URL('../src/ui/options_window.ts', import.meta.url),
  'utf8',
);

describe('external integrations display toggle', () => {
  it('uses the character-scoped settings profile in game', () => {
    expect(mainTs).toContain('const settings = new Settings(keybindScope)');
    expect(mainTs).toContain('activeGameSettings = settings');
  });

  it('gates Discord, GitHub, wallet and WOC entry points in main.ts', () => {
    expect(mainTs).toContain('function externalIntegrationsVisible()');
    expect(mainTs).toContain('if (!api.token || !externalIntegrationsVisible())');
    expect(mainTs).toContain('DISCORD_BUILD_ENABLED &&\n    externalIntegrationsVisible()');
    expect(mainTs).toContain('setWalletDisplayAvailable(showIntegrations &&');
    expect(mainTs).toContain('if (!externalIntegrationsVisible()) return;\n  const address');
  });

  it('gates developer badges and player-card wallet flair in HUD surfaces', () => {
    expect(hudTs).toContain("settings.get('showExternalIntegrations')");
    expect(hudTs).toContain("settings.get('showWalletOnPlayerCard')");
    expect(hudTs).toContain(
      'const tier = showExternalIntegrations ? (target.discordTier ?? 0) : 0',
    );
    expect(hudTs).toContain(
      'const tierDef = showExternalIntegrations ? holderTierByIndex(e.holderTier ?? 0)',
    );
  });

  it('removes Discord from keybind and controller remap entry points when hidden', () => {
    expect(optionsWindowTs).toContain("(a.id !== 'discord' || integrationsVisible)");
    expect(optionsWindowTs).toContain("if (a.id === 'discord' && !integrationsVisible) continue;");
  });
});
