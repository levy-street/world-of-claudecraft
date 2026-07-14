// rotation_test.mjs - in-session verification of the optimized DPS/threat rotations.
// Exercises the real exported rotate() from multibox_brain.mjs with mock bots at various
// levels + mana, and prints the ability each class casts. No server, no realm, no ban risk.
//   run:  node scripts/rotation_test.mjs

import { rotate } from './multibox_brain.mjs';

// hasImp defaults true so the rotation tables show the COMBAT rotation (Imp already out), not the
// one-time summon. `ticks` runs rotate() repeatedly on the SAME target to reveal a multi-step
// sequence (e.g. the warlock's DoT opener → Shadow Bolt filler). Mana isn't consumed in the mock,
// so affordability stays true across ticks - fine for showing which abilities fire in what order.
function makeBot(
  cls,
  lv,
  manaFrac,
  { dist = 5, hp = 1, hostiles = 0, hasImp = true, hasSeal = false } = {},
) {
  const mres = 500;
  const casts = [];
  const ents = new Map();
  if (hasImp) ents.set(99, { id: 99, own: 1, k: 'mob', dead: false }); // a pet we own (own === our id)
  const auras = hasSeal ? [{ kind: 'imbue' }] : []; // paladin: simulate Seal of Righteousness already up
  const bot = {
    cls,
    dotTarget: null,
    pid: 1,
    ents,
    self: {
      id: 1,
      res: cls === 'warrior' ? 80 : Math.round(mres * manaFrac),
      mres,
      lv,
      hp: hp * 100,
      mhp: 100,
      auras,
      target: null,
    },
    hpFrac() {
      return this.self.hp / this.self.mhp;
    },
    dist() {
      return dist;
    },
    hostiles() {
      return Array.from({ length: hostiles }, () => ({}));
    },
    cmd(c) {
      if (c.cmd === 'cast') casts.push(c.ability);
    },
  };
  return { bot, casts };
}
function mockBot(cls, lv, manaFrac, opts = {}) {
  const { bot, casts } = makeBot(cls, lv, manaFrac, opts);
  rotate(bot, { id: 1, nm: 'Target Dummy' });
  return casts[0] ?? '(auto-attack only)';
}
function castSeq(cls, lv, manaFrac, ticks, opts = {}) {
  const { bot, casts } = makeBot(cls, lv, manaFrac, opts);
  for (let i = 0; i < ticks; i++) rotate(bot, { id: 1, nm: 'Target Dummy' });
  return casts.length ? casts.join(' → ') : '(auto-attack only)';
}

const DPS = ['warrior', 'hunter', 'mage', 'warlock', 'shaman'];
console.log('\n=== DPS rotation - top ability cast, FULL mana, by level ===');
console.log('class'.padEnd(9), ['L4', 'L8', 'L10', 'L14', 'L16'].map((s) => s.padEnd(16)).join(''));
for (const cls of DPS) {
  const row = [4, 8, 10, 14, 16].map((lv) => mockBot(cls, lv, 1.0).padEnd(16)).join('');
  console.log(cls.padEnd(9), row);
}

console.log('\n=== mana management - same classes at LOW mana (10%) vs full ===');
for (const cls of ['mage', 'warlock', 'shaman', 'hunter']) {
  console.log(
    cls.padEnd(9),
    'full →',
    mockBot(cls, 10, 1.0).padEnd(16),
    ' low(10%) →',
    mockBot(cls, 10, 0.1),
  );
}

console.log('\n=== warlock keeps its Imp summoned (no pet present → summon_imp) ===');
console.log(
  'warlock L8, NO imp, full mana →',
  mockBot('warlock', 8, 1.0, { hasImp: false }),
  '(should be summon_imp)',
);
console.log(
  'warlock L8, NO imp, low mana(8%) →',
  mockBot('warlock', 8, 0.08, { hasImp: false, hp: 0.9 }),
  "(can't afford 50 → Life Tap to refuel)",
);
console.log(
  'warlock L8, imp already out →',
  mockBot('warlock', 8, 1.0, { hasImp: true }),
  '(imp up → straight into the rotation)',
);

console.log(
  '\n=== warlock DoT opener grows per level, then Shadow Bolt filler (imp out, full mana) ===',
);
for (const lv of [1, 4, 8, 12])
  console.log(`warlock L${String(lv).padEnd(2)} →`, castSeq('warlock', lv, 1.0, 5));

console.log('\n=== warlock Life Tap triggers at low mana + healthy HP ===');
console.log('warlock L8, mana 10%, hp 90% →', mockBot('warlock', 8, 0.1, { hp: 0.9 }));
console.log(
  'warlock L8, mana 10%, hp 40% →',
  mockBot('warlock', 8, 0.1, { hp: 0.4 }),
  '(L10+ Drain Life needs hurt+lvl; here L8 → conserves)',
);
console.log(
  'warlock L12, hurt (hp 40%), full mana →',
  mockBot('warlock', 12, 1.0, { hp: 0.4 }),
  '(L10+ self-sustain → drain_life)',
);

console.log(
  '\n=== paladin TANK rotation grows per level (Seal of Righteousness already up, full mana) ===',
);
console.log(
  'paladin, NO seal up →',
  mockBot('paladin', 8, 1.0),
  '(always re-seal first - Seal buffs every swing with holy damage)',
);
for (const lv of [2, 4, 14, 18])
  console.log(
    `paladin L${String(lv).padEnd(2)} →`,
    castSeq('paladin', lv, 1.0, 5, { hasSeal: true }),
  );
console.log(
  '   (L2: just melee+seal · L4: +judgement · L14: +exorcism · L18: +consecration - each gated to its learn level)',
);

console.log('\n=== shaman rotation grows per level (in range, full mana) ===');
for (const lv of [1, 4, 10])
  console.log(`shaman L${String(lv).padEnd(2)} →`, castSeq('shaman', lv, 1.0, 4, { dist: 10 }));
console.log(
  '   (L1: lightning_bolt · L4: +earth_shock · L10: +flame_shock - gated to learn level)',
);

console.log('\n=== shaman shock is range-gated (≤19y) ===');
console.log('shaman L10, in range (10y) →', mockBot('shaman', 10, 1.0, { dist: 10 }));
console.log(
  'shaman L10, out of range (25y) →',
  mockBot('shaman', 10, 1.0, { dist: 25 }),
  '(falls back to Lightning Bolt)',
);

console.log('\n=== mage AoE when ≥3 mobs packed (L14+) ===');
console.log('mage L14, 1 mob →', mockBot('mage', 14, 1.0, { hostiles: 1 }));
console.log('mage L14, 4 packed →', mockBot('mage', 14, 1.0, { hostiles: 4 }));
console.log('');
