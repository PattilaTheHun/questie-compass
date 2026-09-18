/* Questie Compass — dependency engine
 * Mirrors Questie's own availability rules (see docs/HANDOFF.md §5).
 * Pure functions, no DOM. Works in browser (window.QC) and Node (module.exports).
 */
(function (root) {
  'use strict';

  const RACES = {
    HUMAN: 1, ORC: 2, DWARF: 4, NIGHT_ELF: 8, UNDEAD: 16, TAUREN: 32, GNOME: 64, TROLL: 128,
  };
  const RACE_LABEL = { 1: 'Human', 2: 'Orc', 4: 'Dwarf', 8: 'Night Elf', 16: 'Undead', 32: 'Tauren', 64: 'Gnome', 128: 'Troll' };
  const HORDE_MASK = 2 | 16 | 32 | 128;      // 178
  const ALLIANCE_MASK = 1 | 4 | 8 | 64;      // 77
  const CLASSES = {
    WARRIOR: 1, PALADIN: 2, HUNTER: 4, ROGUE: 8, PRIEST: 16, SHAMAN: 64, MAGE: 128, WARLOCK: 256, DRUID: 1024,
  };
  const CLASS_LABEL = { 1: 'Warrior', 2: 'Paladin', 4: 'Hunter', 8: 'Rogue', 16: 'Priest', 64: 'Shaman', 128: 'Mage', 256: 'Warlock', 1024: 'Druid' };

  const EVENT_SORTS = new Set(['HALLOWS_END', 'SEASONAL', 'DAY_OF_THE_DEAD', 'DARKMOON_FAIRE', 'LUNAR_FESTIVAL',
    'MIDSUMMER', 'BREWFEST', 'AHN_QIRAJ_WAR', 'INVASION', 'BATTLEGROUNDS', 'LOVE_IS_IN_THE_AIR',
    'NOBLEGARDEN', 'CHILDRENS_WEEK', 'WINTER_VEIL', 'HARVEST_FESTIVAL', 'PILGRIMS_BOUNTY', 'HALLOWEEN']);
  const CLASS_SORTS = new Set(['WARRIOR', 'PALADIN', 'HUNTER', 'ROGUE', 'PRIEST', 'SHAMAN', 'MAGE', 'WARLOCK', 'DRUID']);
  const PROF_SORTS = new Set(['HERBALISM', 'FISHING', 'BLACKSMITHING', 'ALCHEMY', 'LEATHERWORKING', 'ENGINEERING',
    'TAILORING', 'COOKING', 'FIRST_AID', 'MINING', 'SKINNING', 'ENCHANTING', 'INSCRIPTION', 'JEWELCRAFTING']);
  const DUNGEON_NAMES = ['Ragefire Chasm', 'Wailing Caverns', 'The Deadmines', 'Shadowfang Keep', 'Blackfathom Deeps',
    'The Stockade', 'Gnomeregan', 'Razorfen Kraul', 'Scarlet Monastery', 'Razorfen Downs', 'Uldaman', "Zul'Farrak",
    'Maraudon', 'Sunken Temple', 'Blackrock Depths', 'Blackrock Spire', 'Dire Maul', 'Scholomance', 'Stratholme'];
  const RAID_NAMES = ["Onyxia's Lair", 'Molten Core', 'Blackwing Lair', "Zul'Gurub", "Ruins of Ahn'Qiraj", "Temple of Ahn'Qiraj", 'Naxxramas'];
  // Rough level bands for dungeon prep ordering
  const DUNGEON_LEVELS = {
    'Ragefire Chasm': [13, 18], 'Wailing Caverns': [17, 24], 'The Deadmines': [18, 23], 'Shadowfang Keep': [22, 30],
    'Blackfathom Deeps': [24, 32], 'The Stockade': [24, 32], 'Gnomeregan': [29, 38], 'Razorfen Kraul': [29, 38],
    'Scarlet Monastery': [34, 45], 'Razorfen Downs': [37, 46], 'Uldaman': [41, 51], "Zul'Farrak": [44, 54],
    'Maraudon': [46, 55], 'Sunken Temple': [50, 56], 'Blackrock Depths': [52, 60], 'Blackrock Spire': [55, 60],
    'Dire Maul': [56, 60], 'Scholomance': [58, 60], 'Stratholme': [58, 60],
  };

  const STATUS = {
    COMPLETED: 'Completed',
    IN_LOG: 'In your quest log',
    MISSED: 'Missed / unavailable',
    REPEATABLE: 'Repeatable',
    BLOCKED: 'Blocked',
    SUBQUEST: 'Sub-quest',
    NEEDS_REP: 'Needs reputation / skill',
    LATER: 'Available later',
    READY: 'Ready now',
    INELIGIBLE: 'Not for this character',
  };

  /** WoW quest-log color class for a quest level vs the player's level: trivial (gray) / easy (green) / normal (yellow) / hard (orange) / very-hard (red). */
  function difficulty(questLevel, playerLevel) {
    if (!questLevel) return 'normal';
    const diff = questLevel - playerLevel;
    if (diff >= 5) return 'very-hard';
    if (diff >= 3) return 'hard';
    if (diff >= -2) return 'normal';
    const gray = playerLevel <= 5 ? 0 : playerLevel <= 39 ? playerLevel - 5 - Math.floor(playerLevel / 10) : playerLevel - 1 - Math.floor(playerLevel / 5);
    return questLevel > gray ? 'easy' : 'trivial';
  }
  function titleCase(s) {
    return String(s).toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /**
   * Build an analysis over a quest database for one character.
   * @param {object} db   {quests:{id:{...}}, blacklist:[], zones:{id:name}, sortKeys:{neg:NAME}}
   * @param {object} player {level, raceBit, classBit, completed:Set|Array, inLog:Set|Array}
   */
  function analyze(db, player) {
    const Q = {};
    for (const k of Object.keys(db.quests)) Q[+k] = db.quests[k];
    const ZONES = db.zones || {};
    const SORT = db.sortKeys || {};
    const BL = new Set((db.blacklist || []).map(Number));
    const DONE = new Set(Array.from(player.completed || []).map(Number));
    const INLOG = new Set(Array.from(player.inLog || []).map(Number));
    const LEVEL = +player.level || 1;
    const RACE = +player.raceBit || 0;
    const CLS = +player.classBit || 0;

    const dungeonZoneIds = new Map(); // zoneId -> dungeon name
    for (const [id, nm] of Object.entries(ZONES)) {
      if (DUNGEON_NAMES.includes(nm)) dungeonZoneIds.set(+id, nm);
    }
    const raidZoneIds = new Map();
    for (const [id, nm] of Object.entries(ZONES)) {
      if (RAID_NAMES.includes(nm)) raidZoneIds.set(+id, nm);
    }

    const name = (i) => (Q[i] ? Q[i].name : `Quest ${i}`);
    const NPCS = db.npcs || {}, OBJECTS = db.objects || {};
    function whoText(ref) {
      if (!ref) return '';
      const parts = [];
      for (const i of ref.npc || []) { const n = NPCS[i]; parts.push(n ? `${n[0]}${n[1] && ZONES[n[1]] ? ' (' + ZONES[n[1]] + ')' : ''}` : `NPC #${i}`); }
      for (const i of ref.obj || []) { const o = OBJECTS[i]; parts.push(o ? `${o[0]}${o[1] && ZONES[o[1]] ? ' (' + ZONES[o[1]] + ')' : ''}` : `Object #${i}`); }
      for (const i of ref.item || []) parts.push(`item #${i}`);
      return parts.join(' or ');
    }
    /** Quest XP at the player's level (cmangos formula, as used by Questie). Returns 0 at max level. */
    function questXP(q) {
      if (!q.xp || LEVEL >= 60) return 0;
      const [qLevel, base] = q.xp;
      let mult = 2 * (qLevel - LEVEL) + 20; if (mult < 1) mult = 1; else if (mult > 10) mult = 10;
      let xp = base * mult / 10;
      if (xp <= 100) xp = 5 * Math.floor((xp + 2) / 5); else if (xp <= 500) xp = 10 * Math.floor((xp + 5) / 10);
      else if (xp <= 1000) xp = 25 * Math.floor((xp + 12) / 25); else xp = 50 * Math.floor((xp + 25) / 50);
      return Math.floor(xp);
    }

    function zoneName(q) {
      const z = q.zoneOrSort;
      if (z == null) return '';
      if (z > 0) return ZONES[z] || `Zone ${z}`;
      return titleCase(SORT[z] || `Sort ${z}`);
    }
    function category(q) {
      const z = q.zoneOrSort || 0;
      if (z < 0) {
        const k = SORT[z] || '';
        if (EVENT_SORTS.has(k)) return 'Event / PvP';
        if (CLASS_SORTS.has(k)) return 'Class';
        if (PROF_SORTS.has(k)) return 'Profession';
        return 'Special';
      }
      if (dungeonZoneIds.has(z)) return 'Dungeon';
      if (raidZoneIds.has(z)) return 'Raid';
      return 'Zone';
    }
    function eligible(id, q) {
      if (BL.has(id)) return false;
      const r = q.requiredRaces || 0;
      if (r && RACE && !(r & RACE)) return false;
      const c = q.requiredClasses || 0;
      if (c && CLS && !(c & CLS)) return false;
      return true;
    }
    const ELIG = new Set();
    for (const id of Object.keys(Q).map(Number)) if (eligible(id, Q[id])) ELIG.add(id);

    // Prerequisite slots: each slot is a list of IDs, ANY of which satisfies it.
    function prereqSlots(q) {
      const slots = [];
      for (const p of q.preQuestGroup || []) slots.push([Math.abs(p)]);
      const single = (q.preQuestSingle || []).map((p) => Math.abs(p));
      if (single.length) slots.push(single);
      return slots;
    }
    function missingSlots(q) {
      return prereqSlots(q).filter((s) => !s.some((p) => DONE.has(p)));
    }
    function missedReason(id, q) {
      const ex = q.exclusiveTo || [];
      const exDone = ex.filter((e) => DONE.has(e));
      if (exDone.length) return `You completed a mutually exclusive alternative: ${exDone.map(name).join(', ')}`;
      const n = q.nextQuestInChain;
      if (n && DONE.has(n)) return `The chain already moved past it (${name(n)} is done)`;
      const au = q.availableUntilCompleted;
      if (au && DONE.has(au)) return `Only offered until ${name(au)} was completed`;
      const ml = q.requiredMaxLevel;
      if (ml && LEVEL > ml) return `Only available up to level ${ml}`;
      return '';
    }
    function status(id, q) {
      if (DONE.has(id)) return STATUS.COMPLETED;
      if (!ELIG.has(id)) return STATUS.INELIGIBLE;
      if (INLOG.has(id)) return STATUS.IN_LOG;
      if (missedReason(id, q)) return STATUS.MISSED;
      if ((q.specialFlags || 0) & 1) return STATUS.REPEATABLE;
      if (missingSlots(q).length) return STATUS.BLOCKED;
      if (q.parentQuest) return STATUS.SUBQUEST;
      if (q.requiredMinRep || q.requiredSkill || q.requiredSpell || q.requiredSpecialization) return STATUS.NEEDS_REP;
      if ((q.requiredLevel || 0) > LEVEL) return STATUS.LATER;
      return STATUS.READY;
    }

    // Catch-up closure: everything not yet done that must be done before `id` can be picked up.
    function closure(id, seen) {
      seen = seen || new Set();
      const q = Q[id];
      if (!q) return seen;
      for (const slot of missingSlots(q)) {
        let opts = slot.filter((p) => Q[p] && ELIG.has(p) && !missedReason(p, Q[p]));
        if (!opts.length) opts = slot.filter((p) => Q[p]);
        // ANY-slot: recommend the first viable option (lowest level)
        opts.sort((a, b) => (Q[a].questLevel || 0) - (Q[b].questLevel || 0));
        const p = opts[0];
        if (p != null && !seen.has(p)) { seen.add(p); closure(p, seen); }
      }
      return seen;
    }

    // Questline grouping (union-find) over prerequisite / chain links among eligible quests
    const parent = {};
    const find = (x) => { parent[x] = parent[x] ?? x; while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a, b) => { parent[find(a)] = find(b); };
    for (const id of ELIG) {
      const q = Q[id];
      for (const slot of prereqSlots(q)) for (const p of slot) if (Q[p]) union(id, p);
      if (Q[q.nextQuestInChain]) union(id, q.nextQuestInChain);
      for (const c of q.childQuests || []) if (Q[c]) union(id, c);
      if (Q[q.parentQuest]) union(id, q.parentQuest);
    }
    const groups = new Map();
    for (const id of ELIG) { const r = find(id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(id); }
    const chainOf = {}, chainName = {}, chainSize = {};
    for (const [root, members] of groups) {
      let final = members[0];
      for (const m of members) {
        const a = Q[m], b = Q[final];
        const ka = [(a.questLevel || 0), a.nextQuestInChain ? 0 : 1, m];
        const kb = [(b.questLevel || 0), b.nextQuestInChain ? 0 : 1, final];
        if (ka[0] > kb[0] || (ka[0] === kb[0] && (ka[1] > kb[1] || (ka[1] === kb[1] && ka[2] > kb[2])))) final = m;
      }
      for (const m of members) { chainOf[m] = root; chainName[m] = members.length > 1 ? name(final) : ''; chainSize[m] = members.length; }
    }

    // Forward edges: who lists me as a prerequisite
    const unlocks = {};
    for (const id of ELIG) for (const slot of prereqSlots(Q[id])) for (const p of slot) { (unlocks[p] = unlocks[p] || new Set()).add(id); }
    function dependents(id, seen) {
      seen = seen || new Set();
      for (const d of unlocks[id] || []) if (ELIG.has(d) && !seen.has(d)) { seen.add(d); dependents(d, seen); }
      return seen;
    }
    // Ordered chain (topological-ish walk) for stepper display
    function chainSequence(root) {
      const members = groups.get(root) || [];
      const set = new Set(members);
      const indeg = {};
      for (const m of members) indeg[m] = 0;
      for (const m of members) for (const slot of prereqSlots(Q[m])) for (const p of slot) if (set.has(p)) indeg[m]++;
      const out = [];
      const ready = members.filter((m) => indeg[m] === 0).sort((a, b) => (Q[a].questLevel || 0) - (Q[b].questLevel || 0));
      const seen = new Set();
      while (ready.length) {
        const m = ready.shift(); if (seen.has(m)) continue; seen.add(m); out.push(m);
        for (const d of unlocks[m] || []) if (set.has(d)) { indeg[d]--; if (indeg[d] <= 0 && !seen.has(d)) ready.push(d); }
        ready.sort((a, b) => (Q[a].questLevel || 0) - (Q[b].questLevel || 0));
      }
      for (const m of members) if (!seen.has(m)) out.push(m);
      return out;
    }

    // Per-quest view model
    const rows = {};
    for (const id of Object.keys(Q).map(Number)) {
      const q = Q[id];
      const st = status(id, q);
      rows[id] = {
        id, name: q.name, reqLevel: q.requiredLevel || 0, level: q.questLevel || 0,
        zone: zoneName(q), zoneId: q.zoneOrSort, category: category(q),
        status: st, eligible: ELIG.has(id), done: DONE.has(id), inLog: INLOG.has(id),
        chain: chainOf[id], chainName: chainName[id] || '', chainSize: chainSize[id] || 1,
        prereqs: prereqSlots(q).map((slot) => ({ any: slot.length > 1, options: slot.map((p) => ({ id: p, name: name(p), done: DONE.has(p) })), met: slot.some((p) => DONE.has(p)) })),
        missedReason: st === STATUS.MISSED ? missedReason(id, q) : '',
        next: Q[q.nextQuestInChain] ? q.nextQuestInChain : null,
        objective: (q.objectivesText && q.objectivesText[0]) || '',
        repeatable: !!((q.specialFlags || 0) & 1),
        dungeon: dungeonZoneIds.get(q.zoneOrSort) || null,
        unlocks: Array.from(unlocks[id] || []).filter((u) => ELIG.has(u)),
        xp: questXP(q), startText: whoText(q.start), finishText: whoText(q.finish),
        difficulty: difficulty(q.questLevel || 0, LEVEL),
      };
    }
    for (const id of Object.keys(rows)) {
      const r = rows[id];
      r.unlocksTotal = r.eligible ? dependents(+id).size : 0;
      r.chainRole = r.chainSize === 1 ? 'Standalone' : (r.prereqs.length ? 'Mid-chain' : 'Chain start');
    }

    /** Compute the report for a level span. lo..hi inclusive; hideProfessions, hideEvents toggles. */
    function report(opts) {
      const lo = opts.lo ?? 1, hi = opts.hi ?? 60;
      const hideProf = !!opts.hideProfessions, hideEvents = opts.hideEvents !== false;
      const inSpan = (r) => r.level >= lo && r.level <= hi && r.reqLevel <= hi;
      const visible = (r) => r.eligible && !(hideProf && r.category === 'Profession') && !(hideEvents && r.category === 'Event / PvP');

      const scope = Object.values(rows).filter((r) => visible(r) && inSpan(r) && !r.done);
      const ready = [], later = [], blocked = [], missed = [], inLog = [], needsRep = [];
      const needed = new Map(); // catch-up quest id -> Set(target ids)
      for (const r of scope) {
        switch (r.status) {
          case STATUS.READY: ready.push(r); break;
          case STATUS.LATER: later.push(r); break;
          case STATUS.IN_LOG: inLog.push(r); break;
          case STATUS.NEEDS_REP: needsRep.push(r); break;
          case STATUS.MISSED: missed.push(r); break;
          case STATUS.BLOCKED: {
            const cl = closure(r.id);
            r.catchUp = Array.from(cl).map((p) => rows[p]).sort((a, b) => a.level - b.level);
            r.catchUpCount = r.catchUp.length;
            blocked.push(r);
            for (const p of cl) { if (!needed.has(p)) needed.set(p, new Set()); needed.get(p).add(r.id); }
            break;
          }
          default: break;
        }
      }
      const catchUp = Array.from(needed.entries()).map(([p, targets]) => {
        const r = rows[p];
        return Object.assign({}, r, {
          gates: Array.from(targets).map((t) => rows[t]).sort((a, b) => a.level - b.level),
          gatesCount: targets.size,
          skippedLower: r.level < lo,
          doable: r.status === STATUS.READY || r.status === STATUS.IN_LOG,
        });
      }).sort((a, b) => b.gatesCount - a.gatesCount || b.unlocksTotal - a.unlocksTotal || a.level - b.level);

      // Unfinished chains: chains with some progress where the next step is ready but sits below the span
      const chainProgress = new Map();
      for (const r of Object.values(rows)) {
        if (!r.eligible || r.chainSize < 2) continue;
        if (!chainProgress.has(r.chain)) chainProgress.set(r.chain, { root: r.chain, name: r.chainName, members: [] });
        chainProgress.get(r.chain).members.push(r);
      }
      const questlines = [];
      for (const c of chainProgress.values()) {
        const seq = chainSequence(c.root).map((i) => rows[i]).filter(visible);
        if (!seq.length) continue;
        const done = seq.filter((r) => r.done).length;
        const touchesSpan = seq.some(inSpan);
        if (!touchesSpan) continue;
        const readyStep = seq.find((r) => r.status === STATUS.READY || r.status === STATUS.IN_LOG);
        const maxLevel = Math.max(...seq.map((r) => r.level));
        questlines.push({
          root: c.root, name: c.name, steps: seq, done, total: seq.length, maxLevel,
          started: done > 0 && done < seq.length, complete: done === seq.length,
          nextStep: readyStep || null,
          stalled: done > 0 && done < seq.length && readyStep && readyStep.level < lo,
        });
      }
      questlines.sort((a, b) => (b.started - a.started) || (b.stalled - a.stalled) || a.maxLevel - b.maxLevel || a.name.localeCompare(b.name));

      // Zone completion within span
      const zones = new Map();
      for (const r of Object.values(rows)) {
        if (!visible(r) || !inSpan(r) || r.category !== 'Zone') continue;
        if (!zones.has(r.zone)) zones.set(r.zone, { zone: r.zone, total: 0, done: 0, ready: 0, blocked: 0, later: 0, missed: 0, inLog: 0 });
        const z = zones.get(r.zone); z.total++;
        if (r.done) z.done++;
        else if (r.status === STATUS.READY) z.ready++;
        else if (r.status === STATUS.IN_LOG) z.inLog++;
        else if (r.status === STATUS.BLOCKED) z.blocked++;
        else if (r.status === STATUS.LATER) z.later++;
        else if (r.status === STATUS.MISSED) z.missed++;
      }
      const zoneList = Array.from(zones.values()).sort((a, b) => b.total - a.total);

      // Dungeon prep: all dungeon quests whose dungeon band overlaps the span
      const dungeons = new Map();
      for (const r of Object.values(rows)) {
        if (!r.eligible || !r.dungeon) continue;
        const band = DUNGEON_LEVELS[r.dungeon] || [1, 60];
        if (band[1] < lo || band[0] > hi) continue;
        if (!dungeons.has(r.dungeon)) dungeons.set(r.dungeon, { name: r.dungeon, band, quests: [] });
        dungeons.get(r.dungeon).quests.push(r);
      }
      const dungeonList = Array.from(dungeons.values()).sort((a, b) => a.band[0] - b.band[0]);
      for (const d of dungeonList) d.quests.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

      const completed = Object.values(rows).filter((r) => r.done).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
      const byLevel = (a, b) => a.reqLevel - b.reqLevel || a.level - b.level || a.name.localeCompare(b.name);
      ready.sort(byLevel); later.sort(byLevel); blocked.sort(byLevel); missed.sort(byLevel); inLog.sort(byLevel); needsRep.sort(byLevel);

      return {
        lo, hi, scope: scope.length, ready, later, inLog, needsRep, blocked, missed, catchUp, questlines,
        zones: zoneList, dungeons: dungeonList, completed,
        totals: { quests: Object.keys(Q).length, eligible: ELIG.size, completed: DONE.size, completedKnown: Array.from(DONE).filter((i) => Q[i]).length },
      };
    }

    /** Prerequisite slots of `id` not satisfied by completed quests plus `extraDone` (Set). Each slot = list of option rows. */
    function missingPrereqs(id, extraDone) {
      const q = Q[id]; if (!q) return [];
      const has = (p) => DONE.has(p) || (extraDone && extraDone.has(p));
      return prereqSlots(q).filter((s) => !s.some(has)).map((s) => s.map((p) => rows[p] || { id: p, name: name(p), level: 0 }));
    }
    return { rows, report, status, STATUS, chainSequence, name, missingPrereqs, eligibleCount: ELIG.size, questCount: Object.keys(Q).length };
  }

  /* ---------- Questie.lua SavedVariables parsing ---------- */

  /** Parse an account-level Questie.lua. Returns [{key:"Name - Realm", name, realm, completed:[ids], class, guid}] */
  function parseQuestieLua(text) {
    text = String(text).replace(/\r\n?/g, '\n');
    const chars = [];
    const charBlock = text.indexOf('["char"] = {');
    if (charBlock < 0) return chars;
    const re = /\n\["([^"]+) - ([^"]+)"\] = \{\n/g;
    let m;
    const starts = [];
    while ((m = re.exec(text))) starts.push({ idx: m.index, name: m[1], realm: m[2] });
    for (let i = 0; i < starts.length; i++) {
      const s = starts[i];
      const end = i + 1 < starts.length ? starts[i + 1].idx : text.length;
      const chunk = text.slice(s.idx, end);
      if (!/\["complete"\]|\["townsfolkClass"\]|\["guid"\]/.test(chunk)) continue; // not a character block (e.g. profileKeys)
      const cm = /\["complete"\] = \{([\s\S]*?)\n\},/.exec(chunk);
      const completed = [];
      if (cm) { const r2 = /\[(\d+)\] = true/g; let x; while ((x = r2.exec(cm[1]))) completed.push(+x[1]); }
      const cls = (/\["townsfolkClass"\] = "([A-Z]+)"/.exec(chunk) || [])[1] || '';
      const guid = (/\["guid"\] = "([^"]+)"/.exec(chunk) || [])[1] || '';
      chars.push({ key: `${s.name} - ${s.realm}`, name: s.name, realm: s.realm, completed, class: cls, guid });
    }
    return chars;
  }

  /** Infer faction/race/level from completed quests. */
  function inferCharacter(db, completed) {
    const Q = db.quests; const Z = db.zones || {};
    const zoneCount = {};
    let horde = 0, alliance = 0, maxLvl = 0; const levels = [];
    for (const id of completed) {
      const q = Q[id]; if (!q) continue;
      const r = q.requiredRaces || 0;
      if (r && (r & HORDE_MASK) && !(r & ALLIANCE_MASK)) horde++;
      if (r && (r & ALLIANCE_MASK) && !(r & HORDE_MASK)) alliance++;
      const zn = q.zoneOrSort > 0 ? Z[q.zoneOrSort] : '';
      if (zn) zoneCount[zn] = (zoneCount[zn] || 0) + 1;
      if (q.questLevel) levels.push(q.questLevel);
    }
    levels.sort((a, b) => a - b);
    const p90 = levels.length ? levels[Math.floor(levels.length * 0.9)] : 1;
    maxLvl = Math.min(60, Math.max(1, p90 + 1));
    const faction = horde > alliance ? 'Horde' : alliance > horde ? 'Alliance' : '';
    let raceBit = 0, raceNote = '';
    const starter = (n) => zoneCount[n] || 0;
    if (faction === 'Horde') {
      const dur = starter('Durotar') + starter('Valley of Trials');
      if (starter('Mulgore') > dur && starter('Mulgore') > starter('Tirisfal Glades')) raceBit = RACES.TAUREN;
      else if (starter('Tirisfal Glades') > dur) raceBit = RACES.UNDEAD;
      else { raceBit = RACES.ORC; raceNote = 'Orc or Troll? Both start in Durotar; pick yours.'; }
    } else if (faction === 'Alliance') {
      if (starter('Teldrassil') > starter('Elwynn Forest') && starter('Teldrassil') > starter('Dun Morogh')) raceBit = RACES.NIGHT_ELF;
      else if (starter('Dun Morogh') > starter('Elwynn Forest')) { raceBit = RACES.DWARF; raceNote = 'Dwarf or Gnome? Both start in Dun Morogh; pick yours.'; }
      else raceBit = RACES.HUMAN;
    }
    return { faction, raceBit, raceNote, level: maxLvl };
  }

  const api = { analyze, parseQuestieLua, inferCharacter, difficulty, RACES, RACE_LABEL, CLASSES, CLASS_LABEL, STATUS, HORDE_MASK, ALLIANCE_MASK, DUNGEON_LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.QC = Object.assign(root.QC || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
