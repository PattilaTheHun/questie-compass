/* Questie Compass — Web Worker: evaluate the installed Questie Lua database with fengari (Lua 5.3 in JS)
 * Input:  { files: { questieDB, constants, questDB, questFixes, blacklist, zones, expansions } } (all strings)
 * Output: { ok:true, db:{quests, blacklist, zones, sortKeys} } or { ok:false, error }
 */
self.window = self; // fengari-web's UMD wrapper expects `window`
importScripts('../vendor/fengari-web.js');

const STUBS = `
WOW_PROJECT_ID = 2
WOW_PROJECT_CLASSIC = 2
Questie = {IsClassic = true, IsTBC = false, IsWotlk = false, IsCata = false, IsMoP = false}
local anyNumber = setmetatable({}, {__index = function() return 0 end})
local modules = {}
QuestieLoader = {}
function QuestieLoader:CreateModule(n) modules[n] = modules[n] or {}; return modules[n] end
function QuestieLoader:ImportModule(n) modules[n] = modules[n] or {}; return modules[n] end
hooksecurefunc = function() end
strbyte, strsplit, tinsert = string.byte, function() end, table.insert
local ZoneDB = QuestieLoader:CreateModule("ZoneDB"); ZoneDB.zoneIDs = anyNumber
local QP = QuestieLoader:CreateModule("QuestieProfessions")
QP.professionKeys = anyNumber; QP.specializationKeys = anyNumber; QP.rankNames = anyNumber
local QC = QuestieLoader:CreateModule("QuestieCorrections"); QC.itemObjectiveFirst = {}
local QDB = QuestieLoader:CreateModule("QuestieDB"); QDB.factionIDs = anyNumber
local l10n = QuestieLoader:CreateModule("l10n")
setmetatable(l10n, {__call = function(_, s) return s end})
`;

const EXTRACT = `
local QDB = QuestieLoader:ImportModule("QuestieDB")
local keys = QDB.questKeys
local quests = load(QDB.questData)()
local fixcount = 0
local okFix, fixesMod = pcall(function() return QuestieLoader:ImportModule("QuestieQuestFixes"):Load() end)
if okFix and type(fixesMod) == "table" then
  for id, fix in pairs(fixesMod) do
    if quests[id] then for k, v in pairs(fix) do quests[id][k] = v; fixcount = fixcount + 1 end end
  end
end
local blacklist = {}
local okBL, bl = pcall(function() return QuestieLoader:ImportModule("QuestieQuestBlacklist"):Load() end)
if okBL and type(bl) == "table" then for id, v in pairs(bl) do if v == true then blacklist[#blacklist+1] = id end end end
table.sort(blacklist)

local wanted = {"name","requiredLevel","questLevel","requiredRaces","requiredClasses","preQuestGroup","preQuestSingle",
  "childQuests","inGroupWith","exclusiveTo","zoneOrSort","requiredSkill","requiredMinRep","requiredMaxRep","nextQuestInChain",
  "questFlags","specialFlags","parentQuest","breadcrumbForQuestId","breadcrumbs","requiredMaxLevel","availableUntilCompleted",
  "availableStartingWith","objectivesText","requiredSpecialization","requiredSpell"}

-- minimal JSON encoder
local esc = { ['"']='\\\\"', ['\\\\']='\\\\\\\\', ['\\b']='\\\\b', ['\\f']='\\\\f', ['\\n']='\\\\n', ['\\r']='\\\\r', ['\\t']='\\\\t' }
local function encstr(s) return '"' .. s:gsub('[%c"\\\\]', function(c) return esc[c] or string.format('\\\\u%04x', c:byte()) end) .. '"' end
local function isseq(t) local n = 0; for k in pairs(t) do if type(k) ~= "number" or k < 1 or k % 1 ~= 0 then return false end; n = n + 1 end; return n == #t end
local enc
local function encnum(n) if n ~= n or n == math.huge or n == -math.huge then return "null" end; if n % 1 == 0 then return string.format("%d", n) end; return string.format("%.10g", n) end
enc = function(v, out)
  local t = type(v)
  if v == nil then out[#out+1] = "null"
  elseif t == "boolean" then out[#out+1] = v and "true" or "false"
  elseif t == "number" then out[#out+1] = encnum(v)
  elseif t == "string" then out[#out+1] = encstr(v)
  elseif t == "table" then
    if isseq(v) then out[#out+1] = "["; for i = 1, #v do if i > 1 then out[#out+1] = "," end; enc(v[i], out) end; out[#out+1] = "]"
    else
      out[#out+1] = "{"; local first = true
      for k, x in pairs(v) do if not first then out[#out+1] = "," end; first = false; out[#out+1] = encstr(tostring(k)); out[#out+1] = ":"; enc(x, out) end
      out[#out+1] = "}"
    end
  else out[#out+1] = "null" end
end

local out = {}
out[#out+1] = '{"quests":{'
local first = true
for id, row in pairs(quests) do
  if type(row) == "table" then
    if not first then out[#out+1] = "," end; first = false
    out[#out+1] = encstr(tostring(id)); out[#out+1] = ":{"
    local f2 = true
    for _, k in ipairs(wanted) do
      local idx = keys[k]
      local v = idx and row[idx]
      if v ~= nil then
        if not f2 then out[#out+1] = "," end; f2 = false
        out[#out+1] = encstr(k); out[#out+1] = ":"; enc(v, out)
      end
    end
    out[#out+1] = "}"
  end
end
out[#out+1] = '},"blacklist":'; enc(blacklist, out)
local zones = {}
local l10n = QuestieLoader:ImportModule("l10n")
if type(l10n.zoneLookup) == "table" then
  for _, tbl in pairs(l10n.zoneLookup) do if type(tbl) == "table" then for zid, nm in pairs(tbl) do if type(nm) == "string" and zones[zid] == nil then zones[zid] = nm end end end end
end
out[#out+1] = ',"zones":'; enc(zones, out)
local sortKeys = {}
for k, v in pairs(QDB.sortKeys or {}) do sortKeys[v] = k end
out[#out+1] = ',"sortKeys":'; enc(sortKeys, out)
out[#out+1] = ',"stats":{"fixes":' .. fixcount .. ',"fixesOk":' .. tostring(okFix) .. ',"blacklistOk":' .. tostring(okBL) .. '}}'
return table.concat(out)
`;

function sliceQuestieDB(src) {
  // Only the constants block (raceKeys … specialFlags) is needed; the rest of QuestieDB.lua needs the WoW client.
  const start = src.indexOf('QuestieDB.raceKeys = {');
  let end = src.indexOf('QuestieDB.specialFlags = {');
  if (start < 0 || end < 0) throw new Error('QuestieDB.lua: constants block not found');
  end = src.indexOf('}', end) + 1;
  return 'local QuestieDB = QuestieLoader:ImportModule("QuestieDB")\n' + src.slice(start, end);
}

self.onmessage = (ev) => {
  const { files } = ev.data;
  const t0 = Date.now();
  const step = (msg) => self.postMessage({ progress: msg });
  try {
    const run = (code, name) => { const fn = fengari.load(code, name); return fn(); };
    step('Preparing Lua environment…'); run(STUBS, 'stubs');
    if (files.expansions) run(files.expansions, 'Expansions.lua');
    run(sliceQuestieDB(files.questieDB), 'QuestieDB.lua');
    run(files.constants, 'Constants.lua');
    step('Loading quest database…'); run(files.questDB, 'classicQuestDB.lua');
    if (files.zones) { try { run(files.zones, 'lookupZones.lua'); } catch (e) { /* zones optional */ } }
    step('Loading corrections…'); run(files.questFixes, 'classicQuestFixes.lua');
    if (files.blacklist) { try { run(files.blacklist, 'QuestieQuestBlacklist.lua'); } catch (e) { /* optional */ } }
    step('Applying corrections and exporting…');
    const json = run(EXTRACT, 'extract');
    const db = JSON.parse(json);
    self.postMessage({ ok: true, db, ms: Date.now() - t0 });
  } catch (e) {
    self.postMessage({ ok: false, error: String(e && e.message || e) });
  }
};
