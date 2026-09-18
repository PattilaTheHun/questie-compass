"""Load Questie's Classic quest DB (base + corrections + blacklist) and the
player's completed quests into JSON for analysis."""
import json, re, sys
from lupa import LuaRuntime, lua_type

ROOT = "/tmp/claude-0/-home-claude/3ddb225f-2edc-5145-9a5f-ca36c65a3a35/scratchpad/QuestieOld"
SAVED = "/root/.claude/uploads/3ddb225f-2edc-5145-9a5f-ca36c65a3a35/31b89d8b-Questie.lua"
OUT = "/tmp/claude-0/-home-claude/3ddb225f-2edc-5145-9a5f-ca36c65a3a35/scratchpad/questdb.json"

lua = LuaRuntime(unpack_returned_tuples=True)
lua.execute(r"""
-- Minimal WoW/Questie environment stubs
WOW_PROJECT_ID = 2
Questie = {IsClassic = true, IsTBC=false, IsWotlk=false, IsCata=false, IsMoP=false}
local anyNumber = setmetatable({}, {__index = function() return 0 end})
local modules = {}
QuestieLoader = {}
function QuestieLoader:CreateModule(n) modules[n] = modules[n] or {}; return modules[n] end
function QuestieLoader:ImportModule(n) modules[n] = modules[n] or {}; return modules[n] end
hooksecurefunc = function() end
-- Stubs for tables corrections reference but we don't need
local ZoneDB = QuestieLoader:CreateModule("ZoneDB"); ZoneDB.zoneIDs = anyNumber
local QP = QuestieLoader:CreateModule("QuestieProfessions")
QP.professionKeys = anyNumber; QP.specializationKeys = anyNumber; QP.rankNames = anyNumber
local QC = QuestieLoader:CreateModule("QuestieCorrections"); QC.itemObjectiveFirst = {}
local QDB = QuestieLoader:CreateModule("QuestieDB"); QDB.factionIDs = anyNumber
local l10n = QuestieLoader:CreateModule("l10n")
setmetatable(l10n, {__call = function(_, s) return s end})
""")

def run_file(path):
    with open(f"{ROOT}/{path}", encoding="utf-8") as f:
        lua.execute(f.read())

run_file("Modules/Expansions.lua")
src=open(f"{ROOT}/Database/QuestieDB.lua",encoding="utf-8").read()
start=src.index("QuestieDB.raceKeys = {"); end=src.index("QuestieDB.specialFlags = {"); end=src.index("}",end)+1
lua.execute("local QuestieDB = QuestieLoader:ImportModule('QuestieDB')\n"+src[start:end])
run_file("Database/Constants.lua")            # sortKeys
run_file("Database/Classic/classicQuestDB.lua")
run_file("Localization/lookups/lookupZones.lua")
run_file("Database/Corrections/classicQuestFixes.lua")
run_file("Database/Corrections/QuestieQuestBlacklist.lua")

lua.execute(r"""
local QDB = QuestieLoader:ImportModule("QuestieDB")
QUESTS = load(QDB.questData)()
local fixes = QuestieLoader:ImportModule("QuestieQuestFixes"):Load()
FIXCOUNT = 0
for id, fix in pairs(fixes) do
  if QUESTS[id] then
    for k, v in pairs(fix) do QUESTS[id][k] = v; FIXCOUNT = FIXCOUNT + 1 end
  end
end
local bl = QuestieLoader:ImportModule("QuestieQuestBlacklist"):Load()
BLACKLIST = {}
for id, v in pairs(bl) do if v == true then BLACKLIST[id] = true end end
""")

keys = dict(lua.eval("QuestieLoader:ImportModule('QuestieDB').questKeys").items())
kidx = {v: k for k, v in keys.items()}

def to_py(v):
    if lua_type(v) == "table":
        items = list(v.items())
        if all(isinstance(k, int) for k, _ in items):
            return [to_py(x) for _, x in sorted(items)]
        return {str(k): to_py(x) for k, x in items}
    return v

wanted = ["name","requiredLevel","questLevel","requiredRaces","requiredClasses",
          "preQuestGroup","preQuestSingle","childQuests","inGroupWith","exclusiveTo",
          "zoneOrSort","requiredSkill","requiredMinRep","requiredMaxRep","nextQuestInChain",
          "questFlags","specialFlags","parentQuest","breadcrumbForQuestId","breadcrumbs",
          "requiredMaxLevel","availableUntilCompleted","availableStartingWith","objectivesText",
          "startedBy","finishedBy","requiredSpecialization","requiredSpell"]
quests = {}
Q = lua.eval("QUESTS")
for qid, row in Q.items():
    d = {}
    for name in wanted:
        v = row[keys[name]]
        if v is not None:
            d[name] = to_py(v)
    quests[int(qid)] = d

blacklist = sorted(int(k) for k in lua.eval("BLACKLIST").keys())

# zone names: l10n.zoneLookup[continent][zoneId] = name
zones = {}
ZL = lua.eval("QuestieLoader:ImportModule('l10n').zoneLookup")
for cont, tbl in ZL.items():
    for zid, name in tbl.items():
        if isinstance(name, str):
            zones.setdefault(int(zid), name)
sortkeys = {int(v): k for k, v in lua.eval("QuestieLoader:ImportModule('QuestieDB').sortKeys").items()}

# Completed quests from SavedVariables
txt = open(SAVED, encoding="utf-8", errors="replace").read()
m = re.search(r'\["complete"\] = \{(.*?)\n\},', txt, re.S)
completed = sorted({int(x) for x in re.findall(r'\[(\d+)\] = true', m.group(1))})

json.dump({"quests": quests, "blacklist": blacklist, "zones": zones,
           "sortKeys": sortkeys, "completed": completed}, open(OUT, "w"))
print("quests", len(quests), "fixes applied", lua.eval("FIXCOUNT"),
      "blacklisted", len(blacklist), "completed", len(completed), "zones", len(zones))
