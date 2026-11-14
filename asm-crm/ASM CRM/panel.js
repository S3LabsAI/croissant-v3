// Floating ASM CRM panel, flush in the bottom-right corner of GOAL pages, like the original bookmarklet:
// 470px wide, grows with its content up to 72% of the window, live numbers from the extension's checks.
// "-" shrinks it to a croissant pill; "x" hides it on this page until reload. Off switch: Settings, Floating panel.
(function () {
  var VER = chrome.runtime.getManifest().version;
  if (window.top !== window || window.__bpwPanel === VER) return;   // a copy from an older version doesn't block this one
  window.__bpwPanel = VER;
  var host, root, ui = { min: false, filter: 'all' }, hidden = false, snap = null;

  function get(k) { return new Promise(function (r) { try { chrome.storage.local.get(k, r); } catch (e) { r({}); } }); }
  function send(m) { return new Promise(function (r) { try { chrome.runtime.sendMessage(m, function (x) { void chrome.runtime.lastError; r(x || {}); }); } catch (e) { r({}); } }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(n) { return '$' + (+n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function money0(n) { return '$' + Math.round(+n || 0).toLocaleString('en-US'); }
  function clk(t) { return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' AM', 'a').replace(' PM', 'p'); }
  function cls(p) { return p == null ? 'n' : p >= 100 ? 'x' : p >= 75 ? 'w' : p >= 50 ? 'q' : ''; }
  function saveUi() { try { chrome.storage.local.set({ panelUi: ui }); } catch (e) {} }

  var CSS = ':host{all:initial}' +
    '*{box-sizing:border-box}' +
    '.wrap{position:fixed;right:0;bottom:0;margin:0;z-index:2147483000;font:13px/1.4 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#ededee}' +
    '.box{display:flex;flex-direction:column;background:#1c1d20;border:1px solid #3e4045;border-right:0;border-bottom:0;border-radius:12px 0 0 0;box-shadow:-6px -6px 28px rgba(0,0,0,.35);overflow:hidden}' +
    '.head{display:flex;align-items:center;gap:8px;padding:9px 12px;background:linear-gradient(180deg,#1b1c1f,#121314);border-bottom:1px solid #313337}' +
    '.head b{font-size:13px}.head small{color:#a6a9ae;font-size:11px}.sp{flex:1}' +
    'button{font:inherit;color:#ededee;background:#242528;border:1px solid #3e4045;border-radius:7px;padding:3px 8px;cursor:pointer;font-size:12px}' +
    'button:hover{border-color:#4fd1c5;color:#4fd1c5}button.on{background:#4fd1c5;border-color:#4fd1c5;color:#06202b}' +
    '.sum{display:flex;gap:14px;padding:7px 12px;border-bottom:1px solid #313337;font-size:11px;color:#a6a9ae}' +
    '.sum b{color:#ededee;font-size:14px;display:block;font-variant-numeric:tabular-nums}.sum .x b{color:#e2603f}.sum .w b{color:#e0a93b}' +
    '.chips{display:flex;gap:4px;padding:7px 12px;border-bottom:1px solid #313337}.chips button{border-radius:999px;font-size:11.5px;padding:2px 10px}' +
    '.ban{padding:6px 12px;font-size:12px}.ban.err{background:rgba(226,96,63,.16);color:#f08a72}' +
    '.body{overflow:auto;flex:1 1 auto;min-height:0}' +
    'table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px;color:#ededee}td,th{font-family:inherit;line-height:1.35}td{color:#ededee}' +
    'col.c2{width:74px}col.c3{width:76px}col.c4{width:78px}' +
    'th{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#a6a9ae;text-align:left;padding:6px 10px;border-bottom:1px solid #313337;font-weight:600;position:sticky;top:0;background:#1c1d20}' +
    'td{padding:6px 10px;border-bottom:1px solid #26272b;vertical-align:middle}' +
    '.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}' +
    '.nm{display:block;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nm small{color:#7c7f86;margin-left:4px}' +
    'a.lnk{color:#ededee;text-decoration:none;cursor:pointer}a.lnk:hover{color:#4fd1c5;text-decoration:underline}' +
    '.tag{font-size:9.5px;font-weight:700;padding:0 6px;border-radius:999px;margin-left:5px;background:rgba(224,169,59,.16);color:#e0a93b}.tag.cv{background:rgba(226,96,63,.16);color:#f08a72}.tag.nt{background:rgba(47,191,113,.16);color:#2fbf71;cursor:pointer}' +
    '.bar{height:5px;background:#2d2f33;border-radius:3px;margin-top:4px;position:relative;overflow:hidden}' +
    '.bar i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:#2fbf71}.bar.w i{background:#e0a93b}.bar.x i{background:#e2603f}.bar.q i{background:#5aa6e6}' +
    '.pct{font-weight:600}.pct.w{color:#e0a93b}.pct.x{color:#e2603f}.pct.q{color:#5aa6e6}.pct.n{color:#7c7f86;font-weight:400}' +
    '.sub{display:block;font-size:10.5px;color:#7c7f86}.sub.hot{color:#f08a72}' +
    'input.bud{width:62px;font:inherit;background:#121314;color:#ededee;border:1px solid #3e4045;border-radius:5px;padding:2px 5px;text-align:right}input.bud:focus{outline:none;border-color:#4fd1c5}' +
    '.foot{display:flex;gap:6px;align-items:center;padding:7px 12px;border-top:1px solid #313337;font-size:11px;color:#a6a9ae}' +
    '.empty{padding:14px 12px;color:#7c7f86;font-size:12px}' +
    '.pill{display:flex;align-items:center;gap:10px;cursor:pointer;background:#1c1d20;border:1px solid #3e4045;border-right:0;border-bottom:0;border-radius:14px 0 0 0;padding:8px 14px 8px 12px;box-shadow:-4px -4px 18px rgba(0,0,0,.3);font-size:12.5px;user-select:none}' +
    '.pill:hover{border-color:#4fd1c5}.pill .c{font-size:17px}.pill .x{color:#e2603f}.pill .w{color:#e0a93b}.pill .m{color:#a6a9ae}' +
    '[hidden]{display:none!important}';

  // The open panel is the full toolbar view, built right into the page (no frame), sitting flush in the corner.
  async function viewMarkup() {
    var h = await (await fetch(chrome.runtime.getURL('popup.html'))).text();
    var c = await (await fetch(chrome.runtime.getURL('popup.css'))).text();
    var body = (h.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, ''])[1].replace(/<script[\s\S]*?<\/script>/gi, '');
    c = c.replace(/html\.panel /g, '.bpw-root.panel ').replace(/html,\s*body\s*\{/g, '.bpw-root{').replace(/(^|\})\s*body\s*\{/g, '$1.bpw-root{').replace(/(^|[},])\s*html\s*\{/g, '$1.bpw-root{');
    body = body.replace(/src="icons\//g, 'src="' + chrome.runtime.getURL('icons/'));
    return { body: body, css: c };
  }
  async function build() {
    // Remove any panel left behind by an earlier version of the extension (it can't update itself).
    document.querySelectorAll('#bpw-panel-host').forEach(function (el) { el.remove(); });
    host = document.createElement('div');
    host.id = 'bpw-panel-host';
    root = host.attachShadow({ mode: 'open' });
    var v = await viewMarkup();
    root.innerHTML = '<style>' + CSS + v.css +
      '.bpw-root{width:720px!important;max-width:100vw;height:calc(100vh - 64px)!important;text-align:left;line-height:1.4;letter-spacing:normal}' +
      '.bpw-root #rows td{padding-top:5px!important;padding-bottom:5px!important}.bpw-root .bar{margin-top:3px!important}.bpw-root table{font-size:inherit}.bpw-root input,.bpw-root select,.bpw-root button{font-family:inherit}</style>' +
      '<div class="wrap"><div class="box" id="box"><div class="bpw-root panel">' + v.body + '</div></div>' +
      '<div class="pill" id="pill" hidden title="Open ASM CRM"></div></div>';
    (document.body || document.documentElement).appendChild(host);
    root.querySelector('#pill').onclick = function () { ui.min = false; saveUi(); render(); };
    self.BPW_UI(root, {
      open: function (u) { send({ type: 'openUrl', url: u }); },
      onMin: function () { ui.min = true; saveUi(); render(); },
      onClose: function () { hidden = true; render(); }
    });
  }

  function flagged(r) { return !!(r.flag || r.cflag || r.campFlags); }
  function render() {
    if (!host) return;
    var $ = function (s) { return root.querySelector(s); };
    host.style.display = hidden ? 'none' : '';
    $('#box').hidden = ui.min; $('#pill').hidden = !ui.min;
    var rows = (snap && snap.rows) || [], live = rows.filter(function (r) { return !r.snoozed; });
    var spent = 0, bud = 0, capped = 0, hot = 0, nf = 0;
    rows.forEach(function (r) { spent += r.spend || 0; bud += r.bud || 0; });
    live.forEach(function (r) { if (r.pct >= 100) capped++; else if (r.pct >= 75) hot++; if (flagged(r)) nf++; });
    var notConnected = !snap || snap.err === 'auth';
    $('#pill').innerHTML = '<span class="c">&#129360;</span><b>' + money0(spent) + '</b><span class="m">spent</span>' +
      (capped ? '<span class="x"><b>' + capped + '</b> at 100%</span>' : '') + (hot ? '<span class="w"><b>' + hot + '</b> at 75%+</span>' : '') +
      (nf ? '<span class="w"><b>' + nf + '</b> flagged</span>' : '') + (notConnected ? '<span class="x">not connected</span>' : '');
  }

  try {
    chrome.storage.onChanged.addListener(function (ch, area) {
      if (area !== 'local') return;
      if (ch.snap) { snap = ch.snap.newValue; render(); }
      if (ch.panelUi && ch.panelUi.newValue) { ui = Object.assign(ui, ch.panelUi.newValue); render(); }
      if (ch.settings && ch.settings.newValue && ch.settings.newValue.panelOn === false && host) { host.remove(); host = null; }
    });
  } catch (e) {}

  async function start() {
    var g = await get(['settings', 'panelUi', 'snap']);
    if (g.settings && g.settings.panelOn === false) return;
    ui = Object.assign(ui, g.panelUi || {});
    snap = g.snap || null;
    await build(); render();
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
