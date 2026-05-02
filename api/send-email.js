export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  var body = req.body;
  var to           = body.to;
  var cliente      = body.cliente;
  var negocio      = body.negocio;
  var fecha        = body.fecha;
  var hora         = body.hora;
  var especialista = body.especialista;
  var servicio     = body.servicio;
  var duracion     = body.duracion;
  var total        = body.total;

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f4f4f8;font-family:Arial,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f8;padding:32px 0;">' +
    '<tr><td align="center">' +
    '<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">' +
    // Header morado
    '<tr><td style="background:linear-gradient(135deg,#4F46E5,#7C3AED);padding:32px;text-align:center;">' +
    '<img src="https://attempo.cl/logo_attempo_v2.png" width="64" height="64" style="border-radius:14px;margin-bottom:12px;" />' +
    '<h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">attempo</h1>' +
    '<p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">Todo a tu tiempo</p>' +
    '</td></tr>' +
    // Cuerpo
    '<tr><td style="padding:32px;">' +
    '<h2 style="color:#0F172A;font-size:18px;margin:0 0 8px;">¡Cita confirmada! ✅</h2>' +
    '<p style="color:#64748B;font-size:14px;margin:0 0 24px;">Hola <strong>' + cliente + '</strong>, tu cita en <strong>' + negocio + '</strong> ha sido confirmada.</p>' +
    // Tabla de detalles
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border-radius:12px;padding:20px;border:1px solid #E2E8F0;">' +
    '<tr><td style="padding:8px 0;border-bottom:1px solid #E2E8F0;"><span style="color:#64748B;font-size:13px;">📅 Fecha</span></td><td style="padding:8px 0;border-bottom:1px solid #E2E8F0;text-align:right;"><strong style="color:#0F172A;font-size:13px;">' + fecha + '</strong></td></tr>' +
    '<tr><td style="padding:8px 0;border-bottom:1px solid #E2E8F0;"><span style="color:#64748B;font-size:13px;">🕐 Hora</span></td><td style="padding:8px 0;border-bottom:1px solid #E2E8F0;text-align:right;"><strong style="color:#0F172A;font-size:13px;">' + hora + '</strong></td></tr>' +
    '<tr><td style="padding:8px 0;border-bottom:1px solid #E2E8F0;"><span style="color:#64748B;font-size:13px;">👨‍⚕️ Especialista</span></td><td style="padding:8px 0;border-bottom:1px solid #E2E8F0;text-align:right;"><strong style="color:#0F172A;font-size:13px;">' + especialista + '</strong></td></tr>' +
    '<tr><td style="padding:8px 0;border-bottom:1px solid #E2E8F0;"><span style="color:#64748B;font-size:13px;">💼 Servicio</span></td><td style="padding:8px 0;border-bottom:1px solid #E2E8F0;text-align:right;"><strong style="color:#0F172A;font-size:13px;">' + servicio + '</strong></td></tr>' +
    '<tr><td style="padding:8px 0;border-bottom:1px solid #E2E8F0;"><span style="color:#64748B;font-size:13px;">⏱ Duración</span></td><td style="padding:8px 0;border-bottom:1px solid #E2E8F0;text-align:right;"><strong style="color:#0F172A;font-size:13px;">' + duracion + '</strong></td></tr>' +
    '<tr><td style="padding:8px 0;"><span style="color:#64748B;font-size:13px;">💰 Total</span></td><td style="padding:8px 0;text-align:right;"><strong style="color:#4F46E5;font-size:15px;">' + total + '</strong></td></tr>' +
    '</table>' +
    '<p style="color:#64748B;font-size:13px;margin:24px 0 0;text-align:center;">Te pedimos llegar <strong>5 minutos antes</strong>. ¡Te esperamos!</p>' +
    '</td></tr>' +
    // Footer
    '<tr><td style="background:#F8FAFC;padding:20px;text-align:center;border-top:1px solid #E2E8F0;">' +
    '<p style="color:#94A3B8;font-size:12px;margin:0;">Este correo fue enviado por <strong>Attempo</strong> · <a href="https://attempo.cl" style="color:#4F46E5;text-decoration:none;">attempo.cl</a></p>' +
    '</td></tr>' +
    '</table>' +
    '</td></tr></table>' +
    '</body></html>';

  var response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Attempo <contacto@attempo.cl>',
      to: [to],
      subject: 'Confirmacion de cita — ' + negocio,
      html: html
    })
  });

  var data = await response.json();
  if (!response.ok) return res.status(500).json({ error: data });
  return res.status(200).json({ ok: true });
}
