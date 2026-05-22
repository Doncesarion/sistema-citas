const BASE_URL = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { cliente_id, canal, canal_user_id, canal_user_name, mensaje } = req.body || {};
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
      `${SUPABASE_URL}/rest/v1/chat_sessions?cliente_id=eq.${cliente_id}&canal=eq.${encodeURIComponent(canal)}&canal_user_id=eq.${encodeURIComponent(canal_user_id)}&select=id,messages&limit=1`,
      { headers: sh }
    );
    const sessions = await rs.json();
    if (Array.isArray(sessions) && sessions.length > 0) {
      sessionId = sessions[0].id;
      historial = Array.isArray(sessions[0].messages) ? sessions[0].messages : [];
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
  let botConfig = { nombre_bot: 'Valentina', tono: 'informal', saludo: '', faqs: [] };
  try {
    const rb = await fetch(
      `${SUPABASE_URL}/rest/v1/bot_config?cliente_id=eq.${cliente_id}&activo=eq.true&select=nombre_bot,tono,saludo,faqs&limit=1`,
      { headers: sh }
    );
    const [bc] = await rb.json();
    if (bc) {
      botConfig.nombre_bot = bc.nombre_bot || 'Valentina';
      botConfig.tono       = bc.tono       || 'informal';
      botConfig.saludo     = bc.saludo     || '';
      botConfig.faqs       = Array.isArray(bc.faqs) ? bc.faqs : [];
    }
  } catch (e) {
    console.error('bot-chat: error cargando bot_config:', e.message);
  }

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

  // ── 5. System prompt ──────────────────────────────────────────────────────
  const systemPrompt = `Eres ${botConfig.nombre_bot}, la asistente virtual de ${negocioNombre}. Atiendes por ${canal}. Eres chilena, cálida y profesional. Nunca dices que eres una IA.

TRATO: Usa "${pronombre}" con el paciente. Sin markdown ni asteriscos. Máximo 2 a 3 líneas por respuesta. Sin emojis excesivos.

HOY ES: ${hoy}
${horarioResumen ? `\nHORARIO DE ATENCIÓN DEL NEGOCIO:\n${horarioResumen}` : ''}

PROFESIONALES DISPONIBLES:
${espTexto}

CATÁLOGO DE SERVICIOS (con precios y duración):
${srvTexto}
${faqsTexto ? `\nPREGUNTAS FRECUENTES:\n${faqsTexto}` : ''}

INSTRUCCIONES PARA RESPONDER PREGUNTAS GENERALES:
- Si preguntan por precios Y el catálogo tiene servicios: lista los precios directamente desde el catálogo.
- Si preguntan por precios Y no hay catálogo: di que el valor lo coordina el profesional al reservar, y ofrece agendar.
- Si preguntan por horario, disponibilidad o qué días atienden: llama SIEMPRE a ver_disponibilidad_semana. Usa el campo `texto` del resultado tal cual, copiándolo con sus saltos de línea. Responde así: "Contamos con disponibilidad en los siguientes horarios:" + salto de línea + [campo texto del resultado, cada día en su propia línea] + salto de línea + "¿Cuál día te acomoda mejor?"
- Si preguntan por teléfono, dirección u otra información que no tengas: respóndelo brevemente y ofrece agendar.
- Si hay PREGUNTAS FRECUENTES configuradas, úsalas primero.
- NUNCA digas "no tengo esa información" y te quedes ahí. Siempre conecta con lo que puedes hacer.
- Habla con naturalidad. Nada de frases técnicas.

FLUJO PARA AGENDAR UNA CITA (sigue este orden):
1. Saluda con calidez si es el primer mensaje. Menciona brevemente los profesionales disponibles.
2. Pregunta el nombre completo del paciente.
3. Pregunta el servicio o motivo de la consulta.
4. Si hay un solo profesional, confírmalo. Si hay varios, pregunta con quién prefiere.
5. Llama a ver_disponibilidad_semana para mostrar los días disponibles con sus bloques de horario. Presenta la lista y pregunta qué día prefiere.
6. Cuando el paciente elija un día concreto, SIEMPRE llama a buscar_disponibilidad para ese día y profesional. Esto verifica las horas exactas libres descontando citas ya agendadas. Muestra los slots disponibles y pregunta cuál prefiere. NUNCA asumas que una hora está disponible sin llamar a buscar_disponibilidad primero.
7. Cuando el paciente confirme la hora, pide teléfono y email en un solo mensaje. El email es importante para enviarle la confirmación de la cita — si no lo da, igual procede.
8. Con todos los datos, llama a crear_cita. No agregues texto después de esa llamada.

RESPUESTA TRAS CREAR CITA: "¡Listo [nombre]! Tu cita quedó confirmada para el [fecha formateada] a las [hora] con [profesional]. 📅"

REGLAS GENERALES:
- Una sola pregunta por mensaje.
- Si no hay disponibilidad un día, sugiere el día hábil siguiente.
- FECHAS RELATIVAS: "esta semana" = semana actual. "la otra semana" o "la próxima semana" = la semana siguiente. "este lunes/martes/etc." = el más próximo dentro de los próximos 7 días. Ante cualquier duda, confirma la fecha exacta antes de continuar.
- Cuando muestres horarios, un salto de línea por cada día. Nunca en un párrafo continuo.
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
          email_paciente:      { type: 'string', description: 'Opcional' },
          servicio:            { type: 'string' },
          fecha:               { type: 'string', description: 'YYYY-MM-DD' },
          hora:                { type: 'string', description: 'HH:MM' },
          duracion:            { type: 'string', description: 'Ej: 45 min — opcional' },
          precio:              { type: 'number', description: 'Valor en pesos sin formato — opcional' }
        },
        required: ['especialista_id', 'nombre_paciente', 'tel_paciente', 'servicio', 'fecha', 'hora']
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

    const r2 = await fetch(
      `${SUPABASE_URL}/rest/v1/citas?especialista_id=eq.${especialista_id}&fecha=eq.${fecha}&estado=neq.canceled&select=hora`,
      { headers: sh }
    );
    const citasExistentes = await r2.json();
    const ocupadas = new Set((citasExistentes || []).map(c => c.hora?.slice(0, 5)));
    const disponibles = slotsFiltrados.filter(s => !ocupadas.has(s));

    if (!disponibles.length) {
      return { disponible: false, mensaje: 'No hay horas disponibles ese día.' };
    }
    return { disponible: true, horas: disponibles, texto: `Horas disponibles: ${disponibles.join(', ')}.` };
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
        `${SUPABASE_URL}/rest/v1/citas?especialista_id=eq.${esp.id}&fecha=gte.${fechas[0]}&fecha=lte.${fechas[fechas.length-1]}&estado=neq.canceled&select=fecha,hora`,
        { headers: sh }
      );
      const citas = await r.json();
      const ocupadasMap = {};
      (Array.isArray(citas) ? citas : []).forEach(c => {
        const f = c.fecha; if (!ocupadasMap[f]) ocupadasMap[f] = new Set();
        ocupadasMap[f].add(c.hora?.slice(0, 5));
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

    const multiEsp = esps.length > 1;

    // Agrupar días consecutivos con el mismo horario y mismo profesional
    const grupos = [];
    let grupo = [resultados[0]];
    for (let i = 1; i < resultados.length; i++) {
      const prev = resultados[i - 1];
      const curr = resultados[i];
      const diffDias = Math.round((new Date(curr.fecha + 'T12:00:00') - new Date(prev.fecha + 'T12:00:00')) / 86400000);
      if (diffDias === 1 && curr.horarioTexto === prev.horarioTexto && curr.especialista_id === prev.especialista_id) {
        grupo.push(curr);
      } else {
        grupos.push(grupo);
        grupo = [curr];
      }
    }
    grupos.push(grupo);

    const texto = grupos.map(g => {
      const first = g[0];
      const last  = g[g.length - 1];
      const espSuffix = multiEsp ? ` (${first.especialista})` : '';
      if (g.length === 1) {
        return `${first.fechaFmt}${espSuffix}: ${first.horarioTexto}`;
      }
      // rango: "Martes 26 a Viernes 29 de mayo"
      const dF = new Date(first.fecha + 'T12:00:00');
      const dL = new Date(last.fecha + 'T12:00:00');
      const dkF = ['dom','lun','mar','mie','jue','vie','sab'][dF.getDay()];
      const dkL = ['dom','lun','mar','mie','jue','vie','sab'][dL.getDay()];
      const dnF = diasFmt[dkF];
      const dnL = diasFmt[dkL];
      const mnF = messFmt[dF.getMonth()];
      const mnL = messFmt[dL.getMonth()];
      const rango = mnF === mnL
        ? `${dnF} ${dF.getDate()} a ${dnL} ${dL.getDate()} de ${mnL}`
        : `${dnF} ${dF.getDate()} de ${mnF} a ${dnL} ${dL.getDate()} de ${mnL}`;
      return `${rango}${espSuffix}: ${first.horarioTexto}`;
    }).join('\n');

    return {
      disponible: true,
      dias: resultados,
      texto,
      instruccion: 'Copia el campo texto tal como está, con cada línea en su propia línea. Cuando el paciente elija un día, llama SIEMPRE a buscar_disponibilidad para ese día antes de mencionar horas concretas.'
    };
  }

  async function ejecutarCrearCita(params) {
    const {
      especialista_id, nombre_especialista, nombre_paciente, tel_paciente,
      email_paciente, servicio, fecha, hora, duracion, precio
    } = params;

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

    // Llamar a /api/crear-cita de forma fire-and-forget para email y Google Calendar
    if (cita?.id) {
      fetch(`${BASE_URL}/api/crear-cita`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _cita_id_ya_creada: cita.id,
          cliente_id,
          especialista_id:  especialista_id  || null,
          nombre_especialista: nombre_especialista || null,
          nombre_paciente,
          tel_paciente:     tel_paciente     || null,
          email_paciente:   email_paciente   || null,
          servicio:         servicio         || 'Consulta',
          fecha,
          hora,
          duracion:         duracion         || null,
          precio:           precio           || null
        })
      }).catch(e => console.error('bot-chat: fire-and-forget crear-cita error:', e.message));
    }

    const fechaFmt = new Date(fecha + 'T12:00:00').toLocaleDateString('es-CL', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

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
        // Agregar al historial: turno del usuario + respuesta del asistente
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
    // Reconstruir historial guardable: solo mensajes string (sin bloques de tool_use internos)
    const mensajesGuardables = msgs
      .filter(m => typeof m.content === 'string')
      .slice(-MAX_MESSAGES);

    fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?id=eq.${sessionId}`, {
      method: 'PATCH',
      headers: { ...shJson, Prefer: 'return=minimal' },
      body: JSON.stringify({
        messages:       mensajesGuardables,
        canal_user_name: canal_user_name || null,
        updated_at:     new Date().toISOString()
      })
    }).catch(e => console.error('bot-chat: error guardando sesión:', e.message));
  }

  return res.status(200).json({
    respuesta:   respuestaFinal,
    cita_creada: citaCreada || null
  });
}
