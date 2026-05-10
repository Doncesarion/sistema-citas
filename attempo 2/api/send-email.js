module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { to, cliente, negocio, fecha, hora, especialista, servicio, duracion, total } = req.body;
  if (!to) return res.status(400).json({ error: 'Falta email' });

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cita confirmada</title></head>
<body style="margin:0;padding:0;background:#F4F4F8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F8;padding:32px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">

        <!-- HEADER -->
        <tr><td style="background:#6C5CE4;border-radius:14px 14px 0 0;padding:36px 40px;text-align:center">
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 14px auto">
            <tr><td align="center"><img src="https://sistema-citas-mu.vercel.app/logo_attempo.png" width="64" height="64" alt="attempo" style="display:block;border-radius:14px;border:0"></td></tr>
          </table>
          <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;margin-bottom:4px">attempo</div>
          <div style="color:rgba(255,255,255,0.75);font-size:13px">Todo a tu tiempo</div>
        </td></tr>

        <!-- BODY -->
        <tr><td style="background:#ffffff;padding:36px 40px">
          <p style="font-size:22px;font-weight:700;color:#16143A;margin:0 0 6px">¡Cita confirmada! ✅</p>
          <p style="font-size:14px;color:#5E5880;margin:0 0 28px">Hola ${cliente}, tu cita en <strong>${negocio}</strong> ha sido confirmada.</p>

          <!-- INFO CARD -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F7FF;border:1px solid rgba(108,92,228,0.12);border-radius:10px;overflow:hidden">
            <tr><td style="padding:0 20px">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding:14px 0;border-bottom:1px solid rgba(108,92,228,0.08)">
                  <table width="100%"><tr>
                    <td style="font-size:13px;color:#5E5880">📅 Fecha</td>
                    <td align="right" style="font-size:13px;font-weight:600;color:#16143A">${fecha}</td>
                  </tr></table>
                </td></tr>
                <tr><td style="padding:14px 0;border-bottom:1px solid rgba(108,92,228,0.08)">
                  <table width="100%"><tr>
                    <td style="font-size:13px;color:#5E5880">🕐 Hora</td>
                    <td align="right" style="font-size:13px;font-weight:600;color:#16143A">${hora}</td>
                  </tr></table>
                </td></tr>
                <tr><td style="padding:14px 0;border-bottom:1px solid rgba(108,92,228,0.08)">
                  <table width="100%"><tr>
                    <td style="font-size:13px;color:#5E5880">👨‍⚕️ Especialista</td>
                    <td align="right" style="font-size:13px;font-weight:600;color:#16143A">${especialista}</td>
                  </tr></table>
                </td></tr>
                <tr><td style="padding:14px 0;border-bottom:1px solid rgba(108,92,228,0.08)">
                  <table width="100%"><tr>
                    <td style="font-size:13px;color:#5E5880">🗂 Servicio</td>
                    <td align="right" style="font-size:13px;font-weight:600;color:#16143A">${servicio}</td>
                  </tr></table>
                </td></tr>
                <tr><td style="padding:14px 0;border-bottom:1px solid rgba(108,92,228,0.08)">
                  <table width="100%"><tr>
                    <td style="font-size:13px;color:#5E5880">⏱ Duración</td>
                    <td align="right" style="font-size:13px;font-weight:600;color:#16143A">${duracion}</td>
                  </tr></table>
                </td></tr>
                <tr><td style="padding:14px 0">
                  <table width="100%"><tr>
                    <td style="font-size:13px;color:#5E5880">💰 Total</td>
                    <td align="right" style="font-size:14px;font-weight:700;color:#6C5CE4">${total}</td>
                  </tr></table>
                </td></tr>
              </table>
            </td></tr>
          </table>

          <p style="font-size:13px;color:#5E5880;text-align:center;margin:24px 0 0">Te pedimos llegar 5 minutos antes. ¡Te esperamos!</p>
        </td></tr>

        <!-- FOOTER -->
        <tr><td style="background:#F8F7FF;border-radius:0 0 14px 14px;padding:18px 40px;text-align:center;border-top:1px solid rgba(108,92,228,0.08)">
          <p style="font-size:11px;color:#9C96B4;margin:0">Este correo fue enviado por <a href="https://attempo.cl" style="color:#6C5CE4;text-decoration:none">Attempo</a> · <a href="https://attempo.cl" style="color:#9C96B4;text-decoration:none">attempo.cl</a></p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Attempo <contacto@attempo.cl>',
        to: [to],
        subject: '¡Tu cita está confirmada! ✅',
        html
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(500).json({ error: err });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
