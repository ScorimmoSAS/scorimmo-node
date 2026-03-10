# scorimmo-node

SDK officiel Node.js / TypeScript pour la plateforme CRM immobilier [Scorimmo](https://pro.scorimmo.com).

Facilite l'intégration des leads Scorimmo dans votre CRM en deux modes :
- **Client API** — récupérez vos leads avec gestion automatique du token JWT
- **Réception de webhooks** — recevez et traitez les événements Scorimmo en temps réel

> **Documentation de référence :**
> [API REST](https://pro.scorimmo.com/api/doc) · [Webhooks](https://pro.scorimmo.com/webhook/doc)

---

## Sommaire

- [Installation](#installation)
- [Identifiants API](#identifiants-api)
- [Client API](#client-api)
- [Webhooks — Express](#webhooks--express)
- [Référence — Méthodes leads](#référence--méthodes-leads)
- [Référence — Événements webhook](#référence--événements-webhook)
- [Gestion des erreurs](#gestion-des-erreurs)
- [Support](#support)

---

## Installation

```bash
npm install scorimmo-node
```

**Prérequis :** Node.js ≥ 18

---

## Identifiants API

Les identifiants (`username` / `password`) sont les mêmes que ceux utilisés pour se connecter à [pro.scorimmo.com](https://pro.scorimmo.com).

Pour le webhook, le secret (`SCORIMMO_WEBHOOK_SECRET`) est une valeur que vous choisissez librement — communiquez-la ensuite à Scorimmo lors de la configuration (voir [Configurer le webhook chez Scorimmo](#configurer-le-webhook-chez-scorimmo)).

---

## Client API

### Initialisation

```js
import { ScorimmoClient } from 'scorimmo-node'

const client = new ScorimmoClient({
  username: 'votre-identifiant',
  password: 'votre-mot-de-passe',
  // baseUrl: 'https://pro.scorimmo.com'  // par défaut
})
```

Le token JWT est géré automatiquement (récupéré et renouvelé à l'expiration).

### Récupérer les leads récents

```js
// Tous les leads des dernières 24 heures (pagination automatique)
const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
const leads = await client.leads.since(since)

// Depuis une date précise
const leads = await client.leads.since('2024-06-01T00:00:00Z')

// Leads modifiés récemment (plutôt que créés)
const leads = await client.leads.since(since, 'updated_at')
```

### Récupérer un lead par ID

```js
const lead = await client.leads.get(42)
```

### Rechercher des leads

```js
// Par ID externe (votre référence CRM)
const result = await client.leads.list({
  search: { external_lead_id: 'MON-CRM-001' },
})

// Par email client
const result = await client.leads.list({
  search: { email: 'client@exemple.com' },
})

// Avec tri et pagination
const result = await client.leads.list({
  search: { status: 'new' },
  orderby: 'created_at',
  order: 'desc',
  limit: 20,
  page: 1,
})

// result.results contient les leads, result.total le nombre total
for (const lead of result.results) {
  console.log(lead.id, lead.customer.first_name)
}
```

### Leads par point de vente

```js
const result = await client.leads.listByStore(5, {
  orderby: 'created_at',
  order: 'desc',
  limit: 50,
})
```

---

## Webhooks — Express

Les webhooks permettent à Scorimmo de notifier votre application en temps réel lors d'événements (nouveau lead, mise à jour, etc.).

### Installation d'Express

```bash
npm install express
```

### Mise en place

```js
import express from 'express'
import { ScorimmoWebhook } from 'scorimmo-node'

const app = express()
app.use(express.json())

const webhook = new ScorimmoWebhook({
  headerKey: 'X-Scorimmo-Key',
  headerValue: process.env.SCORIMMO_WEBHOOK_SECRET,
})

app.post('/webhook/scorimmo', ...webhook.middleware(), async (req, res) => {
  await webhook.dispatch(req.scorimmo, {

    onNewLead: async (lead) => {
      // lead contient l'objet lead complet
      // Insérer dans votre base de données...
    },

    onUpdateLead: async (event) => {
      // event.id = ID du lead + champs modifiés uniquement
    },

    onNewComment: async (event) => {
      // event.lead_id, event.comment, event.created_at
    },

    onNewRdv: async (event) => {
      // event.lead_id, event.start_time, event.location
    },

    onNewReminder: async (event) => {
      // event.lead_id, event.start_time
    },

    onClosureLead: async (event) => {
      // event.lead_id, event.status, event.close_reason
    },

    // Événement non reconnu (optionnel)
    onUnknown: async (event) => {
      console.warn('Événement Scorimmo inconnu :', event.event)
    },
  })

  res.sendStatus(200)
})

app.listen(3000)
```

Le middleware intégré gère automatiquement les erreurs d'authentification et de validation :
- Retourne `401` si le header d'authentification est absent ou incorrect
- Retourne `400` si le payload est invalide

> **Important :** Scorimmo considère la livraison réussie uniquement si votre endpoint retourne HTTP 200. Tout autre code est ignoré.

### Configurer le webhook chez Scorimmo

Une fois votre endpoint déployé, transmettez les informations suivantes à votre **account manager Scorimmo** (voir [Support](#support)) :

```
URL du webhook : https://votre-app.com/webhook/scorimmo
En-tête d'authentification :
  Clé   : X-Scorimmo-Key
  Valeur : [votre SCORIMMO_WEBHOOK_SECRET]

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

## Référence — Méthodes leads

### `leads.get(id: number): Promise<Lead>`

Retourne un lead complet par son ID Scorimmo.

### `leads.since(date: string | Date, field?: 'created_at' | 'updated_at'): Promise<Lead[]>`

Retourne tous les leads créés (ou modifiés) après `date`. La pagination est gérée automatiquement — le résultat est un tableau plat.

- `field` : `'created_at'` (défaut) ou `'updated_at'`

### `leads.list(query?: LeadsQuery): Promise<LeadsListResult>`

Retourne une page de leads.

| Paramètre | Type | Description |
|---|---|---|
| `search` | `Record<string, string>` | Filtres par champ (voir ci-dessous) |
| `orderby` | `string` | Champ de tri : `created_at`, `updated_at`, `status`, etc. |
| `order` | `'asc' \| 'desc'` | Ordre de tri |
| `limit` | `number` | Nombre de résultats par page (défaut : 20) |
| `page` | `number` | Numéro de page (défaut : 1) |

**Filtres `search` disponibles :**

| Clé | Exemple |
|---|---|
| `id` | `{ id: '42' }` |
| `email` | `{ email: 'client@exemple.com' }` |
| `status` | `{ status: 'new' }` |
| `external_lead_id` | `{ external_lead_id: 'MON-CRM-001' }` |
| `external_customer_id` | `{ external_customer_id: 'CLIENT-456' }` |
| `created_at` | `{ created_at: '>2024-01-01' }` |
| `updated_at` | `{ updated_at: '>=2024-06-01 00:00:00' }` |

Les opérateurs de comparaison pour les dates : `>`, `>=`, `<`, `<=` (préfixe la valeur).

Retourne `{ results: Lead[], total: number }`.

### `leads.listByStore(storeId: number, query?: LeadsQuery): Promise<LeadsListResult>`

Identique à `list()` mais limité à un point de vente spécifique. Mêmes paramètres `query`.

---

## Référence — Événements webhook

| Événement | Handler | Champs principaux du payload |
|---|---|---|
| `new_lead` | `onNewLead` | Objet lead complet (`id`, `store_id`, `customer`, `interest`, `origin`, `seller`, `status`, `created_at`, …) |
| `update_lead` | `onUpdateLead` | `id`, `updated_at`, champs modifiés uniquement |
| `new_comment` | `onNewComment` | `lead_id`, `comment`, `created_at` |
| `new_rdv` | `onNewRdv` | `lead_id`, `start_time`, `location`, `detail` |
| `new_reminder` | `onNewReminder` | `lead_id`, `start_time`, `detail`, `type` (`offer` ou `recontact`) |
| `closure_lead` | `onClosureLead` | `lead_id`, `status` (`SUCCESS`, `CLOSED`, `CLOSE_OPERATOR`), `close_reason` |

Tous les handlers sont optionnels. Les événements sans handler enregistré sont silencieusement ignorés (ou routés vers `onUnknown` si défini).

> Pour la structure complète de chaque payload, consultez la [documentation webhooks](https://pro.scorimmo.com/webhook/doc).

---

## Gestion des erreurs

```js
import { ScorimmoApiError, ScorimmoAuthError } from 'scorimmo-node'

// Erreurs API
try {
  const lead = await client.leads.get(999)
} catch (err) {
  if (err instanceof ScorimmoAuthError) {
    // Identifiants incorrects ou token expiré
    console.error('Erreur d\'authentification : vérifiez vos identifiants')
  } else if (err instanceof ScorimmoApiError) {
    console.error(`Erreur API ${err.statusCode} : ${err.message}`)
    // Codes courants : 400 (requête invalide), 403 (accès refusé), 404 (lead inexistant)
  }
}
```

Les erreurs webhook (`WebhookAuthError`, `WebhookValidationError`) sont gérées automatiquement par `webhook.middleware()` — pas besoin de les intercepter manuellement avec Express.

---

## Support

- Votre account manager Scorimmo
- [Formulaire de contact](https://pro.scorimmo.com/contact)
- [pro.scorimmo.com](https://pro.scorimmo.com)