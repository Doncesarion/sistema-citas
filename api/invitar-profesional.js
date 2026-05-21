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
          headers: {
            'List-Unsubscribe': `<mailto:contacto@attempo.cl?subject=unsubscribe>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
          },
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
  const primerNombre = nombre.split(' ')[0];
  // Logo alojado en CDN de Vercel — URL directa sin redirecciones
  const logoUrl = 'https://sistema-citas-mu.vercel.app/logo_attempo.png';
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Tu acceso a Attempo</title>
</head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;">
<!-- preheader oculto -->
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f5f3ff;">
  Hola ${primerNombre}, ya puedes ingresar a Attempo con tus credenciales.
</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:40px 20px;">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);">
<tr><td style="background:#6C5CE4;padding:28px 32px;text-align:center;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <img src="${logoUrl}" alt="Attempo" height="36" width="auto" style="display:block;margin:0 auto 8px;border:0;outline:none;text-decoration:none;">
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;font-family:Arial,sans-serif;">Todo a tu tiempo</p>
  </td></tr></table>
</td></tr>
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 8px;color:#2d2d2d;font-size:20px;font-family:Arial,sans-serif;">¡Bienvenido/a, ${primerNombre}!</h2>
  <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;font-family:Arial,sans-serif;">
    Se creó tu cuenta en Attempo con el rol <strong style="color:#2d2d2d;">${rolLabel}</strong>.<br>
    Aquí están tus datos de ingreso:
  </p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border-radius:12px;padding:20px;margin-bottom:24px;">
    <tr>
      <td style="padding:8px 0;text-align:center;">
        <span style="color:#6C5CE4;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;font-family:Arial,sans-serif;">Usuario</span><br>
        <span style="color:#2d2d2d;font-size:14px;font-family:Arial,sans-serif;">${username}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:12px 0 8px;text-align:center;border-top:1px solid #ede9fe;">
        <span style="color:#6C5CE4;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;font-family:Arial,sans-serif;">Clave de ingreso</span><br>
        <span style="color:#2d2d2d;font-size:22px;font-family:Courier New,monospace;font-weight:700;letter-spacing:3px;">${tempPassword}</span>
      </td>
    </tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
    <tr><td align="center">
      <a href="${loginUrl}" style="display:inline-block;padding:13px 36px;background:#6C5CE4;color:#ffffff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;font-family:Arial,sans-serif;">
        Ingresar a Attempo
      </a>
    </td></tr>
  </table>
  <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;font-family:Arial,sans-serif;">
    Puedes cambiar tu clave dentro del sistema una vez que ingreses.
  </p>
</td></tr>
<tr><td style="background:#f9f8ff;padding:16px 32px;text-align:center;border-top:1px solid #ede9fe;">
  <p style="margin:0;color:#9ca3af;font-size:12px;font-family:Arial,sans-serif;">
    Attempo &middot; Todo a tu tiempo &middot;
    <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none;">attempo.cl</a>
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
