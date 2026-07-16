const BASE_URL = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Canales Meta (webhook) deben provenir del servidor con clave interna
  const incomingBody = req.body || {};
  if (['whatsapp', 'messenger', 'instagram'].includes(incomingBody.canal)) {
    const key = req.headers['x-internal-key'];
    if (!process.env.INTERNAL_API_SECRET || key !== process.env.INTERNAL_API_SECRET) {
      return res.status(401).json({ error: 'No autorizado' });
    }
  }

  const { cliente_id, canal, canal_user_id, canal_user_name, mensaje } = incomingBody;
  if (!cliente_id || !canal || !canal_user_id || !mensaje) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
  const SUPABASE_URL  = 'https://xztqawulvrtjvtfixofy.supabase.co';
  const sh = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const shJson = { ...sh, 'Content-Type': 'application/json' };

  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'API key no configurada' });

  // ── 1. Cargar o crear sesión de chat ──────────────────────────────────────
  let sessionId = null;
  let historial = [];

  try {
    const rs = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_sessions?cliente_id=eq.${cliente_id}&canal=eq.${encodeURIComponent(canal)}&canal_user_id=eq.${encodeURIComponent(canal_user_id)}&select=id,messages,pausa_bot&limit=1`,
      { headers: sh }
    );
    const sessions = await rs.json();
    if (Array.isArray(sessions) && sessions.length > 0) {
      sessionId = sessions[0].id;
      historial = Array.isArray(sessions[0].messages) ? sessions[0].messages : [];
      if (sessions[0].pausa_bot) {
        return res.status(200).json({ respuesta: '', pausa: true });
      }
    } else {
      // Crear nueva sesión
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
      if (Array.isArray(created) && created[0]) sessionId = created[0].id;
    }
  } catch (e) {
    console.error('bot-chat: error cargando sesión:', e.message);
  }

  // ── 2. Cargar configuración del bot ───────────────────────────────────────
  let botConfig = { nombre_bot: 'Valentina', tono: 'informal', saludo: '', faqs: [], tipo_bot: 'atencion', conocimiento: '', promociones: [] };
  try {
    const rb = await fetch(
      `${SUPABASE_URL}/rest/v1/bot_config?cliente_id=eq.${cliente_id}&limit=1`,
      { headers: sh }
    );
    const rawBotCfg = await rb.json();
    const [bc] = Array.isArray(rawBotCfg) ? rawBotCfg : [];
    if (bc) {
      botConfig.nombre_bot   = bc.nombre_bot   || 'Valentina';
      botConfig.tono         = bc.tono         || 'informal';
      botConfig.saludo       = bc.saludo       || '';
      botConfig.faqs         = Array.isArray(bc.faqs) ? bc.faqs : [];
      botConfig.tipo_bot     = bc.tipo_bot     || 'atencion';
      botConfig.conocimiento = bc.conocimiento || '';
      botConfig.promociones  = Array.isArray(bc.promociones) ? bc.promociones : [];
    }
    console.log('bot-chat: promociones cargadas =', JSON.stringify(botConfig.promociones));
    if (!bc && process.env.ATTEMPO_VENTAS_CLIENT_ID && cliente_id === process.env.ATTEMPO_VENTAS_CLIENT_ID) {
      botConfig.tipo_bot = 'ventas';
    }
  } catch (e) {
    console.error('bot-chat: error cargando bot_config:', e.message);
  }

  // ── MODO VENTAS (bot de ventas attempo) ──────────────────────────────────
  if (botConfig.tipo_bot === 'ventas') {
    const esPrimerMsg = historial.length === 0;
    const hoyVentas = new Date().toLocaleDateString('es-CL', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Santiago'
    });

    const ventasSystemPrompt = `Eres Valentina del equipo de attempo. Atiendes por WhatsApp a personas interesadas en conocer la plataforma. Eres chilena, cercana y cálida.

SOBRE ATTEMPO:
attempo es una plataforma de agendamiento online para profesionales y clínicas en Chile. Sus pacientes o clientes reservan citas 24/7 desde el celular, reciben recordatorios automáticos por WhatsApp y pueden pagar con Webpay. Todo listo en 5 minutos, sin complicaciones.

PLANES Y PRECIOS:
- Plan Inicio: $24.990/mes + IVA — agenda online + recordatorios WhatsApp + cobro Webpay. Para profesionales solos.
- Plan Pro: $44.990/mes + IVA — todo lo de Inicio + chatbot IA (Attia) que responde consultas y agenda citas en Instagram, WhatsApp y Messenger de forma automática.
- Plan Clínica IA: $119.990/mes + IVA — todo lo de Pro + múltiples profesionales bajo un mismo centro. Para clínicas y centros.
- Todos los planes incluyen 12 días de prueba gratis.

PARA QUIÉN ES:
Psicólogos, psiquiatras, médicos, nutricionistas, matronas, fisioterapeutas, dentistas, abogados, barberías, centros de estética, yoga, pilates y cualquier profesional que agenda citas.

LINK DE REGISTRO:
https://app.attempo.cl/registro

CÓMO RESPONDER:
- Mensajes cortos, máximo 3-4 líneas. Nunca textos largos.
- Una sola pregunta o idea por mensaje.
- Tratas de tú. Usa el nombre del lead desde que lo sabes.
- 1 a 2 emojis por mensaje máximo.
- No digas que eres una IA ni lo confirmes si te preguntan.
- Si no sabes algo técnico específico, di "te consulto con el equipo y te confirmo en un momento".
- Cuando des el precio, hazlo directo, sin rodeos.

FLUJO NATURAL DE CONVERSACIÓN:
1. ${esPrimerMsg ? 'Saluda con calidez y pregunta el nombre.' : 'Continúa la conversación de forma natural.'}
2. Pregunta qué tipo de profesional es o qué negocio tiene.
3. Cuéntale cómo attempo ayuda puntualmente a su rubro.
4. Responde sus dudas sin rodeos.
5. Cuando muestre interés real, mándale el link: "Puedes probarlo 12 días gratis aquí: https://app.attempo.cl/registro 🚀"

RESPUESTAS A OBJECIONES COMUNES:
- "¿Es muy caro?" → "El Plan Inicio son $24.990 al mes + IVA, menos de $1.000 al día. Y con los recordatorios automáticos evitas que tus pacientes se olviden. La mayoría recupera el costo desde el primer mes."
- "¿Es difícil de usar?" → "Para nada, en 5 minutos ya tienes tu agenda lista. Y si necesitas ayuda, te acompañamos en todo el proceso."
- "¿Qué es Attia el chatbot?" → "Es tu asistente IA. Responde consultas y agenda citas automáticamente en Instagram y Messenger mientras tú atiendes. Viene incluido en el Plan Pro."
- "¿Necesito tarjeta de crédito?" → "Sí, la prueba gratis pide una tarjeta, pero no se cobra nada hasta que terminen los 12 días. Y cancelas cuando quieras, sin costo."
- "¿Funciona para [rubro específico]?" → Adapta la respuesta al rubro mencionado y da un ejemplo concreto de cómo attempo les ayuda.

HOY ES: ${hoyVentas}`;

    const MAX_MESSAGES = 20;
    let msgs = historial.slice(-MAX_MESSAGES);
    msgs.push({ role: 'user', content: mensaje });

    let respuestaVentas = '';
    try {
      for (let i = 0; i < 3; i++) {
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
            system:     ventasSystemPrompt,
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

        respuestaVentas = data.content.find(b => b.type === 'text')?.text || '';
        msgs.push({ role: 'assistant', content: respuestaVentas });
        break;
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
          messages:        msgs.slice(-MAX_MESSAGES),
          canal_user_name: canal_user_name || null,
          updated_at:      new Date().toISOString()
        })
      }).catch(e => console.error('bot-chat ventas: error guardando sesión:', e.message));
    }

    return res.status(200).json({ respuesta: respuestaVentas, cita_creada: null });
  }
  // ── FIN MODO VENTAS ───────────────────────────────────────────────────────

  // ── 3. Cargar datos del negocio ───────────────────────────────────────────
  let negocioNombre = 'el negocio';
  let serviciosCatalogo = [];

  try {
    const rn = await fetch(
      `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=nombre_negocio,servicios&limit=1`,
      { headers: sh }
    );
    const [cli] = await rn.json();
    negocioNombre     = cli?.nombre_negocio || 'el negocio';
    serviciosCatalogo = Array.isArray(cli?.servicios) ? cli.servicios : [];
  } catch (e) {
    console.error('bot-chat: error cargando negocio:', e.message);
  }

  // ── 4. Cargar especialistas ───────────────────────────────────────────────
  let espLista = [];
  try {
    const re = await fetch(
      `${SUPABASE_URL}/rest/v1/especialistas?cliente_id=eq.${cliente_id}&activo=eq.true&select=id,nombre,especialidad,horario&order=nombre.asc`,
      { headers: sh }
    );
    espLista = await re.json();
    if (!Array.isArray(espLista)) espLista = [];
  } catch (e) {
    console.error('bot-chat: error cargando especialistas:', e.message);
    espLista = [];
  }

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

  const systemPrompt = `Eres ${botConfig.nombre_bot}, la asistente virtual de ${negocioNombre}. Atiendes por ${canal}. Eres chilena, cálida y profesional. Nunca dices que eres una IA.

TRATO: Usa "${pronombre}" con el paciente. Sin markdown ni asteriscos. Máximo 2 a 3 líneas por respuesta. Sin emojis. UNA SOLA PREGUNTA por mensaje — nunca dos preguntas en el mismo mensaje.

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
${faqsTexto ? `\nPREGUNTAS FRECUENTES:\n${faqsTexto}` : ''}${conocimientoTexto}${promosTexto}

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
2. Pregunta el nombre completo del paciente.
3. Pregunta el servicio. Si hay catálogo, preséntalo así:
   "Contamos con los siguientes servicios:
   - [Servicio 1] (duración · precio)
   - [Servicio 2] ..."
   ¿Cuál necesitas?
4. Si hay un solo profesional, infórmalo: "Serás atendido/a por [nombre], [especialidad]."
   Si hay varios, lista sus nombres y pregunta con quién prefiere.
5. Llama a ver_disponibilidad_semana y presenta el resultado línea por línea. Pregunta qué día prefiere. IMPORTANTE: el campo "texto" muestra el horario general del profesional, NO las horas reales libres (puede haber citas ya agendadas). Nunca uses esos horarios para decirle al paciente qué horas hay disponibles en un día concreto.
6. Cuando el paciente elija un día, SIEMPRE llama a buscar_disponibilidad para ese día antes de mencionar horas. Usa el campo "rangos" para presentar compactamente: "Tenemos disponibilidad de [rangos]. ¿Qué hora te acomoda?" NUNCA listes slots individuales. NUNCA uses los horarios de ver_disponibilidad_semana para responder esto.
7. Cuando el paciente confirme una hora específica, verifica que esté en el campo "horas" de buscar_disponibilidad. ${telDesdeCanal ? `Ya tienes su teléfono (${telDesdeCanal}). Pide el email: "Para enviarte la confirmación necesito tu email, ¿cuál es?"` : `Pide teléfono y email en un solo mensaje: "Para confirmar necesito tu teléfono y email para enviarte la confirmación."`}
8. En cuanto ${telDesdeCanal ? 'el paciente entregue su email' : 'el paciente entregue su teléfono y email'}, USA EL TOOL crear_cita DE INMEDIATO. No respondas texto antes de llamar al tool. El email NO es opcional, es obligatorio para confirmar la cita.

⚠️ REGLA CRÍTICA: NUNCA escribas "confirmada", "listo" ni ningún mensaje de éxito sin haber llamado primero al tool crear_cita y recibido ok:true como respuesta. Si escribes eso sin llamar al tool, estás mintiendo al paciente. La cita solo existe cuando el tool la crea.

RESPUESTA TRAS CREAR CITA (solo después de que crear_cita retorne ok:true):
"¡Listo [nombre]! Tu cita quedó confirmada para el [fecha] a las [hora] con [profesional]. 📅"

REGLAS GENERALES:
- Una sola pregunta por mensaje.
- Si no hay disponibilidad un día, sugiere el siguiente día hábil.
- FECHAS RELATIVAS: "esta semana" = semana actual. "la otra semana"/"la próxima" = semana siguiente. "este lunes/etc." = el más próximo en 7 días. Ante duda, confirma la fecha antes de continuar.
- El cliente_id para crear_cita es siempre: ${cliente_id}`;

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
    const r1 = await fetch(
      `${SUPABASE_URL}/rest/v1/especialistas?id=eq.${especialista_id}&select=horario`,
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

    // Traer todas las citas existentes en ese rango de una sola vez por especialista
    const resultados = [];
    for (const esp of esps) {
      const horario = esp.horario || {};
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/citas?cliente_id=eq.${cliente_id}&fecha=gte.${fechas[0]}&fecha=lte.${fechas[fechas.length-1]}&estado=neq.canceled&or=(especialista_id.eq.${esp.id},especialista_id.is.null)&select=fecha,hora,servicio`,
        { headers: sh }
      );
      const citas = await r.json();
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

    // Traer metodos_pago, datos_banco y email_negocio del negocio
    let metodos_pago = null, datos_banco = null, email_negocio = null, direccion = null;
    try {
      const rn2 = await fetch(
        `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=metodos_pago,datos_banco,email,direccion&limit=1`,
        { headers: sh }
      );
      const [cli2] = await rn2.json();
      metodos_pago  = cli2?.metodos_pago  || null;
      datos_banco   = cli2?.datos_banco   || null;
      email_negocio = cli2?.email         || null;
      direccion     = cli2?.direccion     || null;
    } catch (e) { console.error('bot-chat: error cargando negocio extras:', e.message); }

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
            subject: `Tu cita en ${negocioNombre} está confirmada ✓`,
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
  <p style="margin:20px 0 6px;color:#6b7280;font-size:13px;text-align:center;">¿Necesitas cambios? <a href="${BASE_URL}/gestionar-cita?id=${he(cita?.id)}" style="color:#6C5CE4;font-weight:600;text-decoration:none;">Cancelar o reagendar tu cita</a></p>
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
    return { error: 'Herramienta no reconocida' };
  }

  // ── 8. Construir mensajes para Claude ─────────────────────────────────────
  // Mantener historial de las últimas 20 entradas (user+assistant cuentan individualmente)
  const MAX_MESSAGES = 20;
  let msgs = historial.slice(-MAX_MESSAGES);

  // Agregar el mensaje nuevo del usuario
  msgs.push({ role: 'user', content: mensaje });

  // ── 9. Llamar a Claude con agentic loop ───────────────────────────────────
  let respuestaFinal = '';
  let citaCreada     = null;

  try {
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
          max_tokens: 400,
          system:     systemPrompt,
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
        const pareceConfirmacion = /listo|confirmad|agendad/i.test(respuestaFinal);
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
  if (sessionId) {
    // Si se creó una cita, limpiar el historial para que la siguiente conversación empiece fresco
    const mensajesGuardables = citaCreada
      ? []
      : msgs.slice(-MAX_MESSAGES);

    fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?id=eq.${sessionId}`, {
      method: 'PATCH',
      headers: { ...shJson, Prefer: 'return=minimal' },
      body: JSON.stringify({
        messages:        mensajesGuardables,
        canal_user_name: canal_user_name || null,
        updated_at:      new Date().toISOString()
      })
    }).catch(e => console.error('bot-chat: error guardando sesión:', e.message));
  }

  return res.status(200).json({
    respuesta:   respuestaFinal,
    cita_creada: citaCreada || null
  });
}
