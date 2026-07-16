import crypto from 'crypto';

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

  const { messages, cliente_id, negocio_nombre, type, attia_conv_id: incomingConvId } = req.body || {};
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Datos incompletos' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'API key no configurada' });

  // ── Modo admin-help (Attio) ──────────────────────────────────────────────
  if (type === 'admin') {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, system: ADMIN_HELP_PROMPT, messages: messages.slice(-10) })
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
    const { session_id } = req.body || {};
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
    const sh2 = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
    const hoy = new Date().toLocaleDateString('es-CL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Santiago' });
    const landingPrompt = `Eres Attia, la asistente virtual de attempo. Atiendes desde el sitio web a personas interesadas en conocer la plataforma.

SOBRE ATTEMPO:
attempo es una plataforma de agendamiento online para profesionales y clínicas en Chile. Tus pacientes o clientes reservan citas 24/7 desde el celular, reciben recordatorios automáticos por WhatsApp y email, y pueden pagar con Webpay. Todo listo en minutos, sin complicaciones técnicas.

PLANES Y PRECIOS:
- Plan Inicio: $24.990/mes + IVA — agenda online, recordatorios automáticos, cobro con Webpay. Para profesionales solos.
- Plan Pro: $44.990/mes + IVA — todo lo de Inicio + chatbot IA (Attia) que responde y agenda en Instagram, WhatsApp y Messenger.
- Plan Clínica IA: $119.990/mes + IVA — todo lo de Pro + múltiples profesionales bajo un mismo centro.
- Todos los planes incluyen 12 días de prueba gratis.

PARA QUIÉN ES:
Psicólogos, médicos, nutricionistas, kinesiólogos, dentistas, fonoaudiólogos, matronas, barberías, centros de estética, yoga, pilates y cualquier profesional que agenda citas.

CÓMO EMPEZAR:
Pueden crear su cuenta gratis en https://app.attempo.cl/registro (12 días de prueba, sin tarjeta de crédito).
O escribirnos por WhatsApp al +56957285407 para una demo personalizada.

CÓMO RESPONDER:
- Mensajes cortos, máximo 3 líneas. Sin textos largos.
- Una sola pregunta o idea por mensaje.
- Usa "tú" con el visitante. No uses markdown ni asteriscos. Sin emojis.
- No menciones que eres una IA.
- Si no sabes algo técnico específico, di "te consulto con el equipo".
- Cuando muestren interés real: "puedes crear tu cuenta gratis en https://app.attempo.cl/registro o escribirnos al WhatsApp +56957285407 para que te mostremos cómo funciona para tu rubro".

HOY ES: ${hoy}`;
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, system: landingPrompt, messages: messages.slice(-12) })
      });
      if (!r.ok) return res.status(502).json({ error: 'Error AI' });
      const data = await r.json();
      const reply = data.content?.[0]?.text || '';
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
    } catch (err) {
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  if (!cliente_id) return res.status(400).json({ error: 'Datos incompletos' });

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

  const espTexto = espLista.length
    ? espLista.map(e => `• ${e.nombre} — ${e.cargo || 'Profesional'} (id: ${e.id})`).join('\n')
    : 'No hay profesionales activos en este momento.';

  let serviciosCatalogo = [], metodosPago = {}, datosBanco = {}, horarioNegocio = null, direccionNegocio = null;
  try {
    const rc = await fetch(
      `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=servicios,metodos_pago,datos_banco,horario_negocio,direccion&limit=1`,
      { headers: sh }
    );
    const [cli] = await rc.json();
    serviciosCatalogo = Array.isArray(cli?.servicios) ? cli.servicios : [];
    metodosPago = cli?.metodos_pago || {};
    datosBanco  = cli?.datos_banco  || {};
    horarioNegocio = cli?.horario_negocio || null;
    direccionNegocio = cli?.direccion || null;
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
    if (!p.titulo?.trim()) return false;
    const ini = p.fecha_inicio ? new Date(p.fecha_inicio + 'T00:00:00') : null;
    const fin = p.fecha_fin    ? new Date(p.fecha_fin   + 'T23:59:59') : null;
    if (ini && _hoyAIstgo < ini) return false;
    if (fin && _hoyAIstgo > fin) return false;
    return true;
  });
  const promosTextoAI = promocionesActivasAI.length
    ? `\nPROMOCIONES VIGENTES HOY:\n${promocionesActivasAI.map(p => `— ${p.titulo}: ${p.descripcion}`).join('\n')}`
    : '';

  const systemPrompt = `Eres ${nombreBot}, la recepcionista virtual de ${negocio_nombre || 'la clínica'}. ${tonoInstruccion}${modoTexto}
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

NO uses pedir_fecha — no está disponible en este contexto.
Una vez que confirmar_reserva fue ejecutado en la conversación, NO lo vuelvas a llamar. Si el paciente pregunta cómo pagar, responde directamente con los métodos de pago disponibles que tienes arriba.

CUANDO PREGUNTAN OTRA COSA:
- Horarios generales: responde con el horario de atención que tienes arriba.
- Dirección: responde con la dirección que tienes arriba. Si no hay, sugiere llamar al negocio.
- Servicios: presenta el catálogo que tienes arriba.
- Preguntas frecuentes: si hay una respuesta configurada arriba para esa pregunta, úsala exactamente.

CÓMO ESCRIBIR:
- Español chileno natural. Escribe en minúsculas como lo haría una persona en WhatsApp, solo mayúscula al inicio de oración y en nombres propios.
- Sin emojis. La cercanía se transmite con las palabras, no con símbolos.
- Sin markdown, sin asteriscos, sin listas con guiones.
- Mensajes cortos. Una sola pregunta por mensaje.
- Puedes usar conectores naturales como "claro", "por supuesto", "con gusto", "nos alegra ayudarte" — pero sin signos de exclamación (¡!). Evita "perfecto" y "excelente" que suenan a bot.
- Usa el nombre del paciente cuando ya lo sabes, pero no en cada mensaje — solo cuando sea natural.
- Si no hay disponibilidad (disponible: false sin sobrecupo_disponible): "ese día no tengo horas disponibles, ¿te acomoda el [día siguiente]?"
- Si verificar_disponibilidad retorna sobrecupo_disponible: true con slots_sobrecupo: informa que ese día la agenda está completa, pero ofrece una hora especial fuera de agenda. Muestra las horas de slots_sobrecupo para que el paciente elija. Si acepta, confirma la reserva normalmente con esa hora.
- Si no hay profesionales activos: díselo con naturalidad y sugiere intentar más tarde.
- Hoy es ${hoy}. Convierte "mañana", "el lunes", etc. a YYYY-MM-DD.
- El cliente_id para crear_cita es siempre: ${cliente_id}`;

  const tools = [
    {
      name: 'pedir_fecha',
      description: 'Muestra un calendario visual al paciente para que elija el día de su cita. SIEMPRE incluye el especialista_id del profesional ya seleccionado.',
      input_schema: {
        type: 'object',
        properties: {
          especialista_id: { type: 'string', description: 'ID del profesional confirmado (está en el listado del sistema)' }
        },
        required: ['especialista_id']
      }
    },
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

      const bloque = diaHorario.bloques[0];
      const slots = generarSlots(bloque.desde, bloque.hasta, 30);

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

    return { error: 'Herramienta no reconocida' };
  }

  try {
    let msgs = [...messages];
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
          max_tokens: 512,
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
