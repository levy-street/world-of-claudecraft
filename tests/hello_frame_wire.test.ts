// src/net/hello_frame_wire.ts: the hello-frame field decodes ClientWorld reads.
import { describe, expect, it } from 'vitest';
import { helloResumeToken, softWordList } from '../src/net/hello_frame_wire';

describe('helloResumeToken', () => {
  it('reads the resume token off a hello frame, and nothing else', () => {
    expect(helloResumeToken({ resumeToken: 'r'.repeat(43) })).toBe('r'.repeat(43));
    for (const resumeToken of [undefined, null, '', 42, {}]) {
      expect(helloResumeToken({ resumeToken })).toBeNull();
    }
  });
});

describe('softWordList', () => {
  it('keeps only the string entries of a list', () => {
    expect(softWordList(['darn', 7, null, 'heck', {}])).toEqual(['darn', 'heck']);
    expect(softWordList([])).toEqual([]);
  });

  it('reads anything that is not a list as absent', () => {
    for (const raw of [undefined, null, 'darn', 3, { 0: 'darn' }]) {
      expect(softWordList(raw)).toBeNull();
    }
  });
});
