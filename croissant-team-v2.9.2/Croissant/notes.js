// Client notes: when an account shows strong prospect intent today (high conversion and/or inbound calls), prompt you
// with a short, ready-to-send email to the account owner. Nothing is ever sent by the extension: you review it and send
// it yourself from Gmail or your mail app.
//
// Storage 'notes': { day, items: { accountId: { id, name, day, at, why:{cvr,calls}, clicks, leads, calls, pct, to, first,
//                    subject, body, status: 'ready'|'sent'|'skipped' } }, sent: { accountId: timestamp } }

function noteFirst(u) {
  var f = u && (u.first_name || u.firstName || (u.name && String(u.name).split(' ')[0]) || null);
  return f ? String(f).trim().replace(/^./, function (c) { return c.toUpperCase(); }) : null;
}
// Owner's email and first name, cached a week. Read-only lookup with your admin session.
async function ownerContact(token, id) {
  var g = await get('contacts'), C = g.contacts || {};
  var c = C[id];
  if (c && Date.now() - c.at < 7 * 86400000) return c;
  var A = { Authorization: token, 'admin-token': token };
  var r = await goalReq('GET', '/api/v1/get_users_by_account?account_id=' + encodeURIComponent(id), A);
  if (r.status === 401) throw new AuthError();
  if (!r.ok) return c || null;
  var users = listOf(await r.json()).filter(function (u) { return u && u.email; });
  if (!users.length) return c || null;
  var owner = users.find(function (u) { return /owner/i.test(u.role_name || (u.role && u.role.name) || ''); }) || users[0];
  c = { at: Date.now(), email: owner.email, first: noteFirst(owner) };
  C[id] = c;
  await set({ contacts: C });
  return c;
}

function notePct(n) { return String(Math.round(n)); }
function noteDraft(x, s) {
  var hi = 'Hi ' + (x.first || 'there') + ',';
  var sig = (s.noteSig || '').trim();
  var callLine = x.calls + ' inbound call' + (x.calls === 1 ? '' : 's');
  var cvrLine = x.leads + ' of your ' + x.clicks + ' clicks turned into quote requests (' + notePct(x.pct) + '%)';
  var subject, body;
  if (x.why.calls && x.why.cvr) {
    subject = 'Great prospect intent on your campaign today';
    body = [hi, '',
      'Quick note on today: ' + cvrLine + ', and your campaign has brought in ' + callLine + ' so far.',
      '',
      'That\'s a strong sign the people finding you are ready to buy, not just browsing. Inbound calls are the highest intent of all: the prospect has already shopped around and wants to talk to someone now, so they tend to close at a much higher rate.',
      '',
      'A quick callback on anything you missed today is the best way to turn that intent into written policies.'].join('\n');
  } else if (x.why.calls) {
    subject = callLine.replace(/^./, function (c) { return c.toUpperCase(); }) + ' today';
    body = [hi, '',
      'Quick note: your campaign has brought in ' + callLine + ' so far today.',
      '',
      'A prospect who picks up the phone is about as high intent as it gets. They\'ve already compared options and want to talk to someone now, so these calls tend to close at a much higher rate than other leads.',
      '',
      'If any went to voicemail, a same-day callback makes a big difference.'].join('\n');
  } else {
    subject = 'Strong prospect intent on your campaign today';
    body = [hi, '',
      'Quick note on today: ' + cvrLine + '.',
      '',
      'That\'s a strong sign the people finding you are serious shoppers who are ready to buy. Fast follow-up is the best way to turn that intent into written policies, and any of them who call in are worth answering live.'].join('\n');
  }
  body += '\n\nLet me know if you\'d like to talk through what\'s coming in.' + (sig ? '\n\n' + sig : '');
  return { subject: subject, body: body };
}

// Called after each check. Returns the notes it newly prompted.
async function checkNotes(token, snap, s) {
  if (!s.noteOn || !snap || !snap.rows) return [];
  var today = snap.day;
  var g = await get('notes'), N = g.notes || {};
  if (N.day !== today) N = { day: today, items: {}, sent: N.sent || {} };
  var fresh = [];
  for (var i = 0; i < snap.rows.length; i++) {
    var r = snap.rows[i];
    if (N.items[r.id] || r.snoozed) continue;
    var last = N.sent[r.id];
    if (last && Date.now() - last < s.noteCooldown * 86400000) continue;
    var pct = r.clicks > 0 ? r.leads / r.clicks * 100 : 0;
    var why = { cvr: s.noteCvrOn && r.clicks >= s.noteMinClicks && pct >= s.noteCvrPct, calls: s.noteCallsOn && r.calls >= s.noteCalls };
    if (!why.cvr && !why.calls) continue;
    var ct = null;
    try { ct = await ownerContact(token, r.id); } catch (e) { if (e.auth) throw e; }
    var x = { id: r.id, name: r.name, url: r.url, day: today, at: Date.now(), why: why, clicks: r.clicks, leads: r.leads, calls: r.calls, pct: pct,
      to: ct ? ct.email : '', first: ct ? ct.first : null, status: 'ready' };
    Object.assign(x, noteDraft(x, s));
    N.items[r.id] = x;
    fresh.push(x);
  }
  if (fresh.length) {
    await set({ notes: N });
    var reason = function (x) { return x.why.calls && x.why.cvr ? x.calls + ' calls and ' + Math.round(x.pct) + '% conversion' : x.why.calls ? x.calls + ' inbound calls' : Math.round(x.pct) + '% conversion (' + x.leads + ' of ' + x.clicks + ' clicks)'; };
    if (fresh.length <= 3) fresh.forEach(function (x) { notify('note:' + x.id + ':' + Date.now(), 'Note ready for ' + x.name, reason(x) + ' today. Click to review the email and send it.'); });
    else notify('note:all:' + Date.now(), fresh.length + ' accounts are ready for a client note', fresh.slice(0, 4).map(function (x) { return x.name; }).join(', ') + (fresh.length > 4 ? ' and more' : '') + '. Click to review.');
  } else if (g.notes && g.notes.day !== today) await set({ notes: N });
  return fresh;
}

async function notesState() {
  var g = await get(['notes', 'settings']), N = g.notes || { items: {} };
  var items = Object.keys(N.items || {}).map(function (k) { return N.items[k]; }).sort(function (a, b) { return (a.status === 'ready' ? 0 : 1) - (b.status === 'ready' ? 0 : 1) || a.at - b.at; });
  return { day: N.day || null, items: items, from: ((g.settings || {}).noteFrom || '') };
}
async function noteUpdate(m) {
  return serial(async function () {
    var g = await get('notes'), N = g.notes; if (!N || !N.items[m.id]) return { error: 'Note not found.' };
    var x = N.items[m.id];
    ['to', 'subject', 'body'].forEach(function (k) { if (typeof m[k] === 'string') x[k] = m[k]; });
    if (m.status) { x.status = m.status; x.statusAt = Date.now(); N.sent = N.sent || {}; if (m.status === 'sent') N.sent[m.id] = Date.now(); else delete N.sent[m.id]; }
    await set({ notes: N });
    return { ok: true, item: x };
  });
}
