// A creature's Mechanics list and a boss's encounter lists read as one card per attack:
// its snapshot (when there is one), its name, what it does, and its numbers as labelled
// stats. Short traits ("Immune to crowd control.") gather into one row of tags.

const SECTIONS = new Set([
  'Mechanics',
  'Normal encounter',
  'Heroic encounter',
  'Boss encounters',
  'Pulling the final boss',
]);

// "Chain Lightning. Damages ..." : a capitalised name of a few words, then its text.
const NAMED = /^([A-Z][^.,:;!?]{0,44}?(?:[!?](?=\s)|(?=\.)))\.?\s+([\s\S]+)$/;
// "radius 13 yd, between uses 8 sec, school nature." : the generator's stat tail.
const STATS = /\.\s+([a-z][^<>.]*?(?:\d|, )[^<>]*?)\.?$/;
const TRAIT = /^[A-Z][^.<>]{0,40}\.$/;
// "Re-rivet: 25 sec after a chain breaks, ..." : a heroic note's own name.
const LABELLED = /^([A-Z][^.,:;<]{0,30}): ([\s\S]+)$/;
// The boss journal's flags (src/ui/boss_journal/journal_view.ts JournalFlag), printed last.
const FLAG_WORDS = 'deadly|interruptible|important|cleansable';
const FLAGS = new RegExp('\\s*\\(((?:' + FLAG_WORDS + ')(?:, (?:' + FLAG_WORDS + '))*)\\)\\s*$');
// A role tip ("tank: Hold him in the middle"), from the journal's JournalRole.
const ROLE = /^(tank|healer|damage|all): ([\s\S]+)$/;
const ROLE_NAMES = { tank: 'Tank', healer: 'Healer', damage: 'Damage', all: 'Everyone' };

function tag(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

/** A role tip gets its role as a label in front. */
export function roleTip(li) {
  if (li.querySelector(':scope > img')) return false;
  const match = li.innerHTML.trim().match(ROLE);
  if (!match) return false;
  const text = document.createElement('span');
  text.innerHTML = match[2];
  li.replaceChildren(tag('mechanic-role role-' + match[1], ROLE_NAMES[match[1]]), text);
  li.classList.add('mechanic-tip');
  return true;
}

/** "minimum damage 20, maximum damage 30" reads as one "damage 20 to 30" stat. */
function pairRanges(parts) {
  const out = [];
  for (const part of parts) {
    const max = part.match(/^maximum (.+?) ([\d.]+)$/);
    const minIndex = max ? out.findIndex((p) => p.startsWith('minimum ' + max[1] + ' ')) : -1;
    if (minIndex >= 0) {
      const min = out[minIndex].slice(('minimum ' + max[1] + ' ').length);
      out[minIndex] = max[1] + ' ' + min + ' to ' + max[2];
    } else out.push(part);
  }
  return out;
}

function statList(tail) {
  const list = document.createElement('dl');
  list.className = 'mechanic-stats';
  for (const part of pairRanges(tail.split(', '))) {
    const match = part.match(/^(.*?)\s+((?:[\d.]+[\s\S]*)|[a-z]+)$/);
    if (!match) return null;
    const row = document.createElement('div');
    const label = document.createElement('dt');
    label.textContent = match[1];
    const value = document.createElement('dd');
    value.textContent = match[2];
    row.append(label, value);
    list.append(row);
  }
  return list;
}

/** Turns one list item into a card, or returns false when it is not a named mechanic. */
export function mechanicCard(li) {
  const shot = li.querySelector(':scope > img.attack-shot');
  const holder = shot ? li.querySelector(':scope > span') : li;
  if (!holder) return false;
  const html = holder.innerHTML.trim();
  const named = html.match(NAMED) ?? html.match(LABELLED);
  if (!named || /<|\[/.test(named[1])) return false;
  let text = named[2];
  let flags = [];
  const flagged = text.match(FLAGS);
  if (flagged) {
    flags = flagged[1].split(', ');
    text = text.slice(0, flagged.index);
  }
  let stats = null;
  const tail = text.match(STATS);
  if (tail && !/[A-Z]/.test(tail[1])) {
    stats = statList(tail[1]);
    if (stats) text = text.slice(0, tail.index + 1);
  }
  const body = document.createElement('div');
  body.className = 'mechanic-body';
  const name = document.createElement('strong');
  name.className = 'mechanic-name';
  name.textContent = named[1].replace(/&amp;/g, '&');
  for (const flag of flags)
    name.append(' ', tag('mechanic-flag flag-' + flag, flag[0].toUpperCase() + flag.slice(1)));
  const prose = document.createElement('p');
  prose.className = 'mechanic-text';
  prose.innerHTML = text;
  body.append(name, prose);
  if (stats) body.append(stats);
  li.replaceChildren(...(shot ? [shot] : []), body);
  li.classList.add('mechanic-card');
  if (shot) li.classList.add('has-shot');
  return true;
}

/** Card every named mechanic in a list, and fold bare traits into one tag row. */
export function layoutMechanicList(list) {
  const traits = [];
  let cards = 0;
  for (const li of [...list.children]) {
    if (li.tagName !== 'LI') continue;
    if (roleTip(li)) cards++;
    else if (mechanicCard(li)) cards++;
    else if (TRAIT.test(li.textContent.trim()) && !li.querySelector('*')) traits.push(li);
  }
  if (!cards) return false;
  list.classList.add('mechanic-list');
  if (traits.length) {
    const row = document.createElement('li');
    row.className = 'mechanic-traits';
    for (const trait of traits) {
      const tag = document.createElement('span');
      tag.textContent = trait.textContent.trim().replace(/\.$/, '');
      row.append(tag);
      trait.remove();
    }
    list.append(row);
  }
  for (const li of list.children)
    if (!li.matches('.mechanic-card, .mechanic-traits, .mechanic-tip'))
      li.classList.add('mechanic-note');
  return true;
}

/** Every mechanics list on an article: under a Mechanics or encounter heading, whether
 *  or not the section sits behind a spoiler. */
export function layoutMechanics(article) {
  for (const heading of article.querySelectorAll(':scope > h2')) {
    if (!SECTIONS.has(heading.textContent)) continue;
    const scope = [];
    for (let node = heading.nextElementSibling; node && node.tagName !== 'H2'; ) {
      scope.push(node);
      node = node.nextElementSibling;
    }
    for (const node of scope) {
      const lists = node.matches('ul') ? [node] : [...node.querySelectorAll('ul')];
      for (const list of lists) layoutMechanicList(list);
    }
  }
}
