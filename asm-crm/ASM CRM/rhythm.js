// Learns how each account usually spends through the GOAL day (midnight to midnight Pacific).
// Every check records spend so far. When a day ends, that day becomes a 24-point curve:
// the share of the day's final spend reached by the end of each hour. The typical curve is the
// median of recent days of the same kind (weekday or weekend). With fewer than 2 days for an
// account, it borrows the median shape across all accounts.

// Today's spend-so-far points: { day, pts: { accountId: { minuteOfGoalDay: spend } } }
function recordPoint(intra, today, spend, minute) {
  if (!intra || intra.day !== today) intra = { day: today, pts: {} };
  Object.keys(spend).forEach(function (id) {
    var s = spend[id].s;
    if (!(s > 0) && !intra.pts[id]) return;
    var p = intra.pts[id] = intra.pts[id] || {};
    p[minute] = Math.round(s * 100) / 100;
    var ks = Object.keys(p);
    if (ks.length > 300) delete p[ks.map(Number).sort(function (a, b) { return a - b; })[0]];
  });
  return intra;
}

function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  for (var i = 1; i < xs.length; i++) {
    if (x <= xs[i]) { var t = (x - xs[i - 1]) / ((xs[i] - xs[i - 1]) || 1); return ys[i - 1] + t * (ys[i] - ys[i - 1]); }
  }
  return ys[ys.length - 1];
}

// One finished day -> 24 hourly fractions, or null if we didn't see enough of the day.
function dayCurve(pts, finalSpend) {
  if (!pts || !(finalSpend > 5)) return null;
  var ms = Object.keys(pts).map(Number).sort(function (a, b) { return a - b; });
  if (ms.length < 4 || ms[ms.length - 1] - ms[0] < 240) return null;
  var xs = [0], ys = [0];
  ms.forEach(function (m) { if (m > 0 && m < 1440) { xs.push(m); ys.push(Math.max(Math.min(pts[m], finalSpend), ys[ys.length - 1])); } });
  xs.push(1440); ys.push(finalSpend);
  var out = [];
  for (var h = 1; h <= 24; h++) out.push(Math.round(interp(xs, ys, h * 60) / finalSpend * 1000) / 1000);
  for (var i = 1; i < 24; i++) if (out[i] < out[i - 1]) out[i] = out[i - 1];
  out[23] = 1;
  return out;
}

// Turn yesterday's points into curves using the final day totals from GOAL. Keeps 14 days.
function finalizeCurves(curves, intra, hist) {
  curves = curves || { days: {} };
  if (!intra || !intra.day) return curves;
  var finals = (hist && hist[intra.day]) || {};
  var dayOut = {};
  Object.keys(intra.pts).forEach(function (id) {
    var f = finals[id]; var F = Array.isArray(f) ? f[0] : f;
    var c = dayCurve(intra.pts[id], F);
    if (c) dayOut[id] = c;
  });
  if (Object.keys(dayOut).length) curves.days[intra.day] = dayOut;
  var keep = Object.keys(curves.days).sort().slice(-14), out = { days: {} };
  keep.forEach(function (d) { out.days[d] = curves.days[d]; });
  return out;
}

function medianCurve(list) {
  if (!list.length) return null;
  var out = [];
  for (var h = 0; h < 24; h++) {
    var v = list.map(function (c) { return c[h]; }).sort(function (a, b) { return a - b; });
    out.push(v[Math.floor(v.length / 2)]);
  }
  for (var i = 1; i < 24; i++) if (out[i] < out[i - 1]) out[i] = out[i - 1];
  out[23] = 1;
  return out;
}

// { c: [24], src: 'account' | 'pooled', n } or null
function typicalCurve(curves, id, today) {
  if (!curves || !curves.days) return null;
  var wk = isWeekend(today);
  var days = Object.keys(curves.days).filter(function (d) { return d !== today && isWeekend(d) === wk; });
  if (id != null) {
    var own = days.map(function (d) { return curves.days[d][id]; }).filter(Boolean);
    if (own.length >= 2) return { c: medianCurve(own), src: 'account', n: own.length };
    return null;
  }
  var all = [];
  days.forEach(function (d) { Object.keys(curves.days[d]).forEach(function (k) { all.push(curves.days[d][k]); }); });
  return all.length >= 3 ? { c: medianCurve(all), src: 'pooled', n: all.length } : null;
}

// Share of a normal day's spend done by this minute of the GOAL day.
function fracAt(c, minute) {
  var xs = [0], ys = [0];
  for (var h = 1; h <= 24; h++) { xs.push(h * 60); ys.push(c[h - 1]); }
  return interp(xs, ys, minute);
}
// Minute of the GOAL day when a normal day reaches this share (0..1), or null.
function minuteFor(c, target) {
  if (target <= 0) return 0;
  var px = 0, py = 0;
  for (var h = 1; h <= 24; h++) {
    var x = h * 60, y = c[h - 1];
    if (y >= target) { var t = (target - py) / ((y - py) || 1); return Math.round(px + t * (x - px)); }
    px = x; py = y;
  }
  return null;
}
