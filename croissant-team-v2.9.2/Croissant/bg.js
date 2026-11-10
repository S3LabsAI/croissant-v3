// Croissant: background worker.
// It reads spend, account lists, campaign budgets and source stats from GOAL. The one thing it can change is a
// source's bid multiplier, and only after you approve it on the Sources review page (see sources.js).
// It never changes base bids, daily limits or anything else.
importScripts('data.js', 'budgets-source.js', 'rhythm.js', 'csv.js', 'sources.js', 'hours.js', 'notes.js', 'recaps.js', 'touch.js', 'briefing.js');

var API = 'https://api.portal.checkoutgoal.com';
var PORTAL = 'https://www.portal.checkoutgoal.com/dashboard?admin_user=true&account_id=';
var GOAL_TZ = 'America/Los_Angeles';   // GOAL's spend day
var LOCAL_TZ = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'; } catch (e) { return 'America/Chicago'; } })();   // your clock
var AM_ID = null;   // the signed-in account manager; set from Settings or detected from the GOAL admin sign-in
// GOAL admin sign-ins carry the admin user's id, which is also their Account Manager id in client filters.
function amFromToken(token) {
  try { var p = String(token || '').replace(/^Bearer\s+/i, '').split('.')[1]; var c = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))); return c && c.sub ? +c.sub : null; } catch (e) { return null; }
}
function setAm(token, s) { AM_ID = (s && +s.amId) || amFromToken(token) || AM_ID; return AM_ID; }
var HISTORY_DAYS = 14;
var DEFAULTS = {
  every: 5, th: [25, 50, 75, 100],
  flags: true, zeroHour: 10, underHour: 15, underPct: 25,      // fixed-time fallbacks until rhythm is learned
  routine: 'group', routineEvery: 60,                          // 25/50/75% alerts: 'group' = roundup at most hourly, 'each', or 'off'
  cvrAlerts: true, cvrMinClicks: 15, cvrDropPct: 50, cvrSens: 'standard', // conversion drop: under half of normal and too big a gap to be chance
  fastAlerts: true, fastBefore: 12,                            // "on track to hit budget" if before noon
  digest: true, digestHour: 17,                                // 5pm recap
  autoSave: true,                                              // save yesterday's CSV to Downloads/GOAL Pace
  slackOn: false, slackUrl: '',
  noteOn: true, noteCvrOn: true, noteCvrPct: 80, noteMinClicks: 5,   // client note prompt: conversion at or above 80% (5+ clicks)
  noteCallsOn: true, noteCalls: 2, noteCooldown: 7,                 // ... and/or 2+ inbound calls; at most one note per account a week
  noteSig: '', noteFrom: '', amId: '',
  recapOn: true, recapDay: 5, recapHour: 9, recapOnlyGood: false,  // weekly client summary drafts: Friday 9am, last 7 full days
  touchOn: true, quietDays: 14, checkinMax: 5,                      // check-in drafts for accounts with no contact in 14+ days, up to 5 a day
  briefOn: true, briefHour: 8,                                      // morning briefing at 8am
  panelOn: true                                                     // floating panel, bottom-right of GOAL pages
};

// ---------- storage ----------
function get(keys) { return new Promise(function (r) { chrome.storage.local.get(keys, r); }); }
function set(obj) { return new Promise(function (r) { chrome.storage.local.set(obj, r); }); }
async function settings() { var s = (await get('settings')).settings || {}; return Object.assign({}, DEFAULTS, s); }

// ---------- time ----------
function parts(tz, d) {
  var f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  var o = {}; f.formatToParts(d || new Date()).forEach(function (p) { o[p.type] = p.value; }); return o;
}
function dayStr(tz, d) { var p = parts(tz, d); return p.year + '-' + p.month + '-' + p.day; }
function addDays(ds, n) { var a = ds.split('-'); var t = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2] + n)); return t.toISOString().slice(0, 10); }
function isWeekend(ds) { var a = ds.split('-'); var w = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2])).getUTCDay(); return w === 0 || w === 6; }
function weekdayIdx(ds) { var a = ds.split('-'); return new Date(Date.UTC(+a[0], +a[1] - 1, +a[2])).getUTCDay(); }
function tzOffset(tz, d) { var p = parts(tz, d); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(d.getTime() / 60000) * 60000; }
function range(ds) {
  var a = ds.split('-'); var guess = Date.UTC(+a[0], +a[1] - 1, +a[2], 12);
  var start = Date.UTC(+a[0], +a[1] - 1, +a[2]) - tzOffset(GOAL_TZ, new Date(guess));
  return [new Date(start).toISOString(), new Date(start + 86400000 - 1).toISOString()];
}
function goalMinute(d) { var p = parts(GOAL_TZ, d); return +p.hour * 60 + +p.minute; }
function localHour(d) { var p = parts(LOCAL_TZ, d); return +p.hour + (+p.minute) / 60; }
function clock(d) { return d.toLocaleTimeString('en-US', { timeZone: LOCAL_TZ, hour: 'numeric', minute: '2-digit' }); }
function clockShort(t) { return clock(new Date(t)).replace(' AM', 'am').replace(' PM', 'pm'); }
function money(n) { return '$' + (+n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function money0(n) { return '$' + Math.round(+n).toLocaleString('en-US'); }
function pc(n) { return n == null ? '-' : (n >= 10 ? n.toFixed(1) : n.toFixed(2)).replace(/\.?0+$/, '') + '%'; }
function round2(n) { return Math.round((+n || 0) * 100) / 100; }

// ---------- GOAL API ----------
function AuthError() { this.auth = true; this.message = 'GOAL sign-in expired'; }
async function call(token, method, path, body) {
  var res = await fetch(API + path, { method: method, headers: { Authorization: token, 'admin-token': token, 'Content-Type': 'application/json', accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 || res.status === 403) throw new AuthError();
  if (!res.ok) throw new Error('GOAL API ' + res.status + ' on ' + path.split('?')[0]);
  return res.json();
}
function analyticsBody(ds, groupBy) {
  var r = range(ds);
  return { start_date: r[0], end_date: r[1], timezone: GOAL_TZ, states: null, lead_type_ids: null, campaign_ids: null, ad_group_ids: null, account_ids: null, brand_ids: null, marketing_groups: null, ad_ids: null, source_type_ids: null, device_types: null, account_manager_ids: [AM_ID], sales_manager_ids: null, insurance_carrier_ids: null, group_by_params: groupBy, invoice: null };
}
function metrics(x) { return { s: +x.click_analytic_total_cost || 0, c: +x.click_analytic_total_clicks || 0, l: +x.leads_generated_count || 0, k: +x.calls_generated_count || 0 }; }
async function spendFor(token, ds) {
  var j = await call(token, 'POST', '/api/v2/admin_analytics/quote_funnels', analyticsBody(ds, ['account_id']));
  var m = {};
  (j.data || []).forEach(function (x) { var v = metrics(x); v.n = x.company_name; m[x.account_id] = v; });
  return m;
}
// Split by campaign. Returns null if GOAL won't group this way.
async function campaignsFor(token, ds) {
  var j = await call(token, 'POST', '/api/v2/admin_analytics/quote_funnels', analyticsBody(ds, ['account_id', 'campaign_id']));
  var rows = j.data || [], out = {}, any = false;
  rows.forEach(function (x) {
    var cid = x.campaign_id != null ? x.campaign_id : (x.campaign && x.campaign.id);
    if (cid == null) return;
    any = true;
    var v = metrics(x);
    v.id = cid; v.n = x.campaign_name || (x.campaign && x.campaign.name) || x.name || ('Campaign ' + cid);
    (out[x.account_id] = out[x.account_id] || []).push(v);
  });
  return any || !rows.length ? out : null;
}
function cvr(v) { return v && v.c > 0 ? v.l / v.c * 100 : null; }
// Chance of seeing this few leads (or fewer) from this many clicks if the account converted at its normal rate.
function binomCdf(k, n, p) {
  if (n <= 0 || p <= 0) return 1; if (p >= 1) return k >= n ? 1 : 0;
  var lq = Math.log(1 - p), lp = Math.log(p), term = n * lq, sum = Math.exp(term);
  for (var i = 1; i <= k; i++) { term += Math.log((n - i + 1) / i) + lp - lq; sum += Math.exp(term); }
  return Math.min(1, sum);
}
// Odds cutoffs, tuned by simulation across ~65 accounts at 20-45 clicks a day:
// standard = about 1-2 false alarms a week portfolio-wide; high = faster, about 5-6 a week.
var SENS = { standard: { day: 0.002, run: 0.001 }, high: { day: 0.005, run: 0.003 } };
function sens(s) { return SENS[s.cvrSens] || SENS.standard; }
function convDrop(s, clicks, leads, normPct) {
  return !!(s.cvrAlerts && clicks >= s.cvrMinClicks && normPct != null && normPct >= 2 && (leads / clicks * 100) < normPct * s.cvrDropPct / 100 && binomCdf(leads, clicks, normPct / 100) < sens(s).day);
}
// Clicks since the last lead, counting back across earlier days that had clicks but no leads.
// dayVals: [{c, l}] for yesterday, the day before, ... (most recent first).
function clicksSinceLead(todayClicks, todayLeads, dayVals) {
  if (todayLeads > 0) return { n: 0, days: 0, upto: 0 };
  var n = todayClicks, days = 0, i;
  for (i = 0; i < dayVals.length && i < 7; i++) {
    var v = dayVals[i]; if (!v || !(v.c > 0)) continue;   // a day with no clicks doesn't break the streak
    if (v.l > 0) break;
    n += v.c; days++;
  }
  return { n: n, days: days, upto: i };
}
// Normal conversion rate from history, leaving out the days inside the current no-lead run
// (otherwise a broken form drags its own "normal" down and hides itself).
function rateExcluding(dayVals, skip, fallback) {
  var c = 0, l = 0;
  dayVals.slice(skip).forEach(function (v) { if (v) { c += v.c; l += v.l; } });
  return c >= 20 ? l / c * 100 : fallback;
}
// "Broken form" check: a run of clicks with no leads that's very unlikely at the normal rate.
function noLeadRun(s, run, normPct) {
  return !!(s.cvrAlerts && normPct != null && normPct >= 2 && run.n >= s.cvrMinClicks && Math.pow(1 - normPct / 100, run.n) < sens(s).run);
}
function campCompact(camps) {
  var c = {};
  Object.keys(camps).forEach(function (id) { c[id] = camps[id].filter(function (x) { return x.s > 0 || x.c > 0; }).map(function (x) { return [x.id, x.n, round2(x.s), x.c, x.l, x.k]; }); });
  return c;
}

// Active + onboarding accounts you manage, with brand ids for the "open in GOAL" links. Once a day.
async function refreshRoster(token) {
  // Same list as GOAL's Clients page filtered to Status: Active and Account Manager: you.
  var st = JSON.stringify([{ label: 'Active', value: 'active' }]);
  var F = encodeURIComponent(JSON.stringify({ status: true, status_value: st, account_manager: true, account_manager_value: JSON.stringify([{ label: '', value: AM_ID }]) }));
  var names = {}, pages = 1;
  for (var p = 1; p <= pages && p <= 10; p++) {
    var j = await call(token, 'GET', '/api/v2/admin_manage_clients?page_number=' + p + '&sort_by=id&sort_order=desc&filters=' + F);
    pages = (j.additional_data && +j.additional_data.total_number_of_pages) || 1;
    (j.data || []).forEach(function (x) { (x.accounts || []).forEach(function (a) { names[a.id] = a.company_name || x.company_name || ('Account ' + a.id); }); });
  }
  var ids = Object.keys(names).map(Number);
  var brands = {};
  if (ids.length) {
    var c = await call(token, 'POST', '/api/v1/admin_manage_clients/get_campaigns_by_account', { account_ids: ids });
    (c.data || []).forEach(function (x) { if (!brands[x.account_id] && !x.discarded_at) brands[x.account_id] = x.brand_id; });
    (c.data || []).forEach(function (x) { if (!brands[x.account_id]) brands[x.account_id] = x.brand_id; });
  }
  return { day: null, v: 2, am: AM_ID, ids: ids, names: names, brands: brands };
}

// Final daily totals for the last 14 GOAL days, per account and per campaign. Fetches only missing days.
async function refreshHistory(token, today, hist, campHist) {
  hist = hist || {}; campHist = campHist || {};
  var h2 = {}, c2 = {};
  for (var i = 1; i <= HISTORY_DAYS; i++) {
    var d = addDays(today, -i);
    if (hist[d]) h2[d] = hist[d];
    else {
      var m = await spendFor(token, d), slim = {};
      Object.keys(m).forEach(function (id) { var v = m[id]; if (v.s > 0 || v.c > 0) slim[id] = [round2(v.s), v.c, v.l, v.k]; });
      h2[d] = slim;
    }
    if (campHist[d]) c2[d] = campHist[d];
    else { try { var cm = await campaignsFor(token, d); if (cm) c2[d] = campCompact(cm); } catch (e) { if (e.auth) throw e; } }
  }
  return { hist: h2, campHist: c2 };
}

// "Normal" for today's kind of day (weekday vs weekend) from history, plus 14-day conversion and cost per lead.
function baseline(hist, today) {
  var wk = isWeekend(today), out = {};
  var days = Object.keys(hist).filter(function (d) { return isWeekend(d) === wk; });
  var ids = {};
  Object.keys(hist).forEach(function (d) { Object.keys(hist[d]).forEach(function (id) { ids[id] = 1; }); });
  Object.keys(ids).forEach(function (id) {
    var vals = days.map(function (d) { var v = hist[d][id]; return Array.isArray(v) ? v[0] : (v || 0); });
    var on = vals.filter(function (v) { return v > 1; }).sort(function (a, b) { return a - b; });
    var S = 0, C = 0, L = 0;
    Object.keys(hist).forEach(function (d) { var v = hist[d][id]; if (Array.isArray(v)) { S += v[0]; C += v[1]; L += v[2]; } });
    out[id] = { med: on.length ? on[Math.floor(on.length / 2)] : 0, freq: days.length ? on.length / days.length : 0, n: days.length,
      tcvr: C >= 20 ? L / C * 100 : null, tcpl: L >= 3 ? S / L : null };
  });
  return out;
}
// 14-day conversion and cost per lead per campaign.
function campNorms(campHist) {
  var t = {};
  Object.keys(campHist || {}).forEach(function (d) {
    Object.keys(campHist[d]).forEach(function (a) {
      campHist[d][a].forEach(function (c) { var k = a + ':' + c[0]; var x = t[k] = t[k] || { s: 0, c: 0, l: 0 }; x.s += c[2]; x.c += c[3]; x.l += c[4]; });
    });
  });
  var out = {};
  Object.keys(t).forEach(function (k) { var x = t[k]; out[k] = { ncvr: x.c >= 30 ? x.l / x.c * 100 : null, ncpl: x.l >= 3 ? x.s / x.l : null }; });
  return out;
}

// ---------- evaluate ----------
function freshFired(today) { return { day: today, th: {}, flag: {}, cvr: {}, cvrc: {}, fast: {}, capAt: {}, primed: false }; }
async function evaluate(spend, opts) {
  opts = opts || {};
  var camps = opts.camps;
  var prevSnap = (await get('snap')).snap;
  if (camps === undefined) camps = prevSnap && prevSnap.camps || null;
  // Re-checks between polls reuse the last spend; if that spend is from an earlier GOAL day, don't use it.
  var stale = opts.reuse && (!prevSnap || prevSnap.day !== dayStr(GOAL_TZ));
  if (stale) { spend = {}; camps = null; }
  var s = await settings();
  var st = await get(['budgetSnap', 'over', 'snooze', 'roster', 'hist', 'campHist', 'fired', 'curves', 'budgetJob', 'lmStats']);
  var jobCamps = st.budgetJob && st.budgetJob.camps || {};
  var now = new Date(), today = dayStr(GOAL_TZ), wd = weekdayIdx(today);
  var lmAll = st.lmStats && st.lmStats.day === today ? st.lmStats.a : {};
  var budgets = SEED.budgets, over = st.over || {}, snooze = st.snooze || {};
  var bsnap = st.budgetSnap && st.budgetSnap.day === today ? st.budgetSnap : null;
  var roster = st.roster || { ids: [], names: {}, brands: {} };
  var brands = Object.assign({}, SEED.brands, roster.brands || {});
  var names = roster.names || {};
  var base = baseline(st.hist || {}, today);
  var cn = campNorms(st.campHist);
  var hour = localHour(now), gmin = goalMinute(now);
  var dayStart = new Date(range(today)[0]).getTime();
  var pooled = typicalCurve(st.curves, null, today);
  var histDays = Object.keys(st.hist || {}).filter(function (d) { return d < today; }).sort().reverse();

  var ids = {};
  (roster.ids || []).forEach(function (id) { ids[id] = 1; });
  if (!roster.ids || !roster.ids.length) Object.keys(budgets.b || {}).forEach(function (id) { ids[id] = 1; });
  if (!roster.ids || !roster.ids.length) Object.keys(spend).forEach(function (id) { if (spend[id].s > 0) ids[id] = 1; });

  var rows = Object.keys(ids).map(function (id) {
    var sp = spend[id] ? spend[id].s : 0;
    // Typed-in budgets count for the day you typed them. (Older plain-number ones only fill gaps GOAL didn't.)
    var ov = over[id], hasOver = ov != null && ov !== '' && (typeof ov === 'object' ? ov.day === today : !(bsnap && bsnap.src[id] === 'live'));
    var ovVal = ov && typeof ov === 'object' ? ov.v : ov;
    var bud = hasOver ? +ovVal : bsnap && bsnap.b[id] != null ? +bsnap.b[id] : (budgets.b && budgets.b[id] ? +budgets.b[id][1][wd] : 0);
    var noLimit = !hasOver && (bud === -1 || bud >= 1e6);   // a campaign set to no daily limit in GOAL
    if (noLimit) bud = 0;
    // Every campaign paused in GOAL (read during this morning's budget pull).
    var jc = jobCamps[id], paused = !hasOver && !(bud > 0) && !noLimit && Array.isArray(jc) && jc.length > 0 && jc.every(function (c) { return c.active === false; });
    var budSrc = hasOver ? 'manual' : bsnap && bsnap.src[id] ? bsnap.src[id] : (budgets.b && budgets.b[id] ? 'snapshot' : '');
    var b = base[id] || { med: 0, freq: 0, n: 0, tcvr: null, tcpl: null };
    var normal = b.n >= 2 && b.freq >= 0.6 && b.med >= 20;

    // Spend rhythm: where a normal day would be by now.
    var cur = typicalCurve(st.curves, id, today) || pooled;
    var fnow = cur ? fracAt(cur.c, gmin) : null;
    var expected = cur && normal ? b.med * fnow : null;
    var flag = null;
    // Spend flags are about Quote Funnel clicks; skip them when no Quote Funnel campaign is running today.
    var qfRunning = !Array.isArray(jc) || !jc.length || jc.some(function (c) { return c.active && c.product !== 'lm'; });
    if (s.flags && normal && !paused && qfRunning) {
      if (cur) {
        if (fnow >= 0.15 && sp < 0.01 && expected >= 15) flag = 'zero';
        else if (fnow >= 0.25 && expected >= 20 && sp < expected * 0.4) flag = 'under';
      } else {
        if (sp < 0.01 && hour >= s.zeroHour) flag = 'zero';
        else if (hour >= s.underHour && sp < b.med * s.underPct / 100) flag = 'under';
      }
    }
    // Projected time to hit the budget, from the typical rhythm.
    var capAt = null;
    if (cur && fnow >= 0.1 && sp >= 10 && bud > 0 && sp < bud) {
      var target = bud * fnow / sp;
      if (target <= 1) { var m = minuteFor(cur.c, target); if (m != null && m > gmin) capAt = dayStart + m * 60000; }
    }

    var v = spend[id] || { s: 0, c: 0, l: 0, k: 0 };
    var acvr = cvr(v);
    var prevDays = histDays.map(function (d) { var x = (st.hist || {})[d] && st.hist[d][id]; return x ? { c: x[1], l: x[2] } : null; });
    var run = clicksSinceLead(v.c || 0, v.l || 0, prevDays);
    var runNorm = run.days ? rateExcluding(prevDays, run.upto, b.tcvr) : b.tcvr;
    var cflag = convDrop(s, v.c, v.l, b.tcvr) ? 'cvr' : noLeadRun(s, run, runNorm) ? 'nolead' : null;
    var cs = (camps && camps[id] ? camps[id] : []).filter(function (c) { return c.s > 0 || c.c > 0; }).map(function (c) {
      var n = cn[id + ':' + c.id] || {}, cc = cvr(c);
      var cdays = histDays.map(function (d) { var a = (st.campHist || {})[d] && st.campHist[d][id]; var x = a && a.find(function (q) { return String(q[0]) === String(c.id); }); return x ? { c: x[3], l: x[4] } : null; });
      var crun = clicksSinceLead(c.c, c.l, cdays), crunNorm = crun.days ? rateExcluding(cdays, crun.upto, n.ncvr) : n.ncvr;
      return { id: c.id, name: c.n, spend: c.s, clicks: c.c, leads: c.l, calls: c.k, cvr: cc, ncvr: n.ncvr == null ? null : n.ncvr,
        cpl: c.l > 0 ? c.s / c.l : null, ncpl: n.ncpl == null ? null : n.ncpl,
        run: crun.n, runDays: crun.days,
        flag: convDrop(s, c.c, c.l, n.ncvr) ? 'cvr' : noLeadRun(s, crun, crunNorm) ? 'nolead' : null, runNorm: crunNorm };
    }).sort(function (a, b) { return b.spend - a.spend; });

    // Every campaign on the account (Quote Funnel and Lead Marketplace), with today's limit, spend and pace.
    var lmS = (lmAll[id] && lmAll[id].c) || {}, qfById = {};
    (camps && camps[id] || []).forEach(function (c) { qfById[c.id] = c; });
    var csById = {}; cs.forEach(function (c) { csById[c.id] = c; });
    var lmUnits = 0, lmUnl = false, lmSpend = 0, lmWon = 0, lmAny = false, seenC = {};
    var campList = (jc || []).map(function (c) {
      seenC[c.id] = 1;
      var lm = c.product === 'lm', q = qfById[c.id], x = lm ? lmS[c.id] : null, k = csById[c.id];
      var lim = lm ? (c.units ? c.units[wd] : null) : (c.dollar ? c.dollar[wd] : null);
      var spd = lm ? (x ? x.s : 0) : (q ? q.s : 0), won = lm ? (x ? x.l : 0) : (q ? q.l : 0);
      if (lm) { lmAny = true; lmSpend += spd; lmWon += won; if (c.active) { if (lim === -1) lmUnl = true; else if (lim > 0) lmUnits += lim; } }
      var p = !c.active || lim == null || lim <= 0 ? null : lm ? won / lim * 100 : spd / lim * 100;
      return { id: c.id, name: c.name, product: c.product, active: c.active, limit: lim, spend: spd, leads: won, clicks: q ? q.c : 0, calls: q ? q.k : 0,
        pct: p, cvr: k ? k.cvr : (q ? cvr(q) : null), ncvr: k ? k.ncvr : null, cpl: won > 0 ? spd / won : null, ncpl: k ? k.ncpl : null, flag: k ? k.flag : null, run: k ? k.run : 0 };
    });
    cs.forEach(function (k) { if (!seenC[k.id]) campList.push({ id: k.id, name: k.name, product: 'qf', active: true, limit: null, spend: k.spend, leads: k.leads, clicks: k.clicks, calls: k.calls, pct: null, cvr: k.cvr, ncvr: k.ncvr, cpl: k.cpl, ncpl: k.ncpl, flag: k.flag, run: k.run }); });
    campList.sort(function (a, b) { return (b.active - a.active) || (b.spend - a.spend) || String(a.name).localeCompare(String(b.name)); });
    if (lmAny && paused && lmUnits > 0) paused = false;
    return {
      lmUnits: lmUnits, lmUnl: lmUnl, lmSpend: round2(lmSpend), lmWon: lmWon, lmAny: lmAny, campList: campList,
      id: id, name: names[id] || (budgets.b && budgets.b[id] && budgets.b[id][0]) || (spend[id] && spend[id].n) || ('Account ' + id),
      spend: sp, bud: bud, noLimit: noLimit, paused: paused, budSrc: budSrc, budAsOf: hasOver ? null : bsnap && bsnap.asOf[id] || null, budWhy: bsnap && bsnap.why && bsnap.why[id] || null,
      pct: bud > 0 ? sp / bud * 100 : (lmUnits > 0 ? lmWon / lmUnits * 100 : null), paceUnits: !(bud > 0) && lmUnits > 0, typ: b.med, expected: expected, capAt: capAt, rhythm: cur ? cur.src : null,
      flag: flag, cflag: cflag, campFlags: cs.filter(function (c) { return c.flag; }).length,
      clicks: v.c || 0, leads: v.l || 0, calls: v.k || 0, cvr: acvr, run: run.n, runDays: run.days, runNorm: runNorm, tcvr: b.tcvr, cpl: v.l > 0 ? v.s / v.l : null, tcpl: b.tcpl, camps: cs,
      snoozed: snooze[id] === today, url: brands[id] ? PORTAL + id + '&brand_id=' + brands[id] : null
    };
  });
  rows.sort(function (a, b) {
    if (a.snoozed !== b.snoozed) return a.snoozed ? 1 : -1;
    var ap = a.pct == null ? -1 : a.pct, bp = b.pct == null ? -1 : b.pct;
    return (bp - ap) || (b.spend - a.spend);
  });

  // ---- alerts ----
  var fired = st.fired && st.fired.day === today ? st.fired : freshFired(today);
  ['th', 'flag', 'cvr', 'cvrc', 'fast', 'capAt'].forEach(function (k) { fired[k] = fired[k] || {}; });
  // Quiet re-checks (mute, settings) don't touch the day's alert record.
  if (opts.silent) fired = JSON.parse(JSON.stringify(fired));
  var alerts = [], hits = [];
  rows.forEach(function (r) {
    var mute = r.snoozed;
    if (r.pct != null) {
      var prev = fired.th[r.id] || 0;
      var crossed = s.th.filter(function (t) { return r.pct >= t && t > prev; });
      if (crossed.length) {
        fired.th[r.id] = Math.max.apply(null, crossed);
        if (r.pct >= 100 && fired.capAt[r.id] == null) fired.capAt[r.id] = fired.primed ? Date.now() : 0;
        if (!mute) hits.push({ r: r, top: fired.th[r.id], crossed: crossed });
      }
    }
    if (r.flag && !fired.flag[r.id]) {
      fired.flag[r.id] = r.flag;
      if (!mute) {
        if (r.flag === 'zero') alerts.push(al(r, short(r.name) + ' has no spend yet today', 'Usually spends about ' + money(r.typ) + ' on a day like today' + (r.expected ? ', about ' + money(r.expected) + ' by now' : '') + '. Worth a look: paused campaign, billing, or bids not winning.', true));
        else alerts.push(al(r, short(r.name) + ' is underpacing', money(r.spend) + ' so far vs. ' + (r.expected ? 'about ' + money(r.expected) + ' by this time on a normal day.' : 'about ' + money(r.typ) + ' on a normal full day.'), true));
      }
    }
    if (r.cflag && !fired.cvr[r.id]) {
      fired.cvr[r.id] = 1;
      if (!mute) alerts.push(cvrId(r.cflag === 'nolead'
        ? al(r, short(r.name) + ' has had no leads in ' + r.run + ' clicks', (r.runDays ? 'No leads since ' + (r.runDays === 1 ? 'yesterday' : r.runDays + ' days ago') + ', ' : '') + 'it normally converts ' + pc(r.runNorm) + ' of clicks. Worth checking forms, landing page, or call routing.', true)
        : al(r, short(r.name) + ' conversion rate is down', pc(r.cvr) + ' today (' + r.leads + ' leads from ' + r.clicks + ' clicks) vs. ' + pc(r.tcvr) + ' normally. Worth checking forms, landing page, or call routing.', true)));
    }
    r.camps.forEach(function (c) {
      var k = r.id + ':' + c.id;
      if (c.flag && !fired.cvrc[k]) {
        fired.cvrc[k] = 1;
        if (!mute && !r.cflag) alerts.push(cvrId(c.flag === 'nolead'
          ? al(r, short(r.name) + ': ' + c.name + ' has had no leads in ' + c.run + ' clicks', 'It normally converts ' + pc(c.runNorm) + ' of clicks. Worth checking that campaign\'s form or landing page.', true)
          : al(r, short(r.name) + ': ' + c.name + ' conversion is down', pc(c.cvr) + ' today (' + c.leads + ' leads from ' + c.clicks + ' clicks) vs. ' + pc(c.ncvr) + ' normally.', true)));
      }
    });
    if (s.fastAlerts && r.capAt && r.pct >= 25 && r.pct < 100 && localHour(new Date(r.capAt)) < s.fastBefore && !fired.fast[r.id]) {
      fired.fast[r.id] = 1;
      if (!mute) alerts.push(al(r, short(r.name) + ' is on track to hit its budget around ' + clockShort(r.capAt), money(r.spend) + ' of ' + money(r.bud) + ' spent so far (' + Math.round(r.pct) + '%).', true));
    }
  });

  if (!opts.silent) {
    if (!fired.primed) {
      // First check of the day (or after install): one catch-up summary instead of a pile of budget alerts.
      var n100 = rows.filter(function (r) { return !r.snoozed && r.pct >= 100; }).length;
      var n75 = rows.filter(function (r) { return !r.snoozed && r.pct >= 75 && r.pct < 100; }).length;
      if (n100 || n75) notify('sum:' + Date.now(), 'Catching up on today', n100 + ' account' + (n100 === 1 ? '' : 's') + ' at 100%+ and ' + n75 + ' at 75-99% of daily budget. New crossings will alert from here.');
    } else {
      hits.forEach(function (h) {
        alerts.unshift(al(h.r, short(h.r.name) + ' hit ' + h.top + '% of daily ' + (h.r.paceUnits ? 'Marketplace limit' : 'budget'), (h.r.paceUnits ? h.r.lmWon + ' of ' + h.r.lmUnits + ' Marketplace leads won today, ' + money(h.r.lmSpend) + ' spent' : money(h.r.spend) + ' of ' + money(h.r.bud) + ' spent today') + ' (' + Math.round(h.r.pct) + '%)' + (h.crossed.length > 1 ? '. Crossed ' + h.crossed.join('%, ') + '%.' : '.'), h.top >= 100, h.top >= 100 ? 'cap' : 'routine'));
        alerts[0].top = h.top;
      });
    }
    await deliver(alerts, s, today);
  }
  if (!opts.silent) fired.primed = true;

  var tc = 0, tl = 0; rows.forEach(function (r) { tc += r.clicks; tl += r.leads; });
  var snap = { at: Date.now(), day: today, rows: rows, spend: spend, camps: camps, campsOk: camps != null, totCvr: tc ? tl / tc * 100 : null, err: null,
    budgetsAsOf: budgets.asOf, budgetSnapAt: bsnap ? bsnap.at : null, budgetMix: mix(rows), capAt: fired.capAt,
    rhythm: { account: rows.filter(function (r) { return r.rhythm === 'account'; }).length, pooled: !!pooled },
    budgetPull: bsnap ? { done: bsnap.jobDone, pulled: bsnap.pulled, total: bsnap.total, failed: Object.keys(bsnap.why || {}).length } : null };
  await set(opts.silent ? { snap: snap } : { fired: fired, snap: snap });
  await badge(snap);
  if (!stale && spend && Object.keys(spend).length) await logDay(today, spend, camps, rows, fired.capAt);
  return snap;
}
function al(r, title, msg, slack, kind) { return { id: 'acct:' + r.id + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 6), title: title, msg: msg, slack: slack, r: r, kind: kind || 'issue' }; }
// Conversion alerts open the Sources review page when clicked.
function cvrId(a) { a.id = a.id.replace(/^acct:/, 'cvr:'); a.msg += ' Click to review sources.'; a.slackMsg = ' Review sources in the Croissant extension.'; return a; }
function mix(rows) { var m = { live: 0, captured: 0, snapshot: 0, manual: 0 }; rows.forEach(function (r) { if (r.bud > 0 && m[r.budSrc] != null) m[r.budSrc]++; }); return m; }
function short(n) { return n.length > 44 ? n.slice(0, 42) + '...' : n; }
function isFlagged(r) { return !!(r.flag || r.cflag || r.campFlags); }

// ---------- delivery: notifications + Slack ----------
function notify(id, title, message) {
  chrome.notifications.create(id, { type: 'basic', iconUrl: 'icons/icon128.png', title: title, message: message, priority: 2 });
}
async function deliver(alerts, s, today) {
  if (!alerts.length) return;
  var routine = alerts.filter(function (a) { return a.kind === 'routine'; });
  var caps = alerts.filter(function (a) { return a.kind === 'cap'; });
  var issues = alerts.filter(function (a) { return a.kind === 'issue'; });
  // Budget caps: one alert each, or one combined alert when several land together.
  if (caps.length > 3) notify('sum:' + Date.now(), caps.length + ' accounts hit their daily budget', caps.map(function (a) { return short(a.r.name); }).join(', '));
  else caps.forEach(function (a) { notify(a.id, a.title, a.msg); });
  // Problems (no spend, underpacing, conversion drops, burning fast): always their own alert, unless there's a pile.
  if (issues.length > 4) notify('sum:' + Date.now(), issues.length + ' accounts need a look', issues.slice(0, 4).map(function (a) { return a.title; }).join('\n') + '\nand ' + (issues.length - 4) + ' more');
  else issues.forEach(function (a) { notify(a.id, a.title, a.msg); });
  // 25 / 50 / 75%: hourly roundup by default (or one per account, or popup only).
  if (s.routine === 'each') routine.forEach(function (a) { notify(a.id, a.title, a.msg); });
  else if (s.routine !== 'off') {
    var g = await get('roundup'), ru = g.roundup && g.roundup.day === today ? g.roundup : { day: today, last: 0, pend: {} };
    routine.forEach(function (a) { ru.pend[a.r.id] = { n: short(a.r.name), t: Math.max(a.top, (ru.pend[a.r.id] || {}).t || 0) }; });
    var keys = Object.keys(ru.pend);
    if (keys.length && Date.now() - ru.last >= s.routineEvery * 60000) {
      var list = keys.map(function (k) { return ru.pend[k]; }).sort(function (a, b) { return b.t - a.t; });
      notify('pace:' + Date.now(), list.length === 1 ? list[0].n + ' passed ' + list[0].t + '% of daily budget' : list.length + ' accounts passed budget milestones',
        list.map(function (x) { return x.n + ' ' + x.t + '%'; }).join(', '));
      ru.pend = {}; ru.last = Date.now();
    }
    await set({ roundup: ru });
  }
  var sl = alerts.filter(function (a) { return a.slack; });
  if (sl.length) slack(s, sl.map(function (a) { return ':croissant: *' + slackLink(a.r, a.title) + '*\n' + a.msg.replace(' Click to review sources.', '') + (a.slackMsg || ''); }).join('\n\n'));
}
function slackLink(r, text) { var t = String(text).replace(/[<>|]/g, ''); return r && r.url ? '<' + r.url + '|' + t + '>' : t; }
async function slack(s, text) {
  if (!s.slackOn || !/^https:\/\/hooks\.slack\.com\//.test(s.slackUrl || '')) return false;
  try { var r = await fetch(s.slackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text }) }); return r.ok; }
  catch (e) { return false; }
}
chrome.notifications.onClicked.addListener(async function (nid) {
  chrome.notifications.clear(nid);
  if (/^brief:/.test(nid)) { chrome.tabs.create({ url: chrome.runtime.getURL('briefing.html') }); return; }
  if (/^recap:/.test(nid)) { chrome.tabs.create({ url: chrome.runtime.getURL('notes.html?view=recaps') }); return; }
  var nt = /^note:(\w+):/.exec(nid);
  if (nt) { chrome.tabs.create({ url: chrome.runtime.getURL('notes.html' + (nt[1] === 'all' ? '' : '?acct=' + nt[1])) }); return; }
  var cv = /^cvr:(\d+):/.exec(nid);
  if (cv) { chrome.tabs.create({ url: chrome.runtime.getURL('review.html?acct=' + cv[1]) }); return; }
  var m = /^acct:(\d+):/.exec(nid);
  if (m) {
    var snap = (await get('snap')).snap; var r = snap && snap.rows.find(function (x) { return x.id === m[1]; });
    if (r && r.url) { chrome.tabs.create({ url: r.url }); return; }
  }
  if (chrome.action.openPopup) chrome.action.openPopup().catch(function () {});
});

async function badge(snap) {
  if (snap.err === 'auth') {
    chrome.action.setBadgeText({ text: '?' }); chrome.action.setBadgeBackgroundColor({ color: '#6b6e74' });
    chrome.action.setTitle({ title: 'Croissant\nOpen GOAL admin in Chrome to reconnect' }); return;
  }
  var live = snap.rows.filter(function (r) { return !r.snoozed; });
  var n100 = live.filter(function (r) { return r.pct >= 100; }).length;
  var n75 = live.filter(function (r) { return r.pct >= 75 && r.pct < 100; }).length;
  var nf = live.filter(isFlagged).length;
  if (n100) { chrome.action.setBadgeText({ text: String(n100) }); chrome.action.setBadgeBackgroundColor({ color: '#e2603f' }); }
  else if (nf) { chrome.action.setBadgeText({ text: '!' }); chrome.action.setBadgeBackgroundColor({ color: '#e0a93b' }); }
  else chrome.action.setBadgeText({ text: '' });
  if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ color: '#ffffff' });
  chrome.action.setTitle({ title: 'Croissant\n' + n100 + ' at 100%+ · ' + n75 + ' at 75-99% · ' + nf + ' flagged\nChecked ' + clock(new Date(snap.at)) });
}

// ---------- 5pm recap ----------
async function maybeDigest(snap, s) {
  if (!s.digest || !snap || !snap.rows) return;
  var now = new Date(), today = snap.day;
  if (localHour(now) < s.digestHour) return;
  var g = await get('digestDay'); if (g.digestDay === today) return;
  var rows = snap.rows.filter(function (r) { return !r.snoozed; });
  var spent = 0, bud = 0; rows.forEach(function (r) { spent += r.spend; bud += r.bud; });
  if (spent < 1) return;
  await set({ digestDay: today });
  var capped = rows.filter(function (r) { return r.pct >= 100; }).map(function (r) { var t = snap.capAt && snap.capAt[r.id]; return { r: r, t: t }; })
    .sort(function (a, b) { return (a.t || 0) - (b.t || 0); });
  var near = rows.filter(function (r) { return r.pct >= 75 && r.pct < 100; });
  var zero = rows.filter(function (r) { return r.flag === 'zero'; }), under = rows.filter(function (r) { return r.flag === 'under'; });
  var cv = rows.filter(function (r) { return r.cflag || r.campFlags; });
  var C = 0, L = 0, tC = 0, tL = 0; rows.forEach(function (r) { C += r.clicks; L += r.leads; if (r.tcvr != null) { tC += r.clicks; tL += r.clicks * r.tcvr / 100; } });
  var capTxt = function (x) { return short(x.r.name) + (x.t ? ' ' + clockShort(x.t) : x.t === 0 ? ' (early)' : ''); };
  var lines = [
    money0(spent) + ' of ' + money0(bud) + ' spent (' + (bud ? Math.round(spent / bud * 100) : 0) + '%)',
    capped.length + ' hit budget' + (capped.length ? ': ' + capped.slice(0, 5).map(capTxt).join(', ') + (capped.length > 5 ? ' +' + (capped.length - 5) : '') : ''),
    near.length + ' at 75-99%',
    'Flags: ' + zero.length + ' no spend, ' + under.length + ' underpacing, ' + cv.length + ' conversion drops',
    'Conv. rate ' + pc(C ? L / C * 100 : null) + (tC ? ' vs. ' + pc(tL / tC * 100) + ' normal' : '')
  ];
  notify('digest:' + Date.now(), 'Today at ' + clock(now) + ': ' + capped.length + ' at budget, ' + (zero.length + under.length + cv.length) + ' flagged', lines.join('\n'));
  var detail = [];
  if (capped.length) detail.push('*Hit budget:* ' + capped.map(function (x) { return slackLink(x.r, short(x.r.name)) + (x.t ? ' ' + clockShort(x.t) : ''); }).join(', '));
  if (zero.length) detail.push('*No spend:* ' + zero.map(function (r) { return slackLink(r, short(r.name)); }).join(', '));
  if (under.length) detail.push('*Underpacing:* ' + under.map(function (r) { return slackLink(r, short(r.name)); }).join(', '));
  if (cv.length) detail.push('*Conversion drops:* ' + cv.map(function (r) { return slackLink(r, short(r.name)); }).join(', '));
  slack(s, ':croissant: *Croissant recap, ' + clock(now) + '*\n' + lines.join('\n') + (detail.length ? '\n\n' + detail.join('\n') : ''));
}

// ---------- daily budget snapshot ----------
// Taken once per GOAL day (first check after midnight Pacific) and used for the whole day.
// Source per account, best first: this morning's pull from GOAL (budgets-source.js) > budgets captured
// when you opened that account's campaigns in GOAL > the Oct 2 snapshot in data.js.
function sumBrands(capAcct) {
  var wk = [0, 0, 0, 0, 0, 0, 0], at = 0;
  Object.keys(capAcct || {}).forEach(function (b) { var c = capAcct[b]; c.wk.forEach(function (v, i) { v = +v || 0; wk[i] = wk[i] === -1 || v === -1 || v >= 1e6 ? -1 : wk[i] + v; }); at = Math.max(at, c.at); });
  return { wk: wk, at: at };
}
// Morning job: reads every account's budgets from GOAL. Saves after each account,
// so if Chrome pauses the extension it picks up where it left off on the next check.
async function refreshLm(token, today, job, rosterIds) {
  var g = await get('lmStats'), L = g.lmStats && g.lmStats.day === today ? g.lmStats : { day: today, a: {} };
  var inRoster = {}; (rosterIds || []).forEach(function (id) { inRoster[String(id)] = 1; });
  var ids = Object.keys(job.camps || {}).filter(function (id) { return (!rosterIds.length || inRoster[id]) && (job.camps[id] || []).some(function (c) { return c.product === 'lm' && c.active; }); });
  var t0 = Date.now();
  for (var i = 0; i < ids.length && Date.now() - t0 < 60000; i++) {
    var prev = L.a[ids[i]];
    if (prev && Date.now() - prev.at < 4 * 60000) continue;
    try { L.a[ids[i]] = { at: Date.now(), c: await lmToday(token, ids[i], job.camps[ids[i]], today) }; } catch (e) { if (e.auth) throw e; }
  }
  await set({ lmStats: L });
}
async function budgetJob(token, today) {
  var st = await get(['budgetJob', 'roster']);
  var job = st.budgetJob;
  if (!job || job.day !== today || job.v !== 3) {
    var ids = (st.roster && st.roster.ids && st.roster.ids.length ? st.roster.ids : Object.keys(SEED.budgets.b)).map(String);
    job = { day: today, v: 3, started: Date.now(), total: ids.length, queue: ids, res: {}, fail: {}, done: false };
    await set({ budgetJob: job });
  } else if (st.roster && st.roster.ids) {
    // Accounts added to your active list after this morning's pull get read too.
    var missing = st.roster.ids.map(String).filter(function (id) { return !(id in job.res) && !(id in job.fail) && job.queue.indexOf(id) < 0; });
    if (missing.length) { job.queue = job.queue.concat(missing); job.total += missing.length; job.done = false; await set({ budgetJob: job }); }
  }
  var t0 = Date.now();
  while (job.queue.length && Date.now() - t0 < 4 * 60 * 1000) {
    var id = job.queue[0];
    try { var r = await pullAccountBudget(token, id); job.res[id] = r.wk; job.camps = job.camps || {}; job.camps[id] = r.campaignList; delete job.fail[id]; }
    catch (e) { if (e.auth) { await set({ budgetJob: job }); throw e; } job.fail[id] = String(e && e.message || e).slice(0, 60); }
    job.queue.shift();
    await set({ budgetJob: job });   // also keeps the worker awake during the pull
    await sleep(150);
  }
  if (!job.queue.length && !job.done) { job.done = true; job.finished = Date.now(); await set({ budgetJob: job }); }
  return job;
}
async function takeBudgetSnapshot(today, job) {
  var g = await get(['roster', 'captured']);
  var roster = g.roster || { ids: [] }, captured = g.captured || {};
  var live = job && job.day === today ? job.res : {};
  var wd = weekdayIdx(today), ids = {};
  (roster.ids || []).forEach(function (id) { ids[id] = 1; });
  Object.keys(SEED.budgets.b).forEach(function (id) { ids[id] = 1; });
  Object.keys(captured).forEach(function (id) { ids[id] = 1; });
  var out = { day: today, at: Date.now(), b: {}, src: {}, asOf: {}, why: job ? job.fail : {}, jobDone: !!(job && job.done), pulled: Object.keys(live).length, total: job ? job.total : 0 };
  Object.keys(ids).forEach(function (id) {
    if (live[id]) { out.b[id] = +live[id][wd] || 0; out.src[id] = 'live'; out.asOf[id] = today; }
    else if (captured[id]) { var c = sumBrands(captured[id]); out.b[id] = c.wk[wd]; out.src[id] = 'captured'; out.asOf[id] = dayStr(GOAL_TZ, new Date(c.at)); }
    else if (SEED.budgets.b[id]) { out.b[id] = +SEED.budgets.b[id][1][wd] || 0; out.src[id] = 'snapshot'; out.asOf[id] = SEED.budgets.asOf; }
  });
  await set({ budgetSnap: out });
  return out;
}
// Each account's weekly budgets (Sun..Sat) from the best source we have, for the patterns view.
async function weeklyBudgets() {
  var g = await get(['budgetJob', 'captured']);
  var out = {}, res = g.budgetJob && g.budgetJob.res || {}, cap = g.captured || {};
  Object.keys(SEED.budgets.b).forEach(function (id) { out[id] = SEED.budgets.b[id][1]; });
  Object.keys(cap).forEach(function (id) { out[id] = sumBrands(cap[id]).wk; });
  Object.keys(res).forEach(function (id) { out[id] = res[id]; });
  return out;
}

// Storage updates that read-modify-write go through here one at a time, so two at once can't overwrite each other.
var lock = Promise.resolve();
function serial(fn) { var p = lock.then(fn, fn); lock = p.catch(function () {}); return p; }
// Budgets seen when you open an account's campaigns in GOAL (sent by hook.js via token.js).
function onCaptured(m) { return serial(function () { return onCapturedNow(m); }); }
async function onCapturedNow(m) {
  if (!m.accountId || !Array.isArray(m.wk) || m.wk.length !== 7) return;
  var g = await get(['captured', 'budgetSnap']);
  var cap = g.captured || {}, acct = String(m.accountId), brand = String(m.brandId || 'all');
  cap[acct] = cap[acct] || {}; cap[acct][brand] = { wk: m.wk.map(Number), at: Date.now() };
  await set({ captured: cap });
  // Today's snapshot stays fixed, except an account still on the old Oct 2 numbers gets its real budget right away.
  var bs = g.budgetSnap, today = dayStr(GOAL_TZ);
  if (bs && bs.day === today && bs.src[acct] !== 'live' && bs.src[acct] !== 'captured') {
    var c = sumBrands(cap[acct]); bs.b[acct] = c.wk[weekdayIdx(today)]; bs.src[acct] = 'captured'; bs.asOf[acct] = today;
    await set({ budgetSnap: bs });
    var sp = ((await get('snap')).snap || {}).spend; if (sp) await evaluate(sp, { silent: true, reuse: true });
  }
}

// ---------- daily log, end-of-day finalize and auto-save ----------
// Keeps the latest numbers for each GOAL day, per account and per campaign, for 45 days.
// Every account with a budget is logged, even at $0, so each day's file is a full budget snapshot.
async function logDay(today, spend, camps, rows, capAt) {
  var log = (await get('dayLog')).dayLog || {};
  var a = {};
  (rows || []).forEach(function (r) { if (r.bud > 0 || r.spend > 0 || r.clicks > 0) a[r.id] = [r.name, round2(r.spend), r.clicks, r.leads, r.calls, round2(r.bud), r.budSrc || '']; });
  Object.keys(spend).forEach(function (id) { var v = spend[id]; if (!a[id] && (v.s > 0 || v.c > 0)) a[id] = [v.n || '', round2(v.s), v.c, v.l, v.k, 0, '']; });
  log[today] = { at: Date.now(), a: a, c: camps ? campCompact(camps) : null, cap: capAt || {} };
  var keep = Object.keys(log).sort().slice(-45), out = {};
  keep.forEach(function (d) { out[d] = log[d]; });
  await set({ dayLog: out });
}
// Once a day ends, swap in GOAL's final totals for that day (the last check may have been hours earlier).
async function finalizeDayLog(day, hist, campHist) {
  var log = (await get('dayLog')).dayLog || {};
  var e = log[day], h = hist && hist[day];
  if (!e || !h || e.final) return;
  Object.keys(h).forEach(function (id) {
    var v = h[id], cur = e.a[id];
    if (cur) { cur[1] = v[0]; cur[2] = v[1]; cur[3] = v[2]; cur[4] = v[3]; }
    else e.a[id] = ['', v[0], v[1], v[2], v[3], 0, ''];
  });
  Object.keys(e.a).forEach(function (id) { if (!h[id]) { e.a[id][1] = 0; e.a[id][2] = 0; e.a[id][3] = 0; e.a[id][4] = 0; } });
  if (campHist && campHist[day]) e.c = campHist[day];
  e.final = true;
  log[day] = e;
  await set({ dayLog: log });
}
async function autoSave(day) {
  var g = await get(['dayLog', 'roster']);
  if (!g.dayLog || !g.dayLog[day]) return false;
  var csv = buildPaceCsv(g.dayLog, (g.roster && g.roster.names) || {}, [day]);
  return new Promise(function (r) {
    chrome.downloads.download({ url: 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv), filename: 'GOAL Pace/goal-pace-' + day + '.csv', conflictAction: 'overwrite', saveAs: false }, function (id) { r(!!id); });
  });
}

// ---------- patterns (facts for client conversations) ----------
async function patterns() {
  var g = await get(['hist', 'dayLog', 'roster', 'snap']);
  var hist = g.hist || {}, log = g.dayLog || {}, names = (g.roster && g.roster.names) || {};
  var brands = Object.assign({}, SEED.brands, (g.roster && g.roster.brands) || {});
  var today = dayStr(GOAL_TZ), wk = await weeklyBudgets();
  var days = Object.keys(hist).sort().reverse();
  var weekdays = days.filter(function (d) { return !isWeekend(d); }).slice(0, 10);
  var lastWeek = days.filter(function (d) { return d >= addDays(today, -7); }), prevWeek = days.filter(function (d) { return d < addDays(today, -7) && d >= addDays(today, -14); });
  var ids = {};
  days.forEach(function (d) { Object.keys(hist[d]).forEach(function (id) { ids[id] = 1; }); });
  var out = [];
  Object.keys(ids).forEach(function (id) {
    var hit = 0, counted = 0, capMins = [];
    weekdays.forEach(function (d) {
      var B = log[d] && log[d].a[id] && log[d].a[id][5] || (wk[id] ? +wk[id][weekdayIdx(d)] : 0);
      if (!(B > 0)) return;
      counted++;
      var sp = hist[d][id] ? hist[d][id][0] : 0;
      if (sp >= B * 0.97) hit++;
      var t = log[d] && log[d].cap && log[d].cap[id];
      if (t) { var p = parts(LOCAL_TZ, new Date(t)); capMins.push(+p.hour * 60 + +p.minute); }
    });
    var sum = function (list) { var c = 0, l = 0; list.forEach(function (d) { var v = hist[d][id]; if (v) { c += v[1]; l += v[2]; } }); return { c: c, l: l }; };
    var A = sum(lastWeek), B2 = sum(prevWeek), trend = null;
    if (A.c >= 60 && B2.c >= 60 && B2.l > 0) {
      var a = A.l / A.c * 100, b = B2.l / B2.c * 100, ch = (a - b) / b;
      var pp = (A.l + B2.l) / (A.c + B2.c), se = Math.sqrt(pp * (1 - pp) * (1 / A.c + 1 / B2.c));
      var z = se > 0 ? (A.l / A.c - B2.l / B2.c) / se : 0;
      if (Math.abs(ch) >= 0.25 && Math.abs(z) >= 2) trend = { now: a, before: b, ch: ch };
    }
    var capTypical = null;
    if (capMins.length >= 2) { capMins.sort(function (x, y) { return x - y; }); var mm = capMins[Math.floor(capMins.length / 2)]; capTypical = ((Math.floor(mm / 60) % 12) || 12) + ':' + String(mm % 60).padStart(2, '0') + (mm < 720 ? 'am' : 'pm'); }
    if ((hit >= 3 && counted >= 3) || trend) {
      out.push({ id: id, name: names[id] || (SEED.budgets.b[id] && SEED.budgets.b[id][0]) || ('Account ' + id), url: brands[id] ? PORTAL + id + '&brand_id=' + brands[id] : null,
        hit: hit, of: counted, capTypical: capTypical, trend: trend });
    }
  });
  out.sort(function (a, b) { return (b.hit - a.hit) || (Math.abs(b.trend ? b.trend.ch : 0) - Math.abs(a.trend ? a.trend.ch : 0)); });
  return { at: Date.now(), days: weekdays.length, items: out };
}

// ---------- sources review ----------
async function prefetchReviews(token, snap) {
  var flagged = snap.rows.filter(function (r) { return (r.cflag || r.campFlags) && !r.snoozed; });
  var n = 0;
  for (var i = 0; i < flagged.length && n < 3; i++) {
    var have = (await get('review_' + flagged[i].id))['review_' + flagged[i].id];
    if (have && have.day === snap.day && Date.now() - have.at < 60 * 60000) continue;
    try { await buildReview(token, flagged[i], snap.day); n++; } catch (e) { if (e.auth) return; }
  }
}
async function reviewFor(acct, refresh) {
  var g = await get(['token', 'snap', 'review_' + acct]);
  var cached = g['review_' + acct], snap = g.snap, today = dayStr(GOAL_TZ);
  if (!refresh && cached && cached.day === today && Date.now() - cached.at < 10 * 60000) return cached;
  var row = snap && snap.rows && snap.rows.find(function (r) { return String(r.id) === String(acct); });
  if (!row) return { error: 'This account isn\'t in the latest check.' };
  if (!g.token) return { error: 'Not connected to GOAL. Open the GOAL admin dashboard once.' };
  try { return await buildReview(g.token, row, today); } catch (e) { return { error: e.auth ? 'GOAL sign-in expired. Open GOAL admin and try again.' : (e.message || String(e)) }; }
}

// ---------- the poll ----------
var busy = null, backfilling = null;
function poll(force) { if (!busy) busy = run(force).finally(function () { busy = null; }); return busy; }
async function run(force) {
  var st = await get(['token', 'roster', 'hist', 'campHist', 'histDay', 'snap', 'rolled', 'intra', 'curves', 'savedDay']);
  var token = st.token;
  if (!token) return fail('auth', st.snap);
  var now = new Date(), today = dayStr(GOAL_TZ), s = await settings();
  if (!setAm(token, s)) return fail('Couldn\'t tell which account manager is signed in. Add your Account Manager ID in Settings.', st.snap);
  try {
    var spend = await spendFor(token, today);
    var camps = null;
    try { camps = await campaignsFor(token, today); } catch (e) { if (e.auth) throw e; camps = null; }
    // Daily housekeeping: roster + brand links, then history (yesterday's final totals included).
    if (force || !st.roster || st.roster.day !== today || st.roster.v !== 2 || st.roster.am !== AM_ID) {
      try { var ro = await refreshRoster(token); ro.day = today; await set({ roster: ro }); } catch (e) { if (e.auth) throw e; }
    }
    var hist = st.hist, campHist = st.campHist;
    if (force || st.histDay !== today) {
      try { var h = await refreshHistory(token, today, st.hist, st.campHist); hist = h.hist; campHist = h.campHist; await set({ hist: hist, campHist: campHist, histDay: today }); } catch (e) { if (e.auth) throw e; }
    }
    // New day: lock in yesterday's final numbers, learn its spend rhythm, save its CSV.
    var intra = st.intra;
    if (st.rolled !== today) {
      var yday = addDays(today, -1);
      await finalizeDayLog(yday, hist, campHist);
      if (intra && intra.day !== today) { await set({ curves: finalizeCurves(st.curves, intra, hist) }); intra = null; }
      if (s.autoSave && st.savedDay !== yday) { if (await autoSave(yday)) await set({ savedDay: yday }); }
      await set({ rolled: today });
    }
    await set({ intra: recordPoint(intra, today, spend, goalMinute(now)) });
    await serial(async function () { var hg = await get('hourly'); await set({ hourly: recordHourly(hg.hourly, today, spend, now) }); });
    // Daily budget snapshot: pull every account's budgets once each GOAL day, then freeze for the day.
    var g2 = await get(['budgetSnap', 'budgetJob']);
    var job = g2.budgetJob, bs = g2.budgetSnap;
    var rosterIds = ((await get('roster')).roster || {}).ids || [];
    var jobMissing = job && job.day === today && rosterIds.some(function (id) { return !(String(id) in job.res) && !(String(id) in job.fail); });
    if (!job || job.day !== today || !job.done || jobMissing || job.v !== 3) { job = await budgetJob(token, today); bs = null; }
    // Lead Marketplace: today's spend and leads won, for accounts running a Marketplace campaign.
    try { await refreshLm(token, today, job, rosterIds); } catch (e) { if (e.auth) throw e; }
    if (!bs || bs.day !== today || !bs.jobDone) await takeBudgetSnapshot(today, job);
    var snap = await evaluate(spend, { camps: camps });
    await maybeDigest(snap, s);
    try { await checkNotes(token, snap, s); } catch (e) { if (e.auth) throw e; }
    try { await checkRecaps(token, today, s, hist); } catch (e) { if (e.auth) throw e; }
    if (localHour(now) >= s.briefHour) {
      try { await checkTouchpoints(token, today, s, hist); } catch (e) { if (e.auth) throw e; }
      try { await checkBriefing(s); } catch (e) {}
    }
    await prefetchReviews(token, snap);
    // Best hours: fill in recent days one hour at a time, two days per check, until done.
    if (!backfilling) { backfilling = (async function () { for (var bi = 0; bi < 2; bi++) { try { if (!(await serial(function () { return backfillHours(token, today, hist); }))) break; } catch (e) { break; } } })().finally(function () { backfilling = null; }); }
    return snap;
  } catch (e) {
    return fail(e.auth ? 'auth' : (e.message || String(e)), st.snap);
  }
}
async function fail(err, prev) {
  var snap = Object.assign({ rows: [], spend: {} }, prev || {}, { err: err, errAt: Date.now() });
  await set({ snap: snap });
  await badge(snap);
  if (err === 'auth') {
    var day = dayStr(GOAL_TZ), w = (await get('authWarned')).authWarned;
    if (w !== day) {
      await set({ authWarned: day });
      notify('auth:' + Date.now(), 'Croissant needs GOAL', 'Open the GOAL admin dashboard in Chrome once so alerts can resume.');
      slack(await settings(), ':croissant: Croissant lost its GOAL sign-in. Open the GOAL admin dashboard in Chrome once so alerts can resume.');
    }
  }
  return snap;
}

// ---------- wiring ----------
async function schedule() { var s = await settings(); chrome.alarms.create('poll', { periodInMinutes: Math.max(1, s.every), delayInMinutes: 0.1 }); }
chrome.runtime.onInstalled.addListener(function () { schedule(); });
chrome.runtime.onStartup.addListener(function () { schedule(); });
chrome.alarms.get('poll', function (a) { if (!a) schedule(); });   // belt and suspenders
// Self-update: when newer files are dropped into this extension's folder, reload so they take effect
// (no trip to chrome://extensions needed). Settings and history are kept.
async function selfUpdate() {
  try {
    var r = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
    var v = (await r.json()).version;
    if (v && v !== chrome.runtime.getManifest().version) chrome.runtime.reload();
  } catch (e) {}
}
selfUpdate();
// After an install or update, swap the corner panel in GOAL tabs that are already open (no refresh needed).
chrome.runtime.onInstalled.addListener(function () {
  if (!chrome.scripting) return;
  chrome.tabs.query({ url: ['https://www.admin.checkoutgoal.com/*', 'https://admin.checkoutgoal.com/*', 'https://www.portal.checkoutgoal.com/*', 'https://portal.checkoutgoal.com/*'] }, function (tabs) {
    (tabs || []).forEach(function (t) { chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['csv.js', 'popup.js', 'panel.js'] }).catch(function () {}); });
  });
});
chrome.alarms.onAlarm.addListener(function (a) { if (a.name === 'poll') { selfUpdate(); poll(); } });

chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  (async function () {
    if (msg.type === 'token') {
      var old = (await get('token')).token; await set({ token: msg.token });
      var snap = (await get('snap')).snap;
      if (msg.token !== old || !snap || snap.err === 'auth') poll();
      return reply({ ok: true });
    }
    if (msg.type === 'state') { var g = await get(['snap', 'token']); return reply({ snap: g.snap || null, settings: await settings(), hasToken: !!g.token, notes: await notesState() }); }
    if (msg.type === 'notes') { return reply(await notesState()); }
    if (msg.type === 'noteUpdate') { var nu = await noteUpdate(msg); if (msg.status === 'sent') await touchMark(msg.id, 'note'); else if (msg.status === 'ready') await touchUnmark(msg.id, 'note'); return reply(nu); }
    if (msg.type === 'checkins') { return reply(await checkinsState()); }
    if (msg.type === 'checkinUpdate') { return reply(await checkinUpdate(msg)); }
    if (msg.type === 'touch') { var tm = await touchMark(String(msg.id), msg.how || 'talked', msg.at || null); return reply({ ok: true, touch: tm }); }
    if (msg.type === 'openUrl') { var ou = String(msg.url || ''); if (ou.indexOf(chrome.runtime.getURL('')) === 0 || /^https:\/\/(www\.)?(admin|portal)\.checkoutgoal\.com\//.test(ou)) chrome.tabs.create({ url: ou }); return reply({ ok: true }); }
    if (msg.type === 'open') { if (/^(briefing|notes|review|hours|popup)\.html(\?[\w=&%.-]*)?$/.test(msg.page || '')) chrome.tabs.create({ url: chrome.runtime.getURL(msg.page) }); return reply({ ok: true }); }
    if (msg.type === 'briefing') { return reply(await buildBriefing(await settings())); }
    if (msg.type === 'recaps') { return reply(await recapsState()); }
    if (msg.type === 'reportLink') { await saveReportLink(String(msg.id), msg.url || ''); return reply(await recapUpdate({ id: msg.id, report: msg.url || '', body: msg.body })); }
    if (msg.type === 'recapUpdate') { var ru = await recapUpdate(msg); if (msg.status === 'sent') await touchMark(msg.id, 'summary'); else if (msg.status === 'ready') await touchUnmark(msg.id, 'summary'); return reply(ru); }
    if (msg.type === 'recapNow') {
      var gr = await get(['token', 'hist']); if (!gr.token) return reply({ error: 'Not connected to GOAL. Open the GOAL admin dashboard once.' });
      try { await checkRecaps(gr.token, dayStr(GOAL_TZ), await settings(), gr.hist, true); return reply(await recapsState()); } catch (e) { return reply({ error: e.auth ? 'GOAL sign-in expired. Open GOAL admin and try again.' : (e.message || String(e)) }); }
    }
    if (msg.type === 'captured') { await onCaptured(msg); return reply({ ok: true }); }
    if (msg.type === 'log') { var lg = await get(['dayLog', 'roster']); return reply({ dayLog: lg.dayLog || {}, names: (lg.roster && lg.roster.names) || {} }); }
    if (msg.type === 'patterns') { return reply(await patterns()); }
    if (msg.type === 'hours') { return reply(await hoursReport(msg.opts || { days: 28, type: 'all' })); }
    if (msg.type === 'hoursCsv') { return reply({ csv: hoursCsv(await hoursReport(msg.opts)) }); }
    if (msg.type === 'review') { return reply(await reviewFor(msg.acct, !!msg.refresh)); }
    if (msg.type === 'learn') { var L = await serial(function () { return learn(msg); }); return reply({ ok: true, write: L.write && L.write.ok }); }
    if (msg.type === 'bidState') { var bg2 = await get(['learned', 'bidLog']); var lw = bg2.learned || {}; return reply({ canWrite: !!(lw.write && lw.write.ok), canRead: !!lw.read, why: lw.write && lw.write.why || null, learnedAt: lw.at || null, log: (bg2.bidLog || []).slice(0, 50) }); }
    if (msg.type === 'applyBids') {
      var tk = (await get('token')).token;
      if (!tk) return reply({ error: 'Not connected to GOAL.' });
      var out = await applyBids(tk, msg.acct, msg.changes || []);
      var okd = (out.results || []).filter(function (x) { return x.ok; });
      if (okd.length) {
        var snapA = (await get('snap')).snap, rowA = snapA && snapA.rows.find(function (r) { return String(r.id) === String(msg.acct); });
        slack(await settings(), ':croissant: *Raised bids for ' + slackLink(rowA, rowA ? short(rowA.name) : '#' + msg.acct) + '* (you approved)\n' + okd.map(function (x) { return x.campName + ' / ' + x.name + ': ' + x.from + '% to ' + x.to + '%' + (x.verified ? '' : ' (not yet confirmed)'); }).join('\n'));
      }
      return reply(out);
    }
    if (msg.type === 'slackTest') {
      var ok = await slack(Object.assign(await settings(), { slackOn: true, slackUrl: msg.url }), ':croissant: Croissant is connected. Budget caps, flags and the 5pm recap will post here.');
      return reply({ ok: ok });
    }
    if (msg.type === 'refresh') { await poll(!!msg.force); var g2 = await get('snap'); return reply({ snap: g2.snap, settings: await settings() }); }
    if (msg.type === 'setBudget') {
      var o = (await get('over')).over || {}, td = dayStr(GOAL_TZ);
      if (msg.value === '' || msg.value == null) delete o[msg.id]; else o[msg.id] = { v: +msg.value, day: td };
      Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === 'object' && o[k].day !== td) delete o[k]; });
      await set({ over: o });
      var sp = ((await get('snap')).snap || {}).spend || {};
      return reply({ snap: await evaluate(sp, { reuse: true }) });
    }
    if (msg.type === 'snooze') {
      var z = (await get('snooze')).snooze || {}; var today = dayStr(GOAL_TZ);
      if (msg.on) z[msg.id] = today; else delete z[msg.id];
      Object.keys(z).forEach(function (k) { if (z[k] !== today) delete z[k]; });
      await set({ snooze: z });
      var sp2 = ((await get('snap')).snap || {}).spend || {};
      return reply({ snap: await evaluate(sp2, { silent: true, reuse: true }) });
    }
    if (msg.type === 'settings') {
      var cur = await settings(); var nx = Object.assign(cur, msg.settings || {});
      await set({ settings: nx }); await schedule();
      if (msg.settings && 'amId' in msg.settings) poll(true);   // switched account manager: reload the roster
      var sp3 = ((await get('snap')).snap || {}).spend || {};
      return reply({ snap: await evaluate(sp3, { silent: true, reuse: true }), settings: nx });
    }
    reply({});
  })();
  return true;
});
