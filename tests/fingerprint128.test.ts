import { describe, expect, it } from 'vitest';
import { fingerprint128 } from '../src/sim/fingerprint128';

// Generated independently by the upstream C++ MurmurHash3_x86_128 implementation
// at seed 0 from explicit UTF-16LE bytes, printing its four words as %08x.
// Every possible even-byte tail, full blocks, and Unicode encoding are pinned.
describe('fingerprint128 reference vectors', () => {
  it.each([
    ['', '00000000000000000000000000000000'],
    ['a', '033bb196ccef4fe1ccef4fe1ccef4fe1'],
    ['ab', '260fb953af22b6fdaf22b6fdaf22b6fd'],
    ['abc', '2b5b97a320f75fb55012c2b45012c2b4'],
    ['abcd', '95ef82c7e4ec9aa20a8cb00d0a8cb00d'],
    ['abcde', '4b3605de6cd4a2059a7ed1750af158b2'],
    ['abcdef', '606aa1e086f87a046d0a007998aceaac'],
    ['abcdefg', '851fde5ef81a9aab2a351f32fa8e8ca7'],
    ['abcdefgh', '6c3576558df898a1a76d230d42147114'],
    ['abcdefghi', '17a3d73237eee48604d39ee1ee7f6ddc'],
    ['abcdefghijklmno', '6d2a38537f1251126d8b3115bc98d783'],
    ['abcdefghijklmnop', 'a132e65523e3b4188b21842ef114d982'],
    ['\u0100', '8acbc432dbd5d393dbd5d393dbd5d393'],
    ['\u0000', '04a872bbedcd774bedcd774bedcd774b'],
    ['\ud83d\ude00', 'f538b0547930b89f7930b89f7930b89f'],
    ['\ud800', '95bfdb97ee4a80b7ee4a80b7ee4a80b7'],
    ['\udc00', 'ae0796eaa591e78aa591e78aa591e78a'],
    ['abcdefg\ud83d\ude00abcdefgh', '4f6c8045f403c3627b35ed5674cd5613'],
    ['x'.repeat(1000), 'd6f261ee010a59b611dba10894295556'],
  ])('matches the reference for %j', (input, expected) => {
    expect(fingerprint128(input)).toBe(expected);
  });
});
