(function () {
  'use strict';

  /* ── Detectar el script y extraer el slug ── */
  var script = document.currentScript;
  if (!script) {
    var all = document.querySelectorAll('script[data-slug], script[src*="widget.js"]');
    script = all[all.length - 1];
  }
  if (!script) return;

  var slug = script.getAttribute('data-slug');
  if (!slug) {
    try { slug = new URL(script.src).searchParams.get('slug'); } catch(e) {}
  }
  if (!slug || slug === 'TU_SLUG') return;

  var BASE  = 'https://app.attempo.cl';
  var FRAME = BASE + '/' + encodeURIComponent(slug) + '?widget=1';
  var abierto = false;
  var cargado = false;

  /* ── Estilos ── */
  var style = document.createElement('style');
  style.textContent = [
    '#at-root{position:fixed;bottom:24px;right:24px;z-index:2147483647;width:60px;height:60px}',
    '#at-panel{position:absolute;bottom:74px;right:0;width:390px;height:640px;border-radius:20px;overflow:hidden;box-shadow:0 12px 48px rgba(108,92,228,.25),0 2px 12px rgba(0,0,0,.12);transform-origin:bottom right;transition:transform .28s cubic-bezier(.34,1.4,.64,1),opacity .22s}',
    '#at-panel.at-off{transform:scale(0.82) translateY(20px);opacity:0;pointer-events:none}',
    '#at-panel iframe{width:100%;height:100%;border:none;display:block;border-radius:20px}',
    '#at-btn{width:60px;height:60px;border-radius:50%;background:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 24px rgba(108,92,228,.45);transition:transform .2s,box-shadow .2s;position:relative;overflow:hidden;padding:10px;touch-action:manipulation;-webkit-tap-highlight-color:transparent}',
    '#at-btn:hover{transform:scale(1.1);box-shadow:0 8px 32px rgba(108,92,228,.58)}',
    '#at-btn .at-open{display:flex;width:100%;height:100%;object-fit:contain}',
    '#at-btn .at-close{display:none;color:#6C5CE4}',
    '#at-btn.on .at-open{display:none}#at-btn.on .at-close{display:flex}',
    '.at-ring{position:absolute;inset:0;border-radius:50%;background:rgba(108,92,228,.35);animation:at-ring 2.2s ease-out 2s forwards;pointer-events:none}',
    '@keyframes at-ring{0%{transform:scale(1);opacity:.8}100%{transform:scale(2.2);opacity:0}}',
    '@media(max-width:480px){#at-root{bottom:16px;right:16px}#at-panel{position:fixed;bottom:88px;left:8px;right:8px;width:auto;height:calc(100svh - 104px);border-radius:16px}#at-panel iframe{border-radius:16px}}'
  ].join('');
  document.head.appendChild(style);

  /* ── DOM ── */
  var root = document.createElement('div');
  root.id = 'at-root';
  root.innerHTML = [
    '<div id="at-panel" class="at-off"></div>',
    '<button id="at-btn" aria-label="Agendar cita">',
    '<div class="at-ring"></div>',
    '<img class="at-open" src="' + BASE + '/logo_attempo.png" alt="attempo" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">',
    '<svg class="at-open" style="display:none;align-items:center;justify-content:center;width:32px;height:32px" viewBox="0 0 24 24" fill="#6C5CE4"><rect width="20" height="20" x="2" y="2" rx="5"/><path d="M7 9h10M7 13h7" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
    '<svg class="at-close" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    '</button>'
  ].join('');
  document.body.appendChild(root);

  var panel = document.getElementById('at-panel');
  var btn   = document.getElementById('at-btn');

  btn.addEventListener('click', function () {
    abierto = !abierto;
    panel.classList.toggle('at-off', !abierto);
    btn.classList.toggle('on', abierto);
    if (abierto && !cargado) {
      cargado = true;
      var iframe = document.createElement('iframe');
      iframe.src   = FRAME;
      iframe.title = 'Agendar cita';
      iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
      iframe.setAttribute('allow', 'clipboard-write');
      panel.appendChild(iframe);
    }
  });

  /* Cerrar desde dentro del iframe */
  window.addEventListener('message', function (e) {
    if (e.origin !== BASE) return;
    if (e.data === 'attempo:close') {
      abierto = false;
      panel.classList.add('at-off');
      btn.classList.remove('on');
    }
  });
})();
