'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { drawFor, _setData } = require('../server');

function simulate(n) {
  const participants = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, drawnId: null }));
  _setData({ admin: null, participants, sessions: {} });
  // zufällige Reihenfolge der Ziehenden
  const order = [...participants].sort(() => Math.random() - 0.5);
  for (const p of order) {
    const pick = drawFor(p);
    assert.ok(pick, `kein Name übrig bei n=${n}`);
    p.drawnId = pick.id;
  }
  return participants;
}

test('niemand zieht sich selbst, jeder wird genau einmal gezogen', () => {
  for (let n = 2; n <= 12; n++) {
    for (let run = 0; run < 2000; run++) {
      const ps = simulate(n);
      const drawn = ps.map((p) => p.drawnId);
      assert.strictEqual(new Set(drawn).size, n);
      for (const p of ps) assert.notStrictEqual(p.drawnId, p.id);
    }
  }
});
