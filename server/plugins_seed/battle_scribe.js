// Battle Scribe: a personal damage and healing meter.
// Segments combat automatically: a pull starts on your first hit and closes
// after 6 quiet seconds. Shows live DPS, the top abilities of the current
// pull, and remembers your best pull this session.

const IDLE_MS = 6000;
const TOP_ABILITIES = 5;

const panel = woc.ui.panel({ id: 'meter', title: 'Battle Scribe' });
let me = null;
let pull = null;
let best = null;

function newPull(now) {
  return { start: now, last: now, damage: 0, healing: 0, byAbility: {} };
}

function pullSeconds(p) {
  return Math.max(1, (p.last - p.start) / 1000);
}

function endPull() {
  if (!pull) return;
  if (!best || pull.damage / pullSeconds(pull) > best.damage / pullSeconds(best)) best = pull;
  pull = null;
  render();
}

woc.on('combat', (ev) => {
  if (!me) me = woc.player();
  if (!me) return;
  const now = Date.now();
  if (ev.kind === 'damage' && ev.sourceId === me.id) {
    if (!pull) pull = newPull(now);
    pull.last = now;
    pull.damage += ev.amount;
    const name = ev.ability || 'Attack';
    pull.byAbility[name] = (pull.byAbility[name] || 0) + ev.amount;
    render();
  } else if (ev.kind === 'heal' && ev.targetId === me.id && pull) {
    pull.last = now;
    pull.healing += ev.amount;
  }
});

woc.on('tick', (snapshot) => {
  me = snapshot;
  if (pull && Date.now() - pull.last > IDLE_MS) endPull();
});

woc.on('death', () => {
  endPull();
});

function barRows(p) {
  let entries = [];
  for (const name in p.byAbility) entries.push([name, p.byAbility[name]]);
  entries.sort((a, b) => b[1] - a[1]);
  entries = entries.slice(0, TOP_ABILITIES);
  const max = entries.length ? entries[0][1] : 1;
  let html = '';
  for (let i = 0; i < entries.length; i++) {
    const pct = Math.round((entries[i][1] / max) * 100);
    html +=
      '<div style="margin:2px 0"><div style="display:flex;justify-content:space-between;gap:8px">' +
      '<span>' +
      woc.util.esc(entries[i][0]) +
      '</span>' +
      '<span>' +
      woc.util.formatNumber(entries[i][1]) +
      '</span></div>' +
      '<div style="height:4px;background:#3a2f1b;border-radius:2px">' +
      '<div style="height:4px;width:' +
      pct +
      '%;background:#c9a227;border-radius:2px"></div>' +
      '</div></div>';
  }
  return html;
}

function summaryLine(label, p) {
  const dps = p.damage / pullSeconds(p);
  return (
    '<div style="display:flex;justify-content:space-between;gap:8px">' +
    '<b>' +
    woc.util.esc(label) +
    '</b>' +
    '<span>' +
    woc.util.formatNumber(Math.round(dps)) +
    ' dps</span></div>'
  );
}

function render() {
  let html = '';
  if (pull) {
    html += summaryLine('This pull', pull) + barRows(pull);
  } else {
    html += '<div>Waiting for a pull...</div>';
  }
  if (best) {
    html += `<hr style="border-color:#3a2f1b">${summaryLine('Best pull', best)}`;
  }
  panel.body.innerHTML = html;
}

render();
