(function () {
  var $ = function (s) { return document.querySelector(s); };
  function send(m) { return new Promise(function (r) { chrome.runtime.sendMessage(m, function (x) { r(x || {}); }); }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money0(n) { return '$' + Math.round(+n || 0).toLocaleString('en-US'); }
  function clock(t) { return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' AM', 'am').replace(' PM', 'pm'); }
  function dlong(ds) { var a = ds.split('-'); return new Date(Date.UTC(+a[0], +a[1] - 1, +a[2])).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }); }
  function dshort(t) { return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  function nm(x) { return '<span class="nm">' + (x.url ? '<a href="' + esc(x.url) + '" target="_blank">' + esc(x.name) + '</a>' : esc(x.name)) + ' <span class="muted">#' + esc(x.id) + '</span></span>'; }
  function list(items, fn, empty) { return items.length ? items.map(fn).join('') : '<div class="empty">' + empty + '</div>'; }

  async function load() {
    $('#refresh').disabled = true;
    var b = await send({ type: 'briefing' });
    $('#refresh').disabled = false;
    var h = +new Date().toLocaleString('en-US', { hour: 'numeric', hourCycle: 'h23' });
    $('#hello').textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    $('#sub').textContent = dlong(b.day) + (b.today && b.today.at ? ' · as of ' + clock(b.today.at) : '');
    var Y = b.yesterday, W = b.waiting;
    var html = '<div class="bgrid">';
    // Yesterday
    html += '<div class="bcard wide"><h3>Yesterday (' + dlong(b.yday) + ')</h3><div class="kpis"><div><small>Spend</small><b>' + money0(Y.spend) + '</b></div><div><small>Leads</small><b>' + Y.leads + '</b></div><div><small>Calls</small><b>' + Y.calls + '</b></div><div><small>Accounts running</small><b>' + Y.accounts + '</b></div><div><small>Hit budget</small><b>' + Y.capped.length + '</b></div></div>';
    var bright = [];
    Y.topCalls.forEach(function (x) { bright.push('<div class="li">' + nm(x) + '<span class="v g">' + x.k + ' calls</span></div>'); });
    Y.topLeads.filter(function (x) { return !Y.topCalls.some(function (c) { return c.id === x.id; }); }).slice(0, 5 - Math.min(5, Y.topCalls.length) + 2).forEach(function (x) { bright.push('<div class="li">' + nm(x) + '<span class="v g">' + x.l + ' leads</span></div>'); });
    if (bright.length) html += '<div class="sub2">Bright spots</div>' + bright.join('');
    if (Y.capped.length) html += '<div class="sub2">Hit budget</div>' + Y.capped.map(function (x) { return '<div class="li">' + nm(x) + '<span class="v">' + (x.at ? 'at ' + clock(x.at) : 'before tracking') + '</span></div>'; }).join('');
    html += '</div>';
    // Client emails waiting
    html += '<div class="bcard wide"><h3>Client emails ready</h3><div class="waits">' +
      '<a class="wt" href="notes.html" target="_blank"><b>' + W.notes + '</b><small>Strong-intent notes today</small></a>' +
      '<a class="wt" href="notes.html?view=checkins" target="_blank"><b>' + W.checkins + '</b><small>Check-ins</small></a>' +
      '<a class="wt" href="notes.html?view=recaps" target="_blank"><b>' + W.summaries + '</b><small>Weekly summaries to send</small></a></div></div>';
    // Today
    html += '<div class="bcard"><h3>Needs a look today</h3>' + list(b.flags, function (x) {
      return '<div class="li">' + nm(x) + '<span class="v ' + (x.kind === 'cvr' ? 'r' : 'a') + '">' + esc(x.text) + '</span>' + (x.sources ? '<a class="btn" target="_blank" href="review.html?acct=' + esc(x.id) + '">Sources</a>' : '') + '</div>';
    }, 'Nothing flagged so far today.') + '</div>';
    html += '<div class="bcard"><h3>On track to hit budget before noon</h3>' + list(b.early, function (x) {
      return '<div class="li">' + nm(x) + '<span class="v">' + Math.round(x.pct) + '% now, ~' + clock(x.capAt) + '</span></div>';
    }, 'None so far.') + '</div>';
    // Touchpoints
    html += '<div class="bcard wide"><h3>Due for a touchpoint</h3>' + list(b.due, function (x) {
      return '<div class="li" data-id="' + esc(x.id) + '">' + nm(x) + '<span class="v a">' + (x.last ? x.days + ' days since your last ' + esc(x.how === 'talked' ? 'conversation' : x.how) : 'nothing logged in ' + x.days + ' days') + '</span><button class="tk">Talked to them</button></div>';
    }, 'Every active account has heard from you in the last ' + 14 + ' days.') +
      (b.touchSince && Date.now() - b.touchSince < 15 * 86400000 ? '<div class="sub2">Tracking started ' + dshort(b.touchSince) + '. Notes, summaries and check-ins you open to send count automatically; use "Talked to them" for calls and meetings.</div>' : '') + '</div>';
    // Bids
    html += '<div class="bcard wide"><h3>Bid changes this week</h3>' + list(b.bids, function (e) {
      return '<div class="li"><span class="nm">' + esc(e.acctName || ('#' + e.acct)) + ' <span class="muted">' + esc(e.campName) + ' / ' + esc(e.name) + '</span></span><span class="v">' + e.from + '% to ' + e.to + '% · ' + dshort(e.at) + '</span><span class="v ' + (e.verified ? 'g">confirmed' : e.ok ? 'a">sent' : 'r">not changed') + '</span><a class="btn" target="_blank" href="review.html?acct=' + esc(e.acct) + '">Sources</a></div>';
    }, 'No bid changes from the extension in the last week.') + '</div>';
    html += '</div>';
    $('#b').innerHTML = html;
  }
  $('#b').addEventListener('click', async function (e) {
    var t = e.target.closest('.tk'); if (!t) return;
    var row = t.closest('.li'); t.disabled = true; t.textContent = 'Logged';
    await send({ type: 'touch', id: row.dataset.id, how: 'talked' });
    row.style.opacity = .45;
  });
  $('#refresh').onclick = load;
  load();
})();
