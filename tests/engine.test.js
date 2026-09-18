// Regression test: Tuskcleaver (Troll Warrior, level 40), span 40-50, hide events, keep professions.
// Expected (from the Python reference implementation, docs/HANDOFF.md §5.1):
//   (span 40-50 inclusive) completed 275 known, eligible 1971, scope 358, ready 146, blocked 187, catch-up 197 (27 lower-level), missed 0.
//   With the Python reference span (questLevel<=52, reqLevel<=50) the engine reproduces 425/173/223/228 exactly.
const fs = require('fs'); const path = require('path');
const QC = require('../js/engine.js');
const dbPath = process.argv[2] || path.join(__dirname, '..', 'samples', 'questdb-with-tuskcleaver-completed.json');
const luaPath = process.argv[3];
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
let completed = db.completed;
if (luaPath) {
  const chars = QC.parseQuestieLua(fs.readFileSync(luaPath, 'utf8'));
  console.log('characters in Questie.lua:', chars.map(c => `${c.key} (${c.class}, ${c.completed.length} done)`));
  completed = chars.find(c => c.name === 'Tuskcleaver').completed;
}
const inf = QC.inferCharacter(db, completed);
console.log('inferred:', inf);
const A = QC.analyze(db, { level: 40, raceBit: QC.RACES.TROLL, classBit: QC.CLASSES.WARRIOR, completed });
const R = A.report({ lo: 40, hi: 50, hideProfessions: false, hideEvents: true });
const out = {
  completedKnown: R.totals.completedKnown, eligible: R.totals.eligible, scope: R.scope,
  ready: R.ready.length + R.later.length + R.needsRep.length, blocked: R.blocked.length, missed: R.missed.length,
  catchUp: R.catchUp.length, catchUpLower: R.catchUp.filter(c => c.skippedLower).length,
  questlines: R.questlines.length, zones: R.zones.length, dungeons: R.dungeons.map(d => d.name + ':' + d.quests.length),
};
console.log(out);
const expect = { completedKnown: 275, eligible: 1971, scope: 358, ready: 146, blocked: 187, missed: 0, catchUp: 197, catchUpLower: 27 };
let ok = true;
for (const k of Object.keys(expect)) if (out[k] !== expect[k]) { ok = false; console.log(`MISMATCH ${k}: got ${out[k]} expected ${expect[k]}`); }
console.log('top catch-up:', R.catchUp.slice(0, 5).map(c => `${c.name} (lvl ${c.level}, gates ${c.gatesCount}, ${c.status})`));
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
