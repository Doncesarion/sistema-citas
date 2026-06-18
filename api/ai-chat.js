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

  const { messages, cliente_id, negocio_nombre, type } = req.body || {};
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

  let nombreBot = 'Attia', tonoBot = 'informal', saludoBot = '', faqsBot = [], conocimientoBot = '', promocionesBot = [];
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
    }
  } catch(_) {}

  const srvTexto = serviciosCatalogo.length
    ? serviciosCatalogo.map(s => {
        const dur = s.duracion ? ` — ${s.duracion} min` : '';
        const prx = s.precio  ? ` — $${Number(s.precio).toLocaleString('es-CL')}` : '';
        return `• ${s.nombre}${dur}${prx}`;
      }).join('\n')
    : 'No hay servicios configurados (usa el motivo que indique el paciente).';

  const pagosMethods = [];
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

  const faqsTexto = faqsBot.length
    ? `\nPREGUNTAS FRECUENTES (responde EXACTAMENTE con estas respuestas cuando te las hagan):\n${faqsBot.map(f => `• Si preguntan: "${f.pregunta}"\n  Responde: "${f.respuesta}"`).join('\n\n')}`
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

  const systemPrompt = `Eres ${nombreBot}, la recepcionista virtual de ${negocio_nombre || 'la clínica'}. ${tonoInstruccion}
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
1. Pregunta el nombre con naturalidad. Ej: "perfecto, ¿me das tu nombre para dejarlo agendado?"
2. Servicio: si solo hay uno en el catálogo, asúmelo automáticamente sin preguntar. Si hay varios, pregunta cuál necesita.
3. Si hay un solo profesional, infórmalo directamente. Si hay varios, pregunta con quién prefiere.
4. Pregunta la fecha en texto: "¿qué día te acomoda? puedes decirme mañana, el lunes, el 20 de junio, etc." Cuando el paciente responda, convierte a YYYY-MM-DD y llama a verificar_disponibilidad con el especialista_id y esa fecha.
5. Cuando verificar_disponibilidad retorne horas disponibles, el sistema las mostrará. Confirma la hora elegida: "perfecto, las [hora]."
6. Pide teléfono y email en UN SOLO mensaje. Si solo da el teléfono, está bien.
7. Llama a confirmar_reserva con TODOS los datos: especialista_id, nombre_especialista, nombre_paciente, tel_paciente, email_paciente, servicio, fecha (YYYY-MM-DD), hora (HH:MM), duracion, precio. NO escribas nada después.

NO uses pedir_fecha — no está disponible en este contexto.

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
- Si no hay disponibilidad: "ese día no tengo horas disponibles, ¿te acomoda el [día siguiente]?"
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

      if (!disponibles.length) return { disponible: false, mensaje: 'No hay horas disponibles ese día' };
      return { disponible: true, slots: disponibles };
    }

    if (nombre === 'confirmar_reserva') {
      return { ok: true, listo: true };
    }

    return { error: 'Herramienta no reconocida' };
  }

  try {
    let msgs = [...messages];
    let slots_disponibles   = null;
    let mostrar_calendario  = false;
    let especialista_id_cal = null;
    let datos_reserva       = null;

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
        return res.status(200).json({ mensaje, slots_disponibles, mostrar_calendario, especialista_id_cal, datos_reserva });
      }

      const toolBlocks = data.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const block of toolBlocks) {
        const result = await ejecutarHerramienta(block.name, block.input);
        if (block.name === 'verificar_disponibilidad' && result.disponible) slots_disponibles = result.slots;
        if (block.name === 'pedir_fecha') { mostrar_calendario = true; especialista_id_cal = block.input?.especialista_id || null; }
        if (block.name === 'confirmar_reserva') datos_reserva = { ...block.input };
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
