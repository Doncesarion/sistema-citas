import crypto from 'crypto';

function verifySessionToken(token) {
  if (!token) return null;
  const [payload, sig] = [token.slice(0, token.lastIndexOf('.')), token.slice(token.lastIndexOf('.') + 1)];
  if (!payload || !sig) return null;
  const SECRET = process.env.SESSION_SECRET;
  if (!SECRET) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch { return null; }
  const parts = payload.split(':');
  if (parts.length < 3) return null;
  const [cliente_id, rol, expires] = parts;
  if (Date.now() > parseInt(expires)) return null;
  return { cliente_id, rol };
}

// Rate limiting en memoria para modo landing (chatbot público web)
const landingRateLimit = new Map();

const ADMIN_HELP_PROMPT = `Eres Attio, el asistente de ayuda interno de Attempo. Tu misión es responder todas las dudas del administrador sobre cómo usar el dashboard. Eres claro, amigable y directo. Siempre respondes en español.

SECCIONES DEL DASHBOARD:

━━━ AGENDA ━━━
La sección principal del dashboard. Muestra el calendario de citas con tres vistas:
• Vista Semana: muestra los 7 días de la semana. Navega con las flechas ‹ › para avanzar o retroceder semanas.
• Vista Día: muestra las citas de un día específico con detalle por hora. Desde el mini-calendario del panel derecho puedes saltar a cualquier día.
• Vista Lista: muestra todas las citas en formato de lista ordenada por fecha.
El panel derecho tiene: mini-calendario mensual para navegar, lista de citas del día de hoy y el contador de mensajes de WhatsApp del mes.
Haz clic en cualquier cita del calendario para ver sus detalles y opciones (confirmar, cancelar, reagendar).

━━━ CLIENTES ━━━
Base de datos de todos los pacientes y clientes registrados.
• Botón "+ Nuevo cliente": crea un cliente manualmente ingresando sus datos.
• Botón "↑ Cargar CSV": importa clientes en masa desde un archivo Excel/CSV.
• Buscador (sidebar izquierdo): filtra la tabla en tiempo real por nombre, email o teléfono.
• Ficha de cliente: Información, Historial y Notas internas.

━━━ VENTAS ━━━
Registro de todas las transacciones. Muestra fecha, cliente, profesional, servicio, monto y estado.
Filtra por período, asigna profesional o método de pago desde la tabla.
Emite boletas de servicios con ítems adicionales y envíalas por email.

━━━ REPORTES ━━━
Estadísticas y métricas del negocio. Gráficos de citas, ingresos, ocupación y rendimiento por profesional.

━━━ CONFIGURACIÓN ━━━
→ GENERAL: nombre del negocio, logo, link de reservas, recordatorios automáticos, pagos, integraciones.
→ PROFESIONALES: gestión del equipo, horarios y permisos de acceso.
→ HORARIOS: días y bloques horarios de atención. Guarda siempre con "Guardar horario".
→ NOTIFICACIONES: WhatsApp y email automáticos de confirmación y recordatorio.
→ SERVICIOS: catálogo con nombre, duración y precio. El bot usa esto para informar al paciente.
→ PAGOS: Webpay, transferencia bancaria, efectivo. Aparece en correos de confirmación.
→ FACTURACIÓN: tipo de boleta (servicios o venta con IVA), RUT, razón social, dirección.
→ CANALES: conexión de WhatsApp Business, Messenger e Instagram para responder y agendar desde ahí.

━━━ LINK DE RESERVAS ━━━
Disponible en: Agenda → sidebar izquierdo (parte inferior) o Configuración → General → Sitio web de reservas.
Formato: attempo.cl/nombre-de-tu-negocio

━━━ GOOGLE CALENDAR ━━━
Configuración → General → Integraciones → Google Calendar. Al conectar, cada cita nueva aparece automáticamente en tu calendario.

Si te preguntan algo que no está aquí, indícales que contacten a soporte de Attempo.
Sé siempre conciso: responde directamente sin introducciones largas.`;

function incUso(supaUrl, supaKey, cliente_id, campo) {
  const mes = new Date().toISOString().slice(0, 7);
  fetch(`${supaUrl}/rest/v1/rpc/inc_uso`, {
    method: 'POST',
    headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_cliente_id: cliente_id, p_mes: mes, p_campo: campo })
  }).catch(() => {});
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { messages, cliente_id, negocio_nombre, type, attia_conv_id: incomingConvId, email_paciente } = req.body || {};
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Datos incompletos' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'API key no configurada' });

  // ── Modo admin-help (Attio) ──────────────────────────────────────────────
  if (type === 'admin') {
    const sessionToken = req.headers['x-session-token'];
    const session = verifySessionToken(sessionToken);
    if (!session) return res.status(401).json({ error: 'No autorizado' });
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, system: ADMIN_HELP_PROMPT, messages: messages.slice(-8) })
      });
      if (!r.ok) return res.status(502).json({ error: 'Error AI', detail: await r.text() });
      const data = await r.json();
      return res.json({ reply: data.content?.[0]?.text || '' });
    } catch (err) {
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  // ── Modo landing (Attia website sales bot) ────────────────────────────────
  if (type === 'landing') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxReqs = 20;
    const entry = landingRateLimit.get(ip) || { count: 0, start: now };
    if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
    entry.count++;
    landingRateLimit.set(ip, entry);
    if (entry.count > maxReqs) return res.status(429).json({ error: 'Demasiadas solicitudes' });

    const { session_id } = req.body || {};
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
    const sh2 = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
    const hoy = new Date().toLocaleDateString('es-CL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Santiago' });

    const landingPrompt = `Eres Attia, la asistente de attempo en el sitio web. Atiendes a personas interesadas en conocer la plataforma.

SOBRE ATTEMPO:
attempo es una plataforma chilena de agendamiento online con chatbot IA. Los pacientes reservan citas 24/7, reciben recordatorios automáticos por WhatsApp y pueden pagar con Webpay. Sin complicaciones técnicas.

PLANES Y PRECIOS:
- Plan Inicio: $24.990/mes + IVA — agenda online + recordatorios WhatsApp + cobro Webpay. Para profesionales solos.
- Plan Pro: $44.990/mes + IVA — todo lo anterior + chatbot IA (Attia) que responde y agenda en WhatsApp, Instagram y Messenger.
- Plan Clínica IA: $119.990/mes + IVA — todo lo de Pro + múltiples profesionales bajo un mismo centro.
- Todos incluyen 12 días de prueba gratis, sin tarjeta de crédito.

PARA QUIÉN ES:
Psicólogos, médicos, nutricionistas, kinesiólogos, dentistas, fonoaudiólogos, matronas, abogados, barberías, centros de estética, yoga, pilates y cualquier profesional que agenda citas.

CÓMO EMPEZAR:
https://app.attempo.cl/registro — 12 días de prueba, sin tarjeta.
WhatsApp +56957285407 para una demo personalizada.

CÓMO RESPONDER:
- Máximo 3 líneas por mensaje. Una idea por mensaje.
- Tratas de tú. Sin markdown ni asteriscos.
- PROHIBIDO usar emojis. No uses ninguno: ni 😊 ni 👋 ni 📧 ni 🚀 ni ningún otro. Solo texto plano.
- No menciones que eres IA.
- NUNCA digas: "te consulto con el equipo", "le pregunto al equipo técnico", "puedo consultarlo", "escribe a contacto@..." ni ninguna variante. Si no puedes responder, usa capturar_lead — no inventes frases de relleno.

RESPUESTAS A PREGUNTAS FRECUENTES (usa estas directamente, sin derivar):

Integraciones con otros sistemas:
- Reservo: attempo no se integra directamente con Reservo. Los dos pueden correr en paralelo: tu equipo sigue usando Reservo para gestión clínica y fichas, mientras Attia maneja el canal de WhatsApp para reservas y recordatorios. Las citas que agenda Attia quedan en attempo.
- Medilink, Agenda Pro u otro sistema clínico: No hay integración directa. attempo maneja sus propias citas de forma independiente.
- WordPress: La página de reservas de attempo se puede agregar en WordPress como link o iframe. No hay plugin nativo.
- Chatbot en mi web (sitio web propio): Attia funciona en WhatsApp, Instagram y Messenger. No se instala en un sitio web como chat flotante. Lo que sí puedes agregar a tu web es el botón o link de reservas de attempo, o embeber el calendario como iframe.
- Google Calendar: Sí, attempo se conecta con Google Calendar. Cada cita nueva aparece automáticamente en tu calendario.

Configuración y tiempos:
- Tiempo de implementación: Entre 5 y 15 minutos para crear la cuenta y configurar la agenda. Conectar WhatsApp Business toma 1-2 días adicionales dependiendo de la verificación de Meta.
- ¿Necesito un técnico?: No. Todo se configura desde el panel web sin instalaciones.
- ¿Qué necesito para empezar?: Una cuenta de email y, si quieres el chatbot, un número de WhatsApp Business verificado en Meta Business Suite.

Personalización:
- Sí, puedes configurar: nombre y personalidad del bot, mensaje de saludo, preguntas frecuentes, catálogo de servicios con precios y duración, horarios de atención y promociones.

Panel y funcionalidades:
- El dashboard incluye: agenda de citas (vista día/semana/lista), listado de clientes, historial de conversaciones por canal, reportes de citas e ingresos, configuración del bot y métricas de uso mensual.
- No hay app móvil separada. El panel es web y funciona desde el celular en el navegador.

Recordatorios:
- Se envían automáticamente por WhatsApp y email 24h y 1h antes de la cita. El paciente puede confirmar o cancelar desde el mensaje.

Precios y prueba:
- La prueba gratis dura 12 días. No se pide tarjeta de crédito para empezar.
- Puedes cancelar en cualquier momento sin costos adicionales.

CUANDO ALGUIEN PIDE UNA DEMO, QUIERE HABLAR CON ALGUIEN, O HACE UNA PREGUNTA QUE NO ESTÁ EN ESTA LISTA:
Usa de inmediato la herramienta capturar_lead con los datos disponibles (nombre, email o WhatsApp, interés).
Después di únicamente: "Perfecto, alguien del equipo te va a contactar a la brevedad."
No sigas intentando responder. No inventes respuestas para lo que no sabes.

HOY ES: ${hoy}`;

    const landingTools = [
      {
        name: 'capturar_lead',
        description: 'Registra a un visitante que pidió contacto humano o una demo. Alerta al equipo de attempo. Úsala cuando alguien pide hablar con una persona, solicita una demo, o deja sus datos para ser contactado.',
        input_schema: {
          type: 'object',
          properties: {
            nombre:   { type: 'string' },
            email:    { type: 'string' },
            telefono: { type: 'string', description: 'WhatsApp o teléfono' },
            interes:  { type: 'string', description: 'Qué tipo de negocio tiene o qué preguntó' },
            resumen:  { type: 'string', description: 'Resumen breve de la conversación' }
          },
          required: []
        }
      }
    ];

    async function ejecutarCapturarLeadLanding(params) {
      const { nombre, email, telefono, interes, resumen } = params;
      const clienteIdAttempo = process.env.ATTEMPO_VENTAS_CLIENT_ID;
      if (clienteIdAttempo && SUPABASE_KEY) {
        fetch(`${SUPABASE_URL}/rest/v1/leads`, {
          method: 'POST',
          headers: { ...sh2, Prefer: 'return=minimal' },
          body: JSON.stringify({ cliente_id: clienteIdAttempo, canal: 'web', canal_user_id: session_id || null, nombre: nombre || null, email: email || null, telefono: telefono || null, interes: interes || null, resumen: resumen || null, estado: 'nuevo' })
        }).catch(e => console.error('landing capturar_lead:', e.message));
      }
      const key = process.env.RESEND_API_KEY;
      if (key) {
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Attempo <contacto@attempo.cl>',
            to: ['cesarsalinasmunoz@gmail.com'],
            subject: `Lead web — ${nombre || 'Visitante'}`,
            html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#2d2d2d"><h2 style="color:#6C5CE4;margin:0 0 16px">Lead del sitio web</h2><table style="width:100%;font-size:14px"><tr><td style="color:#666;padding:6px 0;width:90px">Canal</td><td><strong>Sitio web (Attia)</strong></td></tr>${nombre ? `<tr><td style="color:#666;padding:6px 0">Nombre</td><td>${nombre}</td></tr>` : ''}${email ? `<tr><td style="color:#666;padding:6px 0">Email</td><td>${email}</td></tr>` : ''}${telefono ? `<tr><td style="color:#666;padding:6px 0">WhatsApp</td><td>${telefono}</td></tr>` : ''}${interes ? `<tr><td style="color:#666;padding:6px 0">Interés</td><td>${interes}</td></tr>` : ''}</table>${resumen ? `<div style="margin-top:16px;padding:12px;background:#f5f3ff;border-radius:8px;font-size:13px;color:#444">${resumen}</div>` : ''}</div>`
          })
        }).catch(() => {});
      }
      return { ok: true };
    }

    let landingMsgs = messages.slice(-12);
    let reply = '';

    try {
      for (let i = 0; i < 5; i++) {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, system: landingPrompt, tools: landingTools, messages: landingMsgs })
        });
        if (!r.ok) return res.status(502).json({ error: 'Error AI' });
        const data = await r.json();

        if (data.stop_reason !== 'tool_use') {
          reply = data.content?.find(b => b.type === 'text')?.text || '';
          break;
        }

        const toolBlocks = data.content.filter(b => b.type === 'tool_use');
        const toolResults = [];
        for (const block of toolBlocks) {
          if (block.name === 'capturar_lead') {
            const result = await ejecutarCapturarLeadLanding(block.input);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
          }
        }
        landingMsgs = [
          ...landingMsgs,
          { role: 'assistant', content: data.content },
          { role: 'user',      content: toolResults }
        ];
      }
    } catch (err) {
      console.error('ai-chat landing error:', err);
      return res.status(500).json({ error: 'Error interno' });
    }

    if (messages.length === 1 && process.env.RESEND_API_KEY) {
      const primerMensaje = messages[0]?.content || '';
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Attempo <contacto@attempo.cl>',
          to: ['cesarsalinasmunoz@gmail.com'],
          subject: 'Nuevo visitante en attempo.cl — Attia',
          html: `<p style="font-family:sans-serif"><strong>Canal:</strong> Sitio web (Attia)<br><strong>Mensaje:</strong> "${String(primerMensaje).slice(0, 400)}"</p>`
        })
      }).catch(() => {});
    }

    if (session_id && SUPABASE_KEY) {
      const cid = `web-${session_id}`;
      const lastUser = messages[messages.length - 1];
      const toInsert = [];
      if (lastUser?.role === 'user') toInsert.push({ cliente_id: cid, remitente: 'visitante', contenido: lastUser.content, leido: false });
      if (reply) toInsert.push({ cliente_id: cid, remitente: 'attia', contenido: reply, leido: false });
      if (toInsert.length) {
        fetch(`${SUPABASE_URL}/rest/v1/soporte_mensajes`, {
          method: 'POST',
          headers: { ...sh2, Prefer: 'return=minimal' },
          body: JSON.stringify(toInsert)
        }).catch(() => {});
      }
    }
    return res.json({ reply });
  }

  // Validar que cliente_id es un UUID válido antes de usarlo
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!cliente_id || !uuidRegex.test(cliente_id)) {
    return res.status(400).json({ error: 'cliente_id inválido' });
  }

  const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
  const SUPABASE_URL  = 'https://xztqawulvrtjvtfixofy.supabase.co';
  const sh = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

  // ── Verificar límite de mensajes para planes chatbot ──────────────────────
  const LIMITES_CHATBOT = { chatbot_2k: 2000, chatbot_5k: 5000, chatbot_8k: 8000 };
  try {
    const mes = new Date().toISOString().slice(0, 7);
    const [planRow, usoRow] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=tipo_plan&limit=1`, { headers: sh }).then(r => r.json()).then(d => d[0]),
      fetch(`${SUPABASE_URL}/rest/v1/uso_mensual?cliente_id=eq.${cliente_id}&mes=eq.${mes}&select=mensajes_ia&limit=1`, { headers: sh }).then(r => r.json()).then(d => d[0])
    ]);
    const limite = LIMITES_CHATBOT[planRow?.tipo_plan];
    if (limite && (usoRow?.mensajes_ia || 0) >= limite) {
      return res.status(200).json({ mensaje: 'hemos alcanzado el límite de mensajes de este mes. para seguir conversando, comunícate directamente con nosotros.', slots_disponibles: null, mostrar_calendario: false, especialista_id_cal: null, datos_reserva: null });
    }
  } catch(_) {}

  // Pre-cargar especialistas y datos del negocio (evita llamadas extra por turno)
  let espLista = [];
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/especialistas?cliente_id=eq.${cliente_id}&activo=eq.true&select=id,nombre,cargo,horario&order=nombre.asc`,
      { headers: sh }
    );
    espLista = await r.json();
    if (!Array.isArray(espLista)) espLista = [];
  } catch(_) { espLista = []; }

  // ── Reconocimiento de paciente recurrente + citas próximas ───────────────
  let pacienteContexto = '';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (email_paciente && emailRegex.test(email_paciente)) {
    try {
      const hoyISO = new Date().toISOString().slice(0,10);
      const hace6m = new Date(Date.now() - 180*24*60*60*1000).toISOString().slice(0,10);
      const en6m   = new Date(Date.now() + 180*24*60*60*1000).toISOString().slice(0,10);
      const rPac = await fetch(
        `${SUPABASE_URL}/rest/v1/citas?email_paciente=ilike.${encodeURIComponent(email_paciente)}&cliente_id=eq.${cliente_id}&fecha=gte.${hace6m}&fecha=lte.${en6m}&order=fecha.desc&limit=5&select=id,nombre_paciente,fecha,hora,servicio,especialista_id,estado`,
        { headers: sh }
      );
      const citasPac = await rPac.json();
      if (Array.isArray(citasPac) && citasPac.length > 0) {
        const nombre = citasPac[0].nombre_paciente || '';
        const pasadas  = citasPac.filter(c => c.fecha < hoyISO);
        const proximas = citasPac.filter(c => c.fecha >= hoyISO && !['cancelada','canceled'].includes(c.estado));

        pacienteContexto = `\nPACIENTE RECURRENTE: ${nombre} ya tiene historial con este negocio. En tu primer mensaje salúdalo por su nombre de forma natural.`;

        if (pasadas.length > 0) {
          const ultima = pasadas[0];
          const fechaUlt = ultima.fecha.split('-').reverse().join('/');
          const espUlt = ultima.especialista_id ? (espLista.find(e => e.id === ultima.especialista_id)?.nombre || '') : '';
          if (ultima.servicio) pacienteContexto += `\nÚltima cita: ${ultima.servicio}${fechaUlt ? ' el ' + fechaUlt : ''}${espUlt ? ' con ' + espUlt : ''}.`;
          if (pasadas.length > 1) pacienteContexto += `\nHistorial reciente: ${pasadas.length} citas en los últimos 6 meses.`;
          pacienteContexto += `\nSi quiere agendar, puedes sugerir el mismo servicio${espUlt ? ' y profesional' : ''} de antes.`;
        }

        if (proximas.length > 0) {
          pacienteContexto += `\nCITAS PRÓXIMAS (usa estos IDs para reagendar o anular):`;
          proximas.forEach(c => {
            const fec = c.fecha.split('-').reverse().join('/');
            const esp = c.especialista_id ? (espLista.find(e => e.id === c.especialista_id)?.nombre || '') : '';
            pacienteContexto += `\n• ${c.servicio || 'Cita'} el ${fec} a las ${(c.hora||'').slice(0,5)}${esp ? ' con '+esp : ''} (cita_id: ${c.id})`;
          });
        }

        pacienteContexto += '\n';
      }
    } catch(e) { console.error('ai-chat paciente-lookup error:', e.message); }
  }

  const espTexto = espLista.length
    ? espLista.map(e => `• ${e.nombre} — ${e.cargo || 'Profesional'} (id: ${e.id})`).join('\n')
    : 'No hay profesionales activos en este momento.';

  let serviciosCatalogo = [], metodosPago = {}, datosBanco = {}, horarioNegocio = null, direccionNegocio = null;
  try {
    const rc = await fetch(
      `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=servicios,metodos_pago,datos_banco,horario_negocio,direccion,promociones&limit=1`,
      { headers: sh }
    );
    const [cli] = await rc.json();
    serviciosCatalogo = Array.isArray(cli?.servicios) ? cli.servicios : [];
    metodosPago = cli?.metodos_pago || {};
    datosBanco  = cli?.datos_banco  || {};
    horarioNegocio = cli?.horario_negocio || null;
    direccionNegocio = cli?.direccion || null;
    // Promociones de clientes_sistema (fuente principal)
    if (Array.isArray(cli?.promociones)) {
      promocionesBot = [...cli.promociones, ...promocionesBot];
    }
  } catch(_) {}

  let nombreBot = 'Attia', tonoBot = 'informal', saludoBot = '', faqsBot = [], conocimientoBot = '', promocionesBot = [], modosBot = [], modoActivoId = null;
  try {
    const rb = await fetch(`${SUPABASE_URL}/rest/v1/bot_config?cliente_id=eq.${cliente_id}&limit=1`, { headers: sh });
    const [bc] = await rb.json();
    if (bc) {
      nombreBot       = bc.nombre_bot   || 'Attia';
      tonoBot         = bc.tono         || 'informal';
      saludoBot       = bc.saludo       || '';
      faqsBot         = Array.isArray(bc.faqs) ? bc.faqs.filter(f => f.pregunta?.trim() && f.respuesta?.trim()) : [];
      conocimientoBot = bc.conocimiento || '';
      promocionesBot  = Array.isArray(bc.promociones) ? bc.promociones : [];
      modosBot        = Array.isArray(bc.modos)        ? bc.modos       : [];
      modoActivoId    = bc.modo_activo  || null;
    }
  } catch(_) {}

  // ── Attia: crear/reanudar conversación en bandeja ──────────────────────────
  let attiaConvId = incomingConvId || null;
  if (!attiaConvId && messages.length) {
    const primerMsg = messages.find(m => m.role === 'user')?.content || '';
    try {
      const cvRes = await fetch(`${SUPABASE_URL}/rest/v1/conversaciones`, {
        method: 'POST',
        headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({
          cliente_id, canal: 'attia',
          canal_user_id: `attia_${Date.now()}`,
          canal_user_name: 'Visitante',
          ultimo_mensaje: String(primerMsg).slice(0, 120),
          ultimo_mensaje_at: new Date().toISOString(),
          no_leidos: 1
        })
      });
      if (cvRes.ok) {
        const cvRows = await cvRes.json();
        attiaConvId = Array.isArray(cvRows) ? cvRows[0]?.id : cvRows?.id;
      } else {
        console.error('ai-chat conv-create error:', cvRes.status, await cvRes.text());
      }
    } catch(e) {
      console.error('ai-chat conv-create error:', e.message);
    }
  }

  const srvTexto = serviciosCatalogo.length
    ? serviciosCatalogo.map(s => {
        const dur = s.duracion ? ` — ${s.duracion} min` : '';
        const prx = s.precio  ? ` — $${Number(s.precio).toLocaleString('es-CL')}` : '';
        return `• ${s.nombre}${dur}${prx}`;
      }).join('\n')
    : 'No hay servicios configurados (usa el motivo que indique el paciente).';

  const pagosMethods = [];
  if (metodosPago.flow)          pagosMethods.push('Flow (link de pago online)');
  if (metodosPago.webpay)        pagosMethods.push('Webpay/Transbank');
  if (metodosPago.transferencia) pagosMethods.push('Transferencia bancaria');
  if (metodosPago.efectivo)      pagosMethods.push('Efectivo en el local');
  const pagosTexto = pagosMethods.length ? pagosMethods.join(', ') : 'Sin métodos configurados';

  const DIAS_LABEL = { lun:'Lunes', mar:'Martes', mie:'Miércoles', jue:'Jueves', vie:'Viernes', sab:'Sábado', dom:'Domingo' };
  function horarioObjToTexto(h) {
    const lineas = Object.entries(DIAS_LABEL)
      .filter(([k]) => h[k]?.activo && h[k]?.bloques?.length)
      .map(([k, l]) => `• ${l}: ${h[k].bloques.map(b => `${b.desde}–${b.hasta}`).join(', ')}`);
    return lineas.length ? lineas.join('\n') : null;
  }
  let horarioTexto = 'No hay horario configurado.';
  if (horarioNegocio && Object.keys(horarioNegocio).length) {
    horarioTexto = horarioObjToTexto(horarioNegocio) || 'No hay horario configurado.';
  } else if (espLista.length) {
    // Usar el horario del primer especialista que tenga uno configurado
    for (const esp of espLista) {
      if (esp.horario && Object.keys(esp.horario).length) {
        const txt = horarioObjToTexto(esp.horario);
        if (txt) { horarioTexto = txt; break; }
      }
    }
  }

  const hoy = new Date().toLocaleDateString('es-CL', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Santiago'
  });

  const tonoInstruccion = tonoBot === 'formal'
    ? 'Usa "usted" con los clientes. Eres profesional, respetuoso y cálido.'
    : 'Eres una persona real detrás de la pantalla: cercana, natural y directa. Usa "tú" con los clientes.';

  const modoActivo  = modosBot.find(m => m.id === modoActivoId);
  const modoTexto   = modoActivo?.instruccion?.trim()
    ? `\nMODO ACTIVO — ${modoActivo.nombre}:\n${modoActivo.instruccion.trim()}\nSigue estas instrucciones con prioridad sobre tu comportamiento habitual.\n`
    : '';
  const faqsModo     = Array.isArray(modoActivo?.faqs) ? modoActivo.faqs.filter(f => f.pregunta?.trim() && f.respuesta?.trim()) : [];
  const todasLasFaqs = faqsModo.length ? faqsModo : faqsBot;

  const faqsTexto = todasLasFaqs.length
    ? `\nPREGUNTAS FRECUENTES (responde EXACTAMENTE con estas respuestas cuando te las hagan):\n${todasLasFaqs.map(f => `• Si preguntan: "${f.pregunta}"\n  Responde: "${f.respuesta}"`).join('\n\n')}`
    : '';

  const conocimientoTexto = conocimientoBot.trim()
    ? `\nINFORMACIÓN ADICIONAL DEL NEGOCIO (úsala para responder preguntas):\n${conocimientoBot.trim()}`
    : '';

  // Promociones vigentes hoy
  const _hoyAI = new Date();
  const _hoyAIstgo = new Date(_hoyAI.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }) + 'T12:00:00');
  const promocionesActivasAI = promocionesBot.filter(p => {
    const nombre = p.titulo?.trim() || p.nombre?.trim();
    if (!nombre) return false;
    if (p.activa === false) return false;
    const ini = p.fecha_inicio ? new Date(p.fecha_inicio + 'T00:00:00') : null;
    const fin = p.fecha_fin    ? new Date(p.fecha_fin   + 'T23:59:59') : null;
    if (ini && _hoyAIstgo < ini) return false;
    if (fin && _hoyAIstgo > fin) return false;
    return true;
  });
  const promosTextoAI = promocionesActivasAI.length
    ? `\nPROMOCIONES VIGENTES HOY:\n${promocionesActivasAI.map(p => {
        const nombre = p.titulo?.trim() || p.nombre?.trim();
        const precio = p.precio ? ` — Precio: $${Number(p.precio).toLocaleString('es-CL')}` : '';
        const prof   = p.profesional_nombre ? ` — Con: ${p.profesional_nombre}` : '';
        return `— ${nombre}: ${p.descripcion||''}${precio}${prof}`;
      }).join('\n')}`
    : '';

  const systemPrompt = `Eres ${nombreBot}, la recepcionista virtual de ${negocio_nombre || 'la clínica'}. ${tonoInstruccion}${modoTexto}${pacienteContexto}
${saludoBot ? `\nSALUDO INICIAL: cuando alguien te escriba por primera vez, usa este mensaje: "${saludoBot}"\n` : ''}
PROFESIONALES DISPONIBLES (usa el id exacto al llamar las herramientas):
${espTexto}

CATÁLOGO DE SERVICIOS (con duración y precio si disponibles):
${srvTexto}

HORARIO DE ATENCIÓN:
${horarioTexto}

DIRECCIÓN:
${direccionNegocio || 'No disponible.'}

MÉTODOS DE PAGO ACEPTADOS:
${pagosTexto}
${conocimientoTexto}${promosTextoAI}
${faqsTexto}

CUANDO ALGUIEN QUIERE AGENDAR, sigue este orden:
1. Pregunta el nombre con naturalidad. Ej: "perfecto, ¿me das tu nombre para dejarlo agendado?" En cuanto el paciente te lo diga, llama registrar_nombre con ese nombre antes de continuar.
2. Servicio: si solo hay uno en el catálogo, asúmelo automáticamente sin preguntar. Si hay varios, pregunta cuál necesita.
3. Si hay un solo profesional, infórmalo directamente. Si hay varios, pregunta con quién prefiere.
4. Pregunta la fecha en texto: "¿qué día te acomoda? puedes decirme mañana, el lunes, el 20 de junio, etc." Cuando el paciente responda, convierte a YYYY-MM-DD y llama a verificar_disponibilidad con el especialista_id y esa fecha.
5. Cuando verificar_disponibilidad retorne horas disponibles, el sistema las mostrará. Confirma la hora elegida: "perfecto, las [hora]."
6. Pide teléfono y email en UN SOLO mensaje. Si solo da el teléfono, está bien.
7. Llama a confirmar_reserva con TODOS los datos: especialista_id, nombre_especialista, nombre_paciente, tel_paciente, email_paciente, servicio, fecha (YYYY-MM-DD), hora (HH:MM), duracion, precio. NO escribas nada después.

Una vez que confirmar_reserva fue ejecutado en la conversación, NO lo vuelvas a llamar. Si el paciente pregunta cómo pagar, responde directamente con los métodos de pago disponibles que tienes arriba.

CUANDO EL PACIENTE QUIERE REAGENDAR UNA CITA:
1. Si tienes sus citas próximas en el contexto, identifica cuál quiere cambiar por lo que describe (día, hora, servicio o profesional).
2. Si no tienes sus citas, llama buscar_citas_paciente con su email (si aún no lo tienes, pídelo).
3. Confirma con el paciente: "tienes [servicio] el [fecha] a las [hora] con [profesional]. ¿La reagendamos?" Si tiene varias, lista las opciones numeradas y que elija.
4. Cuando confirme, llama cancelar_cita con el cita_id correspondiente.
5. Continúa desde el paso 2 del agendamiento (servicio). NO vuelvas a pedir el nombre — ya lo tienes.

CUANDO EL PACIENTE QUIERE ANULAR UNA CITA:
1. Mismos pasos 1 y 2 que reagendamiento para identificar la cita.
2. Confirma: "¿confirmas que quieres anular [servicio] el [fecha] a las [hora]?"
3. Cuando confirme, llama cancelar_cita. Luego responde: "listo, tu cita quedó anulada."

CUANDO PREGUNTAN OTRA COSA:
- Horarios generales: responde con el horario de atención que tienes arriba.
- Dirección: responde con la dirección que tienes arriba. Si no hay, sugiere llamar al negocio.
- Servicios: presenta el catálogo que tienes arriba.
- Preguntas frecuentes: si hay una respuesta configurada arriba para esa pregunta, úsala exactamente.

CÓMO ESCRIBIR (crítico para mantener costos bajos):
- Español chileno natural. Minúsculas como en WhatsApp, mayúscula solo al inicio de oración y en nombres.
- Sin emojis, sin markdown, sin asteriscos, sin listas con guiones.
- Mensajes MUY cortos — máximo 2 oraciones por respuesta. Nunca saludes con párrafos largos.
- Una sola pregunta por mensaje. Nunca hagas dos preguntas a la vez.
- Si ya tienes un dato del contexto (nombre, servicio previo, profesional previo), NO lo preguntes — úsalo directamente.
- Evita frases de relleno: "claro", "por supuesto", "con gusto", "nos alegra", "perfecto", "excelente". Ve directo al punto.
- Usa el nombre del paciente como máximo una vez por conversación, solo si es natural.
- Si no hay disponibilidad (disponible: false sin sobrecupo_disponible): "ese día no tengo horas, ¿te acomoda el [día siguiente]?"
- Si verificar_disponibilidad retorna sobrecupo_disponible: true, ofrece las horas de slots_sobrecupo como fuera de agenda. Si acepta, confirma normalmente.
- Si no hay profesionales activos: díselo brevemente y sugiere intentar más tarde.
- Hoy es ${hoy}. Convierte "mañana", "el lunes", etc. a YYYY-MM-DD.
- El cliente_id para crear_cita es siempre: ${cliente_id}`;

  const tools = [
    {
      name: 'verificar_disponibilidad',
      description: 'Retorna los horarios disponibles de un profesional en una fecha específica',
      input_schema: {
        type: 'object',
        properties: {
          especialista_id: { type: 'string', description: 'ID del profesional (está en el listado del sistema)' },
          fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD' }
        },
        required: ['especialista_id', 'fecha']
      }
    },
    {
      name: 'registrar_nombre',
      description: 'Registra el nombre del paciente en cuanto lo proporciona. Llama esta herramienta inmediatamente después de que el paciente te diga su nombre.',
      input_schema: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre completo del paciente' }
        },
        required: ['nombre']
      }
    },
    {
      name: 'confirmar_reserva',
      description: 'Muestra al paciente un resumen de su reserva con un botón de confirmación. Llama esta herramienta cuando tengas TODOS los datos recopilados.',
      input_schema: {
        type: 'object',
        properties: {
          especialista_id:     { type: 'string' },
          nombre_especialista: { type: 'string' },
          nombre_paciente:     { type: 'string' },
          tel_paciente:        { type: 'string' },
          email_paciente:      { type: 'string' },
          servicio:            { type: 'string' },
          fecha:               { type: 'string', description: 'YYYY-MM-DD' },
          hora:                { type: 'string', description: 'HH:MM' },
          duracion:            { type: 'string', description: 'Ej: 60 min' },
          precio:              { type: 'number', description: 'Valor en pesos sin formato' }
        },
        required: ['especialista_id', 'nombre_paciente', 'fecha', 'hora']
      }
    },
    {
      name: 'cancelar_cita',
      description: 'Cancela una cita existente del paciente. Úsala tanto para anulaciones como antes de reagendar. Requiere el cita_id que aparece en el contexto del paciente o que devuelve buscar_citas_paciente.',
      input_schema: {
        type: 'object',
        properties: {
          cita_id: { type: 'string', description: 'ID UUID de la cita a cancelar' }
        },
        required: ['cita_id']
      }
    },
    {
      name: 'buscar_citas_paciente',
      description: 'Busca las citas próximas de un paciente por email. Úsala cuando el paciente quiere reagendar o anular pero sus citas no están en el contexto.',
      input_schema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email del paciente' }
        },
        required: ['email']
      }
    }
  ];

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

  async function ejecutarHerramienta(nombre, params) {
    if (nombre === 'pedir_fecha') return { ok: true };

    if (nombre === 'registrar_nombre') {
      if (attiaConvId && params.nombre) {
        fetch(`${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${attiaConvId}`, {
          method: 'PATCH',
          headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ canal_user_name: params.nombre })
        }).catch(e => console.error('registrar_nombre error:', e.message));
      }
      return { ok: true };
    }

    if (nombre === 'verificar_disponibilidad') {
      const { especialista_id, fecha } = params;
      const _uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!_uuidRe.test(especialista_id || '')) return { error: 'Profesional no válido' };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return { error: 'Fecha inválida' };
      const r1 = await fetch(
        `${SUPABASE_URL}/rest/v1/especialistas?id=eq.${especialista_id}&select=horario`,
        { headers: sh }
      );
      const [esp] = await r1.json();
      if (!esp) return { error: 'Profesional no encontrado' };

      const horario = esp.horario || {};
      const fechaObj = new Date(fecha + 'T12:00:00');
      const diasKey = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
      const diaHorario = horario[diasKey[fechaObj.getDay()]];

      if (!diaHorario?.activo || !diaHorario.bloques?.length) {
        return { disponible: false, mensaje: 'El profesional no trabaja ese día' };
      }

      const slots = diaHorario.bloques.flatMap(b => generarSlots(b.desde, b.hasta, 30));

      const r2 = await fetch(
        `${SUPABASE_URL}/rest/v1/citas?especialista_id=eq.${especialista_id}&fecha=eq.${fecha}&estado=neq.canceled&select=hora`,
        { headers: sh }
      );
      const citasExistentes = await r2.json();
      const ocupadas = new Set((citasExistentes || []).map(c => c.hora?.slice(0, 5)));
      const disponibles = slots.filter(s => !ocupadas.has(s));

      if (!disponibles.length) {
        if (horario.sobrecupos_habilitados) {
          return { disponible: false, sobrecupo_disponible: true, slots_sobrecupo: slots };
        }
        return { disponible: false, mensaje: 'No hay horas disponibles ese día' };
      }
      return { disponible: true, slots: disponibles };
    }

    if (nombre === 'confirmar_reserva') {
      const { especialista_id, nombre_especialista, nombre_paciente, tel_paciente, email_paciente, servicio, fecha, hora, duracion, precio } = params;
      const _uuidRe2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (especialista_id && !_uuidRe2.test(especialista_id)) return { ok: true, listo: true };
      if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: true, listo: true };
      if (!hora || !/^\d{2}:\d{2}$/.test(hora)) return { ok: true, listo: true };

      // Crear la cita en Supabase
      let cita;
      try {
        const rCita = await fetch(`${SUPABASE_URL}/rest/v1/citas`, {
          method: 'POST',
          headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({
            cliente_id, especialista_id,
            nombre_especialista: nombre_especialista || null,
            nombre_paciente,
            tel_paciente: tel_paciente || null,
            email_paciente: email_paciente || null,
            servicio: servicio || null,
            fecha, hora,
            duracion: duracion ? parseInt(String(duracion)) : null,
            precio: precio || null,
            estado: 'pending'
          })
        });
        const rows = await rCita.json();
        cita = Array.isArray(rows) ? rows[0] : rows;
        if (!cita?.id) return { ok: true, listo: true };
      } catch(e) {
        console.error('confirmar_reserva: cita error:', e.message);
        return { ok: true, listo: true };
      }

      // Si el negocio tiene Flow configurado y el servicio tiene precio → generar link de pago
      const useFlow = !!(metodosPago.flow && metodosPago.flow_api_key && metodosPago.flow_secret_key && precio > 0);
      if (useFlow) {
        try {
          const BASE_URL_CF = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');
          const flowApiUrl  = metodosPago.flow_sandbox ? 'https://sandbox.flow.cl/api' : 'https://www.flow.cl/api';
          const signFlow    = (p, s) => {
            const keys = Object.keys(p).sort();
            return crypto.createHmac('sha256', s).update(keys.map(k => k + p[k]).join('')).digest('hex');
          };
          const fp = {
            apiKey:          metodosPago.flow_api_key,
            commerceOrder:   cita.id,
            subject:         `Cita${servicio ? ': ' + servicio : ''} — ${negocio_nombre || 'la clínica'}`.slice(0, 255),
            currency:        'CLP',
            amount:          String(Math.round(Number(precio))),
            email:           email_paciente || '',
            urlConfirmation: `${BASE_URL_CF}/api/flow-confirm?cid=${cliente_id}`,
            urlReturn:       `${BASE_URL_CF}/api/flow-return?tipo=cita`
          };
          fp.s = signFlow(fp, metodosPago.flow_secret_key);
          const flowResp = await fetch(`${flowApiUrl}/payment/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(fp).toString()
          });
          const flowData = await flowResp.json();
          if (flowData.url && flowData.token) {
            return { ok: true, listo: true, flow_url: `${flowData.url}?token=${flowData.token}`, cita_id: cita.id };
          }
          console.error('confirmar_reserva: flow create error:', JSON.stringify(flowData));
        } catch(e) {
          console.error('confirmar_reserva: flow error:', e.message);
        }
      }

      // Actualizar conversación Attia con datos reales del paciente
      if (attiaConvId) {
        fetch(`${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${attiaConvId}`, {
          method: 'PATCH',
          headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({
            canal_user_id: email_paciente || nombre_paciente,
            canal_user_name: nombre_paciente
          })
        }).catch(e => console.error('ai-chat conv-update error:', e.message));
      }

      return { ok: true, listo: true, cita };
    }

    if (nombre === 'cancelar_cita') {
      const { cita_id } = params;
      const _uuidRe3 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!_uuidRe3.test(cita_id || '')) return { error: 'ID de cita inválido' };
      try {
        const rCan = await fetch(
          `${SUPABASE_URL}/rest/v1/citas?id=eq.${cita_id}&cliente_id=eq.${cliente_id}`,
          {
            method: 'PATCH',
            headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({ estado: 'canceled' })
          }
        );
        return rCan.ok ? { ok: true, cancelada: true } : { error: 'No se pudo cancelar la cita' };
      } catch(e) {
        console.error('cancelar_cita error:', e.message);
        return { error: 'Error al cancelar la cita' };
      }
    }

    if (nombre === 'buscar_citas_paciente') {
      const { email } = params;
      if (!email || !emailRegex.test(email)) return { error: 'Email inválido' };
      try {
        const hoyISO2 = new Date().toISOString().slice(0,10);
        const en6m2   = new Date(Date.now() + 180*24*60*60*1000).toISOString().slice(0,10);
        const rBus = await fetch(
          `${SUPABASE_URL}/rest/v1/citas?email_paciente=ilike.${encodeURIComponent(email)}&cliente_id=eq.${cliente_id}&fecha=gte.${hoyISO2}&fecha=lte.${en6m2}&estado=not.in.(canceled,cancelada)&order=fecha.asc&limit=5&select=id,nombre_paciente,fecha,hora,servicio,especialista_id`,
          { headers: sh }
        );
        const citas = await rBus.json();
        if (!Array.isArray(citas) || !citas.length) return { citas: [], mensaje: 'No encontré citas próximas con ese email.' };
        return {
          citas: citas.map(c => ({
            cita_id: c.id,
            servicio: c.servicio || 'Cita',
            fecha: c.fecha.split('-').reverse().join('/'),
            hora: (c.hora || '').slice(0, 5),
            profesional: c.especialista_id ? (espLista.find(e => e.id === c.especialista_id)?.nombre || '') : ''
          }))
        };
      } catch(e) {
        console.error('buscar_citas_paciente error:', e.message);
        return { error: 'Error buscando citas' };
      }
    }

    return { error: 'Herramienta no reconocida' };
  }

  try {
    const safeMessages = messages
      .slice(-10)
      .map(m => ({ ...m, content: String(m.content || '').slice(0, 800) }));
    let msgs = [...safeMessages];
    let slots_disponibles   = null;
    let mostrar_calendario  = false;
    let especialista_id_cal = null;
    let datos_reserva       = null;
    let cita_flow_url       = null;

    for (let i = 0; i < 5; i++) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key':         ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json'
        },
        body: JSON.stringify({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 300,
          system:     systemPrompt,
          tools,
          messages:   msgs
        })
      });

      const data = await r.json();
      if (r.status === 529 || data.error?.type === 'overloaded_error') {
        if (i < 2) { await new Promise(res => setTimeout(res, 1500)); continue; }
        return res.status(200).json({ mensaje: 'Un momento, estoy con mucha demanda. ¿Me repites lo que necesitas?', slots_disponibles: null, mostrar_calendario: false, especialista_id_cal: null, datos_reserva: null });
      }
      if (!r.ok) throw new Error(data.error?.message || 'Error de Claude API');

      if (data.stop_reason !== 'tool_use') {
        const text = data.content.find(b => b.type === 'text')?.text || '';
        const mensaje = datos_reserva ? '' : text;
        incUso(SUPABASE_URL, SUPABASE_KEY, cliente_id, 'mensajes_ia');

        // Guardar turno actual en bandeja (mensaje usuario + respuesta bot)
        if (attiaConvId) {
          const shSave = { ...sh, 'Content-Type': 'application/json' };
          const curUser = messages[messages.length - 1];
          const msgsArr = [];
          if (curUser?.role === 'user' && curUser.content) {
            msgsArr.push({ conversacion_id: attiaConvId, cliente_id, rol: 'usuario', contenido: String(curUser.content), visto: false });
          }
          const botTxt = text || (datos_reserva ? `Cita agendada: ${datos_reserva.servicio || 'cita'} — ${datos_reserva.fecha} ${datos_reserva.hora}` : '');
          if (botTxt) msgsArr.push({ conversacion_id: attiaConvId, cliente_id, rol: 'bot', contenido: botTxt, visto: true });
          if (msgsArr.length) {
            fetch(`${SUPABASE_URL}/rest/v1/mensajes`, {
              method: 'POST',
              headers: { ...shSave, Prefer: 'return=minimal' },
              body: JSON.stringify(msgsArr)
            }).catch(e => console.error('ai-chat msg-save error:', e.message));
          }
          const ultimoMsg = (botTxt || String(curUser?.content || '')).slice(0, 120);
          fetch(`${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${attiaConvId}`, {
            method: 'PATCH',
            headers: { ...shSave, Prefer: 'return=minimal' },
            body: JSON.stringify({ ultimo_mensaje: ultimoMsg, ultimo_mensaje_at: new Date().toISOString(), no_leidos: 1 })
          }).catch(e => console.error('ai-chat conv-update error:', e.message));
        }

        return res.status(200).json({ mensaje, slots_disponibles, mostrar_calendario, especialista_id_cal, datos_reserva, cita_flow_url, attia_conv_id: attiaConvId });
      }

      const toolBlocks = data.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const block of toolBlocks) {
        const result = await ejecutarHerramienta(block.name, block.input);
        if (block.name === 'verificar_disponibilidad') {
          if (result.disponible) slots_disponibles = result.slots;
          else if (result.sobrecupo_disponible) slots_disponibles = result.slots_sobrecupo;
        }
        if (block.name === 'pedir_fecha') { mostrar_calendario = true; especialista_id_cal = block.input?.especialista_id || null; }
        if (block.name === 'confirmar_reserva') {
          datos_reserva = { ...block.input, ...(result.cita_id ? { cita_id: result.cita_id } : {}) };
          if (result.flow_url) cita_flow_url = result.flow_url;
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
        { role: 'user', content: toolResults }
      ];
    }

    return res.status(500).json({ error: 'Intenta de nuevo' });

  } catch (err) {
    console.error('ai-chat error:', err);
    return res.status(500).json({ error: 'Error interno: ' + err.message });
  }
}
