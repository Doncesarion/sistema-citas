import crypto from 'crypto';
import { promisify } from 'util';
const scryptAsync = promisify(crypto.scrypt);

const BASE_URL = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');

function verifySessionToken(token, expectedClienteId) {
  if (!token) return false;
  const SECRET = process.env.SESSION_SECRET;
  if (!SECRET) return false;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  if (sig !== expected) return false;
  const parts = payload.split(':');
  if (parts.length !== 3) return false;
  const [clienteId, , expires] = parts;
  if (Date.now() > parseInt(expires)) return false;
  if (String(expectedClienteId) !== clienteId) return false;
  return true;
}

function getClienteIdFromToken(token) {
  if (!token) return null;
  const SECRET = process.env.SESSION_SECRET;
  if (!SECRET) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  if (sig !== expected) return null;
  const parts = payload.split(':');
  if (parts.length !== 3) return null;
  const [clienteId, , expires] = parts;
  if (Date.now() > parseInt(expires)) return null;
  return clienteId;
}

const ROL_LABELS = {
  admin:    'Administrador general',
  staff:    'Staff / Profesional',
  recep:    'Recepcionista',
  finanzas: 'Finanzas',
  viewer:   'Solo lectura'
};

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
  const _SUPA_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
  const _KEY = process.env.SUPABASE_SERVICE_KEY;
  const _sh  = { apikey: _KEY, Authorization: `Bearer ${_KEY}`, 'Content-Type': 'application/json' };

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

    // También generar attempo_session_token para que slots.js reconozca al superadmin
    let session_token = null;
    const SESSION_SECRET = process.env.SESSION_SECRET;
    if (SESSION_SECRET) {
      const sesExpires = Date.now() + 24 * 60 * 60 * 1000;
      const sesPayload = `sa:superadmin:${sesExpires}`;
      const sesSig = crypto.createHmac('sha256', SESSION_SECRET).update(sesPayload).digest('hex');
      session_token = `${sesPayload}.${sesSig}`;
    }

    return res.status(200).json({ token: `${payload}.${sig}`, session_token });
  }

  // ── POST invitar profesional (session token, no SA token) ─────────────────
  if (req.method === 'POST' && req.body?.action === 'invitar') {
    const { email, nombre, rol, cliente_id, reenviar } = req.body || {};
    if (!verifySessionToken(req.headers['x-session-token'], cliente_id)) {
      return res.status(401).json({ error: 'No autorizado' });
    }
    if (!email || !nombre || !cliente_id) {
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }
    if (rol && !['admin', 'staff', 'recep', 'finanzas', 'viewer'].includes(rol)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Email inválido' });
    }
    const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
    const KEY = process.env.SUPABASE_SERVICE_KEY;
    const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
    try {
      const check = await fetch(
        `${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(email)}&cliente_id=eq.${cliente_id}&select=id,nombre`,
        { headers: sh }
      );
      const existing = await check.json();
      const tempPassword   = crypto.randomBytes(5).toString('hex');
      const hashedPassword = await hashPassword(tempPassword, false);
      const username       = email.toLowerCase();
      const rolLabel       = ROL_LABELS[rol] || 'Staff / Profesional';
      if (existing.length > 0) {
        if (!reenviar) return res.json({ ok: true, ya_tiene_acceso: true });
        await fetch(`${SUPABASE_URL}/rest/v1/usuarios?id=eq.${existing[0].id}`, {
          method: 'PATCH', headers: { ...sh, Prefer: 'return=minimal' },
          body: JSON.stringify({ password: hashedPassword })
        });
        if (process.env.RESEND_API_KEY) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'Attempo <contacto@attempo.cl>', to: email,
              subject: 'Tu acceso a attempo — nueva clave',
              headers: { 'List-Unsubscribe': '<mailto:contacto@attempo.cl?subject=unsubscribe>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
              html: inviteHtml({ nombre, username, tempPassword, rolLabel, loginUrl: `${BASE_URL}/login` })
            })
          }).catch(() => {});
        }
        return res.json({ ok: true, reenviado: true });
      }
      const createR = await fetch(`${SUPABASE_URL}/rest/v1/usuarios`, {
        method: 'POST', headers: { ...sh, Prefer: 'return=minimal' },
        body: JSON.stringify({ username, password: hashedPassword, email, nombre, rol: rol || 'staff', cliente_id })
      });
      if (!createR.ok) {
        const err = await createR.json().catch(() => ({}));
        return res.status(500).json({ error: err?.message || 'Error al crear usuario' });
      }
      if (process.env.RESEND_API_KEY) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Attempo <contacto@attempo.cl>', to: email,
            subject: 'Tu acceso a attempo está listo',
            headers: { 'List-Unsubscribe': '<mailto:contacto@attempo.cl?subject=unsubscribe>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
            html: inviteHtml({ nombre, username, tempPassword, rolLabel, loginUrl: `${BASE_URL}/login` })
          })
        }).then(async r => { if (!r.ok) console.error('invite email error:', await r.text()); })
          .catch(e => console.error('invite email exception:', e.message));
      }
      return res.json({ ok: true, ya_tiene_acceso: false });
    } catch (e) {
      console.error('invitar error:', e.message);
      return res.status(500).json({ error: 'Error interno' });
    }
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

  // ── Soporte routes (own auth — bypass SA gate) ───────────────────────────
  const _SUPA_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
  const _SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
  const _sh = { apikey: _SUPA_KEY, Authorization: `Bearer ${_SUPA_KEY}`, 'Content-Type': 'application/json' };

  // GET ?action=soporte-list — SA: all clients with last msg + unread count
  if (req.method === 'GET' && req.query.action === 'soporte-list') {
    const saToken = req.headers['x-sa-token'];
    if (!verifyToken(saToken)) return res.status(401).json({ error: 'No autorizado' });
    const [rMsgs, rCli] = await Promise.all([
      fetch(`${_SUPA_URL}/rest/v1/soporte_mensajes?order=created_at.desc&select=id,cliente_id,remitente,contenido,leido,created_at`, { headers: _sh }),
      fetch(`${_SUPA_URL}/rest/v1/clientes_sistema?select=id,nombre_negocio`, { headers: _sh })
    ]);
    const msgs = await rMsgs.json();
    const clientes = await rCli.json();
    const cliMap = {};
    for (const c of (Array.isArray(clientes) ? clientes : [])) cliMap[c.id] = c.nombre_negocio || '—';
    const convs = {};
    for (const m of (Array.isArray(msgs) ? msgs : [])) {
      if (!convs[m.cliente_id]) convs[m.cliente_id] = { cliente_id: m.cliente_id, negocio_nombre: cliMap[m.cliente_id] || '—', ultimo_msg: m.contenido, ultimo_at: m.created_at, ultimo_remitente: m.remitente, sin_leer: 0 };
      if (m.remitente === 'cliente' && !m.leido) convs[m.cliente_id].sin_leer++;
    }
    return res.status(200).json(Object.values(convs).sort((a, b) => new Date(b.ultimo_at) - new Date(a.ultimo_at)));
  }

  // GET ?action=soporte-msgs&cliente_id=xxx
  if (req.method === 'GET' && req.query.action === 'soporte-msgs') {
    const { cliente_id } = req.query;
    if (!cliente_id) return res.status(400).json({ error: 'Falta cliente_id' });
    const saToken = req.headers['x-sa-token'];
    const sesToken = req.headers['x-session-token'];
    const isSA = verifyToken(saToken);
    const cidFromToken = !isSA ? getClienteIdFromToken(sesToken) : null;
    if (!isSA && cidFromToken !== cliente_id) return res.status(401).json({ error: 'No autorizado' });
    if (isSA) {
      await fetch(`${_SUPA_URL}/rest/v1/soporte_mensajes?cliente_id=eq.${cliente_id}&remitente=eq.cliente&leido=eq.false`,
        { method: 'PATCH', headers: { ..._sh, Prefer: 'return=minimal' }, body: JSON.stringify({ leido: true }) });
    }
    const r = await fetch(`${_SUPA_URL}/rest/v1/soporte_mensajes?cliente_id=eq.${cliente_id}&order=created_at.asc&limit=200`, { headers: _sh });
    return res.status(200).json(await r.json());
  }

  // POST ?action=soporte-send
  if (req.method === 'POST' && req.query.action === 'soporte-send') {
    const { cliente_id, contenido, remitente } = req.body || {};
    if (!cliente_id || !contenido || !remitente) return res.status(400).json({ error: 'Datos incompletos' });
    const saToken = req.headers['x-sa-token'];
    const sesToken = req.headers['x-session-token'];
    const isSA = verifyToken(saToken);
    if (!isSA) {
      const cid = getClienteIdFromToken(sesToken);
      if (cid !== cliente_id || remitente !== 'cliente') return res.status(401).json({ error: 'No autorizado' });
    } else if (remitente !== 'superadmin') {
      return res.status(400).json({ error: 'Remitente inválido' });
    }
    const r = await fetch(`${_SUPA_URL}/rest/v1/soporte_mensajes`,
      { method: 'POST', headers: { ..._sh, Prefer: 'return=representation' },
        body: JSON.stringify({ cliente_id, contenido: contenido.trim(), remitente }) });
    if (!r.ok) return res.status(500).json({ error: 'Error al guardar' });
    const [msg] = await r.json();
    if (isSA) {
      await fetch(`${_SUPA_URL}/rest/v1/soporte_mensajes?cliente_id=eq.${cliente_id}&remitente=eq.cliente&leido=eq.false`,
        { method: 'PATCH', headers: { ..._sh, Prefer: 'return=minimal' }, body: JSON.stringify({ leido: true }) });
    }
    return res.status(200).json({ ok: true, msg });
  }

  // GET ?action=soporte-unread — client: check unread SA messages
  if (req.method === 'GET' && req.query.action === 'soporte-unread') {
    const sesToken = req.headers['x-session-token'];
    const cliente_id = getClienteIdFromToken(sesToken);
    if (!cliente_id) return res.status(401).json({ error: 'No autorizado' });
    const r = await fetch(`${_SUPA_URL}/rest/v1/soporte_mensajes?cliente_id=eq.${cliente_id}&remitente=eq.superadmin&leido=eq.false&select=id`, { headers: _sh });
    const msgs = await r.json();
    if (Array.isArray(msgs) && msgs.length) {
      await fetch(`${_SUPA_URL}/rest/v1/soporte_mensajes?cliente_id=eq.${cliente_id}&remitente=eq.superadmin&leido=eq.false`,
        { method: 'PATCH', headers: { ..._sh, Prefer: 'return=minimal' }, body: JSON.stringify({ leido: true }) });
    }
    return res.status(200).json({ unread: Array.isArray(msgs) ? msgs.length : 0 });
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
  <div style="background:linear-gradient(135deg,#1E1B3A,#16143A);padding:24px 32px">
    <img src="${BASE_URL}/logo_attempo.png" alt="Attempo" width="40" height="40" style="border-radius:10px;display:inline-block;vertical-align:middle">
    <span style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-.03em;display:inline-block;vertical-align:middle;margin-left:14px">Attempo</span>
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
  <div style="background:linear-gradient(135deg,#1E1B3A,#16143A);padding:24px 32px">
    <img src="${BASE_URL}/logo_attempo.png" alt="Attempo" width="40" height="40" style="border-radius:10px;display:inline-block;vertical-align:middle">
    <span style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-.03em;display:inline-block;vertical-align:middle;margin-left:14px">Attempo</span>
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

function inviteHtml({ nombre, username, tempPassword, rolLabel, loginUrl }) {
  const primerNombre = nombre.split(' ')[0];
  const logoUrl = 'https://sistema-citas-mu.vercel.app/logo_attempo.png';
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tu acceso a attempo</title></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f5f3ff;">Hola ${primerNombre}, ya puedes ingresar a attempo con tus credenciales.</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:40px 20px;">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);">
<tr><td style="background:#6C5CE4;padding:28px 32px;text-align:center;">
  <img src="${logoUrl}" alt="attempo" height="36" style="display:block;margin:0 auto 8px;">
  <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;font-family:Arial,sans-serif;">Todo a tu tiempo</p>
</td></tr>
<tr><td style="padding:32px;">
  <h2 style="margin:0 0 8px;color:#2d2d2d;font-size:20px;font-family:Arial,sans-serif;">¡Bienvenido/a, ${primerNombre}!</h2>
  <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;font-family:Arial,sans-serif;">
    Tu cuenta con rol <strong style="color:#2d2d2d;">${rolLabel}</strong> fue creada en attempo.<br>Aquí están tus datos de ingreso:
  </p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border-radius:12px;padding:20px;margin-bottom:24px;">
    <tr><td style="padding:8px 0;text-align:center;">
      <span style="color:#6C5CE4;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;font-family:Arial,sans-serif;">Usuario</span><br>
      <span style="color:#2d2d2d;font-size:14px;font-family:Arial,sans-serif;">${username}</span>
    </td></tr>
    <tr><td style="padding:12px 0 8px;text-align:center;border-top:1px solid #ede9fe;">
      <span style="color:#6C5CE4;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;font-family:Arial,sans-serif;">Clave de ingreso</span><br>
      <span style="color:#2d2d2d;font-size:22px;font-family:Courier New,monospace;font-weight:700;letter-spacing:3px;">${tempPassword}</span>
    </td></tr>
  </table>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
    <tr><td align="center">
      <a href="${loginUrl}" style="display:inline-block;padding:13px 36px;background:#6C5CE4;color:#ffffff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;font-family:Arial,sans-serif;">Ingresar a attempo</a>
    </td></tr>
  </table>
  <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;font-family:Arial,sans-serif;">Puedes cambiar tu clave dentro del sistema una vez que ingreses.</p>
</td></tr>
<tr><td style="background:#f9f8ff;padding:16px 32px;text-align:center;border-top:1px solid #ede9fe;">
  <p style="margin:0;color:#9ca3af;font-size:12px;font-family:Arial,sans-serif;">attempo &middot; Todo a tu tiempo &middot; <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none;">attempo.cl</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
