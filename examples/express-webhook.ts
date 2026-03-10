/**
 * Example: Receive Scorimmo webhooks in an Express app
 *
 * Install: npm install express @scorimmo/sdk
 * Run:     npx ts-node examples/express-webhook.ts
 */
import express from 'express'
import { ScorimmoWebhook } from '@scorimmo/sdk'

const app = express()
app.use(express.json())

const webhook = new ScorimmoWebhook({
  // Must match what is configured on your PointOfSale in Scorimmo
  headerKey: 'X-Scorimmo-Key',
  headerValue: process.env.SCORIMMO_WEBHOOK_SECRET ?? 'change-me',
})

app.post('/webhook/scorimmo', ...webhook.middleware(), async (req, res) => {
  try {
    await webhook.dispatch(req.scorimmo, {
      onNewLead: async (lead) => {
        console.log(`[new_lead] #${lead.id} — ${lead.customer?.first_name} ${lead.customer?.last_name}`)
        // TODO: create contact in your CRM
        // await yourCRM.contacts.create({ ... })
      },

      onUpdateLead: async ({ id, updated_at, ...changes }) => {
        console.log(`[update_lead] #${id} updated at ${updated_at}`, changes)
        // TODO: sync changes to your CRM
      },

      onNewComment: async ({ lead_id, comment, created_at }) => {
        console.log(`[new_comment] Lead #${lead_id}: "${comment}" at ${created_at}`)
        // TODO: add note/activity in your CRM
      },

      onNewRdv: async ({ lead_id, start_time, location, detail }) => {
        console.log(`[new_rdv] Lead #${lead_id}: ${detail ?? 'RDV'} on ${start_time} at ${location ?? 'TBD'}`)
        // TODO: create appointment in your CRM
      },

      onNewReminder: async ({ lead_id, start_time, detail }) => {
        console.log(`[new_reminder] Lead #${lead_id}: reminder "${detail}" on ${start_time}`)
      },

      onClosureLead: async ({ lead_id, status, close_reason }) => {
        console.log(`[closure_lead] Lead #${lead_id} closed — status: ${status}, reason: ${close_reason ?? 'N/A'}`)
        // TODO: archive contact in your CRM
      },
    })

    res.sendStatus(200)
  } catch (err) {
    console.error('Error processing webhook:', err)
    res.sendStatus(500)
  }
})

app.listen(3000, () => {
  console.log('Webhook receiver listening on http://localhost:3000/webhook/scorimmo')
})
