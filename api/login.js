import crypto from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(crypto.scrypt);

// Rate limiting persistente con Upstash Redis (fallback a Map en memoria)
const _loginFallback = new Map();
async function isRateLimited(ip) {
  const MAX = 10;
  const WINDOW_S = 15 * 60;

  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) {
    try {
      const bucket = Math.floor(Date.now() / (WINDOW_S * 1000));
      const key = `rl:login:${ip}:${bucket}`;
      const r = await fetch(`${url}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([['INCR', key], ['EXPIRE', key, WINDOW_S * 2]])
      });
      const data = await r.json();
      const count = data[0]?.result;
      if (typeof count === 'number') return count > MAX;
    } catch {}
  }

  // Fallback en memoria si Upstash no está disponible
  const now = Date.now();
  const entry = _loginFallback.get(ip);
  if (!entry || now > entry.resetAt) {
    _loginFallback.set(ip, { count: 1, resetAt: now + WINDOW_S * 1000 });
    return false;
  }
  if (entry.count >= MAX) return true;
  entry.count++;
  return false;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  if (!stored) return { ok: false, upgrade: false, first: false };

  // First-login password: prefix 'first$scrypt$...'
  if (stored.startsWith('first$')) {
    const inner = stored.slice(6);
    const parts = inner.split('$');
    if (parts.length === 3 && parts[0] === 'scrypt') {
      const [, salt, hashHex] = parts;
      const hash = await scryptAsync(password, salt, 64);
      const storedBuf = Buffer.from(hashHex, 'hex');
      if (hash.length !== storedBuf.length) return { ok: false, upgrade: false, first: false };
      const ok = crypto.timingSafeEqual(hash, storedBuf);
      return { ok, upgrade: false, first: ok };
    }
  }

  if (!stored.startsWith('scrypt$')) {
    return { ok: stored === password, upgrade: stored === password, first: false };
  }
  const parts = stored.split('$');
  if (parts.length !== 3) return { ok: false, upgrade: false, first: false };
  const [, salt, hashHex] = parts;
  const hash = await scryptAsync(password, salt, 64);
  const storedBuf = Buffer.from(hashHex, 'hex');
  if (hash.length !== storedBuf.length) return { ok: false, upgrade: false, first: false };
  const ok = crypto.timingSafeEqual(hash, storedBuf);
  return { ok, upgrade: false, first: false };
}

const BASE_URL = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');
const TOKEN_RE  = /^[a-f0-9]{64}$/;

export default async function handler(req, res) {
  const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

  // — GET: validar token de recuperación de contraseña —
  if (req.method === 'GET') {
    const { token } = req.query;
    if (!token || !TOKEN_RE.test(token)) return res.status(400).json({ error: 'Token inválido' });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/password_resets?token=eq.${token}&used=eq.false&select=expires_at`, { headers: sh });
    const rows = await r.json();
    if (!rows.length) return res.status(400).json({ error: 'Token inválido o ya usado' });
    if (new Date(rows[0].expires_at) < new Date()) return res.status(400).json({ error: 'El enlace ha expirado' });
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') return res.status(405).end();

  const ip = (req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  if (await isRateLimited(ip)) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
  }

  // — POST { email } → solicitar recuperación de contraseña —
  if (req.body?.email && !req.body.password && !req.body.action && !req.body.usuario && !req.body.token) {
    const { email } = req.body;
    try {
      const userCheck = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}&select=email`, { headers: sh });
      const users = await userCheck.json();
      if (!users.length) return res.status(200).json({ ok: true });

      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt  = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      await fetch(`${SUPABASE_URL}/rest/v1/password_resets`, {
        method: 'POST',
        headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ email, token: resetToken, expires_at: expiresAt })
      });

      const resetLink = `${BASE_URL}/reset-password?token=${resetToken}`;
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
      console.error('reset-password request error:', err.message);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  // — POST { token, password } → aplicar nueva contraseña —
  if (req.body?.token && req.body?.password && !req.body.action && !req.body.usuario) {
    const { token, password } = req.body;
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

  // — Verificar OTP de MFA —
  if (req.body?.action === 'verify_mfa') {
    const { mfa_token, otp } = req.body;
    if (!mfa_token || !otp) return res.status(400).json({ error: 'Datos incompletos' });
    const SECRET = process.env.SESSION_SECRET;
    if (!SECRET) return res.status(500).json({ error: 'Servidor no configurado' });
    const dot = mfa_token.lastIndexOf('.');
    if (dot === -1) return res.status(401).json({ error: 'Token inválido' });
    const mfaPayload = mfa_token.slice(0, dot);
    const mfaSig    = mfa_token.slice(dot + 1);
    const expected  = crypto.createHmac('sha256', SECRET).update(mfaPayload).digest('hex');
    try {
      const sigBuf = Buffer.from(mfaSig, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return res.status(401).json({ error: 'Token inválido' });
      }
    } catch { return res.status(401).json({ error: 'Token inválido' }); }
    const parts = mfaPayload.split(':');
    if (parts.length !== 3) return res.status(401).json({ error: 'Token inválido' });
    const [userId, storedOtpHmac, expStr] = parts;
    if (Date.now() > parseInt(expStr)) return res.status(401).json({ error: 'Código expirado' });
    const submittedHmac = crypto.createHmac('sha256', SECRET).update(String(otp)).digest('hex');
    try {
      const sBuf = Buffer.from(submittedHmac, 'hex');
      const tBuf = Buffer.from(storedOtpHmac, 'hex');
      if (sBuf.length !== tBuf.length || !crypto.timingSafeEqual(sBuf, tBuf)) {
        return res.status(401).json({ error: 'Código incorrecto' });
      }
    } catch { return res.status(401).json({ error: 'Código incorrecto' }); }
    const r2 = await fetch(
      `${SUPABASE_URL}/rest/v1/usuarios?id=eq.${encodeURIComponent(userId)}&select=username,email,nombre,rol,destino,cliente_id`,
      { headers: sh }
    );
    const rows2 = await r2.json();
    if (!rows2.length) return res.status(401).json({ error: 'Usuario no encontrado' });
    const u2 = rows2[0];
    const saExpires = Date.now() + 24 * 60 * 60 * 1000;
    const sesPayload = `${u2.cliente_id || 'sa'}:${u2.rol}:${saExpires}`;
    const sesSig = crypto.createHmac('sha256', SECRET).update(sesPayload).digest('hex');
    return res.status(200).json({
      ok: true,
      usuario: u2.email || u2.username,
      nombre: u2.nombre,
      rol: u2.rol,
      destino: u2.destino,
      cliente_id: u2.cliente_id,
      session_token: `${sesPayload}.${sesSig}`,
    });
  }

  const { usuario, password } = req.body || {};
  if (!usuario || !password) return res.status(400).json({ error: 'Datos incompletos' });

  try {
    const input = usuario.trim().toLowerCase();

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/usuarios?or=(username.eq.${encodeURIComponent(input)},email.eq.${encodeURIComponent(input)})&select=id,username,password,email,nombre,rol,destino,cliente_id`,
      { headers: sh }
    );

    const rows = await r.json();
    if (!rows.length) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    const u = rows[0];
    const { ok, upgrade, first } = await verifyPassword(password, u.password || '');

    if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    // Auto-upgrade contraseña legacy a hash scrypt
    if (upgrade) {
      const newHash = await hashPassword(password);
      fetch(`${SUPABASE_URL}/rest/v1/usuarios?id=eq.${u.id}`, {
        method: 'PATCH',
        headers: { ...sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ password: newHash })
      }).catch(() => {});
    }

    const SESSION_SECRET = process.env.SESSION_SECRET;

    // Superadmin requiere MFA — enviar OTP por email
    if (u.rol === 'superadmin' && SESSION_SECRET) {
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const otpHmac = crypto.createHmac('sha256', SESSION_SECRET).update(otp).digest('hex');
      const mfaExp = Date.now() + 10 * 60 * 1000;
      const mfaPayload = `${u.id}:${otpHmac}:${mfaExp}`;
      const mfaSig = crypto.createHmac('sha256', SESSION_SECRET).update(mfaPayload).digest('hex');
      const mfa_token = `${mfaPayload}.${mfaSig}`;
      const SA_EMAIL = process.env.SA_EMAIL;
      if (SA_EMAIL && process.env.RESEND_API_KEY) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'attempo <contacto@attempo.cl>',
            to: [SA_EMAIL],
            subject: 'Código de verificación superadmin — attempo',
            html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f3ff;font-family:Arial,sans-serif">
<div style="max-width:420px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.1)">
  <div style="background:#6C5CE4;padding:24px 32px;text-align:center">
    <p style="margin:0;color:#fff;font-size:15px;font-weight:700">attempo superadmin</p>
  </div>
  <div style="padding:32px;text-align:center">
    <p style="margin:0 0 8px;color:#6b7280;font-size:14px">Tu código de verificación es:</p>
    <p style="margin:0 0 16px;font-size:36px;font-weight:800;letter-spacing:8px;color:#2d2d2d;font-family:'Courier New',monospace">${otp}</p>
    <p style="margin:0;color:#9ca3af;font-size:12px">Expira en 10 minutos. No compartas este código.</p>
  </div>
</div></body></html>`
          })
        }).catch(e => console.error('MFA email error:', e.message));
      }
      return res.status(200).json({ mfa_required: true, mfa_token });
    }

    let session_token = null;
    if (SESSION_SECRET && u.cliente_id) {
      const expires = Date.now() + 24 * 60 * 60 * 1000;
      const payload = `${u.cliente_id}:${u.rol}:${expires}`;
      const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
      session_token = `${payload}.${sig}`;
    }

    // Obtener tipo_plan del negocio para feature gating en el panel
    let tipo_plan = null;
    if (u.cliente_id) {
      try {
        const rp = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${u.cliente_id}&select=tipo_plan&limit=1`, { headers: sh });
        const [cli] = await rp.json();
        tipo_plan = cli?.tipo_plan || null;
      } catch(_) {}
    }

    return res.status(200).json({
      ok: true,
      usuario: u.email || u.username,
      nombre: u.nombre,
      rol: u.rol,
      destino: u.destino,
      cliente_id: u.cliente_id,
      session_token,
      tipo_plan,
      debe_cambiar: first || false,
    });

  } catch (err) {
    console.error('login error');
    return res.status(500).json({ error: 'Error interno' });
  }
}
