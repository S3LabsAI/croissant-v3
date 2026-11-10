// Builds the daily CSV (used by the Export buttons and the automatic end-of-day save).
// dayLog[day] = { a: {acctId: [name, spend, clicks, leads, calls, budget, budgetSource]},
//                 c: {acctId: [[campaignId, name, spend, clicks, leads, calls]]}, cap: {acctId: timestamp | 0} }
(function (root) {
  var SRC = { live: 'GOAL morning pull', captured: 'Opened in GOAL', snapshot: 'Oct 2 snapshot', manual: 'Set by you' };
  function cell(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function rate(l, c) { return c > 0 ? (l / c * 100).toFixed(2) : ''; }
  function cpl(s, l) { return l > 0 ? (s / l).toFixed(2) : ''; }
  function capTxt(t) {
    if (t == null) return '';
    if (t === 0) return 'before first check';
    return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  }
  root.buildPaceCsv = function (log, names, days) {
    var lines = [['Date', 'Level', 'Account ID', 'Account', 'Campaign ID', 'Campaign', 'Daily budget', 'Spend', 'Pace %', 'Hit budget at', 'Clicks', 'Leads', 'Calls', 'Conv. rate %', 'Cost per lead', 'Budget source']];
    days.forEach(function (d) {
      var e = log[d]; if (!e) return;
      var cap = e.cap || {};
      Object.keys(e.a).sort(function (x, y) { return (e.a[y][5] || 0) - (e.a[x][5] || 0) || (e.a[y][1] - e.a[x][1]); }).forEach(function (id) {
        var a = e.a[id], nm = (names && names[id]) || a[0], bud = a[5] || 0;
        lines.push([d, 'Account', id, nm, '', '', bud || '', a[1], bud > 0 ? (a[1] / bud * 100).toFixed(1) : '', capTxt(cap[id]), a[2], a[3], a[4], rate(a[3], a[2]), cpl(a[1], a[3]), SRC[a[6]] || a[6] || '']);
        (e.c && e.c[id] || []).forEach(function (c) {
          lines.push([d, 'Campaign', id, nm, c[0], c[1], '', c[2], '', '', c[3], c[4], c[5], rate(c[4], c[3]), cpl(c[2], c[4]), '']);
        });
      });
    });
    return lines.map(function (r) { return r.map(cell).join(','); }).join('\n');
  };
})(typeof self !== 'undefined' ? self : this);
