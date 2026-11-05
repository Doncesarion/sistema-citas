const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
const REDIRECT_URI = 'https://app.attempo.cl/api/meta-oauth-callback';

export default async function handler(req, res) {
  const { code, state, error } = req.query;

  if (error || !code) {
    return res.redirect('/admin?meta_error=1');
  }

  let cid;
  try {
    cid = JSON.parse(Buffer.from(state, 'base64').toString()).cid;
    if (!cid) throw new Error('sin cid');
  } catch {
    return res.redirect('/admin?meta_error=1');
  }

  const APP_ID     = process.env.META_APP_ID;
  const APP_SECRET = process.env.META_APP_SECRET;
  const SH = { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` };

  try {
    // 1) Intercambiar code por user token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${APP_SECRET}&code=${code}`
    );
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(tokenData.error.message);

    // 2) Extender token a larga duración (60 días)
    const longRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${tokenData.access_token}`
    );
    const longData = await longRes.json();
    const userToken = longData.access_token || tokenData.access_token;

    // 3) Obtener páginas del usuario
    const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${userToken}`);
    const pagesData = await pagesRes.json();
    const pages = pagesData.data || [];
    if (!pages.length) return res.redirect('/admin?meta_error=2');

    const page      = pages[0];
    const pageId    = page.id;
    const pageToken = page.access_token; // tokens de página no expiran

    // 4) Buscar cuenta de Instagram vinculada
    const igRes  = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=instagram_business_account&access_token=${pageToken}`);
    const igData = await igRes.json();
    const igAccountId = igData.instagram_business_account?.id || null;

    // 5) Guardar en Supabase (merge con lo existente)
    const r0 = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cid}&select=canales_meta&limit=1`, { headers: SH });
    const [cli] = await r0.json();
    const merged = {
      ...(cli?.canales_meta || {}),
      fb_page_id: pageId,
      fb_token:   pageToken,
      ...(igAccountId ? { ig_account_id: igAccountId, ig_token: pageToken } : {})
    };
    await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cid}`, {
      method: 'PATCH',
      headers: { ...SH, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ canales_meta: merged })
    });

    return res.redirect('/admin?meta_ok=1');
  } catch(e) {
    console.error('[meta-oauth-callback]', e.message);
    return res.redirect('/admin?meta_error=1');
  }
}
