export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { messages, cliente_id, negocio_nombre } = req.body || {};
  if (!messages || !cliente_id) return res.status(400).json({ error: 'Datos incompletos' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
  const SUPABASE_URL  = 'https://xztqawulvrtjvtfixofy.supabase.co';
  const sh = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'API key no configurada' });

  // Pre-cargar especialistas para incluirlos en el sistema (evita una llamada a Claude por turno)
  let espLista = [];
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/especialistas?cliente_id=eq.${cliente_id}&estado=eq.activo&select=id,nombre,cargo&order=nombre.asc`,
      { headers: sh }
    );
    espLista = await r.json();
    if (!Array.isArray(espLista)) espLista = [];
  } catch(_) { espLista = []; }

  const espTexto = espLista.length
    ? espLista.map(e => `• ${e.nombre} — ${e.cargo || 'Profesional'} (id: ${e.id})`).join('\n')
    : 'No hay profesionales activos en este momento.';

  const hoy = new Date().toLocaleDateString('es-CL', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Santiago'
  });

  const systemPrompt = `Eres Attia, la recepcionista virtual de ${negocio_nombre || 'la clínica'}. Hablas como una persona real: cálida, cercana y natural.

PROFESIONALES DISPONIBLES (usa el id exacto al llamar las herramientas):
${espTexto}

CUANDO ALGUIEN QUIERE AGENDAR, sigue este orden sin saltarte pasos:
1. Pregunta el nombre con calidez. Ej: "¡Genial! ¿Me das tu nombre para la reserva?"
2. Pregunta el motivo de forma casual. Ej: "¿Y qué te trae por aquí, [nombre]?"
3. Si hay un solo profesional, infórmalo directamente: "Te atendería [nombre], [cargo]." Si hay varios, preséntaselos y pregunta con quién prefiere. NO llames a ninguna herramienta para esto — ya tienes la lista arriba.
4. Pregunta la fecha. Ej: "¿Tienes algún día en mente?"
5. Llama a verificar_disponibilidad con el id del profesional y la fecha. Si hay disponibilidad, NO listes las horas en tu respuesta — el sistema las mostrará automáticamente como botones. Solo di algo como: "¡Hay disponibilidad ese día! ¿Cuál hora te acomoda mejor?" Si no hay disponibilidad, ofrece el día siguiente.
6. Cuando el paciente elija una hora, confírmala: "Perfecto, las [hora]."
7. Pide el teléfono. Ej: "¿Me das un número de contacto?" El email es opcional.
8. Resume todo y pregunta si está correcto. Ej: "A ver: [nombre], con [profesional], el [fecha] a las [hora] por [motivo]. ¿Todo bien?"
9. Cuando confirme, llama a crear_cita.
10. Cierra con calidez: "¡Listo, [nombre]! Te esperamos el [fecha] a las [hora]. ¡Hasta pronto!"

CUANDO PREGUNTAN OTRA COSA:
- Horarios generales: ofrece buscar una hora concreta con verificar_disponibilidad.
- Servicios: presenta los profesionales que ya tienes arriba.
- Ubicación u otros datos: indica que no tienes esa info y sugiere llamar al negocio.

TONO:
- Español chileno, conversacional y cálido. Puedes usar emojis con moderación.
- Sin markdown ni asteriscos para negritas.
- Una sola pregunta por mensaje, respuestas cortas.
- Usa el nombre del paciente cuando ya lo sabes.
- Si no hay disponibilidad: "Mmm, ese día no hay horas. ¿Te acomoda el [día siguiente]?"
- Si no hay profesionales activos: díselo con naturalidad y sugiere intentar más tarde.
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
      name: 'crear_cita',
      description: 'Crea la cita una vez que el paciente confirmó todos los datos',
      input_schema: {
        type: 'object',
        properties: {
          especialista_id:  { type: 'string' },
          nombre_paciente:  { type: 'string' },
          tel_paciente:     { type: 'string' },
          email_paciente:   { type: 'string' },
          servicio:         { type: 'string' },
          fecha:            { type: 'string', description: 'YYYY-MM-DD' },
          hora:             { type: 'string', description: 'HH:MM' }
        },
        required: ['especialista_id', 'nombre_paciente', 'tel_paciente', 'fecha', 'hora']
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
        `${SUPABASE_URL}/rest/v1/citas?especialista_id=eq.${especialista_id}&fecha=eq.${fecha}&estado=neq.cancelada&select=hora`,
        { headers: sh }
      );
      const citasExistentes = await r2.json();
      const ocupadas = new Set((citasExistentes || []).map(c => c.hora?.slice(0, 5)));
      const disponibles = slots.filter(s => !ocupadas.has(s));

      if (!disponibles.length) return { disponible: false, mensaje: 'No hay horas disponibles ese día' };
      return { disponible: true, slots: disponibles };
    }

    if (nombre === 'crear_cita') {
      const body = {
        cliente_id,
        especialista_id: params.especialista_id,
        nombre_paciente: params.nombre_paciente,
        tel_paciente:    params.tel_paciente   || null,
        email_paciente:  params.email_paciente  || null,
        servicio:        params.servicio        || 'Consulta',
        fecha:           params.fecha,
        hora:            params.hora,
        estado:          'reservada',
        estado_pago:     'pendiente'
      };
      const r = await fetch(`${SUPABASE_URL}/rest/v1/citas`, {
        method: 'POST',
        headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(body)
      });
      const data = await r.json();
      if (!r.ok) return { error: 'Error al crear cita', detalle: data };
      return { ok: true, cita: data[0] };
    }

    return { error: 'Herramienta no reconocida' };
  }

  try {
    let msgs = [...messages];
    let cita_creada = null;
    let slots_disponibles = null;

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
      if (!r.ok) throw new Error(data.error?.message || 'Error de Claude API');

      if (data.stop_reason !== 'tool_use') {
        const text = data.content.find(b => b.type === 'text')?.text || '';
        return res.status(200).json({ mensaje: text, cita_creada, slots_disponibles });
      }

      const toolBlocks = data.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const block of toolBlocks) {
        const result = await ejecutarHerramienta(block.name, block.input);
        if (block.name === 'crear_cita' && result.ok) cita_creada = result.cita;
        if (block.name === 'verificar_disponibilidad' && result.disponible) slots_disponibles = result.slots;
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
