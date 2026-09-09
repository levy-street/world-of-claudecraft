// MurmurHash3 x86_128, seed 0, over UTF-16LE code units (including unpaired
// surrogates). Output is four unsigned words in order, 8 lowercase hex digits
// each. Port of Austin Appleby's public-domain reference:
// https://github.com/aappleby/smhasher/blob/master/src/MurmurHash3.cpp
// A deterministic change witness, NOT authentication or a tamper-proof hash.
const C1 = 0x239b961b;
const C2 = 0xab0e9789;
const C3 = 0x38b34ae5;
const C4 = 0xa1e38b93;

function rotate(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

function mix(value: number, before: number, bits: number, after: number): number {
  return Math.imul(rotate(Math.imul(value, before), bits), after);
}

function finish(value: number): number {
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  return value ^ (value >>> 16);
}

// Read two code units as a little-endian word without allocating a byte array.
// Out-of-range charCodeAt is NaN, which bitwise operators turn into zero.
function word(text: string, index: number): number {
  return text.charCodeAt(index) | (text.charCodeAt(index + 1) << 16);
}

export function fingerprint128(text: string): string {
  let h1 = 0;
  let h2 = 0;
  let h3 = 0;
  let h4 = 0;
  const end = text.length - (text.length % 8);
  for (let i = 0; i < end; i += 8) {
    h1 ^= mix(word(text, i), C1, 15, C2);
    h1 = (Math.imul(rotate(h1, 19) + h2, 5) + 0x561ccd1b) | 0;
    h2 ^= mix(word(text, i + 2), C2, 16, C3);
    h2 = (Math.imul(rotate(h2, 17) + h3, 5) + 0x0bcaa747) | 0;
    h3 ^= mix(word(text, i + 4), C3, 17, C4);
    h3 = (Math.imul(rotate(h3, 15) + h4, 5) + 0x96cd1c35) | 0;
    h4 ^= mix(word(text, i + 6), C4, 18, C1);
    h4 = (Math.imul(rotate(h4, 13) + h1, 5) + 0x32ac3b17) | 0;
  }
  const tail = text.length - end;
  if (tail > 6) h4 ^= mix(word(text, end + 6), C4, 18, C1);
  if (tail > 4) h3 ^= mix(word(text, end + 4), C3, 17, C4);
  if (tail > 2) h2 ^= mix(word(text, end + 2), C2, 16, C3);
  if (tail > 0) h1 ^= mix(word(text, end), C1, 15, C2);
  const bytes = text.length * 2;
  h1 ^= bytes;
  h2 ^= bytes;
  h3 ^= bytes;
  h4 ^= bytes;
  h1 = (h1 + h2 + h3 + h4) | 0;
  h2 = (h2 + h1) | 0;
  h3 = (h3 + h1) | 0;
  h4 = (h4 + h1) | 0;
  h1 = finish(h1);
  h2 = finish(h2);
  h3 = finish(h3);
  h4 = finish(h4);
  h1 = (h1 + h2 + h3 + h4) | 0;
  h2 = (h2 + h1) | 0;
  h3 = (h3 + h1) | 0;
  h4 = (h4 + h1) | 0;
  return [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, '0')).join('');
}
