import { describe, expect, it } from 'vitest';
import { resolveHudAuraIconId, resolveHudAuraIconUrl } from '../src/ui/aura_icon_runtime';
import { storePrewarmedProceduralIconDataUrl } from '../src/ui/icons';

describe('HUD aura icon runtime', () => {
  it('serves exact painted aura art over the static combat crest on a cold cache', () => {
    const iconId = resolveHudAuraIconId({ id: 'cheater_mark', kind: 'cheater_mark' });

    expect(iconId).toBe('cheater_mark');
    expect(resolveHudAuraIconUrl(iconId)).toBe(
      'url(/ui/auras/cheater_mark.webp), url(/ui/crests/status/combat.webp)',
    );
  });

  it('reuses painted ability art for a generated runtime aura identity', () => {
    const iconId = resolveHudAuraIconId({ id: 'counter_shot_lockout', kind: 'lockout' });

    expect(iconId).toBe('counter_shot');
    expect(resolveHudAuraIconUrl(iconId)).toBe(
      'url(/ui/skills/hunter/counter_shot.webp), url(/ui/crests/status/combat.webp)',
    );
  });

  it('layers painted art over an already-warmed procedural fallback', () => {
    const iconId = resolveHudAuraIconId({ id: 'stomp_stun', kind: 'stun' });
    const warmedUrl = 'data:image/png;base64,cGFpbnRlZC1hdXJhLWZhbGxiYWNr';
    storePrewarmedProceduralIconDataUrl('aura', iconId, 96, warmedUrl);

    expect(iconId).toBe('stomp_stun');
    expect(resolveHudAuraIconUrl(iconId)).toBe(`url(/ui/auras/stomp_stun.webp), url(${warmedUrl})`);
  });

  it('uses an already-warmed procedural fallback without foreground canvas work', () => {
    const iconId = resolveHudAuraIconId({
      id: '__runtime_aura_icon_probe__',
      kind: 'runtime_probe',
    });
    const warmedUrl = 'data:image/png;base64,cnVudGltZS1hdXJhLWZhbGxiYWNr';
    storePrewarmedProceduralIconDataUrl('aura', iconId, 96, warmedUrl);

    expect(iconId).toBe('aura_runtime_probe');
    expect(resolveHudAuraIconUrl(iconId)).toBe(`url(${warmedUrl})`);
  });
});
