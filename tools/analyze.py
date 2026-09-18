"""Cross-reference completed quests against the Questie DB and build the workbook."""
import json
from collections import defaultdict
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

D = json.load(open("/tmp/claude-0/-home-claude/3ddb225f-2edc-5145-9a5f-ca36c65a3a35/scratchpad/questdb.json"))
Q = {int(k): v for k, v in D["quests"].items()}
ZONES = {int(k): v for k, v in D["zones"].items()}
SORT = {int(k): v for k, v in D["sortKeys"].items()}
BL = set(D["blacklist"])
DONE = set(D["completed"])

PLAYER_LEVEL, RACE_BIT, CLASS_BIT = 40, 128, 1   # Troll warrior
SCOPE_LO, SCOPE_HI = 40, 50                      # levels the user cares about
EVENT_SORTS = {"HALLOWS_END","SEASONAL","DAY_OF_THE_DEAD","DARKMOON_FAIRE","LUNAR_FESTIVAL",
               "MIDSUMMER","BREWFEST","AHN_QIRAJ_WAR","INVASION","BATTLEGROUNDS","LOVE_IS_IN_THE_AIR",
               "NOBLEGARDEN","CHILDRENS_WEEK","WINTER_VEIL","HARVEST_FESTIVAL","PILGRIMS_BOUNTY"}

def zone_name(q):
    z = q.get("zoneOrSort")
    if z is None: return ""
    if z > 0: return ZONES.get(z, f"Zone {z}")
    return SORT.get(z, f"Sort {z}").replace("_", " ").title()

def category(q):
    z = q.get("zoneOrSort") or 0
    if z < 0:
        k = SORT.get(z, "")
        if k in EVENT_SORTS: return "Event/PvP"
        if k in {"WARRIOR","PALADIN","HUNTER","ROGUE","PRIEST","SHAMAN","MAGE","WARLOCK","DRUID"}: return "Class"
        if k in {"HERBALISM","FISHING","BLACKSMITHING","ALCHEMY","LEATHERWORKING","ENGINEERING",
                 "TAILORING","COOKING","FIRST_AID","MINING","SKINNING","ENCHANTING","INSCRIPTION","JEWELCRAFTING"}: return "Profession"
        return "Special"
    return "Zone"

def eligible(qid, q):
    """Can a Horde Troll Warrior ever see this quest?"""
    if qid in BL: return False
    r = q.get("requiredRaces", 0) or 0
    if r and not (r & RACE_BIT): return False
    c = q.get("requiredClasses", 0) or 0
    if c and not (c & CLASS_BIT): return False
    return True

ELIG = {qid for qid, q in Q.items() if eligible(qid, q)}
name = lambda i: Q[i]["name"] if i in Q else f"Quest {i}"

def prereq_options(q):
    """Return list of prerequisite 'slots'. Each slot is a list of quest IDs, ANY of which satisfies it."""
    slots = []
    for p in q.get("preQuestGroup") or []:
        slots.append([abs(p)])
    single = q.get("preQuestSingle") or []
    if single:
        slots.append([abs(p) for p in single])
    return slots

def missing_slots(q):
    """Slots not yet satisfied by completed quests."""
    return [s for s in prereq_options(q) if not any(p in DONE for p in s)]

def is_missed(qid, q):
    """Permanently unavailable because of choices already made."""
    ex = q.get("exclusiveTo") or []
    if any(e in DONE for e in ex): return "Did an exclusive alternative: " + ", ".join(name(e) for e in ex if e in DONE)
    n = q.get("nextQuestInChain")
    if n and n in DONE: return f"Chain already advanced past it ({name(n)} done)"
    au = q.get("availableUntilCompleted")
    if au and au in DONE: return f"Only available until {name(au)} was completed"
    return ""

def status(qid, q):
    if qid in DONE: return "Completed"
    m = is_missed(qid, q)
    if m: return "Missed / not available"
    if q.get("specialFlags", 0) and (q["specialFlags"] & 1): return "Repeatable"
    if missing_slots(q): return "Blocked - missing prerequisite"
    if q.get("parentQuest"): return "Sub-quest (parent must be active)"
    if q.get("requiredMinRep") or q.get("requiredSkill") or q.get("requiredSpell"): return "Needs rep/skill"
    if (q.get("requiredLevel") or 0) > PLAYER_LEVEL: return "Available at level %d" % q["requiredLevel"]
    return "Available now"

# Full closure of uncompleted prerequisites (what you'd actually have to go do)
def closure(qid, seen=None):
    seen = seen if seen is not None else set()
    for slot in missing_slots(Q[qid]):
        # pick the eligible option(s); if several, include the first eligible one as the recommended path
        opts = [p for p in slot if p in Q and p in ELIG and not is_missed(p, Q[p])]
        if not opts: opts = [p for p in slot if p in Q]
        chosen = opts[:1]
        for p in chosen:
            if p not in seen:
                seen.add(p); closure(p, seen)
    return seen

# Chain / questline grouping: union-find over prerequisite + next-in-chain links among eligible quests
parent = {}
def find(x):
    parent.setdefault(x, x)
    while parent[x] != x:
        parent[x] = parent[parent[x]]; x = parent[x]
    return x
def union(a, b): parent[find(a)] = find(b)
for qid in ELIG:
    q = Q[qid]
    for slot in prereq_options(q):
        for p in slot:
            if p in Q: union(qid, p)
    n = q.get("nextQuestInChain")
    if n in Q: union(qid, n)
    for c in q.get("childQuests") or []:
        if c in Q: union(qid, c)
    if q.get("parentQuest") in Q: union(qid, q["parentQuest"])
groups = defaultdict(list)
for qid in ELIG: groups[find(qid)].append(qid)
chain_of, chain_name, chain_size = {}, {}, {}
for root, members in groups.items():
    # name the chain after its final (highest-level, then no-successor) quest
    final = max(members, key=lambda i: ((Q[i].get("questLevel") or 0), -(1 if Q[i].get("nextQuestInChain") else 0), i))
    label = name(final) if len(members) > 1 else "(standalone)"
    for m in members:
        chain_of[m] = root; chain_name[m] = label; chain_size[m] = len(members)

# what does each quest unlock (forward edges)?
unlocks = defaultdict(set)
for qid in ELIG:
    for slot in prereq_options(Q[qid]):
        for p in slot: unlocks[p].add(qid)

def dependents_closure(qid, seen=None):
    seen = seen if seen is not None else set()
    for d in unlocks.get(qid, ()):
        if d in ELIG and d not in seen:
            seen.add(d); dependents_closure(d, seen)
    return seen

# ---------- rows ----------
def base_row(qid):
    q = Q[qid]
    return [qid, q["name"], q.get("requiredLevel"), q.get("questLevel"), zone_name(q), category(q),
            chain_name.get(qid, ""), chain_size.get(qid, 1)]
BASE_HDR = ["Quest ID", "Quest", "Min Lvl", "Quest Lvl", "Zone / Sort", "Category", "Questline (named for final quest)", "Quests in line"]

def prereq_text(q):
    parts = []
    for slot in prereq_options(q):
        done = [p for p in slot if p in DONE]
        txt = " OR ".join(f"{name(p)} [{p}]" for p in slot)
        parts.append(("✔ " if done else "✘ ") + txt)
    return "\n".join(parts)

def elite_flag(q):
    f = q.get("questFlags") or 0
    return "Yes" if f & 0x1 else ""   # hmm; not reliable, leave blank below

catalog = []
for qid in sorted(Q):
    q = Q[qid]
    st = status(qid, q) if qid in ELIG else ("Completed" if qid in DONE else "Not for Horde Troll Warrior")
    catalog.append(base_row(qid) + [st, prereq_text(q), ", ".join(f"{name(u)} [{u}]" for u in sorted(unlocks.get(qid, set()) & ELIG)),
                                    name(q["nextQuestInChain"]) if q.get("nextQuestInChain") in Q else "",
                                    (q.get("objectivesText") or [""])[0]])

# Scope: what you'd do at 40-50 (quest level in range, min level <= 50) that isn't done
scope = [i for i in ELIG if i not in DONE and SCOPE_LO <= (Q[i].get("questLevel") or 0) <= SCOPE_HI + 2
         and (Q[i].get("requiredLevel") or 0) <= SCOPE_HI and category(Q[i]) != "Event/PvP"]
blocked_rows, ready_rows, missed_rows = [], [], []
needed = defaultdict(lambda: {"targets": set()})
for i in sorted(scope, key=lambda i: (Q[i].get("questLevel") or 0, Q[i]["name"])):
    q = Q[i]; st = status(i, q)
    if st.startswith("Blocked"):
        cl = closure(i)
        direct = "; ".join(" OR ".join(f"{name(p)} [{p}] (lvl {Q[p].get('questLevel') if p in Q else '?'})" for p in s) for s in missing_slots(q))
        todo = sorted(cl, key=lambda p: (Q[p].get("questLevel") or 0))
        blocked_rows.append(base_row(i) + [direct, len(todo), "\n".join(f"{name(p)} [{p}] (lvl {Q[p].get('questLevel')}, {zone_name(Q[p])})" for p in todo),
                                           (q.get("objectivesText") or [""])[0]])
        for p in cl: needed[p]["targets"].add(i)
    elif st.startswith("Missed"):
        missed_rows.append(base_row(i) + [is_missed(i, q), (q.get("objectivesText") or [""])[0]])
    elif st in ("Available now",) or st.startswith("Available at") or st == "Needs rep/skill":
        deps = dependents_closure(i)
        ready_rows.append(base_row(i) + [st, len(deps), ", ".join(f"{name(d)} [{d}]" for d in sorted(deps, key=lambda d: Q[d].get("questLevel") or 0)[:12]),
                                         "Standalone" if chain_size.get(i,1) == 1 else ("Chain start" if not prereq_options(q) else "Mid-chain"),
                                         (q.get("objectivesText") or [""])[0]])

catchup_rows = []
for p, info in needed.items():
    q = Q[p]
    deps_all = dependents_closure(p)
    catchup_rows.append(base_row(p) + [status(p, q), "Yes" if (q.get("questLevel") or 0) < SCOPE_LO else "", len(info["targets"]), len(deps_all),
                                       ", ".join(f"{name(t)} [{t}]" for t in sorted(info["targets"], key=lambda t: Q[t].get("questLevel") or 0)),
                                       prereq_text(q), (q.get("objectivesText") or [""])[0]])
catchup_rows.sort(key=lambda r: (-r[10], r[3] or 0))

completed_rows = [base_row(i) + [", ".join(f"{name(u)} [{u}]" for u in sorted(unlocks.get(i, set()) & ELIG))] for i in sorted(DONE) if i in Q]
completed_rows.sort(key=lambda r: (r[3] or 0, r[1]))

# ---------- workbook ----------
wb = Workbook()
HDR_FILL = PatternFill("solid", fgColor="1F3864"); HDR_FONT = Font(name="Arial", bold=True, color="FFFFFF", size=10)
BODY = Font(name="Arial", size=10)
STATUS_FILL = {"Completed": "C6EFCE", "Available now": "DDEBF7", "Blocked - missing prerequisite": "FCE4D6",
               "Missed / not available": "D9D9D9", "Repeatable": "EDEDED"}

def sheet(ws, headers, rows, widths, wrap_cols=(), status_col=None):
    ws.append(headers)
    for c in ws[1]:
        c.fill = HDR_FILL; c.font = HDR_FONT; c.alignment = Alignment(wrap_text=True, vertical="center")
    for r in rows: ws.append(r)
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.font = BODY; c.alignment = Alignment(vertical="top", wrap_text=(c.column in wrap_cols))
        if status_col:
            v = row[status_col-1].value or ""
            key = next((k for k in STATUS_FILL if v.startswith(k.split(" ")[0])), None)
            if key: row[status_col-1].fill = PatternFill("solid", fgColor=STATUS_FILL[key])
    for i, w in enumerate(widths, 1): ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "C2"; ws.auto_filter.ref = ws.dimensions
    ws.row_dimensions[1].height = 32

# Summary
ws = wb.active; ws.title = "Summary"
elig_not_done = [i for i in ELIG if i not in DONE]
summary = [
    ["Tuskcleaver - Mankrik  (Troll Warrior, level 40)", ""],
    ["Source", "Questie SavedVariables (Questie.lua) + Questie v11.38.0 Classic Era quest database (open source)"],
    ["", ""],
    ["Quests in Classic Era database", len(Q)],
    ["…visible to a Horde Troll Warrior (after Questie blacklist/race/class filters)", len(ELIG)],
    ["Quests completed", "=COUNTA(Completed!A:A)-1"],
    ["Completed quests recorded in log that Questie's DB doesn't know", len([i for i in DONE if i not in Q])],
    ["", ""],
    ["FOCUS: quests of level %d–%d you have not done (excluding holiday/PvP)" % (SCOPE_LO, SCOPE_HI), len(scope)],
    ["   Ready to pick up (prereqs met)", "=COUNTA('Ready 40-50'!A:A)-1"],
    ["   Blocked by prerequisites you skipped", "=COUNTA('Blocked 40-50'!A:A)-1"],
    ["   Missed / permanently unavailable", "=COUNTA('Missed'!A:A)-1"],
    ["   Distinct quests you must go back and do to unblock them (Catch-up List)", "=COUNTA('Catch-up List'!A:A)-1"],
    ["      …of which are lower-level (<40) quests you skipped", "=COUNTIF('Catch-up List'!J:J,\"Yes\")"],
    ["", ""],
    ["HOW TO READ THIS", ""],
    ["Catch-up List", "The to-do list. Every quest you skipped that gates a 40–50 quest, ranked by how many target quests it unlocks. Work top-down."],
    ["Blocked 40-50", "Each 40–50 quest you can't pick up yet, its immediate missing prerequisite, and the full chain you need to go do."],
    ["Ready 40-50", "Quests you can take right now (or at a stated level). 'Standalone' = no prereqs and nothing depends on it; 'Chain start' = begins a line."],
    ["Missed", "Quests you can no longer get, usually because you completed a mutually exclusive alternative. Not a loss, just noise removed."],
    ["Completed", "Everything Questie has recorded as turned in, with what each one unlocked."],
    ["All Quests", "Full catalog with status, prerequisites, unlocks, and questline grouping. Filter freely."],
    ["", ""],
    ["Notes", "Prerequisite logic mirrors Questie's own (preQuestGroup = ALL required; preQuestSingle = ANY one). 'Questline' groups quests connected by prerequisite/next-in-chain links and is named for the highest-level quest in the group. Dungeon/elite quests are included; reputation- or profession-gated quests are flagged."],
]
for r in summary: ws.append(r)
for row in ws.iter_rows():
    for c in row: c.font = BODY; c.alignment = Alignment(wrap_text=True, vertical="top")
ws["A1"].font = Font(name="Arial", bold=True, size=13)
for r in (15,): ws.cell(r, 1).font = Font(name="Arial", bold=True, size=10)
for r in range(16, 22): ws.cell(r, 1).font = Font(name="Arial", bold=True, size=10)
ws.column_dimensions["A"].width = 62; ws.column_dimensions["B"].width = 110

sheet(wb.create_sheet("Catch-up List"), BASE_HDR + ["Your status", "Skipped lower-level (<40)?", "40–50 quests it gates", "Total quests downstream", "Which 40–50 quests it gates", "Its own prerequisites (✔ done / ✘ not)", "Objective"],
      catchup_rows, [9, 34, 7, 7, 20, 11, 30, 8, 26, 10, 10, 10, 60, 45, 60], wrap_cols=(2,7,13,14,15), status_col=9)
sheet(wb.create_sheet("Blocked 40-50"), BASE_HDR + ["Immediately missing prerequisite(s)", "# quests to catch up", "Full catch-up chain (in order)", "Objective"],
      blocked_rows, [9, 34, 7, 7, 20, 11, 30, 8, 50, 9, 60, 55], wrap_cols=(2,7,9,11,12))
sheet(wb.create_sheet("Ready 40-50"), BASE_HDR + ["Status", "# quests it leads to", "Leads to (first 12)", "Type", "Objective"],
      ready_rows, [9, 34, 7, 7, 20, 11, 30, 8, 20, 9, 55, 12, 55], wrap_cols=(2,7,11,13), status_col=9)
sheet(wb.create_sheet("Missed"), BASE_HDR + ["Why", "Objective"], missed_rows, [9, 34, 7, 7, 20, 11, 30, 8, 55, 55], wrap_cols=(2,7,9,10))
sheet(wb.create_sheet("Completed"), BASE_HDR + ["Unlocked"], completed_rows, [9, 34, 7, 7, 20, 11, 30, 8, 60], wrap_cols=(2,7,9))
sheet(wb.create_sheet("All Quests"), BASE_HDR + ["Status", "Prerequisites (✔ done / ✘ not)", "Unlocks", "Next in chain", "Objective"],
      catalog, [9, 34, 7, 7, 20, 11, 30, 8, 26, 50, 45, 25, 55], wrap_cols=(2,7,10,11,13), status_col=9)

out = "/mnt/user-data/outputs/Tuskcleaver_Quest_Dependencies.xlsx"
import os; os.makedirs(os.path.dirname(out), exist_ok=True)
wb.save(out)
print("scope", len(scope), "blocked", len(blocked_rows), "ready", len(ready_rows), "missed", len(missed_rows), "catchup", len(catchup_rows), "completed rows", len(completed_rows))
print("unknown completed ids:", [i for i in DONE if i not in Q])
