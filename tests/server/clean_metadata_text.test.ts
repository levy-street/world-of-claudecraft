import { describe, expect, it } from 'vitest';
import { cleanMetadataText } from '../../server/clean_metadata_text';

describe('cleanMetadataText', () => {
  it('trims surrounding whitespace and returns the non-empty text', () => {
    expect(cleanMetadataText('  1.2.3.4  ', 128)).toBe('1.2.3.4');
  });

  it('caps the result at max characters', () => {
    expect(cleanMetadataText('abcdef', 3)).toBe('abc');
  });

  it('returns null for null, undefined, and whitespace-only input', () => {
    expect(cleanMetadataText(null, 10)).toBeNull();
    expect(cleanMetadataText(undefined, 10)).toBeNull();
    expect(cleanMetadataText('   ', 10)).toBeNull();
  });
});
