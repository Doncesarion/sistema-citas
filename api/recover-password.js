export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email requerido' });

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Attempo <contacto@attempo.cl>',
        to: [email],
        subject: 'Recuperación de contraseña — Attempo',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a2e">
            <img src="https://sistema-citas-mu.vercel.app/logo_attempo.png" width="48" style="border-radius:12px;margin-bottom:20px" alt="Attempo">
            <h2 style="margin:0 0 8px;font-size:20px;font-weight:700">Recuperación de contraseña</h2>
            <p style="margin:0 0 20px;color:#555;font-size:14px">
              Recibimos una solicitud para restablecer la contraseña de tu cuenta en Attempo.<br>
              Si no fuiste tú, puedes ignorar este mensaje.
            </p>
            <p style="margin:0 0 20px;color:#555;font-size:14px">
              Para recuperar el acceso, responde este correo o contáctanos directamente en
              <a href="mailto:soporte@attempo.cl" style="color:#6C5CE4">soporte@attempo.cl</a>
              y te ayudaremos de inmediato.
            </p>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
            <p style="margin:0;font-size:12px;color:#999">Attempo · Todo a tu tiempo · <a href="https://attempo.cl" style="color:#999">attempo.cl</a></p>
          </div>
        `
      })
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Error al enviar email' });
  }
}
