import { describe, expect, it } from 'vitest';
import { encodeItemLink, encodeQuestLink, parseChatSegments } from '../src/ui/quest_link';

describe('quest_link', () => {
  it('encodes a questId into a token', () => {
    expect(encodeQuestLink('q_wolves')).toBe('[[q:q_wolves]]');
  });

  it('round-trips a single link embedded in text', () => {
    const text = `Check this out ${encodeQuestLink('q_wolves')}`;
    expect(parseChatSegments(text)).toEqual([
      { kind: 'text', value: 'Check this out ' },
      { kind: 'quest', questId: 'q_wolves' },
    ]);
  });

  it('parses multiple links with text between and after', () => {
    const text = `${encodeQuestLink('q_a')} and ${encodeQuestLink('q_b')} done`;
    expect(parseChatSegments(text)).toEqual([
      { kind: 'quest', questId: 'q_a' },
      { kind: 'text', value: ' and ' },
      { kind: 'quest', questId: 'q_b' },
      { kind: 'text', value: ' done' },
    ]);
  });

  it('returns plain text unchanged when there are no links', () => {
    expect(parseChatSegments('just talking')).toEqual([{ kind: 'text', value: 'just talking' }]);
  });

  it('treats malformed/empty tokens as plain text', () => {
    expect(parseChatSegments('[[q:]] [[q]] [[x:q_a]]')).toEqual([
      { kind: 'text', value: '[[q:]] [[q]] [[x:q_a]]' },
    ]);
  });

  it('handles empty string', () => {
    expect(parseChatSegments('')).toEqual([{ kind: 'text', value: '' }]);
  });

  it('encodes an itemId into a token', () => {
    expect(encodeItemLink('sword_iron')).toBe('[[i:sword_iron]]');
  });

  it('round-trips a single item link embedded in text', () => {
    const text = `Look at ${encodeItemLink('sword_iron')}!`;
    expect(parseChatSegments(text)).toEqual([
      { kind: 'text', value: 'Look at ' },
      { kind: 'item', itemId: 'sword_iron' },
      { kind: 'text', value: '!' },
    ]);
  });

  it('parses quest and item links mixed in one message', () => {
    const text = `${encodeQuestLink('q_a')} drops ${encodeItemLink('gem_ruby')}`;
    expect(parseChatSegments(text)).toEqual([
      { kind: 'quest', questId: 'q_a' },
      { kind: 'text', value: ' drops ' },
      { kind: 'item', itemId: 'gem_ruby' },
    ]);
  });

  it('treats an unknown link prefix as plain text', () => {
    expect(parseChatSegments('[[x:foo]] [[i:]]')).toEqual([
      { kind: 'text', value: '[[x:foo]] [[i:]]' },
    ]);
  });
});
