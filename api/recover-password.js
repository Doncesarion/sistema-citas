import crypto from 'crypto';

const BASE_URL = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  try {
    const userCheck = await fetch(
      `${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}&select=email`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const users = await userCheck.json();

    // Responder OK aunque no exista (seguridad: no revelar si el email está registrado)
    if (!users.length) return res.status(200).json({ ok: true });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await fetch(`${SUPABASE_URL}/rest/v1/password_resets`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ email, token, expires_at: expiresAt })
    });

    const resetLink = `${BASE_URL}/reset-password?token=${token}`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Attempo <contacto@attempo.cl>',
        to: [email],
        subject: 'Recuperación de contraseña — Attempo',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a2e">
            <img src="${BASE_URL}/logo_attempo.png" width="48" style="border-radius:12px;margin-bottom:20px" alt="Attempo">
            <h2 style="margin:0 0 8px;font-size:20px;font-weight:700">Recuperación de contraseña</h2>
            <p style="margin:0 0 20px;color:#555;font-size:14px">
              Recibimos una solicitud para restablecer la contraseña de tu cuenta en Attempo.<br>
              Si no fuiste tú, puedes ignorar este mensaje.
            </p>
            <a href="${resetLink}" style="display:inline-block;background:#4F46E5;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:15px;font-weight:600;margin-bottom:20px">
              Restablecer contraseña
            </a>
            <p style="margin:0 0 8px;color:#888;font-size:12px">
              Este enlace es válido por <strong>1 hora</strong>. Después deberás solicitar uno nuevo.
            </p>
            <p style="margin:0 0 20px;color:#888;font-size:12px">
              O copia este enlace en tu navegador:<br>
              <span style="color:#4F46E5">${resetLink}</span>
            </p>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
            <p style="margin:0;font-size:12px;color:#999">Attempo · Todo a tu tiempo · <a href="https://attempo.cl" style="color:#999">attempo.cl</a></p>
          </div>
        `
      })
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('recover-password error');
    return res.status(500).json({ error: 'Error interno' });
  }
}
