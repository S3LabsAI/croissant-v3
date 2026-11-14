(function () {
  var $ = function (s) { return document.querySelector(s); };
  var qs = new URLSearchParams(location.search);
  var st = { days: 28, type: 'all', id: qs.get('acct') || 'all', rep: null, q: '' };
  try { var sv = JSON.parse(localStorage.getItem('hoursOpts') || '{}'); if (sv.days) st.days = sv.days; if (sv.type) st.type = sv.type; } catch (e) {}
  function send(m) { return new Promise(function (r) { chrome.runtime.sendMessage(m, function (x) { r(x || {}); }); }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(n) { return n == null ? '-' : (Math.round(n * 1000) / 10) + '%'; }
  function money(n) { return n == null ? '-' : '$' + (+n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function money0(n) { return n == null ? '-' : '$' + Math.round(+n).toLocaleString('en-US'); }
  function hl(h) { h = h % 24; return h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p'; }
  function hlong(h) { h = h % 24; return h === 0 ? '12am' : h < 12 ? h + 'am' : h === 12 ? '12pm' : (h - 12) + 'pm'; }

  function segs() {
    [['#days', st.days], ['#type', st.type]].forEach(function (p) { document.querySelectorAll(p[0] + ' button').forEach(function (b) { b.classList.toggle('on', b.dataset.v == p[1]); }); });
  }
  async function load() {
    segs();
    st.rep = await send({ type: 'hours', opts: { days: st.days, type: st.type, id: st.id } });
    render();
  }

  function status(rep) {
    var b = rep.backfill || {}, out = '';
    if (b.ok === false) out = '<div class="ban warn">GOAL\'s hour-by-hour numbers didn\'t match its daily totals, so this report builds from the extension\'s own checks instead. It gets more reliable each day Chrome is open (' + rep.liveDays + ' day' + (rep.liveDays === 1 ? '' : 's') + ' so far).</div>';
    else if (!b.done) out = '<div class="ban info">Filling in recent days from GOAL in the background: ' + b.daysDone + ' of ' + b.of + ' days so far. Check back in a bit for the full picture.</div>';
    return out;
  }
  function itemTxt(a) {
    if (!a.enough) return 'Not enough data yet';
    if (a.best) return '<span class="g">Best ' + esc(a.best.windows) + '</span>';
    return 'No standout hours';
  }
  function renderList(rep) {
    var q = st.q.trim().toLowerCase().replace('#', '');
    var items = [{ id: 'all', name: 'All accounts', enough: rep.all.enough, best: rep.all.best }].concat(rep.accounts)
      .filter(function (a) { return !q || a.id === 'all' || a.name.toLowerCase().indexOf(q) >= 0 || String(a.id).indexOf(q) >= 0; });
    $('#list').innerHTML = items.map(function (a) {
      return '<button class="it' + (String(a.id) === String(st.id) ? ' on' : '') + '" data-id="' + esc(a.id) + '"><b>' + esc(a.name) + (a.id !== 'all' ? ' <span class="muted">#' + esc(a.id) + '</span>' : '') + '</b><small>' + itemTxt(a) + '</small></button>';
    }).join('') || '<div class="muted pad">No accounts match.</div>';
  }

  function chart(d) {
    var rows = d.rows, first = 0, last = 23;
    while (first < 23 && !rows[first].c) first++;
    while (last > first && !rows[last].c) last--;
    var hs = rows.slice(first, last + 1);
    var W = 760, H = 230, pl = 40, pr = 8, pt = 12, mid = 150, cb = 210;
    var bw = (W - pl - pr) / hs.length;
    var maxR = Math.max.apply(null, hs.map(function (r) { return r.low ? 0 : (r.rate || 0); }).concat([d.rate || 0])) * 1.15 || 0.1;
    var maxC = Math.max.apply(null, hs.map(function (r) { return r.c; })) || 1;
    var y = function (v) { return pt + (mid - pt) * (1 - v / maxR); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Conversion rate and clicks by hour">';
    [0, 0.5, 1].forEach(function (f) { var v = maxR / 1.15 * f, yy = y(v); svg += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + yy + '" y2="' + yy + '" stroke="#26272b"/><text x="' + (pl - 6) + '" y="' + (yy + 3) + '" text-anchor="end">' + Math.round(v * 1000) / 10 + '%</text>'; });
    hs.forEach(function (r, i) {
      var x = pl + i * bw + bw * 0.14, w = bw * 0.72;
      var col = r.mark === 'best' ? '#2fbf71' : r.mark === 'weak' ? '#e2603f' : '#5b6068';
      if (!r.low && r.rate != null) svg += '<rect x="' + x + '" y="' + y(r.rate) + '" width="' + w + '" height="' + (mid - y(r.rate)) + '" rx="2" fill="' + col + '"><title>' + hlong(r.h) + ': ' + pct(r.rate) + ' (' + r.l + ' leads / ' + r.c + ' clicks)</title></rect>';
      else if (r.c) svg += '<rect x="' + x + '" y="' + (mid - 2) + '" width="' + w + '" height="2" fill="#3e4045"><title>' + hlong(r.h) + ': fewer than 30 clicks, too few to judge (' + r.c + ')</title></rect>';
      var ch = (cb - mid - 22) * r.c / maxC;
      svg += '<rect x="' + x + '" y="' + (cb - ch) + '" width="' + w + '" height="' + ch + '" rx="1.5" fill="#4fd1c5" opacity=".55"><title>' + hlong(r.h) + ': ' + r.c + ' clicks, ' + money0(r.s) + '</title></rect>';
      if (hs.length <= 16 || i % 2 === 0) svg += '<text x="' + (x + w / 2) + '" y="' + (cb + 13) + '" text-anchor="middle">' + hl(r.h) + '</text>';
    });
    if (d.rate) svg += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(d.rate) + '" y2="' + y(d.rate) + '" stroke="#ededee" stroke-dasharray="4 4" opacity=".6"/><text x="' + (W - pr) + '" y="' + (y(d.rate) - 4) + '" text-anchor="end" fill="#ededee">avg ' + pct(d.rate) + '</text>';
    svg += '<text x="' + pl + '" y="' + (mid + 16) + '">Clicks</text></svg>';
    return svg + '<div class="legend"><span><i style="background:#2fbf71"></i>Converts clearly better than average</span><span><i style="background:#e2603f"></i>Clearly worse</span><span><i style="background:#5b6068"></i>About average</span><span><i style="background:#4fd1c5;opacity:.55"></i>Clicks</span></div>';
  }

  function renderDetail(rep) {
    var d = rep.detail;
    if (!d) { $('#detail').innerHTML = '<div class="muted pad">Pick an account.</div>'; return; }
    var head = '<div class="dhead"><h2>' + esc(d.name) + '</h2>' + (d.id !== 'all' ? '<span class="muted">#' + esc(d.id) + '</span>' : '') + '<span class="sp"></span>' +
      (d.url ? '<a class="btn" href="' + esc(d.url) + '" target="_blank">Open in GOAL</a>' : '') + '<button id="csv">Export CSV</button></div>';
    var kp = '<div class="kpis"><div><small>Days</small><b>' + d.days + '</b></div><div><small>Spend</small><b>' + money0(d.s) + '</b></div><div><small>Clicks</small><b>' + d.c.toLocaleString() + '</b></div><div><small>Leads</small><b>' + d.l.toLocaleString() + '</b></div><div><small>Conv. rate</small><b>' + pct(d.rate) + '</b></div><div><small>Cost per lead</small><b>' + money(d.cpl) + '</b></div></div>';
    var facts = [];
    if (!d.c) facts.push('No clicks in this range yet.');
    else if (!d.enough) facts.push('Not enough data to call best hours yet. It needs at least 7 days and 200 clicks; so far ' + d.days + ' day' + (d.days === 1 ? '' : 's') + ' and ' + d.c + ' clicks.');
    else {
      if (d.best) facts.push('Converts best <span class="g">' + esc(d.best.windows) + '</span>: ' + pct(d.best.rate) + ' of clicks vs. ' + pct(d.rate) + ' overall' + (d.best.cpl && d.cpl ? ', at ' + money0(d.best.cpl) + ' per lead vs. ' + money0(d.cpl) : '') + '. ' + Math.round(d.best.share * 100) + '% of spend lands in those hours.');
      if (d.weak) facts.push('Weakest <span class="r">' + esc(d.weak.windows) + '</span>: ' + pct(d.weak.rate) + ' of clicks' + (d.weak.cpl ? ', ' + money0(d.weak.cpl) + ' per lead' : '') + '. ' + Math.round(d.weak.share * 100) + '% of spend.');
      if (!d.best && !d.weak) facts.push('No hour stands out. Conversion is steady through the day, within normal variation.');
    }
    var tbl = '<div class="tw"><table class="ht"><thead><tr><th>Hour</th><th class="r">Spend</th><th class="r">Share</th><th class="r">Clicks</th><th class="r">Leads</th><th class="r">Calls</th><th class="r">Conv. rate</th><th class="r">Cost per lead</th></tr></thead><tbody>' +
      d.rows.filter(function (r) { return r.c || r.s; }).map(function (r) {
        return '<tr class="' + (r.mark || (r.low ? 'low' : '')) + '"><td>' + hlong(r.h) + ' to ' + hlong(r.h + 1) + '</td><td class="r">' + money0(r.s) + '</td><td class="r">' + Math.round(r.share * 100) + '%</td><td class="r">' + r.c + '</td><td class="r">' + Math.round(r.l) + '</td><td class="r">' + Math.round(r.k) + '</td><td class="r">' + (r.low ? '<span class="muted">few clicks</span>' : pct(r.rate)) + '</td><td class="r">' + money0(r.cpl) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    $('#detail').innerHTML = '<div class="dcard">' + head + '<ul class="facts"><li>' + facts.join('</li><li>') + '</li></ul>' + kp + '</div>' +
      (d.c ? '<div class="dcard chart"><h3>Conversion rate and clicks by hour</h3>' + chart(d) + '</div><div class="card">' + tbl + '</div>' : '');
    var b = $('#csv'); if (b) b.onclick = exportCsv;
  }
  async function exportCsv() {
    var r = await send({ type: 'hoursCsv', opts: { days: st.days, type: st.type, id: st.id } });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([r.csv || ''], { type: 'text/csv' }));
    a.download = 'best-hours-' + (st.id === 'all' ? 'all-accounts' : st.id) + '-' + st.days + 'd.csv';
    a.click();
  }
  function render() { var rep = st.rep; if (!rep || !rep.accounts) return; $('#status').innerHTML = status(rep); renderList(rep); renderDetail(rep); }

  $('#list').onclick = function (e) { var b = e.target.closest('.it'); if (!b) return; st.id = b.dataset.id; history.replaceState(null, '', '?acct=' + encodeURIComponent(st.id)); load(); };
  $('#q').oninput = function () { st.q = this.value; if (st.rep) renderList(st.rep); };
  ['#days', '#type'].forEach(function (sel) {
    $(sel).onclick = function (e) { var v = e.target.dataset && e.target.dataset.v; if (!v) return; if (sel === '#days') st.days = +v; else st.type = v; try { localStorage.setItem('hoursOpts', JSON.stringify({ days: st.days, type: st.type })); } catch (x) {} load(); };
  });
  load();
})();
