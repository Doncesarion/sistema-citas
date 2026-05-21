export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { especialista_id, fecha } = req.query;
  if (!especialista_id || !fecha) return res.status(400).json({ error: 'Faltan parámetros' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'Fecha inválida' });
  const [fy, fm, fd] = fecha.split('-').map(Number);
  if (isNaN(new Date(fy, fm - 1, fd).getTime()) || fm < 1 || fm > 12 || fd < 1 || fd > 31) {
    return res.status(400).json({ error: 'Fecha inválida' });
  }

  const URL = 'https://xztqawulvrtjvtfixofy.supabase.co';
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}` };

  function generarSlots(desde, hasta, min = 30) {
    const r = []; let [h, m] = desde.split(':').map(Number);
    const [hf, mf] = hasta.split(':').map(Number); const fin = hf * 60 + mf;
    while (h * 60 + m < fin) {
      r.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
      m += min; if (m >= 60) { h++; m -= 60; }
    }
    return r;
  }

  try {
    const [esp] = await fetch(
      `${URL}/rest/v1/especialistas?id=eq.${especialista_id}&select=horario`,
      { headers: sh }
    ).then(r => r.json());

    if (!esp) return res.json({ disponible: false });

    const diasKey = ['dom','lun','mar','mie','jue','vie','sab'];
    const dia = esp.horario?.[diasKey[new Date(fecha + 'T12:00:00').getDay()]];
    if (!dia?.activo || !dia.bloques?.length) return res.json({ disponible: false });

    const todos = generarSlots(dia.bloques[0].desde, dia.bloques[0].hasta);
    const citas = await fetch(
      `${URL}/rest/v1/citas?especialista_id=eq.${especialista_id}&fecha=eq.${fecha}&estado=neq.canceled&select=hora`,
      { headers: sh }
    ).then(r => r.json());

    const ocupadas = new Set((citas || []).map(c => c.hora?.slice(0, 5)));
    const libres = todos.filter(s => !ocupadas.has(s));

    res.json(libres.length ? { disponible: true, slots: libres } : { disponible: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
