// Adventure Journal: your session, written down.
// Quietly records the moments worth retelling: level ups, deeds unlocked,
// quests turned in, deaths, and the loot you rolled on, each with a
// timestamp. Perfect for guild recaps and "how did I die THIS time" reviews.
// The journal survives logout.

const MAX_ENTRIES = 100;

const panel = woc.ui.panel({ id: 'journal', title: 'Adventure Journal' });
let entries = woc.storage.get('entries') || [];

function stamp() {
  const d = new Date();
  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function write(line) {
  entries.unshift({ at: stamp(), line: line });
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  woc.storage.set('entries', entries);
  render();
}

woc.on('levelup', (ev) => {
  write(`Reached level ${ev.level}.`);
});

woc.on('deed', (ev) => {
  if (!ev.retro) write(`Deed complete: ${ev.deedId.replace(/_/g, ' ')}.`);
});

woc.on('quest', (ev) => {
  if (ev.stage === 'done') write(`Turned in ${ev.questId.replace(/_/g, ' ')}.`);
});

woc.on('death', () => {
  write('Died. A lesson was probably learned.');
});

woc.on('loot', (ev) => {
  if (ev.kind === 'roll') write(`Rolled on ${ev.itemName}.`);
});

function render() {
  let html =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
    '<b>Today</b><button type="button" data-clear style="cursor:pointer">Clear</button></div>';
  if (!entries.length) {
    html += '<div>Nothing yet. Go make a story.</div>';
  }
  for (let i = 0; i < entries.length; i++) {
    html +=
      '<div><span style="opacity:0.6">' +
      woc.util.esc(entries[i].at) +
      '</span> ' +
      woc.util.esc(entries[i].line) +
      '</div>';
  }
  panel.body.innerHTML = html;
  const clear = panel.body.querySelector('[data-clear]');
  if (clear) {
    clear.addEventListener('click', () => {
      entries = [];
      woc.storage.set('entries', entries);
      render();
    });
  }
}

render();
