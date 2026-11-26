import crypto from 'crypto';
const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
const BASE_URL     = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');

export const config = { api: { bodyParser: false } };

function _saveAttempoLead(canal_user_id, canal_user_name, canal, mensaje, respuesta) {
  const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  const mensajes = [{ role: 'user', content: mensaje, name: canal_user_name || canal_user_id }];
  if (respuesta) mensajes.push({ role: 'assistant', content: respuesta });
  fetch(`${SUPABASE_URL}/rest/v1/web_leads`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ session_id: canal_user_id, mensajes, tipo: 'whatsapp_msg', pagina: canal })
  }).catch(e => console.error('[meta-lead]', e.message));
}

function incUso(cliente_id, campo) {
  const mes = new Date().toISOString().slice(0, 7);
  fetch(`${SUPABASE_URL}/rest/v1/rpc/inc_uso`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_cliente_id: cliente_id, p_mes: mes, p_campo: campo })
  }).catch(() => {});
}

function incWaUsados(cliente_id) {
  fetch(`${SUPABASE_URL}/rest/v1/rpc/inc_wa_usados`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_cliente_id: cliente_id })
  }).catch(() => {});
}

async function checkWaQuota(cliente_id) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=mensajes_wa_limite,mensajes_wa_extra,mensajes_wa_usados&limit=1`,
      { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
    );
    const [d] = await r.json();
    if (!d || !d.mensajes_wa_limite) return true;
    return d.mensajes_wa_usados < (d.mensajes_wa_limite + (d.mensajes_wa_extra || 0));
  } catch (e) {
    console.error('[meta-webhook] checkWaQuota error:', e.message);
    return true;
  }
}

const REDIRECT_URI = 'https://app.attempo.cl/api/meta-webhook';

export default async function handler(req, res) {
  // ── OAuth callback de Meta (GET con ?code=) ───────────────────────────────
  if (req.method === 'GET' && req.query.code) {
    const { code, state, error } = req.query;
    if (error || !code) return res.redirect('/admin?meta_error=1');
    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      if (!stateData.cid) throw new Error('sin cid');
    } catch { return res.redirect('/admin?meta_error=1'); }
    const { cid, flow } = stateData;
    const APP_ID     = process.env.META_APP_ID;
    const APP_SECRET = process.env.META_APP_SECRET;
    const SH = { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` };

    // Función común: intercambiar code por token largo
    const getLongToken = async () => {
      const tr = await fetch(`https://graph.facebook.com/v20.0/oauth/access_token?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${APP_SECRET}&code=${code}`);
      const td = await tr.json();
      if (td.error) throw new Error(td.error.message);
      const lr = await fetch(`https://graph.facebook.com/v20.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${td.access_token}`);
      const ld = await lr.json();
      return ld.access_token || td.access_token;
    };

    // ── Flujo WhatsApp ──────────────────────────────────────────────────────
    if (flow === 'whatsapp') {
      try {
        const userToken = await getLongToken();
        // Obtener cuentas WABA del usuario
        const bizRes = await fetch(`https://graph.facebook.com/v20.0/me/businesses?fields=id,name&access_token=${userToken}`);
        const bizData = await bizRes.json();
        console.log('[meta-webhook/wa] businesses response:', JSON.stringify(bizData).slice(0, 500));
        const businesses = bizData.data || [];
        if (!businesses.length) {
          const dbg = encodeURIComponent(Buffer.from(JSON.stringify({ bizData })).toString('base64').slice(0, 200));
          return res.redirect(`/admin?wa_error=no_business&dbg=${dbg}`);
        }
        const phones = [];
        for (const biz of businesses.slice(0, 5)) {
          const wabaRes = await fetch(`https://graph.facebook.com/v20.0/${biz.id}/owned_whatsapp_business_accounts?fields=id,name&access_token=${userToken}`);
          const wabaData = await wabaRes.json();
          for (const waba of (wabaData.data || []).slice(0, 5)) {
            const phoneRes = await fetch(`https://graph.facebook.com/v20.0/${waba.id}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating&access_token=${userToken}`);
            const phoneData = await phoneRes.json();
            for (const ph of (phoneData.data || [])) {
              phones.push({ ...ph, waba_id: waba.id });
            }
          }
        }
        if (!phones.length) return res.redirect('/admin?wa_error=no_phones');
        // Si hay más de un número, redirigir con opciones para que el usuario elija
        if (phones.length > 1) {
          const encoded = encodeURIComponent(Buffer.from(JSON.stringify({ phones, userToken, cid })).toString('base64'));
          return res.redirect(`/admin?wa_select=1&d=${encoded}`);
        }
        // Un solo número: conectar automáticamente
        const phone = phones[0];
        // Suscribir la app de attempo a esta WABA para recibir webhooks
        await fetch(`https://graph.facebook.com/v20.0/${phone.waba_id}/subscribed_apps`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: userToken })
        }).catch(() => {});
        // Guardar en Supabase
        const r0 = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cid}&select=canales_meta&limit=1`, { headers: SH });
        const [cli] = await r0.json();
        const merged = {
          ...(cli?.canales_meta || {}),
          wa_phone_number_id:   phone.id,
          wa_token:             userToken,
          wa_display_phone:     phone.display_phone_number,
          wa_verified_name:     phone.verified_name,
          wa_waba_id:           phone.waba_id
        };
        await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cid}`, {
          method: 'PATCH',
          headers: { ...SH, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ canales_meta: merged })
        });
        return res.redirect('/admin?wa_ok=1');
      } catch(e) {
        console.error('[meta-webhook/oauth-wa]', e.message);
        return res.redirect('/admin?wa_error=1');
      }
    }

    // ── Flujo Messenger + Instagram (existente) ─────────────────────────────
    try {
      const userToken = await getLongToken();
      const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${userToken}`);
      const pagesData = await pagesRes.json();
      const pages = pagesData.data || [];
      if (!pages.length) return res.redirect('/admin?meta_error=2');
      // Si hay más de una página, mostrar selector
      if (pages.length > 1) {
        const encoded = encodeURIComponent(Buffer.from(JSON.stringify({
          pages: pages.map(p => ({ id: p.id, name: p.name })),
          userToken, cid
        })).toString('base64'));
        return res.redirect(`/admin?fb_select=1&d=${encoded}`);
      }
      const page = pages[0];
      const pageId = page.id;
      const pageToken = page.access_token;
      const igRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=instagram_business_account&access_token=${pageToken}`);
      const igData = await igRes.json();
      const igAccountId = igData.instagram_business_account?.id || null;

      // Suscribir la página para recibir mensajes de Messenger e Instagram
      const subRes = await fetch(`https://graph.facebook.com/v20.0/${pageId}/subscribed_apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: pageToken,
          subscribed_fields: ['messages', 'messaging_postbacks', 'messaging_optins']
        })
      });
      const subData = await subRes.json();
      console.log('[meta-webhook/subscribed_apps page]', JSON.stringify(subData));
      // Suscribir también la cuenta de Instagram para recibir DMs directamente
      if (igAccountId) {
        const igSubRes = await fetch(`https://graph.facebook.com/v20.0/${igAccountId}/subscribed_apps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: pageToken, subscribed_fields: ['messages'] })
        });
        const igSubData = await igSubRes.json();
        console.log('[meta-webhook/subscribed_apps ig]', igAccountId, JSON.stringify(igSubData));
      }
      console.log('[meta-webhook/oauth] pages encontradas:', pages.map(p => p.id + ' ' + p.name));
      console.log('[meta-webhook/oauth] pageId guardado:', pageId, '| igAccountId:', igAccountId, '| cid:', cid);

      const r0 = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cid}&select=canales_meta&limit=1`, { headers: SH });
      const [cli] = await r0.json();
      const merged = {
        ...(cli?.canales_meta || {}),
        fb_page_id: pageId,
        fb_token:   pageToken,
        ...(igAccountId ? { ig_account_id: igAccountId, ig_token: pageToken } : {})
      };
      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cid}`, {
        method: 'PATCH',
        headers: { ...SH, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ canales_meta: merged })
      });
      console.log('[meta-webhook/oauth] PATCH status:', patchRes.status, '| merged:', JSON.stringify(merged).slice(0, 200));
      return res.redirect('/admin?meta_ok=1');
    } catch(e) {
      console.error('[meta-webhook/oauth]', e.message);
      return res.redirect('/admin?meta_error=1');
    }
  }

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

  // Leer raw body para validar firma de Meta
  let rawBody = '';
  await new Promise((resolve, reject) => {
    req.on('data', chunk => { rawBody += chunk.toString(); });
    req.on('end', resolve);
    req.on('error', reject);
  });
  // Parsear manualmente el JSON
  let body;
  try { body = JSON.parse(rawBody); } catch { return res.status(400).json({ error: 'Body inválido' }); }

  // Validar firma X-Hub-Signature-256 de Meta
  const metaAppSecret = process.env.META_APP_SECRET;
  if (!metaAppSecret) return res.status(503).end(); // fail-secure: secret obligatorio
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return res.status(403).end();
  const expected = 'sha256=' + crypto.createHmac('sha256', metaAppSecret).update(rawBody).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return res.status(403).end();
  } catch { return res.status(403).end(); }

  const sh  = { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` };

  // Log diagnóstico para entender qué llega desde Meta
  console.log('[meta-webhook/incoming]', 'object:', body.object, '| entry_id:', body.entry?.[0]?.id, '| has_messaging:', !!body.entry?.[0]?.messaging?.[0]);

  // ── Parsear mensaje según canal ───────────────────────────────────────────
  let canal, canal_user_id, canal_user_name, mensaje, channelKey, channelValue;

  if (body.object === 'whatsapp_business_account') {
    const change = body.entry?.[0]?.changes?.[0];
    const msg    = change?.value?.messages?.[0];
    if (!msg) return res.status(200).end();
    const isAudio = msg.type === 'audio' || msg.type === 'voice';
    if (!isAudio && msg.type !== 'text') return res.status(200).end();
    canal           = 'whatsapp';
    canal_user_id   = msg.from;
    canal_user_name = change?.value?.contacts?.[0]?.profile?.name || msg.from;
    channelKey      = 'wa_phone_number_id';
    channelValue    = change?.value?.metadata?.phone_number_id;

    if (isAudio) {
      const mediaId  = msg.audio?.id || msg.voice?.id;
      const mimeRaw  = msg.audio?.mime_type || msg.voice?.mime_type || 'audio/ogg';
      const baseMime = mimeRaw.split(';')[0].trim();
      const extMap   = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
                         'audio/aac': 'aac', 'audio/amr': 'amr', 'audio/webm': 'webm' };
      const audioExt = extMap[baseMime] || 'ogg';

      if (!process.env.GROQ_API_KEY) {
        console.warn('meta-webhook: GROQ_API_KEY no configurado — audio no transcrito');
        mensaje = '[Audio no transcrito]';
      } else if (!mediaId) {
        console.warn('meta-webhook: audio sin mediaId, tipo:', msg.type);
        mensaje = '[Audio no transcrito]';
      } else {
        // Obtener waToken del cliente
        let waToken = null;
        try {
          const pid = channelValue;
          const rr = await fetch(
            `${SUPABASE_URL}/rest/v1/clientes_sistema?canales_meta->>wa_phone_number_id=eq.${encodeURIComponent(pid)}&select=canales_meta&limit=1`,
            { headers: sh }
          );
          const [cli] = await rr.json();
          waToken = cli?.canales_meta?.wa_token || null;
        } catch(e) {
          console.error('meta-webhook: error obteniendo waToken:', e.message);
        }

        if (!waToken) {
          console.warn('meta-webhook: waToken no encontrado para phone_number_id:', channelValue, '— audio no transcrito');
          mensaje = '[Audio no transcrito]';
        } else {
          try {
            // 1. Obtener URL del archivo de audio desde Meta
            const urlRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
              headers: { Authorization: `Bearer ${waToken}` }
            });
            if (!urlRes.ok) {
              const errData = await urlRes.json().catch(() => ({}));
              console.error('meta-webhook: error obteniendo URL de audio:', urlRes.status, errData.error?.message || '');
              throw new Error(`media URL fetch: ${urlRes.status}`);
            }
            const urlData = await urlRes.json();
            if (!urlData.url) {
              console.error('meta-webhook: respuesta Meta sin URL:', JSON.stringify(urlData).slice(0, 200));
              throw new Error('sin URL en respuesta Meta');
            }

            // 2. Descargar el audio
            const audioRes = await fetch(urlData.url, {
              headers: { Authorization: `Bearer ${waToken}` }
            });
            if (!audioRes.ok) {
              console.error('meta-webhook: error descargando audio:', audioRes.status);
              throw new Error(`audio download: ${audioRes.status}`);
            }
            const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

            // 3. Transcribir con Groq Whisper
            const form = new FormData();
            form.append('file', new Blob([audioBuffer], { type: baseMime }), `audio.${audioExt}`);
            form.append('model', 'whisper-large-v3-turbo');
            form.append('language', 'es');
            const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
              method: 'POST',
              headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
              body: form,
              signal: AbortSignal.timeout(25000)
            });
            if (!whisperRes.ok) {
              const errData = await whisperRes.json().catch(() => ({}));
              console.error('meta-webhook: Groq Whisper error:', whisperRes.status, errData.error?.message || '');
              throw new Error(`Whisper: ${whisperRes.status}`);
            }
            const whisperData = await whisperRes.json();
            if (whisperData.text?.trim()) {
              mensaje = `[Audio] ${whisperData.text.trim()}`;
            } else {
              console.warn('meta-webhook: Whisper retornó texto vacío, user:', canal_user_id, 'mime:', baseMime);
              mensaje = '[Audio no transcrito]';
            }
          } catch(e) {
            console.error('meta-webhook: fallo en transcripción de audio:', e.message);
            mensaje = '[Audio no transcrito]';
          }
        }
      }
    } else {
      mensaje = msg.text.body;
    }
  } else if (body.object === 'page') {
    const messaging = body.entry?.[0]?.messaging?.[0];
    if (!messaging?.message?.text) return res.status(200).end();
    if (messaging.message.is_echo) return res.status(200).end();
    canal           = 'messenger';
    canal_user_id   = messaging.sender.id;
    canal_user_name = canal_user_id;
    mensaje         = messaging.message.text;
    channelKey      = 'fb_page_id';
    channelValue    = body.entry?.[0]?.id;
  } else if (body.object === 'instagram') {
    const messaging = body.entry?.[0]?.messaging?.[0];
    if (!messaging?.message?.text) return res.status(200).end();
    if (messaging.message.is_echo) return res.status(200).end();
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
  let cliente_id = null, accessToken = null, canal_user_photo = null;
  try {
    const supaUrl = `${SUPABASE_URL}/rest/v1/clientes_sistema?canales_meta->>${channelKey}=eq.${encodeURIComponent(channelValue)}&select=id,canales_meta&limit=1`;
    const r = await fetch(supaUrl, { headers: sh });
    const [cli] = await r.json();
    if (!cli) {
      console.log('meta-webhook: cliente no encontrado para', channelKey, channelValue, '— guardando como lead attempo');
      // Mensaje a un número/canal de attempo (no de un cliente) → lead
      const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
      await fetch(`${SUPABASE_URL}/rest/v1/web_leads`, {
        method: 'POST',
        headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          session_id: canal_user_id,
          mensajes: [{ role: 'user', content: mensaje, name: canal_user_name || canal_user_id }],
          tipo: 'whatsapp_msg',
          pagina: canal
        })
      }).catch(e => console.error('[meta-lead]', e.message));
      return res.status(200).end();
    }
    cliente_id  = cli.id;
    const meta  = cli.canales_meta || {};
    accessToken = canal === 'whatsapp'  ? meta.wa_token
                : canal === 'messenger' ? meta.fb_token
                :                        meta.ig_token;

    console.log('[meta-webhook] cliente encontrado:', cliente_id, '| canal:', canal, '| accessToken:', accessToken ? 'OK' : 'NULL');
    // Obtener nombre real y foto de perfil para Instagram y Messenger
    if (canal === 'messenger' && accessToken) {
      try {
        // Intento 1: perfil directo del PSID
        const nr = await fetch(`https://graph.facebook.com/v20.0/${canal_user_id}?fields=name,first_name,last_name,profile_pic&access_token=${accessToken}`);
        const nd = await nr.json();
        if (nd.name) canal_user_name = nd.name;
        else if (nd.first_name) canal_user_name = [nd.first_name, nd.last_name].filter(Boolean).join(' ');
        if (nd.profile_pic) canal_user_photo = nd.profile_pic;

        // Intento 2: endpoint /conversations si sigue siendo número
        if (/^\d+$/.test(canal_user_name || '') && channelValue) {
          try {
            const nr2 = await fetch(`https://graph.facebook.com/v20.0/${channelValue}/conversations?user_id=${canal_user_id}&fields=participants&access_token=${accessToken}`);
            const nd2 = await nr2.json();
            const participant = nd2?.data?.[0]?.participants?.data?.find(p => p.id === canal_user_id);
            if (participant?.name) canal_user_name = participant.name;
          } catch(_) {}
        }
      } catch(_) {}
    } else if (canal === 'instagram' && accessToken) {
      try {
        const nr = await fetch(`https://graph.facebook.com/v20.0/${canal_user_id}?fields=name,profile_pic&access_token=${accessToken}`);
        const nd = await nr.json();
        if (nd.name) canal_user_name = nd.name;
        if (nd.profile_pic) canal_user_photo = nd.profile_pic;
      } catch(_) {}
    }
  } catch (e) {
    console.error('meta-webhook: error buscando cliente:', e.message);
    return res.status(200).end();
  }

  // Detectar si es un canal propio de attempo (para capturar como lead)
  const attempoChannels = [
    process.env.ATTEMPO_WA_PHONE_ID,
    process.env.ATTEMPO_FB_PAGE_ID,
    process.env.ATTEMPO_IG_ACCOUNT_ID
  ].filter(Boolean);
  const isAttempoChannel = !!(channelValue && attempoChannels.includes(channelValue));

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
      const rpcResult = await cvRpc.json();
      if (typeof rpcResult === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rpcResult)) {
        conversacion_id = rpcResult;
      }
    }

    // Fallback 1: buscar conversación existente si el RPC no devolvió ID
    if (!conversacion_id) {
      try {
        const rq = await fetch(
          `${SUPABASE_URL}/rest/v1/conversaciones?cliente_id=eq.${cliente_id}&canal=eq.${encodeURIComponent(canal)}&canal_user_id=eq.${encodeURIComponent(canal_user_id)}&select=id&order=created_at.desc&limit=1`,
          { headers: sh }
        );
        const [row] = await rq.json();
        if (row?.id) conversacion_id = row.id;
      } catch (_) {}
    }

    // Fallback 2: crear conversación directamente si ningún intento anterior funcionó
    if (!conversacion_id && cliente_id) {
      try {
        const rIns = await fetch(`${SUPABASE_URL}/rest/v1/conversaciones`, {
          method: 'POST',
          headers: { ...shJ, Prefer: 'return=representation' },
          body: JSON.stringify({
            cliente_id, canal, canal_user_id,
            canal_user_name: canal_user_name || canal_user_id,
            ultimo_mensaje: mensaje.slice(0, 120),
            ultimo_mensaje_at: new Date().toISOString(),
            no_leidos: 1
          })
        });
        if (rIns.ok) {
          const [created] = await rIns.json();
          conversacion_id = created?.id || null;
        } else {
          // INSERT falló (probablemente duplicado) — re-leer
          const rRetry = await fetch(
            `${SUPABASE_URL}/rest/v1/conversaciones?cliente_id=eq.${cliente_id}&canal=eq.${encodeURIComponent(canal)}&canal_user_id=eq.${encodeURIComponent(canal_user_id)}&select=id&order=created_at.desc&limit=1`,
            { headers: sh }
          );
          const [retryRow] = await rRetry.json();
          if (retryRow?.id) conversacion_id = retryRow.id;
        }
      } catch (_) {}
    }

    if (conversacion_id) {
      await fetch(`${SUPABASE_URL}/rest/v1/mensajes`, {
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
  } catch (e) {
    console.error('meta-webhook: error guardando conversacion:', e.message);
  }

  // ── Verificar cuota mensual WA antes de llamar al bot ────────────────────
  if (!isAttempoChannel && canal === 'whatsapp' && cliente_id) {
    const cuotaOk = await checkWaQuota(cliente_id);
    if (!cuotaOk) {
      console.log('[meta-webhook] cuota WA agotada para cliente', cliente_id);
      return res.status(200).end();
    }
  }

  // ── Responder 200 a Meta de inmediato para evitar timeout ────────────────
  res.status(200).end();

  // ── Llamar al bot IA ──────────────────────────────────────────────────────
  let respuesta = '', delayMinSeg = 0, delayMaxSeg = 0;
  try {
    const botRes = await fetch(`${BASE_URL}/api/bot-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_SECRET || '' },
      body: JSON.stringify({ cliente_id, canal, canal_user_id, canal_user_name, mensaje })
    });
    const botData = await botRes.json();
    if (botData.pausa) {
      console.log('meta-webhook: bot pausado para', canal_user_id);
      if (isAttempoChannel) _saveAttempoLead(canal_user_id, canal_user_name, canal, mensaje, '');
      return;
    }
    respuesta    = botData.respuesta    || '';
    delayMinSeg  = botData.delay_min_seg || 0;
    delayMaxSeg  = botData.delay_max_seg || delayMinSeg;
  } catch (e) {
    console.error('meta-webhook: error llamando bot-chat:', e.message);
    if (isAttempoChannel) _saveAttempoLead(canal_user_id, canal_user_name, canal, mensaje, '');
    return;
  }

  // ── Guardar lead de attempo (usuario + respuesta del bot) ─────────────────
  if (isAttempoChannel) _saveAttempoLead(canal_user_id, canal_user_name, canal, mensaje, respuesta);

  // ── Guardar respuesta del bot ─────────────────────────────────────────────
  if (respuesta && conversacion_id) {
    const shJ = { ...sh, 'Content-Type': 'application/json' };
    await fetch(`${SUPABASE_URL}/rest/v1/mensajes`, {
      method: 'POST',
      headers: { ...shJ, Prefer: 'return=minimal' },
      body: JSON.stringify({ conversacion_id, cliente_id, rol: 'bot', contenido: respuesta, visto: true })
    }).catch(e => console.error('meta-webhook: error guardando mensaje bot:', e.message));
  }

  console.log('[meta-webhook] pre-send | canal:', canal, '| respuesta:', respuesta ? respuesta.slice(0,60)+'...' : 'VACÍA', '| accessToken:', accessToken ? 'OK' : 'NULL');
  if (!respuesta || !accessToken) return;

  // ── Delay configurable antes de enviar ────────────────────────────────────
  if (delayMinSeg > 0) {
    const delay = Math.floor(Math.random() * (delayMaxSeg - delayMinSeg + 1) + delayMinSeg);
    console.log(`meta-webhook: delay ${delay}s para cliente ${cliente_id}`);
    await new Promise(r => setTimeout(r, delay * 1000));
  }

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
      // channelValue = ig_account_id recibido en el webhook entry
      sendRes = await fetch(`https://graph.facebook.com/v20.0/${channelValue}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: canal_user_id }, message: { text: respuesta } })
      });
    } else {
      // Messenger — channelValue = fb_page_id recibido en el webhook entry
      sendRes = await fetch(`https://graph.facebook.com/v20.0/${channelValue}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: canal_user_id }, message: { text: respuesta } })
      });
    }
    const sendBody = await sendRes.text();
    console.log('meta-webhook: send status:', sendRes.status, '| body:', sendBody.slice(0,120));
    if (sendRes.ok) {
      incUso(cliente_id, 'mensajes_wa_bot');
      if (!isAttempoChannel) incWaUsados(cliente_id);
    }
  } catch (e) {
    console.error('meta-webhook: error enviando respuesta:', e.message);
  }
}
