# scorimmo-node

SDK officiel Node.js / TypeScript pour la plateforme CRM immobilier [Scorimmo](https://pro.scorimmo.com).

Facilite l'intégration des leads Scorimmo dans votre CRM en deux modes :
- **Client API** — récupérez vos leads avec gestion automatique du token JWT
- **Réception de webhooks** — recevez et traitez les événements Scorimmo en temps réel

---

## Installation

```bash
npm install scorimmo-node
```

**Prérequis :** Node.js ≥ 18

---

## Client API

```js
import { ScorimmoClient } from 'scorimmo-node'

const client = new ScorimmoClient({
  username: 'votre-identifiant-api',
  password: 'votre-mot-de-passe-api',
  // baseUrl: 'https://pro.scorimmo.com' (par défaut)
})

// Récupérer tous les leads des dernières 24h (pagination automatique)
const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
const leads = await client.leads.since(since)

// Récupérer un lead par son ID
const lead = await client.leads.get(42)

// Rechercher des leads
const result = await client.leads.list({
  search: { external_lead_id: 'MON-CRM-001' },
  order: 'desc',
  limit: 20,
})

// Leads d'un point de vente spécifique
const storeLeads = await client.leads.listByStore(1, { limit: 50 })
```

---

## Réception de webhooks

### 1. Exposer une route dans votre application

```js
import express from 'express'
import { ScorimmoWebhook } from 'scorimmo-node'

const app = express()
app.use(express.json())

const webhook = new ScorimmoWebhook({
  headerKey: 'X-Scorimmo-Key',       // clé d'en-tête configurée côté Scorimmo
  headerValue: process.env.SCORIMMO_WEBHOOK_SECRET,
})

app.post('/webhook/scorimmo', ...webhook.middleware(), async (req, res) => {
  await webhook.dispatch(req.scorimmo, {
    onNewLead:     async (lead) => { /* nouveau lead → créer dans votre CRM */ },
    onUpdateLead:  async (e)    => { /* lead modifié → mettre à jour */ },
    onNewComment:  async (e)    => { /* nouveau commentaire */ },
    onNewRdv:      async (e)    => { /* rendez-vous planifié */ },
    onNewReminder: async (e)    => { /* rappel planifié */ },
    onClosureLead: async (e)    => { /* lead clôturé → archiver */ },
  })
  res.sendStatus(200)
})

app.listen(3000)
```

### 2. Transmettre l'URL à Scorimmo

Une fois votre route déployée (ex. `https://votre-crm.com/webhook/scorimmo`), communiquez les informations suivantes à votre **account manager Scorimmo** ou par e-mail à **assistance@scorimmo.com** :

```
URL du webhook : https://votre-crm.com/webhook/scorimmo
En-tête d'authentification :
  Clé   : X-Scorimmo-Key
  Valeur : votre-secret

Événements à activer :
  ☑ Nouveau lead        (new_lead)
  ☑ Mise à jour lead    (update_lead)
  ☑ Nouveau commentaire (new_comment)
  ☑ Rendez-vous         (new_rdv)
  ☑ Rappel              (new_reminder)
  ☑ Clôture lead        (closure_lead)

Point(s) de vente concerné(s) : [indiquez vos points de vente]
```

---

## Événements webhook

| Événement | Déclencheur | Champs principaux |
|-----------|-------------|-------------------|
| `new_lead` | Nouveau lead créé | Objet lead complet (client, biens, vendeur...) |
| `update_lead` | Lead modifié | `id`, champs modifiés uniquement |
| `new_comment` | Commentaire ajouté | `lead_id`, `comment`, `created_at` |
| `new_rdv` | Rendez-vous créé | `lead_id`, `start_time`, `location`, `detail` |
| `new_reminder` | Rappel créé | `lead_id`, `start_time`, `detail` |
| `closure_lead` | Lead clôturé | `lead_id`, `status`, `close_reason` |

---

## Gestion des erreurs

```js
import { ScorimmoApiError, ScorimmoAuthError } from 'scorimmo-node'

try {
  const lead = await client.leads.get(999)
} catch (err) {
  if (err instanceof ScorimmoApiError) {
    console.error(err.statusCode, err.message) // ex: 404, "Lead not found"
  }
  if (err instanceof ScorimmoAuthError) {
    console.error('Vérifiez vos identifiants API')
  }
}
```

---

## Support

- Account manager Scorimmo
- **assistance@scorimmo.com**
- [pro.scorimmo.com](https://pro.scorimmo.com)
