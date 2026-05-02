export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  var body = req.body;
  var to       = body.to;
  var cliente  = body.cliente;
  var negocio  = body.negocio;
  var fecha    = body.fecha;
  var hora     = body.hora;
  var especialista = body.especialista;
  var servicio = body.servicio;
  var duracion = body.duracion;
  var total    = body.total;

  var html = '<p>Hola ' + cliente + ',</p>' +
    '<p>Tu cita ha sido confirmada en <strong>' + negocio + '</strong>.</p>' +
    '<p>📅 Fecha: ' + fecha + '<br>' +
    '🕐 Hora: ' + hora + '<br>' +
    '👨‍⚕️ Especialista: ' + especialista + '<br>' +
    '💼 Servicio: ' + servicio + '<br>' +
    '⏱ Duración: ' + duracion + '<br>' +
    '💰 Total: ' + total + '</p>' +
    '<p>Te pedimos llegar 5 minutos antes.</p>' +
    '<p>¡Te esperamos!<br>' + negocio + '</p>';

  var response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Attempo <contacto@attempo.cl>',
      to: [to],
      subject: 'Confirmación de cita — ' + negocio,
      html: html
    })
  });

  var data = await response.json();
  if (!response.ok) return res.status(500).json({ error: data });
  return res.status(200).json({ ok: true });
}
