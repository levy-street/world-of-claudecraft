import { describe, expect, it } from 'vitest';
import { absolutePublishedCardUrl, type PublishedCard } from '../src/ui/player_card_share';

describe('shareable player card URL contract', () => {
  it('normalizes server-relative card paths against the selected realm origin', () => {
    const url = absolutePublishedCardUrl('/p/sir-test', 'https://realm.example', 'https://page.example');
    const card: PublishedCard = { url };

    expect(card.url).toBe('https://realm.example/p/sir-test');
  });

  it('falls back to the page origin when the selected realm is the page realm', () => {
    expect(absolutePublishedCardUrl('/p/sir-test', '', 'https://page.example')).toBe('https://page.example/p/sir-test');
  });

  it('preserves already absolute card URLs', () => {
    expect(
      absolutePublishedCardUrl('https://cards.example/p/sir-test', 'https://realm.example', 'https://page.example'),
    ).toBe('https://cards.example/p/sir-test');
  });
});
