import crypto from 'crypto';
import PDFDocument from 'pdfkit';

const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
const BASE_URL     = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');

function verifySessionToken(token) {
  if (!token) return null;
  const SECRET = process.env.SESSION_SECRET;
  if (!SECRET) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch { return null; }
  const parts = payload.split(':');
  if (parts.length !== 3) return null;
  if (Date.now() > parseInt(parts[2])) return null;
  return { cliente_id: parts[0], rol: parts[1] };
}

function resolveClienteId(req, defaultId) {
  const session = verifySessionToken(req.headers['x-session-token']);
  const overrideId = req.headers['x-override-cliente-id'];
  if (session?.rol === 'superadmin' && overrideId && /^[0-9a-f-]{36}$/i.test(overrideId)) return overrideId;
  return session?.cliente_id || defaultId;
}

function he(str) {
  if (!str && str !== 0) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Reemplaza variables en el template de recordatorio
function renderTemplate(template, vars) {
  return (template || '')
    .replace(/\{nombre\}/g,      vars.nombre      || '')
    .replace(/\{fecha\}/g,       vars.fecha        || '')
    .replace(/\{hora\}/g,        vars.hora         || '')
    .replace(/\{profesional\}/g, vars.profesional  || '')
    .replace(/\{servicio\}/g,    vars.servicio     || '')
    .replace(/\{negocio\}/g,     vars.negocio      || '');
}

// Template HTML para recordatorio
function emailRecordatorioHtml({ nombre, fecha, hora, profesional, servicio, negocio, intro, mensaje_extra, cita_id }) {
  const gestionUrl = `${BASE_URL}/gestionar-cita?id=${he(cita_id || '')}`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media only screen and (max-width:600px){.aw{padding:20px 8px!important}.ac{padding:24px 16px!important}.af{padding:12px 16px!important}}</style></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" class="aw" style="background:#f5f3ff;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);">
<tr><td style="background:#6C5CE4;padding:28px 24px;text-align:center;">
  <img src="${BASE_URL}/logo_attempo.png" alt="Attempo" height="36" style="display:block;margin:0 auto 8px;">
  <p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;">Todo a tu tiempo</p>
</td></tr>
<tr><td class="ac" style="padding:28px 24px;text-align:center;">
  <h2 style="margin:0 0 6px;color:#2d2d2d;font-size:20px;">Recordatorio de cita</h2>
  <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hola <strong>${he(nombre)}</strong>, ${he(intro || 'te recordamos que tienes una cita próximamente.')}</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border-radius:12px;padding:20px;">
    ${profesional ? `<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Profesional</span><br><span style="color:#2d2d2d;font-size:15px;">${he(profesional)}</span></td></tr>` : ''}
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Fecha</span><br><span style="color:#2d2d2d;font-size:15px;font-weight:600;">${he(fecha)}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Hora</span><br><span style="color:#2d2d2d;font-size:15px;font-weight:600;">${he(hora)}</span></td></tr>
    ${servicio   ? `<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Servicio</span><br><span style="color:#2d2d2d;font-size:15px;">${he(servicio)}</span></td></tr>` : ''}
    ${direccion  ? `<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Dirección</span><br><span style="color:#2d2d2d;font-size:14px;">${he(direccion)}</span></td></tr>` : ''}
  </table>
  ${mensaje_extra ? `<p style="margin:20px 0 0;color:#374151;font-size:13px;line-height:1.6;text-align:left;background:#f9f8ff;border-radius:8px;padding:12px 16px">${he(mensaje_extra).replace(/\n/g,'<br>')}</p>` : ''}
  <p style="margin:20px 0 6px;color:#6b7280;font-size:13px;text-align:center;">¿Necesitas cambios? <a href="${gestionUrl}" style="color:#6C5CE4;font-weight:600;text-decoration:none;">Cancelar o reagendar tu cita</a></p>
</td></tr>
<tr><td class="af" style="background:#f9f8ff;padding:16px 24px;text-align:center;border-top:1px solid #ede9fe;">
  <p style="margin:0;color:#9ca3af;font-size:12px;">Recordatorio automático de <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none;">Attempo</a> — Todo a tu tiempo</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// ── Reactivación de conversaciones WhatsApp ───────────────────────────────────
function dentroHorarioComercialStgo() {
  const stgo = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }));
  const hour = stgo.getHours();
  const dow  = stgo.getDay();
  return dow >= 1 && dow <= 6 && hour >= 9 && hour < 20;
}

function getFollowupMsgs(tipo, nombreCompleto) {
  const nombre = nombreCompleto ? nombreCompleto.split(' ')[0] : null;
  if (tipo === 'ventas') {
    return [
      "¿Tienes alguna duda en la que pueda ayudarte con la plataforma? 😊",
      "Hola, ¿quieres que te muestre cómo funciona attempo para tu rubro? Te puedo dar un ejemplo concreto 😊",
      nombre
        ? `${nombre}, para no perder el hilo — si quieres avanzar ya puedes probarlo gratis acá: https://app.attempo.cl/registro. O si prefieres, seguimos por acá cuando puedas 😊`
        : "Para no perder el hilo — si quieres avanzar ya puedes probarlo gratis acá: https://app.attempo.cl/registro. O si prefieres, seguimos por acá cuando puedas 😊",
    ];
  }
  return [
    "¿Tienes alguna duda en la que pueda ayudarte? 😊",
    "Hola, ¿te podemos ayudar con algo más? Si quieres cotizar otro servicio o tratamiento estamos disponibles 😊",
    nombre
      ? `¡Hola ${nombre}! Si necesitas agendar o tienes alguna consulta, aquí estamos para ayudarte 😊`
      : "¡Hola! Si necesitas agendar o tienes alguna consulta, aquí estamos para ayudarte 😊",
  ];
}

async function procesarReactivacion(sh, shJson) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/chat_sessions` +
    `?conversation_status=eq.esperando_respuesta` +
    `&canal=eq.whatsapp` +
    `&follow_up_count=lt.4` +
    `&last_client_message_at=not.is.null` +
    `&select=id,cliente_id,canal_user_id,canal_user_name,follow_up_count,last_client_message_at,lead_calificado`,
    { headers: sh }
  );
  const sesiones = await r.json();
  if (!Array.isArray(sesiones)) return { procesadas: 0, enviadas: [] };

  const ahora    = Date.now();
  const enviadas = [];

  for (const s of sesiones) {
    const minutos = (ahora - new Date(s.last_client_message_at).getTime()) / 60000;
    const count   = s.follow_up_count ?? 0;

    const FOLLOWUP_MSGS = getFollowupMsgs(
      s.cliente_id === process.env.ATTEMPO_VENTAS_CLIENT_ID ? 'ventas' : 'negocio',
      s.canal_user_name
    );

    let mensaje    = null;
    let usaHorario = true;

    if (minutos >= 1440 && count === 3) {
      if (!s.lead_calificado) {
        await fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?id=eq.${s.id}`, {
          method: 'PATCH',
          headers: { ...shJson, Prefer: 'return=minimal' },
          body: JSON.stringify({ conversation_status: 'cerrada' })
        }).catch(() => {});
        enviadas.push({ id: s.id, accion: 'cerrada_sin_calificar' });
      }
      // TODO: enviar template Meta aprobado para leads calificados
      continue;
    } else if (minutos >= 1200 && count === 2) {
      mensaje    = FOLLOWUP_MSGS[2];
      usaHorario = false;
    } else if (minutos >= 120 && count === 1) {
      mensaje = FOLLOWUP_MSGS[1];
    } else if (minutos >= 15 && count === 0) {
      mensaje = FOLLOWUP_MSGS[0];
    }

    if (!mensaje) continue;
    if (usaHorario && !dentroHorarioComercialStgo()) continue;

    const clienteR = await fetch(
      `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${s.cliente_id}&select=canales_meta&limit=1`,
      { headers: sh }
    );
    const [cliente] = await clienteR.json().catch(() => []);
    const waPhoneId = cliente?.canales_meta?.wa_phone_number_id;
    const waToken   = cliente?.canales_meta?.wa_token;
    if (!waPhoneId || !waToken) continue;

    const sendR = await fetch(`https://graph.facebook.com/v20.0/${waPhoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${waToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to:   s.canal_user_id,
        type: 'text',
        text: { body: mensaje }
      })
    });

    if (sendR.ok) {
      await fetch(`${SUPABASE_URL}/rest/v1/chat_sessions?id=eq.${s.id}`, {
        method: 'PATCH',
        headers: { ...shJson, Prefer: 'return=minimal' },
        body: JSON.stringify({ follow_up_count: count + 1 })
      }).catch(() => {});
      enviadas.push({ id: s.id, accion: `follow_up_${count + 1}`, numero: s.canal_user_id });
    } else {
      enviadas.push({ id: s.id, accion: 'error_envio', status: sendR.status });
    }
  }

  return { procesadas: sesiones.length, enviadas };
}

// ── Lógica de envío de recordatorios ─────────────────────────────────────────
// Corre cada hora: calcula dinámicamente qué citas entran en la ventana de cada recordatorio.
// Ejemplo: si son las 14:00 y el recordatorio es "2h antes", busca citas de las 16:xx de hoy.
const REC_LIMITE_PLAN = { inicio: 300, pro: 1000, clinica_ia: 3000 };

async function procesarRecordatorios(sh, shJson, soloClienteId = null) {
  const resend_key = process.env.RESEND_API_KEY;
  if (!resend_key) return { enviados: 0, errores: ['Sin RESEND_API_KEY'] };

  const ahoraMs = Date.now();
  const minutosAnticipacion = { '30m': 30, '1h': 60, '2h': 120, '12h': 720, '24h': 1440 };

  // Extrae la hora (0-23) de un timestamp en zona Santiago
  function horaStgo(ms) {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit', hour12: false, timeZone: 'America/Santiago'
    }).formatToParts(new Date(ms));
    const h = parts.find(p => p.type === 'hour')?.value || '00';
    return h === '24' ? '00' : h.padStart(2, '0');
  }

  let enviados = 0;
  const errores = [];

  try {
    const filtroIdParam = soloClienteId ? `&id=eq.${soloClienteId}` : '';
    const rCli = await fetch(
      `${SUPABASE_URL}/rest/v1/clientes_sistema?select=id,nombre_negocio,direccion,recordatorios_config,canales_meta,tipo_plan,rec_mes_count,rec_mes_key,rec_mes_limit_extra,rec_limite_extra_mensual${filtroIdParam}`,
      { headers: sh }
    );
    const clientes = await rCli.json();
    if (!Array.isArray(clientes)) return { enviados, errores: ['Error cargando clientes'] };

    const mesActual = new Date().toISOString().slice(0, 7);

    for (const cli of clientes) {
      const cfg = cli.recordatorios_config || {};

      // Verificar y/o resetear contador mensual
      let recCount = cli.rec_mes_count || 0;
      let recLimitExtra = cli.rec_mes_limit_extra || 0;
      if (cli.rec_mes_key !== mesActual) {
        recCount = 0; recLimitExtra = 0;
        fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cli.id}`, {
          method: 'PATCH', headers: { ...shJson, Prefer: 'return=minimal' },
          body: JSON.stringify({ rec_mes_count: 0, rec_mes_key: mesActual, rec_mes_limit_extra: 0 })
        }).catch(() => {});
      }
      const recLimite = (REC_LIMITE_PLAN[cli.tipo_plan] || 300) + recLimitExtra + (cli.rec_limite_extra_mensual || 0);
      let recCountInicio = recCount;

      // Compatibilidad formato antiguo
      const lista = Array.isArray(cfg.lista) ? cfg.lista
        : (cfg.email_activo ? [{ id: 'rec_legacy_0', activo: true, tiempo: cfg.email_tiempo || '24h',
            email_activo: true, email_asunto: cfg.email_asunto || '', email_mensaje: cfg.email_mensaje || '',
            wa_activo: false, wa_mensaje: '' }] : []);

      const activos = lista.filter(r => r.activo && (r.email_activo || r.wa_activo));
      if (!activos.length) continue;

      for (const rec of activos) {
        const anteMin  = minutosAnticipacion[rec.tiempo] || 60;
        const targetMs = ahoraMs + anteMin * 60 * 1000;
        const targetDate = new Date(targetMs);

        // Fecha e hora objetivo en Santiago
        const targetFechaISO = targetDate.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
        const targetHora     = horaStgo(targetMs);
        const horaDesde      = `${targetHora}:00`;
        const horaHasta      = `${targetHora}:59`;

        try {
          const url = `${SUPABASE_URL}/rest/v1/citas?cliente_id=eq.${cli.id}&fecha=eq.${targetFechaISO}&estado=neq.canceled&hora=gte.${horaDesde}&hora=lte.${horaHasta}&select=id,nombre_paciente,email_paciente,telefono_paciente,hora,servicio,fecha,rec_enviados,email_rec_enviado,especialistas(nombre)`;

          const rCitas = await fetch(url, { headers: sh });
          const citas  = await rCitas.json();
          if (!Array.isArray(citas) || !citas.length) continue;

          for (const cita of citas) {
            if (!cita.email_paciente) continue;

            // No reenviar si ya se marcó como enviado
            const recEnv    = cita.rec_enviados || {};
            const legacyEnv = rec.id === 'rec_legacy_0' && cita.email_rec_enviado === true;
            if (recEnv[rec.id] || legacyEnv) continue;

            const fechaFmt     = new Date(cita.fecha + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
            const horaFmt      = cita.hora?.slice(0, 5) || '';
            const profNombre   = cita.especialistas?.nombre || '';
            const negocioNombre = cli.nombre_negocio || 'tu negocio';
            const vars = { nombre: cita.nombre_paciente || 'Estimado/a', fecha: fechaFmt, hora: horaFmt, profesional: profNombre, servicio: cita.servicio || '', negocio: negocioNombre, direccion: cli.direccion || '' };

            let enviado = false;

            // — Enviar Email —
            if (rec.email_activo && recCount < recLimite) {
              const asunto       = renderTemplate(rec.email_asunto || 'Recordatorio: tu cita en {negocio}', vars);
              const mensajeExtra = renderTemplate(rec.email_mensaje || '', vars);
              const emailRes = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { Authorization: `Bearer ${resend_key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  from: `${negocioNombre} vía Attempo <contacto@attempo.cl>`,
                  to: [cita.email_paciente],
                  subject: asunto,
                  headers: { 'List-Unsubscribe': '<mailto:contacto@attempo.cl?subject=unsubscribe>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
                  html: emailRecordatorioHtml({ nombre: vars.nombre, fecha: fechaFmt, hora: horaFmt, profesional: profNombre, servicio: vars.servicio, negocio: negocioNombre, direccion: cli.direccion || '', intro: renderTemplate(rec.email_intro || '', vars), mensaje_extra: mensajeExtra, cita_id: cita.id })
                })
              });
              if (emailRes.ok) { enviados++; enviado = true; recCount++; }
              else { const errTxt = await emailRes.text().catch(() => ''); console.error('recordatorio email error', emailRes.status, errTxt); errores.push(`cita ${cita.id}: ${emailRes.status}`); }
            } else if (rec.email_activo && recCount >= recLimite) {
              console.log(`Cliente ${cli.id}: límite recordatorios alcanzado (${recCount}/${recLimite}), omitiendo email cita ${cita.id}`);
            }

            // — Enviar WhatsApp —
            if (rec.wa_activo && cita.telefono_paciente && recCount < recLimite) {
              const waPhoneId = cli.canales_meta?.wa_phone_number_id;
              const waToken   = cli.canales_meta?.wa_token;
              if (waPhoneId && waToken) {
                const phone  = cita.telefono_paciente.replace(/\D/g, '');
                const waBody = renderTemplate(
                  rec.wa_mensaje || 'Hola {nombre}, te recordamos tu cita el {fecha} a las {hora} en {negocio}.',
                  vars
                );
                const waRes = await fetch(`https://graph.facebook.com/v20.0/${waPhoneId}/messages`, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${waToken}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    to:   phone,
                    type: 'text',
                    text: { body: waBody }
                  })
                });
                if (waRes.ok) { enviados++; enviado = true; recCount++; }
                else {
                  const errTxt = await waRes.text().catch(() => '');
                  console.error('recordatorio wa error', waRes.status, errTxt);
                  errores.push(`cita ${cita.id} wa: ${waRes.status}`);
                }
              }
            } else if (rec.wa_activo && recCount >= recLimite) {
              console.log(`Cliente ${cli.id}: límite recordatorios alcanzado (${recCount}/${recLimite}), omitiendo WA cita ${cita.id}`);
            }

            // — Marcar como enviado para no reenviar —
            if (enviado) {
              const patch = { rec_enviados: { ...recEnv, [rec.id]: true } };
              if (rec.id === 'rec_legacy_0') patch.email_rec_enviado = true;
              fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${cita.id}`, {
                method: 'PATCH', headers: { ...shJson, Prefer: 'return=minimal' }, body: JSON.stringify(patch)
              }).catch(e => console.error('error marcando rec enviado:', e.message));
            }
          }
        } catch(e) {
          console.error(`error procesando cliente ${cli.id} rec ${rec.id}:`, e.message);
          errores.push(`cliente ${cli.id}: ${e.message}`);
        }
      }

      // Actualizar contador mensual si hubo envíos
      if (recCount !== recCountInicio) {
        fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cli.id}`, {
          method: 'PATCH', headers: { ...shJson, Prefer: 'return=minimal' },
          body: JSON.stringify({ rec_mes_count: recCount, rec_mes_key: mesActual })
        }).catch(() => {});
      }
    }
  } catch(e) {
    console.error('send-email: error general en procesarRecordatorios:', e.message);
    errores.push(e.message);
  }

  return { enviados, errores };
}

// ── Email de aviso 2 días antes de que expire el trial demo ──────────────────
async function procesarTrialReminder(sh, shJson) {
  const enviados = [];
  try {
    const en2dias = new Date();
    en2dias.setDate(en2dias.getDate() + 2);
    const fecha2d = en2dias.toISOString().split('T')[0];

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/clientes_sistema?plan=eq.demo&fecha_expiracion=eq.${fecha2d}&activo=eq.true&select=id,email,contacto_nombre`,
      { headers: sh }
    );
    const clientes = await r.json();
    if (!Array.isArray(clientes) || !clientes.length) return { enviados };

    for (const cli of clientes) {
      if (!cli.email) continue;
      const nombre = cli.contacto_nombre ? cli.contacto_nombre.split(' ')[0] : 'Usuario';
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'attempo <contacto@attempo.cl>',
            to: [cli.email],
            subject: `${nombre}, tu prueba de attempo vence en 2 días`,
            html: `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:40px 20px">
<tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10)">
<tr><td style="background:#6C5CE4;padding:28px 32px;text-align:center">
  <img src="https://app.attempo.cl/logo_attempo.png" alt="attempo" height="36" style="display:block;margin:0 auto 8px">
  <p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px">Todo a tu tiempo</p>
</td></tr>
<tr><td style="padding:32px;text-align:center">
  <h2 style="margin:0 0 12px;color:#2d2d2d;font-size:22px">¡Hola, ${he(nombre)}! ⏱</h2>
  <p style="margin:0 0 20px;color:#6b7280;font-size:15px;line-height:1.6">
    Tu período de prueba gratuita de attempo <strong style="color:#DC2626">vence en 2 días</strong>.<br>
    Contrata un plan ahora para seguir gestionando tus citas sin interrupciones.
  </p>
  <a href="https://wa.me/56957285407?text=Hola%2C%20quiero%20contratar%20un%20plan%20de%20attempo" style="display:inline-block;padding:14px 32px;background:#25D366;color:#fff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:600;margin-bottom:10px">Contratar por WhatsApp →</a>
  <br>
  <a href="mailto:hola@attempo.cl" style="display:inline-block;padding:11px 28px;background:#6C5CE4;color:#fff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600">Escribir a hola@attempo.cl →</a>
  <p style="margin:20px 0 0;color:#9ca3af;font-size:12px">Si ya coordinaste tu plan, ignora este mensaje.</p>
</td></tr>
<tr><td style="background:#f9f8ff;padding:16px 32px;text-align:center;border-top:1px solid #ede9fe">
  <p style="margin:0;color:#9ca3af;font-size:12px">attempo — Todo a tu tiempo</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`
          })
        });
        enviados.push(cli.email);
      } catch(e) {
        console.error('trial_reminder email error:', cli.email, e.message);
      }
    }
  } catch(e) {
    console.error('procesarTrialReminder error:', e.message);
  }
  return { enviados };
}

// ── Email de solicitud de evaluación post-cita ────────────────────────────────
const BASE_URL_EVAL = (process.env.BASE_URL || 'https://app.attempo.cl').trim().replace(/\/$/, '');

function emailEvaluacionHtml({ nombre, profesional, negocio, evalUrl }) {
  const estrellas = [1,2,3,4,5].map(n => {
    const labels = ['Pésima','Mala','Aceptable','Buena','Genial'];
    return `<a href="${he(evalUrl)}" style="text-decoration:none;display:inline-block;margin:0 6px;text-align:center">
      <div style="font-size:32px;line-height:1">⭐</div>
      <div style="font-size:10px;color:#6b7280;margin-top:3px">${labels[n-1]}</div>
    </a>`;
  }).join('');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);">
<tr><td style="background:#6C5CE4;padding:28px 24px;text-align:center;">
  <img src="${BASE_URL_EVAL}/logo_attempo.png" alt="attempo" height="36" style="display:block;margin:0 auto 8px;">
  <p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;">Todo a tu tiempo</p>
</td></tr>
<tr><td style="padding:32px 24px;text-align:center;">
  <h2 style="margin:0 0 8px;color:#2d2d2d;font-size:20px;">¿Cómo fue tu atención?</h2>
  <p style="margin:0 0 6px;color:#6b7280;font-size:14px;">Hola <strong>${he(nombre)}</strong>, esperamos que tu consulta con <strong>${he(profesional)}</strong> haya sido excelente.</p>
  <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Tu opinión ayuda a mejorar el servicio. Solo toma un minuto.</p>
  <div style="margin:0 0 24px">${estrellas}</div>
  <a href="${he(evalUrl)}" style="display:inline-block;padding:13px 32px;background:#6C5CE4;color:#fff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:700;">Dejar evaluación →</a>
  <p style="margin:20px 0 0;color:#9ca3af;font-size:12px;">Solo pacientes con citas realizadas pueden evaluar al profesional.</p>
</td></tr>
<tr><td style="background:#f9f8ff;padding:16px 24px;text-align:center;border-top:1px solid #ede9fe;">
  <p style="margin:0;color:#9ca3af;font-size:12px;">Enviado por <strong>${he(negocio)}</strong> a través de <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none;">attempo</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

async function procesarEvaluaciones(sh, shJson) {
  const resend_key = process.env.RESEND_API_KEY;
  if (!resend_key) return { enviados: 0, errores: ['Sin RESEND_API_KEY'] };

  let enviados = 0;
  const errores = [];

  try {
    // Buscar citas que terminaron hace entre 1h y 48h, no canceladas, con email y sin eval enviada
    const ahora = new Date();
    const hace1h  = new Date(ahora.getTime() - 60 * 60 * 1000);
    const hace48h = new Date(ahora.getTime() - 48 * 60 * 60 * 1000);

    // Convertir a fecha+hora en Santiago para comparar
    const toStgo = ms => new Date(ms).toLocaleString('en-CA', { timeZone: 'America/Santiago', hour12: false }).replace(', ', 'T');
    const desde = toStgo(hace48h.getTime()).slice(0, 16); // yyyy-MM-ddTHH:mm
    const hasta = toStgo(hace1h.getTime()).slice(0, 16);

    // Extraer fecha y hora por separado para filtrar en Supabase
    // Filtramos solo por fecha para mantener la query simple; la lógica de hora se valida localmente
    const fechaDesde = desde.slice(0, 10);
    const fechaHasta = hasta.slice(0, 10);

    const rCitas = await fetch(
      `${SUPABASE_URL}/rest/v1/citas?estado=neq.canceled&email_paciente=not.is.null&eval_enviado=not.is.true` +
      `&fecha=gte.${fechaDesde}&fecha=lte.${fechaHasta}` +
      `&select=id,nombre_paciente,email_paciente,fecha,hora,cliente_id,especialista_id,especialistas(nombre),clientes_sistema(nombre_negocio,eval_activo)` +
      `&limit=500`,
      { headers: sh }
    );
    const citas = await rCitas.json();
    if (!Array.isArray(citas)) return { enviados, errores: ['Error al obtener citas'] };

    const ahoraStgo = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }));

    for (const cita of citas) {
      // Solo clientes con evaluaciones habilitadas
      if (cita.clientes_sistema?.eval_activo === false) continue;

      // Verificar que la cita ya terminó (fecha+hora en Santiago < hace 1h)
      const [y, m, d] = (cita.fecha || '').split('-');
      const [hh, mm] = (cita.hora || '00:00').split(':');
      const citaMs = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm)).getTime();
      const citaDate = new Date(citaMs + new Date().getTimezoneOffset() * 60000); // aproximado
      // Usamos el timestamp UTC equivalente a la hora local de Santiago
      const citaStgo = new Date(new Date(cita.fecha + 'T' + (cita.hora || '00:00') + ':00').toLocaleString('en-US', { timeZone: 'America/Santiago' }));

      // Omitir si la cita es de hoy pero su hora aún no pasó hace 1h
      const diffMin = (ahoraStgo - citaStgo) / 60000;
      if (diffMin < 60) continue;

      const negocio   = cita.clientes_sistema?.nombre_negocio || 'tu negocio';
      const profesional = cita.especialistas?.nombre || 'el profesional';
      const token     = crypto.randomUUID();

      // Crear registro de evaluación en Supabase
      const rInsert = await fetch(`${SUPABASE_URL}/rest/v1/evaluaciones`, {
        method: 'POST',
        headers: { ...shJson, Prefer: 'return=minimal' },
        body: JSON.stringify({
          cliente_id:     cita.cliente_id,
          cita_id:        cita.id,
          especialista_id: cita.especialista_id || null,
          paciente_nombre: cita.nombre_paciente || '',
          token,
          usado: false
        })
      });
      if (!rInsert.ok) {
        const err = await rInsert.text().catch(() => '');
        // Si ya existe (token duplicado u otro conflicto), no bloqueamos
        errores.push(`cita ${cita.id} insert: ${err.slice(0, 80)}`);
        continue;
      }

      const evalUrl = `${BASE_URL_EVAL}/evaluar?token=${token}`;

      // Enviar email
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resend_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${negocio} vía Attempo <contacto@attempo.cl>`,
          to: [cita.email_paciente],
          subject: `¿Cómo fue tu consulta con ${profesional}? Deja tu evaluación`,
          headers: { 'List-Unsubscribe': '<mailto:contacto@attempo.cl?subject=unsubscribe>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
          html: emailEvaluacionHtml({ nombre: cita.nombre_paciente || 'Estimado/a', profesional, negocio, evalUrl })
        })
      });

      if (emailRes.ok) {
        enviados++;
        // Marcar cita para no reenviar
        fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${cita.id}`, {
          method: 'PATCH',
          headers: { ...shJson, Prefer: 'return=minimal' },
          body: JSON.stringify({ eval_enviado: true })
        }).catch(() => {});
      } else {
        const errTxt = await emailRes.text().catch(() => '');
        console.error('evaluacion email error:', emailRes.status, errTxt);
        errores.push(`cita ${cita.id} email: ${emailRes.status}`);
        // Borrar el registro de evaluación si el email falló
        fetch(`${SUPABASE_URL}/rest/v1/evaluaciones?token=eq.${token}`, {
          method: 'DELETE', headers: sh
        }).catch(() => {});
      }
    }
  } catch(e) {
    console.error('procesarEvaluaciones error:', e.message);
    errores.push(e.message);
  }

  return { enviados, errores };
}

// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const sh    = { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` };
  const shJson = { ...sh, 'Content-Type': 'application/json' };

  // ── GET: cron automático (Vercel cron o servicio externo) ───────────────
  if (req.method === 'GET') {
    const auth        = req.headers['authorization'] || '';
    const cronSecret  = process.env.CRON_SECRET;
    const internalKey = process.env.INTERNAL_API_SECRET;
    const validVercel   = cronSecret  && auth === `Bearer ${cronSecret}`;
    const validExternal = internalKey && auth === `Bearer ${internalKey}`;
    if (!validVercel && !validExternal) {
      return res.status(401).json({ error: 'No autorizado' });
    }
    if (req.query?.action === 'reactivacion') {
      console.log('send-email: cron reactivacion iniciado');
      const result = await procesarReactivacion(sh, shJson);
      console.log('send-email: reactivacion finalizada —', result.enviadas?.length ?? 0, 'enviadas');
      return res.status(200).json(result);
    }

    console.log('send-email: cron recordatorios iniciado');
    const result = await procesarRecordatorios(sh, shJson);
    console.log('send-email: cron finalizado —', result.enviados, 'enviados,', result.errores.length, 'errores');
    const trialResult = await procesarTrialReminder(sh, shJson);
    if (trialResult.enviados.length) console.log('send-email: trial reminders —', trialResult.enviados.length, 'enviados');
    const evalResult = await procesarEvaluaciones(sh, shJson);
    if (evalResult.enviados) console.log('send-email: evaluaciones —', evalResult.enviados, 'enviadas');

    // Reset mensual de cuota WA si cambió el mes
    try {
      const rWa = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reset_wa_si_mes_cambio`, {
        method: 'POST',
        headers: shJson,
        body: JSON.stringify({})
      });
      const waResetCount = await rWa.json();
      if (waResetCount > 0) console.log('send-email: reset WA mensajes para', waResetCount, 'clientes');
    } catch(e) {
      console.error('send-email: error reset WA mensual:', e.message);
    }

    return res.status(200).json({ ...result, trial_reminders: trialResult.enviados, evaluaciones: evalResult.enviados });
  }

  if (req.method !== 'POST') return res.status(405).end();

  // ── POST: requiere sesión válida ─────────────────────────────────────────
  if (!verifySessionToken(req.headers['x-session-token'])) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  if (!process.env.RESEND_API_KEY) return res.status(500).json({ error: 'Sin clave de email' });

  const body = req.body || {};

  // — Enviar recordatorios manualmente —
  if (body.type === 'enviar_recordatorios') {
    const session = verifySessionToken(req.headers['x-session-token']);
    // Si no hay sesión o es superadmin, corre para todos; si no, solo su cliente
    const filtroCliente = (!session || session.rol === 'superadmin') ? null : session.cliente_id;
    const result = await procesarRecordatorios(sh, shJson, filtroCliente);
    return res.status(200).json(result);
  }

  // — Email de prueba —
  if (body.type === 'email_prueba') {
    const cid = resolveClienteId(req, null);
    if (!cid) return res.status(401).json({ error: 'No autorizado' });

    const rCli = await fetch(
      `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cid}&select=email,nombre_negocio,direccion&limit=1`,
      { headers: sh }
    );
    const [cli] = await rCli.json().catch(() => []);

    const destEmail = (body.to || '').trim() || cli?.email;
    if (!destEmail) return res.status(400).json({ error: 'Ingresa un email destino o configura el email del negocio en Configuración → General.' });

    const vars = {
      nombre:      'Cliente de prueba',
      fecha:       new Date().toLocaleDateString('es-CL', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'America/Santiago' }),
      hora:        '15:00',
      profesional: (body.profesional || '').trim() || 'Dr. Ejemplo',
      servicio:    (body.servicio    || '').trim() || 'Consulta',
      negocio:     cli?.nombre_negocio || 'Tu negocio',
      direccion:   cli?.direccion || ''
    };
    const asuntoFinal  = renderTemplate(body.asunto  || 'Recordatorio: tu cita en {negocio}', vars);
    const mensajeFinal = renderTemplate(body.mensaje || '', vars);
    const introFinal = renderTemplate(body.intro || '', vars);
    const htmlBody = emailRecordatorioHtml({ ...vars, intro: introFinal, mensaje_extra: mensajeFinal, direccion: vars.direccion, cita_id: null });

    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Attempo <contacto@attempo.cl>',
          to: [destEmail],
          subject: `[Prueba] ${asuntoFinal}`,
          html: htmlBody
        })
      });
      if (!r.ok) { const err = await r.text(); console.error('email_prueba error:', err); return res.status(500).json({ error: 'Error al enviar' }); }
      return res.status(200).json({ ok: true });
    } catch(e) {
      console.error('email_prueba exception:', e.message);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  // — WhatsApp de prueba —
  if (body.type === 'wa_prueba') {
    const phone = (body.phone || '').replace(/\D/g, '');
    if (!phone) return res.status(400).json({ error: 'Ingresa un número de teléfono' });

    const cid = resolveClienteId(req, null);
    if (!cid) return res.status(401).json({ error: 'No autorizado' });

    const rCli = await fetch(
      `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cid}&select=nombre_negocio,canales_meta&limit=1`,
      { headers: sh }
    );
    const [cli] = await rCli.json().catch(() => []);
    const waPhoneId = cli?.canales_meta?.wa_phone_number_id;
    const waToken   = cli?.canales_meta?.wa_token;
    if (!waPhoneId || !waToken) return res.status(400).json({ error: 'No hay credenciales de WhatsApp configuradas para este negocio' });

    const negocio = cli.nombre_negocio || 'Tu negocio';
    const fechaHoy = new Date().toLocaleDateString('es-CL', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'America/Santiago' });
    const vars = { nombre: 'Cliente de prueba', fecha: fechaHoy, hora: '15:00', negocio };
    const waBody = `[Prueba] ${renderTemplate(body.mensaje || 'Hola {nombre}, te recordamos tu cita el {fecha} a las {hora} en {negocio}.', vars)}`;

    try {
      const waRes = await fetch(`https://graph.facebook.com/v20.0/${waPhoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${waToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: waBody } })
      });
      if (!waRes.ok) { const err = await waRes.text(); console.error('wa_prueba error:', err); return res.status(500).json({ error: 'Error al enviar WhatsApp' }); }
      return res.status(200).json({ ok: true });
    } catch(e) {
      console.error('wa_prueba exception:', e.message);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  // — Email de prueba campaña —
  if (body.type === 'promo_email_prueba') {
    const toEmail = (body.to || '').trim();
    if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      return res.status(400).json({ error: 'Ingresa un email válido para la prueba' });
    }
    const cid = resolveClienteId(req, null);
    if (!cid) return res.status(401).json({ error: 'No autorizado' });
    const rCli = await fetch(
      `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cid}&select=nombre_negocio&limit=1`,
      { headers: sh }
    );
    const [cli] = await rCli.json().catch(() => []);
    const htmlPromo = emailPromoHtml({
      nombre:          'Cliente de prueba',
      titulo:          body.titulo        || '',
      mensaje:         body.mensaje       || 'Este es un mensaje de ejemplo de tu campaña.',
      ctaTxt:          body.cta_texto     || '',
      ctaUrl:          body.cta_url       || '',
      negocio:         cli?.nombre_negocio || 'Tu negocio',
      headerVisible:   body.header_visible !== false,
      headerColor:     body.header_color  || '#6C5CE4',
      headerSubtitle:  body.header_sub    ?? '',
      bannerUrl:       body.banner_url    || ''
    });
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Attempo <contacto@attempo.cl>',
          to: [toEmail],
          subject: `[Prueba] ${body.asunto || 'Campaña de prueba'}`,
          html: htmlPromo
        })
      });
      if (!r.ok) { const err = await r.text(); console.error('promo_prueba error:', err); return res.status(500).json({ error: 'Error al enviar' }); }
      return res.status(200).json({ ok: true, to: toEmail });
    } catch(e) { return res.status(500).json({ error: 'Error interno' }); }
  }

  // — Lista de pacientes con email para selector —
  if (body.type === 'promo_lista_pacientes') {
    const cid = resolveClienteId(req, null);
    if (!cid) return res.status(401).json({ error: 'No autorizado' });
    const rCitas = await fetch(
      `${SUPABASE_URL}/rest/v1/citas?cliente_id=eq.${cid}&email_paciente=not.is.null&select=email_paciente,nombre_paciente&limit=2000`,
      { headers: sh }
    );
    const citas = await rCitas.json().catch(() => []);
    const seen = new Set();
    const pacientes = [];
    for (const c of Array.isArray(citas) ? citas : []) {
      const email = (c.email_paciente || '').trim().toLowerCase();
      if (email && !seen.has(email)) {
        seen.add(email);
        pacientes.push({ email: c.email_paciente.trim(), nombre: c.nombre_paciente || '' });
      }
    }
    pacientes.sort((a, b) => (a.nombre || a.email).localeCompare(b.nombre || b.email, 'es'));
    return res.status(200).json({ pacientes });
  }

  // — Enviar campaña a pacientes —
  if (body.type === 'promo_email') {
    if (!body.asunto || !body.mensaje) return res.status(400).json({ error: 'Faltan asunto y mensaje' });
    const cid = resolveClienteId(req, null);
    if (!cid) return res.status(401).json({ error: 'No autorizado' });
    const rCli = await fetch(
      `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cid}&select=nombre_negocio&limit=1`,
      { headers: sh }
    );
    const [cli] = await rCli.json().catch(() => []);
    const negocio = cli?.nombre_negocio || 'Tu negocio';

    let destinatarios = [];
    // Si viene lista específica del frontend, usarla directamente
    if (Array.isArray(body.emails) && body.emails.length > 0) {
      destinatarios = body.emails.filter(e => e?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email));
    } else {
      const filtroUrl = _buildPromoFiltroUrl(body.filtro, body.periodo);
      const rCitas = await fetch(
        `${SUPABASE_URL}/rest/v1/citas?cliente_id=eq.${cid}&email_paciente=not.is.null${filtroUrl}&select=email_paciente,nombre_paciente&limit=2000`,
        { headers: sh }
      );
      const citas = await rCitas.json().catch(() => []);
      if (!Array.isArray(citas)) return res.status(500).json({ error: 'Error al obtener pacientes' });
      const seen = new Set();
      for (const c of citas) {
        const email = (c.email_paciente || '').trim().toLowerCase();
        if (email && !seen.has(email)) { seen.add(email); destinatarios.push({ email: c.email_paciente.trim(), nombre: c.nombre_paciente || '' }); }
      }
    }
    if (!destinatarios.length) return res.status(400).json({ error: 'No hay destinatarios seleccionados' });
    let enviados = 0;
    const errores = [];
    for (const d of destinatarios) {
      const nombre = d.nombre || 'Estimado/a';
      const htmlPromo = emailPromoHtml({
        nombre,
        titulo:         body.titulo        || '',
        mensaje:        (body.mensaje || '').replace(/\{nombre\}/g, nombre),
        ctaTxt:         body.cta_texto     || '',
        ctaUrl:         body.cta_url       || '',
        negocio,
        headerVisible:  body.header_visible !== false,
        headerColor:    body.header_color  || '#6C5CE4',
        headerSubtitle: body.header_sub    ?? '',
        bannerUrl:      body.banner_url    || ''
      });
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: `${negocio} vía Attempo <contacto@attempo.cl>`,
            to: [d.email],
            subject: body.asunto,
            headers: { 'List-Unsubscribe': '<mailto:contacto@attempo.cl?subject=unsubscribe>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
            html: htmlPromo
          })
        });
        if (r.ok) enviados++;
        else { const err = await r.text().catch(()=>''); errores.push(`${d.email}: ${err.slice(0,80)}`); }
      } catch(e) { errores.push(`${d.email}: ${e.message}`); }
    }
    return res.status(200).json({ ok: true, enviados, total: destinatarios.length, errores });
  }

  // — Obtener conteo de destinatarios para campaña —
  // — Subir imagen banner a Supabase Storage —
  if (body.type === 'upload_banner') {
    const { data: b64, mime, filename } = body;
    if (!b64 || !mime || !filename) return res.status(400).json({ error: 'Faltan datos' });
    if (!/^image\/(jpeg|jpg|png|webp|gif)$/i.test(mime)) return res.status(400).json({ error: 'Solo se permiten imágenes JPG, PNG, WEBP o GIF' });
    const ext = mime.split('/')[1].replace('jpeg','jpg');
    const safeName = `banner_${Date.now()}.${ext}`;
    let buf;
    try { buf = Buffer.from(b64, 'base64'); } catch(_) { return res.status(400).json({ error: 'Imagen inválida' }); }
    if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'La imagen no puede superar 5 MB' });
    const KEY = process.env.SUPABASE_SERVICE_KEY;
    const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/promo-banners/${safeName}`, {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': mime,
        'x-upsert': 'true'
      },
      body: buf
    });
    if (!upRes.ok) {
      const err = await upRes.text();
      console.error('upload_banner storage error:', upRes.status, err);
      return res.status(500).json({ error: 'Error al subir imagen. Asegúrate de que el bucket promo-banners existe y es público.' });
    }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/promo-banners/${safeName}`;
    return res.status(200).json({ url: publicUrl });
  }

  if (body.type === 'promo_conteo') {
    const cid = resolveClienteId(req, null);
    if (!cid) return res.status(401).json({ error: 'No autorizado' });
    const filtroUrl = _buildPromoFiltroUrl(body.filtro, body.periodo);
    const rCitas = await fetch(
      `${SUPABASE_URL}/rest/v1/citas?cliente_id=eq.${cid}&email_paciente=not.is.null${filtroUrl}&select=email_paciente&limit=2000`,
      { headers: sh }
    );
    const citas = await rCitas.json().catch(() => []);
    const seen = new Set();
    if (Array.isArray(citas)) citas.forEach(c => { const e = (c.email_paciente||'').trim().toLowerCase(); if(e) seen.add(e); });
    return res.status(200).json({ total: seen.size });
  }

  // — Boleta electrónica DTE vía DTemite —
  if (body.type === 'boleta-dte') {
    const { to, cliente_nombre, cliente_rut, negocio, negocio_rut, negocio_giro, negocio_dir, folio, total, tipo, fecha, items } = body;
    if (!to) return res.status(400).json({ error: 'Falta email destino' });

    const cid = resolveClienteId(req, null);
    if (!cid) return res.status(401).json({ error: 'No autorizado' });

    const rCli = await fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cid}&select=metodos_pago&limit=1`, { headers: sh });
    const [cliDte] = await rCli.json().catch(() => []);
    const mp = cliDte?.metodos_pago || {};

    const dtemiteSistema = mp.dtemite_sistema || '';
    const dtemiteUsuario = mp.dtemite_usuario || '';
    const dtemiteClave   = mp.dtemite_clave   || '';

    if (!dtemiteUsuario || !dtemiteClave) {
      return res.status(400).json({ error: 'No hay credenciales DTemite. Configúralas en Configuración → Facturación.' });
    }

    let dteUrl = null;
    const fechaDTE = fecha || new Date().toISOString().slice(0, 10);

    try {
      if (tipo === 'honorarios') {
        // BHE tipo 61 — persona natural
        const loginR = await fetch('https://pro.dtemite.cl/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usuario: dtemiteUsuario, clave: dtemiteClave })
        });
        if (!loginR.ok) {
          const err = await loginR.text().catch(() => '');
          console.error('dtemite bhe login error:', loginR.status, err.slice(0, 200));
          return res.status(502).json({ error: 'DTemite: error de autenticación — verifica usuario y contraseña' });
        }
        const { token: bheToken } = await loginR.json();
        const montobruto = Math.round(Number(total || 0));
        const retencion  = Math.round(montobruto * 0.10);
        const glosa = (items || []).map(it => it.desc).filter(Boolean).join(', ') || 'Servicios profesionales';
        const emitR = await fetch('https://pro.dtemite.cl/api/librohonorarios/emision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bheToken}` },
          body: JSON.stringify({
            fecha:           fechaDTE,
            rut_receptor:    (cliente_rut || '66666666-6').replace(/\./g, ''),
            nombre_receptor: cliente_nombre || 'Consumidor Final',
            monto_bruto:     montobruto,
            monto_retencion: retencion,
            monto_liquido:   montobruto - retencion,
            glosa
          })
        });
        if (!emitR.ok) {
          const err = await emitR.text().catch(() => '');
          console.error('dtemite bhe emit error:', emitR.status, err.slice(0, 200));
          return res.status(502).json({ error: 'DTemite: error al emitir BHE — ' + err.slice(0, 100) });
        }
        const emitData = await emitR.json();
        dteUrl = emitData.ruta_pdf || emitData.url_pdf || null;

      } else {
        // Boleta Electrónica tipo 39 — empresa
        const claveB64 = Buffer.from(dtemiteClave).toString('base64');
        const rutLimpio = (negocio_rut || '').replace(/\./g, '');
        const detalle = (items || []).map(it => ({
          NmbItem:   it.desc || 'Servicio',
          QtyItem:   it.qty || 1,
          PrcItem:   Math.round(Number(it.precio || 0)),
          MontoItem: Math.round((it.qty || 1) * Number(it.precio || 0))
        }));
        if (!detalle.length) detalle.push({ NmbItem: 'Servicio', QtyItem: 1, PrcItem: Math.round(Number(total || 0)), MontoItem: Math.round(Number(total || 0)) });

        const dteBody = {
          Sistema: {
            nombre:  dtemiteSistema || dtemiteUsuario,
            rut:     rutLimpio,
            usuario: dtemiteUsuario,
            clave:   claveB64
          },
          Documento: {
            Encabezado: {
              IdDoc: { TipoDTE: '39', FchEmis: fechaDTE, TermPagoCdg: '0' },
              Emisor: {
                RUTEmisor:    rutLimpio,
                RznSocEmisor: (negocio || '').toUpperCase(),
                GiroEmisor:   negocio_giro || 'Servicios',
                DirOrigen:    negocio_dir  || 'Sin dirección',
                CmnaOrigen:   'Santiago',
                CiudadOrigen: 'Santiago'
              },
              Receptor: {
                RUTRecep:    (cliente_rut || '66666666-6').replace(/\./g, ''),
                RznSocRecep: cliente_nombre || 'Consumidor Final',
                DirRecep:    'Sin dirección',
                CmnaRecep:   'Santiago',
                CiudadRecep: 'Santiago'
              }
            },
            Detalle: detalle
          }
        };

        const dteR = await fetch('https://sistema.dtemite.cl/sistema/Backend/WsMaster/ApiIntegracionController.php/Api/Documento', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dteBody)
        });
        if (!dteR.ok) {
          const err = await dteR.text().catch(() => '');
          console.error('dtemite boleta emit error:', dteR.status, err.slice(0, 200));
          return res.status(502).json({ error: 'DTemite: error al emitir boleta — ' + err.slice(0, 100) });
        }
        const dteData = await dteR.json();
        dteUrl = dteData.ruta_pdf || dteData.url_pdf || dteData.pdf_url || null;
      }
    } catch(e) {
      console.error('dtemite exception:', e.message);
      return res.status(502).json({ error: 'Error conectando con DTemite: ' + e.message });
    }

    // Enviar email al cliente
    const fmtCLP = n => '$ ' + Number(n).toLocaleString('es-CL');
    const rawFechaDte = fecha || new Date().toISOString().slice(0, 10);
    const fechaLargaDte = new Date(rawFechaDte + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });
    const tipDocDte = tipo === 'venta' ? 'Boleta Electrónica SII' : 'Boleta de Honorarios Electrónica SII';
    const totalNum = Number(total || 0);
    const pdfBlock = dteUrl
      ? `<div style="text-align:center;margin:20px 0"><a href="${he(dteUrl)}" style="display:inline-block;padding:12px 28px;background:#6C5CE4;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">Descargar ${tipDocDte}</a></div>`
      : `<p style="font-size:13px;color:#6b7280;margin:16px 0;text-align:center">Tu documento fue emitido ante el SII. Recibirás una copia en tu correo registrado en SII.</p>`;

    const emailHtmlDte = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f1fa;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;background:#f4f1fa;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:560px;width:100%;">
<tr><td style="background:#5b21b6;padding:26px 36px;text-align:center;"><div style="color:#fff;font-size:24px;font-weight:900;letter-spacing:-.5px;">attempo</div></td></tr>
<tr><td style="padding:32px 36px;">
<p style="font-size:15px;font-weight:700;margin:0 0 12px;">Hola ${he(cliente_nombre || 'Cliente')},</p>
<p style="font-size:14px;color:#444;margin:0 0 16px;">Te enviamos tu <strong>${he(tipDocDte)}</strong> emitida por <strong>${he(negocio || '')}</strong> el ${he(fechaLargaDte)}.</p>
<p style="font-size:16px;font-weight:700;color:#5b21b6;margin:0 0 4px;">Total: ${he(fmtCLP(totalNum))}</p>
${pdfBlock}
</td></tr>
<tr><td style="padding:16px 36px 24px;text-align:center;font-size:11px;color:#aaa;">attempo.cl — Todo a tu tiempo</td></tr>
</table></td></tr></table>
</body></html>`;

    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'attempo <contacto@attempo.cl>',
          to: [to],
          subject: `Tu ${tipDocDte} de ${negocio || 'tu negocio'}`,
          html: emailHtmlDte
        })
      });
      if (!r.ok) { console.error('boleta-dte email error:', await r.text()); return res.status(500).json({ error: 'DTE emitido pero error al enviar email' }); }
      return res.status(200).json({ ok: true, dte_url: dteUrl });
    } catch(e) {
      console.error('boleta-dte email exception:', e.message);
      return res.status(500).json({ error: 'DTE emitido pero error al enviar email' });
    }
  }

  // — Envío de boleta —
  if (body.type === 'boleta') {
    const { to, cliente_nombre, cliente_rut, negocio, negocio_rut, negocio_giro, negocio_dir, folio, total, tipo, fecha, items } = body;
    if (!to || !folio) return res.status(400).json({ error: 'Faltan datos' });

    const fmt = n => '$ ' + Number(n).toLocaleString('es-CL');
    const rawFecha = fecha || new Date().toISOString().slice(0,10);
    const fechaLarga = new Date(rawFecha + 'T12:00:00').toLocaleDateString('es-CL', { day:'2-digit', month:'long', year:'numeric' });
    const tipDoc = tipo === 'venta' ? 'Boleta Electrónica' : 'Boleta de Honorarios';
    const totalNum = Number(total || 0);

    // ── Generar PDF con pdfkit ──
    const pdfBuffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end',  () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const ml = 45, mt = 45, pw = 505;

      // HEADER: emisor (izq) + caja folio (der)
      const boxW = 190, boxX = ml + pw - boxW, boxY = mt, boxH = 82;
      doc.rect(boxX, boxY, boxW, boxH).lineWidth(2).stroke('#000000');
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#000')
        .text(`R.U.T.: ${negocio_rut||'—'}`, boxX, boxY + 10, { width: boxW, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(11)
        .text(tipDoc, boxX, boxY + 27, { width: boxW, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(20)
        .text(`N°${folio}`, boxX, boxY + 50, { width: boxW, align: 'center' });

      doc.font('Helvetica-Bold').fontSize(15).fillColor('#000')
        .text((negocio||'').toUpperCase(), ml, mt, { width: boxX - ml - 16 });
      let lY = mt + 20;
      doc.font('Helvetica').fontSize(9).fillColor('#333');
      if (negocio_giro) { doc.text(`GIRO: ${negocio_giro}`, ml, lY, { width: boxX - ml - 16 }); lY += 13; }
      if (negocio_dir)  { doc.text(`DIRECCIÓN: ${negocio_dir}`, ml, lY, { width: boxX - ml - 16 }); lY += 13; }
      if (negocio_rut)  { doc.text(`R.U.T.: ${negocio_rut}`, ml, lY, { width: boxX - ml - 16 }); }

      // FECHA
      let y = mt + boxH + 14;
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#000')
        .text(`Fecha: ${fechaLarga}`, ml, y, { width: pw, align: 'right' });
      y += 20;

      // Línea separadora
      doc.moveTo(ml, y).lineTo(ml + pw, y).lineWidth(1).strokeColor('#000').stroke();
      y += 12;

      // TABLA CLIENTE
      const rowH = 18, lbW = 80;
      const drawCell = (x, cy, w, h, text, bold, align) => {
        doc.rect(x, cy, w, h).lineWidth(0.5).strokeColor('#000').stroke();
        doc[bold ? 'font' : 'font'](bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#000')
          .text(text, x + 4, cy + 5, { width: w - 8, align: align || 'left', lineBreak: false });
      };
      drawCell(ml,             y, lbW,          rowH, 'Cliente',                    true);
      drawCell(ml + lbW,       y, pw - lbW,     rowH, cliente_nombre||'Consumidor Final', false);
      y += rowH;
      const col2 = 115, col3 = 110;
      drawCell(ml,                    y, lbW,   rowH, 'RUT',          true);
      drawCell(ml + lbW,              y, col2,  rowH, cliente_rut||'66.666.666-6', false);
      drawCell(ml + lbW + col2,       y, col3,  rowH, 'Forma de pago', true);
      drawCell(ml + lbW + col2 + col3, y, pw - lbW - col2 - col3, rowH, 'Contado', false);
      y += rowH + 14;

      // TABLA ÍTEMS
      const descW = pw - 45 - 95 - 95, qtyW = 45, unitW = 95, subW = 95;
      // Header negro
      doc.rect(ml, y, pw, 17).fillAndStroke('#000000', '#000000');
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
      doc.text('DESCRIPCIÓN', ml + 5, y + 5, { width: descW - 5, lineBreak: false });
      doc.text('CANT.',  ml + descW + 3, y + 5, { width: qtyW - 3, align: 'right', lineBreak: false });
      doc.text('P. UNIT.', ml + descW + qtyW + 3, y + 5, { width: unitW - 3, align: 'right', lineBreak: false });
      doc.text('SUBTOTAL', ml + descW + qtyW + unitW + 3, y + 5, { width: subW - 3, align: 'right', lineBreak: false });
      doc.fillColor('#000000');
      y += 17;
      (items || []).forEach((it, idx) => {
        const bg = idx % 2 === 1 ? '#f7f7f7' : '#ffffff';
        doc.rect(ml, y, pw, rowH).fillAndStroke(bg, bg);
        doc.moveTo(ml, y + rowH).lineTo(ml + pw, y + rowH).lineWidth(0.3).strokeColor('#cccccc').stroke();
        doc.font('Helvetica').fontSize(9).fillColor('#000');
        doc.text(it.desc||'Servicio', ml + 5, y + 5, { width: descW - 5, lineBreak: false, ellipsis: true });
        doc.text(String(it.qty||1), ml + descW + 3, y + 5, { width: qtyW - 3, align: 'right', lineBreak: false });
        doc.text(fmt(it.precio||0), ml + descW + qtyW + 3, y + 5, { width: unitW - 3, align: 'right', lineBreak: false });
        doc.text(fmt((it.qty||1)*(it.precio||0)), ml + descW + qtyW + unitW + 3, y + 5, { width: subW - 3, align: 'right', lineBreak: false });
        y += rowH;
      });
      doc.moveTo(ml, y).lineTo(ml + pw, y).lineWidth(1).strokeColor('#000').stroke();
      y += 16;

      // TABLA TOTALES (der)
      const ttLW = 120, ttVW = 100, ttX = ml + pw - ttLW - ttVW;
      const drawTotRow = (label, val, bold, thick) => {
        const bw = thick ? 2 : 0.5, rh = bold ? 20 : rowH;
        doc.rect(ttX, y, ttLW, rh).lineWidth(bw).strokeColor('#000').stroke();
        doc.rect(ttX + ttLW, y, ttVW, rh).lineWidth(bw).strokeColor('#000').stroke();
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor('#000');
        doc.text(label, ttX + 5, y + (bold ? 5 : 4), { width: ttLW - 8, lineBreak: false });
        doc.text(val,   ttX + ttLW + 3, y + (bold ? 5 : 4), { width: ttVW - 5, align: 'right', lineBreak: false });
        y += rh;
      };
      if (tipo === 'venta') {
        const iva = Math.round(totalNum * 0.19);
        drawTotRow('SUBTOTAL', fmt(totalNum));
        drawTotRow('NETO',     fmt(totalNum));
        drawTotRow('IVA (19%)', fmt(iva));
        drawTotRow('TOTAL',    fmt(totalNum + iva), true, true);
      } else {
        drawTotRow('SUBTOTAL', fmt(totalNum));
        drawTotRow('TOTAL',    fmt(totalNum), true, true);
      }
      y += 22;

      // PIE
      doc.moveTo(ml, y).lineTo(ml + pw, y).lineWidth(0.5).strokeColor('#aaaaaa').stroke();
      y += 8;
      doc.font('Helvetica').fontSize(8).fillColor('#999999')
        .text('Timbre Electrónico SII · Documento de carácter interno · No válido como boleta tributaria electrónica SII', ml, y, { width: pw, align: 'center' })
        .text('Generado por attempo · attempo.cl', ml, y + 12, { width: pw, align: 'center' });

      doc.end();
    });

    // Email simple con PDF adjunto
    const emailHtml = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f1fa;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;background:#f4f1fa;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:560px;width:100%;">
      <tr><td style="background:#5b21b6;padding:26px 36px;text-align:center;">
        <div style="color:#fff;font-size:24px;font-weight:900;letter-spacing:-.5px;">attempo</div>
      </td></tr>
      <tr><td style="padding:32px 36px;">
        <p style="font-size:15px;font-weight:700;margin:0 0 12px;">Hola ${he(cliente_nombre||'')},</p>
        <p style="font-size:14px;color:#444;margin:0 0 20px;">Te enviamos tu boleta <strong>N°${he(String(folio||''))}</strong> de <strong>${he(negocio||'tu negocio')}</strong> correspondiente al ${he(fechaLarga||'')}.</p>
        <p style="font-size:14px;color:#444;margin:0;">Encuéntrala adjunta en este correo como PDF.</p>
      </td></tr>
      <tr><td style="padding:16px 36px 28px;text-align:center;font-size:11px;color:#aaa;">
        attempo.cl — Todo a tu tiempo
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'attempo <contacto@attempo.cl>',
          to,
          subject: `Tu boleta de ${negocio || 'tu negocio'} · N°${folio}`,
          html: emailHtml,
          attachments: [{ filename: `boleta-N${folio}.pdf`, content: pdfBuffer.toString('base64') }]
        })
      });
      if (!r.ok) { console.error('send-boleta error:', await r.text()); return res.status(500).json({ error: 'Error al enviar' }); }
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('send-boleta exception:', e.message);
      return res.status(500).json({ error: 'Error al enviar boleta' });
    }
  }

  // — Confirmación manual desde admin (cambio de estado → confirmada) —
  if (body.type === 'confirmar_desde_admin') {
    const cita_id = String(body.cita_id || '').trim();
    if (!cita_id || !/^[0-9a-f-]{36}$/i.test(cita_id)) return res.status(400).json({ error: 'cita_id inválido' });
    const cid = resolveClienteId(req, null);
    if (!cid) return res.status(401).json({ error: 'No autorizado' });
    try {
      const [rCita, rCli] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/citas?id=eq.${cita_id}&cliente_id=eq.${cid}&select=*,especialistas(nombre)&limit=1`, { headers: sh }),
        fetch(`${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cid}&select=nombre_negocio,metodos_pago,datos_banco&limit=1`, { headers: sh })
      ]);
      const [cita] = await rCita.json().catch(() => []);
      const [cli]  = await rCli.json().catch(() => []);
      if (!cita?.email_paciente) return res.status(400).json({ error: 'Esta cita no tiene email del paciente', skipped: true });
      const [y, m, d] = (cita.fecha || '').split('-');
      const fechaFmt = d ? new Date(`${cita.fecha}T12:00:00`).toLocaleDateString('es-CL', { weekday:'long', day:'numeric', month:'long', year:'numeric' }) : cita.fecha;
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Attempo <contacto@attempo.cl>',
          to: [cita.email_paciente],
          subject: `Tu cita en ${cli?.nombre_negocio || 'la clínica'} está confirmada`,
          html: emailHtml({
            nombre_paciente:   cita.nombre_paciente,
            nombre_especialista: cita.especialistas?.nombre || null,
            fechaFmt,
            hora:    (cita.hora || '').slice(0, 5),
            servicio: cita.servicio || null,
            negocio_nombre: cli?.nombre_negocio || null,
            duracion: null,
            total:    cita.precio ? '$' + Number(cita.precio).toLocaleString('es-CL') : null,
            metodos_pago: cli?.metodos_pago || null,
            datos_banco:  cli?.datos_banco  || null
          })
        })
      });
      if (!r.ok) { console.error('confirmar_desde_admin email error:', await r.text()); return res.status(500).json({ error: 'Error al enviar email' }); }
      return res.status(200).json({ ok: true });
    } catch(e) {
      console.error('confirmar_desde_admin exception:', e.message);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  // — Confirmación de cita (flujo original) —
  const { to, cliente, negocio, fecha, hora, especialista, servicio, duracion, total, cliente_id } = body;
  if (!to || !cliente) return res.status(400).json({ error: 'Faltan datos' });

  let metodos_pago = null, datos_banco = null;
  if (cliente_id && process.env.SUPABASE_SERVICE_KEY) {
    try {
      const rc = await fetch(
        `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=metodos_pago,datos_banco&limit=1`,
        { headers: sh }
      );
      const [cli] = await rc.json();
      metodos_pago = cli?.metodos_pago || null;
      datos_banco  = cli?.datos_banco  || null;
    } catch(_) {}
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Attempo <contacto@attempo.cl>',
        to,
        subject: `Tu cita en ${negocio || 'la clínica'} está confirmada`,
        html: emailHtml({ nombre_paciente: cliente, nombre_especialista: especialista, fechaFmt: fecha, hora, servicio, negocio_nombre: negocio, duracion, total, metodos_pago, datos_banco })
      })
    });
    if (!r.ok) console.error('send-email error:', await r.text());
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('send-email exception:', e.message);
    return res.status(500).json({ error: 'Error al enviar email' });
  }
}

function _buildPromoFiltroUrl(filtro, periodo) {
  if (filtro !== 'recientes') return '';
  const d = new Date();
  const meses = periodo === '3m' ? 3 : periodo === '6m' ? 6 : periodo === '2y' ? 24 : 12;
  d.setMonth(d.getMonth() - meses);
  return `&fecha=gte.${d.toISOString().slice(0, 10)}`;
}

function emailPromoHtml({ nombre, titulo, mensaje, ctaTxt, ctaUrl, negocio, headerVisible, headerColor, headerSubtitle, bannerUrl }) {
  function he(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  const hColor = /^#[0-9a-fA-F]{3,6}$/.test(headerColor || '') ? headerColor : '#6C5CE4';
  const hSub   = headerSubtitle || '';
  const ctaBtn = (ctaTxt && ctaUrl)
    ? `<div style="text-align:center;margin:24px 0 8px"><a href="${he(ctaUrl)}" style="display:inline-block;padding:13px 32px;background:${hColor};color:#fff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;letter-spacing:.3px">${he(ctaTxt)}</a></div>`
    : '';
  const tituloBlock = titulo
    ? `<h2 style="margin:0 0 16px;color:#2d2d2d;font-size:22px;font-weight:700;line-height:1.3">${he(titulo)}</h2>`
    : '';
  const bannerBlock = bannerUrl
    ? `<tr><td><img src="${he(bannerUrl)}" alt="" style="width:100%;display:block;max-height:280px;object-fit:cover"></td></tr>`
    : '';
  const headerBlock = headerVisible !== false
    ? `<tr><td style="background:${hColor};padding:28px 32px;text-align:center;">
  <img src="https://app.attempo.cl/logo_attempo.png" alt="attempo" height="36" style="display:block;margin:0 auto${hSub ? ' 8px' : ' 0'}">
  ${hSub ? `<p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;">${he(hSub)}</p>` : ''}
</td></tr>` : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);">
${headerBlock}
${bannerBlock}
<tr><td style="padding:36px 32px;">
  ${tituloBlock}
  <p style="margin:0 0 6px;color:#6b7280;font-size:14px;">Hola <strong>${he(nombre)}</strong>,</p>
  <div style="margin:16px 0;color:#374151;font-size:14px;line-height:1.7">${he(mensaje).replace(/\n/g,'<br>')}</div>
  ${ctaBtn}
</td></tr>
<tr><td style="background:#f9f8ff;padding:16px 32px;text-align:center;border-top:1px solid #ede9fe;">
  <p style="margin:0 0 4px;color:#9ca3af;font-size:12px;">Mensaje enviado por <strong>${he(negocio)}</strong> a través de <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none;">attempo</a></p>
  <p style="margin:0;color:#c4b5fd;font-size:11px;"><a href="mailto:contacto@attempo.cl?subject=unsubscribe" style="color:#c4b5fd;">Cancelar suscripción</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function buildPagoHtml(metodos_pago, datos_banco) {
  if (!metodos_pago) return '';
  const activos = [];
  if (metodos_pago.webpay)        activos.push('Webpay / Transbank');
  if (metodos_pago.transferencia) activos.push('Transferencia bancaria');
  if (metodos_pago.efectivo)      activos.push('Efectivo en el local');
  if (!activos.length) return '';
  let bancoRows = '';
  if (metodos_pago.transferencia && datos_banco && Object.keys(datos_banco).length) {
    const d = datos_banco;
    const filas = [];
    if (d.banco)  filas.push(`Banco: ${he(d.banco)}`);
    if (d.tipo)   filas.push(`Tipo: ${he(d.tipo)}`);
    if (d.cuenta) filas.push(`N° cuenta: ${he(d.cuenta)}`);
    if (d.rut)    filas.push(`RUT: ${he(d.rut)}`);
    if (d.nombre) filas.push(`A nombre de: ${he(d.nombre)}`);
    if (d.email)  filas.push(`Email: ${he(d.email)}`);
    if (filas.length) bancoRows = `<tr><td style="padding:2px 0 10px;text-align:center;font-size:12px;color:#6b7280;line-height:1.8">${filas.join('<br>')}</td></tr>`;
  }
  return `<tr><td style="padding:10px 0 4px;border-top:1px solid #ede9fe;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Métodos de pago</span><br><span style="color:#2d2d2d;font-size:13px;">${activos.join(' · ')}</span></td></tr>${bancoRows}`;
}

function emailHtml({ nombre_paciente, nombre_especialista, fechaFmt, hora, servicio, negocio_nombre, duracion, total, metodos_pago, datos_banco }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media only screen and (max-width:600px){.aw{padding:20px 8px!important}.ac{padding:24px 16px!important}.af{padding:12px 16px!important}}</style></head>
<body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" class="aw" style="background:#f5f3ff;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(108,92,228,0.10);">
<tr><td style="background:#6C5CE4;padding:28px 24px;text-align:center;">
  <img src="https://attempo.cl/logo_attempo.png" alt="Attempo" height="36" style="display:block;margin:0 auto 8px;">
  <p style="margin:0;color:rgba(255,255,255,0.85);font-size:13px;">Todo a tu tiempo</p>
</td></tr>
<tr><td class="ac" style="padding:28px 24px;text-align:center;">
  <h2 style="margin:0 0 6px;color:#2d2d2d;font-size:20px;">Cita confirmada</h2>
  <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Hola <strong>${he(nombre_paciente||'')}</strong>, tu hora está reservada.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ff;border-radius:12px;padding:20px;">
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Profesional</span><br><span style="color:#2d2d2d;font-size:15px;">${nombre_especialista || 'Profesional'}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Fecha</span><br><span style="color:#2d2d2d;font-size:15px;">${fechaFmt}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Hora</span><br><span style="color:#2d2d2d;font-size:15px;">${hora}</span></td></tr>
    <tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Motivo</span><br><span style="color:#2d2d2d;font-size:15px;">${servicio || 'Consulta'}</span></td></tr>
    ${duracion ? `<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Duración</span><br><span style="color:#2d2d2d;font-size:15px;">${duracion}</span></td></tr>` : ''}
    ${total ? `<tr><td style="padding:6px 0;text-align:center;"><span style="color:#6C5CE4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Total</span><br><span style="color:#6C5CE4;font-size:16px;font-weight:700;">${total}</span></td></tr>` : ''}
    ${buildPagoHtml(metodos_pago, datos_banco)}
  </table>
</td></tr>
<tr><td class="af" style="background:#f9f8ff;padding:16px 24px;text-align:center;border-top:1px solid #ede9fe;">
  <p style="margin:0;color:#9ca3af;font-size:12px;">Agendado con <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none;">Attempo</a> — Todo a tu tiempo</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
