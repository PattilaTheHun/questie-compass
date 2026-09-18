/* Questie Compass — application (UI + orchestration) */
(function () {
  'use strict';
  const QC = window.QC; const FS = QC.FS; const RXP = QC.RXP;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wh = (id) => `https://www.wowhead.com/classic/quest=${id}`;
  const SPANS = [[1, 10], [10, 20], [20, 30], [30, 40], [40, 50], [50, 60], [1, 60]];
  const RACE_NAMES = { 1: 'Human', 2: 'Orc', 4: 'Dwarf', 8: 'Night Elf', 16: 'Undead', 32: 'Tauren', 64: 'Gnome', 128: 'Troll' };
  const HORDE = [2, 128, 32, 16], ALLIANCE = [1, 4, 8, 64];

  const state = {
    db: null, dbInfo: { kind: 'snapshot', label: '', date: '' },
    source: null, chars: [], selected: null,
    player: { level: 1, raceBit: 0, classBit: 0, faction: '' },
    rxp: { available: false, enabled: false, charState: null, chapters: [], evaluation: null },
    analysis: null, report: null,
    f: { lo: 1, hi: 60, zone: '', cat: '', status: '', q: '', hideProf: false, hideEvents: true },
    open: new Set(), showAllCompleted: false, sortKey: 'level', sortDir: 1,
  };
  try { const f = JSON.parse(localStorage.getItem('qc-filters') || 'null'); if (f) Object.assign(state.f, f); } catch (e) { /* ignore */ }

  /* ---------- boot ---------- */
  function boot() {
    state.db = window.QC_SNAPSHOT || null;
    const meta = (state.db && state.db.meta) || {};
    state.dbInfo = { kind: 'snapshot', label: `bundled snapshot (Questie ${meta.questieTag || '?'})`, date: meta.builtAt || '' };
    $('#ftr-meta').textContent = meta.builtAt ? ` · Quest data snapshot ${meta.builtAt}` : '';
    $('#btn-theme').onclick = () => { const cur = document.documentElement.getAttribute('data-theme'); const next = cur === 'light' ? 'dark' : 'light'; document.documentElement.setAttribute('data-theme', next); try { localStorage.setItem('qc-theme', next); } catch (e) { /* ignore */ } };
    $('#btn-restart').onclick = () => location.reload();

    if (FS.supportsFSA) {
      $('#btn-pick').classList.remove('hidden');
      $('#btn-pick').onclick = pickFolderFSA;
      $('#pick-hint2').innerHTML = 'Chrome and Edge can also <b>remember</b> the folder for one-click refreshes — but they refuse folders under <code>Program Files</code> (“contains system files”). If WoW lives elsewhere, use “Choose &amp; remember folder”.';
      FS.loadHandle().then((h) => { if (h) { const b = $('#btn-reuse'); b.textContent = `↻ Re-read “${h.name}”`; b.classList.remove('hidden'); b.onclick = () => reuseHandle(h); $('#btn-forget').classList.remove('hidden'); $('#btn-forget').onclick = async () => { await FS.forgetHandle(); b.classList.add('hidden'); $('#btn-forget').classList.add('hidden'); }; } });
    }
    $('#inp-dir').onchange = (e) => { if (e.target.files.length) onSource(FS.scanFileList(e.target.files)); };
    $('#inp-lua').onchange = (e) => { const f = e.target.files[0]; if (f) onSource({ flavor: '', questieLua: [{ account: 'chosen file', file: f }], rxpAccount: [], rxpChar: [], questieAddon: { present: false, files: {} , tocs: [] }, rxpAddon: { present: false, guideFiles: [] } }); };
    const cp = $('#btn-copy'); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText($('#default-path').textContent); cp.textContent = 'copied ✓'; setTimeout(() => { cp.textContent = 'copy path'; }, 1800); } catch (e) { cp.textContent = 'select & copy manually'; } };
    document.addEventListener('click', onDocClick);
  }

  async function pickFolderFSA() {
    let handle;
    try { handle = await window.showDirectoryPicker({ id: 'wow-folder', mode: 'read', startIn: 'documents' }); }
    catch (e) { status('Folder not opened. If Chrome said the folder “contains system files”, that is its rule for anything under Program Files — use <b>📁 Choose WoW folder</b> instead, which works for any location.', 'warn'); return; }
    await useHandle(handle);
  }
  async function reuseHandle(handle) {
    try {
      let perm = await handle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'read' });
      if (perm !== 'granted') { status('Permission to read the folder was not granted.', 'warn'); return; }
    } catch (e) { status('Could not re-open the remembered folder. Please choose it again.', 'warn'); return; }
    await useHandle(handle, true);
  }
  async function useHandle(handle, reused) {
    status('Scanning folder…');
    const flavors = await FS.detectFlavors(handle);
    if (!flavors.length) { status(`No WoW data found in “${handle.name}”. Choose the <code>_classic_era_</code> folder or the <code>World of Warcraft</code> folder.`, 'bad'); return; }
    let flavor = flavors.find((f) => f.name === '_classic_era_') || flavors[0];
    if (flavors.length > 1) {
      const pick = await chooseFlavor(flavors); if (!pick) return; flavor = pick;
    }
    if (!reused) await FS.saveHandle(handle);
    const src = await FS.scanFlavorHandle(flavor.handle);
    onSource(src);
  }
  function chooseFlavor(flavors) {
    return new Promise((res) => {
      const box = $('#scan-status');
      box.innerHTML = `<div class="notice">Several game versions found. Which one? ${flavors.map((f, i) => `<button class="btn" data-flavor="${i}" style="margin:4px 6px 0 0">${esc(f.name)}</button>`).join('')}</div>`;
      box.querySelectorAll('[data-flavor]').forEach((b) => { b.onclick = () => res(flavors[+b.dataset.flavor]); });
    });
  }
  function status(html, kind) { $('#scan-status').innerHTML = html ? `<div class="notice ${kind || ''}">${html}</div>` : ''; }

  /* ---------- source → characters ---------- */
  async function onSource(src) {
    state.source = src;
    status('Reading files…');
    const chars = [];
    for (const q of src.questieLua) {
      const text = await FS.readText(q.file);
      for (const c of QC.parseQuestieLua(text)) chars.push(Object.assign(c, { account: q.account, fileDate: q.file.lastModified }));
    }
    state.chars = chars.sort((a, b) => b.completed.length - a.completed.length);
    const pills = [];
    pills.push(`<span class="pill ${src.questieLua.length ? 'ok' : 'bad'}">${src.questieLua.length ? `${src.questieLua.length} account${src.questieLua.length > 1 ? 's' : ''}, ${chars.length} character${chars.length !== 1 ? 's' : ''} with Questie data` : 'No Questie.lua found under WTF\\Account'}</span>`);
    pills.push(`<span class="pill ${src.rxpAccount.length ? 'purple' : ''}">${src.rxpAccount.length ? 'RestedXP data found' : 'No RestedXP data'}</span>`);
    // Local Questie DB
    if (src.questieAddon.present && src.questieAddon.files.questDB && window.QC.LocalDB) {
      pills.push(`<span class="pill info" id="pill-db">Installed Questie found — reading its quest database…</span>`);
      status(pills.join(' '));
      try {
        const res = await QC.LocalDB.load(src.questieAddon, (msg) => { const p = $('#pill-db'); if (p) p.textContent = msg; });
        if (res && res.db) { state.db = res.db; state.dbInfo = { kind: 'local', label: `your installed Questie ${res.version || ''}`.trim(), date: '' }; }
        const p = $('#pill-db'); if (p) { p.textContent = res && res.db ? `Quest data: your installed Questie ${res.version || ''}` : `Installed Questie not readable — using bundled snapshot`; p.className = 'pill ' + (res && res.db ? 'ok' : 'warn'); }
      } catch (e) {
        const p = $('#pill-db'); if (p) { p.textContent = 'Installed Questie not readable — using bundled snapshot'; p.className = 'pill warn'; }
        console.warn('Local Questie DB failed', e);
      }
    } else if (src.questieAddon.present && src.questieAddon.newLayout) {
      pills.push(`<span class="pill warn">Installed Questie uses a newer database layout — using bundled snapshot</span>`);
    } else {
      pills.push(`<span class="pill">Quest data: ${esc(state.dbInfo.label)}${state.dbInfo.date ? ' · ' + esc(state.dbInfo.date) : ''}</span>`);
    }
    status(pills.join(' '));
    if (!chars.length) { status(pills.join(' ') + `<div style="margin-top:8px">No characters with Questie data were found. Make sure Questie is installed and you have logged out (or <code>/reload</code>) at least once.</div>`, 'warn'); return; }
    renderCharSetup();
  }

  function renderCharSetup() {
    const box = $('#charsetup'); box.classList.remove('hidden');
    const opts = state.chars.map((c, i) => `<option value="${i}">${esc(c.key)} — ${esc(titleCase(c.class))} · ${c.completed.length} quests done${state.chars.length > 1 && state.source.questieLua.length > 1 ? ` · ${esc(c.account)}` : ''}</option>`).join('');
    box.innerHTML = `
      <div class="setup-grid">
        <div class="field"><label>Character</label><select id="sel-char">${opts}</select><div class="hint" id="char-hint"></div></div>
        <div class="field"><label>Faction</label><select id="sel-faction"><option value="Horde">Horde</option><option value="Alliance">Alliance</option></select></div>
        <div class="field"><label>Race</label><select id="sel-race"></select><div class="hint" id="race-hint"></div></div>
        <div class="field"><label>Class</label><select id="sel-class">${Object.entries(QC.CLASS_LABEL).map(([b, n]) => `<option value="${b}">${n}</option>`).join('')}</select></div>
        <div class="field"><label>Level</label><input type="number" id="inp-level" min="1" max="60" step="1"><div class="hint" id="level-hint"></div></div>
        <div class="field"><label>RestedXP</label><label class="inline-toggle" style="margin-top:6px"><input type="checkbox" id="chk-rxp"> <span id="rxp-label">Include RestedXP guide analysis</span></label></div>
      </div>
      <div class="btn-row" style="margin-top:14px"><button class="btn primary" id="btn-go">Analyze ▸</button><span class="hint" style="color:var(--text-3);font-size:13px">You can change the level range and filters afterwards without re-reading anything.</span></div>`;
    const selChar = $('#sel-char'); selChar.onchange = fillFromChar; $('#sel-faction').onchange = fillRaces;
    $('#btn-go').onclick = analyze;
    fillFromChar();
  }
  function fillFromChar() {
    const c = state.chars[+$('#sel-char').value]; state.selected = c;
    const inf = QC.inferCharacter(state.db, c.completed);
    $('#sel-faction').value = inf.faction || 'Horde';
    fillRaces(inf.raceBit); $('#race-hint').textContent = inf.raceNote || '';
    const cls = QC.CLASSES[c.class] || 0; if (cls) $('#sel-class').value = cls;
    // RestedXP per-character state gives a better level estimate
    const rxpChar = state.source.rxpChar.find((r) => r.key === c.key);
    const rxpAcct = state.source.rxpAccount.find((r) => r.account === c.account) || state.source.rxpAccount[0];
    state.rxp.available = !!(rxpAcct && rxpChar); $('#chk-rxp').disabled = !state.rxp.available; $('#chk-rxp').checked = state.rxp.available;
    $('#rxp-label').textContent = state.rxp.available ? 'Include RestedXP guide analysis' : 'RestedXP data not found for this character';
    $('#inp-level').value = inf.level; $('#level-hint').textContent = `Estimated from your completed quests — correct it if needed.`;
    if (rxpChar) {
      FS.readText(rxpChar.file).then((t) => {
        const cs = RXP.parseCharacterFile(t); state.rxp.charState = cs;
        const m = /^(\d+)-(\d+)/.exec(cs.currentGuideName || '');
        if (m) { $('#inp-level').value = +m[1]; $('#level-hint').textContent = `From your RestedXP position: “${cs.currentGuideName}”. Correct it if needed.`; }
      });
    }
    const ageDays = Math.round((Date.now() - c.fileDate) / 864e5);
    $('#char-hint').textContent = c.fileDate ? `Questie.lua last written ${ageDays === 0 ? 'today' : ageDays + ' day' + (ageDays === 1 ? '' : 's') + ' ago'}${ageDays > 1 ? ' — log out or /reload in game for fresh data' : ''}.` : '';
  }
  function fillRaces(preferBit) {
    const fac = $('#sel-faction').value; const list = fac === 'Horde' ? HORDE : ALLIANCE;
    const sel = $('#sel-race'); const cur = +sel.value;
    sel.innerHTML = list.map((b) => `<option value="${b}">${RACE_NAMES[b]}</option>`).join('');
    sel.value = list.includes(preferBit) ? preferBit : (list.includes(cur) ? cur : list[0]);
  }
  const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

  /* ---------- analysis ---------- */
  async function analyze() {
    const c = state.selected;
    state.player = { level: Math.max(1, Math.min(60, +$('#inp-level').value || 1)), raceBit: +$('#sel-race').value, classBit: +$('#sel-class').value, faction: $('#sel-faction').value };
    state.rxp.enabled = state.rxp.available && $('#chk-rxp').checked;
    let inLog = [];
    if (state.rxp.enabled && state.rxp.charState) inLog = state.rxp.charState.activeQuests;
    state.analysis = QC.analyze(state.db, Object.assign({ completed: c.completed, inLog }, state.player));
    // default span: the one containing the player's level
    const sp = SPANS.find(([lo, hi]) => state.player.level >= lo && state.player.level < hi) || [1, 60];
    if (!(state.f.lo <= state.player.level && state.player.level <= state.f.hi) || (state.f.lo === 1 && state.f.hi === 60)) { state.f.lo = sp[0]; state.f.hi = sp[1]; }
    if (state.rxp.enabled) await loadRxp();
    $('#setup').classList.add('hidden'); $('#btn-restart').classList.remove('hidden');
    renderHeaderPills();
    render();
    window.scrollTo(0, 0);
  }

  async function loadRxp() {
    const c = state.selected;
    const acct = state.source.rxpAccount.find((r) => r.account === c.account) || state.source.rxpAccount[0];
    const guides = [];
    try {
      const entries = RXP.parseAccountCache(await FS.readBytes(acct.file));
      for (const e of entries) {
        try { const g = RXP.parseGuide(await RXP.inflateRawBrowser(e.bytes)); if (g.name) guides.push(g); } catch (err) { /* skip broken entry */ }
      }
    } catch (e) { console.warn('RXP cache', e); }
    for (const gf of state.source.rxpAddon.guideFiles || []) {
      try { for (const body of RXP.extractGuideBodies(await FS.readText(gf.file))) { const g = RXP.parseGuide(body); if (g.name && !guides.some((x) => x.group === g.group && x.name === g.name)) guides.push(g); } } catch (e) { /* ignore */ }
    }
    state.rxp.guides = guides;
    const cs = state.rxp.charState || { currentGuideGroup: '', currentGuideName: '', currentStep: 0, activeQuests: [], questNames: {} };
    const ordered = RXP.chapterOrder(guides, cs.currentGuideGroup, cs.currentGuideName);
    const player = { faction: state.player.faction, race: RACE_NAMES[state.player.raceBit], className: QC.CLASS_LABEL[state.player.classBit] };
    state.rxp.chapters = ordered;
    state.rxp.evaluation = RXP.evaluate(ordered, state.analysis, player, cs);
  }

  function renderHeaderPills() {
    const p = state.player; const c = state.selected;
    $('#hdr-pills').innerHTML = `<span class="pill accent">${esc(c.name)} · ${esc(RACE_NAMES[p.raceBit])} ${esc(QC.CLASS_LABEL[p.classBit])} · ${p.level}</span>
      <span class="pill ${state.dbInfo.kind === 'local' ? 'ok' : ''}" title="Where the quest database came from">${esc(state.dbInfo.label)}</span>
      ${state.rxp.enabled ? '<span class="pill purple">RestedXP on</span>' : ''}`;
  }

  /* ---------- report rendering ---------- */
  function currentReport() {
    state.report = state.analysis.report({ lo: state.f.lo, hi: state.f.hi, hideProfessions: state.f.hideProf, hideEvents: state.f.hideEvents });
    return state.report;
  }
  function passes(r) {
    const f = state.f;
    if (f.zone && r.zone !== f.zone) return false;
    if (f.cat && r.category !== f.cat) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.q) { const q = f.q.toLowerCase(); if (!(r.name.toLowerCase().includes(q) || String(r.id) === q || (r.zone || '').toLowerCase().includes(q))) return false; }
    return true;
  }
  function render() {
    const R = currentReport();
    try { localStorage.setItem('qc-filters', JSON.stringify(state.f)); } catch (e) { /* ignore */ }
    const rep = $('#report'); rep.classList.remove('hidden');
    const catchUp = R.catchUp.filter(passes), ready = R.ready.filter(passes), later = R.later.filter(passes), blocked = R.blocked.filter(passes), missed = R.missed.filter(passes), inLog = R.inLog.filter(passes), needsRep = R.needsRep.filter(passes);
    const lines = R.questlines.filter((l) => l.steps.some(passes));
    const rxpIssues = state.rxp.enabled && state.rxp.evaluation ? countRxpIssues() : 0;
    const zones = Array.from(new Set(Object.values(state.analysis.rows).filter((r) => r.eligible && r.level >= R.lo && r.level <= R.hi).map((r) => r.zone))).sort();
    const cats = ['Zone', 'Dungeon', 'Class', 'Profession', 'Raid', 'Special', 'Event / PvP'];
    const statuses = Object.values(QC.STATUS).filter((s) => s !== QC.STATUS.INELIGIBLE);
    const spanLabel = R.lo === 1 && R.hi === 60 ? 'all levels' : `levels ${R.lo}–${R.hi}`;

    rep.innerHTML = `
      <div class="filters" id="filters">
        <div class="chips">${SPANS.map(([lo, hi]) => `<button class="chip ${lo === R.lo && hi === R.hi ? 'on' : ''}" data-span="${lo}-${hi}">${lo === 1 && hi === 60 ? 'All' : `${lo}–${hi}`}</button>`).join('')}</div>
        <select id="f-zone"><option value="">All zones</option>${zones.map((z) => `<option ${z === state.f.zone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select>
        <select id="f-cat"><option value="">All categories</option>${cats.map((z) => `<option ${z === state.f.cat ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select>
        <select id="f-status"><option value="">Any status</option>${statuses.map((z) => `<option ${z === state.f.status ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select>
        <input type="search" id="f-q" placeholder="Search quest or zone…" value="${esc(state.f.q)}">
        <label class="inline-toggle"><input type="checkbox" id="f-prof" ${state.f.hideProf ? 'checked' : ''}> Hide professions</label>
        <label class="inline-toggle"><input type="checkbox" id="f-events" ${state.f.hideEvents ? 'checked' : ''}> Hide holiday / PvP</label>
      </div>

      <div class="tiles">
        ${tile(catchUp.length, 'Go back and do', 'warn', 'sec-catchup')}
        ${tile(ready.length + inLog.length, 'Ready now', 'ok', 'sec-coming')}
        ${tile(later.length, 'Unlock at a higher level', 'info', 'sec-coming')}
        ${tile(blocked.length, 'Blocked by prerequisites', 'bad', 'sec-blocked')}
        ${tile(lines.filter((l) => l.started).length, 'Questlines in progress', 'purple', 'sec-lines')}
        ${state.rxp.enabled ? tile(rxpIssues, 'RestedXP steps to fix', rxpIssues ? 'bad' : 'ok', 'sec-rxp') : ''}
        ${tile(R.totals.completedKnown, 'Completed (all levels)', '', 'sec-done')}
      </div>
      <nav class="secnav">
        <a href="#sec-catchup">Do these first<span class="c">${catchUp.length}</span></a>
        <a href="#sec-coming">Coming up<span class="c">${ready.length + later.length + inLog.length}</span></a>
        <a href="#sec-blocked">Blocked<span class="c">${blocked.length}</span></a>
        <a href="#sec-lines">Questlines<span class="c">${lines.length}</span></a>
        <a href="#sec-zones">Zones<span class="c">${R.zones.length}</span></a>
        <a href="#sec-dungeons">Dungeon prep<span class="c">${R.dungeons.length}</span></a>
        ${state.rxp.enabled ? `<a href="#sec-rxp">RestedXP<span class="c">${rxpIssues}</span></a>` : ''}
        <a href="#sec-missed">Missed<span class="c">${missed.length}</span></a>
        <a href="#sec-done">Completed<span class="c">${R.totals.completedKnown}</span></a>
        <a href="#sec-all">All quests</a>
      </nav>

      ${section('sec-catchup', 'Do these first', `Quests you skipped that gate ${spanLabel} content — ranked by how much they unlock`, renderCatchUp(catchUp, R))}
      ${section('sec-coming', 'Coming up', `What you can pick up in ${spanLabel} — grouped by zone`, renderComing(inLog, ready, later, needsRep))}
      ${section('sec-blocked', 'Blocked', `${spanLabel} quests waiting on something you haven’t done — expand one to see the full path`, renderBlocked(blocked))}
      ${section('sec-lines', 'Questlines', 'Chains touching this level range. Gold = your next step, green = done, purple = in your log, red outline = blocked', renderLines(lines))}
      ${section('sec-zones', 'Zone completion', `How much of each zone’s ${spanLabel} content you have done`, renderZones(R.zones))}
      ${section('sec-dungeons', 'Dungeon prep', 'Collect these before you run — grouped by what you can take now', renderDungeons(R.dungeons))}
      ${state.rxp.enabled ? section('sec-rxp', 'RestedXP guide check', 'Upcoming guide steps that will not work as written, and why', renderRxp()) : ''}
      ${section('sec-missed', 'Missed / unavailable', 'Not a loss — just noise removed. Usually because you completed a mutually exclusive alternative', renderSimple(missed, (r) => r.missedReason))}
      ${section('sec-done', 'Completed', `${R.totals.completedKnown} quests Questie has recorded as turned in`, renderCompleted(R.completed))}
      ${section('sec-all', 'All quests in range', 'Everything your character can see in this level range — click a column to sort', renderAll(R))}
    `;
    // wire filters
    rep.querySelectorAll('[data-span]').forEach((b) => { b.onclick = () => { const [lo, hi] = b.dataset.span.split('-').map(Number); state.f.lo = lo; state.f.hi = hi; render(); }; });
    $('#f-zone').onchange = (e) => { state.f.zone = e.target.value; render(); };
    $('#f-cat').onchange = (e) => { state.f.cat = e.target.value; render(); };
    $('#f-status').onchange = (e) => { state.f.status = e.target.value; render(); };
    $('#f-prof').onchange = (e) => { state.f.hideProf = e.target.checked; render(); };
    $('#f-events').onchange = (e) => { state.f.hideEvents = e.target.checked; render(); };
    let t; $('#f-q').oninput = (e) => { clearTimeout(t); const v = e.target.value; t = setTimeout(() => { state.f.q = v; render(); const el = $('#f-q'); el.focus(); el.setSelectionRange(v.length, v.length); }, 250); };
  }
  function tile(n, label, kind, target) { return `<a class="tile ${kind}" href="#${target}"><div class="n">${n}</div><div class="l">${esc(label)}</div></a>`; }
  function section(id, title, sub, body) { return `<section class="card" id="${id}"><div class="card-h"><h2>${esc(title)}</h2><span class="sub">${esc(sub)}</span></div><div class="card-b">${body}</div></section>`; }
  function statusTag(r) {
    const S = QC.STATUS; const m = { [S.COMPLETED]: 'ok', [S.READY]: 'ok', [S.IN_LOG]: 'purple', [S.BLOCKED]: 'bad', [S.MISSED]: '', [S.LATER]: 'info', [S.NEEDS_REP]: 'warn', [S.REPEATABLE]: '', [S.SUBQUEST]: 'info' };
    const label = r.status === S.LATER ? `Ready at level ${r.reqLevel}` : r.status;
    return `<span class="tag ${m[r.status] || ''}">${esc(label)}</span>`;
  }
  function qrow(r, extraMeta, side, detail, opts) {
    opts = opts || {};
    const key = (opts.keyPrefix || '') + r.id; const isOpen = state.open.has(key);
    return `<li class="q" data-q="${r.id}">
      <div class="lvl"><b>${r.level || '–'}</b>${r.reqLevel ? `req ${r.reqLevel}` : ''}</div>
      <div>
        <div class="name"><a href="${wh(r.id)}" target="_blank" rel="noopener" title="Open on Wowhead">${esc(r.name)}</a> <span style="color:var(--text-3);font-weight:400;font-size:12px">#${r.id}</span></div>
        <div class="meta">${r.zone ? `<span>${esc(r.zone)}</span>` : ''}${r.category !== 'Zone' ? `<span class="tag">${esc(r.category)}</span>` : ''}${r.dungeon ? `<span class="tag info">${esc(r.dungeon)}</span>` : ''}${extraMeta || ''}${detail ? ` <a href="#" data-toggle="${esc(key)}">${isOpen ? 'Hide details' : 'Details'}</a>` : ''}</div>
        ${r.objective && !opts.noObj ? `<div class="obj">${esc(r.objective)}</div>` : ''}
      </div>
      <div class="side">${side || statusTag(r)}</div>
      ${detail && isOpen ? `<div class="detail">${detail}</div>` : ''}
    </li>`;
  }
  function prereqDetail(r) {
    if (!r.prereqs.length) return '';
    return `<div class="lbl">Requires</div><ul>${r.prereqs.map((s) => `<li>${s.met ? '✅' : '❌'} ${s.options.map((o) => `<a href="${wh(o.id)}" target="_blank" rel="noopener">${esc(o.name)}</a>${o.done ? ' <span class="tag ok">done</span>' : ''}`).join(' <i>or</i> ')}</li>`).join('')}</ul>`;
  }
  function groupByZone(rows) { const m = new Map(); for (const r of rows) { const z = r.zone || 'Other'; if (!m.has(z)) m.set(z, []); m.get(z).push(r); } return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length); }
  function zoneGroups(rows, rowFn, sortInZone) { return groupByZone(rows).map(([z, rs]) => { if (sortInZone) rs = rs.slice().sort(sortInZone); return `<div class="zone-h"><h3>${esc(z)}</h3><span class="c">${rs.length}</span></div><ul class="qlist">${rs.map(rowFn).join('')}</ul>`; }).join(''); }

  function renderCatchUp(list, R) {
    if (!list.length) return `<div class="empty">Nothing to catch up on in this range — every blocked quest here is waiting on other ${R.lo}–${R.hi} quests, not on something you skipped.</div>`;
    const lower = list.filter((c) => c.skippedLower), same = list.filter((c) => !c.skippedLower);
    const row = (c) => qrow(c,
      `<span class="tag warn">unlocks ${c.gatesCount} quest${c.gatesCount === 1 ? '' : 's'} here${c.unlocksTotal > c.gatesCount ? ` · ${c.unlocksTotal} overall` : ''}</span>${c.skippedLower ? '<span class="tag bad">skipped lower-level</span>' : ''}<span class="tag">${esc(c.chainRole)}</span>`,
      statusTag(c),
      `<div class="lbl">Unlocks</div><ul>${c.gates.map((g) => `<li><a href="${wh(g.id)}" target="_blank" rel="noopener">${esc(g.name)}</a> <small style="color:var(--text-3)">lvl ${g.level} · ${esc(g.zone)}</small></li>`).join('')}</ul>${prereqDetail(c)}`,
      { keyPrefix: 'cu' });
    let html = '';
    if (lower.length) html += `<div class="notice warn" style="margin-bottom:12px"><b>${lower.length}</b> lower-level quest${lower.length === 1 ? '' : 's'} you skipped ${lower.length === 1 ? 'is' : 'are'} blocking content in this range. Do these on your way — they are the real catch-up list.</div>` + zoneGroups(lower, row, (a, b) => a.level - b.level || a.name.localeCompare(b.name));
    if (same.length) html += `<div class="zone-h" style="margin-top:22px"><h3 style="color:var(--text-2)">Also required — chains in this range you have not started</h3><span class="c">${same.length}</span></div><ul class="qlist">${same.slice(0, state.open.has('cu-more') ? 9999 : 25).map(row).join('')}</ul>${same.length > 25 && !state.open.has('cu-more') ? `<div class="more"><a href="#" data-toggle="cu-more">Show all ${same.length}</a></div>` : ''}`;
    return html;
  }
  function renderComing(inLog, ready, later, needsRep) {
    let html = '';
    if (inLog.length) html += `<div class="zone-h"><h3 style="color:var(--purple)">In your quest log</h3><span class="c">${inLog.length}</span></div><ul class="qlist">${inLog.map((r) => qrow(r, leadsTo(r), statusTag(r), prereqDetail(r) + unlocksDetail(r), { keyPrefix: 'il' })).join('')}</ul>`;
    if (ready.length) html += zoneGroups(ready, (r) => qrow(r, leadsTo(r), statusTag(r), unlocksDetail(r), { keyPrefix: 'rd' }));
    else html += '<div class="empty">Nothing ready right now in this range.</div>';
    if (later.length) html += `<div class="zone-h" style="margin-top:22px"><h3 style="color:var(--info)">Unlocks as you level</h3><span class="c">${later.length}</span></div><ul class="qlist">${later.map((r) => qrow(r, leadsTo(r), statusTag(r), unlocksDetail(r), { keyPrefix: 'lt', noObj: true })).join('')}</ul>`;
    if (needsRep.length) html += `<div class="zone-h" style="margin-top:22px"><h3 style="color:var(--warn)">Needs reputation, a profession or a skill</h3><span class="c">${needsRep.length}</span></div><ul class="qlist">${needsRep.map((r) => qrow(r, leadsTo(r), statusTag(r), unlocksDetail(r), { keyPrefix: 'nr', noObj: true })).join('')}</ul>`;
    return html;
  }
  function leadsTo(r) {
    const role = `<span class="tag ${r.chainRole === 'Standalone' ? '' : 'info'}">${r.chainRole === 'Chain start' ? `Starts a chain of ${r.chainSize}` : r.chainRole}</span>`;
    return role + (r.unlocksTotal ? `<span class="tag">leads to ${r.unlocksTotal}</span>` : '');
  }
  function unlocksDetail(r) {
    if (!r.unlocks.length) return '';
    const rows = state.analysis.rows;
    return `<div class="lbl">Directly unlocks</div><ul>${r.unlocks.map((u) => rows[u]).sort((a, b) => a.level - b.level).map((u) => `<li><a href="${wh(u.id)}" target="_blank" rel="noopener">${esc(u.name)}</a> <small style="color:var(--text-3)">lvl ${u.level} · ${esc(u.zone)}</small></li>`).join('')}</ul>`;
  }
  function renderBlocked(list) {
    if (!list.length) return '<div class="empty">Nothing blocked in this range.</div>';
    return zoneGroups(list, (r) => qrow(r,
      `<span class="tag bad">${r.catchUpCount} quest${r.catchUpCount === 1 ? '' : 's'} to catch up</span>${r.catchUp.some((c) => c.level < state.f.lo) ? '<span class="tag warn">includes skipped lower-level</span>' : ''}`,
      statusTag(r),
      `<div class="lbl">Path to unlock (in order)</div><ol>${r.catchUp.map((c) => `<li><a href="${wh(c.id)}" target="_blank" rel="noopener">${esc(c.name)}</a> <small style="color:var(--text-3)">lvl ${c.level} · ${esc(c.zone)}</small> ${statusTag(c)}</li>`).join('')}</ol>${prereqDetail(r)}`,
      { keyPrefix: 'bl' }));
  }
  function renderLines(lines) {
    if (!lines.length) return '<div class="empty">No questlines touch this range with the current filters.</div>';
    const S = QC.STATUS;
    const cls = (r) => r.done ? 'done' : r.status === S.IN_LOG ? 'inlog' : r.status === S.READY ? 'ready' : r.status === S.BLOCKED ? 'blocked' : r.status === S.MISSED ? 'missed' : 'todo';
    const started = lines.filter((l) => l.started), fresh = lines.filter((l) => !l.started && !l.complete), completeL = lines.filter((l) => l.complete);
    const one = (l) => `<div class="ql">
      <div class="ql-h"><b>${esc(l.name)}</b><span class="c">${l.done}/${l.total} done · up to lvl ${l.maxLevel}</span>${l.stalled ? '<span class="tag warn">stalled below this range</span>' : ''}${l.nextStep ? `<span class="tag ok">next: ${esc(l.nextStep.name)}</span>` : ''}</div>
      <div class="stepper">${l.steps.map((r, i) => `<div class="st ${cls(r)}" title="${esc(r.name)} — ${esc(r.status)} (lvl ${r.level})">${i ? '<span class="bar"></span>' : ''}<span class="dot"></span><span class="lab"><span><a href="${wh(r.id)}" target="_blank" rel="noopener" style="color:inherit">${esc(r.name)}</a></span><em>${r.level}${r.zone && r.zone !== l.steps[0].zone ? ' · ' + esc(r.zone) : ''}</em></span></div>`).join('')}</div>
    </div>`;
    let html = '';
    if (started.length) html += `<div class="zone-h"><h3>In progress</h3><span class="c">${started.length}</span></div>${started.map(one).join('')}`;
    if (fresh.length) html += `<div class="zone-h" style="margin-top:22px"><h3>Not started</h3><span class="c">${fresh.length}</span></div>${fresh.slice(0, state.open.has('ql-more') ? 9999 : 20).map(one).join('')}${fresh.length > 20 && !state.open.has('ql-more') ? `<div class="more"><a href="#" data-toggle="ql-more">Show all ${fresh.length}</a></div>` : ''}`;
    if (completeL.length) html += `<div class="zone-h" style="margin-top:22px"><h3 style="color:var(--ok)">Finished</h3><span class="c">${completeL.length}</span></div>${state.open.has('ql-done') ? completeL.map(one).join('') : `<div class="more"><a href="#" data-toggle="ql-done">Show ${completeL.length} finished questlines</a></div>`}`;
    return html;
  }
  function renderZones(zones) {
    if (!zones.length) return '<div class="empty">No zone quests in this range.</div>';
    return `<div class="zgrid">${zones.map((z) => { const pct = Math.round(100 * z.done / z.total); const seg = (n, c) => n ? `<i class="${c}" style="width:${100 * n / z.total}%"></i>` : ''; return `<div class="zcard" data-zone="${esc(z.zone)}" title="Filter to ${esc(z.zone)}"><div class="zn">${esc(z.zone)}<small>${pct}%</small></div><div class="bar-track">${seg(z.done, 'done')}${seg(z.inLog, 'inlog')}${seg(z.ready, 'ready')}${seg(z.later, 'later')}${seg(z.blocked, 'blocked')}</div><div class="legend"><span><i style="background:var(--ok)"></i>${z.done} done</span>${z.inLog ? `<span><i style="background:var(--purple)"></i>${z.inLog} in log</span>` : ''}<span><i style="background:var(--accent)"></i>${z.ready} ready</span>${z.later ? `<span><i style="background:var(--info)"></i>${z.later} later</span>` : ''}<span><i style="background:var(--bad)"></i>${z.blocked} blocked</span>${z.missed ? `<span>${z.missed} missed</span>` : ''}<span style="margin-left:auto">${z.total} total</span></div></div>`; }).join('')}</div>`;
  }
  function renderDungeons(ds) {
    if (!ds.length) return '<div class="empty">No dungeons in this range.</div>';
    const S = QC.STATUS;
    const li = (r, extra) => `<li><a href="${wh(r.id)}" target="_blank" rel="noopener">${esc(r.name)}</a> <small>lvl ${r.level}${extra ? ' · ' + extra : ''}</small></li>`;
    return `<div class="dgrid">${ds.map((d) => {
      const take = d.quests.filter((r) => r.status === S.READY || r.status === S.IN_LOG);
      const later = d.quests.filter((r) => r.status === S.LATER);
      const blk = d.quests.filter((r) => r.status === S.BLOCKED);
      const done = d.quests.filter((r) => r.done);
      const other = d.quests.filter((r) => ![...take, ...later, ...blk, ...done].includes(r));
      return `<div class="dcard"><h3>${esc(d.name)}<small>lvl ${d.band[0]}–${d.band[1]} · ${done.length}/${d.quests.length} done</small></h3>
        ${take.length ? `<div class="grp"><div class="lbl" style="color:var(--ok)">Take before you go</div><ul>${take.map((r) => li(r, r.status === S.IN_LOG ? 'in your log' : esc(r.zone !== d.name ? r.zone : ''))).join('')}</ul></div>` : ''}
        ${later.length ? `<div class="grp"><div class="lbl" style="color:var(--info)">At a higher level</div><ul>${later.map((r) => li(r, `at ${r.reqLevel}`)).join('')}</ul></div>` : ''}
        ${blk.length ? `<div class="grp"><div class="lbl" style="color:var(--bad)">Needs an earlier step first</div><ul>${blk.map((r) => li(r, 'first: ' + esc(r.prereqs.filter((p) => !p.met).map((p) => p.options.map((o) => o.name).join(' or ')).join('; ')))).join('')}</ul></div>` : ''}
        ${other.length ? `<div class="grp"><div class="lbl">Other</div><ul>${other.map((r) => li(r, esc(r.status))).join('')}</ul></div>` : ''}
        ${done.length ? `<div class="grp"><div class="lbl">Done</div><ul style="color:var(--text-3)">${done.map((r) => li(r)).join('')}</ul></div>` : ''}
      </div>`; }).join('')}</div>`;
  }
  function countRxpIssues() {
    let n = 0; const ev = state.rxp.evaluation;
    for (const ch of ev.chapters) { if (!chapterInSpan(ch)) continue; n += (ch.issues.blocked || 0) + (ch.issues.noquest || 0) + (ch.issues.missed || 0); }
    return n;
  }
  function chapterInSpan(ch) {
    const m = /^(\d+)-(\d+)/.exec(ch.guide.name); if (!m) return true;
    const lo = +m[1], hi = +m[2]; return !(hi < state.f.lo || lo > state.f.hi) || ch.isCurrent;
  }
  function renderRxp() {
    const ev = state.rxp.evaluation; const cs = state.rxp.charState || {};
    if (!ev || !ev.chapters.length) return '<div class="empty">No RestedXP guide chapters could be read for this character.</div>';
    let html = `<div class="notice" style="margin-bottom:12px">You are on <b>${esc(cs.currentGuideGroup || '')}</b> › <b>${esc(cs.currentGuideName || '?')}</b>, step ${cs.currentStep || '?'}. ${ev.activeQuests.length} quest${ev.activeQuests.length === 1 ? '' : 's'} in your log. Chapters below follow the guide’s own order from where you are.</div>`;
    const seen = new Set();
    for (const ch of ev.chapters) {
      if (!chapterInSpan(ch)) continue;
      const items = [];
      for (const st of ch.steps) {
        if (!st.applies || st.past) continue;
        for (const a of st.accepts) {
          if (!['blocked', 'missed', 'done', 'unknown'].includes(a.issue)) continue;
          const k = `${ch.guide.name}|a${a.id}`; if (seen.has(k)) continue; seen.add(k);
          items.push({ st, kind: a.issue, q: a });
        }
        for (const t of st.turnins) {
          if (t.issue !== 'noquest') continue;
          const k = `${ch.guide.name}|t${t.id}`; if (seen.has(k)) continue; seen.add(k);
          items.push({ st, kind: 'noquest', q: t });
        }
      }
      const bad = items.filter((i) => i.kind !== 'done' && i.kind !== 'unknown');
      const done = items.filter((i) => i.kind === 'done');
      const unknown = items.filter((i) => i.kind === 'unknown');
      html += `<div class="rxp-ch"><h3>${esc(ch.guide.name)} ${ch.isCurrent ? '<span class="pill accent">you are here</span>' : ''} <span class="pill ${bad.length ? 'bad' : 'ok'}">${bad.length ? `${bad.length} problem${bad.length === 1 ? '' : 's'}` : 'clear'}</span>${done.length ? `<span class="pill">${done.length} already done</span>` : ''}</h3>`;
      if (!items.length) { html += '<div class="empty" style="padding:4px 0">Every quest in this chapter is available to you as written.</div></div>'; continue; }
      const one = (it) => {
        const r = it.q.row; const link = r ? `<a href="${wh(r.id)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(it.q.name);
        let fix = '';
        if (it.kind === 'blocked') fix = `Guide accepts <b>${link}</b> but you are missing: ${it.q.missing.map((slot) => slot.map((o) => `<a href="${wh(o.id)}" target="_blank" rel="noopener">${esc(o.name)}</a> <small>(lvl ${o.level || '?'})</small>`).join(' <i>or</i> ')).join('; ')}. Do that first — ideally before you reach step ${it.st.index}.`;
        else if (it.kind === 'noquest') fix = `Guide turns in <b>${link}</b> but you never picked it up${r && r.status === QC.STATUS.BLOCKED ? ` — and it is blocked: needs ${esc(r.prereqs.filter((p) => !p.met).map((p) => p.options.map((o) => o.name).join(' or ')).join('; '))}` : r && r.status === QC.STATUS.READY ? ' — it is available now; grab it from an earlier chapter’s quest giver' : ''}.`;
        else if (it.kind === 'missed') fix = `Guide accepts <b>${link}</b> but it is no longer available to you: ${esc(r.missedReason)}.`;
        else if (it.kind === 'done') fix = `<b>${link}</b> — already completed; skip this step.`;
        return `<div class="rxp-item"><div class="stp">step ${it.st.index}${it.st.optional ? ' (opt)' : ''}</div><div><span class="tag ${it.kind === 'done' ? 'ok' : it.kind === 'missed' ? '' : 'bad'}">${it.kind === 'noquest' ? 'missing quest' : it.kind}</span> <div class="fix">${fix}</div></div></div>`;
      };
      html += bad.map(one).join('');
      if (done.length) html += `<details class="more-steps"><summary>${done.length} step${done.length === 1 ? '' : 's'} for quests you already completed</summary>${done.map(one).join('')}</details>`;
      if (unknown.length) html += `<details class="more-steps"><summary>${unknown.length} step${unknown.length === 1 ? '' : 's'} reference quests not in the Classic Era database (usually Season of Discovery content)</summary>${unknown.map((u) => `<div class="rxp-item"><div class="stp">step ${u.st.index}</div><div>${esc(u.q.name)} <small style="color:var(--text-3)">#${u.q.id}</small></div></div>`).join('')}</details>`;
      html += '</div>';
    }
    return html;
  }
  function renderSimple(list, why) {
    if (!list.length) return '<div class="empty">Nothing here.</div>';
    return `<ul class="qlist">${list.map((r) => qrow(r, `<span style="color:var(--text-2)">${esc(why(r))}</span>`, statusTag(r), '', { noObj: true })).join('')}</ul>`;
  }
  function renderCompleted(list) {
    const shown = state.open.has('done-all') ? list : list.filter((r) => r.level >= state.f.lo && r.level <= state.f.hi);
    const filtered = shown.filter(passes);
    return `<div style="margin-bottom:8px;color:var(--text-3);font-size:13px">${state.open.has('done-all') ? 'Showing all levels. ' : `Showing levels ${state.f.lo}–${state.f.hi}. `}<a href="#" data-toggle="done-all">${state.open.has('done-all') ? 'Show only this range' : 'Show all levels'}</a></div>${filtered.length ? zoneGroups(filtered, (r) => qrow(r, r.unlocks.length ? `<span class="tag">unlocked ${r.unlocks.length}</span>` : '', statusTag(r), unlocksDetail(r), { keyPrefix: 'dn', noObj: true })) : '<div class="empty">Nothing completed in this range.</div>'}`;
  }
  function renderAll(R) {
    const rows = Object.values(state.analysis.rows).filter((r) => r.eligible && r.level >= R.lo && r.level <= R.hi && passes(r) && !(state.f.hideProf && r.category === 'Profession') && !(state.f.hideEvents && r.category === 'Event / PvP'));
    const k = state.sortKey, d = state.sortDir;
    rows.sort((a, b) => { const x = a[k], y = b[k]; return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * d || a.level - b.level; });
    const th = (key, label) => `<th data-sort="${key}">${label}${state.sortKey === key ? (d > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    const limit = state.open.has('all-more') ? rows.length : 200;
    return `<table class="all"><thead><tr>${th('level', 'Lvl')}${th('reqLevel', 'Req')}${th('name', 'Quest')}${th('zone', 'Zone')}${th('category', 'Type')}${th('status', 'Status')}${th('chainName', 'Questline')}${th('unlocksTotal', 'Leads to')}</tr></thead><tbody>
      ${rows.slice(0, limit).map((r) => `<tr><td class="num">${r.level}</td><td class="num">${r.reqLevel || ''}</td><td><a href="${wh(r.id)}" target="_blank" rel="noopener">${esc(r.name)}</a></td><td>${esc(r.zone)}</td><td>${esc(r.category)}</td><td>${statusTag(r)}</td><td style="color:var(--text-2)">${esc(r.chainName)}${r.chainSize > 1 ? ` <small style="color:var(--text-3)">(${r.chainSize})</small>` : ''}</td><td class="num">${r.unlocksTotal || ''}</td></tr>`).join('')}
    </tbody></table>${rows.length > limit ? `<div class="more"><a href="#" data-toggle="all-more">Show all ${rows.length} rows</a></div>` : ''}`;
  }

  /* ---------- events ---------- */
  function onDocClick(e) {
    const t = e.target.closest('[data-toggle]');
    if (t) { e.preventDefault(); const k = t.dataset.toggle; if (state.open.has(k)) state.open.delete(k); else state.open.add(k); render(); return; }
    const z = e.target.closest('[data-zone]');
    if (z) { state.f.zone = state.f.zone === z.dataset.zone ? '' : z.dataset.zone; render(); document.getElementById('sec-coming').scrollIntoView({ behavior: 'smooth' }); return; }
    const s = e.target.closest('th[data-sort]');
    if (s) { const k = s.dataset.sort; if (state.sortKey === k) state.sortDir *= -1; else { state.sortKey = k; state.sortDir = 1; } render(); document.getElementById('sec-all').scrollIntoView(); return; }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
