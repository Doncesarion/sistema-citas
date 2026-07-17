const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';

function dentroHorarioComercialStgo() {
  const stgo = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }));
  const hour = stgo.getHours();
  const dow  = stgo.getDay(); // 0=Dom, 6=Sab
  return dow >= 1 && dow <= 6 && hour >= 9 && hour < 20;
}

const FOLLOWUP_MSGS = [
  "¿Seguís por ahí? 😊",
  "Hola de nuevo 😊 ¿Pudiste revisar lo que conversamos? Cualquier duda me cuentas.",
  "¡Último aviso por hoy! Si me escribes ahora podemos seguir la conversación por aquí 😊",
];

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const key = req.headers['x-internal-key'] ?? req.query?.key;
  if (!process.env.INTERNAL_API_SECRET || key !== process.env.INTERNAL_API_SECRET) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh     = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
  const shJson = { ...sh, 'Content-Type': 'application/json' };

  // Cargar conversaciones esperando respuesta con WhatsApp
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_sessions` +
    `?conversation_status=eq.esperando_respuesta` +
    `&canal=eq.whatsapp` +
    `&follow_up_count=lt.4` +
    `&last_client_message_at=not.is.null` +
    `&select=id,cliente_id,canal_user_id,follow_up_count,last_client_message_at,lead_calificado`,
    { headers: sh }
  );
  const sesiones = await r.json();
  if (!Array.isArray(sesiones)) {
    console.error('reactivacion: respuesta inesperada de Supabase:', sesiones);
    return res.status(200).json({ ok: true, procesadas: 0, enviadas: [] });
  }

  const ahora   = Date.now();
  const enviados = [];

  for (const s of sesiones) {
    const minutos = (ahora - new Date(s.last_client_message_at).getTime()) / 60000;
    const count   = s.follow_up_count ?? 0;

    let mensaje    = null;
    let usaHorario = true;

    if (minutos >= 1440 && count === 3) {
      // Follow-up 4: requiere template Meta aprobado (ventana 24h cerrada)
      // Por ahora cerramos conversaciones no calificadas, el resto queda pendiente de template
      if (!s.lead_calificado) {
        await fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?id=eq.${s.id}`, {
          method: 'PATCH',
          headers: { ...shJson, Prefer: 'return=minimal' },
          body: JSON.stringify({ conversation_status: 'cerrada' })
        }).catch(e => console.error('reactivacion: error cerrando sesión:', e.message));
        enviados.push({ id: s.id, accion: 'cerrada_sin_calificar' });
      }
      // TODO: enviar template Meta aprobado para leads calificados
      continue;
    } else if (minutos >= 1200 && count === 2) {
      // Follow-up 3 (~20h): última oportunidad gratuita — no requiere horario comercial
      mensaje    = FOLLOWUP_MSGS[2];
      usaHorario = false;
    } else if (minutos >= 120 && count === 1) {
      // Follow-up 2 (~2h)
      mensaje = FOLLOWUP_MSGS[1];
    } else if (minutos >= 15 && count === 0) {
      // Follow-up 1 (~15min)
      mensaje = FOLLOWUP_MSGS[0];
    }

    if (!mensaje) continue;
    if (usaHorario && !dentroHorarioComercialStgo()) continue;

    // Obtener credenciales WhatsApp del cliente
    const clienteR = await fetch(
      `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${s.cliente_id}&select=canales_meta&limit=1`,
      { headers: sh }
    );
    const [cliente] = await clienteR.json().catch(() => []);
    const waPhoneId = cliente?.canales_meta?.wa_phone_number_id;
    const waToken   = cliente?.canales_meta?.wa_token;
    if (!waPhoneId || !waToken) continue;

    // Enviar mensaje de WhatsApp
    const sendR = await fetch(`https://graph.facebook.com/v20.0/${waPhoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${waToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to:   s.canal_user_id,
        type: 'text',
        text: { body: mensaje }
      })
    });

    if (sendR.ok) {
      await fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?id=eq.${s.id}`, {
        method: 'PATCH',
        headers: { ...shJson, Prefer: 'return=minimal' },
        body: JSON.stringify({ follow_up_count: count + 1 })
      }).catch(e => console.error('reactivacion: error actualizando count:', e.message));
      console.log(`reactivacion: follow_up_${count + 1} enviado a ${s.canal_user_id}`);
      enviados.push({ id: s.id, accion: `follow_up_${count + 1}`, numero: s.canal_user_id });
    } else {
      const errTxt = await sendR.text();
      console.error(`reactivacion: error enviando a ${s.canal_user_id}:`, sendR.status, errTxt);
      enviados.push({ id: s.id, accion: 'error_envio', status: sendR.status });
    }
  }

  return res.status(200).json({
    ok:         true,
    procesadas: sesiones.length,
    enviadas:   enviados,
  });
}
