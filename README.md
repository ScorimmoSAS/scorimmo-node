# @scorimmo/sdk

Official Node.js / TypeScript SDK for the [Scorimmo](https://www.scorimmo.com) real-estate CRM platform.

Simplifies integration of Scorimmo leads into your CRM in two ways:
- **API client** — fetch, create and update leads with automatic JWT token management
- **Webhook handler** — receive and dispatch Scorimmo events in Express

---

## Requirements

- Node.js ≥ 18
- TypeScript (optional but recommended)

---

## Installation

```bash
npm install @scorimmo/sdk
# or
yarn add @scorimmo/sdk
```

---

## API Client

```ts
import { ScorimmoClient } from '@scorimmo/sdk'

const client = new ScorimmoClient({
  baseUrl: 'https://app.scorimmo.com',
  username: 'your-api-username',
  password: 'your-api-password',
})

// Fetch all leads created in the last 24h (handles pagination automatically)
const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
const leads = await client.leads.since(since)

// Get a single lead
const lead = await client.leads.get(42)

// Search leads
const result = await client.leads.list({
  search: { external_lead_id: 'CRM-001' },
  order: 'desc',
  limit: 20,
  page: 1,
})

// Create a lead
const created = await client.leads.create({
  store_id: 1,
  interest: 'TRANSACTION',
  customer: { first_name: 'Marie', last_name: 'Dupont', phone: '0600000001' },
  properties: [{ type: 'Appartement', price: 250000 }],
})

// Update a lead (e.g. store your CRM id)
await client.leads.update(created.id, { external_lead_id: 'CRM-456' })
```

The client handles JWT authentication automatically and refreshes the token before expiry.

---

## Webhook Handler

Configure a webhook URL on your Scorimmo Point of Sale, then receive events in your Express app:

```ts
import express from 'express'
import { ScorimmoWebhook } from '@scorimmo/sdk'

const app = express()
app.use(express.json())

const webhook = new ScorimmoWebhook({
  headerKey: 'X-Scorimmo-Key',       // header configured in Scorimmo PoS settings
  headerValue: process.env.SCORIMMO_WEBHOOK_SECRET,
})

app.post('/webhook/scorimmo', ...webhook.middleware(), async (req, res) => {
  await webhook.dispatch(req.scorimmo, {
    onNewLead: async (lead) => {
      // Full lead object — create in your CRM
      await yourCRM.contacts.create(lead)
    },
    onUpdateLead: async ({ id, ...changes }) => {
      await yourCRM.contacts.update(id, changes)
    },
    onNewRdv: async ({ lead_id, start_time, location }) => {
      await yourCRM.appointments.create({ lead_id, start_time, location })
    },
    onClosureLead: async ({ lead_id, status, close_reason }) => {
      await yourCRM.contacts.archive(lead_id, { status, close_reason })
    },
  })
  res.sendStatus(200)
})
```

### Webhook events

| Event | Trigger | Key fields |
|-------|---------|------------|
| `new_lead` | Lead created in Scorimmo | Full lead object |
| `update_lead` | Lead updated | `id`, changed fields only |
| `new_comment` | Comment added to a lead | `lead_id`, `comment` |
| `new_rdv` | Appointment created | `lead_id`, `start_time`, `location`, `detail` |
| `new_reminder` | Reminder created | `lead_id`, `start_time`, `detail` |
| `closure_lead` | Lead closed | `lead_id`, `status`, `close_reason` |

---

## Error handling

```ts
import { ScorimmoApiError, ScorimmoAuthError } from '@scorimmo/sdk'

try {
  const lead = await client.leads.get(999)
} catch (err) {
  if (err instanceof ScorimmoApiError) {
    console.error(err.message, err.statusCode) // e.g. "Lead not found", 404
  }
  if (err instanceof ScorimmoAuthError) {
    console.error('Check your API credentials')
  }
}
```

```ts
import { WebhookAuthError, WebhookValidationError } from '@scorimmo/sdk'
// These are thrown by webhook.parse() and caught automatically by webhook.middleware()
```

---

## Framework-agnostic usage

Don't use Express? Use `parse()` and `dispatch()` directly:

```ts
// Works with Fastify, Hono, plain Node http, etc.
const event = webhook.parse(request.headers, request.body)
await webhook.dispatch(event, { onNewLead: ... })
```

---

## Examples

See the [`examples/`](./examples) directory:
- [`express-webhook.ts`](./examples/express-webhook.ts) — complete Express webhook receiver
- [`fetch-leads.ts`](./examples/fetch-leads.ts) — API client usage

---

## License

MIT
