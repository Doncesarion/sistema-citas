import crypto from 'crypto';

const SUPABASE_URL = 'https://xztqawulvrtjvtfixofy.supabase.co';

function verifySessionToken(token) {
  if (!token) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig     = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  } catch { return null; }
  const parts = payload.split(':');
  if (parts.length < 3) return null;
  const [cliente_id, rol, expires] = parts;
  if (Date.now() > parseInt(expires)) return null;
  return { cliente_id, rol };
}

function getPeriodRange(periodo) {
  // periodo formato: "2026-06"
  if (!/^\d{4}-\d{2}$/.test(periodo)) return null;
  const [y, m] = periodo.split('-').map(Number);
  const inicio = `${y}-${String(m).padStart(2,'0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const fin = `${y}-${String(m).padStart(2,'0')}-${lastDay}`;
  return { inicio, fin };
}

function fmtPeso(n) {
  return '$' + Number(n || 0).toLocaleString('es-CL');
}

export default async function handler(req, res) {
  const s = verifySessionToken(req.headers['x-session-token']);
  if (!s) return res.status(401).json({ error: 'No autorizado' });

  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const sh  = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

  let cliente_id = s.cliente_id;
  const overrideId = req.headers['x-override-cliente-id'];
  if (s.rol === 'superadmin' && overrideId && /^[0-9a-f-]{36}$/i.test(overrideId)) {
    cliente_id = overrideId;
  }

  // ── GET ?action=calcular&periodo=2026-06 ─────────────────────────────────
  if (req.method === 'GET' && req.query.action === 'calcular') {
    const range = getPeriodRange(req.query.periodo);
    if (!range) return res.status(400).json({ error: 'Período inválido. Usa formato YYYY-MM' });

    try {
      // Traer especialistas del cliente con su comisión
      const rEsp = await fetch(
        `${SUPABASE_URL}/rest/v1/especialistas?cliente_id=eq.${cliente_id}&select=id,nombre,comision_pct&order=nombre.asc`,
        { headers: sh }
      );
      let especialistas;
      if (!rEsp.ok) {
        // Posible columna comision_pct no existe aún en schema cache — fallback
        const rFb = await fetch(
          `${SUPABASE_URL}/rest/v1/especialistas?cliente_id=eq.${cliente_id}&select=id,nombre&order=nombre.asc`,
          { headers: sh }
        );
        const raw = await rFb.json();
        if (!Array.isArray(raw)) {
          const errBody = await rEsp.text().catch(() => '');
          console.error('especialistas error:', rEsp.status, errBody);
          return res.status(500).json({ error: 'Error al cargar profesionales', detail: errBody.slice(0, 300) });
        }
        especialistas = raw.map(e => ({ ...e, comision_pct: 70 }));
      } else {
        especialistas = await rEsp.json();
        if (!Array.isArray(especialistas)) {
          console.error('especialistas non-array:', JSON.stringify(especialistas));
          return res.status(500).json({ error: 'Error al cargar profesionales', detail: JSON.stringify(especialistas).slice(0, 300) });
        }
      }

      // Traer citas completadas del período con precio
      const rCitas = await fetch(
        `${SUPABASE_URL}/rest/v1/citas?cliente_id=eq.${cliente_id}&fecha=gte.${range.inicio}&fecha=lte.${range.fin}&estado=neq.canceled&select=especialista_id,precio,servicio`,
        { headers: sh }
      );
      const citas = await rCitas.json();
      if (!Array.isArray(citas)) return res.status(500).json({ error: 'Error al cargar citas' });

      // Agrupar citas por especialista
      const porEsp = {};
      for (const c of citas) {
        if (!c.especialista_id) continue;
        if (!porEsp[c.especialista_id]) porEsp[c.especialista_id] = { total_citas: 0, monto_total: 0 };
        porEsp[c.especialista_id].total_citas++;
        porEsp[c.especialista_id].monto_total += Number(c.precio || 0);
      }

      // Construir resultado por profesional
      const resultado = especialistas.map(esp => {
        const datos        = porEsp[esp.id] || { total_citas: 0, monto_total: 0 };
        const comision_pct = esp.comision_pct ?? 70;
        const monto_profesional = Math.round(datos.monto_total * comision_pct / 100);
        const monto_clinica     = datos.monto_total - monto_profesional;
        return {
          especialista_id:  esp.id,
          nombre:           esp.nombre,
          comision_pct,
          total_citas:      datos.total_citas,
          monto_total:      datos.monto_total,
          monto_profesional,
          monto_clinica,
        };
      });

      const totales = resultado.reduce((acc, r) => ({
        total_citas:       acc.total_citas + r.total_citas,
        monto_total:       acc.monto_total + r.monto_total,
        monto_profesional: acc.monto_profesional + r.monto_profesional,
        monto_clinica:     acc.monto_clinica + r.monto_clinica,
      }), { total_citas: 0, monto_total: 0, monto_profesional: 0, monto_clinica: 0 });

      return res.json({ ok: true, periodo: req.query.periodo, range, resultado, totales });
    } catch (e) {
      console.error('liquidaciones calcular error:', e.message);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  // ── GET ?action=historial ────────────────────────────────────────────────
  if (req.method === 'GET' && req.query.action === 'historial') {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/liquidaciones?cliente_id=eq.${cliente_id}&order=periodo_fin.desc,created_at.desc&limit=100&select=*`,
        { headers: sh }
      );
      const rows = await r.json();
      if (!Array.isArray(rows)) return res.status(500).json({ error: 'Error al cargar historial' });

      // Lookup nombres de especialistas manualmente (evita depender de FK en PostgREST)
      const espIds = [...new Set(rows.map(r => r.especialista_id).filter(Boolean))];
      const espNames = {};
      if (espIds.length > 0) {
        const rEsp = await fetch(
          `${SUPABASE_URL}/rest/v1/especialistas?id=in.(${espIds.join(',')})&select=id,nombre`,
          { headers: sh }
        );
        const esps = await rEsp.json();
        if (Array.isArray(esps)) esps.forEach(e => { espNames[e.id] = e.nombre; });
      }

      const liquidaciones = rows.map(r => ({ ...r, nombre_profesional: espNames[r.especialista_id] || '—' }));

      // Nombre del negocio para boletas
      let nombre_negocio = '';
      const rCli = await fetch(
        `${SUPABASE_URL}/rest/v1/clientes_sistema?id=eq.${cliente_id}&select=nombre_negocio&limit=1`,
        { headers: sh }
      );
      const cli = await rCli.json();
      if (Array.isArray(cli) && cli[0]) nombre_negocio = cli[0].nombre_negocio || '';

      return res.json({ ok: true, liquidaciones, nombre_negocio });
    } catch (e) {
      console.error('liquidaciones historial error:', e.message);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  // ── POST action=generar ─────────────────────────────────────────────────
  if (req.method === 'POST' && req.body?.action === 'generar') {
    const { periodo, force } = req.body;
    const range = getPeriodRange(periodo);
    if (!range) return res.status(400).json({ error: 'Período inválido' });

    try {
      // Verificar si ya existe liquidación para este período
      const rExist = await fetch(
        `${SUPABASE_URL}/rest/v1/liquidaciones?cliente_id=eq.${cliente_id}&periodo_inicio=eq.${range.inicio}&select=id,estado`,
        { headers: sh }
      );
      const exist = await rExist.json();
      if (Array.isArray(exist) && exist.length > 0) {
        if (!force) {
          return res.status(409).json({ error: 'Ya existe una liquidación generada para este período.' });
        }
        const tienePagadas = exist.some(e => e.estado === 'pagada');
        if (tienePagadas) {
          return res.status(409).json({ error: 'Este período tiene liquidaciones ya pagadas. No se puede regenerar.', tienePagadas: true });
        }
        // Eliminar pendientes para regenerar
        await fetch(
          `${SUPABASE_URL}/rest/v1/liquidaciones?cliente_id=eq.${cliente_id}&periodo_inicio=eq.${range.inicio}`,
          { method: 'DELETE', headers: sh }
        );
      }

      // Calcular igual que en /calcular
      const rEsp = await fetch(
        `${SUPABASE_URL}/rest/v1/especialistas?cliente_id=eq.${cliente_id}&select=id,nombre,comision_pct`,
        { headers: sh }
      );
      let especialistas;
      if (!rEsp.ok) {
        const rFb = await fetch(
          `${SUPABASE_URL}/rest/v1/especialistas?cliente_id=eq.${cliente_id}&select=id,nombre`,
          { headers: sh }
        );
        const raw = await rFb.json();
        if (!Array.isArray(raw)) return res.status(500).json({ error: 'Error al cargar profesionales' });
        especialistas = raw.map(e => ({ ...e, comision_pct: 70 }));
      } else {
        especialistas = await rEsp.json();
      }

      const rCitas = await fetch(
        `${SUPABASE_URL}/rest/v1/citas?cliente_id=eq.${cliente_id}&fecha=gte.${range.inicio}&fecha=lte.${range.fin}&estado=neq.canceled&estado=neq.cancelada&select=especialista_id,precio`,
        { headers: sh }
      );
      const citas = await rCitas.json();

      const porEsp = {};
      for (const c of citas) {
        if (!c.especialista_id) continue;
        if (!porEsp[c.especialista_id]) porEsp[c.especialista_id] = { total_citas: 0, monto_total: 0 };
        porEsp[c.especialista_id].total_citas++;
        porEsp[c.especialista_id].monto_total += Number(c.precio || 0);
      }

      // Solo insertar profesionales que tuvieron al menos 1 cita
      const registros = especialistas
        .filter(esp => porEsp[esp.id]?.total_citas > 0)
        .map(esp => {
          const datos        = porEsp[esp.id];
          const comision_pct = esp.comision_pct ?? 70;
          const monto_profesional = Math.round(datos.monto_total * comision_pct / 100);
          return {
            cliente_id,
            especialista_id:  esp.id,
            periodo_inicio:   range.inicio,
            periodo_fin:      range.fin,
            total_citas:      datos.total_citas,
            monto_total:      datos.monto_total,
            comision_pct,
            monto_profesional,
            monto_clinica:    datos.monto_total - monto_profesional,
            estado:           'pendiente',
          };
        });

      if (registros.length === 0) {
        const citasConEsp = citas.filter(c => c.especialista_id).length;
        if (citas.length === 0) {
          return res.status(400).json({ error: 'No hay citas registradas en este período.' });
        } else if (citasConEsp === 0) {
          return res.status(400).json({ error: `Hay ${citas.length} cita(s) en el período pero ninguna tiene un profesional asignado.` });
        }
        return res.status(400).json({ error: 'No se encontraron profesionales activos con citas en este período.' });
      }

      const rIns = await fetch(`${SUPABASE_URL}/rest/v1/liquidaciones`, {
        method: 'POST',
        headers: { ...sh, Prefer: 'return=representation' },
        body: JSON.stringify(registros),
      });
      if (!rIns.ok) {
        const err = await rIns.json().catch(() => ({}));
        return res.status(500).json({ error: err?.message || 'Error al guardar liquidaciones' });
      }
      const inserted = await rIns.json();
      return res.json({ ok: true, generadas: inserted.length, periodo });
    } catch (e) {
      console.error('liquidaciones generar error:', e.message);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  // ── PATCH action=pagar ──────────────────────────────────────────────────
  if (req.method === 'PATCH' && req.body?.action === 'pagar') {
    const { id, fecha_pago, referencia_pago, notas } = req.body;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'ID inválido' });
    if (!fecha_pago) return res.status(400).json({ error: 'Fecha de pago requerida' });

    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/liquidaciones?id=eq.${id}&cliente_id=eq.${cliente_id}`,
        {
          method: 'PATCH',
          headers: { ...sh, Prefer: 'return=minimal' },
          body: JSON.stringify({ estado: 'pagada', fecha_pago, referencia_pago: referencia_pago || null, notas: notas || null }),
        }
      );
      if (!r.ok) return res.status(500).json({ error: 'Error al actualizar' });
      return res.json({ ok: true });
    } catch (e) {
      console.error('liquidaciones pagar error:', e.message);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  // ── PATCH action=actualizar-comision ────────────────────────────────────
  if (req.method === 'PATCH' && req.body?.action === 'actualizar-comision') {
    const { especialista_id, comision_pct } = req.body;
    if (!especialista_id || !/^[0-9a-f-]{36}$/i.test(especialista_id)) return res.status(400).json({ error: 'ID inválido' });
    const pct = parseInt(comision_pct);
    if (isNaN(pct) || pct < 0 || pct > 100) return res.status(400).json({ error: 'Porcentaje inválido (0-100)' });

    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/especialistas?id=eq.${especialista_id}&cliente_id=eq.${cliente_id}`,
        {
          method: 'PATCH',
          headers: { ...sh, Prefer: 'return=minimal' },
          body: JSON.stringify({ comision_pct: pct }),
        }
      );
      if (!r.ok) return res.status(500).json({ error: 'Error al actualizar' });
      return res.json({ ok: true });
    } catch (e) {
      console.error('liquidaciones actualizar-comision error:', e.message);
      return res.status(500).json({ error: 'Error interno' });
    }
  }

  return res.status(405).end();
}
