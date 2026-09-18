/* Questie Compass — RestedXP guide reader
 * Reads (a) cached guides from the account-level RXPGuides.lua SavedVariables (raw-DEFLATE compressed),
 *       (b) plain-text guide files from Interface/AddOns/RXPGuides/Guides/*.lua,
 *       (c) the per-character RXPGuides.lua (current guide position + active quest log).
 * Everything stays local; guide text is the user's licensed content and is never persisted by the app.
 */
(function (root) {
  'use strict';

  /** Bytes -> "binary string" (one char per byte). Needed because Lua string escapes are byte-oriented. */
  function bytesToBinaryString(u8) {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return s;
  }
  /** Undo Lua's string escaping (\ddd, \n, \", \\ ...) on a binary string. Returns Uint8Array. */
  function luaUnescapeToBytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c !== 92 /* \ */) { out.push(c & 0xff); continue; }
      const n = str[i + 1];
      if (n >= '0' && n <= '9') {
        let j = i + 1, num = '';
        while (j < str.length && num.length < 3 && str[j] >= '0' && str[j] <= '9') num += str[j++];
        out.push(parseInt(num, 10) & 0xff); i = j - 1;
      } else {
        const map = { n: 10, r: 13, t: 9, a: 7, b: 8, f: 12, v: 11, '\\': 92, '"': 34, "'": 39 };
        out.push(map[n] != null ? map[n] : n.charCodeAt(0)); i++;
      }
    }
    return Uint8Array.from(out);
  }

  /** Default inflater: browser DecompressionStream('deflate-raw'). Node tests inject zlib. */
  async function inflateRawBrowser(u8) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new TextDecoder('utf-8').decode(buf);
  }

  /**
   * Parse the ACCOUNT-level RXPGuides.lua (as Uint8Array). Returns list of cached guide entries
   * {key, group, name, enabledFor, bytes} — call inflate on `bytes` to get guide text.
   */
  function parseAccountCache(u8) {
    const s = bytesToBinaryString(u8).replace(/\r\n?/g, '\n');
    const out = [];
    const re = /\["enabledFor"\] = "([^"]*)",\n\["key"\] = "([^"]*)",\n\["groupOrContent"\] = "/g;
    let m;
    while ((m = re.exec(s))) {
      const start = re.lastIndex;
      // find the closing quote: first `",\n` not preceded by an odd number of backslashes
      let end = start;
      for (;;) {
        end = s.indexOf('",\n', end);
        if (end < 0) break;
        let bs = 0; for (let k = end - 1; k >= start && s[k] === '\\'; k--) bs++;
        if (bs % 2 === 0) break;
        end += 1;
      }
      if (end < 0) break;
      const raw = s.slice(start, end);
      const key = m[2];
      const parts = key.split('|');
      out.push({ key, group: parts[0], name: parts[parts.length - 1], enabledFor: m[1], bytes: luaUnescapeToBytes(raw) });
      re.lastIndex = end;
    }
    return out;
  }

  /** Parse the per-CHARACTER RXPGuides.lua text. */
  function parseCharacterFile(text) {
    text = String(text).replace(/\r\n?/g, '\n');
    const get = (k) => (new RegExp('\\["' + k + '"\\] = "([^"]*)"').exec(text) || [])[1] || '';
    const getNum = (k) => +((new RegExp('\\["' + k + '"\\] = (\\d+)').exec(text) || [])[1] || 0);
    const active = [];
    const qi = text.indexOf('["questObjectivesCache"] = {');
    if (qi >= 0) {
      let depth = 0, i = text.indexOf('{', qi), start = i;
      for (; i < text.length; i++) { const c = text[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) break; } }
      const block = text.slice(start, i);
      // top-level entries are "\n[<id>] = {" at depth 1
      depth = 0;
      for (let j = 0; j < block.length; j++) {
        const c = block[j];
        if (c === '{') { depth++; }
        else if (c === '}') depth--;
        else if (c === '\n' && depth === 1) { const m = /^\[(\d+)\] = \{/.exec(block.slice(j + 1, j + 24)); if (m) active.push(+m[1]); }
      }
    }
    const names = {};
    const nm = /\["questNameCache"\] = \{([\s\S]*?)\n\},/.exec(text);
    if (nm) { const r = /\[(\d+)\] = "([^"]*)"/g; let x; while ((x = r.exec(nm[1]))) names[+x[1]] = x[2]; }
    return {
      currentGuideGroup: get('currentGuideGroup'), currentGuideName: get('currentGuideName'),
      currentStep: getNum('currentStep'), activeQuests: active, questNames: names,
    };
  }

  /** Extract all RegisterGuide([[...]]) bodies from a plain-text guide .lua file. */
  function extractGuideBodies(luaText) {
    const out = [];
    const re = /RegisterGuide\(\s*\[\[([\s\S]*?)\]\]/g;
    let m; while ((m = re.exec(luaText))) out.push(m[1]);
    return out;
  }

  /** Parse guide text into {name, group, next, filter, steps[]} */
  function parseGuide(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const g = { name: '', group: '', next: '', filter: '', steps: [], version: 0, tags: [] };
    let step = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('--')) continue;
      if (step === null) {
        if (line.startsWith('#name ')) { g.name = line.slice(6).trim(); continue; }
        if (line.startsWith('#group ')) { g.group = line.slice(7).trim(); continue; }
        if (line.startsWith('#next ')) { g.next = line.slice(6).trim(); continue; }
        if (line.startsWith('#version ')) { g.version = +line.slice(9).trim(); continue; }
        if (line.startsWith('<<')) { g.filter = line.slice(2).trim(); continue; }
        if (line.startsWith('#')) { g.tags.push(line.slice(1)); continue; }
      }
      if (/^step\b/.test(line)) {
        step = { filter: (line.match(/<<\s*(.*)$/) || [, ''])[1].trim(), optional: false, actions: [], accepts: [], turnins: [], completes: [], collects: [], gotos: [], mobs: [], xp: [], text: [], label: '', xprate: '', season: '' };
        g.steps.push(step); continue;
      }
      if (!step) continue;
      if (line === '#optional') { step.optional = true; continue; }
      if (line.startsWith('#label ')) { step.label = line.slice(7).trim(); continue; }
      if (line.startsWith('#xprate')) { step.xprate = line.slice(7).trim(); continue; }
      if (line.startsWith('#season')) { step.season = line.slice(7).trim(); continue; }
      let m;
      if ((m = /^\.accept\s+(\d+)(?:\s*>>\s*(.*))?/.exec(line))) { const a = { kind: 'accept', id: +m[1], text: (m[2] || '').trim(), filter: tailFilter(line) }; step.accepts.push(a); step.actions.push(a); continue; }
      if ((m = /^\.turnin\s+(\d+)(?:\s*>>\s*(.*))?/.exec(line))) { const t = { kind: 'turnin', id: +m[1], text: (m[2] || '').trim(), filter: tailFilter(line) }; step.turnins.push(t); step.actions.push(t); continue; }
      if ((m = /^\.complete\s+(\d+)(?:\s*,\s*(\d+))?(?:\s*,\s*(\d+))?/.exec(line))) { step.completes.push({ id: +m[1], obj: m[2] ? +m[2] : 0, count: m[3] ? +m[3] : 0, filter: tailFilter(line) }); continue; }
      if ((m = /^\.collect\s+(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d+))?/.exec(line))) { step.collects.push({ item: +m[1], count: +m[2], quest: m[3] ? +m[3] : 0, text: (line.split('>>')[1] || '').trim(), filter: tailFilter(line) }); continue; }
      if ((m = /^\.goto\s+([^,]+),\s*([\d.]+)\s*,\s*([\d.]+)/.exec(line))) { step.gotos.push({ zone: m[1].trim(), x: +m[2], y: +m[3] }); if (line.includes('>>')) step.text.push(cleanText(line.split('>>')[1])); continue; }
      if ((m = /^\.(mob|unitscan|target)\s+(.+?)(?:\s*>>.*)?$/.exec(line))) { for (const n of m[2].split(',')) if (n.trim()) step.mobs.push(n.trim()); continue; }
      if ((m = /^\.xp\s+([<>]?)(\d+)/.exec(line))) { step.xp.push({ op: m[1] || '>=', level: +m[2] }); continue; }
      if (line.startsWith('>>')) { step.text.push(cleanText(line.slice(2))); continue; }
      if (line.includes('>>') && /^\.(accept|turnin|collect|train|fly|hs|vendor|money|xp|zone|subzone|itemcount|use|cast|skill|trainer)\b/.test(line)) { const t = cleanText(line.split('>>')[1].replace(/<<.*$/, '')); if (t && !step.text.includes(t)) step.text.push(t); }
    }
    return g;
  }
  /**
   * Assign RestedXP's visible step numbers. Calibrated against the in-game window: a step is shown when its class/race/faction
   * filter matches, its #xprate tag (if any) matches the server rate, and it is not a Season of Discovery (#season N>0) step; level-gated (.xp) steps still count.
   */
  function numberSteps(guide, player, xprate) {
    xprate = xprate || 1; let n = 0;
    for (const st of guide.steps) {
      let visible = filterApplies(st.filter, player);
      if (visible && st.xprate) { const m = /^([<>])\s*([\d.]+)/.exec(st.xprate); if (m) visible = m[1] === '<' ? xprate < +m[2] : xprate > +m[2]; }
      if (visible && st.season && parseInt(st.season, 10) > 0) visible = false; // Season of Discovery phase steps are not shown on Era
      st.visible = visible; st.num = visible ? ++n : 0;
    }
    guide.visibleCount = n; return n;
  }
  function tailFilter(line) { const m = /<<\s*([^<>]*)$/.exec(line); return m ? m[1].trim() : ''; }
  function cleanText(s) {
    return String(s).replace(/\|T[^|]*\|t/g, '').replace(/\|cRXP_[A-Z]+_/g, '').replace(/\|c[0-9a-fA-F]{8}/g, '').replace(/\|r/g, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Does a RestedXP filter apply to this player? Tokens: Horde, Alliance, race names, class names,
   * `!` negation, `/` = OR within a token. Empty filter = applies to everyone.
   */
  function filterApplies(filter, player) {
    if (!filter) return true;
    const mine = new Set([player.faction, player.race, player.className].filter(Boolean).map((x) => x.toLowerCase().replace(/\s+/g, '')));
    for (const tok of filter.split(/\s+/)) {
      if (!tok) continue;
      const alts = tok.split('/');
      let ok = false;
      for (const a of alts) {
        const neg = a.startsWith('!'); const v = a.replace(/^!/, '').toLowerCase().replace(/\s+/g, '');
        const known = ['horde', 'alliance', 'human', 'orc', 'dwarf', 'nightelf', 'undead', 'tauren', 'gnome', 'troll', 'bloodelf', 'draenei',
          'warrior', 'paladin', 'hunter', 'rogue', 'priest', 'shaman', 'mage', 'warlock', 'druid'].includes(v);
        if (!known) { ok = true; break; } // unknown tokens (e.g. "Boosted") — don't exclude
        const has = mine.has(v);
        if (neg ? !has : has) { ok = true; break; }
      }
      if (!ok) return false;
    }
    return true;
  }

  /** Resolve a #next value ("Name" | "Group\\Name" | alternatives separated by ";") to a guide. First existing alternative wins. */
  function resolveNext(guides, fromGuide) {
    if (!fromGuide.next) return null;
    for (const alt of fromGuide.next.split(';')) {
      const a = alt.trim(); if (!a) continue;
      const bs = a.lastIndexOf('\\');
      const grp = bs >= 0 ? a.slice(0, bs).trim() : fromGuide.group;
      const nm = bs >= 0 ? a.slice(bs + 1).trim() : a;
      const hit = guides.find((g) => g.name === nm && (g.group === grp || !grp)) || guides.find((g) => g.name.toLowerCase() === nm.toLowerCase());
      if (hit) return hit;
    }
    return null;
  }
  /** Order chapters by following #next from a starting chapter (crosses groups, follows the primary path). */
  function chapterOrder(guides, group, startName) {
    let cur = guides.find((g) => g.group === group && g.name === startName);
    if (!cur) {
      const inGroup = guides.filter((g) => g.group === group);
      cur = inGroup.find((g) => !guides.some((o) => o.next && o.next.includes(g.name))) || inGroup[0];
    }
    const out = []; const seen = new Set();
    while (cur && !seen.has(cur.group + '|' + cur.name)) { seen.add(cur.group + '|' + cur.name); out.push(cur); cur = resolveNext(guides, cur); }
    return out;
  }

  /**
   * Evaluate ordered chapters against the engine analysis, simulating the guide walk:
   * a quest counts as available if it is done, in the log, or turned in earlier in the walk.
   * @returns {chapters:[{guide,isCurrent,steps:[...],issues}], activeQuests:[rows]}
   */
  function evaluate(chapters, analysis, player, charState) {
    const rows = analysis.rows; const S = analysis.STATUS;
    const virtualDone = new Set(charState.activeQuests || []);
    const blockedInWalk = new Set(); const acceptedInWalk = new Set();
    const out = [];
    let reachedCurrent = !charState.currentGuideName; // if we don't know position, everything is "upcoming"
    for (const g of chapters) {
      const isCurrent = g.name === charState.currentGuideName && g.group === charState.currentGuideGroup;
      if (g.steps.length && g.steps[0].num === undefined) numberSteps(g, player);
      const ch = { guide: g, isCurrent, steps: [], issues: { blocked: 0, cascade: 0, noquest: 0, done: 0, missed: 0, unknown: 0 }, applies: filterApplies(g.filter, player) };
      g.steps.forEach((st, i) => {
        const applies = ch.applies && st.visible;
        const isCurrentStep = isCurrent && st.num === charState.currentStep;
        if (isCurrentStep) reachedCurrent = true;
        const past = isCurrent && st.visible && st.num < charState.currentStep; // steps already behind the player in the current chapter
        const items = [], turnins = [];
        for (const act of st.actions) {
          if (act.filter && !filterApplies(act.filter, player)) continue;
          const r = rows[act.id];
          if (act.kind === 'turnin') {
            const have = (r && (r.done || r.inLog)) || acceptedInWalk.has(act.id);
            let tIssue = '';
            if (!r) tIssue = 'unknown';
            else if (r.done) tIssue = 'done';
            else if (blockedInWalk.has(act.id)) tIssue = 'cascade';
            else if (!have && !r.repeatable) tIssue = 'noquest'; // guide expects a quest you should have picked up in an earlier chapter
            if (applies && have && !blockedInWalk.has(act.id) && !(r && r.done)) virtualDone.add(act.id);
            if (applies && !past && tIssue === 'noquest') ch.issues.noquest = (ch.issues.noquest || 0) + 1;
            turnins.push({ id: act.id, name: r ? r.name : (act.text || `Quest ${act.id}`), row: r || null, issue: tIssue });
            continue;
          }
          let issue = '', missing = [], causes = [];
          if (!r) issue = 'unknown';
          else if (r.done) issue = 'done';
          else if (r.inLog) issue = 'inlog';
          else if (r.status === S.MISSED) issue = 'missed';
          else if (!r.eligible) issue = 'ineligible';
          else {
            missing = analysis.missingPrereqs(act.id, virtualDone);
            if (missing.length) {
              causes = missing.flatMap((slot) => slot.filter((o) => blockedInWalk.has(o.id)));
              issue = causes.length === missing.length ? 'cascade' : 'blocked';
              if (applies && !past) blockedInWalk.add(act.id);
            }
          }
          if (applies && !issue) acceptedInWalk.add(act.id);
          if (applies && !past && ['blocked', 'cascade', 'done', 'missed', 'unknown'].includes(issue)) ch.issues[issue] = (ch.issues[issue] || 0) + 1;
          items.push({ id: act.id, name: r ? r.name : (charState.questNames[act.id] || act.text || `Quest ${act.id}`), row: r || null, issue, missing, causes, status: r ? r.status : '' });
        }
        ch.steps.push({ index: st.num || 0, raw: i + 1, applies, optional: st.optional, past, accepts: items, turnins, completes: st.completes, collects: st.collects, gotos: st.gotos, mobs: st.mobs, text: st.text.join(' '), lines: st.text, isCurrent: isCurrentStep, upcoming: reachedCurrent && !past });
      });
      out.push(ch);
    }
    return { chapters: out, activeQuests: (charState.activeQuests || []).map((id) => rows[id] || { id, name: charState.questNames[id] || `Quest ${id}`, level: 0, zone: '', status: '' }) };
  }

  const api = { bytesToBinaryString, luaUnescapeToBytes, inflateRawBrowser, parseAccountCache, parseCharacterFile, extractGuideBodies, parseGuide, filterApplies, numberSteps, chapterOrder, resolveNext, evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.QC = Object.assign(root.QC || {}, { RXP: api });
})(typeof window !== 'undefined' ? window : globalThis);
