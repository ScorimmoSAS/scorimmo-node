import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { ScorimmoClient, ScorimmoAuthError, ScorimmoApiError } from '../client.js'

const baseUrl = 'https://app.scorimmo.com'
const config = { baseUrl, username: 'api_user', password: 'secret' }

const mockToken = 'eyJhbGciOiJSUzI1NiJ9.test'
const tokenExpiresAt = new Date(Date.now() + 3600_000).toISOString()

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
  it('fetches and caches a JWT token', async () => {
    const fetch = mockFetch([
      { ok: true, json: { token: mockToken, token_duration: 3600, token_expirate_at: tokenExpiresAt } },
    ])
    global.fetch = fetch as unknown as typeof global.fetch

    const client = new ScorimmoClient(config)
    const token1 = await client.getToken()
    const token2 = await client.getToken()

    expect(token1).toBe(mockToken)
    expect(token2).toBe(mockToken)
    expect(fetch).toHaveBeenCalledTimes(1) // cached on second call
  })

  it('throws ScorimmoAuthError on bad credentials', async () => {
    global.fetch = mockFetch([
      { ok: false, status: 401, json: { code: 401, message: 'Invalid credentials' } },
    ]) as unknown as typeof global.fetch

    const client = new ScorimmoClient(config)
    await expect(client.getToken()).rejects.toThrow(ScorimmoAuthError)
  })
})

describe('ScorimmoClient.leads.get()', () => {
  beforeEach(() => {
    global.fetch = mockFetch([
      { ok: true, json: { token: mockToken, token_duration: 3600, token_expirate_at: tokenExpiresAt } },
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
      { ok: true, json: { token: mockToken, token_duration: 3600, token_expirate_at: tokenExpiresAt } },
      { ok: true, json: { results: [{ id: 1 }, { id: 2 }], total: 2, page: 1, limit: 20 } },
    ]) as unknown as typeof global.fetch
  })

  it('returns paginated leads', async () => {
    const client = new ScorimmoClient(config)
    const result = await client.leads.list({ limit: 20, page: 1 })
    expect(result.results).toHaveLength(2)
    expect(result.total).toBe(2)
  })
})

describe('ScorimmoClient.leads.since()', () => {
  it('fetches all pages and returns flat array', async () => {
    global.fetch = mockFetch([
      { ok: true, json: { token: mockToken, token_duration: 3600, token_expirate_at: tokenExpiresAt } },
      // page 1: 2 results, total 3
      { ok: true, json: { results: [{ id: 1 }, { id: 2 }], total: 3, page: 1, limit: 50 } },
      // page 2: 1 result, total 3
      { ok: true, json: { results: [{ id: 3 }], total: 3, page: 2, limit: 50 } },
    ]) as unknown as typeof global.fetch

    const client = new ScorimmoClient(config)
    const leads = await client.leads.since('2024-01-01')
    expect(leads).toHaveLength(3)
    expect(leads.map(l => l.id)).toEqual([1, 2, 3])
  })
})

describe('ScorimmoApiError', () => {
  it('is thrown on non-2xx API responses', async () => {
    global.fetch = mockFetch([
      { ok: true, json: { token: mockToken, token_duration: 3600, token_expirate_at: tokenExpiresAt } },
      { ok: false, status: 404, json: { code: 404, message: 'Lead not found' } },
    ]) as unknown as typeof global.fetch

    const client = new ScorimmoClient(config)
    await expect(client.leads.get(999)).rejects.toThrow(ScorimmoApiError)
    await expect(client.leads.get(999)).rejects.toMatchObject({ statusCode: 404 })
  })
})
