import crypto from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(crypto.scrypt);
const BASE_URL = process.env.BASE_URL || 'https://app.attempo.cl';

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

const ROL_LABELS = {
  admin:    'Administrador general',
  staff:    'Staff / Profesional',
  recep:    'Recepcionista',
  finanzas: 'Finanzas',
  viewer:   'Solo lectura'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, nombre, rol, cliente_id } = req.body || {};
  if (!email || !nombre || !cliente_id) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email inválido' });
  }

  const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  try {
    // Verificar si ya tiene acceso
    const check = await fetch(
      `${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}&cliente_id=eq.${cliente_id}&select=id,nombre`,
      { headers: sh }
    );
    const existing = await check.json();

    if (existing.length > 0) {
      return res.json({ ok: true, ya_tiene_acceso: true });
    }

    // Generar contraseña temporal
    const tempPassword = crypto.randomBytes(5).toString('hex'); // 10 chars
    const hashedPassword = await hashPassword(tempPassword);

    // Username = email (único y fácil de recordar)
    const username = email.toLowerCase();

    const createR = await fetch(`${SUPABASE_URL}/rest/v1/usuarios`, {
      method: 'POST',
      headers: { ...sh, Prefer: 'return=minimal' },
      body: JSON.stringify({
        username,
        password: hashedPassword,
        email,
        nombre,
        rol: rol || 'staff',
        cliente_id
      })
    });

    if (!createR.ok) {
      const err = await createR.json().catch(() => ({}));
      return res.status(500).json({ error: err?.message || 'Error al crear usuario' });
    }

    // Enviar email de invitación
    if (process.env.RESEND_API_KEY) {
      const rolLabel = ROL_LABELS[rol] || 'Staff / Profesional';
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Attempo <contacto@attempo.cl>',
          to: email,
          subject: 'Tu acceso a Attempo está listo',
          html: inviteHtml({ nombre, username, tempPassword, rolLabel, loginUrl: `${BASE_URL}/login` })
        })
      }).then(async r => { if (!r.ok) console.error('invite email error:', await r.text()); })
        .catch(e => console.error('invite email exception:', e.message));
    }

    return res.json({ ok: true, ya_tiene_acceso: false });
  } catch (e) {
    console.error('invitar-profesional error');
    return res.status(500).json({ error: 'Error interno' });
  }
}

function inviteHtml({ nombre, username, tempPassword, rolLabel, loginUrl }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:40px 20px;">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);">
<tr><td style="background:#6C5CE4;padding:28px 32px;text-align:center;">
  <img src="${BASE_URL}/logo_attempo.png" alt="Attempo" height="36" style="display:block;margin:0 auto 8px;">
  <p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;">Todo a tu tiempo</p>
</td></tr>
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 8px;color:#2d2d2d;font-size:20px;">¡Bienvenido/a a Attempo, ${nombre.split(' ')[0]}!</h2>
  <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Se creó un acceso para ti con el rol <strong>${rolLabel}</strong>. Usa las credenciales de abajo para ingresar al sistema.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border-radius:12px;padding:20px;margin-bottom:24px;">
    <tr><td style="padding:8px 0;text-align:center;"><span style="color:#6C5CE4;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Usuario</span><br><span style="color:#2d2d2d;font-size:15px;font-family:monospace;">${username}</span></td></tr>
    <tr><td style="padding:8px 0;text-align:center;border-top:1px solid #ede9fe;"><span style="color:#6C5CE4;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Contraseña temporal</span><br><span style="color:#2d2d2d;font-size:18px;font-family:monospace;font-weight:700;letter-spacing:2px;">${tempPassword}</span></td></tr>
  </table>
  <div style="text-align:center;margin-bottom:20px;">
    <a href="${loginUrl}" style="display:inline-block;padding:12px 32px;background:#6C5CE4;color:#fff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;">
      Ingresar a Attempo →
    </a>
  </div>
  <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">Te recomendamos cambiar tu contraseña después del primer ingreso.</p>
</td></tr>
<tr><td style="background:#f9f8ff;padding:16px 32px;text-align:center;border-top:1px solid #ede9fe;">
  <p style="margin:0;color:#9ca3af;font-size:12px;">Attempo · Todo a tu tiempo · <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none;">attempo.cl</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
