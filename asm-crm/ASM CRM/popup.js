// The main view. Runs in the toolbar popup, and inside the floating panel on GOAL pages (R = the panel's shadow root).
self.BPW_UI = function (R, env) {
  env = env || {};
  var $ = function (s) { return R.querySelector(s); };
  function openUrl(u) { if (env.open) env.open(u); else chrome.tabs.create({ url: u }); }
  var state = { snap: null, settings: null, filter: 'all', q: '', open: {}, pat: null };
  try { state.open = JSON.parse(localStorage.getItem('bpw_open') || '{}'); state.filter = localStorage.getItem('bpw_filter') || 'all'; } catch (e) {}

  function send(msg) { return new Promise(function (r) { chrome.runtime.sendMessage(msg, function (x) { r(x || {}); }); }); }
  function money(n) { return '$' + (+n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function money0(n) { return n == null ? '-' : '$' + (+n).toLocaleString('en-US', { maximumFractionDigits: n < 100 ? 2 : 0, minimumFractionDigits: n < 100 ? 2 : 0 }); }
  function pct1(n) { return n == null ? '-' : (Math.round(n * 10) / 10) + '%'; }
  function dol(n) { return n == null ? '-' : '$' + Math.round(n).toLocaleString('en-US'); }
  function clk(t) { return clock(t).replace('am', 'a').replace('pm', 'p'); }
  function pctTxt(n) { return n == null ? '-' : (n >= 10 ? n.toFixed(1) : n.toFixed(2)).replace(/\.?0+$/, '') + '%'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function cls(p) { return p == null ? 'n' : p >= 100 ? 'x' : p >= 75 ? 'w' : p >= 50 ? 'q' : ''; }
  function cvCls(v, norm) { if (v == null) return 'n'; if (norm == null || norm <= 0) return ''; if (v < norm * 0.7) return 'lo'; if (v >= norm) return 'hi'; return ''; }
  function cplCls(v, norm) { if (v == null || norm == null) return ''; if (v > norm * 1.4) return 'lo'; if (v <= norm) return 'hi'; return ''; }
  function clock(t) { return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' AM', 'am').replace(' PM', 'pm'); }
  function fmtDate(d) { var a = String(d).split('-'); return a.length === 3 ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+a[1] - 1] + ' ' + (+a[2]) : d; }
  function noteBtn(r) {
    var n = state.notes && state.notes.day === (state.snap && state.snap.day) && state.notes.items.find(function (x) { return String(x.id) === String(r.id); });
    if (!n || n.status === 'skipped') return '';
    return n.status === 'sent' ? '<span class="tag sent" title="You sent the client note today">Note sent</span>' : '<button class="ic note" data-id="' + r.id + '" title="' + esc(n.why.calls ? n.calls + ' inbound calls' : '') + (n.why.calls && n.why.cvr ? ', ' : '') + esc(n.why.cvr ? Math.round(n.pct) + '% conversion' : '') + ' today. Review and send a short note to the client.">Note ready</button>';
  }
  function flagged(r) { return !!(r.flag || r.cflag || r.campFlags); }

  // ---------- render ----------
  function render() {
    var s = state.snap;
    $('#stamp').textContent = s && s.at ? 'checked ' + clock(s.at) : 'not checked yet';
    renderBanner(s);
    var rows = (s && s.rows) || [];
    var nPaused = rows.filter(function (r) { return r.paused; }).length;
    var live = rows.filter(function (r) { return !r.snoozed; });
    var tot = 0, bud = 0; live.forEach(function (r) { tot += r.spend + (r.lmSpend || 0); bud += r.bud; });
    var n100 = live.filter(function (r) { return r.pct >= 100; }).length;
    var n75 = live.filter(function (r) { return r.pct >= 75 && r.pct < 100; }).length;
    var nf = live.filter(flagged).length;
    var nFast = live.filter(function (r) { return r.capAt && r.pct < 100; }).length;
    $('#sum').innerHTML = '<div><b>' + money(tot) + '</b>spent today</div><div><b>' + money(bud) + '</b>daily budgets</div>' +
      '<div class="x"><b>' + n100 + '</b>at 100%+</div><div class="w"><b>' + n75 + '</b>at 75-99%</div>' +
      '<div class="w"><b>' + nFast + '</b>on track to cap</div><div class="w"><b>' + nf + '</b>flagged</div><div><b>' + pctTxt(s && s.totCvr) + '</b>conv. today</div><div title="Active accounts assigned to you in GOAL' + (nPaused ? '; ' + nPaused + ' have every campaign paused' : '') + '"><b>' + rows.length + '</b>active accounts' + (nPaused ? ' (' + nPaused + ' paused)' : '') + '</div>';
    R.querySelectorAll('#chips button').forEach(function (b) { b.classList.toggle('on', b.dataset.f === state.filter); });
    var pat = state.filter === 'pat';
    $('#tableWrap').hidden = pat; $('#patWrap').hidden = !pat;
    if (pat) renderPatterns(); else renderRows(rows, s);
    renderSettings();
    var rh = s && s.rhythm;
    $('#note').textContent = !rh ? '' : rh.account ? 'Projected cap times use each account\'s learned daily rhythm (' + rh.account + ' accounts so far).' :
      rh.pooled ? 'Cap times use the average rhythm across accounts until each one has 2 days of history.' : 'Still learning each account\'s daily rhythm; cap times show up after a couple of days.';
  }

  function renderBanner(s) {
    var ban = '';
    if (!s || s.err === 'auth') ban = '<div class="ban err">Not connected to GOAL yet. Open the GOAL admin dashboard in Chrome once, then click Refresh. <span class="sp"></span><button id="openGoal">Open GOAL</button></div>';
    else if (s.err) ban = '<div class="ban err">Last check failed: ' + esc(s.err) + '. Showing the previous numbers.</div>';
    var bp = s && s.budgetPull;
    if (bp && !bp.done) ban += '<div class="ban info">Pulling today\'s budgets from GOAL: ' + bp.pulled + ' of ' + bp.total + ' accounts so far. Finishes on its own in a minute or two.</div>';
    if (s && s.budgetMix) {
      var m = s.budgetMix, parts = [];
      if (m.live) parts.push(m.live + ' pulled from GOAL');
      if (m.captured) parts.push(m.captured + ' from accounts you opened');
      if (m.manual) parts.push(m.manual + ' set by you');
      if (m.snapshot) parts.push(m.snapshot + ' still on ' + esc(fmtDate(s.budgetsAsOf)) + ' numbers');
      var failTxt = bp && bp.done && bp.failed ? ' ' + bp.failed + (bp.failed === 1 ? ' account' : ' accounts') + ' couldn\'t be read from GOAL this morning; hover its budget for why.' : '';
      if (m.snapshot || failTxt || (bp && !bp.done)) ban += '<div class="ban ' + (m.snapshot ? 'warn' : 'info') + '">Today\'s budgets' + (s.budgetSnapAt ? ' (snapshot ' + clock(s.budgetSnapAt) + ')' : '') + ': ' + parts.join(', ') + '.' + failTxt + '</div>';
    }
    if (state.settings && !String(state.settings.noteSig || '').trim()) ban += '<div class="ban info">Add your name under Settings, Client notes, Sign-off so the client emails it drafts are signed by you.</div>';
    $('#banner').innerHTML = ban;
    var og = $('#openGoal'); if (og) og.onclick = function () { openUrl('https://www.admin.checkoutgoal.com/dashboard'); };
  }

  function renderRows(rows, s) {
    var q = state.q.trim().toLowerCase();
    var shown = rows.filter(function (r) {
      if (state.filter === 'hot' && !(r.pct >= 75 || (r.capAt && r.pct < 100))) return false;
      if (state.filter === 'flag' && !flagged(r)) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && String(r.id).indexOf(q.replace('#', '')) < 0) return false;
      return true;   // every active account, even before it spends
    });
    var html = shown.map(function (r) {
      var c = cls(r.pct), w = r.pct == null ? 0 : Math.min(100, r.pct);
      var expW = r.expected && r.bud > 0 ? Math.min(100, r.expected / r.bud * 100) : null;
      var name = r.url ? '<a href="' + esc(r.url) + '" target="_blank" title="Open in GOAL">' + esc(r.name) + '</a>' : '<span>' + esc(r.name) + '</span>';
      var tags = '';
      if (r.flag === 'zero') tags += '<span class="tag zero" title="Normally spends about ' + money(r.typ) + ' on a day like today">No spend</span>';
      if (r.flag === 'under') tags += '<span class="tag under" title="About ' + money(r.expected || r.typ) + ' by now on a normal day">Underpacing</span>';
      if (r.cflag === 'nolead') tags += '<span class="tag cvr" title="No leads in the last ' + r.run + ' clicks; normally ' + pctTxt(r.tcvr) + '">No leads ' + r.run + ' clicks</span>';
      else if (r.cflag || r.campFlags) tags += '<span class="tag cvr" title="Leads per click well below normal' + (r.cflag ? '' : ' on ' + r.campFlags + ' campaign' + (r.campFlags > 1 ? 's' : '')) + '">Conv. drop</span>';
      var paceSub = r.paceUnits ? r.lmWon + ' of ' + r.lmUnits + ' leads' : r.pct >= 100 && s.capAt && s.capAt[r.id] ? 'hit ' + clk(s.capAt[r.id]) : r.capAt ? 'cap ~' + clk(r.capAt) : r.expected != null && r.bud > 0 ? 'norm ' + Math.round(r.expected / r.bud * 100) + '%' : '';
      var out = '<tr class="' + (r.snoozed ? 'snz' : '') + '"><td><div class="acct">' +
        ((s.campsOk || (r.campList && r.campList.length)) ? '<button class="ic tog" data-id="' + r.id + '" title="Show campaigns">' + (state.open[r.id] ? '&#9662;' : '&#9656;') + '</button>' : '') +
        name + '<small>#' + r.id + '</small>' + tags +
        '<span class="sp"></span>' + noteBtn(r) + ((r.cflag || r.campFlags) ? '<button class="ic srcs" data-id="' + r.id + '" title="See which sources caused it and approve bid increases on the best converters">Sources</button>' : '') + '<button class="ic mute" data-id="' + r.id + '" data-on="' + (r.snoozed ? 0 : 1) + '" title="' + (r.snoozed ? 'Turn alerts back on for this account' : 'Mute alerts for this account until tomorrow') + '">' + (r.snoozed ? 'Unmute' : 'Mute') + '</button>' +
        '</div><div class="track ' + c + '"><i style="width:' + w + '%"></i>' + (expW != null ? '<b style="left:' + expW + '%" title="Where a normal day would be by now"></b>' : '') + '</div></td>' +
        '<td class="r"' + (r.lmAny ? ' title="Quote Funnel ' + money(r.spend) + ' + Marketplace ' + money(r.lmSpend) + '"' : '') + '>' + money(r.spend + (r.lmSpend || 0)) + (r.lmAny && r.lmSpend > 0 ? '<span class="sub">LM ' + money0(r.lmSpend) + '</span>' : '') + '</td>' +
        '<td class="r"><input class="bud' + (r.budSrc === 'snapshot' ? ' stale' : '') + '" data-id="' + r.id + '" value="' + (r.bud > 0 ? r.bud : '') + '" placeholder="' + (r.noLimit ? 'no limit' : r.paused ? 'paused' : 'set') + '" title="' + esc(r.noLimit ? 'A campaign on this account has no daily limit in GOAL, so there is no budget to pace against. Type a number to track pace against it today.' : r.paused ? 'All of this account\'s campaigns are paused in GOAL, so there is no budget today.' : budTip(r)) + '">' + (r.lmAny ? '<span class="sub" title="Lead Marketplace daily limit across active Marketplace campaigns">' + (r.lmUnl ? 'LM no limit' : r.lmUnits > 0 ? '+' + r.lmUnits + ' units' : 'LM paused') + '</span>' : '') + '</td>' +
        '<td class="r" title="' + (r.capAt && r.pct < 100 ? 'On track to hit budget around ' + clock(r.capAt) : r.expected != null && r.bud > 0 ? 'A normal day would be at ' + Math.round(r.expected / r.bud * 100) + '% of budget by now' : '') + '"><span class="pct ' + c + '">' + (r.pct == null ? (r.noLimit ? 'no limit' : r.paused ? 'paused' : 'no budget') : (r.pct >= 100 ? Math.round(r.pct) : Math.min(99, Math.round(r.pct))) + '%') + '</span><span class="sub' + (r.capAt && r.pct < 100 ? ' hot' : '') + '">' + (paceSub || '&nbsp;') + '</span></td>' +
        '<td class="r" title="' + r.leads + ' leads, ' + r.calls + ' calls from ' + r.clicks + ' clicks today"><span class="cv ' + cvCls(r.cvr, r.tcvr) + '">' + pctTxt(r.cvr) + '</span><span class="sub">' + (r.tcvr == null ? '&nbsp;' : 'norm ' + pct1(r.tcvr)) + '</span></td>' +
        '<td class="r"><span class="cv ' + cplCls(r.cpl, r.tcpl) + '">' + money0(r.cpl) + '</span><span class="sub">' + (r.tcpl == null ? '&nbsp;' : 'norm ' + dol(r.tcpl)) + '</span></td></tr>';
      if (state.open[r.id]) {
        var cl = r.campList && r.campList.length ? r.campList : (r.camps || []).map(function (k) { return Object.assign({ product: 'qf', active: true, limit: null, pct: null }, k); });
        if (cl.length) out += cl.map(function (k) {
          var lm = k.product === 'lm', pc2 = k.pct == null ? null : k.pct, cc = pc2 == null ? '' : pc2 >= 100 ? 'x' : pc2 >= 75 ? 'w' : pc2 >= 50 ? 'q' : '';
          var lim = k.limit == null ? '<span class="meta">-</span>' : k.limit === -1 ? 'no limit' : lm ? k.limit + ' units' : money0(k.limit);
          var prod = lm ? '<span class="prod lm" title="Lead Marketplace">Marketplace</span>' : k.product === 'qf' ? '<span class="prod qf" title="Quote Funnel">Quote Funnel</span>' : '<span class="prod">' + esc(k.product) + '</span>';
          var meta = lm ? k.leads + (k.leads === 1 ? ' lead won' : ' leads won') : k.leads + (k.leads === 1 ? ' lead' : ' leads') + ' · ' + k.clicks + (k.clicks === 1 ? ' click' : ' clicks') + (k.calls ? ' · ' + k.calls + (k.calls === 1 ? ' call' : ' calls') : '');
          return '<tr class="camp' + (k.active ? '' : ' off') + '"><td class="cname" title="' + esc(k.name) + (k.active ? '' : ' (paused)') + '"><i class="dot ' + (k.active ? 'on' : 'off') + '"></i>' + esc(k.name) + ' ' + prod + ' <span class="meta">' + meta + '</span>' + (k.flag === 'nolead' ? ' <span class="tag cvr">No leads ' + k.run + ' clicks</span>' : k.flag ? ' <span class="tag cvr">Conv. drop</span>' : '') + '</td>' +
            '<td class="r">' + money(k.spend) + '</td><td class="r">' + lim + '</td>' +
            '<td class="r">' + (k.active ? (pc2 == null ? '<span class="meta">-</span>' : '<span class="pct ' + cc + '">' + (pc2 >= 100 ? Math.round(pc2) : Math.min(99, Math.round(pc2))) + '%</span>' + (lm && k.limit > 0 ? '<span class="sub">' + k.leads + ' of ' + k.limit + '</span>' : '')) : '<span class="meta">paused</span>') + '</td>' +
            '<td class="r">' + (lm ? '<span class="meta">-</span>' : '<span class="cv ' + cvCls(k.cvr, k.ncvr) + '">' + pctTxt(k.cvr) + '</span><span class="sub">' + (k.ncvr == null ? '&nbsp;' : 'norm ' + pct1(k.ncvr)) + '</span>') + '</td>' +
            '<td class="r"><span class="cv ' + (lm ? '' : cplCls(k.cpl, k.ncpl)) + '">' + money0(k.cpl) + '</span><span class="sub">' + (k.ncpl == null || lm ? '&nbsp;' : 'norm ' + dol(k.ncpl)) + '</span></td></tr>';
        }).join('');
        else out += '<tr class="campnote"><td colspan="6">No campaigns found for this account yet. They load with the morning budget pull.</td></tr>';
      }
      return out;
    }).join('');
    $('#rows').innerHTML = html || '<tr><td colspan="6" class="empty">' + (rows.length ? 'Nothing matches this filter.' : 'No data yet.') + '</td></tr>';
  }

  function renderPatterns() {
    var p = state.pat, el = $('#patWrap');
    if (!p) { el.innerHTML = '<div class="patnote">Loading patterns...</div>'; send({ type: 'patterns' }).then(function (r) { state.pat = r; render(); }); return; }
    var q = state.q.trim().toLowerCase();
    var items = (p.items || []).filter(function (x) { return !q || x.name.toLowerCase().indexOf(q) >= 0 || String(x.id).indexOf(q.replace('#', '')) >= 0; });
    var html = '<div class="patnote">Facts from the last 2 weeks of GOAL data' + (p.days ? ' (' + p.days + ' weekdays)' : '') + ', to bring into client conversations. Budget hits count days spend reached the daily budget; cap times build up as the extension runs.</div>';
    html += items.map(function (x) {
      var li = [];
      if (x.hit >= 3) li.push('Reached its daily budget on ' + x.hit + ' of the last ' + x.of + ' weekdays' + (x.capTypical ? ', usually by ' + x.capTypical : '') + '.');
      if (x.trend) li.push('Conversion rate <span class="' + (x.trend.ch < 0 ? 'dn' : 'up') + '">' + (x.trend.ch < 0 ? 'down' : 'up') + ' ' + Math.round(Math.abs(x.trend.ch) * 100) + '%</span> week over week: ' + pctTxt(x.trend.now) + ' last 7 days vs. ' + pctTxt(x.trend.before) + ' the 7 before.');
      return '<div class="pat">' + (x.url ? '<a href="' + esc(x.url) + '" target="_blank">' + esc(x.name) + '</a>' : '<b>' + esc(x.name) + '</b>') + '<small>#' + x.id + '</small><ul><li>' + li.join('</li><li>') + '</li></ul></div>';
    }).join('');
    if (!items.length) html += '<div class="empty">No standout patterns right now.</div>';
    el.innerHTML = html;
  }

  function budTip(r) {
    var why = r.budWhy ? 'Couldn\'t read from GOAL this morning (' + r.budWhy + '). ' : '';
    if (r.budSrc === 'manual') return 'You set this for today. Clear the box to use the daily snapshot.';
    if (r.budSrc === 'live') return 'Pulled from GOAL this morning.';
    if (r.budSrc === 'captured') return why + 'Read from GOAL when you opened this account' + (r.budAsOf ? ' (' + fmtDate(r.budAsOf) + ')' : '') + '.';
    if (r.budSrc === 'snapshot') return why + 'Old ' + fmtDate(state.snap.budgetsAsOf) + ' number, may be out of date. Type the right number to fix it for today.';
    return 'No budget on file. Type one to track pace.';
  }

  // ---------- settings ----------
  var IDS = { amId: 's', panelOn: 'b', touchOn: 'b', quietDays: 'n', checkinMax: 'n', briefOn: 'b', briefHour: 'n', recapOn: 'b', recapDay: 'n', recapHour: 'n', recapOnlyGood: 'b', noteOn: 'b', noteCvrOn: 'b', noteCvrPct: 'n', noteMinClicks: 'n', noteCallsOn: 'b', noteCalls: 'n', noteCooldown: 'n', noteSig: 's', noteFrom: 's', every: 'n', th: 'list', routine: 's', flags: 'b', cvrAlerts: 'b', cvrSens: 's', fastAlerts: 'b', fastBefore: 'n', digest: 'b', digestHour: 'n', autoSave: 'b', slackOn: 'b', slackUrl: 's' };
  function renderSettings() {
    var st = state.settings; if (!st) return;
    Object.keys(IDS).forEach(function (k) {
      var el = $('#' + k); if (!el || (R.activeElement || document.activeElement) === el) return;
      if (IDS[k] === 'b') el.checked = !!st[k]; else if (IDS[k] === 'list') el.value = st[k].join(', '); else el.value = String(st[k] == null ? '' : st[k]);
    });
  }
  Object.keys(IDS).forEach(function (k) {
    var el = $('#' + k); if (!el) return;
    el.addEventListener('change', async function () {
      var v;
      if (IDS[k] === 'b') v = el.checked;
      else if (IDS[k] === 'n') { v = +el.value; if (!(v >= 0)) { renderSettings(); return; } }
      else if (IDS[k] === 'list') { v = el.value.split(/[ ,]+/).map(Number).filter(function (n) { return n > 0; }).sort(function (a, b) { return a - b; }); if (!v.length) { renderSettings(); return; } }
      else v = el.value.trim();
      var o = {}; o[k] = v;
      var r = await send({ type: 'settings', settings: o });
      if (r.settings) state.settings = r.settings; if (r.snap) state.snap = r.snap; render();
    });
  });
  $('#gear').onclick = function () { $('#settings').hidden = !$('#settings').hidden; };
  $('#closeSettings').onclick = function () { $('#settings').hidden = true; };
  $('#slackTest').onclick = async function () {
    var url = $('#slackUrl').value.trim(), hint = $('#slackHint');
    if (!/^https:\/\/hooks\.slack\.com\//.test(url)) { hint.innerHTML = '<span class="bad">That doesn\'t look like a Slack webhook URL (it should start with https://hooks.slack.com/).</span>'; return; }
    this.disabled = true;
    var r = await send({ type: 'slackTest', url: url });
    this.disabled = false;
    hint.innerHTML = r.ok ? '<span class="ok">Sent. Check Slack for the test message.</span>' : '<span class="bad">Slack didn\'t accept it. Double-check the URL.</span>';
    if (r.ok) { var x = await send({ type: 'settings', settings: { slackUrl: url, slackOn: true } }); if (x.settings) state.settings = x.settings; renderSettings(); }
  };

  // ---------- table events ----------
  $('#refresh').onclick = async function () { this.disabled = true; this.textContent = 'Checking...'; var r = await send({ type: 'refresh' }); if (r.snap) state.snap = r.snap; state.notes = await send({ type: 'notes' }); state.pat = null; this.disabled = false; this.textContent = 'Refresh'; render(); };
  $('#chips').onclick = function (e) { var f = e.target.dataset && e.target.dataset.f; if (!f) return; if (f === 'hours') { openUrl(chrome.runtime.getURL('hours.html')); return; } if (f === 'brief') { openUrl(chrome.runtime.getURL('briefing.html')); return; } if (f === 'notes') { openUrl(chrome.runtime.getURL('notes.html')); return; } state.filter = f; try { localStorage.setItem('bpw_filter', f); } catch (x) {} render(); };
  $('#q').oninput = function () { state.q = this.value; render(); };
  $('#rows').addEventListener('click', async function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.classList.contains('tog')) { state.open[b.dataset.id] = !state.open[b.dataset.id]; try { localStorage.setItem('bpw_open', JSON.stringify(state.open)); } catch (x) {} render(); }
    if (b.classList.contains('note')) { openUrl(chrome.runtime.getURL('notes.html?acct=' + b.dataset.id)); return; }
    if (b.classList.contains('srcs')) { openUrl(chrome.runtime.getURL('review.html?acct=' + b.dataset.id)); return; }
    if (b.classList.contains('mute')) { var r = await send({ type: 'snooze', id: b.dataset.id, on: b.dataset.on === '1' }); if (r.snap) state.snap = r.snap; render(); }
  });
  $('#rows').addEventListener('change', async function (e) {
    if (!e.target.classList.contains('bud')) return;
    var v = e.target.value.replace(/[^0-9.]/g, '');
    var r = await send({ type: 'setBudget', id: e.target.dataset.id, value: v }); if (r.snap) state.snap = r.snap; render();
  });

  // ---------- CSV ----------
  async function exportDays(onlyToday) {
    var r = await send({ type: 'log' }); var log = r.dayLog || {};
    var days = Object.keys(log).sort(); if (onlyToday) days = days.slice(-1);
    if (!days.length) { $('#note').textContent = 'Nothing saved yet. Data is captured on each check.'; return; }
    var blob = new Blob([buildPaceCsv(log, r.names || {}, days)], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = onlyToday ? 'goal-pace-' + days[0] + '.csv' : 'goal-pace-' + days[0] + '-to-' + days[days.length - 1] + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  $('#csvToday').onclick = function () { exportDays(true); };
  $('#csvAll').onclick = function () { exportDays(false); };

  // ---------- load ----------
  send({ type: 'state' }).then(function (r) {
    state.snap = r.snap; state.settings = r.settings; state.notes = r.notes; render();
    if (!r.snap || !r.snap.at || Date.now() - r.snap.at > 120000) $('#refresh').click();
  });
  if (env.onMin && $('#pMin')) $('#pMin').onclick = env.onMin;
  if (env.onClose && $('#pClose')) $('#pClose').onclick = env.onClose;
};
if (location.protocol === 'chrome-extension:') BPW_UI(document, {});
