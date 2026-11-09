import { describe, it, expect, jest } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { ScorimmoClient } from '../client.js'
import { ScorimmoOAuth } from '../oauth.js'
import { SDK_VERSION, USER_AGENT } from '../version.js'

function mockFetch(json: unknown) {
  const fetch = jest.fn().mockImplementation(() => Promise.resolve({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: () => Promise.resolve(json),
  }))
  global.fetch = fetch as unknown as typeof global.fetch
  return fetch
}

function sentUserAgent(fetch: jest.Mock): string {
  const [, init] = fetch.mock.calls[0] as [string, { headers: Record<string, string> }]
  return init.headers['User-Agent']
}

describe('version du SDK', () => {
  it('correspond à package.json', () => {
    expect(SDK_VERSION).toBe(JSON.parse(readFileSync('package.json', 'utf8')).version)
  })

  it('correspond à la dernière entrée du CHANGELOG', () => {
    expect(readFileSync('CHANGELOG.md', 'utf8').match(/^## \[([^\]]+)\]/m)?.[1]).toBe(SDK_VERSION)
  })

  it('ScorimmoClient envoie son User-Agent', async () => {
    const fetch = mockFetch({ access_token: 'a', refresh_token: 'r', expires_in: 3600 })
    await new ScorimmoClient({ email: 'a', password: 'b' }).getToken()
    expect(sentUserAgent(fetch)).toBe(USER_AGENT)
  })

  it('ScorimmoOAuth envoie son User-Agent', async () => {
    const fetch = mockFetch({})
    await new ScorimmoOAuth().revoke('token')
    expect(sentUserAgent(fetch)).toBe(USER_AGENT)
  })
})
