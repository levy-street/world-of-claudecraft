// Wayfarer Waypoints: never lose a spot again.
// Save your current position under a name (that herb circuit, the rare spawn,
// the meeting stone) and the list shows a live distance to each one, nearest
// first. Waypoints stay saved between sessions.

const MAX_WAYPOINTS = 12;

const panel = woc.ui.panel({ id: 'waypoints', title: 'Wayfarer Waypoints' });
let waypoints = woc.storage.get('list') || [];
let here = null;

function save() {
  woc.storage.set('list', waypoints);
}

function distanceTo(wp) {
  if (!here) return null;
  const dx = wp.x - here.x;
  const dz = wp.z - here.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function compass(wp) {
  if (!here) return '';
  const dx = wp.x - here.x;
  const dz = wp.z - here.z;
  if (Math.abs(dx) < 2 && Math.abs(dz) < 2) return 'here';
  const ns = dz > 0 ? 'S' : 'N';
  const ew = dx > 0 ? 'E' : 'W';
  if (Math.abs(dz) < Math.abs(dx) / 2) return ew;
  if (Math.abs(dx) < Math.abs(dz) / 2) return ns;
  return ns + ew;
}

woc.on('tick', (snapshot) => {
  here = snapshot;
  render();
});

function render() {
  const rows = waypoints.slice();
  rows.sort((a, b) => (distanceTo(a) || 0) - (distanceTo(b) || 0));
  let html =
    '<div style="display:flex;gap:6px;margin-bottom:6px">' +
    '<input type="text" data-name maxlength="24" placeholder="Name this spot"' +
    ' style="flex:1;min-width:0">' +
    '<button type="button" data-add style="cursor:pointer">Mark</button></div>';
  if (!rows.length) {
    html += '<div>No waypoints yet. Stand somewhere memorable and press Mark.</div>';
  }
  for (let i = 0; i < rows.length; i++) {
    const wp = rows[i];
    const d = distanceTo(wp);
    const where = d === null ? '' : `${Math.round(d)} yd ${compass(wp)}`;
    html +=
      '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center">' +
      '<span>' +
      woc.util.esc(wp.name) +
      '</span>' +
      '<span style="white-space:nowrap">' +
      woc.util.esc(where) +
      ' <button type="button" data-del="' +
      woc.util.esc(wp.name) +
      '"' +
      ' aria-label="Remove ' +
      woc.util.esc(wp.name) +
      '" style="cursor:pointer">x</button>' +
      '</span></div>';
  }
  panel.body.innerHTML = html;

  const addBtn = panel.body.querySelector('[data-add]');
  const nameInput = panel.body.querySelector('[data-name]');
  if (addBtn && nameInput) {
    addBtn.addEventListener('click', () => {
      const spot = woc.player();
      const name = String(nameInput.value || '')
        .trim()
        .slice(0, 24);
      if (!spot || !name) return;
      if (waypoints.length >= MAX_WAYPOINTS) {
        woc.ui.toast('Waypoint list is full. Remove one first.');
        return;
      }
      waypoints.push({ name: name, x: spot.x, z: spot.z });
      save();
      woc.ui.sound('click');
      render();
    });
  }
  const dels = panel.body.querySelectorAll('[data-del]');
  for (let j = 0; j < dels.length; j++) {
    ((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-del');
        waypoints = waypoints.filter((wp) => wp.name !== name);
        save();
        render();
      });
    })(dels[j]);
  }
}

render();
