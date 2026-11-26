import crypto from 'crypto';
const BASE_URL = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');

function generateManageToken(cita_id) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !cita_id) return '';
  const expire = Math.floor(Date.now() / 1000) + 90 * 24 * 3600;
  const hmac = crypto.createHmac('sha256', secret).update('gestionar:' + cita_id + ':' + expire).digest('hex');
  return expire + '.' + hmac;
}

function notificarNuevoMensaje(canal, nombre, primerMensaje, destinatario = 'cesarsalinasmunoz@gmail.com') {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const canalLabel = canal === 'whatsapp' ? 'WhatsApp' : canal === 'instagram' ? 'Instagram' : canal === 'messenger' ? 'Messenger' : canal;
  const de = nombre && nombre !== canal ? nombre : 'Visitante';
  fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Attempo <contacto@attempo.cl>',
      to: [destinatario],
      subject: `Nuevo mensaje — ${canalLabel}`,
      html: `<p style="font-family:sans-serif"><strong>Canal:</strong> ${canalLabel}<br><strong>De:</strong> ${de}<br><strong>Mensaje:</strong> "${String(primerMensaje).slice(0, 400)}"</p>`
    })
  }).catch(() => {});
}

export default async function handler(req, res) {
  if (req.method === 'GET' && req.query.keepalive === '1') {
    return res.status(200).json({ ok: true, ts: Date.now() });
  }
  if (req.method !== 'POST') return res.status(405).end();

  // Canales Meta (webhook) deben provenir del servidor con clave interna
  const incomingBody = req.body || {};
  if (['whatsapp', 'messenger', 'instagram'].includes(incomingBody.canal)) {
    const key = req.headers['x-internal-key'];
    if (!process.env.INTERNAL_API_SECRET || key !== process.env.INTERNAL_API_SECRET) {
      return res.status(401).json({ error: 'No autorizado' });
    }
  }

  const { cliente_id, canal, canal_user_id, canal_user_name, mensaje, send_reply, access_token: metaAccessToken, channel_value: metaChannelValue, conversacion_id: metaConversacionId, is_attempo_channel: isAttempoChannel } = incomingBody;
  if (!cliente_id || !canal || !canal_user_id || !mensaje) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }
  const _clienteIdRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!_clienteIdRe.test(cliente_id)) {
    return res.status(400).json({ error: 'cliente_id inválido' });
  }
  if (typeof canal_user_id !== 'string' || canal_user_id.length > 128 || typeof mensaje !== 'string' || mensaje.length > 4000) {
    return res.status(400).json({ error: 'Datos inválidos' });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
  const SUPABASE_URL  = 'https://xztqawulvrtjvtfixofy.supabase.co';
  const sh = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const shJson = { ...sh, 'Content-Type': 'application/json' };

  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'API key no configurada' });

  async function sendMetaReply(respuesta, delayMinSeg = 0, delayMaxSeg = 0) {
    if (!send_reply || !respuesta || !metaAccessToken || !metaChannelValue) return;
    if (delayMinSeg > 0) {
      const delay = Math.floor(Math.random() * (delayMaxSeg - delayMinSeg + 1) + delayMinSeg);
      await new Promise(r => setTimeout(r, delay * 1000));
    }
    try {
      const payload = canal === 'whatsapp'
        ? { messaging_product: 'whatsapp', to: canal_user_id, type: 'text', text: { body: respuesta } }
        : { recipient: { id: canal_user_id }, message: { text: respuesta } };
      const sendRes = await fetch(`https://graph.facebook.com/v20.0/${metaChannelValue}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${metaAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const sendText = await sendRes.text();
      console.log('[bot-chat] meta-send:', sendRes.status, sendText.slice(0, 120));
      if (sendRes.ok) {
        const mes = new Date().toISOString().slice(0, 7);
        fetch(`${SUPABASE_URL}/rest/v1/rpc/inc_uso`, {
          method: 'POST', headers: shJson,
          body: JSON.stringify({ p_cliente_id: cliente_id, p_mes: mes, p_campo: 'mensajes_wa_bot' })
        }).catch(() => {});
        if (!isAttempoChannel && canal === 'whatsapp') {
          fetch(`${SUPABASE_URL}/rest/v1/rpc/inc_wa_usados`, {
            method: 'POST', headers: shJson,
            body: JSON.stringify({ p_cliente_id: cliente_id })
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[bot-chat] meta-send error:', e.message);
    }
    if (metaConversacionId && respuesta) {
      fetch(`${SUPABASE_URL}/rest/v1/mensajes`, {
        method: 'POST', headers: { ...shJson, Prefer: 'return=minimal' },
        body: JSON.stringify({ conversacion_id: metaConversacionId, cliente_id, rol: 'bot', contenido: respuesta, visto: true })
      }).catch(() => {});
    }
    if (isAttempoChannel) {
      fetch(`${SUPABASE_URL}/rest/v1/web_leads`, {
        method: 'POST', headers: { ...shJson, Prefer: 'return=minimal' },
        body: JSON.stringify({ session_id: canal_user_id, mensajes: [{ role: 'user', content: mensaje, name: canal_user_name || canal_user_id }, { role: 'assistant', content: respuesta }], tipo: 'whatsapp_msg', pagina: canal })
      }).catch(() => {});
    }
  }

  // ── 1. Cargar o crear sesión de chat ──────────────────────────────────────
  let sessionId = null;
  let historial = [];

  try {
    const rs = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_sessions?cliente_id=eq.${cliente_id}&canal=eq.${encodeURIComponent(canal)}&canal_user_id=eq.${encodeURIComponent(canal_user_id)}&select=id,messages,pausa_bot,conversation_status&limit=1`,
      { headers: sh }
    );
    const sessions = await rs.json();
    if (Array.isArray(sessions) && sessions.length > 0) {
      sessionId = sessions[0].id;
      historial = Array.isArray(sessions[0].messages) ? sessions[0].messages : [];
      if (sessions[0].pausa_bot) {
        // Cargar protocolo_urgencia desde bot_config
        let protocoloUrgencia = '';
        try {
          const rbp = await fetch(`${SUPABASE_URL}/rest/v1/bot_config?cliente_id=eq.${cliente_id}&select=protocolo_urgencia&limit=1`, { headers: sh });
          const [bpc] = await rbp.json();
          protocoloUrgencia = bpc?.protocolo_urgencia || '';
        } catch(_) {}

        const ultimoMsg = historial[historial.length - 1];
        const esperandoRespuesta = ultimoMsg?.role === 'assistant' &&
          typeof ultimoMsg.content === 'string' &&
          (ultimoMsg.content.includes('contactar') || ultimoMsg.content.includes('equipo'));
        const respuesta = protocoloUrgencia || (esperandoRespuesta ? 'nuestro equipo te va a responder aquí a la brevedad' : '');
        if (respuesta) {
          const msgsActualizados = [...historial, { role: 'user', content: mensaje }, { role: 'assistant', content: respuesta }];
          fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?id=eq.${sessionId}`, {
            method: 'PATCH',
            headers: { ...shJson, Prefer: 'return=minimal' },
            body: JSON.stringify({ messages: msgsActualizados })
          }).catch(() => {});
        }
        return res.status(200).json({ respuesta, pausa: true });
      }
    } else {
      // Crear nueva sesión (con fallback por race condition)
      const rc = await fetch(`${SUPABASE_URL}/rest/v1/chat_sessions`, {
        method: 'POST',
        headers: { ...shJson, Prefer: 'return=representation' },
        body: JSON.stringify({
          cliente_id,
          canal,
          canal_user_id,
          canal_user_name: canal_user_name || null,
          messages: []
        })
      });
      const created = await rc.json();
      if (Array.isArray(created) && created[0]) {
        sessionId = created[0].id;
      } else {
        // Race condition: otro proceso ya creó la sesión, re-buscar
        const rr = await fetch(
          `${SUPABASE_URL}/rest/v1/chat_sessions?cliente_id=eq.${cliente_id}&canal=eq.${encodeURIComponent(canal)}&canal_user_id=eq.${encodeURIComponent(canal_user_id)}&select=id,messages,pausa_bot,conversation_status&limit=1`,
          { headers: sh }
        );
        const [refound] = await rr.json().catch(() => []);
        if (refound?.id) {
          sessionId = refound.id;
          historial = Array.isArray(refound.messages) ? refound.messages : [];
        }
      }
    }
  } catch (e) {
    console.error('bot-chat: error cargando sesión:', e.message);
  }

  // Trackear mensaje entrante del cliente: resetear follow_up_count y marcar última actividad
  if (sessionId) {
    const trackPatch = {
      last_client_message_at: new Date().toISOString(),
      follow_up_count: 0,
      conversation_status: 'activa',
    };
    if (historial.length >= 2) trackPatch.lead_calificado = true;
    fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?id=eq.${sessionId}`, {
      method: 'PATCH',
      headers: { ...shJson, Prefer: 'return=minimal' },
      body: JSON.stringify(trackPatch)
    }).catch(e => console.error('bot-chat: error tracking cliente:', e.message));
  }

  // Auto-registrar contacto en CRM (fire-and-forget, no bloquea el flujo)
  {
    const _now = new Date().toISOString();
    const _crmPayload = {
      cliente_id,
      canal,
      canal_user_id,
      ultimo_contacto: _now,
      actualizado_en: _now,
    };
    if (canal_user_name) _crmPayload.nombre = canal_user_name;
    if (canal === 'whatsapp') _crmPayload.telefono = canal_user_id;
    fetch(`${SUPABASE_URL}/rest/v1/contactos?on_conflict=cliente_id%2Ccanal%2Ccanal_user_id`, {
      method: 'POST',
      headers: { ...shJson, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(_crmPayload)
    }).catch(() => {});
  }

  // ── Capturar lead + pausar bot + alertar al responsable ──────────────────
  async function ejecutarCapturarLead(params, emailDestino, conversacion = []) {
    const { nombre, telefono, email, interes, resumen } = params;
    const telefonoFinal = telefono || (canal === 'whatsapp' ? canal_user_id : null);

    // Guardar en tabla leads
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
        method: 'POST',
        headers: { ...shJson, Prefer: 'return=minimal' },
        body: JSON.stringify({
          cliente_id,
          canal,
          canal_user_id,
          canal_user_name: canal_user_name || null,
          nombre:   nombre   || canal_user_name || null,
          telefono: telefonoFinal || null,
          email:    email    || null,
          interes:  interes  || null,
          resumen:  resumen  || null,
          estado:   'nuevo'
        })
      });
    } catch (e) {
      console.error('capturar_lead: error guardando lead:', e.message);
    }

    // Pausar el bot en esta sesión
    if (sessionId) {
      fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?id=eq.${sessionId}`, {
        method: 'PATCH',
        headers: { ...shJson, Prefer: 'return=minimal' },
        body: JSON.stringify({ pausa_bot: true, conversation_status: 'derivado' })
      }).catch(e => console.error('capturar_lead: error pausando bot:', e.message));
    }

    // Enviar email de alerta al responsable
    const key = process.env.RESEND_API_KEY;
    if (key && emailDestino) {
      const canalLabel = canal === 'whatsapp' ? 'WhatsApp' : canal === 'instagram' ? 'Instagram' : canal === 'messenger' ? 'Messenger' : canal;
      const nombreDisplay = nombre || canal_user_name || 'Visitante';

      // Construir transcript de los últimos 10 mensajes
      const msgs = conversacion.slice(-10);
      const transcriptHtml = msgs.length ? `
<div style="margin-top:20px">
  <div style="font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#888;margin-bottom:8px">Conversación</div>
  <div style="border:1px solid #e5e1ff;border-radius:10px;overflow:hidden;font-size:13px">
    ${msgs.map(m => {
      const esBot = m.role === 'assistant';
      const texto = typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content.filter(b => b.type === 'text').map(b => b.text).join(' ') : '');
      if (!texto.trim()) return '';
      return `<div style="padding:10px 14px;background:${esBot ? '#f5f3ff' : '#fff'};border-bottom:1px solid #ede9ff">
        <span style="font-size:10px;font-weight:600;color:${esBot ? '#6C5CE4' : '#555'};display:block;margin-bottom:3px">${esBot ? (botConfig?.nombre_bot || 'Bot') : (nombreDisplay)}</span>
        <span style="color:#2d2d2d;line-height:1.5">${String(texto).replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>
      </div>`;
    }).filter(Boolean).join('')}
  </div>
</div>` : '';

      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Attempo <contacto@attempo.cl>',
          to: [emailDestino],
          subject: `⚠️ Paciente requiere atención — ${nombreDisplay} (${canalLabel})`,
          html: `<div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;color:#2d2d2d">
<div style="background:#DC2626;border-radius:10px 10px 0 0;padding:16px 20px">
  <div style="color:#fff;font-size:16px;font-weight:700">⚠️ Paciente requiere atención humana</div>
  <div style="color:rgba(255,255,255,0.85);font-size:12px;margin-top:2px">${new Date().toLocaleString('es-CL',{timeZone:'America/Santiago'})}</div>
</div>
<div style="border:1px solid #fecaca;border-top:none;border-radius:0 0 10px 10px;padding:18px 20px">
  <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:4px">
    <tr><td style="padding:5px 0;color:#888;width:80px">Canal</td><td><strong>${canalLabel}</strong></td></tr>
    <tr><td style="padding:5px 0;color:#888">Nombre</td><td><strong>${nombreDisplay}</strong></td></tr>
    ${telefonoFinal ? `<tr><td style="padding:5px 0;color:#888">Teléfono</td><td><a href="tel:${telefonoFinal}" style="color:#DC2626;font-weight:700">${telefonoFinal}</a></td></tr>` : ''}
    ${email ? `<tr><td style="padding:5px 0;color:#888">Email</td><td><a href="mailto:${email}" style="color:#6C5CE4">${email}</a></td></tr>` : ''}
    ${interes ? `<tr><td style="padding:5px 0;color:#888;vertical-align:top">Motivo</td><td style="color:#444">${String(interes).replace(/</g,'&lt;')}</td></tr>` : ''}
  </table>
  ${resumen ? `<div style="padding:10px 14px;background:#fffbe6;border-left:3px solid #f59e0b;border-radius:4px;font-size:12px;color:#555;margin-top:8px">${String(resumen).replace(/</g,'&lt;')}</div>` : ''}
  ${transcriptHtml}
  <div style="margin-top:20px;padding:12px 14px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca;font-size:12px;color:#991b1b">
    El bot está <strong>pausado</strong>. Esta persona espera que le escribas directamente en ${canalLabel}.
  </div>
</div>
<p style="font-size:11px;color:#aaa;text-align:center;margin-top:12px">attempo — sistema de agendamiento inteligente</p>
</div>`
        })
      }).catch(() => {});
    }

    // Registrar gap si el bot no sabía responder (no hay datos de contacto del usuario)
    if (interes && !nombre && !telefono && !email && !canal_user_name) {
      try {
        const gapQ = interes.slice(0, 300);
        const existing = await fetch(
          `${SUPABASE_URL}/rest/v1/chatbot_gaps?cliente_id=eq.${cliente_id}&pregunta=eq.${encodeURIComponent(gapQ)}&limit=1`,
          { headers: sh }
        );
        if (existing.ok) {
          const rows = await existing.json();
          if (rows.length > 0) {
            fetch(`${SUPABASE_URL}/rest/v1/chatbot_gaps?id=eq.${rows[0].id}`, {
              method: 'PATCH',
              headers: { ...shJson, Prefer: 'return=minimal' },
              body: JSON.stringify({ frecuencia: rows[0].frecuencia + 1, last_seen: new Date().toISOString() })
            }).catch(() => {});
          } else {
            fetch(`${SUPABASE_URL}/rest/v1/chatbot_gaps`, {
              method: 'POST',
              headers: { ...shJson, Prefer: 'return=minimal' },
              body: JSON.stringify({ cliente_id, pregunta: gapQ, canal })
            }).catch(() => {});
          }
        }
      } catch(e) { /* silencioso */ }
    }

    return { ok: true };
  }

  // ── Crear o actualizar contacto en CRM ───────────────────────────────────
  async function ejecutarCrearOActualizarContacto(params) {
    const { nombre, email, telefono, notas } = params;
    const telefonoFinal = telefono || (canal === 'whatsapp' ? canal_user_id : null);
    const now = new Date().toISOString();
    try {
      const existing = await fetch(
        `${SUPABASE_URL}/rest/v1/contactos?cliente_id=eq.${cliente_id}&canal=eq.${encodeURIComponent(canal)}&canal_user_id=eq.${encodeURIComponent(canal_user_id)}&limit=1`,
        { headers: sh }
      ).then(r => r.json());

      const patch = { actualizado_en: now, ultimo_contacto: now };
      if (nombre) patch.nombre = nombre;
      if (email) patch.email = email;
      if (telefonoFinal) patch.telefono = telefonoFinal;
      if (notas) patch.notas = notas;

      if (Array.isArray(existing) && existing.length > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/contactos?id=eq.${existing[0].id}`, {
          method: 'PATCH',
          headers: { ...shJson, Prefer: 'return=minimal' },
          body: JSON.stringify(patch)
        });
        return { ok: true, action: 'updated', contacto_id: existing[0].id };
      } else {
        const created = await fetch(`${SUPABASE_URL}/rest/v1/contactos`, {
          method: 'POST',
          headers: { ...shJson, Prefer: 'return=representation' },
          body: JSON.stringify({ cliente_id, canal, canal_user_id, ...patch })
        }).then(r => r.json());
        return { ok: true, action: 'created', contacto_id: Array.isArray(created) ? created[0]?.id : created?.id };
      }
    } catch (e) {
      console.error('crear_o_actualizar_contacto error:', e.message);
      return { ok: false };
    }
  }

  // ── Derivar a humano (CRM-aware, reemplaza capturar_lead en modo atencion) ─
  async function ejecutarDerivarHumano(params, conversacion = []) {
    const { motivo, resumen, nombre: paramNombre, telefono: paramTelefono } = params;
    const nombreFinal = paramNombre || canal_user_name || null;
    const telefonoFinal = paramTelefono || (canal === 'whatsapp' ? canal_user_id : null);

    // 1. Capturar lead (sistema existente)
    await ejecutarCapturarLead(
      { nombre: nombreFinal, telefono: telefonoFinal, interes: motivo, resumen },
      emailNegocio,
      conversacion
    );

    // 2. Buscar o crear contacto para linkear la derivación
    let contactoId = null;
    try {
      const ex = await fetch(
        `${SUPABASE_URL}/rest/v1/contactos?cliente_id=eq.${cliente_id}&canal=eq.${encodeURIComponent(canal)}&canal_user_id=eq.${encodeURIComponent(canal_user_id)}&select=id&limit=1`,
        { headers: sh }
      ).then(r => r.json());
      if (Array.isArray(ex) && ex[0]) {
        contactoId = ex[0].id;
        fetch(`${SUPABASE_URL}/rest/v1/contactos?id=eq.${contactoId}`, {
          method: 'PATCH',
          headers: { ...shJson, Prefer: 'return=minimal' },
          body: JSON.stringify({ requiere_atencion: true, actualizado_en: new Date().toISOString() })
        }).catch(() => {});
      }
    } catch(_) {}

    // 3. Crear registro de derivación
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/derivaciones`, {
        method: 'POST',
        headers: { ...shJson, Prefer: 'return=minimal' },
        body: JSON.stringify({
          cliente_id,
          contacto_id: contactoId,
          conversacion_id: sessionId,
          motivo: motivo || 'Solicitud de atención humana',
          mensaje_contexto: resumen || null,
          estado: 'pendiente'
        })
      });
    } catch (e) {
      console.error('derivar_humano: error guardando derivación:', e.message);
    }

    return { ok: true };
  }

  // ── 2. Carga en paralelo: botConfig + knowledge + negocio/sedes + especialistas + paciente ──
  let botConfig = { nombre_bot: 'attia', genero: 'femenino', tono: 'informal', saludo: '', faqs: [], tipo_bot: 'atencion', conocimiento: '', promociones: [], notif_nuevo_mensaje: false, notif_email: '', delay_min_seg: 0, delay_max_seg: 0, mensaje_traspaso: '', protocolo_urgencia: '', modos: [], modo_activo: null, activo_whatsapp: true, activo_instagram: true, activo_messenger: true };
  let chatbotKnowledge = [];
  let sedesContexto = '';
  let pacienteContexto = '';
  let leadContexto = '';
  let negocioNombre = 'el negocio';
  let serviciosCatalogo = [];
  let emailNegocio = null;
  let metodosPagoNegocio = null;
  let datosBancoNegocio = null;
  let direccionNegocio = null;
  let espLista = [];

  try {
    const [rawBotCfg, rawCK, rawCli, rawEsp, rawCitas, rawLead] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/bot_config?cliente_id=eq.${cliente_id}&limit=1`, { headers: sh })
        .then(r => r.json()).catch(() => []),
      fetch(`${SUPABASE_URL}/rest/v1/chatbot_knowledge?cliente_id=eq.${cliente_id}&activo=eq.true&order=orden.asc`, { headers: sh })
        .then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=nombre_negocio,servicios,email,promociones,ubicaciones,metodos_pago,datos_banco,direccion&limit=1`, { headers: sh })
        .then(r => r.json()).then(d => d[0] || null).catch(() => null),
      fetch(`${SUPABASE_URL}/rest/v1/especialistas?cliente_id=eq.${cliente_id}&activo=eq.true&select=id,nombre,especialidad,horario&order=nombre.asc`, { headers: sh })
        .then(r => r.json()).catch(() => []),
      canal === 'whatsapp' && canal_user_id
        ? fetch(`${SUPABASE_URL}/rest/v1/citas?cliente_id=eq.${cliente_id}&tel_paciente=eq.${encodeURIComponent(canal_user_id)}&estado=not.in.(canceled,cancelada)&select=nombre_paciente,fecha,hora,servicio,estado&order=fecha.desc,hora.desc&limit=3`, { headers: sh })
            .then(r => r.ok ? r.json() : []).catch(() => [])
        : Promise.resolve([]),
      fetch(`${SUPABASE_URL}/rest/v1/leads?cliente_id=eq.${cliente_id}&canal=eq.${encodeURIComponent(canal)}&canal_user_id=eq.${encodeURIComponent(canal_user_id)}&select=nombre,interes,resumen,estado,notas&order=created_at.desc&limit=1`, { headers: sh })
        .then(r => r.ok ? r.json() : []).then(d => (Array.isArray(d) && d[0]) || null).catch(() => null),
    ]);

    // botConfig
    const [bc] = Array.isArray(rawBotCfg) ? rawBotCfg : [];
    if (bc) {
      botConfig.nombre_bot          = 'attia';
      botConfig.genero              = bc.genero              || 'femenino';
      botConfig.tono                = bc.tono                || 'informal';
      botConfig.saludo              = bc.saludo              || '';
      botConfig.faqs                = Array.isArray(bc.faqs) ? bc.faqs : [];
      botConfig.tipo_bot            = bc.tipo_bot            || 'atencion';
      botConfig.conocimiento        = bc.conocimiento        || '';
      botConfig.promociones         = Array.isArray(bc.promociones) ? bc.promociones : [];
      botConfig.notif_nuevo_mensaje = bc.notif_nuevo_mensaje || false;
      botConfig.notif_email         = bc.notif_email         || '';
      botConfig.delay_min_seg       = bc.delay_min_seg       || 0;
      botConfig.delay_max_seg       = bc.delay_max_seg       || 0;
      botConfig.mensaje_traspaso    = bc.mensaje_traspaso    || '';
      botConfig.protocolo_urgencia  = bc.protocolo_urgencia  || '';
      botConfig.modos               = Array.isArray(bc.modos) ? bc.modos : [];
      botConfig.modo_activo         = bc.modo_activo         || null;
      botConfig.activo_whatsapp     = bc.activo_whatsapp     !== false;
      botConfig.activo_instagram    = bc.activo_instagram    !== false;
      botConfig.activo_messenger    = bc.activo_messenger    !== false;
    }
    if (process.env.ATTEMPO_VENTAS_CLIENT_ID && cliente_id === process.env.ATTEMPO_VENTAS_CLIENT_ID) {
      botConfig.tipo_bot = 'ventas';
    }

    // knowledge
    if (Array.isArray(rawCK)) chatbotKnowledge = rawCK;

    // negocio + sedes + pago (misma query, un solo round-trip)
    if (rawCli) {
      negocioNombre        = rawCli.nombre_negocio || 'el negocio';
      serviciosCatalogo    = Array.isArray(rawCli.servicios) ? rawCli.servicios : [];
      emailNegocio         = rawCli.email || null;
      metodosPagoNegocio   = rawCli.metodos_pago || null;
      datosBancoNegocio    = rawCli.datos_banco || null;
      direccionNegocio     = rawCli.direccion || null;
      if (Array.isArray(rawCli.promociones)) {
        botConfig.promociones = [...rawCli.promociones, ...botConfig.promociones];
      }
      const sedes = rawCli.ubicaciones;
      if (Array.isArray(sedes) && sedes.length > 0) {
        const lineas = sedes.map((s, i) => {
          const partes = [`Sede ${i + 1}: ${s.nombre}`];
          if (s.ciudad)    partes.push(`Ciudad: ${s.ciudad}`);
          if (s.direccion) partes.push(`Dirección: ${s.direccion}`);
          if (s.telefono)  partes.push(`Teléfono: ${s.telefono}`);
          return partes.join(' | ');
        });
        sedesContexto = `\n\nSEDES Y UBICACIONES DEL NEGOCIO:\n${lineas.join('\n')}`;
      }
    }
    console.log('bot-chat: promociones cargadas =', JSON.stringify(botConfig.promociones));

    // especialistas
    if (Array.isArray(rawEsp)) espLista = rawEsp;

    // paciente recurrente (WhatsApp)
    if (Array.isArray(rawCitas) && rawCitas.length > 0) {
      const nombre = rawCitas[0].nombre_paciente;
      const detalle = rawCitas.map(c =>
        `- ${c.servicio || 'Consulta'} el ${c.fecha} a las ${c.hora} (${c.estado})`
      ).join('\n');
      pacienteContexto = `\nPACIENTE RECURRENTE: ${nombre} ya tiene historial. Su nombre es ${nombre} — NO lo pidas. Salúdalo por su nombre en el primer mensaje.\nÚltimas citas:\n${detalle}`;
    }

    // lead previo — memoria persistente por contacto
    if (rawLead) {
      const etapaLabel = { nuevo: 'nuevo (primer contacto)', calificado: 'calificado (mostró interés)', agendado: 'agendado', perdido: 'perdido (no continuó)' }[rawLead.estado] || rawLead.estado;
      const partes = [`\nCONTACTO PREVIO: Este usuario ya interactuó antes y tiene un lead registrado. Etapa actual: ${etapaLabel}.`];
      if (rawLead.nombre) partes.push(`Nombre: ${rawLead.nombre} — NO lo pidas de nuevo.`);
      if (rawLead.interes) partes.push(`Interés registrado: ${rawLead.interes}`);
      if (rawLead.resumen) partes.push(`Contexto anterior: ${rawLead.resumen}`);
      if (rawLead.notas)   partes.push(`Notas del equipo: ${rawLead.notas}`);
      partes.push(`Retoma la conversación con naturalidad. Si ya tiene nombre, úsalo sin preguntar.`);
      leadContexto = partes.join('\n');
    }
  } catch (e) {
    console.error('bot-chat: error en carga paralela:', e.message);
  }

  // ── MODO VENTAS (bot de ventas attempo) ──────────────────────────────────
  if (botConfig.tipo_bot === 'ventas') {
    const esPrimerMsg = historial.length === 0;
    const hoyVentas = new Date().toLocaleDateString('es-CL', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Santiago'
    });

    const ventasSystemPrompt = `Eres attia, del equipo de attempo. Atiendes por ${canal === 'whatsapp' ? 'WhatsApp' : canal} a personas interesadas en conocer la plataforma. Eres chilena, directa y cálida.

SOBRE ATTEMPO:
attempo es una plataforma de agendamiento online para profesionales y clínicas en Chile. Los clientes reservan citas 24/7 desde el celular, reciben recordatorios automáticos por WhatsApp y pueden pagar con tarjeta o transferencia. Listo en 5 minutos, sin complicaciones técnicas.

PLANES Y PRECIOS:
- Plan Inicio: $24.990/mes + IVA — agenda online, recordatorios WhatsApp, cobro con tarjeta (MercadoPago, 2,59% de comisión). Para profesionales solos.
- Plan Pro: $44.990/mes + IVA — todo lo anterior + attempo cubre el 2,59% de MercadoPago, cobros sin costo. Para profesionales que cobran con tarjeta.
- Plan Business: $119.990/mes + IVA — todo lo anterior + chatbot IA Attia que responde consultas y agenda citas en WhatsApp, Instagram y Messenger de forma automática + múltiples profesionales bajo un mismo centro. Para clínicas y centros.
- Todos incluyen 14 días de prueba gratis.

PARA QUIÉN ES:
Psicólogos, psiquiatras, médicos, nutricionistas, matronas, fisioterapeutas, dentistas, abogados, barberías, centros de estética, yoga, pilates y cualquier profesional que agenda citas.

CÓMO RESPONDER:
- Mensajes cortos, máximo 3-4 líneas. Una idea por mensaje.
- Tratas de tú. Usa el nombre desde que lo sabes.
- Usa conjugaciones estándar aunque el tono sea cálido: "estás" (no "estai"), "tienes" (no "tenís"), "puedes" (no "podís").
- Sin emojis en cada mensaje — solo 1 cuando realmente aporte algo.
- No digas que eres IA.
- Tono cálido y paciente — nunca presiones ni hagas sentir a la persona acorralada.
- Si alguien dice "solo probando", "estoy viendo" o algo similar, responde con calma y ofrece información sin presionar. No insistas.
- NUNCA digas "te consulto con el equipo" — si no puedes responder algo con certeza, usa capturar_lead para que alguien del equipo lo contacte directamente.

ETAPAS DE LA CONVERSACIÓN (sigue este orden):
1. ${esPrimerMsg ? 'Saluda brevemente y pregunta el nombre.' : 'Continúa desde donde iba la conversación.'}
2. Calificar con curiosidad genuina: pregunta qué tipo de negocio tiene y si trabaja solo o con más personas. Una pregunta a la vez.
3. Recomendar el plan correcto con un argumento concreto basado en lo que dijo. No listes todos los planes — recomienda uno.
4. Cerrar: cuando muestre interés real, da el link directamente: "Puedes probarlo 14 días gratis aquí: https://app.attempo.cl/registro"
5. Si lleva más de 6 mensajes sin cerrar o la conversación se estanca, usa capturar_lead para que el equipo lo contacte.

CUANDO ALGUIEN MENCIONA OTRO SISTEMA (Reservo, Medilink, Agenda Pro, u otro):
Piensa qué está pidiendo realmente antes de responder:
- Si quiere agregar un canal IA para que los pacientes le escriban por WhatsApp o Instagram: attempo SÍ puede hacer eso. Attia atiende las conversaciones y agenda citas — no tiene que reemplazar su sistema actual, los dos pueden coexistir.
- Si quiere que attempo sincronice automáticamente datos con su sistema propio o escriba reservas directamente en otro sistema: eso no existe hoy. Sé honesta: "Hoy no tenemos integración directa con [sistema]. Lo que sí podemos hacer es [alternativa concreta]."
- Si quiere reemplazar completamente su sistema actual: depende de qué funciones usa. Pregunta qué necesita mantener antes de recomendar.
Nunca prometas integraciones que no existen. Nunca adivines.

CUANDO ALGUIEN PIDE HABLAR CON UN HUMANO:
Usa de inmediato la herramienta capturar_lead con los datos que tengas (nombre, teléfono si es WhatsApp, lo que contó sobre su negocio).
Después di únicamente: "${botConfig.mensaje_traspaso || 'Listo [nombre], ya avisé al equipo. Te van a escribir aquí mismo a la brevedad.'}"
No prometas horas ni plazos. No sigas intentando responder tú.

OBJECIONES FRECUENTES:
- "¿Es muy caro?" → "El Plan Inicio son $24.990 al mes, menos de $1.000 al día. Y los recordatorios automáticos evitan que los clientes se olviden — la mayoría recupera el costo desde el primer mes."
- "¿Es difícil?" → "Cinco minutos y ya tienes la agenda online. Sin instalaciones ni técnicos."
- "¿Necesito tarjeta?" → "Sí, la prueba pide una tarjeta, pero no se cobra nada hasta que terminen los 12 días. Cancelas cuando quieras."
- "¿Funciona para [rubro]?" → Adapta la respuesta al rubro y da un ejemplo concreto de cómo attempo les ayuda.

HOY ES: ${hoyVentas}${leadContexto}`;

    const ventasTools = [
      {
        name: 'capturar_lead',
        description: 'Registra a un prospecto que pidió contacto humano o cuyos datos hay que guardar para seguimiento. Pausa el bot y alerta al equipo. Úsala cuando alguien pide hablar con una persona, deja sus datos para ser contactado, o la conversación lleva mucho tiempo sin cerrar.',
        input_schema: {
          type: 'object',
          properties: {
            nombre:   { type: 'string' },
            telefono: { type: 'string' },
            email:    { type: 'string' },
            interes:  { type: 'string', description: 'En qué está interesado — plan, rubro, consulta específica' },
            resumen:  { type: 'string', description: 'Resumen breve de la conversación para el equipo' }
          },
          required: []
        }
      }
    ];

    const MAX_MESSAGES = 20;
    let msgs = historial.slice(-MAX_MESSAGES);
    msgs.push({ role: 'user', content: mensaje });

    let respuestaVentas = '';
    let leadCapturadoVentas = false;

    try {
      for (let i = 0; i < 5; i++) {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key':         ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-beta':    'prompt-caching-2024-07-31',
            'content-type':      'application/json'
          },
          body: JSON.stringify({
            model:      'claude-haiku-4-5-20251001',
            max_tokens: 300,
            system:     [{ type: 'text', text: ventasSystemPrompt, cache_control: { type: 'ephemeral' } }],
            tools:      ventasTools,
            messages:   msgs
          })
        });

        const data = await r.json();

        if (r.status === 529 || data.error?.type === 'overloaded_error') {
          if (i < 1) { await new Promise(resolve => setTimeout(resolve, 1500)); continue; }
          respuestaVentas = 'Un momento, estoy con mucha demanda. ¿Me repites tu consulta?';
          break;
        }

        if (!r.ok) throw new Error(data.error?.message || 'Error de Claude API');

        if (data.stop_reason !== 'tool_use') {
          respuestaVentas = data.content.find(b => b.type === 'text')?.text || '';
          msgs.push({ role: 'assistant', content: respuestaVentas });
          break;
        }

        const toolBlocks = data.content.filter(b => b.type === 'tool_use');
        const toolResults = [];

        for (const block of toolBlocks) {
          if (block.name === 'capturar_lead') {
            const result = await ejecutarCapturarLead(block.input, 'cesarsalinasmunoz@gmail.com', [...historial, { role: 'user', content: mensaje }]);
            if (result.ok) leadCapturadoVentas = true;
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
          }
        }

        msgs = [
          ...msgs,
          { role: 'assistant', content: data.content },
          { role: 'user',      content: toolResults }
        ];
      }
    } catch (err) {
      console.error('bot-chat ventas error:', err);
      return res.status(500).json({ error: 'Error interno: ' + err.message });
    }

    if (sessionId) {
      fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?id=eq.${sessionId}`, {
        method: 'PATCH',
        headers: { ...shJson, Prefer: 'return=minimal' },
        body: JSON.stringify({
          messages:            msgs.slice(-MAX_MESSAGES),
          canal_user_name:     canal_user_name || null,
          updated_at:          new Date().toISOString(),
          conversation_status: leadCapturadoVentas ? 'derivado' : 'esperando_respuesta',
          ...(leadCapturadoVentas ? { pausa_bot: true } : {}),
        })
      }).catch(e => console.error('bot-chat ventas: error guardando sesión:', e.message));
    }

    if (esPrimerMsg) notificarNuevoMensaje(canal, canal_user_name, mensaje);
    await sendMetaReply(respuestaVentas || 'Un momento, intenta de nuevo.');
    return res.status(200).json({ respuesta: respuestaVentas || 'Un momento, intenta de nuevo.', cita_creada: null });
  }
  // ── FIN MODO VENTAS ───────────────────────────────────────────────────────

  // — Check canal activo —
  const canalActivo = botConfig['activo_' + canal];
  if (canalActivo === false) {
    return res.status(200).json({ respuesta: '', pausa: false });
  }

  // ── 3. Detección de escalada humana (keywords + fallos repetidos) ─────────
  {
    const KEYWORDS_HUMANO = [
      'hablar con alguien','hablar con una persona','hablar con un humano',
      'quiero a una persona','persona real','quiero hablar con','necesito hablar con',
      'atiéndeme','atención humana','agente humano','representante',
      'no quiero hablar con un bot','no eres humano','eres un robot','eres una ia',
      'quiero hablar con el equipo','quiero hablar con ustedes',
      'quiero que me llamen','que me llamen','llámenme',
    ];
    const mensajeLower = mensaje.toLowerCase();
    const pidioHumano  = KEYWORDS_HUMANO.some(k => mensajeLower.includes(k));

    // Fallos repetidos: el bot ya dijo "alguien del equipo te va a contactar" 2+ veces
    const TEXTO_ESCALADA = 'alguien del equipo te va a contactar';
    const fallosBot = historial.filter(m =>
      m.role === 'assistant' && typeof m.content === 'string' &&
      m.content.toLowerCase().includes(TEXTO_ESCALADA)
    ).length;
    const falloRepetido = fallosBot >= 2;

    if (pidioHumano || falloRepetido) {
      const motivo = pidioHumano
        ? `Pidió hablar con una persona: "${mensaje.slice(0, 200)}"`
        : `El bot escaló ${fallosBot} veces sin resolver la consulta del paciente.`;

      await ejecutarCapturarLead(
        { nombre: canal_user_name || null, telefono: canal === 'whatsapp' ? canal_user_id : null, interes: motivo },
        emailNegocio,
        [...historial, { role: 'user', content: mensaje }]
      );

      const respEscalada = pidioHumano
        ? 'Claro, te paso con nuestro equipo. Te van a contactar a la brevedad.'
        : 'Entiendo que no he podido ayudarte bien. Te pongo en contacto con nuestro equipo para que te atiendan personalmente.';

      if (sessionId) {
        const msgsAct = [...historial, { role: 'user', content: mensaje }, { role: 'assistant', content: respEscalada }];
        fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?id=eq.${sessionId}`, {
          method: 'PATCH', headers: { ...shJson, Prefer: 'return=minimal' },
          body: JSON.stringify({ messages: msgsAct, conversation_status: 'derivado', pausa_bot: true })
        }).catch(() => {});
      }

      await sendMetaReply(respEscalada);
      return res.status(200).json({ respuesta: respEscalada, delay_min_seg: 0, delay_max_seg: 0 });
    }
  }

  // ── 4. Preparar datos de especialistas ───────────────────────────────────
  const espTexto = espLista.length
    ? espLista.map(e => `- ${e.nombre}, ${e.especialidad || 'Profesional'} (id: ${e.id})`).join('\n')
    : 'No hay profesionales activos en este momento.';

  // Construir resumen de horario de atención del negocio desde los horarios de los especialistas
  function buildHorarioResumen(lista) {
    const nombres = { lun: 'Lunes', mar: 'Martes', mie: 'Miércoles', jue: 'Jueves', vie: 'Viernes', sab: 'Sábado', dom: 'Domingo' };
    const orden = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
    const diasActivos = {};
    for (const esp of lista) {
      const h = esp.horario || {};
      for (const dia of orden) {
        const cfg = h[dia];
        if (cfg?.activo && cfg.bloques?.length) {
          if (!diasActivos[dia]) diasActivos[dia] = new Set();
          cfg.bloques.forEach(b => diasActivos[dia].add(`${b.desde}–${b.hasta}`));
        }
      }
    }
    const lines = orden.filter(d => diasActivos[d]).map(d => `${nombres[d]}: ${[...diasActivos[d]].join(' y ')}`);
    return lines.length ? lines.join(' | ') : null;
  }
  const horarioResumen = buildHorarioResumen(espLista);

  const tieneCatalogo = serviciosCatalogo.length > 0;
  const srvTexto = tieneCatalogo
    ? serviciosCatalogo.map(s => {
        const dur = s.duracion ? `, ${s.duracion} min` : '';
        const prx = s.precio  ? `, $${Number(s.precio).toLocaleString('es-CL')}` : '';
        return `- ${s.nombre}${dur}${prx}`;
      }).join('\n')
    : 'No hay catálogo de servicios configurado en el sistema.';

  const faqsTexto = botConfig.faqs.length
    ? botConfig.faqs.map(f => `P: ${f.pregunta}\nR: ${f.respuesta}`).join('\n\n')
    : '';

  const hoy = new Date().toLocaleDateString('es-CL', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Santiago'
  });

  const pronombre = botConfig.tono === 'formal' ? 'usted' : 'tú';

  // Variables del saludo (reemplazar {nombre_bot} y {negocio})
  const saludoFinal = (botConfig.saludo || '')
    .replace(/\{nombre_bot\}/g, botConfig.nombre_bot)
    .replace(/\{negocio\}/g, negocioNombre);

  // Promociones activas hoy
  const _hoyDateStgo = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }) + 'T12:00:00');
  const promocionesActivas = botConfig.promociones.filter(p => {
    if (!p.titulo?.trim()) return false;
    const ini = p.fecha_inicio ? new Date(p.fecha_inicio + 'T00:00:00') : null;
    const fin = p.fecha_fin    ? new Date(p.fecha_fin   + 'T23:59:59') : null;
    if (ini && _hoyDateStgo < ini) return false;
    if (fin && _hoyDateStgo > fin) return false;
    return true;
  });
  const promosTexto = promocionesActivas.length
    ? `\nPROMOCIONES VIGENTES (compártelas cuando pregunten por precios, descuentos o novedades):\n${promocionesActivas.map(p => `— ${p.titulo}: ${p.descripcion}`).join('\n')}`
    : '';
  const conocimientoTexto = botConfig.conocimiento.trim()
    ? `\nINFORMACIÓN ADICIONAL DEL NEGOCIO (úsala para responder preguntas):\n${botConfig.conocimiento.trim()}`
    : '';

  // ── 5. System prompt ──────────────────────────────────────────────────────
  const telDesdeCanal = canal === 'whatsapp' ? canal_user_id : null;

  const esPrimerMensaje = historial.length === 0;
  if (esPrimerMensaje && botConfig.notif_nuevo_mensaje) {
    const destNotif = botConfig.notif_email || emailNegocio;
    if (destNotif) notificarNuevoMensaje(canal, canal_user_name, mensaje, destNotif);
  }

  // Género del asistente
  const esMasculino = botConfig.genero === 'masculino';
  const articuloAsistente = esMasculino ? 'el asistente virtual' : 'la asistente virtual';
  const participioAtencion = esMasculino ? 'disponible' : 'disponible';

  // Modo activo
  const modoActivo = botConfig.modos.find(m => m.id === botConfig.modo_activo);
  const modoTexto = modoActivo ? `\n\nMODO ESPECIAL ACTIVO — "${modoActivo.nombre}":
${modoActivo.instruccion ? modoActivo.instruccion.trim() + '\n' : ''}${Array.isArray(modoActivo.faqs) && modoActivo.faqs.filter(f => f.pregunta?.trim()).length ? 'Respuestas especiales para este modo:\n' + modoActivo.faqs.filter(f => f.pregunta?.trim()).map(f => `P: ${f.pregunta}\nR: ${f.respuesta}`).join('\n\n') + '\n' : ''}Cuando este modo está activo sus instrucciones y respuestas tienen prioridad sobre las generales.` : '';

  // Separar ejemplos de historial de la base de conocimiento general
  const ejemplosKnowledge = chatbotKnowledge.filter(k => k.categoria === 'ejemplo');
  const baseKnowledge = chatbotKnowledge.filter(k => k.categoria !== 'ejemplo');

  const systemPrompt = `Eres ${botConfig.nombre_bot}, ${articuloAsistente} de ${negocioNombre}. Atiendes por ${canal}. Eres chilena, cálida y profesional. Nunca dices que eres una IA.

TRATO: Usa "${pronombre}" con el paciente. Sin markdown ni asteriscos. Máximo 2 a 3 líneas por respuesta. Sin emojis. UNA SOLA PREGUNTA por mensaje — nunca dos preguntas en el mismo mensaje. Usa conjugaciones estándar aunque el tono sea informal: "estás" (no "estai"), "tienes" (no "tenís"), "sabes" (no "sabís"), "puedes" (no "podís").

PRIMER MENSAJE:${esPrimerMensaje ? (saludoFinal ? `
El paciente escribe por primera vez. Sigue esta lógica según lo que escribió:
- Si solo saludó (ej: "hola", "buenos días") sin preguntar nada: usa este mensaje de bienvenida exacto: "${saludoFinal}"
- Si ya hizo una pregunta (ej: "tienen promo?", "cuánto cuesta?"): saluda con UNA sola frase corta ("¡Hola!", "¡Hola! Claro,") y responde directamente su pregunta en el mismo mensaje. NO uses el mensaje de bienvenida completo. La única pregunta de seguimiento permitida debe estar relacionada a lo que acaba de preguntar (ej: si preguntó por promo → "¿Te gustaría agendar una cita para aprovecharla?").` : `
El paciente escribe por primera vez. Si solo saludó, saluda brevemente. Si ya preguntó algo, responde directamente sin rodeos.`) : ' Continúa la conversación con naturalidad.'}

HOY ES: ${hoy}
${telDesdeCanal ? `\nTELÉFONO DEL PACIENTE: Ya tienes su teléfono desde ${canal}: ${telDesdeCanal}. NO lo pidas. Úsalo directamente como tel_paciente en crear_cita.` : ''}
${horarioResumen ? `\nHORARIO DE ATENCIÓN DEL NEGOCIO:\n${horarioResumen}` : ''}

PROFESIONALES DISPONIBLES:
${espTexto}

CATÁLOGO DE SERVICIOS (con precios y duración):
${srvTexto}
${sedesContexto}${pacienteContexto}${leadContexto}${faqsTexto ? `\nPREGUNTAS FRECUENTES:\n${faqsTexto}` : ''}${conocimientoTexto}${baseKnowledge.length ? '\n\nBASE DE CONOCIMIENTO DEL NEGOCIO (usa esta información para responder con precisión):\n' + baseKnowledge.map(k => `[${k.categoria.toUpperCase()}] ${k.titulo}:\n${k.contenido}`).join('\n\n') : ''}${ejemplosKnowledge.length ? '\n\nEJEMPLOS DE CONVERSACIONES REALES (úsalos para calibrar tu tono, estilo y manejo de situaciones frecuentes — no copies literalmente, extrae el patrón):\n' + ejemplosKnowledge.map(k => `--- ${k.titulo} ---\n${k.contenido}`).join('\n\n') : ''}${modoTexto}${promosTexto}

INSTRUCCIONES PARA RESPONDER PREGUNTAS GENERALES:
- Si preguntan por precios Y el catálogo tiene servicios: lista los precios directamente desde el catálogo.
- Si preguntan por precios Y no hay catálogo: di que el valor lo coordina el profesional al reservar, y ofrece agendar.
- Si preguntan por horario, disponibilidad o qué días atienden: llama SIEMPRE a ver_disponibilidad_semana. Copia el campo "texto" del resultado exactamente como viene, con cada día en su propia línea. Responde: "Contamos con disponibilidad en los siguientes horarios:" + salto de línea + [texto del resultado] + salto de línea + "¿Cuál día te acomoda mejor?"
- Si preguntan por recordatorios o confirmaciones: al confirmar una cita, el sistema envía automáticamente un email de confirmación al paciente con todos los detalles. El negocio también puede activar recordatorios automáticos por WhatsApp y email antes de cada cita.
- Si hay PROMOCIONES VIGENTES configuradas arriba, menciónalas cuando pregunten por descuentos, promociones o precios. Después de mencionar la promo, pregunta exactamente: "¿Te gustaría agendar una cita para aprovecharla?"
- Si preguntan por teléfono, dirección u otra información que no tengas: respóndelo brevemente y ofrece agendar.
- Si hay PREGUNTAS FRECUENTES configuradas, úsalas primero.
- NUNCA digas "no tengo esa información" y te quedes ahí. Siempre conecta con lo que puedes hacer.
- Habla con naturalidad. Nada de frases técnicas.

FLUJO PARA AGENDAR UNA CITA — sigue SIEMPRE este orden exacto, sin saltarte pasos:
1. Saluda con calidez si es el primer mensaje.
2. Si hay PACIENTE RECURRENTE en el contexto, ya tienes su nombre — NO lo pidas, pasa directamente al paso 3. Si no, pregunta el nombre completo.
3. Pregunta el servicio. Si hay catálogo, preséntalo así:
   "Contamos con los siguientes servicios:
   - [Servicio 1] (duración · precio)
   - [Servicio 2] ..."
   ¿Cuál necesitas?
4. Si hay un solo profesional, infórmalo: "Serás atendido/a por [nombre], [especialidad]."
   Si hay PACIENTE RECURRENTE y sus citas anteriores mencionan un profesional, sugiérelo: "¿Te agendo con [nombre] como la última vez, o prefieres otro profesional?"
   Si hay 2-3 profesionales, lista sus nombres y pregunta con quién prefiere.
   Si hay 4 o más profesionales, di: "Tenemos [N] profesionales disponibles. ¿Tienes preferencia por alguno, o te agendo con quien tenga disponibilidad antes?"
5. Llama a ver_disponibilidad_semana y presenta el resultado línea por línea. Pregunta qué día prefiere. IMPORTANTE: el campo "texto" muestra el horario general del profesional, NO las horas reales libres (puede haber citas ya agendadas). Nunca uses esos horarios para decirle al paciente qué horas hay disponibles en un día concreto.
6. Cuando el paciente elija un día, SIEMPRE llama a buscar_disponibilidad para ese día antes de mencionar horas. Usa el campo "rangos" para presentar compactamente: "Tenemos disponibilidad de [rangos]. ¿Qué hora te acomoda?" NUNCA listes slots individuales. NUNCA uses los horarios de ver_disponibilidad_semana para responder esto.
7. Cuando el paciente confirme una hora específica, verifica que esté en el campo "horas" de buscar_disponibilidad. Si la hora que menciona NO está en ese campo, NO la confirmes — di "Esa hora no está disponible, te puedo ofrecer [las 1–2 opciones más cercanas del campo horas]. ¿Cuál te acomoda?" ${telDesdeCanal ? `Ya tienes su teléfono (${telDesdeCanal}). Pide el email: "Para enviarte la confirmación necesito tu email, ¿cuál es?" Cuando el paciente dé su email, confírmalo: "Tu email es [email], ¿está bien escrito?" Avanza solo cuando confirme.` : `Pide teléfono y email en un solo mensaje: "Para confirmar necesito tu teléfono y email." Cuando el paciente dé su email, confírmalo: "Tu email es [email], ¿está bien escrito?" Avanza solo cuando confirme.`}
8. En cuanto ${telDesdeCanal ? 'el paciente entregue su email' : 'el paciente entregue su teléfono y email'}, USA EL TOOL crear_cita DE INMEDIATO. No respondas texto antes de llamar al tool. El email NO es opcional, es obligatorio para confirmar la cita.

⚠️ REGLA CRÍTICA: NUNCA escribas "confirmada", "listo" ni ningún mensaje de éxito sin haber llamado primero al tool crear_cita y recibido ok:true como respuesta. Si escribes eso sin llamar al tool, estás mintiendo al paciente. La cita solo existe cuando el tool la crea.

RESPUESTA TRAS CREAR CITA (solo después de que crear_cita retorne ok:true):
"¡Listo [nombre]! Tu cita quedó confirmada para el [fecha] a las [hora] con [profesional]. 📅"

ESCALACIÓN A HUMANO:
Si el paciente pide hablar directamente con una persona del equipo o dice explícitamente que no quiere seguir con el bot:
- Usa INMEDIATAMENTE la herramienta derivar_humano con los datos disponibles (nombre, teléfono si es WhatsApp, motivo).
- Después di únicamente: "${botConfig.mensaje_traspaso || 'Perfecto [nombre], ya le avisé al equipo. Alguien te va a escribir aquí mismo a la brevedad.'}"
- No ofrezcas más alternativas ni hagas preguntas adicionales.

TONO DIFÍCIL O AGRESIVO:
- Si el paciente está enojado, frustrado o usa un tono agresivo: reconoce su molestia en UNA frase corta ("Entiendo que es frustrante", "Lamento que hayas tenido esa experiencia") y pasa de inmediato a resolver. Nunca te disculpes más de una vez ni repitas la misma disculpa.
- Nunca te pongas a la defensiva. Nunca repliques con el mismo tono. Mantén la calma siempre.
- Si ya respondiste lo mismo dos veces seguidas sin avanzar: cambia el enfoque o usa derivar_humano. No repitas la misma respuesta por tercera vez.
- Si alguien insulta directamente o el tono es muy agresivo: di algo como "Entiendo que estás molesto/a. Voy a avisarle al equipo para que te atiendan directamente." y usa derivar_humano. Una sola vez, sin más explicaciones.
- No entres en bucles. Si la conversación no avanza después de 2 intentos en el mismo tema, deriva.

MENSAJES DE AUDIO:
- Si el mensaje comienza con "[Audio]", fue transcrito de un audio del paciente. Respóndelo con naturalidad como si fuera texto normal. No menciones que era un audio.

CRM: Cuando el paciente diga su nombre, email o teléfono, llama crear_o_actualizar_contacto para guardar esa información. Hazlo en paralelo con la respuesta — no lo anuncies al paciente.

REGLAS GENERALES:
- Una sola pregunta por mensaje.
- Si no hay disponibilidad un día, sugiere el siguiente día hábil.
- FECHAS RELATIVAS: "esta semana" = semana actual. "la otra semana"/"la próxima" = semana siguiente. "este lunes/etc." = el más próximo en 7 días. Ante duda, confirma la fecha antes de continuar.
- El cliente_id para crear_cita es siempre: ${cliente_id}

CUANDO crear_cita RETORNA ok:false (HORARIO YA TOMADO):
- Significa que otra persona reservó ese slot mientras conversábamos. Di: "Lo siento [nombre], ese horario acaba de ser tomado. ¿Te ofrezco el siguiente disponible?" y vuelve a llamar a buscar_disponibilidad para ese mismo día para obtener horas actualizadas.

CUANDO NO HAY DISPONIBILIDAD EN LOS PRÓXIMOS DÍAS:
- Si ver_disponibilidad_semana retorna vacío o sin slots: no pares con "no hay horas". Di: "Por ahora no tenemos horas disponibles en los próximos días. ¿Quieres que el equipo te contacte apenas se libere una hora?" y usa derivar_humano con motivo "Lista de espera — sin disponibilidad".
- Si el paciente pide una fecha a más de 2 semanas: usa derivar_humano para que el equipo coordine manualmente.

CANCELACIÓN O REAGENDAMIENTO:
- El bot no puede cancelar ni modificar citas existentes. Si el paciente lo pide, di: "Para cancelar o reagendar tu cita el equipo te puede ayudar directamente." y usa derivar_humano con motivo "Cancelación o reagendamiento".

URGENCIAS Y CRISIS (SALUD MENTAL O FÍSICA):
- Si el paciente expresa dolor intenso, urgencia real, pensamiento de hacerse daño u otro estado de crisis: NO intentes agendar. Di de inmediato: "Entiendo que es urgente. Te pido que llames al SAPU más cercano o al fono de orientación 600 360 7777 (MINSAL). También puedo avisarle al equipo ahora." y usa derivar_humano con motivo "URGENCIA".

MENSAJES NO TEXTO (imágenes, stickers, videos, documentos, ubicación):
- Si recibes algo que no es texto: di "Recibí tu mensaje. No puedo ver imágenes ni archivos, pero puedo ayudarte por aquí con texto. ¿En qué te ayudo?" No ignores el mensaje — siempre responde algo.

CAMBIO DE PROFESIONAL EN MID-CONVERSACIÓN:
- Si el paciente cambia de profesional después de haber visto disponibilidad: re-llama a ver_disponibilidad_semana con el nuevo profesional antes de continuar. Los horarios pueden diferir completamente.

PREGUNTAS SIN RESPUESTA EN TU INFORMACIÓN (Fonasa, estacionamiento, acceso, seguros, etc.):
- Si la pregunta no está en las FAQs, el catálogo ni la información del negocio: NO inventes ni asumas. Di: "No tengo esa información con certeza, pero el equipo te puede confirmar. ¿Quieres que te contacten?" y usa derivar_humano si acepta.
- Nunca inventes información de cobertura, precios, seguros ni condiciones de acceso que no estén explícitamente en el catálogo.`;

  // ── 6. Herramientas ───────────────────────────────────────────────────────
  const tools = [
    {
      name: 'ver_disponibilidad_semana',
      description: 'Muestra los días y horas disponibles de los próximos 8 días, descontando citas ya agendadas. Úsala cuando pregunten por horarios de atención, disponibilidad general, qué días hay horas, o antes de preguntar qué día prefiere el paciente.',
      input_schema: {
        type: 'object',
        properties: {
          especialista_id: { type: 'string', description: 'ID del profesional. Si no se especifica, revisa todos los profesionales activos.' }
        },
        required: []
      }
    },
    {
      name: 'buscar_disponibilidad',
      description: 'Retorna los horarios disponibles de un profesional en una fecha específica. Úsala cuando el paciente ya eligió un día concreto.',
      input_schema: {
        type: 'object',
        properties: {
          especialista_id: { type: 'string', description: 'ID del profesional (está en el listado del sistema)' },
          fecha:           { type: 'string', description: 'Fecha en formato YYYY-MM-DD' }
        },
        required: ['especialista_id', 'fecha']
      }
    },
    {
      name: 'crear_cita',
      description: 'Crea la reserva definitivamente en el sistema. Llama esta herramienta solo cuando tengas nombre, servicio, profesional, fecha, hora y teléfono del paciente.',
      input_schema: {
        type: 'object',
        properties: {
          especialista_id:     { type: 'string' },
          nombre_especialista: { type: 'string' },
          nombre_paciente:     { type: 'string' },
          tel_paciente:        { type: 'string' },
          email_paciente:      { type: 'string', description: 'Email del paciente — requerido para enviar confirmación de cita' },
          servicio:            { type: 'string' },
          fecha:               { type: 'string', description: 'YYYY-MM-DD' },
          hora:                { type: 'string', description: 'HH:MM' },
          duracion:            { type: 'string', description: 'Ej: 45 min — opcional' },
          precio:              { type: 'number', description: 'Valor en pesos sin formato — opcional' }
        },
        required: ['especialista_id', 'nombre_paciente', 'tel_paciente', 'email_paciente', 'servicio', 'fecha', 'hora']
      }
    },
    {
      name: 'capturar_lead',
      description: 'Registra a un paciente o contacto que pidió hablar con una persona del equipo. Pausa el bot y alerta al negocio. Úsala cuando alguien pide atención humana explícitamente o cuando la consulta no puede resolverse sin intervención de una persona.',
      input_schema: {
        type: 'object',
        properties: {
          nombre:   { type: 'string', description: 'Nombre del contacto' },
          telefono: { type: 'string', description: 'Teléfono — si viene por WhatsApp ya está disponible, no hace falta pedirlo' },
          email:    { type: 'string', description: 'Email si lo proporcionó' },
          interes:  { type: 'string', description: 'Razón del contacto — qué necesita o qué preguntó' },
          resumen:  { type: 'string', description: 'Resumen breve de la conversación para el equipo' }
        },
        required: []
      }
    },
    {
      name: 'crear_o_actualizar_contacto',
      description: 'Guarda o actualiza el perfil del contacto en el CRM. Llama esta herramienta cuando el paciente diga su nombre, email o teléfono durante la conversación, para enriquecer su ficha.',
      input_schema: {
        type: 'object',
        properties: {
          nombre:   { type: 'string', description: 'Nombre completo del contacto' },
          email:    { type: 'string', description: 'Email del contacto' },
          telefono: { type: 'string', description: 'Teléfono — si viene por WhatsApp ya está disponible' },
          notas:    { type: 'string', description: 'Contexto relevante sobre el contacto o su consulta' }
        },
        required: []
      }
    },
    {
      name: 'derivar_humano',
      description: 'Deriva la conversación a un humano del equipo. Pausa el bot, registra la derivación en el CRM y notifica al responsable. Usa esta herramienta SIEMPRE en lugar de capturar_lead cuando el modo sea atencion.',
      input_schema: {
        type: 'object',
        properties: {
          motivo:   { type: 'string', description: 'Razón de la derivación — qué necesita o qué preguntó' },
          resumen:  { type: 'string', description: 'Resumen breve de la conversación para el equipo' },
          nombre:   { type: 'string', description: 'Nombre del contacto si se conoce' },
          telefono: { type: 'string', description: 'Teléfono si se conoce' }
        },
        required: ['motivo']
      }
    }
  ];

  // ── 7. Funciones auxiliares ───────────────────────────────────────────────
  function generarSlots(desde, hasta, minutos = 30) {
    const slots = [];
    let [h, m] = desde.split(':').map(Number);
    const [hf, mf] = hasta.split(':').map(Number);
    const finMin = hf * 60 + mf;
    while (h * 60 + m < finMin) {
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      m += minutos;
      if (m >= 60) { h++; m -= 60; }
    }
    return slots;
  }

  // Minutos desde medianoche en Santiago ahora mismo
  function minutosAhoraStgo() {
    const t = new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' });
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }
  const hoyISOStgo = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

  function filtrarSlotsPasados(slots, fecha) {
    if (fecha !== hoyISOStgo) return slots;
    const minAhora = minutosAhoraStgo() + 60; // buffer 60 min: solo mostrar horas con al menos 1h de anticipación
    return slots.filter(s => {
      const [h, m] = s.split(':').map(Number);
      return h * 60 + m > minAhora;
    });
  }

  async function ejecutarBuscarDisponibilidad(especialista_id, fecha) {
    const _espUuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!_espUuidRe.test(especialista_id || '')) return { error: 'Profesional no válido' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return { error: 'Fecha inválida' };
    const r1 = await fetch(
      `${SUPABASE_URL}/rest/v1/especialistas?id=eq.${especialista_id}&cliente_id=eq.${cliente_id}&select=horario`,
      { headers: sh }
    );
    const [esp] = await r1.json();
    if (!esp) return { error: 'Profesional no encontrado' };

    const horario = esp.horario || {};
    const fechaObj = new Date(fecha + 'T12:00:00');
    const diasKey  = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
    const diaHorario = horario[diasKey[fechaObj.getDay()]];

    if (!diaHorario?.activo || !diaHorario.bloques?.length) {
      return { disponible: false, mensaje: 'El profesional no trabaja ese día.' };
    }

    const slotsBase = diaHorario.bloques.flatMap(b => generarSlots(b.desde, b.hasta, 30));
    const slotsFiltrados = filtrarSlotsPasados(slotsBase, fecha);

    // Incluir citas sin especialista_id asignado (pueden bloquear el slot igual)
    const r2 = await fetch(
      `${SUPABASE_URL}/rest/v1/citas?cliente_id=eq.${cliente_id}&fecha=eq.${fecha}&estado=neq.canceled&or=(especialista_id.eq.${especialista_id},especialista_id.is.null)&select=hora,servicio`,
      { headers: sh }
    );
    const citasExistentes = await r2.json();

    // Bloquear todos los slots que caen dentro de la duración de cada cita
    const ocupadas = new Set();
    for (const c of (citasExistentes || [])) {
      const horaStr = c.hora?.slice(0, 5);
      if (!horaStr) continue;
      const [ch, cm] = horaStr.split(':').map(Number);
      const startMin = ch * 60 + cm;
      const srv = serviciosCatalogo.find(s => s.nombre === c.servicio);
      const durMin = srv?.duracion ? parseInt(srv.duracion) : 30;
      for (let s = startMin; s < startMin + durMin; s += 30) {
        ocupadas.add(`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`);
      }
    }

    const disponibles = slotsFiltrados.filter(s => !ocupadas.has(s));

    if (!disponibles.length) {
      return { disponible: false, mensaje: 'No hay horas disponibles ese día.' };
    }

    // Convertir slots individuales en rangos legibles (ej: "09:00 a 13:00 y 14:00 a 17:30")
    function slotsARangos(slots) {
      const rangos = [];
      let ini = slots[0], prev = slots[0];
      for (let i = 1; i < slots.length; i++) {
        const [ph, pm] = prev.split(':').map(Number);
        const [ch, cm] = slots[i].split(':').map(Number);
        if (ch * 60 + cm - (ph * 60 + pm) === 30) { prev = slots[i]; continue; }
        const [pph, ppm] = prev.split(':').map(Number);
        const finMin = pph * 60 + ppm + 30;
        rangos.push(`${ini} a ${String(Math.floor(finMin/60)).padStart(2,'0')}:${String(finMin%60).padStart(2,'0')}`);
        ini = slots[i]; prev = slots[i];
      }
      const [lh, lm] = prev.split(':').map(Number);
      const finMin = lh * 60 + lm + 30;
      rangos.push(`${ini} a ${String(Math.floor(finMin/60)).padStart(2,'0')}:${String(finMin%60).padStart(2,'0')}`);
      return rangos.join(' y ');
    }

    const rangosTexto = slotsARangos(disponibles);
    return { disponible: true, horas: disponibles, rangos: rangosTexto };
  }

  async function ejecutarVerDisponibilidadSemana(especialista_id_param) {
    const diasKey   = ['dom','lun','mar','mie','jue','vie','sab'];
    const diasFmt   = { dom:'Domingo', lun:'Lunes', mar:'Martes', mie:'Miércoles', jue:'Jueves', vie:'Viernes', sab:'Sábado' };
    const messFmt   = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

    const esps = especialista_id_param
      ? espLista.filter(e => e.id === especialista_id_param)
      : espLista;
    if (!esps.length) return { disponible: false, mensaje: 'No hay profesionales activos.' };

    const hoy = new Date(hoyISOStgo + 'T12:00:00');

    // Si hoy es sábado (6) o domingo (0), arrancar desde el lunes siguiente
    const diaSemana = hoy.getDay(); // 0=dom, 6=sab
    const diasHastaLunes = diaSemana === 6 ? 2 : diaSemana === 0 ? 1 : 0;
    const inicio = new Date(hoy);
    inicio.setDate(hoy.getDate() + diasHastaLunes);

    // Próximos 8 días desde el inicio calculado
    const fechas = Array.from({ length: 8 }, (_, i) => {
      const d = new Date(inicio); d.setDate(inicio.getDate() + i);
      return d.toISOString().split('T')[0];
    });

    // Traer todas las citas existentes en paralelo (una query por especialista)
    const resultados = [];
    const citasPorEsp = await Promise.all(esps.map(esp =>
      fetch(
        `${SUPABASE_URL}/rest/v1/citas?cliente_id=eq.${cliente_id}&fecha=gte.${fechas[0]}&fecha=lte.${fechas[fechas.length-1]}&estado=neq.canceled&or=(especialista_id.eq.${esp.id},especialista_id.is.null)&select=fecha,hora,servicio`,
        { headers: sh }
      ).then(r => r.json()).catch(() => [])
    ));
    for (let ei = 0; ei < esps.length; ei++) {
      const esp = esps[ei];
      const horario = esp.horario || {};
      const citas = Array.isArray(citasPorEsp[ei]) ? citasPorEsp[ei] : [];
      const ocupadasMap = {};
      (Array.isArray(citas) ? citas : []).forEach(c => {
        const f = c.fecha;
        if (!ocupadasMap[f]) ocupadasMap[f] = new Set();
        const horaStr = c.hora?.slice(0, 5);
        if (!horaStr) return;
        const [ch, cm] = horaStr.split(':').map(Number);
        const startMin = ch * 60 + cm;
        const srv = serviciosCatalogo.find(s => s.nombre === c.servicio);
        const durMin = srv?.duracion ? parseInt(srv.duracion) : 30;
        for (let slot = startMin; slot < startMin + durMin; slot += 30) {
          ocupadasMap[f].add(`${String(Math.floor(slot/60)).padStart(2,'0')}:${String(slot%60).padStart(2,'0')}`);
        }
      });

      for (const fecha of fechas) {
        const d = new Date(fecha + 'T12:00:00');
        const diaKey = diasKey[d.getDay()];
        const diaH   = horario[diaKey];
        if (!diaH?.activo || !diaH.bloques?.length) continue;

        const ocupadas = ocupadasMap[fecha] || new Set();

        // Determinar qué bloques tienen al menos un slot libre
        const bloquesConDisponibilidad = diaH.bloques.filter(b => {
          const bSlots = filtrarSlotsPasados(generarSlots(b.desde, b.hasta, 30), fecha);
          return bSlots.some(s => !ocupadas.has(s));
        });
        if (!bloquesConDisponibilidad.length) continue;

        // Texto de horario legible: "09:00 a 13:00 y 14:00 a 18:00"
        const horarioTexto = bloquesConDisponibilidad.map(b => `${b.desde} a ${b.hasta}`).join(' y ');

        // Slots individuales (para el bot cuando el paciente elija este día)
        const slotsDisponibles = bloquesConDisponibilidad.flatMap(b =>
          filtrarSlotsPasados(generarSlots(b.desde, b.hasta, 30), fecha).filter(s => !ocupadas.has(s))
        );

        const fechaFmt = `${diasFmt[diaKey]} ${d.getDate()} de ${messFmt[d.getMonth()]}`;
        resultados.push({ fecha, fechaFmt, especialista: esp.nombre, especialista_id: esp.id, horarioTexto, horas: slotsDisponibles });
      }
    }

    if (!resultados.length) return { disponible: false, mensaje: 'No hay disponibilidad en los próximos días.' };

    // Construir resumen semanal desde el horario configurado del especialista
    // (siempre en orden lun→dom, sin fechas específicas)
    const semanaOrden = ['lun','mar','mie','jue','vie','sab','dom'];
    const nombresDia  = { lun:'Lunes', mar:'Martes', mie:'Miércoles', jue:'Jueves', vie:'Viernes', sab:'Sábado', dom:'Domingo' };

    function textoSemanalEsp(esp) {
      const hor = esp.horario || {};
      const grupos = [];
      let g = null;
      for (const dia of semanaOrden) {
        const dH = hor[dia];
        if (!dH?.activo || !dH.bloques?.length) { if (g) { grupos.push(g); g = null; } continue; }
        const ht = dH.bloques.map(b => `${b.desde} a ${b.hasta}`).join(' y ');
        if (g && g.ht === ht) { g.dias.push(dia); }
        else { if (g) grupos.push(g); g = { ht, dias: [dia] }; }
      }
      if (g) grupos.push(g);
      return grupos.map(gr => {
        const ns = gr.dias.map(d => nombresDia[d]);
        const dStr = ns.length === 1 ? ns[0] : ns.length === 2 ? ns.join(' y ') : `${ns[0]} a ${ns[ns.length-1]}`;
        return `${dStr}: ${gr.ht}`;
      }).join('\n');
    }

    const texto = esps.length === 1
      ? textoSemanalEsp(esps[0])
      : esps.map(e => `${e.nombre}:\n${textoSemanalEsp(e)}`).join('\n\n');

    return {
      disponible: true,
      dias: resultados,
      texto,
      instruccion: 'Muestra el campo texto con cada linea separada. OBLIGATORIO: cuando el paciente elija cualquier dia concreto, llama SIEMPRE a buscar_disponibilidad para ese dia antes de mencionar horas. Los horarios de este resultado son generales y no reflejan citas ya agendadas.'
    };
  }

  async function ejecutarCrearCita(params) {
    const {
      especialista_id, nombre_especialista, nombre_paciente, tel_paciente,
      email_paciente, servicio, fecha, hora, duracion, precio
    } = params;

    // Verificar que el slot sigue disponible antes de insertar
    if (especialista_id) {
      const chk = await fetch(
        `${SUPABASE_URL}/rest/v1/citas?cliente_id=eq.${cliente_id}&fecha=eq.${fecha}&estado=neq.canceled&or=(especialista_id.eq.${especialista_id},especialista_id.is.null)&select=hora,servicio`,
        { headers: sh }
      );
      const citasActuales = await chk.json();
      const [hh, hm] = hora.split(':').map(Number);
      const slotMin = hh * 60 + hm;
      const conflicto = (citasActuales || []).some(c => {
        const cs = c.hora?.slice(0, 5); if (!cs) return false;
        const [ch, cm] = cs.split(':').map(Number);
        const citaStart = ch * 60 + cm;
        const srv = serviciosCatalogo.find(s => s.nombre === c.servicio);
        const citaDur = srv?.duracion ? parseInt(srv.duracion) : 30;
        // Conflicto si el slot nuevo cae dentro del rango de la cita existente
        if (slotMin >= citaStart && slotMin < citaStart + citaDur) return true;
        // Conflicto si la nueva cita (duración propia) solapa con el slot existente
        const srv2 = serviciosCatalogo.find(s => s.nombre === servicio);
        const nuevaDur = srv2?.duracion ? parseInt(srv2.duracion) : 30;
        if (citaStart >= slotMin && citaStart < slotMin + nuevaDur) return true;
        return false;
      });
      if (conflicto) {
        return { error: 'Ese horario ya fue tomado. Por favor elige otra hora disponible.' };
      }
    }

    // Insertar en tabla citas
    const rc = await fetch(`${SUPABASE_URL}/rest/v1/citas`, {
      method: 'POST',
      headers: { ...shJson, Prefer: 'return=representation' },
      body: JSON.stringify({
        cliente_id,
        especialista_id:  especialista_id  || null,
        nombre_paciente,
        tel_paciente:     tel_paciente     || null,
        email_paciente:   email_paciente   || null,
        servicio:         servicio         || 'Consulta',
        fecha,
        hora,
        estado: 'pending'
      })
    });

    const citaData = await rc.json();
    if (!rc.ok) {
      console.error('bot-chat: error creando cita:', rc.status, JSON.stringify(citaData));
      return { error: 'No pude crear la cita en el sistema.' };
    }

    const cita = Array.isArray(citaData) ? citaData[0] : citaData;

    const fechaFmt = new Date(fecha + 'T12:00:00').toLocaleDateString('es-CL', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    // Usar datos del negocio ya cargados en la carga paralela inicial
    const metodos_pago  = metodosPagoNegocio;
    const datos_banco   = datosBancoNegocio;
    const email_negocio = emailNegocio;
    const direccion     = direccionNegocio;

    // Enviar email de confirmación directamente desde aquí
    if (email_paciente && process.env.RESEND_API_KEY) {
      console.log('bot-chat: enviando email confirmación');
      try {
        // Helpers para el template
        function he(str) {
          if (!str && str !== 0) return '';
          return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
        }
        function buildPagoHtml(mp, db) {
          if (!mp) return '';
          const activos = [];
          if (mp.webpay)        activos.push('Webpay / Transbank');
          if (mp.transferencia) activos.push('Transferencia bancaria');
          if (mp.efectivo)      activos.push('Efectivo en el local');
          if (!activos.length) return '';
          let bancoRows = '';
          if (mp.transferencia && db && Object.keys(db).length) {
            const filas = [];
            if (db.banco)  filas.push(`Banco: ${he(db.banco)}`);
            if (db.tipo)   filas.push(`Tipo: ${he(db.tipo)}`);
            if (db.cuenta) filas.push(`N° cuenta: ${he(db.cuenta)}`);
            if (db.rut)    filas.push(`RUT: ${he(db.rut)}`);
            if (db.nombre) filas.push(`A nombre de: ${he(db.nombre)}`);
            if (db.email)  filas.push(`Email: ${he(db.email)}`);
            if (filas.length) bancoRows = `<tr><td style="padding:2px 0 10px;text-align:center;font-size:12px;color:#6b7280;line-height:1.8">${filas.join('<br>')}</td></tr>`;
          }
          return `<tr><td style="padding:10px 0 4px;border-top:1px solid #ede9fe;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Métodos de pago</span><br><span style="color:#2d2d2d;font-size:13px;">${activos.join(' · ')}</span></td></tr>${bancoRows}`;
        }
        const precioStr = precio
          ? (typeof precio === 'number' ? '$' + precio.toLocaleString('es-CL') : precio)
          : '';
        const durStr = duracion ? String(duracion) : '';

        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Attempo <contacto@attempo.cl>',
            to: [email_paciente],
            subject: `Tu cita en ${negocioNombre} está confirmada`,
            headers: {
              'List-Unsubscribe': '<mailto:contacto@attempo.cl?subject=unsubscribe>',
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
            },
            html: `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);">
<tr><td style="background:#6C5CE4;padding:28px 32px;text-align:center;">
  <img src="${BASE_URL}/logo_attempo.png" alt="Attempo" height="36" style="display:block;margin:0 auto 8px;">
  <p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;">Todo a tu tiempo</p>
</td></tr>
<tr><td style="padding:32px;text-align:center;">
  <h2 style="margin:0 0 6px;color:#2d2d2d;font-size:20px;">¡Cita confirmada! 🎉</h2>
  <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hola <strong>${he(nombre_paciente)}</strong>, tu hora está reservada.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border-radius:12px;padding:20px;">
    ${nombre_especialista ? `<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Profesional</span><br><span style="color:#2d2d2d;font-size:15px;">${he(nombre_especialista)}</span></td></tr>` : ''}
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Fecha</span><br><span style="color:#2d2d2d;font-size:15px;">${he(fechaFmt)}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Hora</span><br><span style="color:#2d2d2d;font-size:15px;">${he(hora)}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Motivo</span><br><span style="color:#2d2d2d;font-size:15px;">${he(servicio || 'Consulta')}</span></td></tr>
    ${durStr ? `<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Duración</span><br><span style="color:#2d2d2d;font-size:15px;">${he(durStr)}</span></td></tr>` : ''}
    ${precioStr ? `<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Total</span><br><span style="color:#6C5CE4;font-size:16px;font-weight:700;">${he(precioStr)}</span></td></tr>` : ''}
    ${buildPagoHtml(metodos_pago, datos_banco)}
  </table>
  ${direccion ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;"><tr><td style="text-align:center;"><p style="margin:0 0 10px;color:#6b7280;font-size:13px;">📍 ${he(direccion)}</p><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}" target="_blank" style="display:inline-block;padding:10px 22px;background:#6C5CE4;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Ver en Google Maps</a></td></tr></table>` : ''}
  <p style="margin:20px 0 6px;color:#6b7280;font-size:13px;text-align:center;">¿Necesitas cambios? <a href="${BASE_URL}/gestionar-cita?id=${he(cita?.id)}&token=${generateManageToken(cita?.id)}" style="color:#6C5CE4;font-weight:600;text-decoration:none;">Cancelar o reagendar tu cita</a></p>
  ${email_negocio ? `<p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">También puedes enviarnos un mail a <a href="mailto:${he(email_negocio)}" style="color:#6C5CE4;text-decoration:none;">${he(email_negocio)}</a></p>` : ''}
</td></tr>
<tr><td style="background:#f9f8ff;padding:16px 32px;text-align:center;border-top:1px solid #ede9fe;">
  <p style="margin:0;color:#9ca3af;font-size:12px;">Agendado con <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none;">Attempo</a> — Todo a tu tiempo</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`
          })
        });
        if (!emailRes.ok) {
          const errTxt = await emailRes.text();
          console.error('bot-chat: email error', emailRes.status, errTxt);
        } else {
          console.log('bot-chat: email enviado OK');
        }
      } catch (e) {
        console.error('bot-chat: email exception:', e.message);
      }
    } else {
      console.log('bot-chat: email omitido — KEY:', !!process.env.RESEND_API_KEY);
    }

    // Llamar a crear-cita solo para Google Calendar (no email, cita ya creada)
    if (cita?.id) {
      fetch(`${BASE_URL}/api/crear-cita`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_SECRET || '' },
        body: JSON.stringify({
          _cita_id_ya_creada: cita.id,
          cliente_id,
          especialista_id:     especialista_id     || null,
          nombre_especialista: nombre_especialista || null,
          nombre_paciente,
          tel_paciente:        tel_paciente        || null,
          email_paciente:      null,
          negocio_nombre:      negocioNombre       || null,
          servicio:            servicio            || 'Consulta',
          fecha,
          hora,
          duracion:            duracion            || null,
          precio:              precio              || null
        })
      }).catch(e => console.error('bot-chat: crear-cita GC error:', e.message));
    }

    return {
      ok: true,
      cita_id:    cita?.id || null,
      confirmacion: {
        nombre_paciente,
        nombre_especialista: nombre_especialista || null,
        fecha:    fechaFmt,
        fecha_raw: fecha,
        hora,
        servicio: servicio || 'Consulta',
        duracion: duracion || null,
        precio:   precio   || null
      }
    };
  }

  async function ejecutarHerramienta(nombre, params) {
    if (nombre === 'ver_disponibilidad_semana') {
      return await ejecutarVerDisponibilidadSemana(params.especialista_id || null);
    }
    if (nombre === 'buscar_disponibilidad') {
      return await ejecutarBuscarDisponibilidad(params.especialista_id, params.fecha);
    }
    if (nombre === 'crear_cita') {
      return await ejecutarCrearCita(params);
    }
    if (nombre === 'capturar_lead') {
      return await ejecutarCapturarLead(params, emailNegocio, [...historial, { role: 'user', content: mensaje }]);
    }
    if (nombre === 'crear_o_actualizar_contacto') {
      return await ejecutarCrearOActualizarContacto(params);
    }
    if (nombre === 'derivar_humano') {
      return await ejecutarDerivarHumano(params, [...historial, { role: 'user', content: mensaje }]);
    }
    return { error: 'Herramienta no reconocida' };
  }

  // ── 8. Construir mensajes para Claude ─────────────────────────────────────
  // Mantener historial de las últimas 20 entradas (user+assistant cuentan individualmente)
  const MAX_MESSAGES = 20;
  let msgs = historial.slice(-MAX_MESSAGES);

  // Agregar el mensaje nuevo del usuario
  msgs.push({ role: 'user', content: mensaje });

  // ── 9. Llamar a Claude con agentic loop ───────────────────────────────────
  let respuestaFinal  = '';
  let citaCreada      = null;
  let leadCapturado   = false;

  try {
    for (let i = 0; i < 5; i++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key':         ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta':    'prompt-caching-2024-07-31',
          'content-type':      'application/json'
        },
        body: JSON.stringify({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 400,
          system:     [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
          tools,
          messages:   msgs
        })
      });

      const data = await r.json();

      if (r.status === 529 || data.error?.type === 'overloaded_error') {
        if (i < 1) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          continue;
        }
        respuestaFinal = 'Un momento, estoy con mucha demanda. ¿Me repites lo que necesitas?';
        break;
      }

      if (!r.ok) throw new Error(data.error?.message || 'Error de Claude API');

      if (data.stop_reason !== 'tool_use') {
        respuestaFinal = data.content.find(b => b.type === 'text')?.text || '';

        // Salvaguarda: si Claude dice "confirmada/listo" sin haber llamado al tool, forzar tool call
        const pareceConfirmacion = /listo|lista|confirmad|agendad|reservad|quedó\s*(agendad|confirmad|reservad)|cita\s+(cread|lista|registrad)|ya\s+quedas|te\s+queda/i.test(respuestaFinal);
        if (pareceConfirmacion && !citaCreada && i < 4) {
          console.log('bot-chat: Claude confirmó sin llamar al tool — forzando crear_cita');
          msgs.push({ role: 'assistant', content: respuestaFinal });
          msgs.push({ role: 'user', content: 'SISTEMA: Detecté que confirmaste la cita sin llamar al tool crear_cita. Eso es un error. Llama AHORA al tool crear_cita con los datos que ya tienes del historial. No respondas texto hasta que el tool retorne ok:true.' });
          continue;
        }

        msgs.push({ role: 'assistant', content: respuestaFinal });
        break;
      }

      // Hay tool_use — ejecutar herramientas
      const toolBlocks = data.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const block of toolBlocks) {
        const result = await ejecutarHerramienta(block.name, block.input);

        if (block.name === 'crear_cita' && result.ok) {
          citaCreada = { ...block.input, ...result.confirmacion, cita_id: result.cita_id };
        }
        if (block.name === 'capturar_lead' && result.ok) {
          leadCapturado = true;
        }

        toolResults.push({
          type:        'tool_result',
          tool_use_id: block.id,
          content:     JSON.stringify(result)
        });
      }

      msgs = [
        ...msgs,
        { role: 'assistant', content: data.content },
        { role: 'user',      content: toolResults }
      ];
    }
  } catch (err) {
    console.error('bot-chat error:', err);
    return res.status(500).json({ error: 'Error interno: ' + err.message });
  }

  // ── 10. Guardar historial actualizado en chat_sessions ────────────────────
  // Recuperar sessionId si falló al inicio
  if (!sessionId) {
    try {
      const rsF = await fetch(
        `${SUPABASE_URL}/rest/v1/chat_sessions?cliente_id=eq.${cliente_id}&canal=eq.${encodeURIComponent(canal)}&canal_user_id=eq.${encodeURIComponent(canal_user_id)}&select=id&limit=1`,
        { headers: sh }
      );
      const [existSess] = await rsF.json();
      if (existSess?.id) {
        sessionId = existSess.id;
      } else {
        const rcF = await fetch(`${SUPABASE_URL}/rest/v1/chat_sessions`, {
          method: 'POST',
          headers: { ...shJson, Prefer: 'return=representation' },
          body: JSON.stringify({ cliente_id, canal, canal_user_id, canal_user_name: canal_user_name || null, messages: [] })
        });
        const [newSess] = await rcF.json();
        if (newSess?.id) sessionId = newSess.id;
      }
    } catch (_) {}
  }

  if (sessionId) {
    // Normalizar mensajes antes de persistir: eliminar bloques tool_use/tool_result
    // y mensajes de sistema interno para evitar errores 400 y confundir a Claude
    const normalizarMsg = (m) => {
      if (Array.isArray(m.content)) {
        const textos = m.content.filter(b => b.type === 'text').map(b => b.text);
        if (!textos.length) return null; // elimina tool_use-only y tool_result
        return { role: m.role, content: textos.join(' ') };
      }
      if (typeof m.content === 'string' && m.content.startsWith('SISTEMA:')) return null;
      return m;
    };
    const mensajesGuardables = msgs.slice(-MAX_MESSAGES).map(normalizarMsg).filter(Boolean);

    fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?id=eq.${sessionId}`, {
      method: 'PATCH',
      headers: { ...shJson, Prefer: 'return=minimal' },
      body: JSON.stringify({
        messages:            mensajesGuardables,
        canal_user_name:     canal_user_name || null,
        updated_at:          new Date().toISOString(),
        conversation_status: citaCreada ? 'agendo' : leadCapturado ? 'derivado' : 'esperando_respuesta',
        ...(leadCapturado ? { pausa_bot: true } : {}),
      })
    }).catch(e => console.error('bot-chat: error guardando sesión:', e.message));
  }

  await sendMetaReply(respuestaFinal || 'Un momento, intenta de nuevo.', botConfig.delay_min_seg || 0, botConfig.delay_max_seg || 0);
  return res.status(200).json({
    respuesta:    respuestaFinal || 'Un momento, intenta de nuevo.',
    cita_creada:  citaCreada || null,
    delay_min_seg: botConfig.delay_min_seg || 0,
    delay_max_seg: botConfig.delay_max_seg || 0,
  });
}
