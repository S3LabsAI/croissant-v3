// Touchpoints: makes sure no client goes quiet. It remembers the last time each account heard from you (a client note,
// weekly summary or check-in you opened to send, or a conversation you mark yourself). When an active account reaches
// 14 days (adjustable) with no contact, it drafts a short, upbeat check-in for you to send. Nothing is sent automatically.
//
// Storage 'touch': { since: timestamp tracking began, a: { accountId: { at, how } } }
// Storage 'checkins': { day, items: { accountId: {...note shape, kind: 'checkin'} } }

async function touchMark(id, how, at) {
  return serial(async function () {
    var g = await get('touch'), T = g.touch || { since: Date.now(), a: {} };
    T.a = T.a || {};
    var t = at || Date.now();
    if (!T.a[id] || T.a[id].at <= t) T.a[id] = { at: t, how: how };
    await set({ touch: T });
    return T.a[id];
  });
}
async function touchUnmark(id, how) {
  return serial(async function () {
    var g = await get('touch'), T = g.touch; if (!T || !T.a || !T.a[id] || T.a[id].how !== how) return;
    delete T.a[id]; await set({ touch: T });
  });
}
// Days since each active account last heard from you. Active = spent in the last 7 days.
function touchQuiet(T, hist, today, names) {
  var ids = {}, out = [];
  for (var i = 1; i <= 7; i++) { var d = hist && hist[addDays(today, -i)]; if (d) Object.keys(d).forEach(function (id) { var v = d[id]; if ((Array.isArray(v) ? v[0] : v) > 0) ids[id] = 1; }); }
  var since = (T && T.since) || Date.now();
  Object.keys(ids).forEach(function (id) {
    var t = T && T.a && T.a[id], last = t ? t.at : since;
    out.push({ id: id, name: names[id] || ('Account ' + id), last: t ? t.at : null, how: t ? t.how : null, days: Math.floor((Date.now() - last) / 86400000) });
  });
  return out.sort(function (a, b) { return b.days - a.days; });
}
function checkinDraft(x, s) {
  var w = x.wk, p = x.prev, sig = (s.noteSig || '').trim();
  var H = recapHighlights(w, p), vol;
  if (w.l + w.k > 0) vol = 'Over the past week, ' + rcPlural(w.l, 'quote request', 'quote requests') + (w.k ? ' and ' + rcPlural(w.k, 'phone call', 'phone calls') : '') + ' came in from shoppers looking for coverage.';
  else vol = 'Over the past week, ' + rcPlural(w.c, 'shopper', 'shoppers') + ' clicked through to learn about your agency.';
  var hi = H.length ? H[0].open.replace(/^Nice week: /, 'Nice to see: ').replace(/this week/g, 'this past week') : null;
  var body = ['Hi ' + (x.first || 'there') + ',', '', 'Just checking in on your campaign. ' + vol]
    .concat(hi ? ['', hi] : [])
    .concat(['', 'Is there anything you\'d like us to focus on, or anything you\'re hearing from the leads coming in? Always happy to hop on a quick call.']).concat(sig ? ['', sig] : []).join('\n');
  return { subject: 'Checking in on your campaign', body: body };
}
// Once a day (with the morning briefing), draft check-ins for the accounts that have gone quiet longest.
async function checkTouchpoints(token, today, s, hist, force) {
  if (!s.touchOn && !force) return [];
  var g = await get(['touch', 'checkins', 'roster', 'snap', 'notes', 'recaps']);
  var T = g.touch;
  if (!T) { T = { since: Date.now(), a: {} }; await set({ touch: T }); }
  var C = g.checkins && g.checkins.day === today ? g.checkins : { day: today, items: {} };
  if (g.checkins && g.checkins.day !== today) Object.keys(g.checkins.items || {}).forEach(function (id) { var it = g.checkins.items[id]; if (it.status === 'ready' && Date.now() - it.at < 7 * 86400000) C.items[id] = it; });   // unsent ones stay on the list
  if (!force && g.checkins && g.checkins.day === today && g.checkins.done) return [];
  var names = Object.assign({}, (g.roster && g.roster.names) || {});
  ((g.snap && g.snap.rows) || []).forEach(function (r) { names[r.id] = r.name; });
  var pending = {};
  if (g.notes && g.notes.day === today) Object.keys(g.notes.items).forEach(function (id) { if (g.notes.items[id].status === 'ready') pending[id] = 1; });
  if (g.recaps && g.recaps.items) Object.keys(g.recaps.items).forEach(function (id) { if (g.recaps.items[id].status === 'ready') pending[id] = 1; });
  var due = touchQuiet(T, hist, today, names).filter(function (q) { return q.days >= s.quietDays && !pending[q.id] && !C.items[q.id]; }).slice(0, Math.max(0, s.checkinMax - Object.keys(C.items).filter(function (id) { return C.items[id].day === today; }).length));
  var days = [], prevDays = [];
  for (var i = 7; i >= 1; i--) days.push(addDays(today, -i));
  for (var j = 14; j >= 8; j--) prevDays.push(addDays(today, -j));
  var rows = (g.snap && g.snap.rows) || [], fresh = [];
  for (var k = 0; k < due.length; k++) {
    var q = due[k], wk = rcTot(hist, q.id, days), prev = prevDays.every(function (d) { return hist[d]; }) ? rcTot(hist, q.id, prevDays) : null;
    var ct = null; try { ct = await ownerContact(token, q.id); } catch (e) { if (e.auth) throw e; }
    var row = rows.find(function (r) { return String(r.id) === String(q.id); });
    var x = { id: q.id, name: q.name, url: row && row.url, kind: 'checkin', day: today, at: Date.now(), quietDays: q.days, lastHow: q.how, lastAt: q.last,
      to: ct ? ct.email : '', first: ct ? ct.first : null, status: 'ready' };
    Object.assign(x, checkinDraft({ first: x.first, wk: wk, prev: prev }, s));
    C.items[q.id] = x; fresh.push(x);
  }
  C.done = true;
  await set({ checkins: C });
  return fresh;
}
async function checkinsState() {
  var g = await get(['checkins', 'settings']), C = g.checkins || { items: {} };
  var items = Object.keys(C.items || {}).map(function (k) { return C.items[k]; }).sort(function (a, b) { return (a.status === 'ready' ? 0 : 1) - (b.status === 'ready' ? 0 : 1) || b.quietDays - a.quietDays; });
  return { day: C.day || null, items: items, mailFrom: ((g.settings || {}).noteFrom || '') };
}
async function checkinUpdate(m) {
  var r = await serial(async function () {
    var g = await get('checkins'), C = g.checkins; if (!C || !C.items[m.id]) return { error: 'Check-in not found.' };
    var x = C.items[m.id];
    ['to', 'subject', 'body'].forEach(function (k) { if (typeof m[k] === 'string') x[k] = m[k]; });
    if (m.status) { x.status = m.status; x.statusAt = Date.now(); }
    await set({ checkins: C });
    return { ok: true, item: x };
  });
  if (m.status === 'sent') await touchMark(m.id, 'check-in'); else if (m.status === 'ready') await touchUnmark(m.id, 'check-in');
  return r;
}
