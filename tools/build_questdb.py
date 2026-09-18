#!/usr/bin/env python3
"""Build the bundled quest-database snapshot from Questie's open-source Lua database.

Usage:
  python tools/build_questdb.py                 # newest Questie release tag that still ships Database/Classic
  python tools/build_questdb.py --tag v11.38.0  # a specific tag
  python tools/build_questdb.py --repo-dir ../Questie   # an existing checkout (skips cloning)

Writes data/questdb-era.js (window.QC_SNAPSHOT = {...}) and data/questdb-era.meta.json.
Requires: git, Python 3.9+, `pip install lupa`.
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, datetime

REPO = "https://github.com/Questie/Questie.git"
NEEDED = [
    "Database/QuestieDB.lua", "Database/Constants.lua", "Database/Classic/classicQuestDB.lua",
    "Database/Corrections/classicQuestFixes.lua", "Database/Corrections/QuestieQuestBlacklist.lua",
    "Localization/lookups/lookupZones.lua", "Modules/Expansions.lua",
    "Database/Classic/classicNpcDB.lua", "Database/Classic/classicObjectDB.lua", "Database/Classic/classicItemDB.lua",
    "Database/QuestXP/DB/xpDB-classic.lua",
]
SPARSE_DIRS = ["Database", "Localization/lookups", "Modules"]

def sh(cmd, cwd=None, check=True):
    r = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)} failed:\n{r.stderr}")
    return r.stdout

def version_key(tag):
    nums = [int(x) for x in re.findall(r"\d+", tag)]
    return nums + [0] * (4 - len(nums))

def list_tags():
    out = sh(["git", "ls-remote", "--tags", "--refs", REPO])
    tags = [line.split("refs/tags/")[1] for line in out.splitlines() if "refs/tags/" in line]
    tags = [t for t in tags if re.match(r"^v?\d+\.\d+", t)]
    return sorted(tags, key=version_key, reverse=True)

def checkout(tag, dest):
    sh(["git", "clone", "-q", "--depth", "1", "--branch", tag, "--filter=blob:none", "--sparse", REPO, dest])
    sh(["git", "sparse-checkout", "set", *SPARSE_DIRS], cwd=dest)
    return all(os.path.exists(os.path.join(dest, p)) for p in NEEDED)

def extract(root):
    from lupa import LuaRuntime, lua_type
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(r"""
        WOW_PROJECT_ID = 2
        WOW_PROJECT_CLASSIC = 2
        Questie = {IsClassic = true, IsTBC=false, IsWotlk=false, IsCata=false, IsMoP=false}
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
    """)
    def run(rel):
        with open(os.path.join(root, rel), encoding="utf-8") as f:
            lua.execute(f.read())
    run("Modules/Expansions.lua")
    src = open(os.path.join(root, "Database/QuestieDB.lua"), encoding="utf-8").read()
    start = src.index("QuestieDB.raceKeys = {"); end = src.index("QuestieDB.specialFlags = {"); end = src.index("}", end) + 1
    lua.execute("local QuestieDB = QuestieLoader:ImportModule('QuestieDB')\n" + src[start:end])
    run("Database/Constants.lua")
    run("Database/Classic/classicQuestDB.lua")
    run("Localization/lookups/lookupZones.lua")
    run("Database/Corrections/classicQuestFixes.lua")
    run("Database/Corrections/QuestieQuestBlacklist.lua")
    run("Database/Classic/classicNpcDB.lua")
    run("Database/Classic/classicObjectDB.lua")
    run("Database/Classic/classicItemDB.lua")
    run("Database/QuestXP/DB/xpDB-classic.lua")
    lua.execute(r"""
        local QDB = QuestieLoader:ImportModule("QuestieDB")
        QUESTS = load(QDB.questData)()
        FIXCOUNT = 0
        local fixes = QuestieLoader:ImportModule("QuestieQuestFixes"):Load()
        for id, fix in pairs(fixes) do
          if QUESTS[id] then for k, v in pairs(fix) do QUESTS[id][k] = v; FIXCOUNT = FIXCOUNT + 1 end end
        end
        BLACKLIST = {}
        local ok, bl = pcall(function() return QuestieLoader:ImportModule("QuestieQuestBlacklist"):Load() end)
        if ok then for id, v in pairs(bl) do if v == true then BLACKLIST[id] = true end end end
        NPCS = load(QDB.npcData)()
        OBJECTS = load(QDB.objectData)()
        ITEMS = load(QDB.itemData)()
        XP = QuestieLoader:ImportModule("QuestXP").db or {}
    """)
    keys = dict(lua.eval("QuestieLoader:ImportModule('QuestieDB').questKeys").items())
    def to_py(v):
        if lua_type(v) == "table":
            items = list(v.items())
            if all(isinstance(k, int) for k, _ in items):
                return [to_py(x) for _, x in sorted(items)]
            return {str(k): to_py(x) for k, x in items}
        return v
    wanted = ["name", "requiredLevel", "questLevel", "requiredRaces", "requiredClasses", "preQuestGroup", "preQuestSingle",
              "childQuests", "inGroupWith", "exclusiveTo", "zoneOrSort", "requiredSkill", "requiredMinRep", "requiredMaxRep",
              "nextQuestInChain", "questFlags", "specialFlags", "parentQuest", "breadcrumbForQuestId", "breadcrumbs",
              "requiredMaxLevel", "availableUntilCompleted", "availableStartingWith", "objectivesText",
              "requiredSpecialization", "requiredSpell"]
    def ref(tbl):
        """startedBy/finishedBy: positional {creature, object, item} tables -> {npc:[], obj:[], item:[]}"""
        if tbl is None: return None
        out = {}
        for idx, key in ((1, "npc"), (2, "obj"), (3, "item")):
            v = tbl[idx]
            if v is not None:
                ids = [int(x) for x in to_py(v) if isinstance(x, (int, float))]
                if ids: out[key] = ids
        return out or None
    quests = {}
    npc_ids, obj_ids, item_ids = set(), set(), set()
    XP = lua.eval("XP")
    NPCS, OBJECTS, ITEMS = lua.eval("NPCS"), lua.eval("OBJECTS"), lua.eval("ITEMS")
    def nm(tbl, i):
        r = tbl[i]
        return r[1] if r is not None else None
    def objectives(tbl):
        """Questie objectives table {creature, object, item, reputation, killcredit, spell} -> ordered list
        [{k, id, n(name), t(custom text)}] in quest-log order (creature, object, item, then the rest)."""
        if tbl is None: return None
        out = []
        for idx, kind, names in ((1, "npc", NPCS), (2, "obj", OBJECTS), (3, "item", ITEMS)):
            grp = tbl[idx]
            if grp is None: continue
            for _, ent in sorted(grp.items()):
                if ent is None: continue
                i = ent[1]; txt = ent[2] if isinstance(ent[2], str) else None
                if not isinstance(i, (int, float)): continue
                out.append({"k": kind, "id": int(i), "n": nm(names, int(i)), **({"t": txt} if txt else {})})
        rep = tbl[4]
        if rep is not None and rep[1] is not None: out.append({"k": "rep", "id": int(rep[1]), "n": None, "v": int(rep[2] or 0)})
        kc = tbl[5]
        if kc is not None:
            for _, ent in sorted(kc.items()):
                if ent is None: continue
                txt = ent[3] if isinstance(ent[3], str) else None
                base = ent[2] if isinstance(ent[2], (int, float)) else None
                out.append({"k": "kill", "id": int(base) if base else 0, "n": (nm(NPCS, int(base)) if base else None), **({"t": txt} if txt else {})})
        sp = tbl[6]
        if sp is not None:
            for _, ent in sorted(sp.items()):
                if ent is None: continue
                txt = ent[2] if isinstance(ent[2], str) else None
                out.append({"k": "spell", "id": int(ent[1] or 0), "n": None, **({"t": txt} if txt else {})})
        return out or None
    for qid, row in lua.eval("QUESTS").items():
        d = {}
        for name in wanted:
            v = row[keys[name]]
            if v is not None:
                d[name] = to_py(v)
        st = ref(row[keys["startedBy"]]); fi = ref(row[keys["finishedBy"]])
        if st: d["start"] = st; npc_ids.update(st.get("npc", [])); obj_ids.update(st.get("obj", []))
        if fi: d["finish"] = fi; npc_ids.update(fi.get("npc", [])); obj_ids.update(fi.get("obj", []))
        x = XP[int(qid)]
        if x is not None and x[1] and x[2] and x[1] > 0 and x[2] > 0: d["xp"] = [int(x[1]), int(x[2])]
        ob = objectives(row[keys["objectives"]])
        if ob: d["obj"] = ob
        quests[str(int(qid))] = d
    npcs = {}
    for i in sorted(npc_ids):
        n = NPCS[i]
        if n is not None: npcs[str(i)] = [n[1], int(n[9] or 0)]
    objects = {}
    for i in sorted(obj_ids):
        o = OBJECTS[i]
        if o is not None: objects[str(i)] = [o[1], int(o[5] or 0)]
    blacklist = sorted(int(k) for k in lua.eval("BLACKLIST").keys())
    zones = {}
    for _, tbl in lua.eval("QuestieLoader:ImportModule('l10n').zoneLookup").items():
        for zid, name in tbl.items():
            if isinstance(name, str):
                zones.setdefault(str(int(zid)), name)
    sort_keys = {str(int(v)): k for k, v in lua.eval("QuestieLoader:ImportModule('QuestieDB').sortKeys").items()}
    return {"quests": quests, "blacklist": blacklist, "zones": zones, "sortKeys": sort_keys, "npcs": npcs, "objects": objects}, int(lua.eval("FIXCOUNT"))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", help="Questie tag to build from (default: newest that ships Database/Classic)")
    ap.add_argument("--repo-dir", help="Existing Questie checkout to use instead of cloning")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data"))
    ap.add_argument("--max-tags", type=int, default=15, help="How many tags (newest first) to try before giving up")
    args = ap.parse_args()

    tmp = None
    try:
        if args.repo_dir:
            root, tag = args.repo_dir, sh(["git", "describe", "--tags", "--always"], cwd=args.repo_dir).strip()
        else:
            tags = [args.tag] if args.tag else list_tags()[: args.max_tags]
            root = tag = None
            for t in tags:
                tmp = tempfile.mkdtemp(prefix="questie-")
                print(f"trying {t} …", file=sys.stderr)
                if checkout(t, tmp):
                    root, tag = tmp, t; break
                shutil.rmtree(tmp, ignore_errors=True); tmp = None
            if not root:
                print("No recent Questie tag ships the classic Database layout — the data may have moved to the QuestieDB addon. Snapshot left unchanged.", file=sys.stderr)
                return 2
        commit = sh(["git", "rev-parse", "HEAD"], cwd=root).strip()
        db, fixes = extract(root)
        meta = {"expansion": "era", "questieTag": tag, "questieCommit": commit, "builtAt": datetime.date.today().isoformat(),
                "quests": len(db["quests"]), "correctionsApplied": fixes, "blacklisted": len(db["blacklist"]), "source": "https://github.com/Questie/Questie"}
        db["meta"] = meta
        os.makedirs(args.out, exist_ok=True)
        js = ("/* Generated by tools/build_questdb.py — do not edit. Questie quest database snapshot (GPL-3.0, https://github.com/Questie/Questie) */\n"
              "window.QC_SNAPSHOT=" + json.dumps(db, separators=(",", ":"), ensure_ascii=False) + ";\n")
        with open(os.path.join(args.out, "questdb-era.js"), "w", encoding="utf-8") as f: f.write(js)
        with open(os.path.join(args.out, "questdb-era.meta.json"), "w", encoding="utf-8") as f: json.dump(meta, f, indent=2)
        print(json.dumps(meta, indent=2))
        return 0
    finally:
        if tmp: shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    sys.exit(main())
