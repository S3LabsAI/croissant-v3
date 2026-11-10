// Morning briefing: one page at 8am Central (adjustable) with what needs you today.
// Yesterday's results, who hit budget and when, today's flags, accounts on track to hit budget early, client notes and
// check-ins waiting, accounts due for a touchpoint, and recent bid changes from the Sources review.

async function buildBriefing(s) {
  var g = await get(['snap', 'dayLog', 'hist', 'touch', 'notes', 'checkins', 'recaps', 'bidLog', 'roster']);
  var snap = g.snap || { rows: [] }, today = snap.day || dayStr(GOAL_TZ), yday = addDays(today, -1);
  var names = Object.assign({}, (g.roster && g.roster.names) || {});
  (snap.rows || []).forEach(function (r) { names[r.id] = r.name; });
  var urlOf = function (id) { var r = (snap.rows || []).find(function (x) { return String(x.id) === String(id); }); return r && r.url; };
  var out = { at: Date.now(), day: today, yday: yday };
  // Yesterday
  var L = g.dayLog && g.dayLog[yday], h = g.hist && g.hist[yday];
  var Y = { spend: 0, clicks: 0, leads: 0, calls: 0, capped: [], accounts: 0 };
  if (h) Object.keys(h).forEach(function (id) { var v = h[id]; Y.spend += +v[0] || 0; Y.clicks += +v[1] || 0; Y.leads += +v[2] || 0; Y.calls += +v[3] || 0; if (+v[0] > 0) Y.accounts++; });
  else if (L) Object.keys(L.a).forEach(function (id) { var v = L.a[id]; Y.spend += v[1]; Y.clicks += v[2]; Y.leads += v[3]; Y.calls += v[4]; if (v[1] > 0) Y.accounts++; });
  if (L && L.cap) Object.keys(L.cap).forEach(function (id) { Y.capped.push({ id: id, name: (L.a[id] && L.a[id][0]) || names[id] || ('Account ' + id), at: L.cap[id] || null, url: urlOf(id) }); });
  Y.capped.sort(function (a, b) { return (a.at || 9e15) - (b.at || 9e15); });
  // Bright spots yesterday: most calls, most leads
  var tops = h ? Object.keys(h).map(function (id) { return { id: id, name: names[id] || ('Account ' + id), l: +h[id][2] || 0, k: +h[id][3] || 0, url: urlOf(id) }; }) : [];
  Y.topCalls = tops.filter(function (x) { return x.k >= 2; }).sort(function (a, b) { return b.k - a.k; }).slice(0, 5);
  Y.topLeads = tops.filter(function (x) { return x.l >= 3; }).sort(function (a, b) { return b.l - a.l; }).slice(0, 5);
  Y.spend = round2(Y.spend);
  out.yesterday = Y;
  // Today so far
  var rows = (snap.rows || []).filter(function (r) { return !r.snoozed; });
  out.flags = [];
  rows.forEach(function (r) {
    if (r.flag === 'zero') out.flags.push({ id: r.id, name: r.name, url: r.url, kind: 'zero', text: 'No spend yet today' });
    if (r.flag === 'under') out.flags.push({ id: r.id, name: r.name, url: r.url, kind: 'under', text: 'Behind its normal pace' });
    if (r.cflag === 'nolead') out.flags.push({ id: r.id, name: r.name, url: r.url, kind: 'cvr', text: 'No leads in the last ' + r.run + ' clicks', sources: true });
    else if (r.cflag || r.campFlags) out.flags.push({ id: r.id, name: r.name, url: r.url, kind: 'cvr', text: 'Conversion rate down', sources: true });
  });
  out.early = rows.filter(function (r) { return r.capAt && r.pct < 100 && localHour(new Date(r.capAt)) < 12; })
    .map(function (r) { return { id: r.id, name: r.name, url: r.url, capAt: r.capAt, pct: r.pct }; }).sort(function (a, b) { return a.capAt - b.capAt; });
  out.today = { spend: round2(rows.reduce(function (a, r) { return a + (r.spend || 0); }, 0)), budget: round2(rows.reduce(function (a, r) { return a + (r.bud || 0); }, 0)), accounts: rows.length, at: snap.at || null };
  // Client work waiting
  var ready = function (c, day) { return c && (!day || c.day === day) ? Object.keys(c.items || {}).filter(function (k) { return c.items[k].status === 'ready'; }).length : 0; };
  out.waiting = { notes: ready(g.notes, today), checkins: ready(g.checkins, today), summaries: ready(g.recaps), summariesWeek: g.recaps ? g.recaps.to : null };
  out.due = touchQuiet(g.touch, g.hist, today, names).filter(function (q) { return q.days >= s.quietDays; }).slice(0, 12)
    .map(function (q) { q.url = urlOf(q.id); return q; });
  out.touchSince = g.touch ? g.touch.since : null;
  out.bids = (g.bidLog || []).filter(function (e) { return Date.now() - e.at < 8 * 86400000; }).slice(0, 10);
  return out;
}
async function checkBriefing(s) {
  if (!s.briefOn) return null;
  if (localHour(new Date()) < s.briefHour) return null;
  var today = dayStr(LOCAL_TZ), g = await get('briefDay');
  if (g.briefDay === today) return null;
  await set({ briefDay: today });
  var b = await buildBriefing(s), bits = [];
  if (b.yesterday.capped.length) bits.push(b.yesterday.capped.length + ' hit budget yesterday');
  if (b.flags.length) bits.push(b.flags.length + ' flagged');
  var w = b.waiting.notes + b.waiting.checkins + b.waiting.summaries;
  if (w) bits.push(w + ' client email' + (w === 1 ? '' : 's') + ' ready');
  if (b.due.length) bits.push(b.due.length + ' due for a touchpoint');
  notify('brief:' + Date.now(), 'Good morning. Your briefing is ready', (bits.length ? bits.join(', ') : 'All quiet so far') + '. Yesterday: ' + b.yesterday.leads + ' leads, ' + b.yesterday.calls + ' calls.');
  return b;
}
