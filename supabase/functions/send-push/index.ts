// Ptek — Edge Function "send-push"
// Spedisce una notifica push ai dispositivi dei dipendenti indicati.
// Chiamata dall'app con: { empIds: [uuid...], title, body, url? }
// Richiede il secret VAPID_PRIVATE (impostato nel pannello Supabase).
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

// Chiave pubblica VAPID (è pubblica per design — può stare nel codice).
const VAPID_PUBLIC = 'BBYSrl8NvF689fgDIB1SOI3DFqi-XI7iLLyMTSX0fz92bNtSlzz8n-LAhubzwQPkGQhm0xisY4-FzsoLFWbTw88'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { empIds, title, body, url } = await req.json()
    if (!Array.isArray(empIds) || empIds.length === 0)
      return new Response(JSON.stringify({ error: 'no targets' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })

    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    webpush.setVapidDetails('mailto:notifiche@ptek.app', VAPID_PUBLIC, Deno.env.get('VAPID_PRIVATE')!)

    const { data: subs } = await supa.from('push_subs').select('*').in('emp_id', empIds)
    const payload = JSON.stringify({ title: title || 'Ptek', body: body || '', url: url || './' })

    await Promise.all((subs || []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
      } catch (e) {
        // sottoscrizione scaduta/non valida → la rimuovo
        if (e?.statusCode === 404 || e?.statusCode === 410)
          await supa.from('push_subs').delete().eq('endpoint', s.endpoint)
      }
    }))

    return new Response(JSON.stringify({ sent: (subs || []).length }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
