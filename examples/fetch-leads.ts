/**
 * Example: Fetch leads from the Scorimmo API v2 and sync to your CRM.
 *
 * Install: npm install scorimmo-node
 * Run:     npx tsx examples/fetch-leads.ts
 */
import { ScorimmoClient, ScorimmoApiError } from 'scorimmo-node'

const client = new ScorimmoClient({
  baseUrl: process.env.SCORIMMO_URL ?? 'https://pro.scorimmo.com',
  email: process.env.SCORIMMO_EMAIL ?? '',
  password: process.env.SCORIMMO_PASSWORD ?? '',
})

async function main() {
  // ── Récupérer les leads créés dans les 24 dernières heures ──────────────────
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const newLeads = await client.leads.since(since, 'created_at', 100, undefined, ['customer', 'seller'])
  console.log(`Found ${newLeads.length} new leads since ${since.toISOString()}`)
  for (const lead of newLeads) {
    console.log(`  → #${lead.id} ${lead.customer?.last_name ?? '?'} — ${lead.interest} — ${lead.status}`)
  }

  // ── Récupérer un lead précis avec ses relations ─────────────────────────────
  try {
    const lead = await client.leads.get(42, ['customer', 'seller', 'appointments', 'comments'])
    console.log('\nLead #42:', lead)
  } catch (err) {
    if (err instanceof ScorimmoApiError && err.statusCode === 404) {
      console.log('Lead #42 not found')
    } else {
      throw err
    }
  }

  // ── Mise à jour partielle ──────────────────────────────────────────────────
  await client.leads.update(42, { external_lead_id: 'CRM-456' })

  // ── Lister avec filtres avancés (opérateurs bracket) ────────────────────────
  const filtered = await client.leads.list({
    interest: 'TRANSACTION',
    store_id: 1,
    'created_at[gte]': '2026-01-01T00:00:00+00:00',
    sort: 'created_at:desc',
    limit: 20,
    include: 'customer',
  })
  console.log(`\nFiltered: ${filtered.data.length} leads (total: ${filtered.meta.total_items})`)

  // ── Ressources de référence ─────────────────────────────────────────────────
  const stores = await client.stores.list()
  console.log(`\nStores accessibles :`)
  for (const store of stores.data) {
    console.log(`  → #${store.id} ${store.name} (${store.city ?? ''})`)
  }

  const statuses = await client.status.list({ limit: 100 })
  console.log(`\nStatuts disponibles : ${statuses.meta.total_items}`)

  // ── Gestion des tokens ──────────────────────────────────────────────────────
  await client.getToken()
  const refreshToken = client.getRefreshToken()
  console.log(`\nRefresh token: ${refreshToken?.slice(0, 8)}...`)

  const validation = await client.validateToken()
  console.log(`Scopes: ${validation.scopes.join(', ')}`)
}

main().catch(console.error)
