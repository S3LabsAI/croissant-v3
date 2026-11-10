// Morning budget pull, one account at a time. Read-only: nothing in GOAL is changed.
// Same steps as GOAL's admin "log in as": find the account's owner user, sign in as them with your
// admin session, list the account's brands, then read each brand's campaigns and add up the
// per-weekday daily budgets of the active campaigns.

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function goalReq(method, path, headers, body, rawBody) {
  var res;
  for (var attempt = 0; attempt < 3; attempt++) {
    res = await fetch(API + path, {
      method: method,
      headers: Object.assign({ accept: 'application/json' }, body || rawBody ? { 'Content-Type': 'application/json' } : {}, headers),
      body: rawBody != null ? rawBody : body ? JSON.stringify(body) : undefined
    });
    if (res.status !== 429) return res;
    await sleep(3000);
  }
  return res;
}

function listOf(j) {
  if (Array.isArray(j)) return j;
  if (!j) return [];
  if (Array.isArray(j.data)) return j.data;
  if (j.data && Array.isArray(j.data.users)) return j.data.users;
  if (Array.isArray(j.users)) return j.users;
  if (Array.isArray(j.campaigns)) return j.campaigns;
  return [];
}

// Adds up active campaigns' budgets by weekday (day_id 0 = Sunday).
// known = false means GOAL's answer didn't look like a campaign list with budgets, so don't trust it.
function weeklyFrom(list) {
  var wk = [0, 0, 0, 0, 0, 0, 0], known = false, n = 0;
  list.forEach(function (c) {
    if (!c || !Array.isArray(c.campaign_budgets)) return;
    known = true;
    if (c.discarded_at || c.active === false) return;
    n++;
    c.campaign_budgets.forEach(function (b) {
      if (!b || b.discarded_at) return;
      var d = +b.day_id, v = +b.dollar_budget;
      if (!(d >= 0 && d <= 6 && isFinite(v))) return;
      if (v >= 1e6 || wk[d] === -1) wk[d] = -1;   // GOAL's "no daily limit" (2147483647 and the like)
      else wk[d] += v;
    });
  });
  return { wk: wk, known: known, n: n };
}

// Signs in as an account's owner with your admin session (same as GOAL's "log in as"). Read-only by itself.
// Sessions are kept in memory for 20 minutes so the morning pull and the sources view don't sign in twice.
var _sessions = {};
self.ownerSession = async function (adminToken, id) {
  var c = _sessions[id];
  if (c && Date.now() - c.at < 20 * 60 * 1000 && c.admin === adminToken) return c;
  var A = { Authorization: adminToken, 'admin-token': adminToken };
  var r = await goalReq('GET', '/api/v1/get_users_by_account?account_id=' + encodeURIComponent(id), A);
  if (r.status === 401) throw new AuthError();
  if (!r.ok) throw new Error('user list ' + r.status);
  var users = listOf(await r.json()).filter(function (u) { return u && u.email; });
  if (!users.length) throw new Error('no users on account');
  var owner = users.find(function (u) { return /owner/i.test(u.role_name || (u.role && u.role.name) || ''); }) || users[0];
  var lr = await goalReq('POST', '/api/v1/login', A, { user: { email: owner.email }, admin_user: true });
  if (!lr.ok) throw new Error('sign-in ' + lr.status);
  var ut = lr.headers.get('authorization');
  if (!ut) { try { var lj = await lr.json(); ut = lj.token || (lj.data && lj.data.token) || null; } catch (e) {} }
  if (!ut) throw new Error('no session from sign-in');
  var H = { Authorization: ut, 'account-id': String(id), 'admin-token': adminToken };
  var br = await goalReq('GET', '/api/v1/brands', H);
  if (!br.ok) throw new Error('brands ' + br.status);
  var brands = listOf(await br.json()).filter(function (b) { return b && b.id != null && !b.discarded_at; });
  if (!brands.length) throw new Error('no brands');
  c = { at: Date.now(), admin: adminToken, H: H, brands: brands.map(function (b) { return b.id; }) };
  _sessions[id] = c;
  return c;
};
function brandHeaders(sess, brandId) { return Object.assign({ 'brand-id': String(brandId) }, sess.H); }

// Product and per-weekday daily limits for one campaign. Quote Funnel limits are dollars; Lead Marketplace limits
// are units (leads). -1 = no daily limit, null = none set for that day.
function campProduct(c) {
  var pt = +c.product_type_id, nm = String((c.product_type && c.product_type.name) || c.product_type_name || '').toLowerCase();
  if (pt === 3 || /lead/.test(nm)) return 'lm';
  if (pt === 5 || /quote/.test(nm)) return 'qf';
  return nm || 'other';
}
function campInfo(c, brand) {
  var dollar = [null, null, null, null, null, null, null], units = [null, null, null, null, null, null, null];
  (Array.isArray(c.campaign_budgets) ? c.campaign_budgets : []).forEach(function (b) {
    if (!b || b.discarded_at) return;
    var d = +b.day_id; if (!(d >= 0 && d <= 6)) return;
    if (b.dollar_budget != null && isFinite(+b.dollar_budget)) dollar[d] = +b.dollar_budget >= 1e6 ? -1 : +b.dollar_budget;
    if (b.volume_budget != null && isFinite(+b.volume_budget)) units[d] = +b.volume_budget >= 1e6 ? -1 : +b.volume_budget;
  });
  return { id: c.id, name: c.name || ('Campaign ' + c.id), brand: brand, active: c.active !== false, product: campProduct(c), dollar: dollar, units: units };
}
// Today's Lead Marketplace spend and leads won per campaign, for one account (owner session, read-only).
self.lmToday = async function (adminToken, id, camps, today) {
  var sess = await ownerSession(adminToken, id), r = range(today), out = {};
  var brands = {}; camps.forEach(function (c) { if (c.product === 'lm') brands[c.brand] = 1; });
  var bl = Object.keys(brands);
  for (var i = 0; i < bl.length; i++) {
    var q = '/api/v4/campaign_stats/leads?brand_id=' + bl[i] + '&start_date=' + encodeURIComponent(r[0]) + '&end_date=' + encodeURIComponent(r[1]) + '&timezone=' + encodeURIComponent(GOAL_TZ);
    var res = await goalReq('GET', q, brandHeaders(sess, bl[i]));
    if (res.status === 401) { delete _sessions[id]; throw new Error('session expired'); }
    if (!res.ok) continue;
    listOf(await res.json()).forEach(function (x) {
      var cid = x.campaign_id; if (cid == null) return;
      out[cid] = { s: Math.round((+x.lead_analytic_total_cost || +x.total_cost || 0) * 100) / 100, l: +x.lead_analytic_total_leads || +x.lead_analytic_total_won || +x.total_leads || 0 };
    });
    await sleep(100);
  }
  return out;
};

// The account's campaigns (id, name, brand, active, product, daily limits), from each brand's campaign list.
self.accountCampaigns = async function (sess) {
  var out = [], lists = [];
  for (var i = 0; i < sess.brands.length; i++) {
    await sleep(100);
    var cr = await goalReq('GET', '/api/v1/campaigns?brand_id=' + sess.brands[i], brandHeaders(sess, sess.brands[i]));
    if (!cr.ok) continue;
    var list = listOf(await cr.json());
    lists.push(list);
    list.forEach(function (c) { if (c && c.id != null && !c.discarded_at) out.push(campInfo(c, sess.brands[i])); });
  }
  return { campaigns: out, lists: lists };
};

self.pullAccountBudget = async function (adminToken, id) {
  var sess = await ownerSession(adminToken, id);
  var ac = await accountCampaigns(sess);
  var wk = [0, 0, 0, 0, 0, 0, 0], known = false, n = 0;
  ac.lists.forEach(function (list) {
    var w = weeklyFrom(list);
    if (w.known) { known = true; n += w.n; w.wk.forEach(function (v, k) { wk[k] = wk[k] === -1 || v === -1 ? -1 : wk[k] + v; }); }
  });
  if (!known) throw new Error('campaign budgets not found');
  return { wk: wk.map(function (v) { return Math.round(v * 100) / 100; }), campaigns: n, brands: sess.brands.length, campaignList: ac.campaigns };
};
