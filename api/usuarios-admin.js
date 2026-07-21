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

  // ── Auto-registro self-service (sin auth) ────────────────────────────────
  if (req.method === 'POST' && req.body?.action === 'auto-registro') {
    const { nombre_negocio, email, password, plan } = req.body || {};
    const PLANES_VALIDOS = ['inicio', 'pro', 'clinica_ia', 'chatbot_2k', 'chatbot_5k', 'chatbot_8k', 'chatbot_2k_agenda', 'chatbot_5k_agenda', 'chatbot_8k_agenda'];
    if (!nombre_negocio || !email || !password || !plan)
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Email inválido' });
    if (password.length < 8)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    if (!PLANES_VALIDOS.includes(plan))
      return res.status(400).json({ error: 'Plan inválido' });

    const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
    const KEY = process.env.SUPABASE_SERVICE_KEY;
    const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
    const emailLower = email.toLowerCase().trim();
    const negocio    = nombre_negocio.trim();

    try {
      // Verificar email duplicado en usuarios
      const rCheck = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?email=eq.${encodeURIComponent(emailLower)}&select=id&limit=1`, { headers: sh });
      const existing = await rCheck.json();
      if (Array.isArray(existing) && existing.length > 0)
        return res.status(400).json({ error: 'Ya existe una cuenta con este email' });

      // Generar slug único
      let slug = negocio.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'negocio';
      const rSlug = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?booking_slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`, { headers: sh });
      const slugEx = await rSlug.json();
      if (Array.isArray(slugEx) && slugEx.length > 0) slug = `${slug}-${crypto.randomBytes(3).toString('hex')}`;

      // Hash password y crear cliente
      const hashedPw = await hashPassword(password, false);
      const today    = new Date().toISOString().split('T')[0];
      const trial    = new Date(Date.now() + 12 * 86400000).toISOString().split('T')[0];

      const rCliente = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema`, {
        method: 'POST',
        headers: { ...sh, Prefer: 'return=representation' },
        body: JSON.stringify({
          nombre_negocio: negocio,
          email: emailLower,
          password_hash: hashedPw,
          plan,
          tipo_plan: plan,
          fecha_inicio: today,
          fecha_expiracion: trial,
          activo: true,
          booking_slug: slug
        })
      });
      if (!rCliente.ok) {
        const txt = await rCliente.text();
        console.error('auto-registro: create cliente error', rCliente.status, txt);
        return res.status(500).json({ error: 'Error al crear la cuenta' });
      }
      const [cliente] = await rCliente.json();
      const cliente_id = cliente.id;

      // Crear usuario admin
      const rUsuario = await fetch(`${SUPABASE_URL}/rest/v1/usuarios`, {
        method: 'POST',
        headers: { ...sh, Prefer: 'return=minimal' },
        body: JSON.stringify({
          username: emailLower,
          password: hashedPw,
          email: emailLower,
          nombre: negocio,
          rol: 'admin',
          destino: '/admin',
          cliente_id
        })
      });
      if (!rUsuario.ok) {
        const txt = await rUsuario.text();
        console.error('auto-registro: create usuario error', rUsuario.status, txt);
        // Revertir: eliminar cliente creado
        await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}`, { method: 'DELETE', headers: sh }).catch(() => {});
        const isDup = txt.includes('duplicate') || txt.includes('unique');
        return res.status(400).json({ error: isDup ? 'Ya existe una cuenta con este email' : 'Error al crear usuario' });
      }

      // Generar session token para auto-login
      let session_token = null;
      const SESSION_SECRET = process.env.SESSION_SECRET;
      if (SESSION_SECRET) {
        const expires = Date.now() + 24 * 60 * 60 * 1000;
        const payload = `${cliente_id}:admin:${expires}`;
        const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
        session_token = `${payload}.${sig}`;
      }

      // Email de bienvenida
      if (process.env.RESEND_API_KEY) {
        const planLabel = { inicio:'Inicio', pro:'Pro', clinica_ia:'Clínica IA', chatbot_2k:'Attia Starter', chatbot_5k:'Attia Pro', chatbot_8k:'Attia Business', chatbot_2k_agenda:'Attia Starter + Agenda', chatbot_5k_agenda:'Attia Pro + Agenda', chatbot_8k_agenda:'Attia Business + Agenda' };
        const loginUrl = `${BASE_URL}/login`;
        try {
          const emailResp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'attempo <contacto@attempo.cl>',
              to: [emailLower],
              subject: `Tu cuenta attempo está lista`,
              headers: { 'List-Unsubscribe': '<mailto:contacto@attempo.cl?subject=unsubscribe>' },
              html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F8F7FF;font-family:'Segoe UI',sans-serif">
<div style="max-width:520px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.1)">
  <div style="background:linear-gradient(135deg,#1E1B3A,#16143A);padding:24px 32px">
    <span style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-.03em">attempo</span>
  </div>
  <div style="padding:32px">
    <h2 style="margin:0 0 8px;font-size:20px;color:#16143A;letter-spacing:-.03em">Tu cuenta está lista</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#5E5880;line-height:1.6">Hola <b>${negocio}</b>, tu cuenta fue creada con el <b>Plan ${planLabel[plan] || plan}</b>. Tienes <b>12 días de prueba gratis</b> para explorar la plataforma.</p>
    <div style="background:#F8F7FF;border:1px solid rgba(108,92,228,0.15);border-radius:12px;padding:20px;margin-bottom:24px">
      <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#9C96B4;text-transform:uppercase;letter-spacing:.05em">Tus datos de acceso</p>
      <table style="width:100%;border-collapse:collapse;margin-top:10px">
        <tr><td style="padding:6px 0;font-size:12px;color:#9C96B4;width:90px">Email</td><td style="padding:6px 0;font-size:14px;font-weight:600;color:#16143A">${emailLower}</td></tr>
        <tr><td style="padding:6px 0;font-size:12px;color:#9C96B4">Contraseña</td><td style="padding:6px 0;font-size:14px;font-weight:600;color:#16143A;font-family:monospace">${password}</td></tr>
        <tr><td style="padding:6px 0;font-size:12px;color:#9C96B4">Tu link</td><td style="padding:6px 0"><a href="${BASE_URL}/${slug}" style="font-size:13px;color:#6C5CE4;text-decoration:none;font-weight:500">${BASE_URL}/${slug}</a></td></tr>
      </table>
    </div>
    <a href="${loginUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#6C5CE4,#4F3EE0);color:#fff;text-decoration:none;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:600;margin-bottom:20px">Ir a mi panel →</a>
    <p style="margin:0;font-size:13px;color:#9C96B4;line-height:1.5">Si tienes dudas, escríbenos a <a href="mailto:contacto@attempo.cl" style="color:#6C5CE4;text-decoration:none">contacto@attempo.cl</a></p>
  </div>
  <div style="padding:16px 32px;border-top:1px solid rgba(108,92,228,0.08);text-align:center">
    <p style="margin:0;font-size:11px;color:#C4C0D8">© attempo · <a href="mailto:contacto@attempo.cl" style="color:#6C5CE4;text-decoration:none">contacto@attempo.cl</a></p>
  </div>
</div></body></html>`
            })
          });
          const emailData = await emailResp.json();
          if (!emailResp.ok) {
            console.error('auto-registro: email error', emailResp.status, JSON.stringify(emailData));
          } else {
            console.error('auto-registro: email enviado id=', emailData.id);
          }
        } catch(emailErr) {
          console.error('auto-registro: email excepción', emailErr.message);
        }
      } else {
        console.error('auto-registro: sin RESEND_API_KEY, email omitido');
      }

      return res.status(200).json({ ok: true, cliente_id, nombre: negocio, tipo_plan: plan, session_token });
    } catch(e) {
      console.error('auto-registro error:', e.message);
      return res.status(500).json({ error: 'Error interno al crear la cuenta' });
    }
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
    if (!rMsgs.ok) {
      const errBody = await rMsgs.text().catch(() => '');
      console.error('[soporte-list] Supabase error:', rMsgs.status, errBody);
      return res.status(500).json({ error: 'Error al cargar conversaciones', detail: errBody });
    }
    const msgs = await rMsgs.json();
    const clientes = await rCli.json();
    const cliMap = {};
    for (const c of (Array.isArray(clientes) ? clientes : [])) cliMap[c.id] = c.nombre_negocio || '—';
    const convs = {};
    for (const m of (Array.isArray(msgs) ? msgs : [])) {
      const isWeb = m.cliente_id?.startsWith('web-');
      const negocio = isWeb ? 'Visitante web' : (cliMap[m.cliente_id] || '—');
      if (!convs[m.cliente_id]) convs[m.cliente_id] = { cliente_id: m.cliente_id, negocio_nombre: negocio, ultimo_msg: m.contenido, ultimo_at: m.created_at, ultimo_remitente: m.remitente, sin_leer: 0 };
      const esNoLeido = isWeb ? (m.remitente === 'visitante' && !m.leido) : (m.remitente === 'cliente' && !m.leido);
      if (esNoLeido) convs[m.cliente_id].sin_leer++;
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
    const isSASession = !isSA && cidFromToken === 'sa';
    if (!isSA && !isSASession && cidFromToken !== cliente_id) return res.status(401).json({ error: 'No autorizado' });
    if (isSA || isSASession) {
      const isWeb = cliente_id.startsWith('web-');
      const remitenteFilter = isWeb ? 'remitente=eq.visitante' : 'remitente=eq.cliente';
      await fetch(`${_SUPA_URL}/rest/v1/soporte_mensajes?cliente_id=eq.${cliente_id}&${remitenteFilter}&leido=eq.false`,
        { method: 'PATCH', headers: { ..._sh, Prefer: 'return=minimal' }, body: JSON.stringify({ leido: true }) });
    }
    const r = await fetch(`${_SUPA_URL}/rest/v1/soporte_mensajes?cliente_id=eq.${cliente_id}&order=created_at.asc&limit=200`, { headers: _sh });
    if (!r.ok) {
      const errBody = await r.text().catch(() => '');
      console.error('[soporte-msgs] Supabase error:', r.status, errBody);
      return res.status(500).json({ error: 'Error al cargar mensajes', detail: errBody });
    }
    return res.status(200).json(await r.json());
  }

  // POST ?action=soporte-send
  if (req.method === 'POST' && req.query.action === 'soporte-send') {
    const { cliente_id, contenido, remitente } = req.body || {};
    if (!cliente_id || !contenido || !remitente) return res.status(400).json({ error: 'Datos incompletos' });
    const saToken = req.headers['x-sa-token'];
    const sesToken = req.headers['x-session-token'];
    const isSA = verifyToken(saToken);
    let isSASession = false;
    if (!isSA) {
      const cid = getClienteIdFromToken(sesToken);
      isSASession = cid === 'sa';
      if (!isSASession && (cid !== cliente_id || remitente !== 'cliente')) return res.status(401).json({ error: 'No autorizado' });
    } else if (remitente !== 'superadmin') {
      return res.status(400).json({ error: 'Remitente inválido' });
    }
    const r = await fetch(`${_SUPA_URL}/rest/v1/soporte_mensajes`,
      { method: 'POST', headers: { ..._sh, Prefer: 'return=representation' },
        body: JSON.stringify({ cliente_id, contenido: contenido.trim(), remitente }) });
    if (!r.ok) {
      const errBody = await r.text().catch(() => '');
      console.error('[soporte-send] Supabase error:', r.status, errBody);
      return res.status(500).json({ error: 'Error al guardar', detail: errBody });
    }
    const [msg] = await r.json();
    if (isSA || isSASession) {
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

  // ── GET mis_pagos: historial de pagos propios (session token o impersonación SA) ──
  if (req.method === 'GET' && req.query?.action === 'mis_pagos') {
    let clienteId = getClienteIdFromToken(req.headers['x-session-token']);
    // Impersonación SA: token es sa:superadmin:... + x-override-cliente-id
    if ((!clienteId || clienteId === 'sa') && req.headers['x-override-cliente-id'] && verifyToken(req.headers['x-sa-token'])) {
      clienteId = req.headers['x-override-cliente-id'];
    }
    if (!clienteId || clienteId === 'sa') return res.status(401).json({ error: 'No autorizado' });
    const KEY = process.env.SUPABASE_SERVICE_KEY;
    const sh2 = { apikey: KEY, Authorization: `Bearer ${KEY}` };
    const r = await fetch(
      `https://xztqawulvrtjvtfixofy.supabase.co/rest/v1/pagos?cliente_id=eq.${encodeURIComponent(clienteId)}&order=created_at.desc&limit=50`,
      { headers: sh2 }
    );
    return res.status(r.status).json(await r.json());
  }

  // OPTIONS preflight para web-lead-save (cross-origin desde attempo.cl)
  if (req.query.action === 'web-lead-save') {
    res.setHeader('Access-Control-Allow-Origin', 'https://attempo.cl');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(204).end();
  }

  // POST ?action=web-lead-save — guardar lead del sitio web (chat Attia o clic WA), sin auth
  if (req.method === 'POST' && req.query.action === 'web-lead-save') {
    const { session_id, mensajes, ip, tipo, pagina } = req.body || {};
    if (!session_id || !Array.isArray(mensajes)) return res.status(400).json({ error: 'Datos inválidos' });
    const tipoValido = ['chat', 'whatsapp'].includes(tipo) ? tipo : 'chat';
    try {
      const r = await fetch(`${_SUPA_URL}/rest/v1/web_leads`, {
        method: 'POST',
        headers: { ..._sh, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ session_id: String(session_id).slice(0, 64), mensajes, ip: ip || null, tipo: tipoValido, pagina: pagina || null })
      });
      if (!r.ok) { const err = await r.text().catch(() => ''); console.error('[web-lead-save]', r.status, err); return res.status(500).json({ error: 'Error al guardar' }); }
      return res.status(200).json({ ok: true });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // ── Todas las demás rutas requieren token válido ───────────────────────────
  if (!verifyToken(req.headers['x-sa-token'])) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  // POST ?action=merge-leads — SA: fusionar dos sesiones en un grupo
  if (req.method === 'POST' && req.query.action === 'merge-leads') {
    const { session_a, session_b } = req.body || {};
    if (!session_a || !session_b || session_a === session_b) return res.status(400).json({ error: 'IDs inválidos' });
    try {
      const [rA, rB] = await Promise.all([
        fetch(`${_SUPA_URL}/rest/v1/web_leads?session_id=eq.${encodeURIComponent(session_a)}&select=group_id&limit=1`, { headers: _sh }),
        fetch(`${_SUPA_URL}/rest/v1/web_leads?session_id=eq.${encodeURIComponent(session_b)}&select=group_id&limit=1`, { headers: _sh })
      ]);
      const [rowA] = await rA.json().catch(() => []);
      const [rowB] = await rB.json().catch(() => []);
      const canonical = rowA?.group_id || rowB?.group_id || session_a;
      const patches = [
        fetch(`${_SUPA_URL}/rest/v1/web_leads?session_id=eq.${encodeURIComponent(session_a)}`, { method: 'PATCH', headers: { ..._sh, Prefer: 'return=minimal' }, body: JSON.stringify({ group_id: canonical }) }),
        fetch(`${_SUPA_URL}/rest/v1/web_leads?session_id=eq.${encodeURIComponent(session_b)}`, { method: 'PATCH', headers: { ..._sh, Prefer: 'return=minimal' }, body: JSON.stringify({ group_id: canonical }) })
      ];
      if (rowA?.group_id) patches.push(fetch(`${_SUPA_URL}/rest/v1/web_leads?group_id=eq.${encodeURIComponent(rowA.group_id)}`, { method: 'PATCH', headers: { ..._sh, Prefer: 'return=minimal' }, body: JSON.stringify({ group_id: canonical }) }));
      if (rowB?.group_id && rowB.group_id !== canonical) patches.push(fetch(`${_SUPA_URL}/rest/v1/web_leads?group_id=eq.${encodeURIComponent(rowB.group_id)}`, { method: 'PATCH', headers: { ..._sh, Prefer: 'return=minimal' }, body: JSON.stringify({ group_id: canonical }) }));
      await Promise.all(patches);
      return res.status(200).json({ ok: true, group_id: canonical });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // POST ?action=unmerge-lead — SA: desvincular una sesión de su grupo
  if (req.method === 'POST' && req.query.action === 'unmerge-lead') {
    const { session_id } = req.body || {};
    if (!session_id) return res.status(400).json({ error: 'session_id requerido' });
    try {
      const r = await fetch(`${_SUPA_URL}/rest/v1/web_leads?session_id=eq.${encodeURIComponent(session_id)}`, { method: 'PATCH', headers: { ..._sh, Prefer: 'return=minimal' }, body: JSON.stringify({ group_id: null }) });
      if (!r.ok) return res.status(500).json({ error: 'Error al desvincular' });
      return res.status(200).json({ ok: true });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // POST ?action=toggle-bot-pausa — SA: activar/pausar bot para una conversación
  if (req.method === 'POST' && req.query.action === 'toggle-bot-pausa') {
    const { canal_user_id, canal, pausa } = req.body || {};
    if (!canal_user_id || !canal || typeof pausa !== 'boolean') return res.status(400).json({ error: 'Datos incompletos' });
    const channelKey   = canal === 'whatsapp' ? 'wa_phone_number_id' : canal === 'messenger' ? 'fb_page_id' : 'ig_account_id';
    const channelValue = canal === 'whatsapp' ? process.env.ATTEMPO_WA_PHONE_ID : canal === 'messenger' ? process.env.ATTEMPO_FB_PAGE_ID : process.env.ATTEMPO_IG_ACCOUNT_ID;
    if (!channelValue) return res.status(500).json({ error: 'Canal no configurado' });
    try {
      const rCli = await fetch(`${_SUPA_URL}/rest/v1/clientes_sistema?canales_meta->>${channelKey}=eq.${encodeURIComponent(channelValue)}&select=id&limit=1`, { headers: _sh });
      const [cli] = await rCli.json().catch(() => []);
      if (!cli) return res.status(404).json({ error: 'Canal no encontrado' });
      const r = await fetch(`${_SUPA_URL}/rest/v1/chat_sessions?cliente_id=eq.${encodeURIComponent(cli.id)}&canal=eq.${encodeURIComponent(canal)}&canal_user_id=eq.${encodeURIComponent(canal_user_id)}`, {
        method: 'PATCH',
        headers: { ..._sh, Prefer: 'return=minimal' },
        body: JSON.stringify({ pausa_bot: pausa })
      });
      if (!r.ok) { const err = await r.text().catch(() => ''); return res.status(500).json({ error: 'Error al actualizar', detail: err.slice(0,100) }); }
      return res.status(200).json({ ok: true, pausa });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // POST ?action=send-wa-reply — SA: responder a un lead desde el panel
  if (req.method === 'POST' && req.query.action === 'send-wa-reply') {
    const { to, mensaje, canal } = req.body || {};
    if (!to || !mensaje || !canal) return res.status(400).json({ error: 'Datos incompletos' });
    if (typeof mensaje !== 'string' || mensaje.length > 4096) return res.status(400).json({ error: 'Mensaje inválido' });
    const channelKey   = canal === 'whatsapp' ? 'wa_phone_number_id' : canal === 'messenger' ? 'fb_page_id' : 'ig_account_id';
    const channelValue = canal === 'whatsapp' ? process.env.ATTEMPO_WA_PHONE_ID : canal === 'messenger' ? process.env.ATTEMPO_FB_PAGE_ID : process.env.ATTEMPO_IG_ACCOUNT_ID;
    if (!channelValue) return res.status(500).json({ error: 'Canal no configurado en env vars' });
    try {
      const rCli = await fetch(`${_SUPA_URL}/rest/v1/clientes_sistema?canales_meta->>${channelKey}=eq.${encodeURIComponent(channelValue)}&select=id,canales_meta&limit=1`, { headers: _sh });
      const [cli] = await rCli.json().catch(() => []);
      if (!cli) return res.status(404).json({ error: 'Canal no encontrado' });
      const meta = cli.canales_meta || {};
      const accessToken = canal === 'whatsapp' ? meta.wa_token : canal === 'messenger' ? meta.fb_token : meta.ig_token;
      if (!accessToken) return res.status(500).json({ error: 'Access token no configurado' });
      let sendRes;
      if (canal === 'whatsapp') {
        sendRes = await fetch(`https://graph.facebook.com/v20.0/${channelValue}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: mensaje } })
        });
      } else if (canal === 'messenger') {
        sendRes = await fetch(`https://graph.facebook.com/v20.0/me/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: { id: to }, message: { text: mensaje } })
        });
      } else {
        sendRes = await fetch(`https://graph.instagram.com/v21.0/me/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: { id: to }, message: { text: mensaje } })
        });
      }
      if (!sendRes.ok) { const err = await sendRes.text().catch(() => ''); console.error('[send-wa-reply]', sendRes.status, err.slice(0,200)); return res.status(500).json({ error: 'Error Meta API: ' + sendRes.status }); }
      // Guardar respuesta en web_leads
      fetch(`${_SUPA_URL}/rest/v1/web_leads`, {
        method: 'POST',
        headers: { ..._sh, Prefer: 'return=minimal' },
        body: JSON.stringify({ session_id: to, mensajes: [{ role: 'assistant', content: mensaje }], tipo: 'whatsapp_msg', pagina: canal })
      }).catch(() => {});
      // Auto-pausar el bot al responder manualmente
      fetch(`${_SUPA_URL}/rest/v1/chat_sessions?cliente_id=eq.${encodeURIComponent(cli.id || '')}&canal=eq.${encodeURIComponent(canal)}&canal_user_id=eq.${encodeURIComponent(to)}`, {
        method: 'PATCH',
        headers: { ..._sh, Prefer: 'return=minimal' },
        body: JSON.stringify({ pausa_bot: true })
      }).catch(() => {});
      return res.status(200).json({ ok: true });
    } catch(e) { console.error('[send-wa-reply] exception:', e.message); return res.status(500).json({ error: 'Error interno' }); }
  }

  // GET ?action=web-leads — SA: conversaciones del chat de attempo.cl
  if (req.method === 'GET' && req.query.action === 'web-leads') {
    try {
      const r = await fetch(`${_SUPA_URL}/rest/v1/web_leads?order=created_at.desc&limit=200`, { headers: _sh });
      if (!r.ok) {
        const err = await r.text().catch(() => '');
        console.error('[web-leads] Supabase error:', r.status, err);
        return res.status(500).json({ error: 'Error al cargar leads', detail: err.slice(0, 200) });
      }
      const rows = await r.json();
      return res.status(200).json(Array.isArray(rows) ? rows : []);
    } catch(e) {
      console.error('[web-leads] exception:', e.message);
      return res.status(500).json({ error: e.message });
    }
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

    // tipo_plan no está en la edge function — lo actualizamos directamente aquí
    if (edge_action === 'actualizar' && forwardBody.id && forwardBody.tipo_plan && response.ok) {
      const KEY = process.env.SUPABASE_SERVICE_KEY;
      if (KEY) {
        await fetch(`https://xztqawulvrtjvtfixofy.supabase.co/rest/v1/clientes_sistema?id=eq.${encodeURIComponent(forwardBody.id)}`, {
          method: 'PATCH',
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ tipo_plan: forwardBody.tipo_plan })
        }).catch(e => console.error('proxy actualizar tipo_plan error:', e.message));
      }
    }

    return res.status(response.status).json(data);
  }

  // ══════════════════════════════════════════════════════════════════
  // ── COTIZACIONES ──────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════
  if (req.query.action && req.query.action.startsWith('cot-')) {
    const _CKEY = process.env.SUPABASE_SERVICE_KEY;
    const _CURL = 'https://xztqawulvrtjvtfixofy.supabase.co';
    const _csh  = { apikey: _CKEY, Authorization: `Bearer ${_CKEY}`, 'Content-Type': 'application/json' };
    const _cshG = { apikey: _CKEY, Authorization: `Bearer ${_CKEY}` };
    const action = req.query.action;

    // Helper: obtiene cliente_id respetando impersonación superadmin
    function _cotClienteId() {
      const override = req.headers['x-override-cliente-id'];
      if (override && verifyToken(req.headers['x-sa-impersona'])) return override;
      return getClienteIdFromToken(req.headers['x-session-token']);
    }

    // GET cot-lista — listar cotizaciones del cliente autenticado
    if (req.method === 'GET' && action === 'cot-lista') {
      const cid = _cotClienteId();
      if (!cid) return res.status(401).json({ error: 'No autorizado' });
      const r = await fetch(`${_CURL}/rest/v1/cotizaciones?cliente_id=eq.${cid}&order=created_at.desc&limit=100`, { headers: _cshG });
      return res.status(200).json(await r.json());
    }

    // POST cot-guardar — crear o actualizar cotización
    if (req.method === 'POST' && action === 'cot-guardar') {
      const cid = _cotClienteId();
      if (!cid) return res.status(401).json({ error: 'No autorizado' });
      const { id, datos_destinatario, items, condiciones, incluye_iva, notas, archivo_externo_url } = req.body || {};
      if (id) {
        const r = await fetch(`${_CURL}/rest/v1/cotizaciones?id=eq.${id}&cliente_id=eq.${cid}`, {
          method: 'PATCH', headers: { ..._csh, Prefer: 'return=representation' },
          body: JSON.stringify({ datos_destinatario, items, condiciones, incluye_iva, notas, archivo_externo_url })
        });
        const d = await r.json();
        return res.status(200).json(d[0] || {});
      } else {
        const rMax = await fetch(`${_CURL}/rest/v1/cotizaciones?cliente_id=eq.${cid}&select=numero&order=numero.desc&limit=1`, { headers: _cshG });
        const mx = await rMax.json();
        const numero = ((mx[0]?.numero) || 0) + 1;
        const dias = parseInt(condiciones?.validez_dias || 15);
        const fVenc = new Date(Date.now() + dias * 86400000).toISOString().split('T')[0];
        const r = await fetch(`${_CURL}/rest/v1/cotizaciones`, {
          method: 'POST', headers: { ..._csh, Prefer: 'return=representation' },
          body: JSON.stringify({ cliente_id: cid, numero, datos_destinatario, items, condiciones, incluye_iva, notas, archivo_externo_url, fecha_vencimiento: fVenc })
        });
        const d = await r.json();
        return res.status(201).json(d[0] || {});
      }
    }

    // POST cot-enviar — enviar cotización por email y/o WhatsApp
    if (req.method === 'POST' && action === 'cot-enviar') {
      const cid = _cotClienteId();
      if (!cid) return res.status(401).json({ error: 'No autorizado' });
      const { id, canales } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id requerido' });
      const [rCot, rCli] = await Promise.all([
        fetch(`${_CURL}/rest/v1/cotizaciones?id=eq.${id}&cliente_id=eq.${cid}&limit=1`, { headers: _cshG }),
        fetch(`${_CURL}/rest/v1/clientes_sistema?id=eq.${cid}&select=nombre_negocio,email,telefono,direccion,logo_url,canales_meta&limit=1`, { headers: _cshG })
      ]);
      const cot = (await rCot.json())[0];
      const cli = (await rCli.json())[0];
      if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' });
      const publicUrl = `${BASE_URL}/cotizacion?token=${cot.token_respuesta}`;
      const errors = [];
      const neto = (cot.items || []).reduce((s, it) => s + (parseFloat(it.precio_unitario)||0) * (parseFloat(it.cantidad)||1) * (1 - (parseFloat(it.descuento)||0)/100), 0);
      const total = cot.incluye_iva ? Math.round(neto * 1.19) : Math.round(neto);
      const totalFmt = '$' + total.toLocaleString('es-CL');
      if (canales?.includes('email') && cot.datos_destinatario?.email) {
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'Attempo <contacto@attempo.cl>',
              to: [cot.datos_destinatario.email],
              subject: `Cotización N° ${cot.numero} — ${cli?.nombre_negocio || 'Cotización'}`,
              html: buildCotizacionEmail({ cot, cli, publicUrl, totalFmt })
            })
          });
        } catch(e) { errors.push('email: ' + e.message); }
      }
      if (canales?.includes('whatsapp') && cot.datos_destinatario?.telefono && cli?.canales_meta?.wa_phone_number_id && cli?.canales_meta?.wa_token) {
        let phone = String(cot.datos_destinatario.telefono).replace(/\D/g,'');
        if (!phone.startsWith('56') && phone.length === 9) phone = '56' + phone;
        try {
          await fetch(`https://graph.facebook.com/v20.0/${cli.canales_meta.wa_phone_number_id}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${cli.canales_meta.wa_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: `Hola, te enviamos la Cotización N° ${cot.numero} por ${totalFmt}.\n\nPuedes revisarla y responderla aquí:\n${publicUrl}` } })
          });
        } catch(e) { errors.push('whatsapp: ' + e.message); }
      }
      await fetch(`${_CURL}/rest/v1/cotizaciones?id=eq.${id}&cliente_id=eq.${cid}`, {
        method: 'PATCH', headers: _csh, body: JSON.stringify({ estado: 'enviada' })
      });
      return res.status(200).json({ ok: true, ...(errors.length && { errors }) });
    }

    // DELETE cot-eliminar — eliminar borrador
    if (req.method === 'DELETE' && action === 'cot-eliminar') {
      const cid = _cotClienteId();
      if (!cid) return res.status(401).json({ error: 'No autorizado' });
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id requerido' });
      await fetch(`${_CURL}/rest/v1/cotizaciones?id=eq.${id}&cliente_id=eq.${cid}&estado=eq.borrador`, {
        method: 'DELETE', headers: _cshG
      });
      return res.status(200).json({ ok: true });
    }

    // GET cot-publica — página pública (sin auth)
    if (req.method === 'GET' && action === 'cot-publica') {
      const { token } = req.query;
      if (!token) return res.status(400).json({ error: 'token requerido' });
      const r = await fetch(`${_CURL}/rest/v1/cotizaciones?token_respuesta=eq.${encodeURIComponent(token)}&limit=1`, { headers: _cshG });
      const cot = (await r.json())[0];
      if (!cot) return res.status(404).json({ error: 'Cotización no encontrada' });
      const rCli = await fetch(`${_CURL}/rest/v1/clientes_sistema?id=eq.${cot.cliente_id}&select=nombre_negocio,email,telefono,direccion,logo_url&limit=1`, { headers: _cshG });
      const cli = (await rCli.json())[0] || {};
      return res.status(200).json({ cotizacion: cot, negocio: cli });
    }

    // POST cot-responder — cliente acepta o rechaza (sin auth)
    if (req.method === 'POST' && action === 'cot-responder') {
      const { token, accion, comentario } = req.body || {};
      if (!token || !['aceptada','rechazada'].includes(accion)) return res.status(400).json({ error: 'Datos inválidos' });
      const rCheck = await fetch(`${_CURL}/rest/v1/cotizaciones?token_respuesta=eq.${encodeURIComponent(token)}&estado=eq.enviada&limit=1`, { headers: _cshG });
      if (!(await rCheck.json())[0]) return res.status(409).json({ error: 'Esta cotización ya fue respondida o no está disponible' });
      await fetch(`${_CURL}/rest/v1/cotizaciones?token_respuesta=eq.${encodeURIComponent(token)}`, {
        method: 'PATCH', headers: _csh,
        body: JSON.stringify({ estado: accion, respuesta: { accion, comentario: comentario || null, fecha: new Date().toISOString() } })
      });
      return res.status(200).json({ ok: true, estado: accion });
    }

    // GET cot-config — datos del negocio para cotizaciones
    if (req.method === 'GET' && action === 'cot-config') {
      const cid = _cotClienteId();
      if (!cid) return res.status(401).json({ error: 'No autorizado' });
      const r = await fetch(`${_CURL}/rest/v1/clientes_sistema?id=eq.${cid}&select=nombre_negocio,email,telefono,direccion,logo_url&limit=1`, { headers: _cshG });
      return res.status(200).json((await r.json())[0] || {});
    }

    // PATCH cot-logo — guardar logo_url
    if (req.method === 'PATCH' && action === 'cot-logo') {
      const cid = _cotClienteId();
      if (!cid) return res.status(401).json({ error: 'No autorizado' });
      const { logo_url } = req.body || {};
      await fetch(`${_CURL}/rest/v1/clientes_sistema?id=eq.${cid}`, {
        method: 'PATCH', headers: _csh, body: JSON.stringify({ logo_url })
      });
      return res.status(200).json({ ok: true });
    }
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

      if (action === 'pagos_historial') {
        if (!cliente_id) return res.status(400).json({ error: 'Falta cliente_id' });
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/pagos?cliente_id=eq.${encodeURIComponent(cliente_id)}&order=created_at.desc&limit=50`,
          { headers: sh }
        );
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

        const rGet = await fetch(
          `${SUPABASE_URL}/rest/v1/usuarios?username=eq.${encodeURIComponent(username)}&select=id,email,nombre`,
          { headers: sh }
        );
        const rows = await rGet.json();
        if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
        const { id: userId, email: userEmail, nombre: userNombre } = rows[0];

        const hashedPw = await hashPassword(password, false);
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/usuarios?id=eq.${userId}`,
          { method: 'PATCH', headers: { ...sh, Prefer: 'return=minimal' }, body: JSON.stringify({ password: hashedPw }) }
        );
        if (!r.ok) return res.status(500).json({ error: 'Error al actualizar' });

        if (userEmail && process.env.RESEND_API_KEY) {
          const primerNombre = (userNombre || username).split(' ')[0];
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'attempo <contacto@attempo.cl>',
              to: [userEmail],
              subject: 'Tu contraseña en attempo fue cambiada',
              headers: { 'List-Unsubscribe': '<mailto:contacto@attempo.cl?subject=unsubscribe>' },
              html: `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f3ff;font-family:Arial,sans-serif">
<div style="max-width:480px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.1)">
  <div style="background:#6C5CE4;padding:24px 32px;text-align:center">
    <img src="https://sistema-citas-mu.vercel.app/logo_attempo.png" alt="attempo" height="36" style="display:block;margin:0 auto 6px">
    <p style="margin:0;color:rgba(255,255,255,.85);font-size:13px">Todo a tu tiempo</p>
  </div>
  <div style="padding:32px">
    <h2 style="margin:0 0 12px;color:#2d2d2d;font-size:18px">Hola, ${primerNombre}</h2>
    <p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.6">La contraseña de tu cuenta <strong style="color:#2d2d2d">${username}</strong> en attempo fue cambiada exitosamente.</p>
    <p style="margin:0 0 24px;color:#6b7280;font-size:13px;line-height:1.6">Si no realizaste este cambio, contacta a tu administrador de inmediato o escríbenos a <a href="mailto:contacto@attempo.cl" style="color:#6C5CE4">contacto@attempo.cl</a>.</p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 18px;margin-bottom:24px">
      <p style="margin:0;color:#dc2626;font-size:13px;font-weight:600">⚠ Si no fuiste tú, actúa ahora</p>
      <p style="margin:4px 0 0;color:#7f1d1d;font-size:12px">Contacta a tu administrador para restablecer el acceso.</p>
    </div>
  </div>
  <div style="padding:16px 32px;border-top:1px solid #ede9fe;text-align:center">
    <p style="margin:0;color:#9ca3af;font-size:11px">attempo · <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none">attempo.cl</a></p>
  </div>
</div></body></html>`
            })
          }).catch(e => console.error('password-change email error:', e.message));
        }

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

function buildCotizacionEmail({ cot, cli, publicUrl, totalFmt }) {
  const nombre  = cot.datos_destinatario?.nombre || 'Estimado/a';
  const negocio = cli?.nombre_negocio || 'Tu proveedor';
  const logo    = cli?.logo_url;
  const logoHtml = logo
    ? `<img src="${logo}" alt="${negocio}" style="max-height:48px;max-width:160px;display:block;margin:0 0 4px">`
    : `<div style="font-size:20px;font-weight:700;color:#fff">${negocio}</div>`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
<tr><td style="background:#1E1B3A;padding:24px 32px">${logoHtml}<div style="font-size:13px;color:rgba(255,255,255,.7);margin-top:4px">Cotización N° ${cot.numero}</div></td></tr>
<tr><td style="padding:32px">
  <p style="margin:0 0 16px;color:#374151;font-size:15px">Hola <strong>${nombre}</strong>,</p>
  <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6"><strong>${negocio}</strong> te ha enviado una cotización por un total de <strong style="color:#6C5CE4">${totalFmt}</strong>. Haz clic en el botón para revisarla y responderla.</p>
  <table width="100%"><tr><td align="center" style="padding:0 0 24px">
    <a href="${publicUrl}" style="display:inline-block;padding:14px 36px;background:#6C5CE4;color:#fff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600">Ver cotización →</a>
  </td></tr></table>
  <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center">Esta cotización vence el ${cot.fecha_vencimiento || '—'}.</p>
</td></tr>
<tr><td style="background:#f9f8ff;padding:14px 32px;text-align:center;border-top:1px solid #ede9fe">
  <p style="margin:0;color:#9ca3af;font-size:12px">Enviado vía attempo · <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none">attempo.cl</a></p>
</td></tr>
</table></td></tr></table></body></html>`;
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
