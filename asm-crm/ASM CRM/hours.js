// Best hours: which hours of the day (your Central clock) each account converts best.
// Insight only. Nothing here changes anything in GOAL.
//
// Data comes from two places:
// 1) Backfill: GOAL's analytics asked one hour at a time for recent days (about 24 small requests per day, a day or two per
//    check, so it fills in over an hour or so in the background). The first day is checked against GOAL's daily totals;
//    if the hourly numbers don't add up, backfill stops and only live data is used.
// 2) Live: every check, the change since the previous check is credited to the hours it happened in.
//
// Storage 'hourly': { days: { 'YYYY-MM-DD' (Central date): { accountId: [[spend, clicks, leads, calls] x 24] } },
//                     cov:  { 'YYYY-MM-DD': [minutes covered x 24] }, last: {at, goalDay, v}, bf: {...} }

var HOURS_KEEP = 35, HOURS_BACKFILL = 28, HOURS_MAX_GAP = 180;

function hEmpty() { var a = []; for (var i = 0; i < 24; i++) a.push([0, 0, 0, 0]); return a; }
function hLocal(t) { var p = parts(LOCAL_TZ, new Date(t)); return { day: p.year + '-' + p.month + '-' + p.day, hour: +p.hour, minute: +p.minute }; }
function hAdd(H, day, id, hour, v, w) {
  var D = H.days[day] = H.days[day] || {};
  var a = D[id] = D[id] || hEmpty();
  var b = a[hour];
  b[0] = round2(b[0] + v.s * w); b[1] += v.c * w; b[2] += v.l * w; b[3] += v.k * w;
}
// Split [t0, t1] into per-Central-hour pieces: [{day, hour, min}]
function hSlices(t0, t1) {
  var out = [], t = t0;
  while (t < t1) {
    var L = hLocal(t), next = Math.min(t1, t + (60 - L.minute) * 60000 - (t % 60000));
    if (next <= t) next = Math.min(t1, t + 60000);
    out.push({ day: L.day, hour: L.hour, min: (next - t) / 60000 });
    t = next;
  }
  return out;
}
function hPrune(H) {
  var keep = Object.keys(H.days).sort().slice(-HOURS_KEEP), k = {};
  keep.forEach(function (d) { k[d] = 1; });
  Object.keys(H.days).forEach(function (d) { if (!k[d]) { delete H.days[d]; delete H.cov[d]; } });
}

// Live: credit what happened since the last check to the hours it happened in.
function recordHourly(H, goalDay, spend, now) {
  H = H || {}; H.days = H.days || {}; H.cov = H.cov || {};
  var t1 = now.getTime(), last = H.last;
  var cur = {};
  Object.keys(spend).forEach(function (id) { var v = spend[id]; cur[id] = { s: +v.s || 0, c: +v.c || 0, l: +v.l || 0, k: +v.k || 0 }; });
  if (last && t1 > last.at) {
    var newDay = last.goalDay !== goalDay;
    // On a new GOAL day the counters restarted at midnight Pacific.
    var t0 = newDay ? Math.max(last.at, t1 - goalMinute(now) * 60000) : last.at;
    var gap = (t1 - t0) / 60000;
    if (gap > 0 && gap <= HOURS_MAX_GAP) {
      var sl = hSlices(t0, t1), tot = sl.reduce(function (a, x) { return a + x.min; }, 0);
      Object.keys(cur).forEach(function (id) {
        var p = newDay ? null : last.v[id], c = cur[id];
        var d = { s: Math.max(0, c.s - (p ? p.s : 0)), c: Math.max(0, c.c - (p ? p.c : 0)), l: Math.max(0, c.l - (p ? p.l : 0)), k: Math.max(0, c.k - (p ? p.k : 0)) };
        if (!(d.s || d.c || d.l || d.k)) return;
        sl.forEach(function (x) { if (!(H.bf && H.bf.days && H.bf.days[x.day + ':' + x.hour])) hAdd(H, x.day, id, x.hour, d, x.min / tot); });
      });
      sl.forEach(function (x) { var cv = H.cov[x.day] = H.cov[x.day] || new Array(24).fill(0); cv[x.hour] = Math.min(60, cv[x.hour] + x.min); });
    }
  }
  H.last = { at: t1, goalDay: goalDay, v: cur };
  hPrune(H);
  return H;
}

// Backfill one GOAL day per call (24 one-hour requests). Returns true if it did any work.
async function backfillHours(token, today, hist) {
  var H = (await get('hourly')).hourly || { days: {}, cov: {} };
  H.days = H.days || {}; H.cov = H.cov || {};
  var bf = H.bf = H.bf || { done: false, next: 1, ok: null, days: {} };
  if (bf.done || bf.ok === false) return false;
  if (bf.next > HOURS_BACKFILL) { bf.done = true; await set({ hourly: H }); return false; }
  var gd = addDays(today, -bf.next), r = range(gd), start = Date.parse(r[0]);
  var dayTot = {}, slices = [];
  for (var h = 0; h < 24; h++) {
    var a = new Date(start + h * 3600000).toISOString(), b = new Date(start + (h + 1) * 3600000 - 1).toISOString();
    var body = analyticsBody(gd, ['account_id']); body.start_date = a; body.end_date = b;
    var j = await call(token, 'POST', '/api/v2/admin_analytics/quote_funnels', body);
    var L = hLocal(start + h * 3600000), m = {};
    (j.data || []).forEach(function (x) { var v = metrics(x); if (v.s || v.c || v.l || v.k) { m[x.account_id] = v; var t = dayTot[x.account_id] = dayTot[x.account_id] || { s: 0, c: 0 }; t.s += v.s; t.c += v.c; } });
    slices.push({ day: L.day, hour: L.hour, m: m });
    await sleep(250);
  }
  // First day: the 24 hours must add up to GOAL's own total for that day. If GOAL ignored the hour bounds, each hour
  // would repeat the full day and the sum would be about 24x too big.
  if (bf.ok == null) {
    var hd = hist && hist[gd], bad = 0, checked = 0;
    if (hd) Object.keys(hd).forEach(function (id) {
      var want = Array.isArray(hd[id]) ? hd[id][0] : hd[id]; if (!(want > 20)) return;
      checked++; var got = dayTot[id] ? dayTot[id].s : 0;
      if (Math.abs(got - want) > Math.max(3, want * 0.03)) bad++;
    });
    if (!checked || bad > checked * 0.1) { bf.ok = false; bf.why = checked ? 'hourly totals did not match the daily totals' : 'no daily totals to check against'; await set({ hourly: H }); return false; }
    bf.ok = true;
  }
  slices.forEach(function (x) {
    var key = x.day + ':' + x.hour;
    if (H.cov[x.day] && H.cov[x.day][x.hour] >= 55) return;   // live data already covers this hour
    if (H.days[x.day]) Object.keys(H.days[x.day]).forEach(function (id) { H.days[x.day][id][x.hour] = [0, 0, 0, 0]; });
    Object.keys(x.m).forEach(function (id) { hAdd(H, x.day, id, x.hour, x.m[id], 1); });
    var cv = H.cov[x.day] = H.cov[x.day] || new Array(24).fill(0); cv[x.hour] = 60;
    bf.days[key] = 1;
  });
  bf.next++;
  if (bf.next > HOURS_BACKFILL) bf.done = true;
  bf.at = Date.now();
  hPrune(H);
  await set({ hourly: H });
  return true;
}

// ---------- the report ----------
function hWindows(hrs) {   // [9,10,11,15] -> [[9,12],[15,16]]
  var out = [];
  hrs.slice().sort(function (a, b) { return a - b; }).forEach(function (h) { var w = out[out.length - 1]; if (w && w[1] === h) w[1] = h + 1; else out.push([h, h + 1]); });
  return out;
}
function hLabel(h) { h = h % 24; return h === 0 ? '12am' : h < 12 ? h + 'am' : h === 12 ? '12pm' : (h - 12) + 'pm'; }
function hWinText(ws) { return ws.map(function (w) { return w[1] - w[0] === 1 ? hLabel(w[0]) + ' hour' : hLabel(w[0]) + ' to ' + hLabel(w[1]); }).join(', '); }

// opts: { days: 14|28, type: 'all'|'wkday'|'wkend' }
function hoursFor(H, id, opts, todayLocal) {
  var days = Object.keys(H.days || {}).filter(function (d) {
    if (d >= todayLocal) return false;   // finished days only
    if (d < addDays(todayLocal, -opts.days)) return false;
    if (opts.type === 'wkday' && isWeekend(d)) return false;
    if (opts.type === 'wkend' && !isWeekend(d)) return false;
    var cv = H.cov[d]; return cv && cv.reduce(function (a, b) { return a + b; }, 0) >= 600;   // at least 10 hours seen
  });
  var hr = hEmpty(), n = 0;
  days.forEach(function (d) {
    var ids = id === 'all' ? Object.keys(H.days[d]) : [id];
    var any = false;
    ids.forEach(function (k) { var a = H.days[d][k]; if (!a) return; any = true; for (var h = 0; h < 24; h++) for (var j = 0; j < 4; j++) hr[h][j] += a[h][j]; });
    if (any) n++;
  });
  var C = 0, Lt = 0, S = 0;
  hr.forEach(function (b) { S += b[0]; C += b[1]; Lt += b[2]; });
  var p = C ? Lt / C : 0;
  var rows = hr.map(function (b, h) {
    var c = b[1], l = b[2], rate = c ? l / c : null, z = null, mark = null;
    if (c >= 30 && p > 0 && p < 1) {
      z = (l - c * p) / Math.sqrt(c * p * (1 - p));
      // 3 standard errors: with ~15 active hours across ~65 accounts, about 1 hour portfolio-wide gets marked by chance.
      if (z >= 3 && rate >= p * 1.2) mark = 'best';
      else if (z <= -3 && rate <= p * 0.8) mark = 'weak';
    }
    return { h: h, s: round2(b[0]), c: Math.round(c), l: Math.round(l * 10) / 10, k: Math.round(b[3] * 10) / 10, rate: rate, cpl: l >= 1 ? b[0] / l : null, share: S ? b[0] / S : 0, z: z, mark: mark, low: c < 30 };
  });
  var best = rows.filter(function (r) { return r.mark === 'best'; }), weak = rows.filter(function (r) { return r.mark === 'weak'; });
  var sum = function (rs) { var c = 0, l = 0, s = 0; rs.forEach(function (r) { c += r.c; l += r.l; s += r.s; }); return { c: c, l: l, s: s, rate: c ? l / c : null, cpl: l ? s / l : null, share: S ? s / S : 0 }; };
  return { id: id, days: n, s: round2(S), c: C, l: Math.round(Lt), rate: C ? p : null, cpl: Lt ? S / Lt : null, rows: rows,
    best: best.length ? Object.assign(sum(best), { windows: hWinText(hWindows(best.map(function (r) { return r.h; }))) }) : null,
    weak: weak.length ? Object.assign(sum(weak), { windows: hWinText(hWindows(weak.map(function (r) { return r.h; }))) }) : null,
    enough: n >= 7 && C >= 200 };
}
async function hoursReport(opts) {
  var g = await get(['hourly', 'roster', 'snap']);
  var H = g.hourly || { days: {}, cov: {} }, names = (g.roster && g.roster.names) || {}, todayLocal = hLocal(Date.now()).day;
  var ids = {};
  Object.keys(H.days || {}).forEach(function (d) { Object.keys(H.days[d]).forEach(function (id) { ids[id] = 1; }); });
  var nameOf = function (id) { var r = g.snap && g.snap.rows && g.snap.rows.find(function (x) { return String(x.id) === String(id); }); return (r && r.name) || names[id] || ('Account ' + id); };
  var urlOf = function (id) { var r = g.snap && g.snap.rows && g.snap.rows.find(function (x) { return String(x.id) === String(id); }); return r && r.url; };
  var accounts = Object.keys(ids).map(function (id) { var x = hoursFor(H, id, opts, todayLocal); x.name = nameOf(id); x.url = urlOf(id); delete x.rows; return x; })
    .filter(function (x) { return x.c > 0; })
    .sort(function (a, b) { return (b.enough - a.enough) || ((b.best ? 1 : 0) - (a.best ? 1 : 0)) || (b.c - a.c); });
  var detail = opts.id ? hoursFor(H, opts.id, opts, todayLocal) : null;
  if (detail) { detail.name = opts.id === 'all' ? 'All accounts' : nameOf(opts.id); detail.url = urlOf(opts.id); }
  var bf = H.bf || {};
  return { at: Date.now(), opts: opts, accounts: accounts, all: hoursFor(H, 'all', opts, todayLocal), detail: detail,
    backfill: { done: !!bf.done, ok: bf.ok, why: bf.why || null, daysDone: Math.max(0, (bf.next || 1) - 1), of: HOURS_BACKFILL },
    liveDays: Object.keys(H.cov || {}).length };
}
function hoursCsv(rep) {
  var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var lines = [['Account', 'Hour (your time)', 'Spend', 'Clicks', 'Leads', 'Calls', 'Conv. rate %', 'Cost per lead', 'Share of spend %', 'Mark'].join(',')];
  var d = rep.detail; if (!d) return lines.join('\n');
  d.rows.forEach(function (r) { lines.push([q(d.name), hLabel(r.h), r.s.toFixed(2), r.c, r.l, r.k, r.rate == null ? '' : (r.rate * 100).toFixed(1), r.cpl == null ? '' : r.cpl.toFixed(2), (r.share * 100).toFixed(1), r.mark || ''].join(',')); });
  return lines.join('\n');
}
