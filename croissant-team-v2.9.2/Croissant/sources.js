// Sources view and bid proposals for accounts with a conversion flag.
// Reads use the account owner's session (same as GOAL's "log in as").
// The only thing this file ever changes in GOAL is a source's bid multiplier, and only after you approve it
// on the review page. It replays the exact request format GOAL used the last time you changed a multiplier
// by hand, then re-reads GOAL to confirm the new value. Base bids and daily limits are never touched.

var MULT_RX = /multiplier|modifier|bid_?adj|bid_?pct|bid_?percent/i;
var BID = { step: 0.10, maxPoints: 25, ceiling: 300, cooldownDays: 7, topN: 3, minClicks14: 20, minLeads14: 3 };

function pick(o, keys) {
  for (var i = 0; i < keys.length; i++) {
    var v = keys[i].split('.').reduce(function (a, p) { return a == null ? a : a[p]; }, o);
    if (v != null && v !== '') return v;
  }
  return null;
}
function num(v) { var n = +v; return isFinite(n) ? n : 0; }
function flat(x) {   // one level of nesting, e.g. source_type.name
  var o = {};
  Object.keys(x || {}).forEach(function (k) {
    var v = x[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.keys(v).forEach(function (k2) { var w = v[k2]; if (w == null || typeof w !== 'object') o[k + '.' + k2] = w; });
    else if (v == null || typeof v !== 'object') o[k] = v;
  });
  return o;
}
function srcRow(x) {
  return {
    sid: pick(x, ['source_type_id', 'source_id', 'source_type.id', 'source.id']),
    name: pick(x, ['source_type_name', 'source_name', 'source_type.name', 'source.name', 'name']) || 'Source',
    c: num(pick(x, ['click_analytic_total_clicks', 'total_clicks', 'clicks', 'clicks_count'])),
    l: num(pick(x, ['leads_generated_count', 'total_leads', 'leads', 'leads_count'])),
    s: num(pick(x, ['click_analytic_total_cost', 'total_cost', 'total_spend', 'spend', 'cost'])),
    m: pick(x, ['bid_multiplier', 'multiplier', 'bid_modifier', 'modifier'])
  };
}

// ---------- reads ----------
async function sourceStats(sess, camp, startDay, endDay) {
  var H = brandHeaders(sess, camp.brand);
  var tries = ['start_date=' + startDay + '&end_date=' + endDay,
    'start_date=' + encodeURIComponent(range(startDay)[0]) + '&end_date=' + encodeURIComponent(range(endDay)[1])];
  for (var i = 0; i < tries.length; i++) {
    var r = await goalReq('GET', '/api/v4/campaigns/' + camp.id + '/source_stats/quote_funnels?' + tries[i], H);
    if (r.status === 401) throw new Error('source stats not allowed');
    if (!r.ok) continue;
    var j = await r.json(), list = listOf(j.data && !Array.isArray(j.data) && (j.data.sources || j.data.stats) ? (j.data.sources || j.data.stats) : j);
    var out = {};
    list.forEach(function (x) { var s = srcRow(x); if (s.sid == null) s.sid = s.name; var k = String(s.sid); if (out[k]) { out[k].c += s.c; out[k].l += s.l; out[k].s += s.s; } else out[k] = s; });
    if (list.length || i === tries.length - 1) return out;
  }
  return null;
}
// Current multipliers and setting ids, using the read format GOAL itself used (learned on a Source Settings page).
async function readSettings(sess, camp, learned) {
  var rd = learned && learned.read;
  if (!rd) return null;
  var r = await goalReq('GET', rd.url.replace('{campaign}', camp.id), brandHeaders(sess, camp.brand));
  if (!r.ok) return null;
  var list = listOf(await r.json()), out = {};
  list.forEach(function (x) {
    var f = flat(x), m = f[rd.multKey];
    if (m == null || !isFinite(+m)) return;
    var sid = rd.sidKey ? f[rd.sidKey] : null;
    out[String(sid != null ? sid : f[rd.nameKey])] = { setting: rd.idKey ? f[rd.idKey] : null, sid: sid, name: rd.nameKey ? f[rd.nameKey] : null, pct: rd.unit === 'frac' ? +m * 100 : +m };
  });
  return out;
}

// ---------- the review ----------
// r: the account's row from the latest check. Returns everything the review page shows.
async function buildReview(adminToken, r, today) {
  var g = await get(['budgetJob', 'learned', 'bidLog', 'roster']);
  var learned = g.learned || {}, log = g.bidLog || [];
  var sess = await ownerSession(adminToken, r.id);
  var camps = (g.budgetJob && g.budgetJob.camps && g.budgetJob.camps[r.id]) || (await accountCampaigns(sess)).campaigns;
  camps = camps.filter(function (c) { return c.active; });
  var start14 = addDays(today, -14), end14 = addDays(today, -1);
  var out = { at: Date.now(), day: today, acct: r.id, name: r.name, url: r.url, flag: r.cflag, run: r.run, runNorm: r.runNorm, cvr: r.cvr, tcvr: r.tcvr,
    pct: r.pct, capAt: r.capAt, campaigns: [], canWrite: !!(learned.write && learned.write.ok), canRead: !!learned.read, learnedAt: learned.at || null };
  var totTodayLeads = 0, srcWithClicksToday = 0;
  for (var i = 0; i < camps.length; i++) {
    var c = camps[i];
    var t = await sourceStats(sess, c, today, today) || {};
    var n = await sourceStats(sess, c, start14, end14) || {};
    var st = await readSettings(sess, c, learned);
    var C14 = 0, L14 = 0; Object.keys(n).forEach(function (k) { C14 += n[k].c; L14 += n[k].l; });
    var campRate = C14 ? L14 / C14 : null;
    var keys = {}; Object.keys(t).concat(Object.keys(n)).forEach(function (k) { keys[k] = 1; });
    var rows = Object.keys(keys).map(function (k) {
      var a = t[k] || { c: 0, l: 0, s: 0 }, b = n[k] || { c: 0, l: 0, s: 0 };
      var set = st && (st[k] || (a.name && st[a.name]) || (b.name && st[b.name])) || null;
      var mult = set ? set.pct : (a.m != null ? +a.m : b.m != null ? +b.m : null);
      if (mult != null && mult <= 5) mult = mult * 100;
      var rate14 = b.c ? b.l / b.c : null;
      totTodayLeads += a.l; if (a.c > 0) srcWithClicksToday++;
      // Likely culprit: clicks today with far fewer leads than this source normally gets.
      var culprit = false;
      if (a.c >= 5 && rate14 != null && rate14 >= 0.03) {
        if (a.l === 0 && Math.pow(1 - rate14, a.c) < 0.1) culprit = true;
        else if (a.c >= 10 && a.l / a.c < rate14 * 0.5) culprit = true;
      }
      return { key: k, sid: (a.sid != null ? a.sid : b.sid), name: a.name !== 'Source' ? a.name : b.name, today: { c: a.c, l: a.l, s: a.s }, d14: { c: b.c, l: b.l, s: b.s, rate: rate14 },
        mult: mult, setting: set ? set.setting : null, culprit: culprit, propose: null, skip: null };
    }).sort(function (x, y) { return (y.today.s - x.today.s) || (y.d14.c - x.d14.c); });
    out.campaigns.push({ id: c.id, name: c.name, brand: c.brand, campRate: campRate, rows: rows,
      settingsUrl: 'https://www.portal.checkoutgoal.com/campaigns/' + c.id + '/source-setting?admin_user=true&account_id=' + r.id + '&brand_id=' + c.brand });
  }
  // Broken form / page: every source with clicks today stopped converting at once. Bidding up would spend more into it.
  out.brokenForm = r.cflag === 'nolead' && totTodayLeads === 0 && srcWithClicksToday >= 3;
  var recent = {};
  log.forEach(function (e) { if (e.ok && Date.now() - e.at < BID.cooldownDays * 86400000) recent[e.camp + ':' + e.key] = e.at; });
  out.campaigns.forEach(function (c) {
    var cand = c.rows.filter(function (x) {
      if (x.culprit) return false;
      if (x.d14.c < BID.minClicks14 || x.d14.l < BID.minLeads14 || x.d14.rate == null) return false;
      if (c.campRate != null && x.d14.rate < c.campRate) return false;
      if (x.today.c >= 5 && x.today.l === 0 && Math.pow(1 - x.d14.rate, x.today.c) < 0.25) return false;   // not converting today either
      return true;
    }).sort(function (a, b) { return (b.d14.rate - a.d14.rate) || (b.d14.l - a.d14.l); }).slice(0, BID.topN);
    cand.forEach(function (x) {
      if (out.brokenForm) { x.skip = 'every source stopped converting'; return; }
      if (recent[c.id + ':' + x.key]) { x.skip = 'raised ' + new Date(recent[c.id + ':' + x.key]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); return; }
      if (x.mult == null) { x.propose = { from: null, to: null }; x.skip = 'current multiplier not known yet'; return; }
      if (x.mult >= BID.ceiling) { x.skip = 'already at ' + BID.ceiling + '%'; return; }
      var to = Math.min(Math.round(x.mult * (1 + BID.step)), Math.round(x.mult) + BID.maxPoints, BID.ceiling);
      if (to <= x.mult) { x.skip = 'no room to raise'; return; }
      x.propose = { from: Math.round(x.mult * 10) / 10, to: to };
    });
  });
  await set({ ['review_' + r.id]: out });
  return out;
}

// ---------- apply (only from the review page, after you click Apply) ----------
function fillTemplate(str, map) { return str.replace(/\{(setting|campaign|sid|value)\}/g, function (_, k) { return map[k] == null ? '' : String(map[k]); }); }
async function applyBids(adminToken, acct, changes) {
  var g = await get(['learned', 'bidLog', 'review_' + acct]);
  var learned = g.learned || {}, wr = learned.write, rv = g['review_' + acct];
  if (!wr || !wr.ok) return { error: 'GOAL\'s save format hasn\'t been learned yet. Change any multiplier by hand on a Source Settings page once, then try again.' };
  if (!rv) return { error: 'Review expired. Reopen the sources view.' };
  var sess = await ownerSession(adminToken, acct), log = g.bidLog || [], results = [];
  for (var i = 0; i < changes.length; i++) {
    var ch = changes[i];
    var camp = rv.campaigns.find(function (c) { return String(c.id) === String(ch.camp); });
    var row = camp && camp.rows.find(function (x) { return x.key === ch.key; });
    if (!row || !row.propose || row.propose.to == null || row.skip) { results.push({ key: ch.key, ok: false, why: 'not an approved proposal' }); continue; }
    if ((wr.needs.setting && row.setting == null) || (wr.needs.sid && row.sid == null)) { results.push({ key: ch.key, name: row.name, ok: false, why: 'GOAL id for this source not found' }); continue; }
    var target = row.propose.to, value = wr.unit === 'frac' ? Math.round(target) / 100 : Math.round(target);
    var map = { setting: row.setting, campaign: camp.id, sid: row.sid, value: value };
    var res = await goalReq(wr.method, fillTemplate(wr.url, map), Object.assign({ 'Content-Type': 'application/json' }, brandHeaders(sess, camp.brand)), null, fillTemplate(wr.body, map));
    var ok = res && res.ok, verified = false, now = null;
    if (ok) {
      await sleep(400);
      var st = await readSettings(sess, camp, learned);
      var cur = st && (st[row.key] || (row.name && st[row.name]));
      if (cur) { now = cur.pct; verified = Math.abs(cur.pct - target) < 0.6; }
    }
    var entry = { at: Date.now(), acct: acct, acctName: rv.name, camp: camp.id, campName: camp.name, key: row.key, name: row.name, from: row.propose.from, to: target, ok: !!(ok && (verified || now == null)), verified: verified, status: res ? res.status : 0, now: now };
    log.unshift(entry); results.push(entry);
    await sleep(200);
  }
  await set({ bidLog: log.slice(0, 300) });
  return { results: results };
}

// ---------- learning GOAL's format from your own edit ----------
// hook.js reports (without any sign-in headers): the settings list GOAL loaded on a Source Settings page,
// and the request GOAL sent when you saved a multiplier there.
function campaignFromPage(pageUrl) { var m = /\/campaigns\/(\d+)/.exec(pageUrl || ''); return m ? m[1] : null; }
function relPath(u) { try { var x = new URL(u); return x.pathname + x.search; } catch (e) { return u; } }
async function learn(m) {
  var g = await get('learned'); var L = g.learned || {};
  var cid = campaignFromPage(m.pageUrl);
  if (m.kind === 'read' && Array.isArray(m.rows) && m.rows.length && cid) {
    var f = m.rows.map(flat), k0 = Object.keys(f[0]);
    var multKey = k0.find(function (k) { return MULT_RX.test(k) && f.every(function (r) { return r[k] == null || isFinite(+r[k]); }); });
    if (!multKey) return L;
    var sidKey = k0.find(function (k) { return /^source(_type)?_id$|^source(_type)?\.id$/i.test(k); }) || null;
    var nameKey = k0.find(function (k) { return /source(_type)?(_name|\.name)$/i.test(k); }) || k0.find(function (k) { return /name/i.test(k); }) || null;
    var idKey = f[0].id != null ? 'id' : null;
    var path = relPath(m.url);
    if (path.indexOf(cid) < 0) return L;
    var vals = f.map(function (r) { return +r[multKey]; }).filter(isFinite);
    L.read = { url: path.split(cid).join('{campaign}'), multKey: multKey, sidKey: sidKey, nameKey: nameKey, idKey: idKey, unit: vals.length && Math.max.apply(null, vals) <= 5 ? 'frac' : 'pct' };
    L.lastRows = { campaign: cid, rows: f.slice(0, 400) };
  }
  if (m.kind === 'write' && m.body && cid) {
    var w = { method: m.method, ok: false, needs: {} }, why = [];
    var body; try { body = JSON.parse(m.body); } catch (e) { body = null; }
    if (!body) why.push('save body not JSON');
    var path2 = relPath(m.url);
    var rows = L.lastRows && L.lastRows.campaign === cid ? L.lastRows.rows : [];
    var rd = L.read || {};
    // Which source row was edited? Its setting id (or source id) shows up in the URL or the body.
    var segs = path2.split(/[\/?&=]/), bodyFlat = body ? flat(body) : {};
    var edited = rows.find(function (r) { return rd.idKey && r[rd.idKey] != null && (segs.indexOf(String(r[rd.idKey])) >= 0 || Object.values(bodyFlat).some(function (v) { return String(v) === String(r[rd.idKey]); })); })
      || rows.find(function (r) { return rd.sidKey && r[rd.sidKey] != null && (segs.indexOf(String(r[rd.sidKey])) >= 0 || Object.values(bodyFlat).some(function (v) { return String(v) === String(r[rd.sidKey]); })); });
    if (!edited) why.push('couldn\'t tell which source was edited');
    var mk = body && Object.keys(bodyFlat).find(function (k) { return MULT_RX.test(k) && isFinite(+bodyFlat[k]); });
    if (!mk) why.push('no multiplier in the save');
    if (!why.length) {
      var setId = rd.idKey ? edited[rd.idKey] : null, sid = rd.sidKey ? edited[rd.sidKey] : null;
      // Swap ids for placeholders only where a whole URL segment, query value or JSON value equals them.
      var hits = { setting: false, sid: false };
      var subs = [[setId, '{setting}', 'setting']];
      if (sid != null && String(sid) !== String(setId)) subs.push([sid, '{sid}', 'sid']);
      subs.push([cid, '{campaign}', null]);
      var swapTok = function (tok) { for (var q = 0; q < subs.length; q++) if (subs[q][0] != null && String(subs[q][0]) === tok) { if (subs[q][2]) hits[subs[q][2]] = true; return subs[q][1]; } return tok; };
      var qi = path2.indexOf('?'), pth = qi < 0 ? path2 : path2.slice(0, qi), qs = qi < 0 ? '' : path2.slice(qi + 1);
      var url = pth.split('/').map(swapTok).join('/') + (qs ? '?' + qs.split('&').map(function (kv) { var e = kv.indexOf('='); return e < 0 ? kv : kv.slice(0, e + 1) + swapTok(kv.slice(e + 1)); }).join('&') : '');
      var mv = bodyFlat[mk], parts = mk.split('.');
      var walk = function (o) { Object.keys(o).forEach(function (k) { var v = o[k]; if (v && typeof v === 'object') walk(v); else if (v != null) { var t = swapTok(String(v)); if (t !== String(v)) o[k] = '__PH__' + t; } }); };
      if (parts.length === 2) body[parts[0]][parts[1]] = '__VAL__'; else body[mk] = '__VAL__';
      walk(body);
      var bodyStr = JSON.stringify(body).replace('"__VAL__"', typeof mv === 'string' ? '"{value}"' : '{value}')
        .replace(/"__PH__(\{[a-z]+\})"/g, function (all, ph) { return ph; });
      w.needs.setting = hits.setting; w.needs.sid = hits.sid;
      w.url = url; w.body = bodyStr; w.unit = +mv <= 5 ? 'frac' : 'pct';
      w.ok = !!(w.needs.setting || w.needs.sid) && !!L.read;
      if (!w.ok) why.push(!L.read ? 'settings list not seen yet' : 'source id not found in the save');
    }
    w.why = why;
    L.write = w;
  }
  L.at = Date.now();
  await set({ learned: L });
  return L;
}
