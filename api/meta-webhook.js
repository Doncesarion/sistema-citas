const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
const BASE_URL     = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');

export default async function handler(req, res) {
  // ── Verificación de webhook (GET) ─────────────────────────────────────────
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const validToken = process.env.META_VERIFY_TOKEN;
    if (mode === 'subscribe' && token === validToken) {
      return res.status(200).send(challenge);
    }
    return res.status(403).end();
  }

  if (req.method !== 'POST') return res.status(405).end();

  const sh  = { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` };
  const body = req.body || {};
  console.log('meta-webhook object:', body.object);

  // ── Parsear mensaje según canal ───────────────────────────────────────────
  let canal, canal_user_id, canal_user_name, mensaje, channelKey, channelValue;

  if (body.object === 'whatsapp_business_account') {
    const change = body.entry?.[0]?.changes?.[0];
    const msg    = change?.value?.messages?.[0];
    if (!msg || msg.type !== 'text') return res.status(200).end();
    canal           = 'whatsapp';
    canal_user_id   = msg.from;
    canal_user_name = change?.value?.contacts?.[0]?.profile?.name || msg.from;
    mensaje         = msg.text.body;
    channelKey      = 'wa_phone_number_id';
    channelValue    = change?.value?.metadata?.phone_number_id;
  } else if (body.object === 'page') {
    const messaging = body.entry?.[0]?.messaging?.[0];
    if (!messaging?.message?.text) return res.status(200).end();
    canal           = 'messenger';
    canal_user_id   = messaging.sender.id;
    canal_user_name = canal_user_id;
    mensaje         = messaging.message.text;
    channelKey      = 'fb_page_id';
    channelValue    = body.entry?.[0]?.id;
  } else if (body.object === 'instagram') {
    const messaging = body.entry?.[0]?.messaging?.[0];
    if (!messaging?.message?.text) return res.status(200).end();
    canal           = 'instagram';
    canal_user_id   = messaging.sender.id;
    canal_user_name = canal_user_id;
    mensaje         = messaging.message.text;
    channelKey      = 'ig_account_id';
    channelValue    = body.entry?.[0]?.id;
  } else {
    return res.status(200).end();
  }

  if (!channelValue) return res.status(200).end();

  // ── Buscar cliente por channel ID en Supabase ─────────────────────────────
  let cliente_id = null, accessToken = null;
  try {
    const supaUrl = `${SUPABASE_URL}/rest/v1/clientes_sistema?canales_meta->>${channelKey}=eq.${encodeURIComponent(channelValue)}&select=id,canales_meta&limit=1`;
    const r = await fetch(supaUrl, { headers: sh });
    const [cli] = await r.json();
    if (!cli) {
      console.log('meta-webhook: cliente no encontrado para', channelKey, channelValue);
      return res.status(200).end();
    }
    cliente_id  = cli.id;
    const meta  = cli.canales_meta || {};
    accessToken = canal === 'whatsapp'  ? meta.wa_token
                : canal === 'messenger' ? meta.fb_token
                :                        meta.ig_token;

    // Obtener nombre real y foto de perfil para Instagram y Messenger
    let canal_user_photo = null;
    if (canal === 'messenger' && accessToken) {
      try {
        const nr = await fetch(`https://graph.facebook.com/v20.0/${canal_user_id}?fields=first_name,last_name,profile_pic&access_token=${accessToken}`);
        const nd = await nr.json();
        if (nd.first_name) canal_user_name = [nd.first_name, nd.last_name].filter(Boolean).join(' ');
        if (nd.profile_pic) canal_user_photo = nd.profile_pic;
      } catch(_) {}
    } else if (canal === 'instagram' && accessToken) {
      try {
        const nr = await fetch(`https://graph.instagram.com/v21.0/${canal_user_id}?fields=name,profile_pic&access_token=${accessToken}`);
        const nd = await nr.json();
        if (nd.name) canal_user_name = nd.name;
        if (nd.profile_pic) canal_user_photo = nd.profile_pic;
      } catch(_) {}
    }
  } catch (e) {
    console.error('meta-webhook: error buscando cliente:', e.message);
    return res.status(200).end();
  }

  // ── Guardar conversación y mensaje entrante ───────────────────────────────
  let conversacion_id = null;
  try {
    const shJ = { ...sh, 'Content-Type': 'application/json' };
    // Upsert conversacion vía RPC (incrementa no_leidos atómicamente)
    const cvRpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_conversacion`, {
      method: 'POST',
      headers: { ...shJ },
      body: JSON.stringify({
        p_cliente_id:    cliente_id,
        p_canal:         canal,
        p_canal_user_id: canal_user_id,
        p_canal_user_name: canal_user_name || canal_user_id,
        p_mensaje:       mensaje.slice(0, 120)
      })
    });
    if (cvRpc.ok) {
      conversacion_id = await cvRpc.json();
      if (conversacion_id) {
        fetch(`${SUPABASE_URL}/rest/v1/mensajes`, {
          method: 'POST',
          headers: { ...shJ, Prefer: 'return=minimal' },
          body: JSON.stringify({ conversacion_id, cliente_id, rol: 'usuario', contenido: mensaje })
        }).catch(e => console.error('meta-webhook: error guardando mensaje usuario:', e.message));

        // Actualizar foto de perfil si se obtuvo
        if (canal_user_photo) {
          fetch(`${SUPABASE_URL}/rest/v1/conversaciones?id=eq.${conversacion_id}`, {
            method: 'PATCH',
            headers: { ...shJ, Prefer: 'return=minimal' },
            body: JSON.stringify({ canal_user_photo })
          }).catch(() => {});
        }
      }
    }
  } catch (e) {
    console.error('meta-webhook: error guardando conversacion:', e.message);
  }

  // ── Llamar al bot IA ──────────────────────────────────────────────────────
  let respuesta = '';
  try {
    const botRes = await fetch(`${BASE_URL}/api/bot-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_SECRET || '' },
      body: JSON.stringify({ cliente_id, canal, canal_user_id, canal_user_name, mensaje })
    });
    const botData = await botRes.json();
    if (botData.pausa) {
      console.log('meta-webhook: bot pausado para', canal_user_id);
      return res.status(200).end();
    }
    respuesta = botData.respuesta || '';
  } catch (e) {
    console.error('meta-webhook: error llamando bot-chat:', e.message);
    return res.status(200).end();
  }

  // ── Guardar respuesta del bot ─────────────────────────────────────────────
  if (respuesta && conversacion_id) {
    const shJ = { ...sh, 'Content-Type': 'application/json' };
    fetch(`${SUPABASE_URL}/rest/v1/mensajes`, {
      method: 'POST',
      headers: { ...shJ, Prefer: 'return=minimal' },
      body: JSON.stringify({ conversacion_id, cliente_id, rol: 'bot', contenido: respuesta, visto: true })
    }).catch(e => console.error('meta-webhook: error guardando mensaje bot:', e.message));
  }

  console.log('meta-webhook: respuesta generada:', !!respuesta, '| accessToken:', !!accessToken, '| canal:', canal);
  if (!respuesta || !accessToken) { console.log('meta-webhook: abortando envío — respuesta:', !!respuesta, 'token:', !!accessToken); return res.status(200).end(); }

  // ── Enviar respuesta al canal ─────────────────────────────────────────────
  try {
    let sendRes;
    if (canal === 'whatsapp') {
      sendRes = await fetch(`https://graph.facebook.com/v20.0/${channelValue}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: canal_user_id, type: 'text', text: { body: respuesta } })
      });
    } else if (canal === 'instagram') {
      sendRes = await fetch(`https://graph.instagram.com/v21.0/me/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: canal_user_id }, message: { text: respuesta } })
      });
    } else {
      // Messenger
      sendRes = await fetch(`https://graph.facebook.com/v20.0/me/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: canal_user_id }, message: { text: respuesta } })
      });
    }
    const sendBody = await sendRes.text();
    console.log('meta-webhook: send status:', sendRes.status, '| body:', sendBody.slice(0,120));
  } catch (e) {
    console.error('meta-webhook: error enviando respuesta:', e.message);
  }

  return res.status(200).end();
}
