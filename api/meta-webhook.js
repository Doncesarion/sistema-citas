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
  console.log('meta-webhook object:', body.object, '| entry[0].id:', body.entry?.[0]?.id, '| messaging:', JSON.stringify(body.entry?.[0]?.messaging?.[0]?.message)?.slice(0,80));

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
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/clientes_sistema?canales_meta->>${channelKey}=eq.${encodeURIComponent(channelValue)}&select=id,canales_meta&limit=1`,
      { headers: sh }
    );
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
  } catch (e) {
    console.error('meta-webhook: error buscando cliente:', e.message);
    return res.status(200).end();
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
    respuesta = botData.respuesta || '';
  } catch (e) {
    console.error('meta-webhook: error llamando bot-chat:', e.message);
    return res.status(200).end();
  }

  if (!respuesta || !accessToken) return res.status(200).end();

  // ── Enviar respuesta al canal ─────────────────────────────────────────────
  try {
    if (canal === 'whatsapp') {
      await fetch(`https://graph.facebook.com/v19.0/${channelValue}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: canal_user_id, type: 'text', text: { body: respuesta } })
      });
    } else {
      // Messenger o Instagram — mismo endpoint
      await fetch(`https://graph.facebook.com/v19.0/me/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: canal_user_id }, message: { text: respuesta } })
      });
    }
  } catch (e) {
    console.error('meta-webhook: error enviando respuesta:', e.message);
  }

  return res.status(200).end();
}
