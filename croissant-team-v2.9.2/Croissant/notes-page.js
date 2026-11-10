(function () {
  var $ = function (s) { return document.querySelector(s); };
  var qs = new URLSearchParams(location.search);
  var only = qs.get('acct');
  var st = { view: ['recaps', 'checkins'].indexOf(qs.get('view')) >= 0 ? qs.get('view') : 'notes', notes: null, recaps: null, checkins: null, filter: 'ready' };
  var UPD = { notes: 'noteUpdate', recaps: 'recapUpdate', checkins: 'checkinUpdate' };
  function send(m) { return new Promise(function (r) { chrome.runtime.sendMessage(m, function (x) { r(x || {}); }); }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function time(t) { return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  function when(t) { return new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + time(t); }
  function dshort(ds) { var a = (ds || '').split('-'); return a.length < 3 ? '' : new Date(Date.UTC(+a[0], +a[1] - 1, +a[2])).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); }
  function cur() { return st[st.view]; }

  async function load() {
    var r = await Promise.all([send({ type: 'notes' }), send({ type: 'recaps' }), send({ type: 'checkins' })]);
    st.notes = r[0]; st.recaps = r[1]; st.checkins = r[2];
    var n = (st.checkins.items || []).filter(function (x) { return x.status === 'ready'; }).length;
    var tb = document.querySelector('#tabs [data-v=checkins]'); if (tb) tb.textContent = 'Check-ins' + (n ? ' (' + n + ')' : '');
    render();
  }
  function chips(x) {
    var out = '';
    if (x.kind === 'checkin') {
      out += '<span class="chip k">' + (x.lastAt ? x.quietDays + ' days since your last ' + esc(x.lastHow === 'talked' ? 'conversation' : x.lastHow) : 'No contact logged in ' + x.quietDays + ' days') + '</span>';
      return out;
    }
    if (x.kind === 'recap') {
      if (x.good) out += '<span class="chip">Standout week</span>';
      if (x.wk.l || !x.wk.k) out += '<span class="chip k">' + (x.wk.l || x.wk.k ? x.wk.l + ' quote request' + (x.wk.l === 1 ? '' : 's') : x.wk.c + ' clicks') + '</span>';
      if (x.wk.k) out += '<span class="chip k">' + x.wk.k + ' call' + (x.wk.k === 1 ? '' : 's') + '</span>';
      return out;
    }
    if (x.why.calls) out += '<span class="chip k">' + x.calls + ' inbound call' + (x.calls === 1 ? '' : 's') + '</span>';
    if (x.why.cvr) out += '<span class="chip">' + Math.round(x.pct) + '% conversion (' + x.leads + ' of ' + x.clicks + ' clicks)</span>';
    return out;
  }
  function card(x) {
    var stTxt = x.status === 'sent' ? '<span class="status ok">Opened to send ' + (x.kind === 'recap' ? when(x.statusAt) : 'at ' + time(x.statusAt)) + '</span>' : x.status === 'skipped' ? '<span class="status muted">Skipped</span>' : x.kind === 'recap' ? '' : '<span class="status muted">Ready since ' + time(x.at) + '</span>';
    return '<div class="note' + (x.status === 'ready' ? '' : ' done') + '" data-id="' + esc(x.id) + '">' +
      '<div class="nh"><b>' + esc(x.name) + '</b><span class="muted">#' + esc(x.id) + '</span><span class="sp"></span>' + stTxt + (x.url ? ' <a class="btn" href="' + esc(x.url) + '" target="_blank">Open in GOAL</a>' : '') + '</div>' +
      '<div class="why">' + chips(x) + '</div>' +
      '<div class="nb">' +
      '<label>To</label><input class="to" value="' + esc(x.to) + '" placeholder="owner@agency.com" spellcheck="false">' + (x.to ? '' : '<span class="warnTo">Couldn\'t find the owner\'s email in GOAL. Add it here.</span>') +
      (x.kind === 'recap' ? '<label>Report site</label><input class="rp" value="' + esc(x.report || '') + '" placeholder="https://agency-reports.vercel.app" spellcheck="false">' + (x.report ? '<span class="muted small">Saved for this account\'s future summaries too. <a href="' + esc(x.report) + '" target="_blank">Open site</a></span>' : '<span class="warnTo">No report site on file for this account. Paste its link here and it\'s added to the message and remembered.</span>') : '') +
      '<label>Subject</label><input class="su" value="' + esc(x.subject) + '">' +
      '<label>Message</label><textarea class="bo" rows="' + Math.max(12, x.body.split('\n').length + 1) + '">' + esc(x.body) + '</textarea>' +
      '<div class="acts"><button class="pri gm">Open in Gmail</button><button class="mt">Open in mail app</button><button class="cp">Copy message</button><span class="sp"></span>' +
      (x.status === 'ready' ? (x.kind === 'checkin' ? '<button class="tk" title="Counts as a touchpoint without sending this">Already talked to them</button>' : '') + '<button class="sk">' + (x.kind === 'recap' ? 'Skip this week' : 'Skip today') + '</button>' : '<button class="rd">Mark as not sent</button>') + '</div></div></div>';
  }
  function render() {
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === st.view); });
    var c = cur(); if (!c) return;
    var all = c.items || [];
    var items = only ? all.filter(function (x) { return String(x.id) === String(only); }) : all;
    $('#showAll').hidden = !only;
    var nReady = all.filter(function (x) { return x.status === 'ready'; }).length, nSent = all.filter(function (x) { return x.status === 'sent'; }).length;
    var head = '';
    if (st.view === 'recaps') {
      head = '<div class="rhead">' + (c.week ? '<span><b>' + dshort(c.from) + ' to ' + dshort(c.to) + '</b> · ' + nSent + ' of ' + all.length + ' sent, ' + nReady + ' to go</span>' : '<span class="muted">No summaries yet this week. They\'re drafted automatically on the day and time set in Settings.</span>') +
        '<span class="sp"></span>' + (only ? '' : '<span class="seg" id="flt"><button data-v="ready">To send</button><button data-v="all">All</button></span>') + '<button id="build">' + (c.week ? 'Rebuild now' : 'Draft summaries now') + '</button></div>';
      if (!only && st.filter === 'ready') items = items.filter(function (x) { return x.status === 'ready'; });
    } else if (st.view === 'checkins') head = '<div class="rhead"><span>Accounts with no contact in a while, longest first. A few each morning so it never piles up.</span></div>';
    else if (all.length > 1 && !only) head = '<div class="rhead"><span>' + nSent + ' of ' + all.length + ' sent today</span></div>';
    var empty = st.view === 'checkins' ? '<div class="ban info">Every active account has heard from you recently. Check-ins are drafted each morning for accounts with no contact in 14 days.</div>' : st.view === 'recaps' ? (c.week ? '<div class="ban info">All caught up on this week\'s summaries.</div>' : '') :
      '<div class="ban info">No client notes today yet. A note is drafted when an account converts at a high rate or gets several inbound calls in a day (set the levels in the popup under Settings, Client notes).</div>';
    $('#list').innerHTML = head + (items.length ? items.map(card).join('') : empty);
    document.querySelectorAll('#flt button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === st.filter); });
  }
  function fields(el) { return { to: el.querySelector('.to').value.trim(), subject: el.querySelector('.su').value, body: el.querySelector('.bo').value }; }
  async function save(id, f, status) {
    var m = Object.assign({ type: UPD[st.view], id: id }, f); if (status) m.status = status;
    var r = await send(m), c = cur();
    if (r.item) c.items = c.items.map(function (x) { return String(x.id) === String(id) ? r.item : x; });
  }

  $('#tabs').onclick = function (e) { var v = e.target.dataset && e.target.dataset.v; if (!v) return; st.view = v; only = null; history.replaceState(null, '', v === 'notes' ? 'notes.html' : '?view=' + v); render(); };
  $('#list').addEventListener('click', async function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.id === 'build') { b.disabled = true; b.textContent = 'Drafting...'; var r = await send({ type: 'recapNow' }); if (r.error) { b.textContent = r.error; return; } st.recaps = r; render(); return; }
    if (b.closest('#flt')) { st.filter = b.dataset.v; render(); return; }
    var el = b.closest('.note'); if (!el) return;
    var id = el.dataset.id, f = fields(el), from = st.view === 'notes' ? (cur().from || '') : (cur().mailFrom || '');
    if (b.classList.contains('gm') || b.classList.contains('mt')) {
      var url;
      if (b.classList.contains('gm')) url = 'https://mail.google.com/mail/?view=cm&fs=1' + (from ? '&authuser=' + encodeURIComponent(from) : '') + '&to=' + encodeURIComponent(f.to) + '&su=' + encodeURIComponent(f.subject) + '&body=' + encodeURIComponent(f.body);
      else url = 'mailto:' + encodeURIComponent(f.to).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(f.subject) + '&body=' + encodeURIComponent(f.body);
      window.open(url, '_blank');
      await save(id, f, 'sent'); render();
    } else if (b.classList.contains('cp')) {
      try { await navigator.clipboard.writeText(f.body); b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy message'; }, 1500); } catch (x) {}
      await save(id, f);
    } else if (b.classList.contains('sk')) { await save(id, f, 'skipped'); render(); }
    else if (b.classList.contains('tk')) { await send({ type: 'touch', id: id, how: 'talked' }); await save(id, f, 'skipped'); render(); }
    else if (b.classList.contains('rd')) { await save(id, f, 'ready'); render(); }
  });
  var RL = 'Your full performance reports are here anytime: ';
  function withReport(body, url) {
    var rx = /\n*Your full performance reports are here anytime: [^\n]*/;
    if (rx.test(body)) return url ? body.replace(rx, '\n\n' + RL + url) : body.replace(rx, '');
    if (!url) return body;
    var i = body.indexOf('\n\nHave a great weekend');
    return i >= 0 ? body.slice(0, i) + '\n\n' + RL + url + body.slice(i) : body + '\n\n' + RL + url;
  }
  $('#list').addEventListener('change', async function (e) {
    var el = e.target.closest('.note'); if (!el) return;
    if (e.target.classList.contains('rp')) {
      var url = e.target.value.trim();
      if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      var bo = el.querySelector('.bo'); bo.value = withReport(bo.value, url);
      var r = await send({ type: 'reportLink', id: el.dataset.id, url: url, body: bo.value });
      if (r.item) { st.recaps.items = st.recaps.items.map(function (x) { return String(x.id) === String(el.dataset.id) ? r.item : x; }); render(); }
      return;
    }
    save(el.dataset.id, fields(el));
  });
  load();
})();
