import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-token',
}

const ADMIN_TOKEN = Deno.env.get('ADMIN_TOKEN')

// PBKDF2 — hash seguro para contraseñas de clientes
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256)
  const toHex = (buf: Uint8Array) => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('')
  return `pbkdf2$${toHex(salt)}$${toHex(new Uint8Array(bits))}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored) return false
  if (!stored.startsWith('pbkdf2$')) {
    // Compatibilidad con contraseñas antiguas en btoa
    return stored === btoa(unescape(encodeURIComponent('sc_' + password + '_doncesarion')))
  }
  const [, saltHex, hashHex] = stored.split('$')
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256)
  const computed = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('')
  return computed === hashHex
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const adminToken = req.headers.get('x-admin-token')
  if (adminToken !== ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const url = new URL(req.url)
  const action = url.searchParams.get('action')
  const body = req.method !== 'GET' ? await req.json() : {}

  try {
    let result

    switch (action) {

      // ── LICENCIAS ──
      case 'listar':
        result = await supabase.from('clientes_sistema').select('*').order('created_at', { ascending: false })
        break
      case 'crear':
        const passHash = await hashPassword(body.password)
        const bookingSlug = (body.nombre_negocio || '')
          .toLowerCase()
          .normalize('NFD').replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        result = await supabase.from('clientes_sistema').insert({
          nombre_negocio: body.nombre_negocio, email: body.email, password_hash: passHash,
          plan: body.plan || 'demo', fecha_inicio: new Date().toISOString().split('T')[0],
          fecha_expiracion: body.fecha_expiracion, contacto_nombre: body.contacto_nombre,
          contacto_tel: body.contacto_tel, rubro: body.rubro, activo: true,
          booking_slug: bookingSlug,
        }).select().single()
        break
      case 'actualizar':
        const upd: any = {
          nombre_negocio: body.nombre_negocio, email: body.email, plan: body.plan,
          fecha_expiracion: body.fecha_expiracion, contacto_nombre: body.contacto_nombre,
          contacto_tel: body.contacto_tel, rubro: body.rubro, activo: body.activo,
          updated_at: new Date().toISOString(),
        }
        if (body.password) upd.password_hash = await hashPassword(body.password)
        result = await supabase.from('clientes_sistema').update(upd).eq('id', body.id).select().single()
        break
      case 'toggle':
        result = await supabase.from('clientes_sistema').update({ activo: body.activo, updated_at: new Date().toISOString() }).eq('id', body.id).select().single()
        break
      case 'eliminar':
        result = await supabase.from('clientes_sistema').delete().eq('id', body.id)
        break
      case 'pago':
        await supabase.from('pagos').insert({ cliente_id: body.cliente_id, plan: body.plan, monto: body.monto, plataforma: body.plataforma, referencia: body.referencia, estado: 'pagado', fecha_pago: new Date().toISOString() })
        const diasP = body.plan === 'anual' ? 365 : 30
        const expP = new Date(); expP.setDate(expP.getDate() + diasP)
        result = await supabase.from('clientes_sistema').update({ plan: body.plan, fecha_expiracion: expP.toISOString().split('T')[0], activo: true, updated_at: new Date().toISOString() }).eq('id', body.cliente_id).select().single()
        break
      case 'login':
        const hoy = new Date().toISOString().split('T')[0]
        const { data: cliList, error: lerr } = await supabase.from('clientes_sistema').select('*').eq('email', body.email).eq('activo', true).gte('fecha_expiracion', hoy)
        const cli = cliList?.find ? await (async () => {
          for (const c of (cliList || [])) {
            if (await verifyPassword(body.password, c.password_hash)) return c
          }
          return null
        })() : null
        if (lerr || !cli) return new Response(JSON.stringify({ error: 'Credenciales inválidas o licencia vencida' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        result = { data: { ok: true, cliente: cli }, error: null }
        break

      // ── CONFIGURACIÓN ──
      case 'get_config':
        result = await supabase.from('negocios_config').select('*').eq('cliente_id', body.cliente_id).single()
        if (result.error?.code === 'PGRST116') {
          result = await supabase.from('negocios_config').insert({ cliente_id: body.cliente_id, nombre: body.nombre_negocio || 'Mi Negocio' }).select().single()
        }
        break
      case 'save_config':
        const { data: ce } = await supabase.from('negocios_config').select('id').eq('cliente_id', body.cliente_id).single()
        const cfgData: any = {
          nombre: body.nombre, emoji: body.emoji, whatsapp: body.whatsapp,
          direccion: body.direccion, horario: body.horario, color_actual: body.color_actual,
          servicios: body.servicios,
          updated_at: new Date().toISOString()
        }
        // Optional fields — only include if provided
        const optFields = ['logo','banner','horarios_semana','horas_bloqueadas',
          'emailjs_pubkey','emailjs_service','emailjs_template','emailjs_adminmail']
        optFields.forEach(f => { if (body[f] !== undefined) cfgData[f] = body[f] })
        result = ce
          ? await supabase.from('negocios_config').update(cfgData).eq('cliente_id', body.cliente_id).select().single()
          : await supabase.from('negocios_config').insert({ cliente_id: body.cliente_id, ...cfgData }).select().single()
        break

      // ── ESPECIALISTAS ──
      case 'get_especialistas':
        result = await supabase.from('especialistas').select('*').eq('cliente_id', body.cliente_id).eq('activo', true).order('created_at')
        break
      case 'create_especialista':
        result = await supabase.from('especialistas').insert({ cliente_id: body.cliente_id, nombre: body.nombre, especialidad: body.especialidad, email: body.email, tel: body.tel, color: body.color, foto: body.foto || '', dias: body.dias, servicios: body.servicios }).select().single()
        break
      case 'update_especialista':
        result = await supabase.from('especialistas').update({ nombre: body.nombre, especialidad: body.especialidad, email: body.email, tel: body.tel, color: body.color, foto: body.foto, dias: body.dias, servicios: body.servicios, updated_at: new Date().toISOString() }).eq('id', body.id).eq('cliente_id', body.cliente_id).select().single()
        break
      case 'delete_especialista':
        result = await supabase.from('especialistas').update({ activo: false }).eq('id', body.id).eq('cliente_id', body.cliente_id)
        break
      case 'update_foto_especialista':
        result = await supabase.from('especialistas').update({ foto: body.foto, updated_at: new Date().toISOString() }).eq('id', body.id).eq('cliente_id', body.cliente_id).select().single()
        break

      // ── CITAS ──
      case 'get_citas':
        let q = supabase.from('citas').select('*, especialistas(id,nombre,color,foto)').eq('cliente_id', body.cliente_id).order('fecha').order('hora')
        if (body.desde) q = q.gte('fecha', body.desde)
        if (body.hasta) q = q.lte('fecha', body.hasta)
        result = await q
        break
      case 'create_cita':
        result = await supabase.from('citas').insert({ cliente_id: body.cliente_id, especialista_id: body.especialista_id, fecha: body.fecha, hora: body.hora, nombre_paciente: body.nombre_paciente, email_paciente: body.email_paciente, tel_paciente: body.tel_paciente, servicio: body.servicio, precio: body.precio, estado: 'pending' }).select('*, especialistas(id,nombre,color,foto)').single()
        break
      case 'update_estado_cita':
        result = await supabase.from('citas').update({ estado: body.estado, updated_at: new Date().toISOString() }).eq('id', body.id).eq('cliente_id', body.cliente_id).select().single()
        break
      case 'reagendar_cita':
        result = await supabase.from('citas').update({ reagendamientos: body.reagendamientos, updated_at: new Date().toISOString() }).eq('id', body.id).eq('cliente_id', body.cliente_id).select().single()
        break
      case 'save_nota':
        result = await supabase.from('citas').update({ nota: body.nota, updated_at: new Date().toISOString() }).eq('id', body.id).eq('cliente_id', body.cliente_id).select().single()
        break

      // ── PACIENTES ──
      case 'get_pacientes':
        const { data: cp } = await supabase.from('citas').select('nombre_paciente,email_paciente,tel_paciente,precio,estado,reagendamientos,especialistas(nombre)').eq('cliente_id', body.cliente_id)
        if (!cp) { result = { data: [], error: null }; break }
        const mapa: any = {}
        cp.forEach((c: any) => {
          if (!mapa[c.nombre_paciente]) mapa[c.nombre_paciente] = { nombre: c.nombre_paciente, tel: c.tel_paciente, email: c.email_paciente, citasTotal: 0, citasDone: 0, gastado: 0, reagendTotal: 0, espConteo: {} }
          const p = mapa[c.nombre_paciente]
          p.citasTotal++
          if (c.estado === 'done') { p.citasDone++; p.gastado += c.precio }
          p.reagendTotal += c.reagendamientos || 0
          const en = c.especialistas?.nombre || '—'
          p.espConteo[en] = (p.espConteo[en] || 0) + 1
        })
        const pacs = Object.values(mapa).map((p: any) => {
          const top = Object.entries(p.espConteo).sort((a: any, b: any) => b[1] - a[1])[0]
          return { ...p, espPreferido: top ? top[0] : '—' }
        }).sort((a: any, b: any) => b.citasTotal - a.citasTotal)
        result = { data: pacs, error: null }
        break

      case 'get_historial_paciente':
        result = await supabase.from('citas').select('*, especialistas(id,nombre,color,foto)').eq('cliente_id', body.cliente_id).eq('nombre_paciente', body.nombre_paciente).order('fecha', { ascending: false }).order('hora', { ascending: false })
        break

      default:
        return new Response(JSON.stringify({ error: 'Acción no reconocida: ' + action }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (result?.error) return new Response(JSON.stringify({ error: result.error.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    return new Response(JSON.stringify({ data: result?.data ?? result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
