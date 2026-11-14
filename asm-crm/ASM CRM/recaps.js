// Weekly client summaries: every Friday morning (by default) it drafts a short, upbeat summary email for each account that
// ran this week, covering the last 7 full days. Nothing is sent: you review, edit and send each one yourself.
//
// Positive outlook by design: every summary leads with the week's bright spots. It looks for things like more quote
// requests, a lower cost per lead, strong call volume (including a lighter day for online quotes that was carried by
// phone calls), a standout day, leads every day, or more shoppers finding the agency. Comparisons with the week before
// only appear when they're good news, and nothing is ever framed as a decline.
//
// Storage 'recaps': { week: 'YYYY-MM-DD' (last day covered), from, to, at, items: { accountId: {...same shape as a note} } }

var WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function rcDate(ds) { var a = ds.split('-'); return new Date(Date.UTC(+a[0], +a[1] - 1, +a[2])).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); }
function rcDay(ds) { var a = ds.split('-'); return WEEKDAY_NAMES[new Date(Date.UTC(+a[0], +a[1] - 1, +a[2])).getUTCDay()]; }
function rcMoney(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
function rcTot(hist, id, days) {
  var t = { s: 0, c: 0, l: 0, k: 0, days: 0, byDay: [] };
  days.forEach(function (d) {
    var v = hist[d] && hist[d][id]; if (!v) { t.byDay.push({ d: d, s: 0, c: 0, l: 0, k: 0 }); return; }
    var a = Array.isArray(v) ? v : [v, 0, 0, 0];
    var x = { d: d, s: +a[0] || 0, c: +a[1] || 0, l: +a[2] || 0, k: +a[3] || 0 };
    t.s += x.s; t.c += x.c; t.l += x.l; t.k += x.k; if (x.s > 0) t.days++;
    t.byDay.push(x);
  });
  return t;
}
function rcPlural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
function rcCap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

// The week's bright spots, strongest first. Each: { key, score, open (opening sentence), extra (optional paragraph) }
function recapHighlights(w, p) {
  var H = [], rate = w.c ? w.l / w.c : 0, prate = p && p.c ? p.l / p.c : 0;
  var norm = prate > 0 && p.c >= 50 ? prate : rate;            // what a normal day converts at
  var cpl = w.l > 0 ? w.s / w.l : null, pcpl = p && p.l > 0 ? p.s / p.l : null;
  if (p && p.l >= 5 && w.l >= p.l * 1.1) H.push({ key: 'leadsUp', score: 90 + Math.min(20, (w.l / p.l - 1) * 50), open: 'Nice week: quote requests were up ' + Math.round((w.l / p.l - 1) * 100) + '% from the week before.' });
  if (cpl && pcpl && p.l >= 5 && w.l >= 5 && cpl <= pcpl * 0.9) H.push({ key: 'cplDown', score: 85, open: 'Nice week: your cost per lead came down ' + Math.round((1 - cpl / pcpl) * 100) + '%, so your budget is working harder.' });
  if (p && w.c >= 50 && p.c >= 50 && w.l >= 5 && rate >= prate * 1.15 && prate > 0) H.push({ key: 'cvrUp', score: 75, open: 'More of your visitors are turning into quote requests: ' + Math.round(rate * 1000) / 10 + '% of clicks this week, up from ' + Math.round(prate * 1000) / 10 + '%.' });
  if (w.k >= 3) H.push({ key: 'calls', score: 60 + Math.min(25, w.k * 3), open: 'Great week for phone calls: ' + w.k + ' prospects called you directly, and callers are the highest-intent leads there are.' });
  // A lighter day for online quotes that phone calls carried.
  var saved = w.byDay.filter(function (d) { return d.k >= 2 && d.c >= 5 && (d.c ? d.l / d.c : 0) < norm * 0.7; }).sort(function (a, b) { return b.k - a.k; })[0];
  if (saved) H.push({ key: 'callDay', score: 65 + saved.k * 2, open: rcDay(saved.d) + ' was a lighter day for online quotes, but ' + saved.k + ' prospects picked up the phone and called you directly. That\'s great to see, since callers are ready to talk right now.' });
  var strong = w.byDay.filter(function (d) { return d.l >= 3 && d.c >= 8 && norm > 0 && d.l / d.c >= norm * 1.5; }).sort(function (a, b) { return b.l / b.c - a.l / a.c; })[0];
  if (strong) H.push({ key: 'strongDay', score: 50, open: rcDay(strong.d) + ' was a standout: ' + rcPlural(strong.l, 'shopper', 'shoppers') + ' requested a quote out of ' + strong.c + ' who clicked.' });
  var active = w.byDay.filter(function (d) { return d.s > 0; }), withLeads = active.filter(function (d) { return d.l + d.k > 0; });
  if (active.length >= 5 && withLeads.length === active.length) H.push({ key: 'everyDay', score: 55, open: 'Prospects reached out every single day your campaign ran this week.' });
  if (p && w.c >= 50 && p.c >= 30 && w.c >= p.c * 1.15) H.push({ key: 'clicksUp', score: 45, open: 'More shoppers found you this week: ' + w.c + ' clicked through to your agency, up ' + Math.round((w.c / p.c - 1) * 100) + '%.' });
  H.sort(function (a, b) { return b.score - a.score; });
  return H;
}

// The account's reporting site: your saved link first, then the built-in list, then a name match.
function reportLinkFor(id, name, saved) {
  if (saved && Object.prototype.hasOwnProperty.call(saved, id)) return saved[id] || null;
  if (self.REPORT_LINKS && self.REPORT_LINKS[id]) return self.REPORT_LINKS[id];
  var n = String(name || '').toLowerCase(), hit = (self.REPORT_LINK_NAMES || []).find(function (p) { return n.indexOf(p[0]) >= 0; });
  return hit ? hit[1] : null;
}
var REPORT_LINE = 'Your full performance reports are here anytime: ';
// x: { first, wk, prev, bestHours, from, to, report }
function recapDraft(x, s) {
  var w = x.wk, p = x.prev, sig = (s.noteSig || '').trim();
  var cpl = w.l > 0 ? w.s / w.l : null, pcpl = p && p.l > 0 ? p.s / p.l : null;
  var H = recapHighlights(w, p), has = function (k) { return H.some(function (h) { return h.key === k; }); };
  var paras = [];
  var solid = function () { var p2 = [rcPlural(w.l, 'quote request', 'quote requests')]; if (w.k) p2.push(rcPlural(w.k, 'phone call', 'phone calls')); return 'Another solid week: ' + p2.join(' and ') + ' came in from shoppers looking for coverage.'; };
  if (H.length && H[0].score < 60 && w.l + w.k > 0) {
    paras.push(solid()); paras.push(H[0].open);
  } else if (H.length) {
    paras.push(H[0].open);
    var second = H.slice(1).find(function (h) { return (h.key === 'callDay' || h.key === 'strongDay' || h.key === 'everyDay') && !(h.key === 'callDay' && H[0].key === 'calls'); });
    if (second) paras.push(second.open);
  } else if (w.l + w.k > 0) {
    paras.push(solid());
  } else {
    paras.push('Your campaign kept you in front of shoppers this week: ' + rcPlural(w.c, 'person', 'people') + ' clicked through to learn about your agency.');
  }
  var li = [];
  if (w.l + w.k > 0) li.push(rcPlural(w.l, 'quote request', 'quote requests') + (has('leadsUp') ? ' (up from ' + p.l + ')' : ''));
  if (w.k > 0) li.push(rcPlural(w.k, 'inbound call', 'inbound calls') + (p && w.k > p.k && w.k >= 2 ? ' (up from ' + p.k + ')' : ''));
  if (has('clicksUp') || w.l + w.k === 0) li.push(rcPlural(w.c, 'shopper', 'shoppers') + ' clicked through to your agency');
  var showCpl = cpl && (!pcpl || cpl <= pcpl * 1.05);
  li.push(rcMoney(w.s) + ' in ad spend' + (showCpl ? ', ' + rcMoney(cpl) + ' per lead' + (has('cplDown') ? ' (down from ' + rcMoney(pcpl) + ')' : '') : ''));
  var best = w.byDay.slice().sort(function (a, b) { return (b.l + b.k) - (a.l + a.k); })[0], avgDay = (w.l + w.k) / 7;
  if (best && best.l + best.k >= 3 && best.l + best.k >= avgDay * 1.5) li.push('Busiest day: ' + rcDay(best.d) + ', with ' + rcPlural(best.l, 'quote request', 'quote requests') + (best.k ? ' and ' + rcPlural(best.k, 'call', 'calls') : ''));
  if (x.bestHours) li.push('Prospects tend to convert best ' + x.bestHours + ', so that\'s a great window to have someone ready on the phones');
  var subject = (H.length && H[0].score >= 60 ? 'Nice week on your campaign' : 'Your campaign this week') + ' (' + rcDate(x.from) + ' to ' + rcDate(x.to) + ')';
  var body = ['Hi ' + (x.first || 'there') + ',', ''].concat(paras.reduce(function (a, t) { return a.concat([t, '']); }, []))
    .concat(['Last 7 days (' + rcDate(x.from) + ' to ' + rcDate(x.to) + '):'])
    .concat(li.map(function (t) { return '- ' + t; }))
    .concat(x.report ? ['', REPORT_LINE + x.report] : [])
    .concat(['', 'Have a great weekend, and let me know if you\'d like to talk through anything.']).concat(sig ? ['', sig] : []).join('\n');
  return { subject: subject, body: body, good: !!(H.length && H[0].score >= 60), highlights: H.map(function (h) { return h.key; }) };
}

// Called after each check. Builds the week's recaps once, on the chosen day after the chosen hour (Central).
async function checkRecaps(token, today, s, hist, force) {
  if (!s.recapOn && !force) return null;
  var p = parts(LOCAL_TZ);
  var wd = WEEKDAY_NAMES.map(function (n) { return n.slice(0, 3); }).indexOf(p.weekday);
  if (!force && (wd !== s.recapDay || +p.hour < s.recapHour)) return null;
  var to = addDays(today, -1), from = addDays(today, -7);
  var g = await get(['recaps', 'hourly', 'snap', 'roster', 'reportLinks']);
  if (!force && g.recaps && g.recaps.week === to) return null;
  if (!hist || !hist[to]) return null;   // yesterday's final numbers not in yet
  var days = [], prevDays = [];
  for (var i = 7; i >= 1; i--) days.push(addDays(today, -i));
  for (var j = 14; j >= 8; j--) prevDays.push(addDays(today, -j));
  var ids = {};
  days.forEach(function (d) { Object.keys(hist[d] || {}).forEach(function (id) { ids[id] = 1; }); });
  var names = (g.roster && g.roster.names) || {}, rows = (g.snap && g.snap.rows) || [];
  var H = g.hourly, todayLocal = hLocal(Date.now()).day;
  var R = { week: to, from: from, to: to, at: Date.now(), items: {} };
  var list = Object.keys(ids);
  for (var k = 0; k < list.length; k++) {
    var id = list[k], wk = rcTot(hist, id, days);
    if (wk.s < 1 && wk.c === 0) continue;   // campaign didn't run this week
    var hasPrev = prevDays.every(function (d) { return hist[d]; });
    var prev = hasPrev ? rcTot(hist, id, prevDays) : null;
    if (s.recapOnlyGood) { var probe = recapDraft({ wk: wk, prev: prev, from: from, to: to }, s); if (!probe.good) continue; }
    var bh = null;
    if (H) { var hr = hoursFor(H, id, { days: 28, type: 'all' }, todayLocal); if (hr.enough && hr.best) bh = hr.best.windows; }
    var row = rows.find(function (r) { return String(r.id) === String(id); });
    var ct = null;
    try { ct = await ownerContact(token, id); } catch (e) { if (e.auth) throw e; }
    var x = { id: id, name: (row && row.name) || names[id] || ('Account ' + id), url: row && row.url, kind: 'recap', at: Date.now(), wk: { s: round2(wk.s), c: wk.c, l: wk.l, k: wk.k }, prev: prev ? { s: round2(prev.s), c: prev.c, l: prev.l, k: prev.k } : null,
      to: ct ? ct.email : '', first: ct ? ct.first : null, status: 'ready', from: from, toDay: to };
    x.report = reportLinkFor(id, x.name, g.reportLinks);
    var d = recapDraft({ first: x.first, wk: wk, prev: prev, bestHours: bh, from: from, to: to, report: x.report }, s);
    x.subject = d.subject; x.body = d.body; x.good = d.good; x.highlights = d.highlights;
    R.items[id] = x;
  }
  await set({ recaps: R });
  var n = Object.keys(R.items).length;
  if (n) notify('recap:' + Date.now(), 'Weekly client summaries are ready', rcPlural(n, 'account', 'accounts') + ', ' + rcDate(from) + ' to ' + rcDate(to) + '. Click to review and send.');
  return R;
}
async function recapsState() {
  var g = await get(['recaps', 'settings']), R = g.recaps || { items: {} };
  var items = Object.keys(R.items || {}).map(function (k) { return R.items[k]; })
    .sort(function (a, b) { return (a.status === 'ready' ? 0 : 1) - (b.status === 'ready' ? 0 : 1) || (b.good ? 1 : 0) - (a.good ? 1 : 0) || a.name.localeCompare(b.name); });
  return { week: R.week || null, from: R.from, to: R.to, items: items, mailFrom: ((g.settings || {}).noteFrom || '') };
}
async function recapUpdate(m) {
  return serial(async function () {
    var g = await get('recaps'), R = g.recaps; if (!R || !R.items[m.id]) return { error: 'Recap not found.' };
    var x = R.items[m.id];
    ['to', 'subject', 'body'].forEach(function (k) { if (typeof m[k] === 'string') x[k] = m[k]; });
    if (typeof m.report === 'string') x.report = m.report.trim() || null;
    if (m.status) { x.status = m.status; x.statusAt = Date.now(); }
    await set({ recaps: R });
    return { ok: true, item: x };
  });
}

// Saves an account's reporting site for this and future summaries ('' = this account has none).
async function saveReportLink(id, url) {
  return serial(async function () {
    var g = await get('reportLinks'), L = g.reportLinks || {};
    L[id] = (url || '').trim();
    await set({ reportLinks: L });
    return L[id];
  });
}
