# Questie Planner — Project Handoff

**Date:** 2026-09-18
**Owner:** Pattrick
**Purpose of this document:** Everything a fresh Claude session (Claude Desktop / Claude Code) needs to continue building the Questie quest-dependency planner. Read this fully before touching code.

---

## 1. What we are building (one paragraph)

A **single-page browser app, hosted on GitHub Pages**, that reads a player's World of Warcraft Classic `Questie.lua` SavedVariables file plus the Questie quest database installed on their PC, and produces an interactive report showing: which quests they have completed, which lower-level quests they **skipped that gate upcoming content** (the core value), what is ready now, what is blocked and why, questlines as steppers, per-zone completion, dungeon-prep lists, and (toggle) which RestedXP guide steps will fail because of missing prerequisites. All processing is client-side; no data leaves the user's machine.

## 2. User context

- Pattrick is a relatively new WoW Classic player. Character: **Tuskcleaver – Mankrik** (Horde, **Troll Warrior**). He said level 30 in one message and 40 in another; the completed-quest data (275 quests, many at level 35–40) is consistent with ~40. **The app must take level as user input** (with an estimate from data as default) — the file does not store level.
- Game version: **Classic Era / Anniversary (vanilla, 60 cap)**. Confirmed by user.
- WoW install: default path `C:\Program Files (x86)\World of Warcraft\_classic_era_\`. Windows.
- Uses **RestedXP** as a leveling guide; wants to know which guide steps he'll be missing prereqs for.
- **Working style preference:** high-level, output-oriented. Don't write code without confirming he wants it (he has now approved building the app). Deliver working drafts he can open; keep technical debate short.
- He just created a **GitHub account**. Do NOT ask for his password. Plan: he creates the repo + enables Pages via the web UI; Claude produces files; he uploads them (drag-and-drop in GitHub web UI). A fine-grained PAT scoped to one repo is acceptable later if direct pushes are needed — created at that moment and revoked after.

## 3. Decisions already made (don't re-litigate)

| Topic | Decision | Why |
|---|---|---|
| Platform | Browser SPA (HTML/CSS/JS), no Python on the player's side | No install; shareable; Python only needed by maintainer tooling |
| Hosting | **GitHub Pages**, public repo (suggested name `questie-planner`) | URL, sharing, auto-updating tool, remembered folder access (https needed for File System Access API) |
| Chrome extension | **No** | Adds store review + fees, buys nothing (can't read files without user picking anyway) |
| Desktop installer / window | **No** | Unnecessary |
| Quest DB source, priority order | 1) **Read from user's installed Questie addon** (`Interface\AddOns\Questie\Database\...`) → 2) **Bundled snapshot JSON** in the repo → 3) Optional manual "check GitHub for newer" button with "last updated" label | Local copy exactly matches the game version in use; no download; no staleness. Snapshot is the fallback and is refreshed weekly by GitHub Actions |
| File access | User picks the `_classic_era_` folder once via directory picker. On https, Chrome/Edge can **remember the handle** (persist in IndexedDB) for one-click re-read; Firefox/Safari re-pick each time (say so in UI). Cannot scan drives — browser security. | |
| RestedXP | **Toggle** to include guide analysis | User asked for a toggle |
| Level span filter | 1–10, 10–20, … 50–60, ALL — live in the page, no re-generation | |
| Extra sections approved | Per-zone completion %, dungeon quests called out separately | User "loves both" |

## 4. What the data actually contains (verified)

### 4.1 `Questie.lua` (SavedVariables) — per WoW account
Path: `<flavor>\WTF\Account\<ACCOUNT>\SavedVariables\Questie.lua`. Pattrick's is 7.5 MB, 2,091 lines (some lines are multi-MB binary strings).

Structure:
```
QuestieConfig = {
  ["char"] = {
    ["Tuskcleaver - Mankrik"] = {          -- one entry per character on the account
      ["vendorList"] = {...},               -- noise
      ["complete"] = { [1013] = true, [190] = true, ... },   -- THE ONLY PROGRESS DATA: completed quest IDs
      ["townsfolkClass"] = "WARRIOR",       -- class is stored
      ["guid"] = "Player-5149-04B12496",
      ...
    },
  },
  ["global"] = {
    ["questBin"] = "<binary>", ["questPtrs"] = "<binary>",   -- Questie's compiled DB (fragile to decode; ignore)
    ["dbCompiledOnVersion"] = "v11.38.0", ["dbCompiledLang"] = "enUS", ["dbCompiledExpansion"] = 2,
    ...
  },
  ["profileKeys"] / ["profiles"] = UI settings
}
```
**Not stored:** level, race, faction, active quest log, abandoned quests, timestamps. Only updated on logout / `/reload` (tell users).
Parsing the completed set = regex `\["complete"\] = \{ ... \}` then `\[(\d+)\] = true`. Trivial in JS.
Race/faction must be **asked or inferred** (e.g., completed starting-zone quests: Valley of Trials quests ⇒ Orc/Troll; Horde-only quest completed ⇒ Horde).

### 4.2 Questie quest database (open source, GPL)
Repo: `https://github.com/Questie/Questie`. **Important:** at the current `master`, the database has been moved OUT of the repo into a separate **QuestieDB** addon (`LibQuestieDB`) — the layout is changing. The tag matching Pattrick's install is **`v11.38.0`** and still has the classic layout:

- `Database/Classic/classicQuestDB.lua` (~1.0 MB) — `QuestieDB.questData = [[return { [id] = {...positional fields...}, ... }]]` (a Lua string that is itself Lua)
- `Database/Corrections/classicQuestFixes.lua` (~0.6 MB) — `QuestieQuestFixes:Load()` returns `{ [id] = { [questKeys.x] = value } }` overrides. **Lua code**, references constants (`zoneIDs`, `raceIDs`, `profKeys`, `sortKeys`, `l10n(...)`). Must be *evaluated*, not regex-parsed. ~2,900 overrides applied to Pattrick's version.
- `Database/Corrections/QuestieQuestBlacklist.lua` — quests to hide (value `true`), evaluated per expansion.
- `Database/QuestieDB.lua` — `questKeys` (field index map), `raceKeys`, `classKeys` bitmasks.
- `Database/Constants.lua` — `sortKeys` (negative `zoneOrSort` values: class/profession/event categories).
- `Localization/lookups/lookupZones.lua` — `l10n.zoneLookup[continent][zoneId] = "Name"`.

The **same files exist on the player's PC** under `Interface\AddOns\Questie\...` (for v11.x). For newer Questie, look also for `Interface\AddOns\QuestieDB\...` and handle unknown layouts by falling back to the bundled snapshot.

**Quest fields used (positional index in `questKeys`):**
`name`(1) `requiredLevel`(4) `questLevel`(5) `requiredRaces`(6, bitmask) `requiredClasses`(7, bitmask) `objectivesText`(8) `preQuestGroup`(12, ALL required) `preQuestSingle`(13, ANY one required) `childQuests`(14) `inGroupWith`(15) `exclusiveTo`(16) `zoneOrSort`(17, >0 zone id, <0 sort key) `requiredSkill`(18) `requiredMinRep`(19) `requiredMaxRep`(20) `nextQuestInChain`(22) `questFlags`(23) `specialFlags`(24, bit 1 = repeatable) `parentQuest`(25) `breadcrumbForQuestId`(27) `breadcrumbs`(28) `requiredMaxLevel`(32) `availableUntilCompleted`(33) `availableStartingWith`(34).

**Bitmasks (Classic):** races — HUMAN 1, ORC 2, DWARF 4, NIGHT_ELF 8, UNDEAD 16, TAUREN 32, GNOME 64, **TROLL 128**; ALL_ALLIANCE 77, ALL_HORDE 178, 0 = any. Classes — **WARRIOR 1**, PALADIN 2, HUNTER 4, ROGUE 8, PRIEST 16, SHAMAN 64, MAGE 128, WARLOCK 256, DRUID 1024; 0 = any.

**Evaluating the Lua:** In Python we used `lupa` with stub modules (`QuestieLoader`, `Questie.IsClassic=true`, `WOW_PROJECT_ID=2`, metatables returning 0 for `zoneIDs`/`profKeys`/`factionIDs`, callable `l10n`). See `extract.py`. In the browser the equivalent is **fengari** (Lua 5.3 in JS, ~200 KB) with the same stubs — OR precompute to JSON in the maintainer pipeline and only ship JSON. Recommendation: browser reads local Lua via fengari when present; GitHub Action (Python + lupa) builds the fallback snapshot JSON weekly from Questie's latest tag.

### 4.3 Extracted snapshot already built
`questdb.json` (1.5 MB, included in this handoff) — Classic Era, Questie v11.38.0 + corrections applied, blacklist, zone names, sortKeys, and Pattrick's 279 completed IDs. Keys: `quests{id:{...}}`, `blacklist[]`, `zones{id:name}`, `sortKeys{neg:NAME}`, `completed[]`.

## 5. Analysis logic (mirrors Questie's own availability rules — keep it)

- **Eligible** = not blacklisted AND (`requiredRaces`==0 OR mask & playerRace) AND (`requiredClasses`==0 OR mask & playerClass).
- **Prerequisite slots:** each `preQuestGroup` entry is its own slot (ALL); `preQuestSingle` is one slot satisfied by ANY member. Negative IDs in `preQuestGroup` → use `abs()` (they only suppress an exclusivity check).
- **Status precedence:** Completed → Missed (any `exclusiveTo` done, or `nextQuestInChain` done, or `availableUntilCompleted` done) → Repeatable (`specialFlags & 1`) → Blocked (a slot unmet) → Sub-quest (`parentQuest`) → Needs rep/skill → Available at level N (`requiredLevel` > player) → Available now.
- **Catch-up closure:** recursively collect unmet prerequisites (choose first eligible, non-missed option in an ANY-slot). "Skipped lower-level" = in closure AND `questLevel` < span start.
- **Questline grouping:** union-find over prereq edges + `nextQuestInChain` + `childQuests`/`parentQuest`, among eligible quests; name the line for its highest-level member; size 1 = standalone.
- **Unlock impact:** forward edges (who lists me as a prereq), transitive count → rank the catch-up list by it.
- **Category from `zoneOrSort`:** >0 → zone; <0 → sortKey name → Class / Profession / Event-PvP / Special. Exclude Event/PvP from the main lists by default; offer "hide professions" toggle.
- **Dungeon detection:** `zoneOrSort` equal to a dungeon zone id (Wailing Caverns, SFK, RFK, RFD, SM, Uldaman, ZF, Mara, ST, BRD, LBRS/UBRS, Scholo, Strat, DM…) — also consider quests whose objective spawns are in dungeon zones (needs npc/object DBs; v1 can use zoneOrSort only).

### 5.1 Findings from the first run (Tuskcleaver, level 40 assumed)
4,244 quests in Era DB → 1,971 visible to a Horde Troll Warrior → 275 completed. In the 40–50 band: 425 not done; 173 ready; 223 blocked; **only 27 of the blocking quests were lower-level (<40) skipped quests** — the rest are chains not yet started. **Design implication:** the report must center on the small catch-up list, not the big "blocked" count. Zero permanently missed quests in range. Blacksmithing chain dominates unlock counts → hide-professions toggle matters. 4 completed IDs (55296, 8458, 3366, 3911) are not in the Era DB (ignore/flag).

## 6. Report / UI spec (agreed)

**Flow:** Open page → pick `_classic_era_` folder (remembered on Chrome/Edge) → app finds all `WTF\Account\*\SavedVariables\Questie.lua`, the installed Questie DB, and `Interface\AddOns\RXPGuides` → choose account → choose character (class auto-filled) → confirm race/faction (inferred default) and level (estimated default) → detect game version → report renders. Level-span selector and all filters live; no re-run.

**Header strip:** character, race/class, level, game version, quest-DB source + date ("from your installed Questie v11.38.0" or "bundled snapshot of <date>"), warning if Questie.lua is stale (mtime) — remind to `/reload`.

**Filters bar:** level span (1–10 … 50–60, ALL), zone, category (zone/class/profession/dungeon/event), status, search, "hide professions" toggle, RestedXP toggle.

**Sections, in order:**
1. **Do these first** — skipped lower-level quests gating quests in the span, ranked by unlock count, grouped by zone (route-like). Each row: what it unlocks, its own prereqs, objective.
2. **Coming up** — ready now / at level N, grouped by zone; badges: *Standalone*, *Starts a chain of N*, *Mid-chain*, *Leads to N quests*.
3. **Blocked** — in-span quests waiting on prereqs; expandable full catch-up chain.
4. **Questlines** — horizontal steppers per chain; markers done / ready / blocked / skipped; player position highlighted.
5. **Zone completion** — cards per zone: done / available / total in span, progress bar.
6. **Dungeon prep** — per dungeon in level range: quests inside, grouped available / needs X first / done.
7. **Missed / unavailable** — with reason.
8. **Completed** — collapsed.
9. **RestedXP panel (toggle)** — parse guide Lua files under `Interface\AddOns\RXPGuides\Guides\` (steps like `.accept 663`, `.turnin 663`, `.complete`); for the level range: upcoming steps whose quest is blocked → name the missing prereq(s); steps whose quest is already done → mark skippable.

**UI notes:** dark/light both; phone-width tolerant; keep it fast (≈2k quests, trivial). Use `localStorage` only for conveniences (last span, toggles); folder handle in IndexedDB.

## 7. Repository layout (proposed)

```
questie-planner/
  index.html                 # the app (can inline CSS/JS or split)
  app.js / styles.css        # optional split
  vendor/fengari-web.js      # Lua-in-browser for reading local Questie DB
  data/
    questdb-era.json         # bundled snapshot (Classic Era)
    questdb-era.meta.json    # { questieTag, builtAt }
    (later) questdb-tbc.json, questdb-sod.json
  tools/
    build_questdb.py         # maintainer: clone Questie tag, eval Lua via lupa, emit JSON (derive from extract.py)
  .github/workflows/refresh-db.yml   # weekly cron: run build_questdb.py, commit if changed
  README.md                  # what it is, privacy note (nothing uploaded), how to use, first-run folder pick
```
GitHub Pages: Settings → Pages → Deploy from branch → `main` / root. Site: `https://<username>.github.io/questie-planner/`.

## 8. Pattrick's to-do (GitHub side)
1. New repository `questie-planner`, Public, add README.
2. Settings → Pages → Deploy from a branch → `main` / `/ (root)` → Save.
3. Tell Claude the username + repo name.
4. Upload files Claude provides via "Add file → Upload files" (drag-and-drop). Repeat for updates.

## 9. Open items / next steps for the new session
- [ ] Get username/repo from Pattrick; confirm repo + Pages are live.
- [ ] Build v1 `index.html` against `questdb.json` + his `Questie.lua` (he can attach it again; the 279 completed IDs are also inside `questdb.json → completed`). Send him a local draft first.
- [ ] Implement local Questie DB reader (fengari) with layout detection (`Questie/Database/Classic/*` vs newer `QuestieDB`), fallback to snapshot with visible note.
- [ ] Race/faction inference + level estimate (e.g., 90th-percentile `questLevel` of completed quests + 1).
- [ ] RestedXP guide parser (check the actual RXPGuides file format on his PC first).
- [ ] `tools/build_questdb.py` (generalize `extract.py`: pick expansion; strip `completed`), plus weekly Action.
- [ ] README with privacy statement and browser-support note (folder memory = Chrome/Edge only).
- [ ] Decide whether Tuskcleaver is 30 or 40 (irrelevant to code; the level field handles it).
- Nice-to-have later: multiple game versions, share/export of the catch-up list, print view.

## 10. Files in this handoff folder
- `HANDOFF.md` — this document
- `extract.py` — Python/lupa: evaluates Questie v11.38.0 Lua DB + corrections + blacklist → `questdb.json`. Needs `pip install lupa` and a sparse clone of `Questie/Questie` at tag `v11.38.0` (`Database/`, `Localization/`, `Modules/Expansions.lua`). Paths inside are from the cloud session — edit them.
- `analyze.py` — Python: the dependency/status/chain logic and the Excel builder (openpyxl). **Port this logic to JS**; it is the reference implementation.
- `questdb.json` — ready-to-use Classic Era snapshot + Pattrick's completed IDs.
- Previously delivered separately: `Tuskcleaver_Quest_Dependencies.xlsx` (the spreadsheet prototype of the report).

---

## 11. Findings from the real WTF folder (2026-09-18)

Copied from the play machine to `C:\Program Files (x86)\World of Warcraft\_classic_era_\WTF\` on win11-99. `Interface\AddOns` is still EMPTY here (Questie + RXPGuides addon folders not copied yet — still needed for Phase 1/5/6).

- Account: `WTF\Account\987046649#1\` (Battle.net account IDs look like `<digits>#<n>`). Realm folder `Mankrik` with 4 characters: Tuskcleaver, Orcrawinfrey, Paralegorc, Ologdoomfoot. Only Tuskcleaver has Questie data.
- **Account-level** `SavedVariables\Questie.lua` (7.5 MB) holds `QuestieConfig.char["Tuskcleaver - Mankrik"].complete`. **Per-character** `Mankrik\Tuskcleaver\SavedVariables\Questie.lua` is just `QuestieConfigCharacter = nil` (ignore).
- **RestedXP account-level** `SavedVariables\RXPGuides.lua` (383 KB): `RXPData.gameVersion = 11509` (client 1.15.9 → Classic Era), `release = "v4.11.0"`. `RXPDB.profiles.global.guides[...]` caches the guide *content* compressed (`groupOrContent`, LibDeflate-style) — 56 guides installed; keys look like `"RestedXP Horde 40-50|RestedXP Horde 40-50|40-41 Stranglethorn Vale"`. Plain-text guide sources live in `Interface\AddOns\RXPGuides\Guides\` (not copied yet) — prefer those over decompressing the cache.
- **RestedXP per-character** `Mankrik\Tuskcleaver\SavedVariables\RXPGuides.lua` (38 KB) — VERY useful:
  - `RXPCData.currentGuideGroup = "RestedXP Horde 40-50"`, `currentGuideName = "40-41 Stranglethorn Vale"`, `currentStep = 18` → confirms Tuskcleaver is ~level 40 and tells us exactly where he is in the guide.
  - `RXPCData.questObjectivesCache` = **the character's active quest log** (IDs + objective progress): currently 584, 193, 209, 598, 585, 572, 577, 600, 196 (all Stranglethorn). This fills the "current quest log" gap the Questie file has. `questNameCache` maps IDs → names.
  - Also has `completedWaypoints`, `enabledDungeons`, `flightPaths`, `discardPile` (steps the player skipped in the guide — check semantics).
- Implication for the app: when RXP is present, read the per-character file for **active quests + current guide position**, and treat "in log" as a status distinct from "not started". Level can be inferred from `currentGuideName` range when present.
- Network: the local Claude VM (device_bash) can reach api.github.com (HTTP 200), python3 3.10 / node 22 / git available → git push from the project folder is feasible with a token.
