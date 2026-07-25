// Loot Ledger: a session earnings tracker.
// Watches your gold and experience from the moment you log in, works out
// per-hour rates, and keeps the last few loot lines so you always know what
// that last drop actually was.

const LOOT_LINES = 8;

const panel = woc.ui.panel({ id: 'ledger', title: 'Loot Ledger' });
let session = null;
let lootLog = [];

function startSession(snapshot) {
  session = {
    startedAt: Date.now(),
    startCopper: snapshot.copper,
    lastCopper: snapshot.copper,
    xpGained: 0,
  };
}

woc.on('xp', (ev) => {
  if (session) session.xpGained += ev.amount;
});

woc.on('loot', (ev) => {
  const line = ev.kind === 'roll' ? ev.itemName : ev.text;
  if (!line) return;
  lootLog.unshift(line);
  if (lootLog.length > LOOT_LINES) lootLog.pop();
  render();
});

woc.on('tick', (snapshot) => {
  if (!session) startSession(snapshot);
  session.lastCopper = snapshot.copper;
  render();
});

function perHour(amount, sinceMs) {
  const hours = Math.max(1 / 60, (Date.now() - sinceMs) / 3600000);
  return Math.round(amount / hours);
}

function row(label, value) {
  return (
    '<div style="display:flex;justify-content:space-between;gap:10px">' +
    '<span>' +
    woc.util.esc(label) +
    '</span><b>' +
    value +
    '</b></div>'
  );
}

function render() {
  if (!session) {
    panel.body.innerHTML = '<div>Warming up...</div>';
    return;
  }
  const goldDelta = session.lastCopper - session.startCopper;
  const sign = goldDelta < 0 ? '-' : '+';
  let html =
    row('Gold this session', sign + woc.util.formatMoney(Math.abs(goldDelta))) +
    row('Gold per hour', woc.util.formatMoney(Math.abs(perHour(goldDelta, session.startedAt)))) +
    row('XP this session', woc.util.formatNumber(session.xpGained)) +
    row('XP per hour', woc.util.formatNumber(perHour(session.xpGained, session.startedAt)));
  if (lootLog.length) {
    html += '<hr style="border-color:#3a2f1b"><div><b>Recent loot</b></div>';
    for (let i = 0; i < lootLog.length; i++) {
      html += `<div>${woc.util.esc(lootLog[i])}</div>`;
    }
  }
  html +=
    '<div style="margin-top:6px;text-align:right">' +
    '<button type="button" data-reset style="cursor:pointer">Reset</button></div>';
  panel.body.innerHTML = html;
  const btn = panel.body.querySelector('[data-reset]');
  if (btn) {
    btn.addEventListener('click', () => {
      session = null;
      lootLog = [];
      const snapshot = woc.player();
      if (snapshot) startSession(snapshot);
      render();
    });
  }
}

render();
