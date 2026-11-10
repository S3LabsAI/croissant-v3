# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Croissant, formerly Budget Pace Alerts, is a Manifest V3 Chrome extension for account managers on the GOAL ad platform at checkoutgoal.com. It polls GOAL every 5 minutes, alerts on budget pace and conversion problems, and drafts client emails for the account manager to send.

All source lives in `croissant-team-v2.9.2/Croissant/`. That folder is the shipped v2.9.2 team build, and Chrome loads it as-is. `croissant-team-v2.9.2/Croissant - Install.html` is the install page that ships with the zip. The first git commit holds the v2.9.2 build as shipped, so a diff against it shows every change made since.

`Croissant/README.txt` is the user manual and the closest thing to a spec. It states every threshold, alert rule and page behavior in plain language. Read the relevant section before changing behavior, and update it in the same change.

## Commands

There is no build step, package manager, linter or test suite. A syntax check is the only automated check.

```bash
node --check croissant-team-v2.9.2/Croissant/bg.js
```

```bash
for f in croissant-team-v2.9.2/Croissant/*.js; do node --check "$f"; done
```

To run it, open `chrome://extensions`, turn on Developer mode, click Load unpacked and pick the `Croissant` folder. Then open admin.checkoutgoal.com once so the extension picks up the GOAL sign-in.

After an edit, click the reload arrow on the extension's card. On install or update, `bg.js` re-injects `csv.js`, `popup.js` and `panel.js` into open GOAL tabs. Refresh those tabs to pick up changes to `token.js` and `hook.js`.

`selfUpdate()` in `bg.js` runs on every poll. It reads `manifest.json` from disk and calls `chrome.runtime.reload()` when the version differs from the loaded one. A version bump makes a loaded copy reload itself within one poll. Edits without a version bump need the manual reload.

To debug, click "service worker" on the extension's card for the background console. There, `chrome.storage.local.get(null, console.log)` dumps all state and `poll(true)` forces a full poll, roster and history refresh included.

The version string appears in `manifest.json`, line 1 of `README.txt`, and the title, heading and zip link of `Croissant - Install.html`. The zip link still uses the old `budget-pace-alerts-` filename.

## Code style

- ES5 style throughout: `var`, `function` expressions, string concatenation. The code uses `async`/`await`. It has no arrow functions, `let`, `const`, template literals, modules or third-party libraries. Match this.
- Lines are dense, with short names and several statements per line.
- Pages build HTML by string concatenation. Pass every dynamic value through the file's local `esc()`.
- Each page script is an IIFE that declares its own `send`, `esc` and money helpers. There is no shared UI helper file.

## Architecture

### Three contexts

1. The service worker. `bg.js` loads `data.js`, `budgets-source.js`, `rhythm.js`, `csv.js`, `sources.js`, `hours.js`, `notes.js`, `recaps.js`, `touch.js` and `briefing.js` with `importScripts`. It is the only context that calls GOAL or Slack.
2. Content scripts on GOAL admin and portal pages. `token.js` runs in the isolated world and `hook.js` in the page's MAIN world. `csv.js`, `popup.js` and `panel.js` draw the floating panel.
3. Extension pages: `popup.html`, `review.html`, `hours.html`, `notes.html`, `briefing.html`. They never call GOAL. They message the worker and render the reply.

All state lives in `chrome.storage.local`. Chrome can kill the worker at any time, so in-memory variables such as `_sessions`, `busy` and `AM_ID` are caches only.

### The worker's shared global scope

Files loaded with `importScripts` share one global scope and call each other's functions freely. `budgets-source.js` uses `API`, `range` and `AuthError` from `bg.js`. `recaps.js` uses `hoursFor` from `hours.js` and `ownerContact` from `notes.js`. `touch.js` uses `recapHighlights` from `recaps.js`. This has consequences:

- A function name reused in two worker files silently replaces the earlier one. Newer files prefix their helpers: `h*` in `hours.js`, `rc*` in `recaps.js`, `note*` in `notes.js`, `touch*` in `touch.js`.
- `bg.js` assigns its `var`s after `importScripts` returns. A module file can use `API` or `GOAL_TZ` inside a function, never at its top level.
- `hook.js` runs in the page and can't import anything, so it carries its own copies of `flat`, `listOf` and `MULT_RX`. A change to the worker's versions needs the same change there.

`X.js` is the worker module and `X-page.js` is the page script for `X.html`. The Sources review breaks the pattern. `sources.js` is its worker module and `review.js` is its page script.

### The poll

The `poll` alarm calls `poll()`, which lets one `run()` execute at a time. `run()` does this in order:

1. Fetch today's spend per account and per campaign from the admin analytics endpoint.
2. Once per GOAL day, refresh the roster and the 14-day history.
3. On the first poll of a new day, finalize yesterday's log, learn its spend curve and auto-save its CSV.
4. Record intraday points for rhythm and hourly deltas for Best hours.
5. Run or resume `budgetJob`, refresh Lead Marketplace stats, take the budget snapshot.
6. Call `evaluate()`, which builds `snap` and fires alerts.
7. Run the 5pm digest, client notes, weekly recaps, check-ins and the briefing prompt.
8. Prefetch source reviews for flagged accounts and backfill up to two days of hourly data.

`budgetJob` works through a queue for at most 4 minutes per poll and saves after each account, so it resumes if Chrome kills the worker.

Most once-a-day jobs gate on a stored day string such as `histDay`, `rolled`, `digestDay` or `fired.day`.

### Two time zones

`GOAL_TZ` is America/Los_Angeles. GOAL's spend day runs midnight to midnight Pacific, and `dayStr(GOAL_TZ)`, `range(ds)` and `goalMinute()` all work on that day. `LOCAL_TZ` is the browser's zone. Anything scheduled by hour or shown to the user uses it: `digestHour`, `briefHour`, `recapHour`, `fastBefore` and the Best hours buckets. `briefDay` is a local date, unlike the other day gates. Code comments that say "Central" mean `LOCAL_TZ`.

### GOAL API access

The code treats the GOAL API as undocumented. Parsers such as `listOf` and `pick` accept several response shapes, and `campaignsFor()` returns null if GOAL won't group by campaign. Keep that tolerance when adding endpoints.

There are two auth modes:

- Admin token. `token.js` reads `localStorage.authAdminUser.token` on GOAL pages and messages it to the worker. `call()` sends it as both `Authorization` and `admin-token`. The admin analytics, client list and user list endpoints use this. `amFromToken()` reads the account manager id from the JWT `sub` claim unless Settings overrides it.
- Owner session. `ownerSession()` in `budgets-source.js` does what GOAL's "log in as" does. It finds the account's owner user, posts to `/api/v1/login` with `admin_user: true`, and caches the result in memory for 20 minutes. Campaign lists, budgets, Marketplace stats, source stats and source settings need this. Send those requests through `goalReq()` with `brandHeaders()`.

`call()` throws `AuthError` on 401 or 403. Any inner `try/catch` must rethrow with `if (e.auth) throw e`, so `run()` can call `fail('auth')` and show the grey "?" badge.

### Budgets

For each account, `evaluate()` uses the first of these that has a value:

1. `manual`, a number typed in the popup. It lives in `over` and counts for today only.
2. `live`, from this morning's `budgetJob` pull.
3. `captured`, recorded by `hook.js` when the user opened that account's campaigns in GOAL.
4. `snapshot`, from `SEED.budgets` in `data.js`.

`data.js` is empty in the team build, so `snapshot` never applies. The "Oct 2 snapshot" strings in `csv.js` and comments refer to seed data that this build does not ship.

Weekly budget arrays are indexed by GOAL's `day_id`, where 0 is Sunday. A value of -1, or anything at or above 1e6, means "no daily limit". GOAL stores that as 2147483647.

A campaign is either `qf`, Quote Funnel, with dollar budgets, or `lm`, Lead Marketplace, with unit budgets. `campProduct()` maps `product_type_id` 5 and 3 to them. The admin analytics endpoint only covers Quote Funnel. Marketplace numbers come from `lmToday()` through the owner session and live in `lmStats`.

### evaluate() and alerts

`evaluate(spend, opts)` in `bg.js` joins spend with budgets, history, rhythm curves and Marketplace stats into `snap.rows`, one row per account. The popup, panel and briefing render from `snap`. A row's fields exist only in the object literal that `evaluate()` returns. `popup.js`, `panel.js`, `briefing.js`, `notes.js` and `sources.js` all read them, so check each one when changing a field.

`fired` records which alerts already went out in the current GOAL day. Two options matter:

- `silent` recomputes `snap` without sending alerts or changing `fired`. Mute, settings changes and captured budgets use it.
- `reuse` re-evaluates the last stored spend without fetching.

`fired.primed` is false on the first check of a day. That check sends one catch-up summary in place of an alert per account.

History uses positional arrays. `hist[day][acct]` is `[spend, clicks, leads, calls]`. `campHist[day][acct]` is a list of `[campaignId, name, spend, clicks, leads, calls]`. Header comments in `csv.js`, `hours.js`, `notes.js`, `recaps.js` and `touch.js` give the shapes of `dayLog`, `hourly`, `notes`, `recaps`, `touch` and `checkins`.

Read-modify-write updates that can race go through `serial()`.

### One view, two hosts

`popup.js` defines `BPW_UI(R, env)`. The toolbar popup calls it with `document`. `panel.js` calls it with a shadow root on GOAL pages. To build the panel, `panel.js` fetches `popup.html` and `popup.css` at runtime, strips the script tags, and rewrites `html`, `body` and `html.panel` selectors to `.bpw-root`. Both files sit in `web_accessible_resources` for that reason.

Rules for `popup.js`, `popup.html` and `popup.css` that follow from this:

- Query through `R.querySelector`, never `document.getElementById`.
- Open links with `openUrl()`. Content scripts can't call `chrome.tabs`, so the panel sends an `openUrl` message, and `bg.js` only opens extension and GOAL URLs.
- `popup.js` also loads as a content script. The guard on its last line stops it from mounting itself there.
- New `html` or `body` CSS rules must match the regex rewrites in `viewMarkup()`.

`panel.js` re-renders the minimized pill when `snap` changes in storage. `panel-mode.js` only acts when `popup.html` loads with `?panel=1` inside a frame, and nothing in this build opens it that way.

### Messages and notifications

`bg.js` has one `chrome.runtime.onMessage` listener that switches on `msg.type`. Add a new message as another branch there.

Notification ids carry a prefix that `chrome.notifications.onClicked` uses to pick the page to open: `brief:`, `recap:`, `note:<acct>:`, `cvr:<acct>:` for the Sources review, and `acct:<acct>:` for the account in GOAL.

### Bid changes

`hook.js` wraps `fetch` and `XMLHttpRequest` on GOAL pages. On a Source Settings page it reports the settings list GOAL loads and the request GOAL sends when the user saves a multiplier by hand. `learn()` in `sources.js` turns those into a URL and body template with `{setting}`, `{campaign}`, `{sid}` and `{value}` placeholders, stored in `learned`. `applyBids()` replays the template for the proposals the user ticked on `review.html`, then re-reads GOAL to verify. The `BID` constant holds the limits. Apply stays off until `learned.write.ok` is true.

## Rules the product depends on

- `applyBids()` is the only code that writes to GOAL, and it only changes source bid multipliers the user approved. Never add a write to base bids, daily limits or anything else. The README's closing "Read-only" note contradicts its own Sources review section, and the Sources section is the accurate one.
- The extension never sends a client email. Notes, weekly summaries and check-ins are drafts that the user opens in Gmail or a mail app.
- Weekly summaries and check-ins are positive by design. `recapHighlights()` only compares with the prior week when the comparison is good news, and no draft frames anything as a decline.
- The GOAL token goes only to `api.portal.checkoutgoal.com`. `hook.js` never records sign-in headers. Slack receives only what `slack()` posts to the user's own webhook.
- The alert thresholds came from simulation. `SENS` in `bg.js` targets 1 to 2 false alarms a week across about 65 accounts, and Best hours marks an hour at 3 standard errors. The README quotes these rates to users, so change the numbers and the README together.
