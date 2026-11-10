// Runs on GOAL admin/portal pages. Hands your existing GOAL admin sign-in to the
// extension so it can read spend in the background. Never sent anywhere but GOAL's API.
(function () {
  var last = null;
  function send() {
    try {
      var t = JSON.parse(localStorage.getItem('authAdminUser') || '{}').token || null;
      if (t && t !== last) {
        last = t;
        chrome.runtime.sendMessage({ type: 'token', token: t });
      }
    } catch (e) {}
  }
  send();
  setInterval(send, 60000);
  // Budgets read by hook.js when GOAL loads an account's campaigns.
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (e.source !== window || !d) return;
    try {
      if (d.__bpw === 'budgets') chrome.runtime.sendMessage({ type: 'captured', accountId: d.accountId, brandId: d.brandId, wk: d.wk });
      else if (d.__bpw === 'learn') chrome.runtime.sendMessage({ type: 'learn', kind: d.kind, url: d.url, method: d.method, body: d.body, rows: d.rows, pageUrl: d.pageUrl });
    } catch (x) {}
  });
})();
