import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { ScorimmoClient, ScorimmoAuthError, ScorimmoApiError } from '../client.js'

const baseUrl = 'https://app.scorimmo.com'
const credConfig = { baseUrl, email: 'api@agence.fr', password: 'secret' }

const ACCESS = 'access-abc'
const REFRESH = 'refresh-xyz'

function tokenResponse(access = ACCESS, refresh = REFRESH, offsetMs = 3600_000) {
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: 'Bearer',
    expires_in: 3600,
    expires_at: new Date(Date.now() + offsetMs).toISOString(),
  }
}

function makePage<T>(items: T[], totalItems: number, page = 1, limit = 50) {
  const totalPages = Math.max(1, Math.ceil(totalItems / limit))
  return {
    data: items,
    meta: {
      total_items: totalItems,
      current_page: page,
      limit,
      total_pages: totalPages,
      previous_page: page > 1 ? page - 1 : null,
      next_page: page < totalPages ? page + 1 : null,
    },
  }
}

function mockFetch(responses: Array<{ ok: boolean; json: unknown; status?: number; headers?: Record<string, string> }>) {
  let i = 0
  return jest.fn().mockImplementation(() => {
    const r = responses[i++] ?? responses[responses.length - 1]
    return Promise.resolve({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      statusText: r.ok ? 'OK' : 'Bad Request',
      headers: new Headers(r.headers),
      json: () => Promise.resolve(r.json),
    })
  })
}

// ─── Construction ─────────────────────────────────────────────────────────────

describe('ScorimmoClient — construction', () => {
  it('throws without any credentials', () => {
    expect(() => new ScorimmoClient({})).toThrow()
  })

  it('accepts email + password', () => {
    expect(() => new ScorimmoClient(credConfig)).not.toThrow()
  })

  it('accepts refresh token only', () => {
    expect(() => new ScorimmoClient({ baseUrl, refreshToken: REFRESH })).not.toThrow()
  })
})

// ─── Tokens ───────────────────────────────────────────────────────────────────

describe('ScorimmoClient — tokens', () => {
  it('fetches and caches an access token from credentials', async () => {
    const fetch = mockFetch([{ ok: true, json: tokenResponse() }])
    global.fetch = fetch as unknown as typeof global.fetch

    const client = new ScorimmoClient(credConfig)
    const t1 = await client.getToken()
    const t2 = await client.getToken()

    expect(t1).toBe(ACCESS)
    expect(t2).toBe(ACCESS)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('uses refresh token before falling back to credentials', async () => {
    const fetch = mockFetch([{ ok: true, json: tokenResponse('new-access', 'new-refresh') }])
    global.fetch = fetch as unknown as typeof global.fetch

    const client = new ScorimmoClient({ baseUrl, email: credConfig.email, password: credConfig.password, refreshToken: REFRESH })
    const token = await client.getToken()

    expect(token).toBe('new-access')
    expect(client.getRefreshToken()).toBe('new-refresh')
    const url = (fetch.mock.calls[0] as [string, ...unknown[]])[0]
    expect(url).toContain('/api/v2/auth/refresh')
  })

  it('falls back to credentials when refresh is rejected', async () => {
    const fetch = mockFetch([
      { ok: false, status: 401, json: { message: 'refresh revoked' } },
      { ok: true, json: tokenResponse('fresh-access', 'fresh-refresh') },
    ])
    global.fetch = fetch as unknown as typeof global.fetch

    const client = new ScorimmoClient({ ...credConfig, refreshToken: 'bad-refresh' })
    const token = await client.getToken()
    expect(token).toBe('fresh-access')
    expect(fetch).toHaveBeenCalledTimes(2)
    const url2 = (fetch.mock.calls[1] as [string, ...unknown[]])[0]
    expect(url2).toContain('/api/v2/auth/token')
  })

  it('throws when only refresh token is provided and it fails', async () => {
    global.fetch = mockFetch([
      { ok: false, status: 401, json: { message: 'refresh revoked' } },
    ]) as unknown as typeof global.fetch

    const client = new ScorimmoClient({ baseUrl, refreshToken: 'bad' })
    await expect(client.getToken()).rejects.toThrow(ScorimmoAuthError)
  })

  it('accepts expires_at as Unix seconds (number)', async () => {
    const unixSec = Math.floor(Date.now() / 1000) + 3600
    const fetch = mockFetch([
      { ok: true, json: { ...tokenResponse(), expires_at: unixSec } },
      { ok: true, json: { id: 1, store_id: 1, interest: 'TRANSACTION', created_at: 'x' } },
      // Un second appel ne doit PAS ré-appeler /auth/token si le parsing unix est correct.
      { ok: true, json: { id: 2, store_id: 1, interest: 'TRANSACTION', created_at: 'x' } },
    ])
    global.fetch = fetch as unknown as typeof global.fetch

    const client = new ScorimmoClient(credConfig)
    await client.leads.get(1)
    await client.leads.get(2)
    // 1 auth + 2 leads = 3 appels — pas de ré-auth (le token n'est pas vu comme expiré en 1970).
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('accepts expires_at as ISO string (compat historique)', async () => {
    const iso = new Date(Date.now() + 3600_000).toISOString()
    const fetch = mockFetch([
      { ok: true, json: { ...tokenResponse(), expires_at: iso } },
      { ok: true, json: { id: 1, store_id: 1, interest: 'TRANSACTION', created_at: 'x' } },
      { ok: true, json: { id: 2, store_id: 1, interest: 'TRANSACTION', created_at: 'x' } },
    ])
    global.fetch = fetch as unknown as typeof global.fetch

    const client = new ScorimmoClient(credConfig)
    await client.leads.get(1)
    await client.leads.get(2)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('falls back to expires_in when expires_at is absent', async () => {
    const fetch = mockFetch([
      { ok: true, json: { access_token: ACCESS, refresh_token: REFRESH, token_type: 'Bearer', expires_in: 3600 } },
      { ok: true, json: { id: 1, store_id: 1, interest: 'TRANSACTION', created_at: 'x' } },
      { ok: true, json: { id: 2, store_id: 1, interest: 'TRANSACTION', created_at: 'x' } },
    ])
    global.fetch = fetch as unknown as typeof global.fetch

    const client = new ScorimmoClient(credConfig)
    await client.leads.get(1)
    await client.leads.get(2)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('refreshAccessToken() exchanges a refresh token explicitly', async () => {
    const fetch = mockFetch([
      { ok: true, json: tokenResponse('a1', 'r1') },
    ])
    global.fetch = fetch as unknown as typeof global.fetch
    const client = new ScorimmoClient({ baseUrl, refreshToken: REFRESH })
    const res = await client.refreshAccessToken(REFRESH)
    expect(res.access_token).toBe('a1')
    const [url, init] = fetch.mock.calls[0] as [string, { body: string }]
    expect(url).toContain('/api/v2/auth/refresh')
    expect(JSON.parse(init.body)).toEqual({ refresh_token: REFRESH })
  })

  it('revokeToken() posts refresh_token when given', async () => {
    const fetch = mockFetch([{ ok: true, json: tokenResponse() }, { ok: true, json: { revoked: true } }])
    global.fetch = fetch as unknown as typeof global.fetch
    const client = new ScorimmoClient({ baseUrl, refreshToken: REFRESH })
    await client.revokeToken('to-revoke')
    const [url, init] = fetch.mock.calls[1] as [string, { body: string }]
    expect(url).toContain('/api/v2/auth/revoke')
    expect(JSON.parse(init.body)).toEqual({ refresh_token: 'to-revoke' })
  })

  it('revokeToken() posts revoke_all when no token is given', async () => {
    const fetch = mockFetch([{ ok: true, json: tokenResponse() }, { ok: true, json: { revoked: true } }])
    global.fetch = fetch as unknown as typeof global.fetch
    const client = new ScorimmoClient({ baseUrl, refreshToken: REFRESH })
    await client.revokeToken()
    const [, init] = fetch.mock.calls[1] as [string, { body: string }]
    expect(JSON.parse(init.body)).toEqual({ revoke_all: true })
  })

  it('validateToken() GETs /api/v2/auth/validate with Bearer', async () => {
    const fetch = mockFetch([
      { ok: true, json: tokenResponse() },
      { ok: true, json: { version: 'v2', status: 'ok', authenticated: true, scopes: ['lead:read'], stores_id: [1], interests: ['TRANSACTION'] } },
    ])
    global.fetch = fetch as unknown as typeof global.fetch
    const client = new ScorimmoClient(credConfig)
    const info = await client.validateToken()
    expect(info.authenticated).toBe(true)
    const [url, init] = fetch.mock.calls[1] as [string, { headers: Record<string, string> }]
    expect(url).toContain('/api/v2/auth/validate')
    expect(init.headers['Authorization']).toBe(`Bearer ${ACCESS}`)
  })
})

// ─── Auto-retry on 401 ────────────────────────────────────────────────────────

describe('ScorimmoClient.request() — 401 retry', () => {
  it('clears cache and retries once on 401', async () => {
    const fetch = mockFetch([
      { ok: true, json: tokenResponse() },                                  // login 1
      { ok: false, status: 401, json: { message: 'Token expired' } },       // 1st request → 401
      { ok: true, json: tokenResponse('access-2', 'refresh-2') },           // re-login
      { ok: true, json: { id: 42, store_id: 1, interest: 'TRANSACTION', created_at: 'x' } },
    ])
    global.fetch = fetch as unknown as typeof global.fetch

    const client = new ScorimmoClient(credConfig)
    const lead = await client.leads.get(42)
    expect(lead.id).toBe(42)
    expect(fetch).toHaveBeenCalledTimes(4)
  })
})

// ─── Leads ────────────────────────────────────────────────────────────────────

describe('ScorimmoClient.leads', () => {
  beforeEach(() => {
    global.fetch = mockFetch([
      { ok: true, json: tokenResponse() },
      { ok: true, json: { id: 42, store_id: 1, interest: 'TRANSACTION', created_at: 'x' } },
    ]) as unknown as typeof global.fetch
  })

  it('get() returns a lead', async () => {
    const client = new ScorimmoClient(credConfig)
    const lead = await client.leads.get(42)
    expect(lead.id).toBe(42)
  })

  it('get() sends include= when relations requested', async () => {
    const fetch = mockFetch([
      { ok: true, json: tokenResponse() },
      { ok: true, json: { id: 42, store_id: 1, interest: 'TRANSACTION', created_at: 'x' } },
    ])
    global.fetch = fetch as unknown as typeof global.fetch
    const client = new ScorimmoClient(credConfig)
    await client.leads.get(42, ['customer', 'seller'])
    const url = (fetch.mock.calls[1] as [string, ...unknown[]])[0]
    expect(url).toContain('/api/v2/leads/42?include=customer%2Cseller')
  })

  it('list() paginates and returns { data, meta }', async () => {
    global.fetch = mockFetch([
      { ok: true, json: tokenResponse() },
      { ok: true, json: makePage([{ id: 1 }, { id: 2 }], 2) },
    ]) as unknown as typeof global.fetch
    const client = new ScorimmoClient(credConfig)
    const res = await client.leads.list({ limit: 20, page: 1 })
    expect(res.data).toHaveLength(2)
    expect(res.meta.total_items).toBe(2)
  })

  it('list() validates sort field', async () => {
    global.fetch = mockFetch([{ ok: true, json: tokenResponse() }]) as unknown as typeof global.fetch
    const client = new ScorimmoClient(credConfig)
    await expect(client.leads.list({ sort: 'unknown:asc' })).rejects.toThrow()
  })

  it('list() validates limit', async () => {
    global.fetch = mockFetch([{ ok: true, json: tokenResponse() }]) as unknown as typeof global.fetch
    const client = new ScorimmoClient(credConfig)
    await expect(client.leads.list({ limit: 500 })).rejects.toThrow()
  })

  it('update() rejects empty payload', async () => {
    global.fetch = mockFetch([{ ok: true, json: tokenResponse() }]) as unknown as typeof global.fetch
    const client = new ScorimmoClient(credConfig)
    await expect(client.leads.update(1, {})).rejects.toThrow()
  })

  it('update() sends PATCH with body', async () => {
    const fetch = mockFetch([
      { ok: true, json: tokenResponse() },
      { ok: true, json: { id: 42, store_id: 1, interest: 'TRANSACTION', created_at: 'x' } },
    ])
    global.fetch = fetch as unknown as typeof global.fetch
    const client = new ScorimmoClient(credConfig)
    await client.leads.update(42, { external_lead_id: 'CRM-456' })
    const [url, init] = fetch.mock.calls[1] as [string, { method: string; body: string }]
    expect(url).toContain('/api/v2/leads/42')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ external_lead_id: 'CRM-456' })
  })

  it('list() does NOT URL-encode bracket filter operators (created_at[gte])', async () => {
    const fetch = mockFetch([
      { ok: true, json: tokenResponse() },
      { ok: true, json: makePage([], 0) },
    ])
    global.fetch = fetch as unknown as typeof global.fetch
    const client = new ScorimmoClient(credConfig)
    await client.leads.list({ 'created_at[gte]': '2026-01-01T00:00:00Z' })
    const url = (fetch.mock.calls[1] as [string, ...unknown[]])[0]
    expect(url).toContain('created_at[gte]=')
    expect(url).not.toContain('created_at%5Bgte%5D')
  })
})

// ─── since() ──────────────────────────────────────────────────────────────────

describe('ScorimmoClient.leads.since()', () => {
  it('walks pages and returns a flat deduped list', async () => {
    global.fetch = mockFetch([
      { ok: true, json: tokenResponse() },
      { ok: true, json: makePage([{ id: 1 }, { id: 2 }], 3, 1, 2) },
      { ok: true, json: makePage([{ id: 2 }, { id: 3 }], 3, 2, 2) }, // 2 dedup
    ]) as unknown as typeof global.fetch

    const client = new ScorimmoClient(credConfig)
    const leads = await client.leads.since('2026-01-01')
    expect(leads.map(l => l.id)).toEqual([1, 2, 3])
  })

  it('rejects invalid date format', async () => {
    const client = new ScorimmoClient(credConfig)
    await expect(client.leads.since('not-a-date')).rejects.toThrow()
  })

  it('rejects invalid field', async () => {
    const client = new ScorimmoClient(credConfig)
    await expect(client.leads.since('2026-01-01', 'bad' as never)).rejects.toThrow()
  })

  it('accepts a Date instance', async () => {
    global.fetch = mockFetch([
      { ok: true, json: tokenResponse() },
      { ok: true, json: makePage([{ id: 1 }], 1) },
    ]) as unknown as typeof global.fetch
    const client = new ScorimmoClient(credConfig)
    const leads = await client.leads.since(new Date('2026-01-01T00:00:00Z'))
    expect(leads).toHaveLength(1)
  })

  it('sends store_id when provided', async () => {
    const fetch = mockFetch([
      { ok: true, json: tokenResponse() },
      { ok: true, json: makePage([{ id: 1 }], 1) },
    ])
    global.fetch = fetch as unknown as typeof global.fetch
    const client = new ScorimmoClient(credConfig)
    await client.leads.since('2026-01-01', 'created_at', 100, 776)
    const url = (fetch.mock.calls[1] as [string, ...unknown[]])[0] as string
    expect(url).toContain('store_id=776')
  })

  it('stops when next_page is null even if page returned items', async () => {
    const fetch = mockFetch([
      { ok: true, json: tokenResponse() },
      { ok: true, json: makePage([{ id: 1 }, { id: 2 }], 2, 1, 100) }, // next_page=null
    ])
    global.fetch = fetch as unknown as typeof global.fetch
    const client = new ScorimmoClient(credConfig)
    const leads = await client.leads.since('2026-01-01')
    expect(leads).toHaveLength(2)
    // 1 auth + 1 list = 2 appels (pas de page 2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

// ─── Filter validation on other resources ─────────────────────────────────────

describe('Filter validation', () => {
  beforeEach(() => {
    global.fetch = mockFetch([{ ok: true, json: tokenResponse() }]) as unknown as typeof global.fetch
  })

  it('users.list() rejects unknown role', async () => {
    const client = new ScorimmoClient(credConfig)
    await expect(client.users.list({ role: 'bad' as never })).rejects.toThrow()
  })

  it('origins.list() rejects unknown tracking_channel', async () => {
    const client = new ScorimmoClient(credConfig)
    await expect(client.origins.list({ tracking_channel: 'sms' as never })).rejects.toThrow()
  })
})

// ─── Form ─────────────────────────────────────────────────────────────────────

describe('ScorimmoClient.form.submit()', () => {
  it('rejects missing required field', async () => {
    global.fetch = mockFetch([{ ok: true, json: tokenResponse() }]) as unknown as typeof global.fetch
    const client = new ScorimmoClient(credConfig)
    await expect(client.form.submit({ store_id: 1 } as never)).rejects.toThrow()
  })

  it('sends POST /api/v2/form', async () => {
    const fetch = mockFetch([
      { ok: true, json: tokenResponse() },
      { ok: true, json: { status: 200, message: 'email created', id: 5, store_id: 1, libelle_id: 2, origin: 'web' } },
    ])
    global.fetch = fetch as unknown as typeof global.fetch
    const client = new ScorimmoClient(credConfig)
    const res = await client.form.submit({
      store_id: 1,
      libelle_id: 2,
      to_email: 'x@y.z',
      origin: 'web',
      message: 'hello',
    })
    expect(res.id).toBe(5)
    const url = (fetch.mock.calls[1] as [string, ...unknown[]])[0]
    expect(url).toContain('/api/v2/form')
  })
})

// ─── WebCallbacks ─────────────────────────────────────────────────────────────

describe('ScorimmoClient.webCallbacks.launch()', () => {
  it('rejects empty key/number', async () => {
    const client = new ScorimmoClient(credConfig)
    await expect(client.webCallbacks.launch('', '+331')).rejects.toThrow()
    await expect(client.webCallbacks.launch('k', '')).rejects.toThrow()
  })

  it('does NOT send a Bearer token', async () => {
    const fetch = mockFetch([
      { ok: true, json: { results: ['ok'], information: 200 } },
    ])
    global.fetch = fetch as unknown as typeof global.fetch
    const client = new ScorimmoClient(credConfig)
    await client.webCallbacks.launch('wcb-key', '+33612345678')
    const call = fetch.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(call[0]).toContain('/api/v2/webcallbacks')
    expect(call[1].headers['Authorization']).toBeUndefined()
  })
})

// ─── API error ────────────────────────────────────────────────────────────────

describe('ScorimmoApiError', () => {
  it('is thrown on non-2xx responses', async () => {
    global.fetch = mockFetch([
      { ok: true, json: tokenResponse() },
      { ok: false, status: 404, json: { code: 'NOT_FOUND', message: 'Lead not found' } },
    ]) as unknown as typeof global.fetch
    const client = new ScorimmoClient(credConfig)
    await expect(client.leads.get(999)).rejects.toMatchObject({ statusCode: 404, apiCode: 'NOT_FOUND' })
  })
})
