import { createHash, randomBytes } from 'node:crypto'
import { ScorimmoApiError } from './client.js'
import type { OAuthClientRegistration, OAuthTokenResponse, ScorimmoOAuthConfig } from './types.js'
import { USER_AGENT } from './version.js'

/**
 * Flux OAuth 2.1 `authorization_code` + PKCE de l'API Scorimmo v2 (RFC 6749 / RFC 7636).
 *
 * Destiné aux outils tiers qui agissent pour le compte d'un utilisateur sans manipuler son
 * mot de passe. Le client OAuth est public : aucun `client_secret`, la sécurité de l'échange
 * repose sur PKCE. Ces endpoints ne demandent pas d'authentification, d'où une classe
 * distincte de `ScorimmoClient`, qui exige des identifiants à la construction.
 *
 * Endpoints couverts :
 *  - POST /api/v2/oauth/register  → `register()`
 *  - GET  /api/v2/oauth/authorize → `authorizationUrl()` (à ouvrir dans le navigateur de l'utilisateur)
 *  - POST /api/v2/oauth/token     → `exchangeCode()`
 *  - POST /api/v2/oauth/revoke    → `revoke()`
 *
 * Une fois les tokens obtenus, le client API prend le relais et renouvelle lui-même l'access token :
 * ```ts
 * const client = new ScorimmoClient({ refreshToken: tokens.refresh_token, oauthClientId: clientId })
 * ```
 */
export class ScorimmoOAuth {
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(config: ScorimmoOAuthConfig = {}) {
    this.baseUrl = (config.baseUrl ?? 'https://pro.scorimmo.com').replace(/\/$/, '')
    this.timeoutMs = config.timeoutMs ?? 25_000
  }

  /**
   * Génère un couple PKCE. Conserver `code_verifier` côté serveur jusqu'à `exchangeCode()`,
   * ne transmettre que `code_challenge` à `authorizationUrl()`.
   */
  static generatePkce(): { code_verifier: string; code_challenge: string } {
    const verifier = randomBytes(48).toString('base64url')
    return {
      code_verifier: verifier,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    }
  }

  /**
   * Génère une valeur `state` à conserver en session, puis à comparer à celle reçue sur le
   * `redirect_uri`, pour se prémunir du CSRF.
   */
  static generateState(): string {
    return randomBytes(16).toString('hex')
  }

  /**
   * Enregistre l'outil comme client OAuth. À faire une seule fois par outil, pas par utilisateur.
   *
   * Hors localhost, seuls les hôtes autorisés par Scorimmo sont acceptés, en https. Les adresses
   * refusées sont retirées sans erreur : comparer `redirect_uris` de la réponse à la demande.
   *
   * @param redirectUris URL de callback de l'outil
   * @param clientName   Nom affiché sur l'écran de consentement (60 caractères max)
   */
  async register(redirectUris: string[], clientName?: string): Promise<OAuthClientRegistration> {
    if (redirectUris.length === 0) {
      throw new Error('register() requires at least one redirect URI')
    }
    return this.post<OAuthClientRegistration>('/api/v2/oauth/register', {
      redirect_uris: redirectUris,
      ...(clientName !== undefined ? { client_name: clientName } : {}),
    })
  }

  /**
   * Construit l'URL de consentement vers laquelle rediriger le navigateur de l'utilisateur.
   *
   * Après validation, Scorimmo redirige vers `redirectUri` avec `?code=...&state=...`,
   * ou `?error=...&error_description=...&state=...` en cas de refus.
   *
   * @param redirectUri Strictement identique à l'une des URL enregistrées
   */
  authorizationUrl(clientId: string, redirectUri: string, codeChallenge: string, state: string): string {
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })
    return `${this.baseUrl}/api/v2/oauth/authorize?${query.toString()}`
  }

  /**
   * Échange le code reçu sur le `redirect_uri` contre une paire de tokens. À appeler depuis
   * le backend : le code est à usage unique et expire au bout de 60 secondes.
   *
   * Le refresh token retourné tourne à chaque renouvellement. Présenter à nouveau un token déjà
   * remplacé révoque toute la chaîne : l'utilisateur devra autoriser l'outil à nouveau.
   *
   * @param redirectUri Strictement identique à celui passé à `authorizationUrl()`
   * @throws ScorimmoApiError 400 (`invalid_grant`, `invalid_client`) ou 403 (`access_denied`), exposés dans `apiCode`
   */
  async exchangeCode(code: string, codeVerifier: string, redirectUri: string, clientId: string): Promise<OAuthTokenResponse> {
    return this.post<OAuthTokenResponse>('/api/v2/oauth/token', {
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: clientId,
    })
  }

  /**
   * Révoque un refresh token OAuth (RFC 7009). L'API répond 200 même si le token est inconnu ;
   * l'access token déjà émis reste valable jusqu'à son expiration.
   */
  async revoke(refreshToken: string): Promise<void> {
    await this.post<unknown>('/api/v2/oauth/revoke', { token: refreshToken })
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new ScorimmoApiError(`HTTP error: ${msg}`, 0)
    } finally {
      clearTimeout(timer)
    }

    const data = (await res.json().catch(() => null) ?? {}) as { error?: string; error_description?: string }

    if (!res.ok) {
      throw new ScorimmoApiError(data.error_description ?? data.error ?? `HTTP ${res.status}`, res.status, data.error, data)
    }

    return data as T
  }
}
