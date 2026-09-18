/* Questie Compass — local folder access
 * Two paths: File System Access API (Chrome/Edge; handle remembered in IndexedDB) and
 * <input type=file webkitdirectory> fallback (Firefox/Safari; nothing remembered).
 * Produces a normalized "source" describing the files we care about inside a WoW flavor folder.
 */
(function (root) {
  'use strict';

  const FLAVORS = ['_classic_era_', '_anniversary_', '_classic_', '_retail_', '_classic_ptr_', '_classic_era_ptr_'];
  const DB_NAME = 'questie-compass', STORE = 'handles';

  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 2);
      r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); if (!d.objectStoreNames.contains('questdb')) d.createObjectStore('questdb'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function saveHandle(handle) {
    try { const db = await idb(); await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(handle, 'wow'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch (e) { /* ignore */ }
  }
  async function loadHandle() {
    try { const db = await idb(); return await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readonly'); const rq = tx.objectStore(STORE).get('wow'); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => rej(rq.error); }); } catch (e) { return null; }
  }
  async function forgetHandle() {
    try { const db = await idb(); await new Promise((res) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete('wow'); tx.oncomplete = res; tx.onerror = res; }); } catch (e) { /* ignore */ }
  }

  const supportsFSA = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  /* ---- Handle-based walking ---- */
  async function getDir(handle, ...names) {
    let h = handle;
    for (const n of names) { try { h = await h.getDirectoryHandle(n); } catch (e) { return null; } }
    return h;
  }
  async function getFile(dirHandle, name) {
    if (!dirHandle) return null;
    try { const fh = await dirHandle.getFileHandle(name); return await fh.getFile(); } catch (e) { return null; }
  }
  async function listDirs(dirHandle) {
    const out = []; if (!dirHandle) return out;
    for await (const [name, h] of dirHandle.entries()) if (h.kind === 'directory') out.push({ name, handle: h });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  async function listFiles(dirHandle, pred) {
    const out = []; if (!dirHandle) return out;
    for await (const [name, h] of dirHandle.entries()) if (h.kind === 'file' && (!pred || pred(name))) out.push({ name, file: await h.getFile() });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Given a directory handle (WoW root or flavor folder), find flavor folders. */
  async function detectFlavors(handle) {
    const subs = await listDirs(handle);
    const flavors = subs.filter((d) => FLAVORS.includes(d.name));
    if (flavors.length) return flavors;
    // Already inside a flavor folder?
    const hasWTF = await getDir(handle, 'WTF'); const hasIF = await getDir(handle, 'Interface');
    if (hasWTF || hasIF) return [{ name: handle.name, handle }];
    return [];
  }

  /** Build the source description from a flavor folder handle. */
  async function scanFlavorHandle(flavorHandle) {
    const src = emptySource(flavorHandle.name);
    const accountsDir = await getDir(flavorHandle, 'WTF', 'Account');
    for (const acct of await listDirs(accountsDir)) {
      if (acct.name.toUpperCase() === 'SAVEDVARIABLES') continue;
      const sv = await getDir(acct.handle, 'SavedVariables');
      const q = await getFile(sv, 'Questie.lua');
      if (q) src.questieLua.push({ account: acct.name, file: q });
      const rx = await getFile(sv, 'RXPGuides.lua');
      if (rx) src.rxpAccount.push({ account: acct.name, file: rx });
      for (const realm of await listDirs(acct.handle)) {
        if (realm.name === 'SavedVariables') continue;
        for (const chr of await listDirs(realm.handle)) {
          const csv = await getDir(chr.handle, 'SavedVariables');
          const crx = await getFile(csv, 'RXPGuides.lua');
          if (crx) src.rxpChar.push({ account: acct.name, realm: realm.name, name: chr.name, key: `${chr.name} - ${realm.name}`, file: crx });
        }
      }
    }
    const addons = await getDir(flavorHandle, 'Interface', 'AddOns');
    const questie = await getDir(addons, 'Questie');
    if (questie) {
      src.questieAddon.present = true;
      for (const toc of ['Questie-Classic.toc', 'Questie.toc', 'Questie-BCC.toc', 'Questie-WOTLKC.toc']) {
        const f = await getFile(questie, toc); if (f) { src.questieAddon.tocs.push({ name: toc, file: f }); }
      }
      const dbDir = await getDir(questie, 'Database');
      if (dbDir) {
        src.questieAddon.layout = 'classic';
        src.questieAddon.files.questieDB = await getFile(dbDir, 'QuestieDB.lua');
        src.questieAddon.files.constants = await getFile(dbDir, 'Constants.lua');
        const classic = await getDir(dbDir, 'Classic');
        src.questieAddon.files.questDB = await getFile(classic, 'classicQuestDB.lua');
        const corr = await getDir(dbDir, 'Corrections');
        src.questieAddon.files.questFixes = await getFile(corr, 'classicQuestFixes.lua');
        src.questieAddon.files.blacklist = await getFile(corr, 'QuestieQuestBlacklist.lua');
        src.questieAddon.files.zones = await getFile(await getDir(questie, 'Localization', 'lookups'), 'lookupZones.lua');
        src.questieAddon.files.expansions = await getFile(await getDir(questie, 'Modules'), 'Expansions.lua');
      }
    }
    const questieDB = await getDir(addons, 'QuestieDB');
    if (questieDB) { src.questieAddon.present = true; src.questieAddon.newLayout = true; }
    const rxpDir = await getDir(addons, 'RXPGuides');
    if (rxpDir) {
      src.rxpAddon.present = true;
      const guides = await getDir(rxpDir, 'Guides');
      src.rxpAddon.guideFiles = await listFiles(guides, (n) => n.toLowerCase().endsWith('.lua'));
    }
    return src;
  }

  /* ---- FileList (webkitdirectory) walking ---- */
  function scanFileList(fileList) {
    const files = Array.from(fileList);
    const norm = files.map((f) => ({ f, p: (f.webkitRelativePath || f.name).replace(/\\/g, '/') }));
    let flavorName = '';
    for (const { p } of norm) { const seg = p.split('/'); const hit = seg.find((s) => FLAVORS.includes(s)); if (hit) { flavorName = hit; break; } }
    const rootName = norm.length ? norm[0].p.split('/')[0] : '';
    const src = emptySource(flavorName || rootName);
    // Anchor each path at the WTF or Interface folder so the user may pick the WoW root, a flavor folder, or just WTF.
    const rel = (p) => {
      const seg = p.split('/');
      let i = seg.findIndex((s, idx) => (s === 'WTF' || s === 'Interface') && idx < seg.length - 1);
      if (i < 0) return null;
      if (rootName === 'WTF' && i === 0) return seg.join('/');
      return seg.slice(i).join('/');
    };
    for (const { f, p } of norm) {
      const r = rel(p); if (!r) continue; const seg = r.split('/');
      if (seg[0] === 'WTF' && seg[1] === 'Account' && seg.length >= 5) {
        const account = seg[2];
        if (seg[3] === 'SavedVariables' && seg.length === 5) {
          if (seg[4] === 'Questie.lua') src.questieLua.push({ account, file: f });
          if (seg[4] === 'RXPGuides.lua') src.rxpAccount.push({ account, file: f });
        } else if (seg.length === 7 && seg[5] === 'SavedVariables' && seg[6] === 'RXPGuides.lua') {
          src.rxpChar.push({ account, realm: seg[3], name: seg[4], key: `${seg[4]} - ${seg[3]}`, file: f });
        }
      } else if (seg[0] === 'Interface' && seg[1] === 'AddOns') {
        if (seg[2] === 'Questie') {
          src.questieAddon.present = true;
          if (seg.length === 4 && /^Questie.*\.toc$/i.test(seg[3])) src.questieAddon.tocs.push({ name: seg[3], file: f });
          if (seg[3] === 'Database') {
            src.questieAddon.layout = 'classic';
            if (r.endsWith('Database/QuestieDB.lua')) src.questieAddon.files.questieDB = f;
            if (r.endsWith('Database/Constants.lua')) src.questieAddon.files.constants = f;
            if (r.endsWith('Database/Classic/classicQuestDB.lua')) src.questieAddon.files.questDB = f;
            if (r.endsWith('Database/Corrections/classicQuestFixes.lua')) src.questieAddon.files.questFixes = f;
            if (r.endsWith('Database/Corrections/QuestieQuestBlacklist.lua')) src.questieAddon.files.blacklist = f;
          }
          if (r.endsWith('Localization/lookups/lookupZones.lua')) src.questieAddon.files.zones = f;
          if (r.endsWith('Modules/Expansions.lua')) src.questieAddon.files.expansions = f;
        } else if (seg[2] === 'QuestieDB') { src.questieAddon.present = true; src.questieAddon.newLayout = true; }
        else if (seg[2] === 'RXPGuides') {
          src.rxpAddon.present = true;
          if (seg[3] === 'Guides' && seg.length === 5 && /\.lua$/i.test(seg[4])) src.rxpAddon.guideFiles.push({ name: seg[4], file: f });
        }
      }
    }
    return src;
  }

  function emptySource(flavor) {
    return { flavor, questieLua: [], rxpAccount: [], rxpChar: [], questieAddon: { present: false, layout: '', newLayout: false, tocs: [], files: {} }, rxpAddon: { present: false, guideFiles: [] } };
  }

  /** Read a File as text (utf-8) or bytes. */
  const readText = (file) => file.text();
  const readBytes = async (file) => new Uint8Array(await file.arrayBuffer());

  const api = { supportsFSA, FLAVORS, saveHandle, loadHandle, forgetHandle, detectFlavors, scanFlavorHandle, scanFileList, readText, readBytes, getDir, getFile, listDirs };
  root.QC = Object.assign(root.QC || {}, { FS: api });
})(typeof window !== 'undefined' ? window : globalThis);
