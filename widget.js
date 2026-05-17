(function () {
  const script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  if (!script) return;
  const p    = new URLSearchParams(new URL(script.src).search);
  const CID  = p.get('cid')  || '';
  const SLUG = p.get('slug') || '';
  if (!CID && !SLUG) return;

  const BASE   = new URL(script.src).origin;
  const FRAME  = `${BASE}/chat-frame.html?${CID ? 'cid='+CID : 'slug='+SLUG}`;
  let abierto  = false;
  let cargado  = false;

  /* ── CSS (solo el contenedor exterior, sin conflictos) ── */
  const style = document.createElement('style');
  style.textContent = `
    #at-root { position:fixed; bottom:24px; right:24px; z-index:2147483647; display:flex; flex-direction:column; align-items:flex-end; gap:14px; }

    #at-panel {
      width: 380px; height: 580px;
      border-radius: 20px; overflow: hidden;
      box-shadow: 0 12px 48px rgba(108,92,228,0.25), 0 2px 12px rgba(0,0,0,0.12);
      transform-origin: bottom right;
      transition: transform .28s cubic-bezier(.34,1.4,.64,1), opacity .22s;
    }
    #at-panel.at-off { transform: scale(0.82) translateY(20px); opacity: 0; pointer-events: none; }
    #at-panel iframe { width:100%; height:100%; border:none; display:block; border-radius:20px; }

    #at-btn {
      width: 60px; height: 60px; border-radius: 50%;
      background: #fff;
      border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 6px 24px rgba(108,92,228,0.45);
      transition: transform .2s, box-shadow .2s;
      position: relative; overflow: hidden; padding: 10px;
    }
    #at-btn:hover { transform: scale(1.1); box-shadow: 0 8px 32px rgba(108,92,228,0.58); }
    #at-btn .at-open  { display: flex; width:100%; height:100%; object-fit:contain; }
    #at-btn .at-close { display: none; color:#6C5CE4; }
    #at-btn.on .at-open  { display: none; }
    #at-btn.on .at-close { display: flex; }

    .at-ring {
      position: absolute; inset: 0; border-radius: 50%;
      background: rgba(108,92,228,0.35);
      animation: at-ring 2.2s ease-out 2s forwards;
      pointer-events: none;
    }
    @keyframes at-ring { 0%{transform:scale(1);opacity:.8} 100%{transform:scale(2.2);opacity:0} }
  `;
  document.head.appendChild(style);

  /* ── HTML ── */
  const root = document.createElement('div');
  root.id = 'at-root';
  root.innerHTML = `
    <div id="at-panel" class="at-off"></div>
    <button id="at-btn" aria-label="Chat de reservas">
      <div class="at-ring"></div>
      <img class="at-open" src="${BASE}/logo_attempo.png" alt="Attempo">
      <svg class="at-close" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>`;
  document.body.appendChild(root);

  const panel = document.getElementById('at-panel');
  const btn   = document.getElementById('at-btn');

  btn.addEventListener('click', function () {
    abierto = !abierto;
    panel.classList.toggle('at-off', !abierto);
    btn.classList.toggle('on', abierto);
    if (abierto && !cargado) {
      cargado = true;
      const iframe = document.createElement('iframe');
      iframe.src = FRAME;
      iframe.title = 'Chat de reservas';
      panel.appendChild(iframe);
    }
  });
})();
