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
  #at-wrap{position:fixed;bottom:24px;right:24px;z-index:99999;display:flex;flex-direction:column;align-items:flex-end;gap:14px;font-family:'Segoe UI',system-ui,sans-serif}

  /* Burbuja flotante */
  #at-bubble{
    width:60px;height:60px;border-radius:50%;
    background:linear-gradient(135deg,#8B7CF8,#4F3EE0);
    border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;
    box-shadow:0 6px 24px rgba(108,92,228,0.5);
    transition:transform .2s,box-shadow .2s;flex-shrink:0;
  }
  #at-bubble:hover{transform:scale(1.1);box-shadow:0 8px 32px rgba(108,92,228,0.6)}
  #at-bubble.open{background:linear-gradient(135deg,#6C5CE4,#4F3EE0)}
  #at-bubble svg{color:#fff}
  #at-bubble.open .at-ico-chat{display:none}
  #at-bubble:not(.open) .at-ico-close{display:none}
  .at-pulse{
    position:absolute;width:60px;height:60px;border-radius:50%;
    background:rgba(108,92,228,0.35);animation:at-pulse 2.2s ease-out 1.8s;pointer-events:none;
  }
  @keyframes at-pulse{0%{transform:scale(1);opacity:.8}100%{transform:scale(2.1);opacity:0}}

  /* Panel */
  #at-panel{
    width:380px;height:580px;
    background:#F4F3FF;border-radius:20px;overflow:hidden;
    box-shadow:0 12px 48px rgba(108,92,228,0.22),0 2px 12px rgba(0,0,0,0.1);
    display:flex;flex-direction:column;
    transform-origin:bottom right;
    transition:transform .28s cubic-bezier(.34,1.4,.64,1),opacity .22s;
  }
  #at-panel.at-hidden{transform:scale(0.82) translateY(20px);opacity:0;pointer-events:none}

  /* Header */
  #at-panel .at-hd{
    background:linear-gradient(135deg,#1E1B3A 0%,#16143A 60%,#1A1642 100%);
    padding:16px 18px;display:flex;align-items:center;gap:12px;flex-shrink:0;
    border-bottom:1px solid rgba(108,92,228,0.2);
  }
  #at-panel .at-hd-av{
    width:42px;height:42px;border-radius:50%;flex-shrink:0;
    background:linear-gradient(135deg,#8B7CF8,#6C5CE4);
    display:flex;align-items:center;justify-content:center;
    font-size:12px;font-weight:700;color:#fff;
    box-shadow:0 3px 12px rgba(108,92,228,0.6);border:2px solid rgba(255,255,255,0.15);
  }
  #at-panel .at-hd-info{flex:1;min-width:0}
  #at-panel .at-hd-name{font-size:14px;font-weight:600;color:#fff;letter-spacing:-.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px}
  #at-panel .at-hd-status{display:flex;align-items:center;gap:5px;font-size:11px;color:rgba(255,255,255,0.5)}
  #at-panel .at-dot{width:6px;height:6px;border-radius:50%;background:#16A34A;flex-shrink:0;animation:at-blink 2.5s ease-in-out infinite}
  @keyframes at-blink{0%,100%{opacity:1}50%{opacity:.35}}
  #at-panel .at-close-btn{
    width:30px;height:30px;border-radius:50%;
    background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);
    cursor:pointer;display:flex;align-items:center;justify-content:center;
    color:rgba(255,255,255,0.6);font-size:15px;transition:all .15s;flex-shrink:0;
  }
  #at-panel .at-close-btn:hover{background:rgba(255,255,255,0.16);color:#fff}

  /* Área de mensajes */
  #at-panel .at-msgs{
    flex:1;overflow-y:auto;padding:20px 16px 12px;
    display:flex;flex-direction:column;gap:14px;scroll-behavior:smooth;
    background:linear-gradient(180deg,#F4F3FF 0%,#EEF0FF 100%);
  }
  #at-panel .at-msgs::-webkit-scrollbar{width:4px}
  #at-panel .at-msgs::-webkit-scrollbar-thumb{background:rgba(108,92,228,0.18);border-radius:4px}

  /* Burbujas */
  #at-panel .at-msg{display:flex;gap:10px;max-width:90%;animation:at-fadeup .22s ease}
  @keyframes at-fadeup{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  #at-panel .at-msg.ai{align-self:flex-start}
  #at-panel .at-msg.user{align-self:flex-end;flex-direction:row-reverse}
  #at-panel .at-msg-av{
    width:32px;height:32px;border-radius:50%;flex-shrink:0;margin-top:2px;
    background:linear-gradient(135deg,#8B7CF8,#4F3EE0);
    display:flex;align-items:center;justify-content:center;
    font-size:10px;font-weight:700;color:#fff;
    box-shadow:0 2px 8px rgba(108,92,228,0.35);
  }
  #at-panel .at-bubble-msg{
    padding:11px 14px;font-size:13.5px;line-height:1.65;word-break:break-word;
  }
  #at-panel .at-msg.ai  .at-bubble-msg{
    background:#fff;color:#16143A;
    border-radius:4px 16px 16px 16px;
    box-shadow:0 2px 8px rgba(108,92,228,0.08);
    border:1px solid rgba(108,92,228,0.08);
  }
  #at-panel .at-msg.user .at-bubble-msg{
    background:linear-gradient(135deg,#6C5CE4,#4F3EE0);color:#fff;
    border-radius:16px 4px 16px 16px;
    box-shadow:0 3px 12px rgba(108,92,228,0.35);
  }

  /* Chips de respuesta rápida */
  #at-panel .at-chips{
    display:flex;flex-wrap:wrap;gap:7px;
    padding-left:42px;margin-top:2px;
    animation:at-fadeup .24s ease;
  }
  #at-panel .at-chip{
    padding:7px 14px;
    background:#fff;
    border:1.5px solid rgba(108,92,228,0.3);
    border-radius:100px;
    font-size:12px;font-weight:500;color:#6C5CE4;
    cursor:pointer;white-space:nowrap;user-select:none;
    transition:all .15s;
    box-shadow:0 1px 4px rgba(108,92,228,0.08);
  }
  #at-panel .at-chip:hover{
    background:rgba(108,92,228,0.07);border-color:#6C5CE4;
    transform:translateY(-1px);box-shadow:0 3px 10px rgba(108,92,228,0.15);
  }

  /* Slots de hora */
  #at-panel .at-slots{padding-left:42px;margin-top:6px;animation:at-fadeup .24s ease}
  #at-panel .at-slot-lbl{
    font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;
    color:#9C96B4;margin-bottom:7px;
  }
  #at-panel .at-slot-grid{
    display:grid;grid-template-columns:repeat(3,1fr);gap:6px;
    max-width:240px;margin-bottom:10px;
  }
  #at-panel .at-slot-btn{
    padding:9px 6px;
    background:#fff;border:1.5px solid rgba(108,92,228,0.15);border-radius:10px;
    font-size:12.5px;font-weight:500;color:#5E5880;
    cursor:pointer;text-align:center;
    transition:all .15s;box-shadow:0 1px 4px rgba(108,92,228,0.06);
  }
  #at-panel .at-slot-btn:hover{
    border-color:#6C5CE4;color:#6C5CE4;
    background:rgba(108,92,228,0.06);transform:translateY(-1px);
    box-shadow:0 3px 10px rgba(108,92,228,0.14);
  }

  /* Typing */
  #at-panel .at-typing .at-bubble-msg{padding:13px 16px}
  #at-panel .at-dots{display:flex;gap:4px;align-items:center}
  #at-panel .at-dots span{
    width:6px;height:6px;border-radius:50%;background:#C4C0D8;
    animation:at-bounce 1.2s ease-in-out infinite;
  }
  #at-panel .at-dots span:nth-child(2){animation-delay:.2s}
  #at-panel .at-dots span:nth-child(3){animation-delay:.4s}
  @keyframes at-bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}

  /* Tarjeta confirmación */
  #at-panel .at-confirm{
    background:#fff;border:1px solid rgba(22,163,74,0.2);border-radius:14px;
    padding:16px 18px;margin-top:8px;max-width:260px;margin-left:42px;
    box-shadow:0 2px 12px rgba(22,163,74,0.1);animation:at-fadeup .3s ease;
  }
  #at-panel .at-confirm-ico{
    width:38px;height:38px;border-radius:50%;
    background:rgba(22,163,74,0.1);border:1.5px solid rgba(22,163,74,0.2);
    display:flex;align-items:center;justify-content:center;font-size:17px;
    margin-bottom:10px;animation:at-pop .4s cubic-bezier(.34,1.56,.64,1);
  }
  @keyframes at-pop{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}
  #at-panel .at-confirm-title{font-size:13px;font-weight:700;color:#16143A;margin-bottom:9px}
  #at-panel .at-confirm-row{display:flex;gap:8px;font-size:12px;margin-bottom:5px;align-items:baseline}
  #at-panel .at-confirm-row b{color:#9C96B4;font-weight:500;min-width:60px;flex-shrink:0}
  #at-panel .at-confirm-row span{color:#16143A;font-weight:600}

  /* Barra de input */
  #at-panel .at-bar{
    flex-shrink:0;padding:12px 14px 14px;
    background:#fff;border-top:1px solid rgba(108,92,228,0.1);
    display:flex;gap:10px;align-items:flex-end;
  }
  #at-panel .at-inp{
    flex:1;padding:10px 14px;
    border:1.5px solid rgba(108,92,228,0.18);border-radius:22px;
    font-size:13px;color:#16143A;background:#F8F7FF;
    outline:none;resize:none;max-height:80px;overflow-y:auto;
    transition:border-color .15s;line-height:1.5;
  }
  #at-panel .at-inp:focus{border-color:#6C5CE4;background:#fff}
  #at-panel .at-inp::placeholder{color:#C4C0D8}
  #at-panel .at-send{
    width:40px;height:40px;border-radius:50%;flex-shrink:0;
    background:linear-gradient(135deg,#6C5CE4,#4F3EE0);border:none;
    cursor:pointer;display:flex;align-items:center;justify-content:center;
    box-shadow:0 3px 12px rgba(108,92,228,0.4);transition:all .15s;
  }
  #at-panel .at-send:hover{transform:scale(1.1);box-shadow:0 5px 18px rgba(108,92,228,0.5)}
  #at-panel .at-send:disabled{opacity:.35;cursor:not-allowed;transform:none;box-shadow:none}
  #at-panel .at-send svg{color:#fff}

  /* Loading */
  #at-panel .at-loading{
    flex:1;display:flex;align-items:center;justify-content:center;
    flex-direction:column;gap:12px;color:#9C96B4;font-size:13px;
  }
  #at-panel .at-spin{
    width:28px;height:28px;border:2.5px solid rgba(108,92,228,0.15);
    border-top-color:#6C5CE4;border-radius:50%;animation:at-spin .7s linear infinite;
  }
  @keyframes at-spin{to{transform:rotate(360deg)}}

  @media(max-width:480px){
    #at-wrap{bottom:0;right:0;gap:0}
    #at-panel{width:100vw;height:100dvh;border-radius:0}
    #at-bubble{position:fixed;bottom:20px;right:20px}
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
