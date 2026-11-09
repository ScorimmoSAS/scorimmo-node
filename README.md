# scorimmo-node

SDK officiel Node.js / TypeScript pour l'API v2 de [Scorimmo](https://pro.scorimmo.com).

Facilite l'intégration des leads Scorimmo dans votre CRM en deux modes :
- **Client API v2** — récupérez et mettez à jour vos leads, contacts, statuts et référentiels avec gestion automatique du couple access token / refresh token. La **création** de leads n'est pas exposée (voir plus bas).
- **Réception de webhooks** — recevez les événements Scorimmo en temps réel, avec vérification HMAC-SHA256 optionnelle

> **Documentation de référence :**
> [API REST v2](https://pro.scorimmo.com/api/v2/doc) · [Webhooks](https://pro.scorimmo.com/webhook/doc)

---

## Sommaire

- [Installation](#installation)
- [Identifiants API](#identifiants-api)
- [Client API](#client-api)
- [Ressources exposées](#ressources-exposées)
- [Formulaires publics](#formulaires-publics)
- [Appels sortants (webCallbacks)](#appels-sortants-webcallbacks)
- [Campagnes](#campagnes)
- [Abonnements webhook](#abonnements-webhook)
- [Webhooks — Express](#webhooks--express)
- [Référence — Méthodes leads](#référence--méthodes-leads)
- [Référence — Ressources secondaires](#référence--ressources-secondaires)
- [Référence — Gestion des tokens](#référence--gestion-des-tokens)
- [Référence — Authentification OAuth](#référence--authentification-oauth)
- [Référence — Événements webhook](#référence--événements-webhook)
- [Gestion des erreurs](#gestion-des-erreurs)
- [Support](#support)

---

## Installation

```bash
npm install scorimmo-node
```

**Prérequis :** Node.js ≥ 18.

---

## Identifiants API

Les identifiants (`email` / `password`) sont ceux fournis par Scorimmo. En API v2, l'identifiant est l'adresse email du compte API.

Après le premier appel authentifié, un **refresh token** est disponible via `getRefreshToken()`. Il permet de réhydrater le client sans repasser par les identifiants — voir [Gestion des tokens](#référence--gestion-des-tokens).

Pour le webhook, le secret HMAC (`SCORIMMO_WEBHOOK_SIGNATURE_SECRET`) est une valeur que vous choisissez librement — communiquez-la ensuite à Scorimmo lors de la configuration (voir [Configurer le webhook chez Scorimmo](#configurer-le-webhook-chez-scorimmo)).

---

## Client API

### Initialisation

**Avec identifiants email/password :**

```ts
import { ScorimmoClient } from 'scorimmo-node'

const client = new ScorimmoClient({
  email: 'api@votre-agence.fr',
  password: 'votre-mot-de-passe',
  // baseUrl: 'https://pro.scorimmo.com', // par défaut
})
```

**Avec un refresh token persisté (sans exposer les identifiants) :**

```ts
const client = new ScorimmoClient({ refreshToken: persistedToken })
// Après chaque appel, récupérer et re-persister le nouveau refresh token :
const next = client.getRefreshToken()
```

L'access token est géré automatiquement (fetch, cache, refresh silencieux à expiration, retry unique sur 401).

### Récupérer les leads récents

```ts
// Tous les leads créés dans les 24 dernières heures (pagination automatique + dédoublonnage)
const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
const leads = await client.leads.since(since)

// Depuis une date précise avec relations et callback de progression
const leads = await client.leads.since(
  '2026-06-01T00:00:00Z',
  'created_at',
  100,           // maxPages
  776,           // storeId (optionnel)
  ['customer', 'seller'],
  (page, count, total, meta) => console.log(`Page ${page} — ${total} leads`),
)

// Leads modifiés récemment (plutôt que créés)
const updated = await client.leads.since(since, 'updated_at')
```

### Récupérer un lead par ID

```ts
const lead = await client.leads.get(42)

// Avec relations
const lead = await client.leads.get(42, ['customer', 'seller', 'appointments', 'comments'])
```

### Rechercher des leads

```ts
// Combinaison de filtres et opérateurs bracket
const result = await client.leads.list({
  seller_id: 3533,
  status: 'Affecté',
  'created_at[gte]': '2026-03-01T00:00:00+00:00',
  sort: 'created_at:desc',
  limit: 20,
  include: 'customer,seller',
})

// result.data contient les leads, result.meta les infos de pagination
for (const lead of result.data) {
  console.log(lead.id, lead.customer?.first_name)
}
```

### Mise à jour partielle

```ts
await client.leads.update(42, { external_lead_id: 'CRM-456' })
```

> La **création** de leads n'est volontairement pas exposée par ce SDK — les leads doivent être créés depuis l'UI Scorimmo, via l'endpoint public de formulaire (`client.form.submit()`) ou par les imports.

---

## Ressources exposées

Toutes les ressources ci-dessous exposent `list(query?)` et `get(id)` (sauf mention contraire). Chaque `list()` retourne `{ data: T[], meta: PaginationMeta }`.

| Propriété | Endpoint racine | Scope |
|---|---|---|
| `client.leads` | `/api/v2/leads` | `lead:read` / `lead:write` (pour `update()`) |
| `client.appointments` | `/api/v2/appointments` | `lead:read` |
| `client.comments` | `/api/v2/comments` | `lead:read` |
| `client.reminders` | `/api/v2/reminders` | `lead:read` |
| `client.requests` | `/api/v2/requests` | `lead:read` |
| `client.stores` | `/api/v2/stores` | `ref:read` |
| `client.users` | `/api/v2/users` | `ref:read` |
| `client.customers` | `/api/v2/customers` | `ref:read` |
| `client.status` | `/api/v2/status` | `ref:read` |
| `client.origins` | `/api/v2/origins` | `ref:read` |
| `client.additionalFields` | `/api/v2/additional_fields` | `ref:read` |
| `client.requestFields` | `/api/v2/requests/fields` | `ref:read` |
| `client.form` | `POST /api/v2/form` | `ROLE_API_FORM_WRITE` |
| `client.webCallbacks` | `POST /api/v2/webcallbacks` | Clé WCB (pas de Bearer) |
| `client.campaigns` | `/api/v2/campaigns` | `campaign:read` |
| `client.campaignFields` | `/api/v2/campaigns/fields` | `campaign:read` |
| `client.campaignContacts` | `/api/v2/campaigns/contacts` | `campaign:read` / `campaign:write` (pour `inject()`) |
| `client.webhooks` | `/api/v2/webhooks` | `ROLE_API_WEBHOOK_READ` / `ROLE_API_WEBHOOK_WRITE` |

---

## Formulaires publics

Le SDK expose l'endpoint public de soumission de formulaires — crée un lead et envoie un email au(x) destinataire(s). **Scope requis : `ROLE_API_FORM_WRITE`** (à demander séparément de `lead:write`).

```ts
const res = await client.form.submit({
  store_id: 776,
  libelle_id: 12,
  to_email: 'contact@agence.fr',
  origin: 'Site web',
  message: 'Je souhaite visiter le bien X.',
  subject: 'Demande de visite',          // optionnel
  customer: {
    title: 'M.',                         // anciennement `civility`
    first_name: 'Jean',
    last_name: 'Dupont',
    email: 'jean@example.com',
    phone: '0612345678',
  },
  requests: [/* { label => valeur } */],
  additional_fields: [/* { label => valeur } */],
  external_lead_id: 'CRM-12345',
})
// res = { status: 200, message: 'email created', id: 42, store_id: 776, ... }
```

---

## Appels sortants (webCallbacks)

Déclenche un appel depuis le PBX Scorimmo vers un numéro. **N'utilise pas l'auth Bearer** — passez la clé personnelle « WebCallback » fournie par Scorimmo pour votre point de vente.

```ts
await client.webCallbacks.launch('votre-cle-wcb', '+33612345678')
// { results: ['...'], information: 200 }
```

Seuls les fixes et mobiles de France métropolitaine sont acceptés (`400` sinon). En cas de `429`, réessayez après `err.retryAfter` secondes.

---

## Campagnes

| Ressource | Paramètres de `list()` | Tri |
|---|---|---|
| `campaigns` | `ids`, `store_id`, `status` (`upcoming`, `open`, `closed`) | `id`, `name`, `start`, `end` |
| `campaignFields` | `campaign_id`, `store_id` | - |
| `campaignContacts` | `campaign_id` (obligatoire), `ids`, `status` (`new`, `recontact`, `no_answer`, `closed`, `validated`), `sub_status` (`no_follow`, `refuse_answer`, `delete_contact`, `no_answer`), `created_at[gte]`, `updated_at[gte]`, `last_contact_at[gte]` | `id`, `created_at`, `updated_at`, `last_contact_at` |

`campaignContacts.inject()` ajoute jusqu'à 100 contacts à une campagne. `last_name` et `phone` sont obligatoires ; les clés de `answers` sont les `label` retournés par `campaignFields`. Chaque contact est validé séparément :

```ts
const report = await client.campaignContacts.inject(12, [
  { last_name: 'Dupont', phone: '0612345678', answers: { Budget: 250000 } },
  { last_name: 'Martin', phone: 'invalide' },
])
// report.meta = { received: 2, created: 1, rejected: 1 }
// report.data[1] = { index: 1, status: 'rejected', errors: [{ field: 'phone', message: '...' }] }
```

Le compte rendu est retourné même si tous les contacts sont refusés. Une erreur est levée si la campagne est introuvable (`404`) ou clôturée (`422`), ou si une autre injection est en cours sur la campagne (`409` : réessayez quelques secondes plus tard).

---

## Abonnements webhook

**Scopes requis : `ROLE_API_WEBHOOK_READ`** en lecture, **`ROLE_API_WEBHOOK_WRITE`** en écriture.

```ts
const webhook = await client.webhooks.create({
  store_id: 5,
  name: 'CRM sync',
  url: 'https://votre-app.com/webhook/scorimmo',
  events: ['CREATION_LEAD', 'UPDATE_LEAD'],
  headers: [{ key: 'X-Signature-256', value: 'sha256=votre-secret' }], // optionnel
  interests: ['Location'],                                             // optionnel : tous par défaut
})

await client.webhooks.update(webhook.id, { events: ['CLOSE_LEAD'] })
await client.webhooks.delete(webhook.id)

// Échecs de livraison
const errors = await client.webhooks.errors({ store_id: 5, status: 500 })
```

Codes d'évènement : `CREATION_LEAD`, `UPDATE_LEAD`, `NEW_COMMENT`, `RDV`, `REMINDER`, `CLOSE_LEAD`, `CAMPAIGN_CONTACT_UPDATE`, `CAMPAIGN_CONTACT_CLOSED`, `CAMPAIGN_CLOSED`. Les codes `CAMPAIGN_*` sont réservés aux webhooks en version 2 : vérifiez le champ `version` de vos webhooks, l'API répond `400` sur un webhook v1.

`list()` accepte `ids`, `store_id`, `name`, `version`, `event`, `created_at[gte]`, `created_at[lte]` et le tri sur `id`, `created_at`, `updated_at`, `name`. `errors()` accepte `store_id`, `webhook_name`, `code`, `status` (code HTTP retourné par votre URL), `created_at[gte]`, `created_at[lte]`.

---

## Webhooks — Express

Les webhooks permettent à Scorimmo de notifier votre application en temps réel (nouveau lead, mise à jour, commentaire, rendez-vous, rappel, clôture).

### Initialisation

L'authentification des webhooks est **optionnelle** — la sécurisation de l'endpoint est à la charge de l'intégrateur. Plusieurs mécanismes complémentaires sont possibles :

1. **Signature HMAC-SHA256** (fortement recommandé) — Scorimmo signe le corps brut avec un secret partagé et envoie la signature dans le header `X-Signature-256` sous la forme `sha256=<hex>`. Le SDK la vérifie en temps constant via `crypto.timingSafeEqual`.
2. **HTTP Basic auth via URL** — enregistrez le webhook comme `https://user:pass@host/path`, l'auth est déléguée au serveur/framework.
3. **Restriction réseau** (IP whitelist, VPN, mTLS…) — hors périmètre du SDK.

**Avec signature HMAC (recommandé) :**

```ts
import { ScorimmoWebhook } from 'scorimmo-node'

const webhook = new ScorimmoWebhook({
  signatureSecret: process.env.SCORIMMO_WEBHOOK_SIGNATURE_SECRET,
  // signatureHeader: 'X-Signature-256', // valeur par défaut, personnalisable
})
```

**Sans vérification** (auth déportée sur le serveur) :

```ts
const webhook = new ScorimmoWebhook()
```

> **Important :** si vous activez la signature, il faut lire le **corps brut** (avant tout `JSON.parse`) et le passer à `parse()`/`handle()`. Sous Express, remplacez `express.json()` par `express.raw({ type: 'application/json' })` sur cette route.

### Réception (Express)

```ts
import express from 'express'
import { ScorimmoWebhook, WebhookAuthError, WebhookValidationError } from 'scorimmo-node'

const app = express()
const webhook = new ScorimmoWebhook({
  signatureSecret: process.env.SCORIMMO_WEBHOOK_SIGNATURE_SECRET,
})

app.post(
  '/webhook/scorimmo',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const rawBody = (req.body as Buffer).toString('utf8')
    try {
      await webhook.handle(req.headers, rawBody, {
        onNewLead:      async (lead)  => { /* … */ },
        onUpdateLead:   async (event) => { /* payload sparse : champs modifiés */ },
        onNewComment:   async (event) => { /* … */ },
        onNewRdv:       async (event) => { /* … */ },
        onNewReminder:  async (event) => { /* … */ },
        onClosureLead:  async (event) => {
          // event.status = 'Succès' | 'Fermé' | "Fermé par l'opérateur"
        },
        onCampaignContactUpdated: async (event) => { /* webhooks v2 */ },
        onCampaignContactClosed:  async (event) => { /* webhooks v2 */ },
        onCampaignClosed:         async (event) => { /* webhooks v2 */ },
        onUnknown:      async (event) => {
          // Événement futur (X-Scorimmo-Event: webhook.<name>)
          console.warn('scorimmo.unknown_event', event)
        },
      })
      res.sendStatus(200)
    } catch (err) {
      if (err instanceof WebhookAuthError)      res.status(401).json({ error: err.message })
      else if (err instanceof WebhookValidationError) res.status(400).json({ error: err.message })
      else { console.error(err); res.sendStatus(500) }
    }
  },
)
```

> Scorimmo considère la livraison réussie uniquement si votre endpoint retourne HTTP 200. Tout autre code déclenche un retry.

### Headers webhook

| Header | Exemple | Description |
|---|---|---|
| `X-Signature-256` | `sha256=8f4c…` | Signature HMAC-SHA256 du corps brut — présent si un secret est configuré ; nom personnalisable |
| `X-Scorimmo-Event` | `lead.created` | Nom sémantique de l'événement |
| `X-Scorimmo-Version` | `2026-04-20` | Version d'API (format date `YYYY-MM-DD`) |
| `User-Agent` | `Scorimmo/1.42.0` | Version applicative Scorimmo |

Helpers de lecture :

```ts
webhook.getSemanticEvent(req.headers)  // 'lead.created' | 'webhook.<name>' | null
webhook.getApiVersion(req.headers)     // '2026-04-20' | null
```

### Correspondance événements ↔ header

| `event` (payload) | `X-Scorimmo-Event` |
|---|---|
| `new_lead` | `lead.created` |
| `update_lead` | `lead.updated` |
| `closure_lead` | `lead.closed` |
| `new_comment` | `lead.comment_added` |
| `new_rdv` | `lead.appointment_created` |
| `new_reminder` | `lead.reminder_created` |
| `campaign_contact_updated` | `campaign.contact_updated` |
| `campaign_contact_closed` | `campaign.contact_closed` |
| `campaign_closed` | `campaign.closed` |
| _(événement futur inconnu)_ | `webhook.<name>` |

> Enregistrez un handler `onUnknown` pour capturer les événements futurs — Scorimmo peut ajouter de nouveaux événements sans breaking change.

### Idempotence & retries

Scorimmo effectue jusqu'à **6 tentatives de livraison** (initial + 5 retries) avec backoff exponentiel (5 s → 60 s max). Le corps et la signature sont identiques à chaque retry. Aucun `Idempotency-Key` n'est envoyé — votre récepteur doit être idempotent (dédupliquer sur `(event, lead_id, created_at)` ou `(event, id, updated_at)`). Pour les campagnes : `(event, contact_id, updated_at)`, `(event, contact_id, closed_at)` ou `(event, campaign_id, closed_at)`.

### Configurer le webhook chez Scorimmo

Un compte disposant du droit `ROLE_API_WEBHOOK_WRITE` peut créer l'abonnement lui-même avec [`client.webhooks.create()`](#abonnements-webhook). Sinon, transmettez ces informations à votre account manager Scorimmo :

```
URL du webhook : https://votre-app.com/webhook/scorimmo

Authentification (au choix, fortement recommandé) :
  Option A - Signature HMAC-SHA256 (recommandé)
    Le back-office Scorimmo n'a pas de champ « secret » dédié : la signature
    se configure via un header custom, en convention in-place.

    Dans l'écran de configuration du webhook, ajoutez un header custom :
      Nom    : X-Signature-256
               (nom libre côté back, MAIS il doit correspondre à
                `signatureHeader` côté SDK — valeur par défaut du SDK :
                X-Signature-256. Si vous choisissez un autre nom, pensez à
                le passer via `signatureHeader:` à `ScorimmoWebhook`.)
      Valeur : sha256=<votre-secret>
               (le préfixe `sha256=` est obligatoire — c'est ce qui déclenche
                la convention. Le back détecte le préfixe, extrait la partie
                après `sha256=` comme secret HMAC, puis remplace la valeur
                envoyée par :
                   sha256=<hex(hmac_sha256(rawBody, <votre-secret>))>
                avant l'appel HTTP.)

    Secret côté SDK :
      La chaîne que vous avez collée après `sha256=` ci-dessus doit être
      strictement identique à `SCORIMMO_WEBHOOK_SIGNATURE_SECRET`
      (paramètre `signatureSecret` de `ScorimmoWebhook`).

  Option B - HTTP Basic auth via URL
    URL : https://user:pass@votre-app.com/webhook/scorimmo

Événements à activer :
  ☑ Nouveau lead        (new_lead)
  ☑ Mise à jour lead    (update_lead)
  ☑ Nouveau commentaire (new_comment)
  ☑ Rendez-vous         (new_rdv)
  ☑ Rappel              (new_reminder)
  ☑ Clôture lead        (closure_lead)
  ☑ Contact de campagne modifié (campaign_contact_updated) — webhook v2 uniquement
  ☑ Contact de campagne clôturé (campaign_contact_closed)  — webhook v2 uniquement
  ☑ Campagne clôturée           (campaign_closed)          — webhook v2 uniquement

Point(s) de vente concerné(s) : [indiquez vos points de vente]
```

---

## Référence — Méthodes leads

### `leads.get(id, include?)`

Retourne un lead par ID. `include` est un tableau parmi `'customer' | 'seller' | 'appointments' | 'reminders' | 'requests' | 'comments'`.

### `leads.since(date, field?, maxPages?, storeId?, include?, onProgress?)`

Retourne tous les leads créés (ou modifiés) après `date`. Pagination automatique + dédoublonnage par `id`.

- `date` — `Date` ou chaîne `Y-m-d`, `Y-m-d H:i:s`, ou ISO 8601
- `field` — `'created_at'` (défaut) ou `'updated_at'`
- `maxPages` — plafond de pages (défaut : 100 ≈ 10 000 leads avec `limit=100`)
- `storeId` — restreint à un point de vente
- `include` — relations à charger
- `onProgress` — callback `(page, count, total, meta)` après chaque page

### `leads.update(id, data)`

Mise à jour partielle. Champs acceptés : `seller_id`, `origin`, `external_lead_id`, `external_customer_id`, `additional_fields` (remplacement complet du bloc).

### `leads.list(query?)`

Retourne une page `{ data, meta }`.

| Paramètre | Type | Description |
|---|---|---|
| `page` | `number` | Numéro de page (défaut 1) |
| `limit` | `number` | Résultats par page (défaut 10, max 100). `leads.since()` force `limit=100` en interne. |
| `sort` | `string` | Tri `'champ:asc\|desc'` — champs : `id`, `created_at`, `updated_at`, `status` |
| `include` | `string` | Relations : `'customer,seller,appointments,comments'` |
| `store_id` | `number` | Restreint à un point de vente |
| `seller_id` | `number` | Restreint à un conseiller |
| `status` | `string` | Statut |
| `substatus` | `string` | Sous-statut |
| `interest` | `string` | Intérêt (`TRANSACTION`, `LOCATION`…) |
| `origin` | `string` | Origine |
| `contact_type` | `'physical'\|'phone'\|'digital'` | |
| `purpose` | `string` | `Achat`, `Location`, `Vente`, `Recherche`… |
| `customer_first_name`, `customer_last_name` | `string` | |
| `customer.email`, `customer.phone` | `string` | Email / téléphone du contact |
| `requests_reference` | `string` | Référence du bien |
| `ids` | `string` | Liste d'IDs séparés par virgule |
| `created_at[eq\|gte\|lte]`, `updated_at[eq\|gte\|lte]` | `string` | Filtres de date (ISO 8601) |

---

## Référence — Ressources secondaires

### Rendez-vous — `appointments`, Commentaires — `comments`, Rappels — `reminders`, Demandes — `requests`

Lecture seule (`list` + `get`). Filtres : `ids`, `lead_id`, filtres de date bracket (`created_at[gte]`, `updated_at[lte]`, `start_time[gte]`…), pagination + `sort`.

### Utilisateurs — `users`

| Paramètre | Type | Description |
|---|---|---|
| `store_id` | `number` | Point de vente |
| `interest` | `string` | Filtrer par intérêt |
| `role` | `'admin' \| 'manager' \| 'agent' \| 'virtual'` | Rôle |
| `sort` | `string` | `id`, `last_name`, `created_at` |

### Contacts — `customers`

| Paramètre | Type | Description |
|---|---|---|
| `search` | `string` | Recherche libre |
| `email` | `string` | Email exact |
| `phone` | `string` | Téléphone (OR sur `phone` / `other_phone`) |

### Statuts — `status`

| Paramètre | Type | Description |
|---|---|---|
| `ids` | `string` | Liste CSV d'IDs |
| `interest` | `string` | Liste CSV d'intérêts (ex `'TRANSACTION,LOCATION'`) |
| `store_id` | `string` | Liste CSV de stores |

Réponse : `[{ label, sub_status[]|null }, …]`.

### Origines — `origins`

| Paramètre | Type | Description |
|---|---|---|
| `store_id` | `number` | Point de vente |
| `has_tracking` | `boolean` | `true` = origines avec au moins un traceur actif |
| `tracking_channel` | `'phone' \| 'email'` | |
| `include` | `string` | `'tracking'` pour inclure les traceurs |

### Points de vente — `stores`, Champs additionnels — `additionalFields`, Champs de demande — `requestFields`

Liste paginée simple. Utilisez `store_id` / `interest` pour filtrer les champs.

---

## Référence — Gestion des tokens

Le client gère automatiquement l'access token. À chaque expiration, il tente d'abord un refresh silencieux, puis bascule sur email/password si nécessaire.

```ts
// Cycle recommandé pour un déploiement long-running :
const client = new ScorimmoClient({ email, password })
await client.getToken()
const refreshToken = client.getRefreshToken()
// → persister $refreshToken (Redis, base, coffre-fort…)

// Démarrages suivants — sans identifiants :
const client = new ScorimmoClient({ refreshToken: loaded })
await client.getToken()
const next = client.getRefreshToken() // à re-persister (rotation à chaque échange)
```

> **Limite de 5 refresh tokens actifs par compte.** Chaque authentification par email/password en crée un, et le 6e appel échoue en `403`. Persistez le refresh token plutôt que de vous authentifier à chaque exécution. En cas de blocage, libérez une place avec `listTokens()` et `deleteToken()`, ou `revokeToken()`.

L'option `tokenName` du constructeur (100 caractères max) nomme la session créée par email/password, pour la retrouver dans `listTokens()`.

Autres méthodes :

- `client.refreshAccessToken(refreshToken)` — échange explicite, retourne la nouvelle paire.
- `client.revokeToken(refreshToken?)` — révoque un token (ou tous si non passé).
- `client.validateToken()` — introspection : `{ version, status, authenticated, scopes[], stores_id[], interests[] }`.
- `client.listTokens()` — refresh tokens actifs (`data[]` : `id`, `name`, `ip_address`, `user_agent`, `source`, `created_at`, `expires_at`).
- `client.deleteToken(id)` — révoque un refresh token par son identifiant.

---

## Référence — Authentification OAuth

Pour un outil tiers qui agit au nom d'un utilisateur Scorimmo sans manipuler son mot de passe (`authorization_code` + PKCE). Le compte qui autorise doit disposer de `ROLE_API`. Pour une intégration serveur à serveur, préférez l'authentification par email/password.

**1. Enregistrer l'outil** — une seule fois par outil, puis conserver le `client_id` :

```ts
import { ScorimmoClient, ScorimmoOAuth } from 'scorimmo-node'

const oauth = new ScorimmoOAuth()
const registration = await oauth.register(['https://votre-app.com/oauth/callback'], 'Mon outil')
const clientId = registration.client_id
```

Hors `localhost`, l'URL de callback doit être en `https` sur un hôte autorisé par Scorimmo. Les adresses refusées sont retirées sans erreur : vérifiez `redirect_uris` dans la réponse.

**2. Rediriger l'utilisateur vers l'écran de consentement :**

```ts
const pkce = ScorimmoOAuth.generatePkce()
const state = ScorimmoOAuth.generateState()

req.session.oauth = { verifier: pkce.code_verifier, state }

res.redirect(oauth.authorizationUrl(
  clientId,
  'https://votre-app.com/oauth/callback',
  pkce.code_challenge,
  state,
))
```

**3. Sur le callback, échanger le code** (usage unique, valable 60 secondes) :

```ts
if (req.query.state !== req.session.oauth.state) return res.sendStatus(400)

if (req.query.error) {
  // Refus de l'utilisateur ou compte sans accès API : req.query.error_description
  return res.sendStatus(403)
}

const tokens = await oauth.exchangeCode(
  String(req.query.code),
  req.session.oauth.verifier,
  'https://votre-app.com/oauth/callback',
  clientId,
)
// → persister tokens.refresh_token côté serveur, jamais dans le navigateur
```

**4. Appeler l'API :**

```ts
const scorimmo = new ScorimmoClient({ refreshToken: tokens.refresh_token, oauthClientId: clientId })

const leads = await scorimmo.leads.list()

// → re-persister après chaque session
const nextRefreshToken = scorimmo.getRefreshToken()
```

> **Persistez chaque nouveau refresh token.** Présenter un refresh token déjà remplacé révoque toute la chaîne, et l'utilisateur doit alors autoriser l'outil à nouveau. Dans ce cas, le client lève une `ScorimmoAuthError`.

Pour déconnecter l'outil : `await oauth.revoke(refreshToken)`. L'API répond `200` même si le token est inconnu, et l'access token déjà émis reste valable jusqu'à son expiration.

Les erreurs de `register()`, `exchangeCode()` et `revoke()` lèvent une `ScorimmoApiError`, avec le code OAuth dans `err.apiCode` (`invalid_grant`, `invalid_client`, `invalid_redirect_uri`, `access_denied`…).

---

## Référence — Événements webhook

### `new_lead`

Objet lead complet : `id`, `store_id`, `interest`, `origin`, `status`, `contact_type`, `seller_present_on_creation`, `customer { first_name, last_name, email, phone, other_phone, pro, legal_name, former }`, `seller { id, first_name, last_name, email, is_virtual? }`, `requests` (array avec clés en français : `"Type de bien"`, `"Prix"`, `"Surface"`, `"Ville"`, `"Code postal"`, `"Référence"`/`"Programme"`), `additional_fields`, `comments`, `external_lead_id?`, `external_customer_id?`.

### `update_lead`

Payload **sparse** : `id`, `updated_at`, + uniquement les champs modifiés (sous-arbres `customer`, `seller`, `requests`, `additional_fields`, `store_id`).

### `new_comment`

`lead_id`, `comment`, `created_at`, `external_lead_id?`.

### `new_rdv`

`lead_id`, `created_at`, `start_time`, `location`, `detail` (`Estimation`, `Découverte`, `Visite`, `Suivi`, `Proposition`, `Signature`, ou `null`), `comment`, `external_lead_id?`.

### `new_reminder`

`lead_id`, `created_at`, `start_time`, `detail` (`offer` ou `recontact`), `comment`, `external_lead_id?`.

### `closure_lead`

| Champ | Type | Valeurs |
|---|---|---|
| `lead_id` | `number` | |
| `status` | `string` | `'Succès'`, `'Fermé'`, `"Fermé par l'opérateur"` |
| `close_reason` | `string?` | Présent uniquement quand `status = 'Fermé'` ou `'Succès'` |
| `external_lead_id` | `string?` | |

### `campaign_contact_updated` — Contact de campagne modifié

Webhooks v2 uniquement. `contact_id`, `campaign_id`, `store_id`, `updated_at`, puis les seuls champs modifiés : `status`, `sub_status` (peut valoir `null`), `answers` (réponses nouvelles ou changées, indexées par `label`), `customer` (champs modifiés, `null` pour un champ vidé). Un passage à `closed` ou `validated` émet `campaign_contact_closed` à la place.

### `campaign_contact_closed` — Contact de campagne clôturé

Webhooks v2 uniquement. État complet du contact à son passage à `closed` ou `validated` : `contact_id`, `campaign_id`, `store_id`, `status`, `sub_status`, `customer`, `answers` (une entrée par question, `null` sans réponse), `comment`, `call_count`, `first_contact_at`, `last_contact_at`, `closed_at`. La clôture manuelle d'une campagne n'émet aucun évènement par contact : seul `campaign_closed` part.

### `campaign_closed` — Campagne clôturée

Webhooks v2 uniquement. `campaign_id`, `store_id`, `name`, `start`, `end` (`Y-m-d`), `closed_at` (`Y-m-d H:i:s`), `close_reason` (`manual` pour une clôture manuelle, `end_date` si la date de fin est atteinte).

> Pour la structure complète, consultez la [documentation webhooks](https://pro.scorimmo.com/webhook/doc).

---

## Gestion des erreurs

```ts
import { ScorimmoApiError, ScorimmoAuthError, WebhookAuthError, WebhookValidationError } from 'scorimmo-node'

try {
  const lead = await client.leads.get(999)
} catch (err) {
  if (err instanceof ScorimmoAuthError) {
    // Identifiants incorrects / refresh révoqué
  } else if (err instanceof ScorimmoApiError) {
    // err.statusCode = 400 | 403 | 404 | ...
    // err.apiCode    = 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | ...
    // err.getFieldErrors() = [{ field: 'email', message: '...' }] sur un 422
    // err.retryAfter = secondes à attendre sur un 429, sinon undefined
    // err.body       = corps JSON complet de la réponse d'erreur
  }
}
```

Côté webhook, `WebhookAuthError` → HTTP 401, `WebhookValidationError` → HTTP 400.

---

## Support

- Votre account manager Scorimmo
- [Formulaire de contact](https://pro.scorimmo.com/contact)
- [pro.scorimmo.com](https://pro.scorimmo.com)
