// When the popup runs as the floating panel inside a GOAL page, switch to the panel layout.
(function () {
  if (/[?&]panel=1/.test(location.search)) document.documentElement.classList.add('panel');
  document.addEventListener('DOMContentLoaded', function () {
    if (!document.documentElement.classList.contains('panel')) return;
    var say = function (what) { try { parent.postMessage({ __bpwPanel: what }, '*'); } catch (e) {} };
    document.getElementById('pMin').onclick = function () { say('min'); };
    document.getElementById('pClose').onclick = function () { say('close'); };
  });
})();
