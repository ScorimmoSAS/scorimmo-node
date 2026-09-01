/**
 * Example: Receive Scorimmo webhooks in an Express app (API v2).
 *
 * Install: npm install express scorimmo-node
 * Run:     npx tsx examples/express-webhook.ts
 *
 * Headers envoyés par Scorimmo :
 *  - X-Signature-256    : sha256=<hex(hmac_sha256(rawBody, secret))> — présent si vous
 *                          avez configuré un secret ; le nom du header est personnalisable
 *  - X-Scorimmo-Event   : nom sémantique (ex: 'lead.created') ; 'webhook.<name>' pour un
 *                          événement futur non encore modélisé
 *  - X-Scorimmo-Version : date de la version d'API (ex: '2026-04-20')
 *
 * IMPORTANT : si vous activez la signature, il faut lire le corps BRUT (raw body) avant
 * tout JSON.parse — d'où express.raw() sur cette route au lieu d'express.json().
 *
 * Idempotence : Scorimmo effectue jusqu'à 6 livraisons (retries exponentiels).
 * Dédupliquez par (event, lead_id, created_at/updated_at).
 */
import express from 'express'
import { ScorimmoWebhook, WebhookAuthError, WebhookValidationError } from 'scorimmo-node'

const app = express()

const webhook = new ScorimmoWebhook({
  signatureSecret: process.env.SCORIMMO_WEBHOOK_SIGNATURE_SECRET,
  // signatureHeader: 'X-Signature-256', // valeur par défaut
})

app.post(
  '/webhook/scorimmo',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : ''

    try {
      await webhook.handle(req.headers, rawBody, {
        onNewLead: async (lead) => {
          const name = `${lead.customer?.first_name ?? ''} ${lead.customer?.last_name ?? ''}`.trim()
          console.log(`[new_lead] #${lead.id} — ${name} — ${lead.interest}`)
          // TODO: créer le contact dans votre CRM (idempotent : dédupliquer sur lead.id)
        },

        onUpdateLead: async (event) => {
          console.log(`[update_lead] #${event.id} mis à jour le ${event.updated_at}`)
          // Payload sparse : uniquement les champs modifiés (customer, seller, requests,
          // additional_fields, store_id, ...)
        },

        onNewComment: async (event) => {
          console.log(`[new_comment] Lead #${event.lead_id}: "${event.comment}"`)
        },

        onNewRdv: async (event) => {
          console.log(`[new_rdv] Lead #${event.lead_id}: ${event.start_time} — ${event.detail ?? 'RDV'}`)
        },

        onNewReminder: async (event) => {
          console.log(`[new_reminder] Lead #${event.lead_id}: ${event.start_time} — ${event.detail}`)
        },

        onClosureLead: async (event) => {
          // status = 'Succès' | 'Fermé' | "Fermé par l'opérateur"
          console.log(`[closure_lead] Lead #${event.lead_id} — ${event.status}: ${event.close_reason ?? '—'}`)
        },

        onUnknown: async (event) => {
          console.log('[scorimmo.unknown_event]', event)
        },
      })

      res.sendStatus(200)
    } catch (err) {
      if (err instanceof WebhookAuthError) {
        res.status(401).json({ error: err.message })
      } else if (err instanceof WebhookValidationError) {
        res.status(400).json({ error: err.message })
      } else {
        console.error('Webhook error:', err)
        res.sendStatus(500)
      }
    }
  },
)

app.listen(3000, () => {
  console.log('Webhook receiver listening on http://localhost:3000/webhook/scorimmo')
})
