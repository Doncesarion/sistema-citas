export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { messages, cliente_id, negocio_nombre } = req.body || {};
  if (!messages || !cliente_id) return res.status(400).json({ error: 'Datos incompletos' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
  const SUPABASE_URL  = 'https://xztqawulvrtjvtfixofy.supabase.co';

  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'API key no configurada' });

  const hoy = new Date().toLocaleDateString('es-CL', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Santiago'
  });

  const systemPrompt = `Eres Attia, la asistente virtual de ${negocio_nombre || 'la clínica'}.

CUANDO EL USUARIO QUIERE AGENDAR UNA CITA, sigue este flujo exacto:
1. Pregunta el nombre del paciente con un saludo cálido que incluya el nombre del negocio. Ejemplo: "¡Me alegra que quieras reservar con nosotros! ¿Cuál es tu nombre?"
2. Pregunta el motivo de consulta.
3. Llama a listar_especialistas. Si hay uno solo, selecciónalo e informa al paciente. Si hay varios, muéstralos y pregunta con quién prefiere.
4. Pregunta la fecha preferida.
5. Llama a verificar_disponibilidad. Muestra los horarios disponibles en grupos (mañana/tarde si corresponde). Si no hay disponibilidad, ofrece el día siguiente.
6. Pregunta qué hora prefiere.
7. Pide teléfono (obligatorio) y email (opcional, para enviarle confirmación).
8. Resume nombre, profesional, fecha, hora y motivo. Pregunta si todo está correcto.
9. Cuando el paciente confirme, llama a crear_cita.
10. Confirma la cita creada con un mensaje cálido y todos los detalles.

CUANDO EL USUARIO PREGUNTA OTRA COSA:
- Horarios: indica que los profesionales atienden según disponibilidad y ofrece agendar para ver horas reales.
- Servicios: llama a listar_especialistas y describe los profesionales disponibles.
- Ubicación u otra info: di que no tienes esa información y sugiere contactar directamente al negocio.
- Cualquier otro tema: redirige amablemente hacia agendar una cita.

REGLAS:
- Haz UNA pregunta por mensaje. Respuestas cortas y amigables.
- Español chileno natural. Sin asteriscos ni markdown.
- Hoy es ${hoy}.
- Convierte "mañana", "el lunes", etc. a fechas reales en formato YYYY-MM-DD.
- El cliente_id para crear_cita es siempre: ${cliente_id}`;

  const tools = [
    {
      name: 'listar_especialistas',
      description: 'Lista los especialistas activos del negocio',
      input_schema: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'verificar_disponibilidad',
      description: 'Retorna los horarios disponibles de un especialista en una fecha específica',
      input_schema: {
        type: 'object',
        properties: {
          especialista_id: { type: 'string', description: 'ID del especialista' },
          fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD' }
        },
        required: ['especialista_id', 'fecha']
      }
    },
    {
      name: 'crear_cita',
      description: 'Crea la cita en el sistema una vez que el paciente confirmó',
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
    const sh = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

    if (nombre === 'listar_especialistas') {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/especialistas?cliente_id=eq.${cliente_id}&estado=eq.activo&select=id,nombre,cargo&order=nombre.asc`,
        { headers: sh }
      );
      const data = await r.json();
      if (!Array.isArray(data) || !data.length) return { error: 'No hay especialistas activos' };
      return data.map(e => ({ id: e.id, nombre: e.nombre, cargo: e.cargo || 'Profesional' }));
    }

    if (nombre === 'verificar_disponibilidad') {
      const { especialista_id, fecha } = params;
      const r1 = await fetch(
        `${SUPABASE_URL}/rest/v1/especialistas?id=eq.${especialista_id}&select=horario`,
        { headers: sh }
      );
      const [esp] = await r1.json();
      if (!esp) return { error: 'Especialista no encontrado' };

      const horario = esp.horario || {};
      const fechaObj = new Date(fecha + 'T12:00:00');
      const diasKey = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
      const diaKey = diasKey[fechaObj.getDay()];
      const diaHorario = horario[diaKey];

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
        tel_paciente:    params.tel_paciente  || null,
        email_paciente:  params.email_paciente || null,
        servicio:        params.servicio       || 'Consulta',
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

    for (let i = 0; i < 6; i++) {
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
        return res.status(200).json({ mensaje: text, cita_creada });
      }

      const toolBlocks = data.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const block of toolBlocks) {
        const result = await ejecutarHerramienta(block.name, block.input);
        if (block.name === 'crear_cita' && result.ok) cita_creada = result.cita;
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

    return res.status(500).json({ error: 'Demasiados pasos internos, intenta de nuevo' });

  } catch (err) {
    console.error('ai-chat error:', err);
    return res.status(500).json({ error: 'Error interno: ' + err.message });
  }
}
