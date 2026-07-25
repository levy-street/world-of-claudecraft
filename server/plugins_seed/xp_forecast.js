// XP Forecast: when do I level?
// A rolling ten-minute experience meter: XP per hour, a live estimate of the
// time remaining to your next level, and the size of an average kill, so you
// can tell whether the grind spot is actually worth it.

const WINDOW_MS = 10 * 60 * 1000;

const panel = woc.ui.panel({ id: 'forecast', title: 'XP Forecast' });
let gains = [];
let latest = null;

woc.on('xp', (ev) => {
  gains.push({ at: Date.now(), amount: ev.amount });
});

woc.on('levelup', (ev) => {
  woc.ui.toast(`Level ${ev.level}. The forecast starts fresh.`);
  gains = [];
  render();
});

woc.on('tick', (snapshot) => {
  latest = snapshot;
  const cutoff = Date.now() - WINDOW_MS;
  while (gains.length && gains[0].at < cutoff) gains.shift();
  render();
});

function windowTotals() {
  let total = 0;
  for (let i = 0; i < gains.length; i++) total += gains[i].amount;
  const spanMs = gains.length ? Date.now() - gains[0].at : 0;
  return { total: total, spanMs: Math.max(spanMs, 60000) };
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
  if (!latest) {
    panel.body.innerHTML = '<div>Reading the stars...</div>';
    return;
  }
  const totals = windowTotals();
  const perHour = Math.round((totals.total * 3600000) / totals.spanMs);
  const remaining = Math.max(0, latest.xpNext - latest.xp);
  let html =
    row('XP per hour', woc.util.formatNumber(perHour)) +
    row('To next level', woc.util.formatNumber(remaining));
  if (gains.length) {
    html += row('Average gain', woc.util.formatNumber(Math.round(totals.total / gains.length)));
  }
  if (perHour > 0 && remaining > 0) {
    const etaSeconds = Math.round((remaining / perHour) * 3600);
    html += row('Level up in about', woc.util.formatDuration(etaSeconds));
  } else if (remaining > 0) {
    html += '<div style="opacity:0.7">Go defeat something and the forecast begins.</div>';
  }
  panel.body.innerHTML = html;
}

render();
