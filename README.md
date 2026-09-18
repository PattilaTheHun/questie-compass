# Questie Compass

**Find what you missed. See what it unlocks.**

Questie Compass is a privacy-first quest dependency explorer for **World of Warcraft Classic**. It reads your local Questie data and turns thousands of quest records into a practical answer to a much simpler question:

> **What should I do next—and is an old quest preventing me from getting there?**

Questie is excellent at showing where quests and objectives are located. Questie Compass adds another layer: it examines your completed quests, follows prerequisite chains, identifies missing links, and shows what those overlooked quests unlock.

## The problem it solves

Classic questlines are full of prerequisites, breadcrumbs, mutually exclusive choices, dungeon lead-ins, and chains that begin several zones—or many levels—earlier.

That can create some wonderfully confusing moments:

- Questie or a leveling guide sends you to an NPC who offers nothing.
- A quest appears appropriate for your level, but an earlier step is missing.
- You abandoned or skipped a low-level quest without realizing it unlocks later content.
- RestedXP expects a quest that your character cannot currently accept.
- Your Questie Journey contains the answer, but reviewing hundreds of quests manually is tedious.

Questie Compass is designed to untangle those situations.

## What Questie Compass shows

The report is centered on useful next actions rather than a giant list of everything your character has not completed.

### Do these first

Find lower-level quests you skipped that are now blocking quests in your selected level range. These catch-up quests are ranked by how much content they unlock.

### Coming up

See quests that are ready now or become available at an upcoming level. Identify standalone quests, chain starters, and quests that lead into larger storylines.

### Blocked quests

See which quests are unavailable, why they are blocked, and the earliest incomplete step needed to begin or resume the chain.

### Questline maps

Follow quest chains as visual steppers showing completed, ready, blocked, skipped, and upcoming stages.

### Zone completion

Review completed, available, and total quests by zone, with progress indicators for the selected level range.

### Dungeon preparation

Find dungeon-related quests in your level range and see which ones are ready, already completed, or still require an earlier step.

### Completed and unavailable quests

Search your completed quest history and review quests that are permanently unavailable because of faction, class, exclusivity, or completed follow-up choices.

## Optional RestedXP analysis

Questie Compass can optionally examine the **RestedXP guide files already installed on your computer**.

When enabled, it compares upcoming RestedXP steps with your character's quest history and Questie's dependency data. It can identify:

- guide steps that expect a quest you cannot currently accept;
- the missing prerequisite responsible for the problem;
- earlier quests that should be completed before continuing the guide;
- and steps involving quests your character has already finished.

RestedXP support is entirely optional. Questie Compass does not require RestedXP, modify its guides, distribute guide content, or upload guide files anywhere.

## Use it

**https://pattilathehun.github.io/questie-compass/**

## How it works

Questie Compass runs as a browser-based application hosted with GitHub Pages. There is no installer and no companion program running in the background.

1. Log out of WoW or type `/reload` so Questie writes its latest SavedVariables data.
2. Open Questie Compass in a supported browser.
3. Select your WoW `_classic_era_` folder when prompted.
4. Choose the account and character you want to analyze.
5. Confirm the character's level, race, and faction.
6. Select a level range and explore the report.

Questie Compass reads completed quest IDs from:

```text
WTF\Account\<ACCOUNT>\SavedVariables\Questie.lua
```

It then compares those IDs with the quest database installed with Questie under:

```text
Interface\AddOns\Questie\
```

The installed database is evaluated in your browser (a small Lua interpreter runs in a background worker) and cached, so the report always matches the Questie version you actually play with. Newer Questie installations may store database files in a separate `QuestieDB` addon directory; when the installed database cannot be read, Questie Compass falls back to a bundled Classic Era snapshot that a scheduled job refreshes weekly from Questie's repository.

If RestedXP analysis is enabled, the app also reads the locally installed guide files under `Interface\AddOns\RXPGuides`.

## Your files stay on your computer

Questie Compass processes everything **locally in your browser**.

- Your Questie data is not uploaded.
- Your RestedXP files are not uploaded.
- Your WoW folder is not sent to a server.
- The app cannot scan your drives without permission.
- You choose the folder, and the browser controls access to it.

Chrome and Edge can remember the selected folder for convenient one-click refreshes. Firefox and Safari may require the folder to be selected again during later visits.

## Filters and controls

The planned report includes live filters for:

- level range;
- zone;
- quest category;
- completion or availability status;
- class and profession quests;
- dungeon quests;
- text search;
- hiding profession chains;
- and optional RestedXP analysis.

Changing a filter updates the report immediately without reprocessing the files.

## Supported game version

Initial development targets:

- **World of Warcraft Classic Era / Anniversary**
- Vanilla quest content and the level 1–60 journey
- Questie SavedVariables and quest-database formats used by current Classic releases

Support for additional Classic versions may be added later.

## Project status

Version 0.1 is live. It includes folder detection (with remembered access in Chrome/Edge), account and character selection, level/race/faction inference, the dependency engine, all report sections (Do these first, Coming up, Blocked, Questlines, Zone completion, Dungeon prep, Missed, Completed, All quests), reading the installed Questie database, the bundled snapshot fallback with weekly refresh, and the RestedXP guide check (including the cached premium guides in your SavedVariables, read locally only).

Planned improvements: additional game versions (Anniversary/TBC, Season of Discovery), printable reports and catch-up-list export, enhanced dungeon detection via NPC/object spawn zones, and RestedXP step-level navigation.

## Development

```
node tests/engine.test.js <questdb-json-with-completed-ids>   # engine regression (see tests/README.md)
python tools/build_questdb.py --out data                       # rebuild the bundled snapshot (needs pip install lupa)
```

Open `index.html` through any static web server (a plain `file://` page cannot start the background worker that reads your installed Questie database; the bundled snapshot still works).

## Technical overview

Questie Compass is designed as a client-side single-page application:

- HTML, CSS, and JavaScript
- hosted on GitHub Pages
- local folder access through the browser's File System Access API when available
- Questie SavedVariables parsing in JavaScript
- local Questie database evaluation in a Web Worker via [fengari](https://github.com/fengari-lua/fengari-web) (Lua 5.3 in JavaScript, MIT), with a bundled snapshot as fallback
- no account system, backend database, or upload service

The dependency engine follows Questie's prerequisite concepts, including grouped prerequisites, alternative prerequisites, exclusive quests, parent and child quests, breadcrumbs, level requirements, race and class restrictions, profession requirements, and repeatable quests.

## Acknowledgments

Questie Compass depends on the excellent work of the [Questie](https://github.com/Questie/Questie) and [QuestieDB](https://github.com/Questie/QuestieDB) contributors, whose quest data and addon have helped countless Classic players find their way through Azeroth.

Questie Compass is an independent, unofficial community project. It is not affiliated with or endorsed by Blizzard Entertainment, Questie, or RestedXP. World of Warcraft and related names are trademarks of Blizzard Entertainment.

---

**Questie Compass**  
*Find what you missed. See what it unlocks.*
