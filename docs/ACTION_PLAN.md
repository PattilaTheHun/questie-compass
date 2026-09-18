# Questie Compass — Action Plan

_Last updated 2026-09-18. Check items off as we go; keep this file current._

## Phase 0 — Project setup (this week)

**Pattrick**
- [ ] Create GitHub repo `questie-compass` (Public, add README) and enable Pages: Settings → Pages → Deploy from a branch → `main` / `/ (root)`.
- [ ] Share your GitHub username here so paths and links can be filled in.
- [ ] Decide license. Note: the bundled quest-data snapshot is derived from Questie (GPL-3.0), so the project should be GPL-3.0 as well. Recommendation: GPL-3.0.
- [ ] Grant Claude access to `C:\Program Files (x86)\World of Warcraft\_classic_era_\` (read-only use) so the real Questie addon and RestedXP file layouts can be inspected. Claude will ask via a folder-access prompt.

**Claude**
- [ ] Reorganize the project folder into the repo layout (below); move `extract.py`/`analyze.py` under `tools/`, keep `HANDOFF.md` as `docs/HANDOFF.md`.
- [ ] Add `.gitignore` that excludes personal data: `Questie.lua`, `*.xlsx`, any `WTF/` copies. **Never commit your Questie.lua** — it's account data.
- [ ] `git init`, first commit, push instructions.

```
questie-compass/
  index.html            app shell
  css/app.css
  js/engine.js          dependency engine (port of analyze.py)
  js/questie-lua.js     Questie.lua SavedVariables parser
  js/questdb-local.js   reads installed Questie DB via fengari; layout detection
  js/rxp.js             RestedXP guide parser (toggle)
  js/ui/*.js            sections, filters, folder picker
  vendor/fengari-web.js
  data/questdb-era.json + questdb-era.meta.json
  tools/build_questdb.py, tools/requirements.txt
  .github/workflows/refresh-db.yml
  docs/HANDOFF.md, docs/ACTION_PLAN.md
  README.md, LICENSE, .gitignore
```

## Phase 1 — Verify real-world file layouts (Claude, needs WoW folder access)
- [ ] Confirm `Interface\AddOns\Questie\Database\Classic\classicQuestDB.lua` + `Corrections\classicQuestFixes.lua` exist and match the v11.38 format; record Questie version from `Questie.toc`.
- [ ] Check whether an `Interface\AddOns\QuestieDB\` folder exists (new layout) and document its format.
- [ ] Inspect `Interface\AddOns\RXPGuides\Guides\` — record the step syntax actually used (`.accept`, `.turnin`, `.complete`, level markers, guide headers) and how Horde/Alliance guides are named.
- [ ] Enumerate `WTF\Account\*\SavedVariables\Questie.lua` and confirm multi-character structure.

## Phase 2 — Core engine in JavaScript (Claude)
- [ ] Port `analyze.py` logic: eligibility, prerequisite slots (ALL/ANY), status precedence, missed detection, catch-up closure, questline union-find, unlock impact.
- [ ] Questie.lua parser (regex on the `["complete"]` block per character; read `townsfolkClass`).
- [ ] Race/faction inference from completed starter-zone quests; level estimate (with manual override).
- [ ] Regression test against known numbers for Tuskcleaver at level 40, span 40–50: 275 completed, 1,971 eligible, 425 in scope, 173 ready, 223 blocked, 27 skipped-lower-level, 0 missed.

## Phase 3 — UI v1 (Claude → Pattrick reviews locally)
- [ ] Folder picker (File System Access API, remembered handle in IndexedDB) with fallback file pickers for Firefox/Safari.
- [ ] Account → character → confirm race/faction/level → game version detection.
- [ ] Header strip incl. data source + date and stale-file warning (`/reload` reminder).
- [ ] Filters: level span, zone, category, status, search, hide-professions.
- [ ] Sections: Do these first · Coming up · Blocked · Missed · Completed.
- [ ] Deliver as a local draft Pattrick opens in Chrome before anything is pushed.

## Phase 4 — UI v2
- [ ] Questline steppers.
- [ ] Zone completion cards.
- [ ] Dungeon prep section (dungeon zone IDs list for Classic).
- [ ] Dark/light theme, phone-width layout, performance check.

## Phase 5 — Local Questie DB reader
- [ ] Load fengari; evaluate `classicQuestDB.lua` + corrections + blacklist in the browser with the same stubs used in `extract.py`.
- [ ] Layout detection (classic `Questie/Database` vs `QuestieDB`); fallback to bundled snapshot with a visible notice.
- [ ] Optional "check GitHub for newer data" button with last-updated label and a 5-day cache rule (localStorage).

## Phase 6 — RestedXP panel (toggle)
- [ ] Parse guide files for the character's faction and level range.
- [ ] Flag upcoming steps blocked by missing prerequisites (name the prereq) and steps already completed (skippable).

## Phase 7 — Maintainer tooling
- [ ] `tools/build_questdb.py` from `extract.py`: parameterize expansion + Questie tag, strip personal `completed`, write `data/questdb-era.json` + meta.
- [ ] GitHub Action: weekly cron, run build, commit if changed.

## Phase 8 — Publish
- [ ] Push to GitHub; confirm Pages URL loads.
- [ ] Test in Chrome, Edge, Firefox (Windows).
- [ ] Finalize README (usage, privacy, browser support, acknowledgments, license).
- [ ] Share the link.

## Later / backlog
- Anniversary-TBC and SoD databases; export/print of the catch-up list; enhanced dungeon detection via NPC/object spawn zones; deeper RestedXP integration (current guide step position from RXP SavedVariables).

## Open questions
- Tuskcleaver's actual level (30 vs 40) — only affects the default in the level field.
- Repo name confirmed as `questie-compass`?
