import crypto from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(crypto.scrypt);
const BASE_URL = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');
const TOKEN_RE  = /^[a-f0-9]{64}$/;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

export default async function handler(req, res) {
  const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

  // GET ?token=... → validar token
  if (req.method === 'GET') {
    const { token } = req.query;
    if (!token || !TOKEN_RE.test(token)) return res.status(400).json({ error: 'Token inválido' });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/password_resets?token=eq.${token}&used=eq.false&select=expires_at`, { headers: sh });
    const rows = await r.json();
    if (!rows.length) return res.status(400).json({ error: 'Token inválido o ya usado' });
    if (new Date(rows[0].expires_at) < new Date()) return res.status(400).json({ error: 'El enlace ha expirado' });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'POST') {
    const body = req.body || {};

    // POST { email } → solicitar recuperación (antes: /api/recover-password)
    if (body.email && !body.token) {
      const { email } = body;
      try {
        const userCheck = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}&select=email`, { headers: sh });
        const users = await userCheck.json();
        if (!users.length) return res.status(200).json({ ok: true });

        const token     = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        await fetch(`${SUPABASE_URL}/rest/v1/password_resets`, {
          method: 'POST',
          headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ email, token, expires_at: expiresAt })
        });

        const resetLink = `${BASE_URL}/reset-password?token=${token}`;

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Attempo <contacto@attempo.cl>',
            to: [email],
            subject: 'Recuperación de contraseña — Attempo',
            html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a2e">
              <img src="${BASE_URL}/logo_attempo.png" width="48" style="border-radius:12px;margin-bottom:20px" alt="Attempo">
              <h2 style="margin:0 0 8px;font-size:20px;font-weight:700">Recuperación de contraseña</h2>
              <p style="margin:0 0 20px;color:#555;font-size:14px">Recibimos una solicitud para restablecer la contraseña de tu cuenta en Attempo.<br>Si no fuiste tú, puedes ignorar este mensaje.</p>
              <a href="${resetLink}" style="display:inline-block;background:#4F46E5;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:15px;font-weight:600;margin-bottom:20px">Restablecer contraseña</a>
              <p style="margin:0 0 8px;color:#888;font-size:12px">Este enlace es válido por <strong>1 hora</strong>.</p>
              <p style="margin:0 0 20px;color:#888;font-size:12px">O copia: <span style="color:#4F46E5">${resetLink}</span></p>
              <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
              <p style="margin:0;font-size:12px;color:#999">Attempo · Todo a tu tiempo · <a href="https://attempo.cl" style="color:#999">attempo.cl</a></p>
            </div>`
          })
        });

        return res.status(200).json({ ok: true });
      } catch (err) {
        console.error('reset-password recover error:', err.message);
        return res.status(500).json({ error: 'Error interno' });
      }
    }

    // POST { token, password } → cambiar contraseña
    const { token, password } = body;
    if (!token || !password) return res.status(400).json({ error: 'Datos incompletos' });
    if (!TOKEN_RE.test(token)) return res.status(400).json({ error: 'Token inválido' });
    if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

    const check = await fetch(`${SUPABASE_URL}/rest/v1/password_resets?token=eq.${token}&used=eq.false&select=email,expires_at`, { headers: sh });
    const rows  = await check.json();
    if (!rows.length) return res.status(400).json({ error: 'Token inválido o ya usado' });
    if (new Date(rows[0].expires_at) < new Date()) return res.status(400).json({ error: 'El enlace ha expirado' });

    const hashedPassword = await hashPassword(password);
    const update = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(rows[0].email)}`, {
      method: 'PATCH',
      headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ password: hashedPassword })
    });
    if (!update.ok) return res.status(500).json({ error: 'Error al actualizar contraseña' });

    await fetch(`${SUPABASE_URL}/rest/v1/password_resets?token=eq.${token}`, {
      method: 'PATCH',
      headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ used: true })
    });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
