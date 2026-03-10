/**
 * Example: Fetch leads from the Scorimmo API and sync to your CRM
 *
 * Install: npm install scorimmo-node
 * Run:     npx ts-node examples/fetch-leads.ts
 */
import { ScorimmoClient, ScorimmoApiError } from 'scorimmo-node'

const client = new ScorimmoClient({
  baseUrl: process.env.SCORIMMO_URL ?? 'https://app.scorimmo.com',
  username: process.env.SCORIMMO_USER ?? '',
  password: process.env.SCORIMMO_PASSWORD ?? '',
})

async function main() {
  // ── Fetch leads created in the last 24h ───────────────────────────────────
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const newLeads = await client.leads.since(since)

  console.log(`Found ${newLeads.length} new leads since ${since.toISOString()}`)

  for (const lead of newLeads) {
    console.log(`  → #${lead.id} ${lead.customer?.last_name ?? '?'} — ${lead.interest} — ${lead.status}`)
  }

  // ── Get a specific lead ───────────────────────────────────────────────────
  try {
    const lead = await client.leads.get(42)
    console.log('\nLead #42:', lead)
  } catch (err) {
    if (err instanceof ScorimmoApiError && err.statusCode === 404) {
      console.log('Lead #42 not found')
    } else {
      throw err
    }
  }

  // ── Search leads by external CRM id ──────────────────────────────────────
  const result = await client.leads.list({
    search: { external_lead_id: 'CRM-001' },
    limit: 10,
  })

  console.log(`\nLeads matching external id "CRM-001": ${result.total}`)

  // ── List leads for a specific store ───────────────────────────────────────
  const storeLeads = await client.leads.listByStore(1, { limit: 20 })
  console.log(`\nStore #1 leads: ${storeLeads.total}`)
}

main().catch(console.error)
