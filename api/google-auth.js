const REDIRECT_URI = 'https://www.attempo.cl/api/google-auth';
const SCOPE        = 'https://www.googleapis.com/auth/calendar.events';

const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';

export default async function handler(req, res) {
  const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const KEY           = process.env.SUPABASE_SERVICE_KEY;
  const sh = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(503).json({ error: 'Google OAuth no configurado en las variables de entorno' });
  }

  // ── GET sin code: iniciar flujo OAuth ──────────────────────────────────────
  if (req.method === 'GET' && !req.query.code) {
    const { cliente_id } = req.query;
    if (!cliente_id) return res.status(400).json({ error: 'Falta cliente_id' });

    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id:     CLIENT_ID,
      redirect_uri:  REDIRECT_URI,
      response_type: 'code',
      scope:         SCOPE,
      access_type:   'offline',
      prompt:        'consent',   // fuerza refresh_token en cada conexión
      state:         cliente_id
    });
    return res.redirect(302, url);
  }

  // ── GET con code: callback de Google ───────────────────────────────────────
  if (req.method === 'GET' && req.query.code) {
    const { code, state: cliente_id, error } = req.query;

    console.log('GC_AUTH callback: code present:', !!code, '| cliente_id from state:', cliente_id, '| error:', error);
    if (error || !code || !cliente_id) {
      console.error('GC_AUTH: OAuth error or missing params:', { error, hasCode: !!code, cliente_id });
      return res.redirect(302, '/configuracion?gc_error=1');
    }

    try {
      // Intercambiar code por tokens
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id:     CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri:  REDIRECT_URI,
          grant_type:    'authorization_code'
        })
      });
      const tokens = await tokenRes.json();

      console.log('GC_AUTH token exchange: status:', tokenRes.status, '| has refresh_token:', !!tokens.refresh_token, '| has access_token:', !!tokens.access_token);
      if (!tokenRes.ok || !tokens.refresh_token) {
        console.error('GC_AUTH: token exchange failed:', JSON.stringify(tokens));
        return res.redirect(302, '/configuracion?gc_error=1');
      }

      // Guardar refresh_token en Supabase (con service key — nunca expuesto al cliente)
      console.log('GC_AUTH: saving token for cliente_id:', cliente_id, '| has refresh_token:', !!tokens.refresh_token);
      const patch = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=id`, {
        method: 'PATCH',
        headers: { ...sh, Prefer: 'return=representation' },
        body: JSON.stringify({ google_refresh_token: tokens.refresh_token })
      });

      let patchBody;
      try { patchBody = await patch.json(); } catch(_) { patchBody = null; }
      console.log('GC_AUTH: patch status:', patch.status, '| rows updated:', Array.isArray(patchBody) ? patchBody.length : 'error', '| body:', JSON.stringify(patchBody));

      if (!patch.ok || !Array.isArray(patchBody) || patchBody.length === 0) {
        console.error('GC_AUTH: token save failed — 0 rows matched or DB error. cliente_id:', cliente_id);
        return res.redirect(302, '/configuracion?gc_error=1');
      }

      return res.redirect(302, '/configuracion?gc_ok=1');
    } catch(e) {
      console.error('google-auth callback error:', e.message);
      return res.redirect(302, '/configuracion?gc_error=1');
    }
  }

  // ── DELETE: desconectar Google Calendar ────────────────────────────────────
  if (req.method === 'DELETE') {
    const { cliente_id } = req.body || {};
    if (!cliente_id) return res.status(400).json({ error: 'Falta cliente_id' });

    try {
      // Obtener token actual para revocarlo en Google
      const rc = await fetch(
        `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=google_refresh_token&limit=1`,
        { headers: sh }
      );
      const [cli] = await rc.json();

      if (cli?.google_refresh_token) {
        // Revocar en Google (best-effort — no falla si Google devuelve error)
        await fetch(
          `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(cli.google_refresh_token)}`,
          { method: 'POST' }
        ).catch(() => {});
      }

      // Limpiar token en Supabase
      await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}`, {
        method: 'PATCH',
        headers: { ...sh, Prefer: 'return=minimal' },
        body: JSON.stringify({ google_refresh_token: null })
      });

      return res.json({ ok: true });
    } catch(e) {
      console.error('google-auth disconnect error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).end();
}
