/**
 * Example: Fetch leads from the Scorimmo API and sync to your CRM
 *
 * Install: npm install @scorimmo/sdk
 * Run:     npx ts-node examples/fetch-leads.ts
 */
import { ScorimmoClient, ScorimmoApiError } from '@scorimmo/sdk'

const client = new ScorimmoClient({
  baseUrl: process.env.SCORIMMO_URL ?? 'https://app.scorimmo.com',
  username: process.env.SCORIMMO_USER ?? '',
  password: process.env.SCORIMMO_PASSWORD ?? '',
})

async function main() {
  // ── Example 1: fetch leads created in the last 24h ───────────────────────
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const newLeads = await client.leads.since(since)

  console.log(`Found ${newLeads.length} new leads since ${since.toISOString()}`)

  for (const lead of newLeads) {
    console.log(`  → #${lead.id} ${lead.customer?.last_name ?? '?'} — ${lead.interest} — ${lead.status}`)
  }

  // ── Example 2: get a specific lead ───────────────────────────────────────
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

  // ── Example 3: search leads by external CRM id ───────────────────────────
  const result = await client.leads.list({
    search: { external_lead_id: 'CRM-001' },
    limit: 10,
  })

  console.log(`\nLeads matching external id "CRM-001": ${result.total}`)

  // ── Example 4: create a lead ─────────────────────────────────────────────
  const created = await client.leads.create({
    store_id: 1,
    interest: 'TRANSACTION',
    origin: 'Mon Site',
    customer: {
      first_name: 'Marie',
      last_name: 'Dupont',
      email: 'marie.dupont@example.com',
      phone: '0600000001',
    },
    properties: [
      { type: 'Appartement', price: 250000, area: 65 },
    ],
  })

  console.log(`\nCreated lead #${created.id}`)

  // ── Example 5: update a lead with your CRM id ────────────────────────────
  await client.leads.update(created.id, {
    external_lead_id: 'CRM-456',
  })

  console.log(`Updated lead #${created.id} with external_lead_id CRM-456`)
}

main().catch(console.error)
