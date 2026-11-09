import { describe, it, expect, jest } from '@jest/globals'
import { ScorimmoClient, ScorimmoApiError, ScorimmoAuthError } from '../client.js'
import { ScorimmoWebhook } from '../webhook.js'

const baseUrl = 'https://app.scorimmo.com'
const tokens = { access_token: 'access-abc', refresh_token: 'refresh-xyz', token_type: 'Bearer', expires_in: 3600 }

type Reply = { status?: number; json?: unknown; headers?: Record<string, string> }

/** Répond au login puis déroule `replies` ; expose les appels hors authentification. */
function setup(replies: Reply[], config: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; path: string; body?: unknown; authorization?: string }> = []
  let i = 0
  global.fetch = jest.fn().mockImplementation((url: unknown, init: unknown) => {
    const { method, body, headers } = init as { method: string; body?: string; headers: Record<string, string> }
    const path = String(url).replace(baseUrl, '')
    const isAuth = path === '/api/v2/auth/token' || path === '/api/v2/auth/refresh'
    const reply: Reply = isAuth ? { json: tokens } : replies[i++] ?? {}
    if (!isAuth) calls.push({ method, path, body: body ? JSON.parse(body) : undefined, authorization: headers['Authorization'] })
    const status = reply.status ?? 200
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(reply.headers),
      json: () => Promise.resolve(reply.json ?? {}),
    })
  }) as unknown as typeof global.fetch

  return { client: new ScorimmoClient({ baseUrl, email: 'api@agence.fr', password: 'secret', ...config }), calls }
}

describe('campaigns', () => {
  it('list() envoie les filtres', async () => {
    const { client, calls } = setup([{ json: { data: [], meta: {} } }])
    await client.campaigns.list({ status: 'open', sort: 'start:desc' })
    expect(calls[0].path).toBe('/api/v2/campaigns?status=open&sort=start%3Adesc')
  })

  it('list() refuse un statut inconnu', async () => {
    const { client } = setup([])
    await expect(client.campaigns.list({ status: 'running' as never })).rejects.toThrow('"status"')
  })

  it('campaignFields utilise /campaigns/fields', async () => {
    const { client, calls } = setup([{ json: { data: [], meta: {} } }])
    await client.campaignFields.list({ campaign_id: 12 })
    expect(calls[0].path).toBe('/api/v2/campaigns/fields?campaign_id=12')
  })

  it('campaignContacts.list() exige campaign_id', async () => {
    const { client } = setup([])
    await expect(client.campaignContacts.list({} as never)).rejects.toThrow('campaign_id')
  })

  it('campaignContacts.list() conserve les filtres bracket', async () => {
    const { client, calls } = setup([{ json: { data: [], meta: {} } }])
    await client.campaignContacts.list({ campaign_id: 12, 'last_contact_at[gte]': '2026-11-01' })
    expect(calls[0].path).toBe('/api/v2/campaigns/contacts?campaign_id=12&last_contact_at[gte]=2026-11-01')
  })

  it('campaignContacts.list() refuse un sous-statut inconnu', async () => {
    const { client } = setup([])
    await expect(client.campaignContacts.list({ campaign_id: 12, sub_status: 'x' as never })).rejects.toThrow('"sub_status"')
  })

  it('inject() poste la campagne et les contacts', async () => {
    const report = { data: [{ index: 0, status: 'created', id: 1 }], meta: { received: 1, created: 1, rejected: 0 } }
    const contacts = [{ last_name: 'Dupont', phone: '0612345678' }]
    const { client, calls } = setup([{ status: 201, json: report }])
    expect(await client.campaignContacts.inject(12, contacts)).toEqual(report)
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/v2/campaigns/contacts', body: { campaign_id: 12, contacts } })
  })

  it('inject() refuse un lot vide ou trop grand', async () => {
    const { client } = setup([])
    await expect(client.campaignContacts.inject(12, [])).rejects.toThrow('between 1 and 100')
    const tooMany = Array(101).fill({ last_name: 'A', phone: '0' })
    await expect(client.campaignContacts.inject(12, tooMany)).rejects.toThrow('between 1 and 100')
  })

  it('inject() retourne le compte rendu quand tous les contacts sont refusés', async () => {
    const report = { data: [{ index: 0, status: 'rejected', errors: [{ field: 'phone', message: 'x' }] }], meta: { received: 1, created: 0, rejected: 1 } }
    const { client } = setup([{ status: 422, json: report }])
    expect(await client.campaignContacts.inject(12, [{ last_name: 'A', phone: 'x' }])).toEqual(report)
  })

  it('inject() relance les autres erreurs de validation', async () => {
    const { client } = setup([{ status: 422, json: { message: 'Campaign closed' } }])
    await expect(client.campaignContacts.inject(12, [{ last_name: 'A', phone: '0' }])).rejects.toThrow('Campaign closed')
  })
})

describe('webhooks', () => {
  const payload = { store_id: 3, name: 'CRM', url: 'https://crm.test/hook', events: ['CAMPAIGN_CLOSED'] }

  it('list() refuse un champ de tri inconnu', async () => {
    const { client } = setup([])
    await expect(client.webhooks.list({ sort: 'url:asc' })).rejects.toThrow('"sort"')
  })

  it('errors() utilise /webhooks/errors et valide la pagination', async () => {
    const { client, calls } = setup([{ json: { data: [], meta: {} } }])
    await client.webhooks.errors({ status: 500, page: 2 })
    expect(calls[0].path).toBe('/api/v2/webhooks/errors?status=500&page=2')
    await expect(client.webhooks.errors({ limit: 101 })).rejects.toThrow('"limit"')
  })

  it('create() poste le payload', async () => {
    const { client, calls } = setup([{ status: 201, json: { id: 9 } }])
    await client.webhooks.create(payload)
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/v2/webhooks', body: payload })
  })

  it('create() exige events', async () => {
    const { client } = setup([])
    await expect(client.webhooks.create({ store_id: 3, name: 'CRM', url: 'x' } as never)).rejects.toThrow('"events"')
  })

  it('update() envoie un PATCH et refuse un payload vide', async () => {
    const { client, calls } = setup([{ json: { id: 9 } }])
    await client.webhooks.update(9, { name: 'Nouveau' })
    expect(calls[0]).toMatchObject({ method: 'PATCH', path: '/api/v2/webhooks/9', body: { name: 'Nouveau' } })
    await expect(client.webhooks.update(9, {})).rejects.toThrow('at least one field')
  })

  it('delete() envoie un DELETE', async () => {
    const { client, calls } = setup([{ status: 204 }])
    await client.webhooks.delete(9)
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: '/api/v2/webhooks/9' })
  })
})

describe('form', () => {
  const base = { store_id: 1, libelle_id: 2, to_email: 'a@b.fr', origin: 'Site', message: 'Bonjour' }

  it('convertit civility en title', async () => {
    const { client, calls } = setup([{ status: 201, json: { id: 1 } }])
    await client.form.submit({ ...base, customer: { civility: 'M.', last_name: 'Dupont' } })
    expect(calls[0].body).toMatchObject({ customer: { title: 'M.', last_name: 'Dupont' } })
    expect((calls[0].body as { customer: object }).customer).not.toHaveProperty('civility')
  })

  it('garde title si les deux clés sont présentes', async () => {
    const { client, calls } = setup([{ status: 201, json: { id: 1 } }])
    await client.form.submit({ ...base, customer: { civility: 'M.', title: 'Mme' } })
    expect(calls[0].body).toMatchObject({ customer: { title: 'Mme' } })
  })
})

describe('tokens', () => {
  it('envoie tokenName à la connexion', async () => {
    const { client } = setup([], { tokenName: 'batch-nuit' })
    await client.getToken()
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, { body: string }]
    expect(JSON.parse(init.body)).toEqual({ email: 'api@agence.fr', password: 'secret', name: 'batch-nuit' })
  })

  it('revokeToken() envoie un Bearer', async () => {
    const { client, calls } = setup([{ json: { code: 200, revoked_count: 2 } }])
    await client.revokeToken()
    expect(calls[0]).toMatchObject({ path: '/api/v2/auth/revoke', authorization: 'Bearer access-abc', body: { revoke_all: true } })
  })

  it('revokeToken() cible le token tourné quand il révoque le token courant', async () => {
    const { client, calls } = setup([{ json: { code: 200 } }], { email: undefined, password: undefined, refreshToken: 'initial' })
    await client.revokeToken('initial')
    expect(calls[0].body).toEqual({ refresh_token: 'refresh-xyz' })
  })

  it('listTokens() et deleteToken()', async () => {
    const { client, calls } = setup([{ json: { code: 200, data: [] } }, { json: { code: 200 } }])
    await client.listTokens()
    await client.deleteToken(7)
    expect(calls.map(c => `${c.method} ${c.path}`)).toEqual(['GET /api/v2/auth/tokens', 'DELETE /api/v2/auth/tokens/7'])
  })
})

describe('erreurs', () => {
  it('expose le message { error } des endpoints /auth', async () => {
    global.fetch = jest.fn().mockImplementation(() => Promise.resolve({
      ok: false,
      status: 403,
      headers: new Headers(),
      json: () => Promise.resolve({ code: 403, error: 'Refresh token limit reached (5)' }),
    })) as unknown as typeof global.fetch

    const client = new ScorimmoClient({ baseUrl, email: 'a', password: 'b' })
    await expect(client.getToken()).rejects.toMatchObject({ message: 'Refresh token limit reached (5)', statusCode: 403 })
  })

  it('expose body, getFieldErrors() et retryAfter', async () => {
    const body = { status: 422, code: 'UNPROCESSABLE_ENTITY', message: 'Validation failed', errors: [{ field: 'url', message: 'invalide' }] }
    const { client } = setup([{ status: 422, json: body, headers: { 'Retry-After': '30' } }])
    const err = await client.webhooks.update(1, { url: 'x' }).catch(e => e) as ScorimmoApiError
    expect(err).toBeInstanceOf(ScorimmoApiError)
    expect(err.body).toEqual(body)
    expect(err.getFieldErrors()).toEqual(body.errors)
    expect(err.retryAfter).toBe(30)
  })

  it('reste distinct de ScorimmoAuthError', () => {
    expect(new ScorimmoApiError('x', 400)).not.toBeInstanceOf(ScorimmoAuthError)
  })
})

describe('webhooks de campagne', () => {
  it.each([
    ['campaign_contact_updated', 'onCampaignContactUpdated'],
    ['campaign_contact_closed', 'onCampaignContactClosed'],
    ['campaign_closed', 'onCampaignClosed'],
  ])('%s est routé vers %s', async (event, handler) => {
    const named = jest.fn<() => void>()
    const onUnknown = jest.fn<() => void>()
    await new ScorimmoWebhook().handle({}, JSON.stringify({ event, campaign_id: 12 }), { [handler]: named, onUnknown })
    expect(named).toHaveBeenCalledTimes(1)
    expect(onUnknown).not.toHaveBeenCalled()
  })
})
