import { describe, it, expect, jest } from '@jest/globals'
import { createHash } from 'node:crypto'
import { ScorimmoClient, ScorimmoApiError, ScorimmoAuthError } from '../client.js'
import { ScorimmoOAuth } from '../oauth.js'

const baseUrl = 'https://app.scorimmo.com'
const oauthTokens = { access_token: 'jwt-oauth', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rotated', scope: 'api_v2' }

function mockFetch(json: unknown, status = 200) {
  const fetch = jest.fn().mockImplementation(() => Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: () => Promise.resolve(json),
  }))
  global.fetch = fetch as unknown as typeof global.fetch
  return fetch
}

function lastCall(fetch: jest.Mock): { url: string; body: unknown } {
  const [url, init] = fetch.mock.calls[fetch.mock.calls.length - 1] as [string, { body: string }]
  return { url, body: JSON.parse(init.body) }
}

describe('ScorimmoOAuth — PKCE', () => {
  it('generatePkce() produit un challenge S256', () => {
    const { code_verifier, code_challenge } = ScorimmoOAuth.generatePkce()
    expect(code_verifier.length).toBeGreaterThanOrEqual(43)
    expect(code_verifier.length).toBeLessThanOrEqual(128)
    expect(code_verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(code_challenge).toBe(createHash('sha256').update(code_verifier).digest('base64url'))
  })

  it('génère des valeurs uniques', () => {
    expect(ScorimmoOAuth.generatePkce().code_verifier).not.toBe(ScorimmoOAuth.generatePkce().code_verifier)
    expect(ScorimmoOAuth.generateState()).not.toBe(ScorimmoOAuth.generateState())
  })
})

describe('ScorimmoOAuth — endpoints', () => {
  const oauth = new ScorimmoOAuth({ baseUrl })

  it('register() poste les URL et le nom', async () => {
    const fetch = mockFetch({ client_id: 'abc' })
    expect((await oauth.register(['https://app.test/cb'], 'Outil')).client_id).toBe('abc')
    expect(lastCall(fetch)).toEqual({
      url: `${baseUrl}/api/v2/oauth/register`,
      body: { redirect_uris: ['https://app.test/cb'], client_name: 'Outil' },
    })
  })

  it('register() refuse une liste vide', async () => {
    await expect(oauth.register([])).rejects.toThrow('at least one redirect URI')
  })

  it('authorizationUrl() encode les paramètres', () => {
    const url = new URL(new ScorimmoOAuth({ baseUrl: `${baseUrl}/` }).authorizationUrl('abc', 'https://app.test/cb?x=1', 'challenge', 'etat'))
    expect(`${url.origin}${url.pathname}`).toBe(`${baseUrl}/api/v2/oauth/authorize`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'abc',
      redirect_uri: 'https://app.test/cb?x=1',
      state: 'etat',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
    })
  })

  it('exchangeCode() poste le grant authorization_code', async () => {
    const fetch = mockFetch(oauthTokens)
    expect((await oauth.exchangeCode('code-1', 'verifier', 'https://app.test/cb', 'abc')).refresh_token).toBe('rotated')
    expect(lastCall(fetch).body).toEqual({
      grant_type: 'authorization_code',
      code: 'code-1',
      code_verifier: 'verifier',
      redirect_uri: 'https://app.test/cb',
      client_id: 'abc',
    })
  })

  it('exchangeCode() expose l\'erreur OAuth', async () => {
    const body = { error: 'invalid_grant', error_description: 'PKCE verification failed' }
    mockFetch(body, 400)
    const err = await oauth.exchangeCode('c', 'v', 'r', 'abc').catch(e => e) as ScorimmoApiError
    expect(err).toBeInstanceOf(ScorimmoApiError)
    expect(err).toMatchObject({ message: 'PKCE verification failed', apiCode: 'invalid_grant', statusCode: 400, body })
  })

  it('une erreur réseau donne statusCode 0', async () => {
    global.fetch = jest.fn().mockImplementation(() => Promise.reject(new Error('timeout'))) as unknown as typeof global.fetch
    await expect(oauth.revoke('token')).rejects.toMatchObject({ statusCode: 0 })
  })

  it('revoke() accepte un corps null', async () => {
    const fetch = mockFetch(null)
    await oauth.revoke('refresh')
    expect(lastCall(fetch).body).toEqual({ token: 'refresh' })
  })
})

describe('ScorimmoClient — mode OAuth', () => {
  it('renouvelle via /oauth/token', async () => {
    const fetch = mockFetch(oauthTokens)
    const client = new ScorimmoClient({ baseUrl, refreshToken: 'initial', oauthClientId: 'abc' })
    expect(await client.getToken()).toBe('jwt-oauth')
    expect(client.getRefreshToken()).toBe('rotated')
    expect(lastCall(fetch)).toEqual({
      url: `${baseUrl}/api/v2/oauth/token`,
      body: { grant_type: 'refresh_token', refresh_token: 'initial', client_id: 'abc' },
    })
  })

  it('garde /auth/refresh sans client OAuth', async () => {
    const fetch = mockFetch(oauthTokens)
    await new ScorimmoClient({ baseUrl, refreshToken: 'initial' }).getToken()
    expect(lastCall(fetch).url).toBe(`${baseUrl}/api/v2/auth/refresh`)
  })

  it('convertit invalid_grant en ScorimmoAuthError', async () => {
    mockFetch({ error: 'invalid_grant', error_description: 'Refresh token already used' }, 400)
    const err = await new ScorimmoClient({ baseUrl, refreshToken: 'initial', oauthClientId: 'abc' }).getToken().catch(e => e)
    expect(err).toBeInstanceOf(ScorimmoAuthError)
    expect(err.message).toBe('Refresh token already used')
  })

  it('garde access_denied en ScorimmoApiError', async () => {
    mockFetch({ error: 'access_denied', error_description: 'Account has no API access' }, 403)
    const err = await new ScorimmoClient({ baseUrl, refreshToken: 'initial', oauthClientId: 'abc' }).getToken().catch(e => e)
    expect(err).toBeInstanceOf(ScorimmoApiError)
    expect(err.apiCode).toBe('access_denied')
  })

  it('oauthClientId exige un refreshToken', () => {
    expect(() => new ScorimmoClient({ baseUrl, email: 'a', password: 'b', oauthClientId: 'abc' })).toThrow('refreshToken')
  })
})
