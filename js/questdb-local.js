/* Questie Compass — read the quest database from the user's installed Questie addon.
 * Runs the addon's Lua data files in a Web Worker (fengari). Result is cached in IndexedDB keyed by
 * Questie version + file sizes, so later visits are instant. Returns null when it cannot (caller falls back to snapshot).
 */
(function (root) {
  'use strict';
  const DB_NAME = 'questie-compass', STORE = 'questdb';
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 2);
      r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('handles')) d.createObjectStore('handles'); if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function cacheGet(key) { try { const d = await idb(); return await new Promise((res) => { const rq = d.transaction(STORE).objectStore(STORE).get(key); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); }); } catch (e) { return null; } }
  async function cachePut(key, val) { try { const d = await idb(); await new Promise((res) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear(); tx.objectStore(STORE).put(val, key); tx.oncomplete = res; tx.onerror = res; }); } catch (e) { /* ignore */ } }

  function versionFromToc(text) { const m = /^## Version:\s*(.+)$/m.exec(text || ''); return m ? m[1].trim() : ''; }

  /**
   * @param addon  source.questieAddon from fsaccess ({tocs:[{name,file}], files:{questDB, questFixes, blacklist, questieDB, constants, zones, expansions}})
   * @param progress(msg)
   * @returns {Promise<{db, version, ms, cached}|null>}
   */
  async function load(addon, progress) {
    const f = addon.files || {};
    if (!f.questDB || !f.questFixes || !f.questieDB || !f.constants) return null;
    if (typeof Worker === 'undefined') return null;
    const toc = addon.tocs && addon.tocs.find((t) => /Classic/i.test(t.name)) || (addon.tocs || [])[0];
    const version = toc ? versionFromToc(await toc.file.text()) : '';
    const key = `s2|v${version}|${f.questDB.size}|${f.questFixes.size}|${f.blacklist ? f.blacklist.size : 0}`;
    const cached = await cacheGet(key);
    if (cached) return { db: cached, version, ms: 0, cached: true };

    progress && progress('Reading installed Questie files…');
    const texts = {};
    for (const k of ['questieDB', 'constants', 'questDB', 'questFixes', 'blacklist', 'zones', 'expansions', 'xp']) if (f[k]) texts[k] = await f[k].text();

    return new Promise((resolve) => {
      let worker;
      try { worker = new Worker('js/questdb-worker.js'); } catch (e) { resolve(null); return; }
      const timer = setTimeout(() => { try { worker.terminate(); } catch (e) { /* */ } resolve(null); }, 120000);
      worker.onmessage = (ev) => {
        const m = ev.data;
        if (m.progress) { progress && progress(m.progress); return; }
        clearTimeout(timer); worker.terminate();
        if (m.ok && m.db && m.db.quests && Object.keys(m.db.quests).length > 1000) {
          m.db.meta = { source: 'local', questieVersion: version, builtAt: new Date().toISOString().slice(0, 10) };
          cachePut(key, m.db);
          resolve({ db: m.db, version, ms: m.ms, cached: false });
        } else { console.warn('Local Questie DB:', m.error || 'empty result'); resolve(null); }
      };
      worker.onerror = (e) => { clearTimeout(timer); console.warn('Local Questie DB worker error', e.message || e); resolve(null); };
      worker.postMessage({ files: texts });
    });
  }

  root.QC = Object.assign(root.QC || {}, { LocalDB: { load, versionFromToc } });
})(window);
