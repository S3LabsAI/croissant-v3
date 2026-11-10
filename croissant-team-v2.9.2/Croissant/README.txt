Croissant v2.9.2 (Chrome extension, formerly Budget Pace Alerts)

INSTALL (one time, about a minute)
1. Unzip this folder somewhere it can stay (for example Documents). Chrome runs it from there, so don't delete it.
2. In Chrome, go to chrome://extensions and turn on "Developer mode" (top right).
3. Click "Load unpacked" and pick the "Croissant" folder.
4. Click the puzzle-piece icon in the toolbar and pin Croissant so the croissant stays visible.
5. Open the GOAL admin dashboard (admin.checkoutgoal.com) once. That connects the extension to your existing GOAL sign-in.
6. Allow notifications if Chrome or macOS asks.
7. Click the croissant, open Settings, and under Client notes put your name in Sign-off (it signs the client emails).

WHO IT TRACKS
Your Active accounts in GOAL: the same list as the admin Clients page filtered to Status: Active and Account Manager: you.
It works out who you are from your GOAL admin sign-in. If the account count looks wrong, put your Account Manager ID in
Settings, Account manager (it's the number in the Clients page URL after filtering to yourself as Account Manager).
The popup's totals row shows how many active accounts it's tracking, and how many have every campaign paused.

UPDATING FROM AN EARLIER VERSION
Replace the folder's contents with this version, then click the reload arrow on Croissant in chrome://extensions.
Chrome may ask to allow the new permissions (downloads for the daily report, and Slack). Your settings and history stay.

WHAT IT DOES
Runs in the background every 5 minutes while Chrome is open. No GOAL tab needs to stay open.

Badge on the croissant
- Red number = accounts at 100%+ of daily budget. Amber "!" = something flagged. Grey "?" = open GOAL admin to reconnect.

Budgets
- Once each GOAL day (first check after midnight Pacific) it reads every account's current daily budgets from GOAL and uses them all day.
  How: for each account it signs in as the account owner with your admin session (same as GOAL's "log in as"), reads the active
  campaigns' budgets, and changes nothing. Your own GOAL tabs aren't affected. The first check of the day takes a minute or two.
- If an account can't be read, it falls back to the budget captured the last time you opened that account's Campaigns page,
  then to older saved numbers (outlined in amber). Hover a budget to see where it came from.
- Typing a budget overrides it for today only. Clear the box to undo.
- Accounts with a campaign set to no daily limit in GOAL show "no limit" instead of a budget (GOAL stores these as
  2,147,483,647). They're left out of the budget total and budget alerts; type a number to pace against one for today.







CAMPAIGNS AND LEAD MARKETPLACE (new in 2.9.2)
Click the arrow next to any account to drop down every campaign on it, Quote Funnel and Lead Marketplace, active and
paused: status dot, product, today's spend, today's daily limit ($ for Quote Funnel, units for Marketplace), pace,
and leads (Marketplace shows leads won, e.g. "8 of 15").
- Spent includes Marketplace spend (shown as "LM $50" under the total). The budget box is the Quote Funnel dollar
  budget; Marketplace unit limits show under it ("+15 units").
- Accounts that only run Marketplace today pace on units (leads won vs. the unit limit), and budget alerts for them say so.
- Budgets and campaign lists are read from GOAL every morning; accounts that become Active during the day are read on
  the next check. Marketplace spend and leads refresh every few minutes.

FLOATING PANEL
The panel sits flush in the bottom-right corner of every GOAL admin and portal page and shows the full view, exactly
what the toolbar croissant shows (banners, totals, filters, search, Conv. and CPL, campaign rows, Settings, exports).
- "-" minimizes it to a small croissant pill showing today's spend, how many accounts are at 100% and 75%+, and flags.
  Click the pill to open it again. Minimized or open is remembered across GOAL tabs.
- "x" hides it on that page until you reload.
- Turn it off under Settings, Floating panel. The toolbar croissant popup works as before.

SELF-UPDATING (new in 2.8)
When a newer version's files are put in this folder, the extension notices within about 5 minutes and reloads itself.
No need to visit chrome://extensions. Your settings, history and notes stay.

MORNING BRIEFING (new in 2.6)
At 8am (adjustable) you get one prompt; click it, or "Briefing" in the popup, for a page with:
- Yesterday: spend, leads, calls, bright spots (most calls, most leads) and who hit budget, earliest first
- Client emails ready: strong-intent notes, check-ins and weekly summaries waiting to send
- Needs a look today: no spend, behind pace, conversion flags (with a Sources link)
- On track to hit budget before noon
- Due for a touchpoint, with a "Talked to them" button
- Bid changes from the Sources review in the last week

NO CLIENT GOES QUIET: CHECK-INS (new in 2.6)
The extension remembers the last time each account heard from you: any client note, weekly summary or check-in you open to
send counts automatically, and "Talked to them" (on the briefing or a check-in) logs calls and meetings. When an active
account reaches 14 days with no contact, it drafts a short, upbeat check-in each morning (up to 5 a day, longest-quiet first,
so it never piles up). Find them under Notes, Check-ins. Nothing is sent automatically. Unsent check-ins stay on the list for
a week. Tracking starts the day you install this version, so the first check-ins appear about two weeks later.
Change the 14 days, the daily limit and the briefing time under Settings, Client notes.

WEEKLY CLIENT SUMMARIES (Fridays)
Every Friday at 9am (change the day and time under Settings, Client notes) it drafts a short, upbeat summary email
for every account that ran in the last 7 full days. You get one prompt; click it, or "Notes" in the popup, then the
"Weekly summaries" tab. Nothing is sent: review, edit and send each one yourself.
Positive outlook by design. Each summary leads with the week's bright spots, strongest first:
- more quote requests or a lower cost per lead than the week before
- a strong week for inbound calls
- a lighter day for online quotes that phone calls carried ("Wednesday was a lighter day for online quotes, but 4 prospects
  picked up the phone and called you directly")
- a standout day, prospects reaching out every day, or more shoppers finding the agency
- on a quiet week: "Another solid week: N quote requests came in", and with no leads yet, how many shoppers clicked through
Comparisons with the week before only appear when they're good news. Cost per lead is shown when it held steady or improved.
Nothing is framed as a decline. The numbers are always real, and you can edit anything before sending.
Report site link (new in 2.7): each summary ends with "Your full performance reports are here anytime:" and the account's
Vercel reporting site. If an account has no site on file, the card says so: paste the link in the Report site field and
it's added to the message and remembered for future weeks. Clear the field to leave the link out.
"To send" shows what's left (standout weeks first). "Rebuild now" redrafts with the latest numbers.

CLIENT NOTES (new in 2.3)
When an account shows strong prospect intent today, you get a prompt with a short, friendly email to the account owner
already drafted. The extension never sends anything: you review it, edit if you like, and send it yourself.
- Triggers (change them in Settings, Client notes): conversion of 80% or more (leads per click, at least 5 clicks so one lucky
  click doesn't count), and/or 2 or more inbound calls in the day. Muted accounts are skipped.
- One prompt per account per day. Once you open a note to send it, that account won't be prompted again for 7 days (adjustable).
  "Skip today" just skips today.
- The owner's email and first name come from the account's user list in GOAL. If none is found, add the address yourself.
- "Open in Gmail" opens a ready-to-send Gmail message. Put your work Gmail address under Settings, Gmail account if Gmail
  should open in that account. "Open in mail app" uses your default mail app. "Copy message" copies the text.
- In the popup, accounts with a note waiting show a green "Note ready" button. Several at once arrive as one prompt.

BEST HOURS (new in 2.2)
Click "Hours" in the popup (or on a Sources review page) to see which hours of the day, on your local clock, each
account converts best and worst. Insight for client conversations only: nothing here changes bids, budgets or schedules.
- Pick an account on the left, or "All accounts". Switch between 14 or 28 days, and all days, weekdays or weekends.
- Green hours convert clearly better than the account's average, red clearly worse. An hour needs at least 30 clicks to be
  judged, and the bar is set high (3 standard errors) so random swings don't get marked. Around 1 hour across all your
  accounts may be marked by chance at any time.
- An account needs at least 7 days and 200 clicks before it says anything.
- Export CSV saves the hour-by-hour table for the account you're looking at.
Where the numbers come from: right after updating, it fills in the last 28 days from GOAL in the background, one hour at a
time (a couple of days per check, so about an hour in total). It first checks that GOAL's hourly numbers add up to its daily
totals. If they don't, it skips the fill-in and builds from its own checks instead, which takes a week or so of Chrome being
open. Hours when Chrome was closed are left out rather than guessed.

SOURCES REVIEW AND BID INCREASES (new in 2.1)
When an account gets a conversion flag (Conv. drop or "No leads N clicks"), click the alert, or the "Sources" button on that
row in the popup. A Sources review page opens for that account showing, per campaign and per source: clicks, leads and spend
today, the 14-day conversion rate, and the current bid multiplier.
- "Likely culprit" (red): a source with clicks today but far fewer leads than it normally gets.
- "Top converter" (green): the best 14-day converters in that campaign (at least 20 clicks and 3 leads, and above the
  campaign's own rate). Up to 3 per campaign get a proposed raise of 10% of the current multiplier (120% becomes 132%),
  never more than 25 points in one step and never above 300%.
- Nothing changes in GOAL until you click Apply. Uncheck anything you don't want. After applying, the page re-reads GOAL and
  shows "Confirmed" next to each change. Every change is listed at the bottom of the page.
- No raises are proposed for culprits, for a source raised in the last 7 days, or when every source with clicks today has
  stopped converting. That pattern usually means the form, landing page or call routing broke, so check the site first.
- Only source bid multipliers are ever changed. Base bids and daily limits are never touched.

One-time step: the first time, the Apply button is off. Change any source's multiplier by hand once on a GOAL Source Settings
page (any account, any campaign, with the extension installed). The extension notes how GOAL saves that change (the request
format only, never your sign-in) and uses exactly that format afterwards. Until then the page shows what to raise, and the
"Open Source Settings" link takes you straight to the right page to do it yourself.

Alerts
- 100% of budget: its own alert the moment it happens (combined if several land at once).
- 25 / 50 / 75%: an hourly roundup by default. Settings can make them one per account, or popup only.
- On track to hit budget early: when an account's normal daily rhythm says it will cap before noon (adjustable).
- No spend / underpacing: when an account that normally spends is well behind where it usually is by this time of day.
- Conversion problems: a long run of clicks with no leads (a broken form or landing page), or a big same-day drop vs. normal.
  "Standard" sensitivity means about 1-2 false alarms a week across all your accounts; "High" catches things sooner with about 5-6.
- 5pm recap: spend vs. budget, who hit budget and when, and anything flagged.
- Click any account alert to open that account in GOAL. Mute silences one account until tomorrow.

Daily rhythm
- It learns each account's normal spend curve through the day from its own checks. That powers the projected cap time
  ("cap ~11:40a" under Pace), the white tick on each bar (where a normal day would be by now), and the time-aware flags.
- Until an account has 2 days of history it borrows the average rhythm across your accounts. Before any history exists,
  it uses simple fixed checks (no spend by 10am, underpacing at 3pm).

Conversion and cost per lead
- Conv. = leads / clicks today, CPL = cost per lead today, each with the account's 14-day normal underneath.
- Click the arrow on an account to see each campaign's numbers.

Patterns tab
- Facts for client conversations: accounts that reached their budget on most recent weekdays (and usually by what time),
  and real week-over-week conversion changes. Information only.

Reports
- Each morning it saves yesterday's CSV (with GOAL's final numbers) to Downloads / GOAL Pace / goal-pace-YYYY-MM-DD.csv.
- "Export today" and "Export history" download the same format on demand: budget, spend, pace, when it hit budget,
  clicks, leads, calls, conversion rate and cost per lead, per account and per campaign. 45 days are kept.

Slack (optional)
- Settings > Slack. Make an incoming webhook at api.slack.com/apps (Create New App > Incoming Webhooks > Add New Webhook,
  pick your own DM or a private channel), paste the URL, click Send test.
- Posts 100% caps, flags, early-cap warnings and the daily recap, with links into GOAL. Not the 25/50/75% roundups.

NOTES
- Read-only. It never changes budgets, bids, or anything in GOAL.
- Everything stays in your Chrome except what you choose to send to your own Slack.
