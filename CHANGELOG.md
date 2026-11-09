# Changelog

Les versions suivent le [versionnage sémantique](https://semver.org/lang/fr/). À chaque release, le numéro de cette page, `package.json`, `SDK_VERSION` (`src/version.ts`) et le tag git `vX.Y.Z` doivent correspondre.

La version du SDK est distincte de `X-Scorimmo-Version`, qui date le contrat de l'API.

## [1.1.0] - 2026-11-09

### Ajouté

- Campagnes : `campaigns`, `campaignFields`, `campaignContacts`, dont `campaignContacts.inject()`.
- Abonnements webhook : `webhooks` (`list`, `get`, `errors`, `create`, `update`, `delete`).
- Réception des événements `campaign_contact_updated`, `campaign_contact_closed` et `campaign_closed` (`onCampaignContactUpdated`, `onCampaignContactClosed`, `onCampaignClosed`).
- Authentification OAuth : classe `ScorimmoOAuth` et option `oauthClientId` de `ScorimmoClient`.
- Refresh tokens : `listTokens()`, `deleteToken()` et option `tokenName`.
- `ScorimmoApiError` expose `body`, `retryAfter` et `getFieldErrors()`.
- En-tête `User-Agent: scorimmo-node/<version>` et export `SDK_VERSION`.

### Corrigé

- `revokeToken()` envoie le Bearer exigé par l'API, qui répondait toujours 401.
- Les messages d'erreur des routes `/auth/*` et `/oauth/*` ne sont plus remplacés par `HTTP <code>`.

### Modifié

- `form.submit()` : `customer.civility` devient `customer.title`. L'ancienne clé est dépréciée mais encore convertie par le SDK.
- Types : `to_email` n'accepte plus de tableau, que l'API refusait.
- Types : le filtre `external_lead_id` de `LeadsListQuery` est retiré, car le serveur l'ignorait.

### Documentation

- Limite de 5 refresh tokens actifs par compte.

## [1.0.0] - 2026-09-01

Première version stable.
