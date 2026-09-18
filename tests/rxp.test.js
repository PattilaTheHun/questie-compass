const fs=require('fs'), zlib=require('zlib'), path=require('path');
const QC=require('../js/engine.js'); const RXP=require('../js/rxp.js');
const base=process.argv[2]; const dbPath=process.argv[3];
const acct=fs.readFileSync(path.join(base,'WTF/Account/987046649#1/SavedVariables/RXPGuides.lua'));
const entries=RXP.parseAccountCache(new Uint8Array(acct));
console.log('cached guides:', entries.length, 'groups:', [...new Set(entries.map(e=>e.group))]);
const guides=[]; let fail=0;
for (const e of entries){ try{ const txt=zlib.inflateRawSync(Buffer.from(e.bytes)).toString('utf8'); const g=RXP.parseGuide(txt); g.source='cache'; guides.push(g);}catch(err){fail++; console.log('inflate fail',e.key,err.message);} }
console.log('parsed', guides.length, 'inflate failures', fail);
const free=RXP.extractGuideBodies(fs.readFileSync(path.join(base,'Interface/AddOns/RXPGuides/Guides/RestedXP Horde 20-30.lua'),'utf8')).map(RXP.parseGuide);
console.log('free-file guides:', free.map(g=>`${g.group} / ${g.name} -> ${g.next} [${g.filter}] steps=${g.steps.length}`));
const chr=RXP.parseCharacterFile(fs.readFileSync(path.join(base,'WTF/Account/987046649#1/Mankrik/Tuskcleaver/SavedVariables/RXPGuides.lua'),'utf8'));
console.log('char:', chr.currentGuideGroup, '/', chr.currentGuideName, 'step', chr.currentStep, 'active', chr.activeQuests);
const order=RXP.chapterOrder(guides, chr.currentGuideGroup, chr.currentGuideName);
console.log('chapter order from current:', order.map(g=>g.name));
const db=JSON.parse(fs.readFileSync(dbPath)); 
const A=QC.analyze(db,{level:40,raceBit:128,classBit:1,completed:db.completed,inLog:chr.activeQuests});
const player={faction:'Horde',race:'Troll',className:'Warrior'};
const ev=RXP.evaluate(order, A, player, chr);
for (const ch of ev.chapters.slice(0,6)){ console.log(`== ${ch.guide.name} current=${ch.isCurrent} issues`, ch.issues);
  for (const st of ch.steps) for (const a of st.accepts) if (st.applies && a.issue && a.issue!=='ineligible') console.log(`   step ${st.index}${st.isCurrent?" <== YOU ARE HERE":""} .accept ${a.id} ${a.name}: ${a.issue}`, a.missing.length? "→ needs "+a.missing.map(s=>s.map(o=>o.name+" ["+o.id+"]").join(" or ")).join("; "):"");
}
console.log('filter tests:', RXP.filterApplies('Horde !Warrior', player), RXP.filterApplies('Shaman/Priest', player), RXP.filterApplies('Troll', player), RXP.filterApplies('Orc !Warlock', player));
for (const ch of ev.chapters.slice(0,6)) for (const st of ch.steps) for (const t of st.turnins) if (st.applies && !st.past && t.issue==='noquest') console.log(`   [${ch.guide.name}] step ${st.index} .turnin ${t.id} ${t.name}: you don't have this quest (${t.row?t.row.status:'?'})`);
