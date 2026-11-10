// Runs inside GOAL pages. It only watches what GOAL itself loads and saves; it never sends anything to GOAL.
// 1) When GOAL loads an account's campaign list, it reads the daily budgets (for the budget snapshot).
// 2) On a campaign's Source Settings page, it notes the format of the settings list GOAL loads and of the
//    request GOAL sends when you save a bid multiplier, so the Sources review can apply approved bid changes
//    the same way. Sign-in headers are never recorded.
(function () {
  if (window.__bpwHook) return; window.__bpwHook = true;
  var RX = /\/api\/v[0-9]+\/campaigns(\?|$)/;
  var API_RX = /^https:\/\/api\.portal\.checkoutgoal\.com\//;
  var MULT_RX = /multiplier|modifier|bid_?adj|bid_?pct|bid_?percent/i;
  function onSettingsPage() { return /\/campaigns\/\d+\/source-?setting/i.test(location.pathname); }

  function acctFrom(headers) {
    var h = headers || {}, a = null;
    try {
      if (h instanceof Headers) a = h.get('account-id');
      else if (Array.isArray(h)) h.forEach(function (p) { if (String(p[0]).toLowerCase() === 'account-id') a = p[1]; });
      else Object.keys(h).forEach(function (k) { if (k.toLowerCase() === 'account-id') a = h[k]; });
    } catch (e) {}
    if (!a) { try { a = new URLSearchParams(location.search).get('account_id'); } catch (e) {} }
    return a;
  }
  function brandFrom(url) { try { return new URL(url, location.href).searchParams.get('brand_id'); } catch (e) { return null; } }
  function abs(url) { try { return new URL(url, location.href).href; } catch (e) { return String(url); } }

  // ---- 1) budgets ----
  function weekly(json) {
    var list = json && (json.data || json.campaigns || json);
    if (!Array.isArray(list)) return null;
    var wk = [0, 0, 0, 0, 0, 0, 0], seen = false;
    list.forEach(function (c) {
      if (!c || c.discarded_at || c.active === false) return;
      var bs = c.campaign_budgets || c.budgets;
      if (!Array.isArray(bs)) return;
      bs.forEach(function (b) {
        if (!b || b.discarded_at) return;
        var d = +b.day_id, v = +b.dollar_budget;
        if (d >= 0 && d <= 6 && isFinite(v)) { if (v >= 1e6 || wk[d] === -1) wk[d] = -1; else wk[d] += v; seen = true; }
      });
    });
    return seen ? wk : null;
  }
  function reportBudgets(url, headers, json) {
    var wk = weekly(json); if (!wk) return;
    var acct = acctFrom(headers); if (!acct) return;
    window.postMessage({ __bpw: 'budgets', accountId: acct, brandId: brandFrom(url), wk: wk }, location.origin);
  }

  // ---- 2) source settings format ----
  function flat(x) {
    var o = {};
    Object.keys(x || {}).forEach(function (k) {
      var v = x[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.keys(v).forEach(function (k2) { var w = v[k2]; if (w == null || typeof w !== 'object') o[k + '.' + k2] = w; });
      else if (v == null || typeof v !== 'object') o[k] = v;
    });
    return o;
  }
  function listOf(j) { return Array.isArray(j) ? j : j && Array.isArray(j.data) ? j.data : j && j.data && Array.isArray(j.data.sources) ? j.data.sources : []; }
  function reportSettingsList(url, json) {
    if (!onSettingsPage()) return;
    var rows = listOf(json);
    if (!rows.length || !rows.some(function (r) { return Object.keys(flat(r)).some(function (k) { return MULT_RX.test(k); }); })) return;
    window.postMessage({ __bpw: 'learn', kind: 'read', url: abs(url), pageUrl: location.href, rows: rows.slice(0, 400).map(flat) }, location.origin);
  }
  function reportSave(url, method, body) {
    if (!onSettingsPage() || typeof body !== 'string' || !MULT_RX.test(body)) return;
    window.postMessage({ __bpw: 'learn', kind: 'write', url: abs(url), method: method, body: body, pageUrl: location.href }, location.origin);
  }

  // ---- wiring ----
  var of = window.fetch;
  window.fetch = function (input, init) {
    var url = String(input && input.url || input), method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var p = of.apply(this, arguments);
    if (method === 'GET') {
      if (RX.test(url)) { var hdr = (init && init.headers) || (input && input.headers); p.then(function (r) { r.clone().json().then(function (j) { reportBudgets(url, hdr, j); }).catch(function () {}); }).catch(function () {}); }
      else if (API_RX.test(abs(url))) p.then(function (r) { r.clone().json().then(function (j) { reportSettingsList(url, j); }).catch(function () {}); }).catch(function () {});
    } else if (API_RX.test(abs(url))) {
      p.then(function (r) { if (r.ok) reportSave(url, method, init && init.body); }).catch(function () {});
    }
    return p;
  };
  var oo = XMLHttpRequest.prototype.open, osh = XMLHttpRequest.prototype.setRequestHeader, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__bpw = { m: String(m).toUpperCase(), u: String(u), h: {} }; return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (this.__bpw) this.__bpw.h[k] = v; return osh.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    var x = this, meta = x.__bpw;
    if (meta && API_RX.test(abs(meta.u))) {
      x.addEventListener('load', function () {
        try {
          if (meta.m === 'GET') {
            var j = x.responseType === 'json' ? x.response : JSON.parse(x.responseText);
            if (RX.test(meta.u)) reportBudgets(meta.u, meta.h, j); else reportSettingsList(meta.u, j);
          } else if (x.status >= 200 && x.status < 300) reportSave(meta.u, meta.m, body);
        } catch (e) {}
      });
    }
    return os.apply(this, arguments);
  };
})();
