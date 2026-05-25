import crypto from 'crypto';
import { promisify } from 'util';
const scryptAsync = promisify(crypto.scrypt);

async function hashPassword(password, isFirst = false) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, 64);
  const prefix = isFirst ? 'first$' : '';
  return `${prefix}scrypt$${salt}$${hash.toString('hex')}`;
}

async function verifyHash(password, stored) {
  if (!stored) return false;
  const inner = stored.startsWith('first$') ? stored.slice(6) : stored;
  if (!inner.startsWith('scrypt$')) return inner === password;
  const parts = inner.split('$');
  if (parts.length !== 3) return false;
  const [, salt, hashHex] = parts;
  const hash = await scryptAsync(password, salt, 64);
  const storedBuf = Buffer.from(hashHex, 'hex');
  if (hash.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(hash, storedBuf);
}

function verifyToken(token) {
  if (!token) return false;
  const SA_SECRET = process.env.SA_SECRET;
  if (!SA_SECRET) return false;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SA_SECRET).update(payload).digest('hex');
  if (sig !== expected) return false;
  if (Date.now() > parseInt(payload)) return false;
  return true;
}

function timingSafeStringEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  const maxLen = Math.max(ba.length, bb.length);
  const padA = Buffer.concat([ba, Buffer.alloc(maxLen - ba.length)]);
  const padB = Buffer.concat([bb, Buffer.alloc(maxLen - bb.length)]);
  return crypto.timingSafeEqual(padA, padB) && ba.length === bb.length;
}

export default async function handler(req, res) {
  // ── POST login: genera token SA (no requiere autenticación previa) ─────────
  if (req.method === 'POST' && req.body?.action === 'login') {
    const { user, pass } = req.body;
    if (!user || !pass) return res.status(400).json({ error: 'Faltan credenciales' });

    const SA_USER   = process.env.SA_USER;
    const SA_PASS   = process.env.SA_PASS;
    const SA_SECRET = process.env.SA_SECRET;

    if (!SA_USER || !SA_PASS || !SA_SECRET) {
      return res.status(500).json({ error: 'Servidor no configurado correctamente' });
    }

    if (!timingSafeStringEqual(user, SA_USER) || !timingSafeStringEqual(pass, SA_PASS)) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const expires = Date.now() + 8 * 60 * 60 * 1000;
    const payload = String(expires);
    const sig = crypto.createHmac('sha256', SA_SECRET).update(payload).digest('hex');
    return res.status(200).json({ token: `${payload}.${sig}` });
  }

  // ── Cambio de contraseña forzado (primer ingreso) — sin SA token ──────────
  if (req.method === 'POST' && req.body?.action === 'force-cambiar-password') {
    const { email, password_actual, password_nuevo } = req.body;
    if (!email || !password_actual || !password_nuevo)
      return res.status(400).json({ error: 'Datos incompletos' });
    if (password_nuevo.length < 8)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

    const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const sh = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

    const rGet = await fetch(
      `${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email.toLowerCase())}&select=id,password`,
      { headers: sh }
    );
    const rows = await rGet.json();
    if (!rows.length) return res.status(401).json({ error: 'Usuario no encontrado' });
    const u = rows[0];

    const ok = await verifyHash(password_actual, u.password);
    if (!ok) return res.status(401).json({ error: 'Contraseña actual incorrecta' });

    const newHash = await hashPassword(password_nuevo, false);
    const rUpd = await fetch(
      `${SUPABASE_URL}/rest/v1/usuarios?id=eq.${u.id}`,
      { method: 'PATCH', headers: { ...sh, Prefer: 'return=minimal' }, body: JSON.stringify({ password: newHash }) }
    );
    if (!rUpd.ok) return res.status(500).json({ error: 'Error al actualizar contraseña' });
    return res.status(200).json({ ok: true });
  }

  // ── Todas las demás rutas requieren token válido ───────────────────────────
  if (!verifyToken(req.headers['x-sa-token'])) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  // ── POST proxy: reenvía a edge function admin-clientes ────────────────────
  if (req.method === 'POST' && req.body?.action === 'proxy') {
    const ADMIN_TOKEN   = process.env.ADMIN_TOKEN;
    const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL;

    if (!ADMIN_TOKEN || !FUNCTIONS_URL) {
      return res.status(500).json({ error: 'Servidor no configurado correctamente' });
    }

    const { edge_action, action: _omit, ...forwardBody } = req.body || {};
    const url = `${FUNCTIONS_URL}/admin-clientes?action=${edge_action}`;

    // Anon key es pública por diseño de Supabase — solo pasa el gateway JWT, la seguridad real es x-admin-token
    const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6dHFhd3VsdnJ0anZ0Zml4b2Z5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MTQ4OTgsImV4cCI6MjA5MjI5MDg5OH0.nMxUfN_pR3FImpO6l9MsYo9Z5B-0KU1ZHfbPor2qgu8';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON}`,
        'x-admin-token': ADMIN_TOKEN
      },
      body: JSON.stringify(forwardBody),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  }

  // ── Gestión de usuarios y negocios ────────────────────────────────────────
  const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    if (req.method === 'GET') {
      const { action, cliente_id } = req.query;

      if (action === 'clientes') {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/clientes_sistema?select=id,nombre_negocio,email,plan&order=nombre_negocio.asc`,
          { headers: sh }
        );
        return res.status(r.status).json(await r.json());
      }

      if (action === 'usuarios') {
        let url = `${SUPABASE_URL}/rest/v1/usuarios?select=id,username,email,nombre,rol,cliente_id&order=nombre.asc`;
        if (cliente_id) url += `&cliente_id=eq.${encodeURIComponent(cliente_id)}`;
        const r = await fetch(url, { headers: sh });
        return res.status(r.status).json(await r.json());
      }

      return res.status(400).json({ error: 'Acción no válida' });
    }

    if (req.method === 'POST') {
      const body   = req.body || {};
      const { action } = body;

      if (action === 'crear') {
        const { username, password, email, nombre, rol, cliente_id, negocio_nombre, send_welcome } = body;
        if (!username || !password || !cliente_id) {
          return res.status(400).json({ error: 'username, password y cliente_id son obligatorios' });
        }
        if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

        const hashedPw = await hashPassword(password, true);
        const r = await fetch(`${SUPABASE_URL}/rest/v1/usuarios`, {
          method: 'POST',
          headers: { ...sh, Prefer: 'return=minimal' },
          body: JSON.stringify({
            username: username.trim().toLowerCase(),
            password: hashedPw,
            email:   email || null,
            nombre:  nombre || username,
            rol:     rol || 'admin',
            destino: '/admin.html',
            cliente_id
          })
        });

        if (!r.ok) {
          const txt = await r.text();
          const isDup = txt.includes('duplicate') || txt.includes('unique');
          return res.status(400).json({ error: isDup ? 'Ese nombre de usuario ya existe' : 'Error al crear usuario' });
        }

        if (send_welcome && email && process.env.RESEND_API_KEY) {
          const BASE_URL = process.env.BASE_URL || 'https://attempo.cl';
          const nombreMostrar = nombre || username;
          const negocio       = negocio_nombre || '';
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'Attempo <contacto@attempo.cl>',
              to: [email],
              subject: `Tu acceso a Attempo${negocio ? ' — ' + negocio : ''} está listo`,
              headers: { 'List-Unsubscribe': '<mailto:contacto@attempo.cl?subject=unsubscribe>' },
              html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F8F7FF;font-family:'Segoe UI',sans-serif">
<div style="max-width:520px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.1)">
  <div style="background:linear-gradient(135deg,#1E1B3A,#16143A);padding:24px 32px;display:flex;align-items:center;gap:12px">
    <img src="${BASE_URL}/logo_attempo.png" alt="Attempo" width="40" height="40" style="border-radius:10px;display:block">
    <span style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-.03em">Attempo</span>
  </div>
  <div style="padding:32px">
    <h2 style="margin:0 0 8px;font-size:20px;color:#16143A;letter-spacing:-.03em">¡Bienvenido/a, ${nombreMostrar}!</h2>
    <p style="margin:0 0 8px;font-size:14px;color:#5E5880;line-height:1.6">Tu cuenta en Attempo${negocio ? ' para <b>' + negocio + '</b>' : ''} ha sido creada. Aquí están tus credenciales de acceso:</p>
    <p style="margin:0 0 24px;font-size:13px;color:#9C96B4;line-height:1.5">Al ingresar por primera vez se te pedirá que crees tu propia contraseña personal.</p>
    <div style="background:#F8F7FF;border:1px solid rgba(108,92,228,0.15);border-radius:12px;padding:20px;margin-bottom:24px">
      <div style="margin-bottom:12px"><span style="font-size:11px;font-weight:600;color:#9C96B4;text-transform:uppercase;letter-spacing:.05em">Usuario</span><br><span style="font-size:15px;font-weight:600;color:#16143A">${username.trim().toLowerCase()}</span></div>
      <div><span style="font-size:11px;font-weight:600;color:#9C96B4;text-transform:uppercase;letter-spacing:.05em">Contraseña temporal</span><br><span style="font-size:15px;font-weight:600;color:#6C5CE4;font-family:monospace">${password}</span></div>
    </div>
    <a href="${BASE_URL}/login" style="display:block;text-align:center;background:linear-gradient(135deg,#6C5CE4,#4F3EE0);color:#fff;text-decoration:none;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:600;margin-bottom:20px">Ingresar al panel →</a>
    <p style="margin:0;font-size:12px;color:#9C96B4;text-align:center">Te recomendamos cambiar tu contraseña después de tu primer ingreso.</p>
  </div>
  <div style="padding:16px 32px;border-top:1px solid rgba(108,92,228,0.08);text-align:center">
    <p style="margin:0;font-size:11px;color:#C4C0D8">© Attempo · <a href="mailto:contacto@attempo.cl" style="color:#6C5CE4;text-decoration:none">contacto@attempo.cl</a></p>
  </div>
</div></body></html>`
            })
          }).catch(e => console.error('welcome email error:', e.message));
        }

        return res.status(200).json({ ok: true });
      }

      if (action === 'crear-negocio') {
        const { nombre_negocio, email, plan, contacto_nombre, contacto_tel, rubro } = body;
        if (!nombre_negocio) return res.status(400).json({ error: 'El nombre del negocio es obligatorio' });

        const today    = new Date().toISOString().split('T')[0];
        const days     = plan === 'demo' ? 14 : 365;
        const nextYear = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().split('T')[0];
        const slug     = nombre_negocio.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
        if (!slug) return res.status(400).json({ error: 'El nombre del negocio debe contener al menos una letra o número' });

        const r = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema`, {
          method: 'POST',
          headers: { ...sh, Prefer: 'return=representation' },
          body: JSON.stringify({
            nombre_negocio,
            email:            email || null,
            plan:             plan || 'basic',
            fecha_inicio:     today,
            fecha_expiracion: nextYear,
            password_hash:    '',
            activo:           true,
            booking_slug:     slug,
            contacto_nombre:  contacto_nombre || null,
            contacto_tel:     contacto_tel    || null,
            rubro:            rubro           || null
          })
        });

        if (!r.ok) {
          const txt = await r.text();
          return res.status(400).json({ error: 'Error al crear negocio: ' + txt });
        }
        const rows = await r.json();
        return res.status(200).json({ ok: true, cliente: rows[0] });
      }

      if (action === 'reenviar-acceso') {
        const { email, password, negocio_nombre, cliente_id, nombre } = body;
        if (!email || !password || !cliente_id) return res.status(400).json({ error: 'Datos incompletos' });
        if (password.length < 8) return res.status(400).json({ error: 'Mínimo 8 caracteres' });

        const hashedPw = await hashPassword(password, true);

        // Check if user exists (by username OR email, any cliente_id)
        const emailEnc = encodeURIComponent(email.toLowerCase());
        const rCheck = await fetch(
          `${SUPABASE_URL}/rest/v1/usuarios?or=(username.eq.${emailEnc},email.eq.${emailEnc})&select=id`,
          { headers: sh }
        );
        const existing = await rCheck.json();

        if (existing.length > 0) {
          // Update existing user
          const rUpd = await fetch(
            `${SUPABASE_URL}/rest/v1/usuarios?id=eq.${existing[0].id}`,
            { method: 'PATCH', headers: { ...sh, Prefer: 'return=minimal' }, body: JSON.stringify({ password: hashedPw }) }
          );
          if (!rUpd.ok) return res.status(500).json({ error: 'Error al actualizar contraseña' });
        } else {
          // Create user (first time)
          const rIns = await fetch(`${SUPABASE_URL}/rest/v1/usuarios`, {
            method: 'POST',
            headers: { ...sh, Prefer: 'return=minimal' },
            body: JSON.stringify({
              username: email.toLowerCase(),
              password: hashedPw,
              email: email.toLowerCase(),
              nombre: nombre || email,
              rol: 'admin',
              destino: '/admin.html',
              cliente_id
            })
          });
          if (!rIns.ok) {
            const txt = await rIns.text();
            const isDup = txt.includes('duplicate') || txt.includes('unique');
            return res.status(400).json({ error: isDup ? 'El usuario ya existe' : 'Error al crear usuario' });
          }
        }

        if (process.env.RESEND_API_KEY) {
          const BASE_URL = process.env.BASE_URL || 'https://attempo.cl';
          const negocio  = negocio_nombre || '';
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'Attempo <contacto@attempo.cl>',
              to: [email],
              subject: `Tu acceso a Attempo${negocio ? ' — ' + negocio : ''}`,
              headers: { 'List-Unsubscribe': '<mailto:contacto@attempo.cl?subject=unsubscribe>' },
              html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F8F7FF;font-family:'Segoe UI',sans-serif">
<div style="max-width:520px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.1)">
  <div style="background:linear-gradient(135deg,#1E1B3A,#16143A);padding:24px 32px;display:flex;align-items:center;gap:12px">
    <img src="${BASE_URL}/logo_attempo.png" alt="Attempo" width="40" height="40" style="border-radius:10px;display:block">
    <span style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-.03em">Attempo</span>
  </div>
  <div style="padding:32px">
    <h2 style="margin:0 0 8px;font-size:20px;color:#16143A;letter-spacing:-.03em">Acceso actualizado</h2>
    <p style="margin:0 0 8px;font-size:14px;color:#5E5880;line-height:1.6">Acceso${negocio ? ' para <b>' + negocio + '</b>' : ''} enviado. Usa estas credenciales para ingresar al panel:</p>
    <p style="margin:0 0 24px;font-size:13px;color:#9C96B4;line-height:1.5">Al ingresar se te pedirá que establezcas tu propia contraseña personal.</p>
    <div style="background:#F8F7FF;border:1px solid rgba(108,92,228,0.15);border-radius:12px;padding:20px;margin-bottom:24px">
      <div style="margin-bottom:12px"><span style="font-size:11px;font-weight:600;color:#9C96B4;text-transform:uppercase;letter-spacing:.05em">Usuario</span><br><span style="font-size:15px;font-weight:600;color:#16143A">${email.toLowerCase()}</span></div>
      <div><span style="font-size:11px;font-weight:600;color:#9C96B4;text-transform:uppercase;letter-spacing:.05em">Contraseña temporal</span><br><span style="font-size:15px;font-weight:600;color:#6C5CE4;font-family:monospace">${password}</span></div>
    </div>
    <a href="${BASE_URL}/login" style="display:block;text-align:center;background:linear-gradient(135deg,#6C5CE4,#4F3EE0);color:#fff;text-decoration:none;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:600;margin-bottom:20px">Ingresar al panel →</a>
  </div>
  <div style="padding:16px 32px;border-top:1px solid rgba(108,92,228,0.08);text-align:center">
    <p style="margin:0;font-size:11px;color:#C4C0D8">© Attempo · <a href="mailto:contacto@attempo.cl" style="color:#6C5CE4;text-decoration:none">contacto@attempo.cl</a></p>
  </div>
</div></body></html>`
            })
          }).catch(e => console.error('reenviar email error:', e.message));
        }

        return res.status(200).json({ ok: true });
      }

      if (action === 'cambiar-password') {
        const { username, password } = body;
        if (!username || !password) return res.status(400).json({ error: 'Datos incompletos' });
        if (password.length < 8) return res.status(400).json({ error: 'Mínimo 8 caracteres' });

        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/usuarios?username=eq.${encodeURIComponent(username)}`,
          { method: 'PATCH', headers: { ...sh, Prefer: 'return=minimal' }, body: JSON.stringify({ password }) }
        );
        if (!r.ok) return res.status(500).json({ error: 'Error al actualizar' });
        return res.status(200).json({ ok: true });
      }

      if (action === 'eliminar') {
        const { username } = body;
        if (!username) return res.status(400).json({ error: 'Datos incompletos' });

        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/usuarios?username=eq.${encodeURIComponent(username)}`,
          { method: 'DELETE', headers: { ...sh, Prefer: 'return=minimal' } }
        );
        if (!r.ok) return res.status(500).json({ error: 'Error al eliminar' });
        return res.status(200).json({ ok: true });
      }

      if (action === 'eliminar-negocio') {
        const { cliente_id } = body;
        if (!cliente_id) return res.status(400).json({ error: 'Datos incompletos' });

        await fetch(`${SUPABASE_URL}/rest/v1/citas?cliente_id=eq.${cliente_id}`,        { method: 'DELETE', headers: { ...sh, Prefer: 'return=minimal' } });
        await fetch(`${SUPABASE_URL}/rest/v1/especialistas?cliente_id=eq.${cliente_id}`, { method: 'DELETE', headers: { ...sh, Prefer: 'return=minimal' } });
        await fetch(`${SUPABASE_URL}/rest/v1/usuarios?cliente_id=eq.${cliente_id}`,     { method: 'DELETE', headers: { ...sh, Prefer: 'return=minimal' } });

        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}`,
          { method: 'DELETE', headers: { ...sh, Prefer: 'return=minimal' } }
        );
        if (!r.ok) return res.status(500).json({ error: 'Error al eliminar negocio' });
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Acción no válida' });
    }

    return res.status(405).end();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno' });
  }
}
