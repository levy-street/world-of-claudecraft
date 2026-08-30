function normalizedWord(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function roundedTime(value) {
  return Number(value.toFixed(3));
}

export function shouldUseScribeFallback(status, detail) {
  return status === 401 && detail.includes('forced_alignment');
}

export function validateWordAlignment(alignment, label) {
  if (!Array.isArray(alignment?.words) || alignment.words.length === 0) {
    throw new Error(`${label} returned no words`);
  }
  for (const [index, word] of alignment.words.entries()) {
    if (
      typeof word?.text !== 'string' ||
      !Number.isFinite(word.start) ||
      !Number.isFinite(word.end) ||
      word.start < 0 ||
      word.end < word.start
    ) {
      throw new Error(`${label} word ${index + 1} has invalid timestamps`);
    }
  }
  return alignment;
}

export function validateCharacterAlignment(alignment, label = 'Character alignment') {
  const characters = alignment?.characters;
  const starts = alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;
  if (!Array.isArray(characters) || !Array.isArray(starts) || !Array.isArray(ends)) {
    throw new Error(`${label} must contain characters, start times, and end times`);
  }
  if (characters.length !== starts.length || characters.length !== ends.length) {
    throw new Error(`${label} arrays must have equal lengths`);
  }
  if (characters.length === 0) throw new Error(`${label} returned no character timings`);
  for (let index = 0; index < characters.length; index++) {
    if (
      typeof characters[index] !== 'string' ||
      !Number.isFinite(starts[index]) ||
      !Number.isFinite(ends[index]) ||
      starts[index] < 0 ||
      ends[index] < starts[index]
    ) {
      throw new Error(`${label} entry ${index + 1} has invalid timestamps`);
    }
  }
  return alignment;
}

export function phraseClipBounds(words, phrase, { lead = 0.08, tail = 0.12, aliases = {} } = {}) {
  const phraseWords = phrase.trim().split(/\s+/).map(normalizedWord).filter(Boolean);
  const spokenWords = words.filter(({ text }) => normalizedWord(text));
  const alignedWords = spokenWords.map(({ text }) => normalizedWord(text));
  const normalizedAliases = Object.fromEntries(
    Object.entries(aliases).map(([word, values]) => [
      normalizedWord(word),
      values.map(normalizedWord),
    ]),
  );
  let firstIndex = -1;

  for (let index = 0; index <= alignedWords.length - phraseWords.length; index++) {
    const matches = phraseWords.every((word, offset) => {
      const aligned = alignedWords[index + offset];
      return aligned === word || normalizedAliases[word]?.includes(aligned);
    });
    if (matches) {
      firstIndex = index;
      break;
    }
  }
  if (firstIndex < 0) throw new Error(`Aligned phrase was not found: ${phrase}`);

  const lastIndex = firstIndex + phraseWords.length - 1;
  const previousEnd = firstIndex > 0 ? spokenWords[firstIndex - 1].end : 0;
  const nextStart =
    lastIndex + 1 < spokenWords.length
      ? spokenWords[lastIndex + 1].start
      : Number.POSITIVE_INFINITY;
  const start = Math.max(0, previousEnd, spokenWords[firstIndex].start - lead);
  const end = Math.min(nextStart, spokenWords[lastIndex].end + tail);
  if (!(end > start)) throw new Error(`Aligned phrase has invalid bounds: ${phrase}`);
  return { start: roundedTime(start), end: roundedTime(end) };
}

export function phraseCharacterClipBounds(alignment, phrase, { lead = 0.08, tail = 0.12 } = {}) {
  const {
    characters,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  } = validateCharacterAlignment(alignment);

  const exactPhrase = phrase.trim();
  const text = characters.join('');
  const phraseStart = text.indexOf(exactPhrase);
  if (phraseStart < 0) throw new Error(`Aligned phrase was not found: ${phrase}`);
  const phraseEnd = phraseStart + exactPhrase.length - 1;

  let firstIndex = phraseStart;
  while (firstIndex <= phraseEnd && /\s/.test(characters[firstIndex])) firstIndex++;
  let lastIndex = phraseEnd;
  while (lastIndex >= firstIndex && /\s/.test(characters[lastIndex])) lastIndex--;
  if (firstIndex > lastIndex) throw new Error(`Aligned phrase has no spoken characters: ${phrase}`);

  let previousIndex = firstIndex - 1;
  while (previousIndex >= 0 && /\s/.test(characters[previousIndex])) previousIndex--;
  let nextIndex = lastIndex + 1;
  while (nextIndex < characters.length && /\s/.test(characters[nextIndex])) nextIndex++;

  const previousEnd = previousIndex >= 0 ? ends[previousIndex] : 0;
  const nextStart = nextIndex < characters.length ? starts[nextIndex] : Number.POSITIVE_INFINITY;
  const start = Math.max(0, previousEnd, starts[firstIndex] - lead);
  const end = Math.min(nextStart, ends[lastIndex] + tail);
  if (!(end > start)) throw new Error(`Aligned phrase has invalid bounds: ${phrase}`);
  return { start: roundedTime(start), end: roundedTime(end) };
}
