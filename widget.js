(function () {
  const script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  if (!script) return;
  const params  = new URLSearchParams(new URL(script.src).search);
  const CID     = params.get('cid');
  const SLUG    = params.get('slug');
  if (!CID && !SLUG) return;

  const BASE    = new URL(script.src).origin;
  const SURL    = 'https://xztqawulvrtjvtfixofy.supabase.co';
  const SKEY    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dHFhd3VsdnJ0anZ0Zml4b2Z5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MTQ4OTgsImV4cCI6MjA5MjI5MDg5OH0.nMxUfN_pR3FImpO6l9MsYo9Z5B-0KU1ZHfbPor2qgu8';
  const SH      = { apikey: SKEY, Authorization: `Bearer ${SKEY}` };

  /* ── ESTILOS ── */
  const css = `
  #at-wrap *{box-sizing:border-box;margin:0;padding:0;font-family:'Geist','Segoe UI',system-ui,sans-serif}
  #at-wrap{position:fixed;bottom:24px;right:24px;z-index:99999;display:flex;flex-direction:column;align-items:flex-end;gap:12px}

  /* Burbuja */
  #at-bubble{
    width:56px;height:56px;border-radius:50%;
    background:linear-gradient(135deg,#8B7CF8,#4F3EE0);
    border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;
    box-shadow:0 4px 20px rgba(108,92,228,0.45);
    transition:transform .2s,box-shadow .2s;flex-shrink:0;
  }
  #at-bubble:hover{transform:scale(1.08);box-shadow:0 6px 28px rgba(108,92,228,0.55)}
  #at-bubble.open{background:linear-gradient(135deg,#6C5CE4,#4F3EE0)}
  #at-bubble svg{color:#fff;transition:transform .25s}
  #at-bubble.open .at-ico-chat{display:none}
  #at-bubble:not(.open) .at-ico-close{display:none}
  .at-pulse{
    position:absolute;width:56px;height:56px;border-radius:50%;
    background:rgba(108,92,228,0.3);animation:at-pulse 2s ease-out 1.5s;pointer-events:none;
  }
  @keyframes at-pulse{0%{transform:scale(1);opacity:.7}100%{transform:scale(1.9);opacity:0}}

  /* Panel */
  #at-panel{
    width:360px;height:530px;
    background:#F8F7FF;border-radius:16px;overflow:hidden;
    box-shadow:0 8px 40px rgba(108,92,228,0.18),0 2px 8px rgba(0,0,0,0.08);
    display:flex;flex-direction:column;
    transform-origin:bottom right;
    transition:transform .25s cubic-bezier(.34,1.4,.64,1),opacity .2s;
  }
  #at-panel.at-hidden{transform:scale(0.85) translateY(16px);opacity:0;pointer-events:none}

  /* Header */
  .at-hd{
    background:linear-gradient(135deg,#1E1B3A,#16143A);
    padding:14px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0;
  }
  .at-hd-av{
    width:36px;height:36px;border-radius:50%;flex-shrink:0;
    background:linear-gradient(135deg,#8B7CF8,#6C5CE4);
    display:flex;align-items:center;justify-content:center;
    font-size:11px;font-weight:700;color:#fff;font-family:'Geist Mono',monospace;
    box-shadow:0 2px 8px rgba(108,92,228,0.5);
  }
  .at-hd-info{flex:1;min-width:0}
  .at-hd-name{font-size:13px;font-weight:600;color:#fff;letter-spacing:-.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .at-hd-status{display:flex;align-items:center;gap:5px;font-size:11px;color:rgba(255,255,255,0.55);margin-top:1px}
  .at-dot{width:6px;height:6px;border-radius:50%;background:#16A34A;flex-shrink:0;animation:at-blink 2.5s ease-in-out infinite}
  @keyframes at-blink{0%,100%{opacity:1}50%{opacity:.4}}
  .at-close-btn{width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.7);font-size:16px;transition:background .15s;flex-shrink:0}
  .at-close-btn:hover{background:rgba(255,255,255,0.18);color:#fff}

  /* Mensajes */
  .at-msgs{flex:1;overflow-y:auto;padding:14px 12px 8px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}
  .at-msgs::-webkit-scrollbar{width:3px}
  .at-msgs::-webkit-scrollbar-thumb{background:rgba(108,92,228,0.2);border-radius:3px}
  .at-msg{display:flex;gap:8px;max-width:88%;animation:at-fadeup .2s ease}
  @keyframes at-fadeup{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
  .at-msg.ai{align-self:flex-start}
  .at-msg.user{align-self:flex-end;flex-direction:row-reverse}
  .at-msg-av{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#8B7CF8,#4F3EE0);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;flex-shrink:0;margin-top:2px;box-shadow:0 1px 4px rgba(108,92,228,0.3)}
  .at-bubble-msg{padding:9px 12px;font-size:13px;line-height:1.6;word-break:break-word}
  .at-msg.ai  .at-bubble-msg{background:#fff;border:1px solid rgba(108,92,228,0.1);color:#16143A;border-radius:3px 12px 12px 12px;box-shadow:0 1px 4px rgba(108,92,228,0.06)}
  .at-msg.user .at-bubble-msg{background:linear-gradient(135deg,#6C5CE4,#4F3EE0);color:#fff;border-radius:12px 3px 12px 12px;box-shadow:0 2px 8px rgba(108,92,228,0.3)}

  /* Chips */
  .at-chips{display:flex;flex-wrap:wrap;gap:6px;padding-left:36px;margin-top:4px;animation:at-fadeup .22s ease}
  .at-chip{padding:5px 12px;background:#fff;border:1.5px solid rgba(108,92,228,0.25);border-radius:100px;font-size:11px;font-weight:500;color:#6C5CE4;cursor:pointer;transition:all .15s;white-space:nowrap;user-select:none}
  .at-chip:hover{background:rgba(108,92,228,0.07);border-color:#6C5CE4;transform:translateY(-1px)}

  /* Slots */
  .at-slots{padding-left:36px;margin-top:6px;animation:at-fadeup .22s ease}
  .at-slot-lbl{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#9C96B4;margin-bottom:5px}
  .at-slot-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;max-width:260px;margin-bottom:8px}
  .at-slot-btn{padding:7px 4px;background:#fff;border:1.5px solid rgba(108,92,228,0.15);border-radius:7px;font-size:12px;font-family:'Geist Mono','Courier New',monospace;font-weight:500;color:#5E5880;cursor:pointer;transition:all .15s;text-align:center}
  .at-slot-btn:hover{border-color:#6C5CE4;color:#6C5CE4;background:rgba(108,92,228,0.06);transform:translateY(-1px)}

  /* Typing */
  .at-typing .at-bubble-msg{padding:11px 14px}
  .at-dots{display:flex;gap:3px;align-items:center}
  .at-dots span{width:5px;height:5px;border-radius:50%;background:#C4C0D8;animation:at-bounce 1.2s ease-in-out infinite}
  .at-dots span:nth-child(2){animation-delay:.2s}
  .at-dots span:nth-child(3){animation-delay:.4s}
  @keyframes at-bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-4px)}}

  /* Confirmación */
  .at-confirm{background:#fff;border:1px solid rgba(22,163,74,0.22);border-radius:12px;padding:14px 16px;margin-top:6px;max-width:260px;margin-left:36px}
  .at-confirm-ico{width:34px;height:34px;border-radius:50%;background:rgba(22,163,74,0.1);display:flex;align-items:center;justify-content:center;font-size:15px;margin-bottom:8px;animation:at-pop .4s cubic-bezier(.34,1.56,.64,1)}
  @keyframes at-pop{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}
  .at-confirm-title{font-size:12px;font-weight:700;color:#16143A;margin-bottom:7px}
  .at-confirm-row{display:flex;gap:6px;font-size:11px;margin-bottom:3px}
  .at-confirm-row b{color:#9C96B4;font-weight:500;min-width:58px;flex-shrink:0}
  .at-confirm-row span{color:#16143A;font-weight:600}

  /* Input */
  .at-bar{flex-shrink:0;padding:10px 12px;background:#fff;border-top:1px solid rgba(108,92,228,0.1);display:flex;gap:8px;align-items:flex-end}
  .at-inp{flex:1;padding:9px 12px;border:1.5px solid rgba(108,92,228,0.15);border-radius:20px;font-size:13px;color:#16143A;background:#F8F7FF;outline:none;resize:none;max-height:80px;overflow-y:auto;transition:border-color .12s;line-height:1.45}
  .at-inp:focus{border-color:#6C5CE4}
  .at-inp::placeholder{color:#C4C0D8}
  .at-send{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#6C5CE4,#4F3EE0);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(108,92,228,0.3);transition:all .15s;flex-shrink:0}
  .at-send:hover{transform:scale(1.08)}
  .at-send:disabled{opacity:.35;cursor:not-allowed;transform:none}
  .at-send svg{color:#fff}

  /* Loading */
  .at-loading{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:#9C96B4;font-size:12px}
  .at-spin{width:24px;height:24px;border:2px solid rgba(108,92,228,0.2);border-top-color:#6C5CE4;border-radius:50%;animation:at-spin .7s linear infinite}
  @keyframes at-spin{to{transform:rotate(360deg)}}

  @media(max-width:480px){
    #at-wrap{bottom:0;right:0}
    #at-panel{width:100vw;height:100dvh;border-radius:0}
    #at-bubble{bottom:16px;right:16px;position:fixed}
  }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ── HTML ── */
  const wrap = document.createElement('div');
  wrap.id = 'at-wrap';
  wrap.innerHTML = `
    <div id="at-panel" class="at-hidden">
      <div class="at-hd">
        <div class="at-hd-av">tt</div>
        <div class="at-hd-info">
          <div class="at-hd-name" id="at-biz-name">Cargando...</div>
          <div class="at-hd-status"><span class="at-dot"></span>En línea</div>
        </div>
        <button class="at-close-btn" id="at-close-btn">✕</button>
      </div>
      <div class="at-msgs" id="at-msgs">
        <div class="at-loading" id="at-loading"><div class="at-spin"></div><span>Conectando...</span></div>
      </div>
      <div class="at-bar">
        <textarea class="at-inp" id="at-inp" placeholder="Escribe tu respuesta..." rows="1"></textarea>
        <button class="at-send" id="at-send">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>
    <div style="position:relative">
      <div class="at-pulse"></div>
      <button id="at-bubble">
        <svg class="at-ico-chat" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <svg class="at-ico-close" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  document.body.appendChild(wrap);

  /* ── ESTADO ── */
  let clienteId = CID || null;
  let negocioNombre = '';
  let historial = [];
  let enviando = false;
  let abierto = false;
  let cargado = false;

  const panel  = document.getElementById('at-panel');
  const bubble = document.getElementById('at-bubble');
  const msgs   = document.getElementById('at-msgs');
  const inp    = document.getElementById('at-inp');
  const send   = document.getElementById('at-send');

  document.getElementById('at-close-btn').addEventListener('click', toggle);
  bubble.addEventListener('click', toggle);
  send.addEventListener('click', enviar);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } });
  inp.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 80) + 'px';
    quitarChips();
  });

  /* ── TOGGLE ── */
  function toggle() {
    abierto = !abierto;
    panel.classList.toggle('at-hidden', !abierto);
    bubble.classList.toggle('open', abierto);
    if (abierto && !cargado) { cargado = true; cargar(); }
    if (abierto) setTimeout(() => msgs.scrollTop = msgs.scrollHeight, 50);
  }

  /* ── CARGAR NEGOCIO ── */
  async function cargar() {
    try {
      let rows;
      if (clienteId) {
        const r = await fetch(`${SURL}/rest/v1/clientes_sistema?id=eq.${clienteId}&select=id,nombre_negocio&limit=1`, { headers: SH });
        rows = await r.json();
      } else {
        const r = await fetch(`${SURL}/rest/v1/clientes_sistema?booking_slug=eq.${encodeURIComponent(SLUG)}&select=id,nombre_negocio&limit=1`, { headers: SH });
        rows = await r.json();
      }
      if (!Array.isArray(rows) || !rows.length) throw new Error('not found');
      clienteId = rows[0].id;
      negocioNombre = rows[0].nombre_negocio || 'la clínica';
      document.getElementById('at-biz-name').textContent = negocioNombre;
    } catch(_) {
      negocioNombre = 'la clínica';
      document.getElementById('at-biz-name').textContent = 'Reservas';
    }
    document.getElementById('at-loading')?.remove();
    mostrarBienvenida();
  }

  /* ── BIENVENIDA ── */
  const CHIPS_INICIAL = ['Quiero agendar una cita', 'Horarios de atención', 'Ver servicios', 'Otra consulta'];

  function mostrarBienvenida() {
    agregarMsg('ai', `¡Hola! Bienvenido/a a ${negocioNombre}. Soy Attia, tu asistente virtual. ¿En qué puedo ayudarte hoy?`, null, CHIPS_INICIAL);
  }

  /* ── CHIPS CONTEXTUALES ── */
  function getChips(texto) {
    const t = texto.toLowerCase();
    if (t.includes('nombre') || t.includes('llamas')) return [];
    if (t.includes('motivo') || t.includes('tipo de consulta') || t.includes('en qué puedo')) return ['Consulta general', 'Control', 'Primera consulta', 'Urgencia'];
    if (t.includes('qué día') || t.includes('fecha') || t.includes('cuándo')) return ['Hoy', 'Mañana', 'Esta semana'];
    if (t.includes('todo correcto') || t.includes('¿confirm') || t.includes('procedemos') || t.includes('¿agend')) return ['Sí, confirmar', 'No, cambiar algo'];
    if (t.includes('email') || t.includes('correo')) return ['No tengo email'];
    return [];
  }

  /* ── ENVIAR ── */
  async function enviar(textoDirecto) {
    if (enviando) return;
    const texto = textoDirecto || inp.value.trim();
    if (!texto) return;
    inp.value = ''; inp.style.height = '';
    quitarChips();
    agregarMsg('user', texto);
    historial.push({ role: 'user', content: texto });
    enviando = true; send.disabled = true;
    mostrarTyping();
    const r = await llamarIA();
    quitarTyping();
    enviando = false; send.disabled = false;
    if (r) {
      historial.push({ role: 'assistant', content: r.mensaje });
      if (r.slots_disponibles?.length) {
        agregarMsg('ai', r.mensaje, null, null, r.slots_disponibles);
      } else {
        const chips = r.cita_creada ? [] : getChips(r.mensaje);
        agregarMsg('ai', r.mensaje, r.cita_creada, chips);
      }
    }
  }

  async function llamarIA() {
    try {
      const r = await fetch(`${BASE}/api/ai-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: historial, cliente_id: clienteId, negocio_nombre: negocioNombre })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      return d;
    } catch(e) {
      agregarMsg('ai', 'Ups, hubo un problema. ¿Puedes intentar de nuevo?');
      return null;
    }
  }

  /* ── UI ── */
  function agregarMsg(rol, texto, cita, chips, slots) {
    const div = document.createElement('div');
    div.className = `at-msg ${rol}`;
    if (rol === 'ai') {
      div.innerHTML = `<div class="at-msg-av">tt</div><div class="at-bubble-msg">${esc(texto)}</div>`;
    } else {
      div.innerHTML = `<div class="at-bubble-msg">${esc(texto)}</div>`;
    }
    msgs.appendChild(div);

    if (cita) msgs.appendChild(cardConfirmacion(cita));

    if (slots?.length) {
      msgs.appendChild(renderSlots(slots));
    } else if (chips?.length) {
      const cd = document.createElement('div');
      cd.className = 'at-chips'; cd.id = 'at-chips';
      chips.forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'at-chip'; btn.textContent = c;
        btn.addEventListener('click', () => enviar(c));
        cd.appendChild(btn);
      });
      msgs.appendChild(cd);
    }
    msgs.scrollTop = msgs.scrollHeight;
  }

  function renderSlots(slots) {
    const manana = slots.filter(s => parseInt(s) < 13);
    const tarde  = slots.filter(s => parseInt(s) >= 13);
    const wrap = document.createElement('div');
    wrap.className = 'at-slots'; wrap.id = 'at-chips';
    function sec(label, lista) {
      if (!lista.length) return;
      const s = document.createElement('div');
      const l = document.createElement('div'); l.className = 'at-slot-lbl'; l.textContent = label;
      const g = document.createElement('div'); g.className = 'at-slot-grid';
      lista.forEach(h => {
        const b = document.createElement('button'); b.className = 'at-slot-btn'; b.textContent = h;
        b.addEventListener('click', () => enviar(h));
        g.appendChild(b);
      });
      s.appendChild(l); s.appendChild(g); wrap.appendChild(s);
    }
    sec('Mañana', manana); sec('Tarde', tarde);
    return wrap;
  }

  function cardConfirmacion(cita) {
    const fecha = cita.fecha ? new Date(cita.fecha + 'T12:00:00').toLocaleDateString('es-CL', { weekday:'long', day:'numeric', month:'long' }) : '—';
    const hora  = cita.hora ? cita.hora.slice(0,5) : '—';
    const div = document.createElement('div'); div.className = 'at-confirm';
    div.innerHTML = `
      <div class="at-confirm-ico">✓</div>
      <div class="at-confirm-title">Cita confirmada</div>
      <div class="at-confirm-row"><b>Paciente</b><span>${esc(cita.nombre_paciente||'—')}</span></div>
      <div class="at-confirm-row"><b>Fecha</b><span>${fecha}</span></div>
      <div class="at-confirm-row"><b>Hora</b><span>${hora}</span></div>
      ${cita.servicio?`<div class="at-confirm-row"><b>Motivo</b><span>${esc(cita.servicio)}</span></div>`:''}`;
    return div;
  }

  function mostrarTyping() {
    const d = document.createElement('div'); d.className = 'at-msg ai at-typing'; d.id = 'at-typing';
    d.innerHTML = `<div class="at-msg-av">tt</div><div class="at-bubble-msg"><div class="at-dots"><span></span><span></span><span></span></div></div>`;
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
  }
  function quitarTyping() { document.getElementById('at-typing')?.remove(); }
  function quitarChips() { document.getElementById('at-chips')?.remove(); }
  function esc(t) { return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }
})();
