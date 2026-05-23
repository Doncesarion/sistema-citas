export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { to, nombre, negocio, folio, total, html_boleta } = req.body || {};
  if (!to || !html_boleta) return res.status(400).json({ error: 'Faltan datos' });
  if (!process.env.RESEND_API_KEY) return res.status(500).json({ error: 'Sin clave de email' });

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Attempo <contacto@attempo.cl>',
        to,
        subject: `Tu boleta de ${negocio || 'tu negocio'} — Folio N° ${folio}`,
        html: html_boleta
      })
    });
    if (!r.ok) {
      const err = await r.text();
      console.error('send-boleta error:', err);
      return res.status(500).json({ error: err });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
