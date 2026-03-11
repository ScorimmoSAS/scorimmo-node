import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { ScorimmoClient, ScorimmoAuthError, ScorimmoApiError } from '../client.js'

const baseUrl = 'https://app.scorimmo.com'
const config = { baseUrl, username: 'api_user', password: 'secret' }

const mockToken = 'eyJhbGciOiJSUzI1NiJ9.test'
const tokenExpiresAt = String(Math.floor(Date.now() / 1000) + 3600)

function makeTokenResponse() {
  return { token: mockToken, token_duration: 3600, token_expirate_at: tokenExpiresAt }
}

function makePage(leads: object[], totalItems: number, page = 1, limit = 50) {
  return {
    results: leads,
    informations: [{
      informations: {
        limit,
        current_page: page,
        total_items: totalItems,
        total_pages: Math.ceil(totalItems / limit),
        current_page_results: leads.length,
        previous_page: null,
        next_page: null,
      },
    }],
  }
}

function mockFetch(responses: Array<{ ok: boolean; json: unknown; status?: number }>) {
  let i = 0
  return jest.fn().mockImplementation(() => {
    const r = responses[i++] ?? responses[responses.length - 1]
    return Promise.resolve({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      statusText: r.ok ? 'OK' : 'Bad Request',
      json: () => Promise.resolve(r.json),
    })
  })
}

describe('ScorimmoClient.getToken()', () => {
  it('fetches and caches a JWT token (Unix timestamp expiry)', async () => {
    const fetch = mockFetch([
      { ok: true, json: makeTokenResponse() },
    ])
    global.fetch = fetch as unknown as typeof global.fetch

    const client = new ScorimmoClient(config)
    const token1 = await client.getToken()
    const token2 = await client.getToken()

    expect(token1).toBe(mockToken)
    expect(token2).toBe(mockToken)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('throws ScorimmoAuthError on bad credentials', async () => {
    global.fetch = mockFetch([
      { ok: false, status: 401, json: { code: 401, message: 'Invalid credentials' } },
    ]) as unknown as typeof global.fetch

    const client = new ScorimmoClient(config)
    await expect(client.getToken()).rejects.toThrow(ScorimmoAuthError)
  })
})

describe('ScorimmoClient.request() — 401 retry', () => {
  it('clears token cache and retries once on 401', async () => {
    const fetch = mockFetch([
      { ok: true,  json: makeTokenResponse() },                                // 1st login
      { ok: false, status: 401, json: { message: 'Token expired' } },         // 1st request → 401
      { ok: true,  json: makeTokenResponse() },                                // re-login
      { ok: true,  json: { id: 42, interest: 'TRANSACTION', created_at: '' } }, // retry succeeds
    ])
    global.fetch = fetch as unknown as typeof global.fetch

    const client = new ScorimmoClient(config)
    const lead = await client.leads.get(42)
    expect(lead.id).toBe(42)
    expect(fetch).toHaveBeenCalledTimes(4)
  })
})

describe('ScorimmoClient.leads.get()', () => {
  beforeEach(() => {
    global.fetch = mockFetch([
      { ok: true, json: makeTokenResponse() },
      { ok: true, json: { id: 42, store_id: 1, interest: 'TRANSACTION', created_at: '2024-06-01 10:00:00' } },
    ]) as unknown as typeof global.fetch
  })

  it('returns a lead by id', async () => {
    const client = new ScorimmoClient(config)
    const lead = await client.leads.get(42)
    expect(lead.id).toBe(42)
    expect(lead.interest).toBe('TRANSACTION')
  })
})

describe('ScorimmoClient.leads.list()', () => {
  beforeEach(() => {
    global.fetch = mockFetch([
      { ok: true, json: makeTokenResponse() },
      { ok: true, json: makePage([{ id: 1 }, { id: 2 }], 2) },
    ]) as unknown as typeof global.fetch
  })

  it('returns paginated leads', async () => {
    const client = new ScorimmoClient(config)
    const result = await client.leads.list({ limit: 20, page: 1 })
    expect(result.results).toHaveLength(2)
    expect(result.informations[0].informations.total_items).toBe(2)
  })
})

describe('ScorimmoClient.leads.since()', () => {
  it('fetches all pages and returns flat array', async () => {
    global.fetch = mockFetch([
      { ok: true, json: makeTokenResponse() },
      { ok: true, json: makePage([{ id: 1 }, { id: 2 }], 3) },
      { ok: true, json: makePage([{ id: 3 }], 3, 2) },
    ]) as unknown as typeof global.fetch

    const client = new ScorimmoClient(config)
    const leads = await client.leads.since('2024-01-01')
    expect(leads).toHaveLength(3)
    expect(leads.map(l => l.id)).toEqual([1, 2, 3])
  })

  it('deduplicates leads across page boundaries', async () => {
    global.fetch = mockFetch([
      { ok: true, json: makeTokenResponse() },
      { ok: true, json: makePage([{ id: 1 }, { id: 2 }, { id: 3 }], 4) },
      { ok: true, json: makePage([{ id: 3 }, { id: 4 }], 4, 2) }, // id 3 duplicated
    ]) as unknown as typeof global.fetch

    const client = new ScorimmoClient(config)
    const leads = await client.leads.since('2024-01-01')
    expect(leads).toHaveLength(4)
    const ids = leads.map(l => l.id)
    expect(ids).toEqual([...new Set(ids)])
  })

  it('respects maxPages cap', async () => {
    global.fetch = mockFetch([
      { ok: true, json: makeTokenResponse() },
      { ok: true, json: makePage(Array.from({ length: 50 }, (_, i) => ({ id: i + 1 })), 300) },
      { ok: true, json: makePage(Array.from({ length: 50 }, (_, i) => ({ id: i + 51 })), 300, 2) },
    ]) as unknown as typeof global.fetch

    const client = new ScorimmoClient(config)
    const leads = await client.leads.since('2024-01-01', 'created_at', 2)
    expect(leads).toHaveLength(100)
  })

  it('uses store endpoint when storeId is provided', async () => {
    const fetch = mockFetch([
      { ok: true, json: makeTokenResponse() },
      { ok: true, json: makePage([{ id: 1 }], 1) },
    ]) as unknown as typeof global.fetch
    global.fetch = fetch as unknown as typeof global.fetch

    const client = new ScorimmoClient(config)
    await client.leads.since('2024-01-01', 'created_at', 100, 776)

    const calls = (fetch as jest.Mock).mock.calls as Array<[string, ...unknown[]]>
    expect(calls[1][0]).toContain('/api/stores/776/leads')
  })
})

describe('ScorimmoApiError', () => {
  it('is thrown on non-2xx API responses', async () => {
    global.fetch = mockFetch([
      { ok: true, json: makeTokenResponse() },
      { ok: false, status: 404, json: { code: 404, message: 'Lead not found' } },
    ]) as unknown as typeof global.fetch

    const client = new ScorimmoClient(config)
    await expect(client.leads.get(999)).rejects.toThrow(ScorimmoApiError)
    await expect(client.leads.get(999)).rejects.toMatchObject({ statusCode: 404 })
  })
})
