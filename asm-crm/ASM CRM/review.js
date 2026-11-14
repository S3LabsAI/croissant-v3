(function () {
  var $ = function (s) { return document.querySelector(s); };
  var acct = new URLSearchParams(location.search).get('acct');
  var state = { rv: null, bid: null };
  function send(m) { return new Promise(function (r) { chrome.runtime.sendMessage(m, function (x) { r(x || {}); }); }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(n) { return n == null ? '-' : (Math.round(n * 1000) / 10) + '%'; }
  function pct100(n) { return n == null ? '-' : (Math.round(n * 10) / 10) + '%'; }
  function money(n) { return '$' + (+n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function when(t) { var d = new Date(t); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }

  async function load(refresh) {
    $('#refresh').disabled = true;
    if (refresh) $('#camps').innerHTML = '<div class="muted pad">Loading sources from GOAL...</div>';
    var r = await Promise.all([send({ type: 'review', acct: acct, refresh: !!refresh }), send({ type: 'bidState' })]);
    state.rv = r[0]; state.bid = r[1];
    $('#refresh').disabled = false;
    render();
  }

  function render() {
    var rv = state.rv, bid = state.bid || {};
    if (!rv || rv.error) { $('#banners').innerHTML = '<div class="ban err">' + esc(rv ? rv.error : 'No data.') + '</div>'; $('#camps').innerHTML = ''; $('#applyBar').hidden = true; return; }
    document.title = 'Sources: ' + rv.name;
    $('#title').textContent = rv.name;
    $('#sub').textContent = '#' + rv.acct + ' · sources as of ' + when(rv.at);
    $('#bestHours').href = 'hours.html?acct=' + encodeURIComponent(rv.acct); if (rv.url) { $('#openGoal').href = rv.url; $('#openGoal').hidden = false; }

    var b = '';
    if (rv.flag === 'nolead') b += '<div class="ban warn"><b>No leads in the last ' + rv.run + ' clicks.</b> This account normally converts ' + pct100(rv.runNorm) + ' of clicks.</div>';
    else if (rv.flag === 'cvr') b += '<div class="ban warn"><b>Conversion rate is down:</b> ' + pct100(rv.cvr) + ' today vs. ' + pct100(rv.tcvr) + ' normally.</div>';
    else b += '<div class="ban warn"><b>A campaign\'s conversion rate is down.</b> See the campaigns below.</div>';
    if (rv.brokenForm) b += '<div class="ban err"><b>Every source with clicks today has stopped converting.</b> That points to the form, landing page or call routing rather than the traffic, so no bid increases are proposed. Check the site first.</div>';
    if (!bid.canWrite) b += '<div class="ban info"><b>One-time step to apply changes from here:</b> change any source\'s multiplier by hand on a GOAL Source Settings page (any campaign, any account). The extension learns how GOAL saves it and can apply approved changes after that. Until then, use "Open Source Settings" and enter the numbers below yourself.' + (bid.why && bid.why.length ? ' <span class="muted">(Last try: ' + esc(bid.why.join('; ')) + '.)</span>' : '') + '</div>';
    if (rv.pct >= 95) b += '<div class="ban info">This account is at ' + Math.round(rv.pct) + '% of today\'s budget. Higher bids on the best sources shift spend toward them; they won\'t add volume today.</div>';
    $('#banners').innerHTML = b;

    var nProp = 0;
    $('#camps').innerHTML = rv.campaigns.map(function (c) {
      var rows = c.rows.filter(function (x) { return x.today.c > 0 || x.d14.c > 0; });
      var body = rows.map(function (x) {
        var canTick = x.propose && x.propose.to != null && !x.skip;
        if (canTick) nProp++;
        var multTxt = x.mult == null ? '<span class="muted">?</span>' : pct100(x.mult);
        var propTxt = canTick ? pct100(x.propose.from) + ' &rarr; <span class="prop-to">' + x.propose.to + '%</span>' : x.skip === 'current multiplier not known yet' ? '<span class="prop-to">Raise 10%</span> <span class="muted small">(25 points max)</span>' : x.skip ? '<span class="muted small">' + esc(x.skip) + '</span>' : '';
        var tags = (x.culprit ? '<span class="tag bad" title="Clicks today with far fewer leads than this source normally gets">Likely culprit</span>' : '') + (x.propose || x.skip ? '<span class="tag good" title="Among the best 14-day converters in this campaign">Top converter</span>' : '');
        return '<tr class="' + (x.culprit ? 'culprit' : canTick ? 'prop' : '') + '">' +
          '<td class="c">' + (canTick ? '<input type="checkbox" class="pick" data-camp="' + c.id + '" data-key="' + esc(x.key) + '"' + (bid.canWrite ? ' checked' : ' disabled') + '>' : '') + '</td>' +
          '<td>' + esc(x.name) + tags + '</td>' +
          '<td class="r">' + x.today.c + '</td><td class="r">' + x.today.l + '</td><td class="r">' + money(x.today.s) + '</td>' +
          '<td class="r">' + pct(x.d14.rate) + ' <span class="muted small">(' + x.d14.l + '/' + x.d14.c + ')</span></td>' +
          '<td class="r">' + multTxt + '</td><td class="r">' + propTxt + '</td></tr>';
      }).join('');
      return '<div class="card"><h2>' + esc(c.name) + ' <small>#' + c.id + ' · campaign converts ' + pct(c.campRate) + ' over 14 days</small><a href="' + esc(c.settingsUrl) + '" target="_blank">Open Source Settings</a></h2>' +
        '<div class="tw"><table><thead><tr><th class="c"></th><th>Source</th><th class="r">Clicks today</th><th class="r">Leads today</th><th class="r">Spend today</th><th class="r">14-day conv.</th><th class="r">Multiplier</th><th class="r">Proposed</th></tr></thead><tbody>' +
        (body || '<tr><td colspan="8" class="muted pad">No source activity in the last 14 days.</td></tr>') + '</tbody></table></div></div>';
    }).join('') || '<div class="muted pad">No active campaigns found.</div>';

    $('#applyBar').hidden = !nProp;
    updateApply();
    var log = (bid.log || []).filter(function (e) { return String(e.acct) === String(acct); });
    $('#logWrap').hidden = !log.length;
    $('#log').innerHTML = log.map(function (e) { return '<div class="li">' + when(e.at) + ' · ' + esc(e.campName) + ' / ' + esc(e.name) + ': ' + e.from + '% &rarr; ' + e.to + '% ' + (e.verified ? '<span class="ok">confirmed</span>' : e.ok ? '<span class="warn">sent, not confirmed</span>' : '<span class="bad">failed</span>') + '</div>'; }).join('');
  }
  function picked() { return Array.prototype.slice.call(document.querySelectorAll('.pick:checked')).map(function (el) { return { camp: el.dataset.camp, key: el.dataset.key }; }); }
  function updateApply() {
    var n = picked().length, can = state.bid && state.bid.canWrite;
    $('#apply').disabled = !can || !n;
    $('#apply').textContent = can ? (n ? 'Apply ' + n + ' change' + (n === 1 ? '' : 's') : 'Nothing selected') : 'Apply (needs the one-time step above)';
  }
  document.addEventListener('change', function (e) { if (e.target.classList.contains('pick')) updateApply(); });

  $('#apply').onclick = async function () {
    var ch = picked(); if (!ch.length) return;
    this.disabled = true; this.textContent = 'Applying...';
    var r = await send({ type: 'applyBids', acct: acct, changes: ch });
    var html = r.error ? '<div class="ban err">' + esc(r.error) + '</div>' : (r.results || []).map(function (x) {
      return '<div class="res">' + (x.verified ? '<span class="ok">Confirmed</span>' : x.ok ? '<span class="warn">Sent, GOAL didn\'t confirm the new value yet</span>' : '<span class="bad">Not changed</span>') + ' · ' + esc(x.campName || '') + (x.campName ? ' / ' : '') + esc(x.name || x.key) + (x.to ? ': ' + x.from + '% &rarr; ' + x.to + '%' : '') + (x.why ? ' <span class="muted">(' + esc(x.why) + ')</span>' : x.ok || x.verified ? '' : ' <span class="muted">(GOAL answered ' + x.status + ')</span>') + '</div>';
    }).join('');
    $('#results').innerHTML = '<h3>Result</h3>' + html;
    await load(true);
  };
  $('#refresh').onclick = function () { load(true); };
  load(false);
})();
