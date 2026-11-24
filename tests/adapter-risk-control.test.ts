/**
 * Risk-control behaviour, self-contained: the shapes upstream rejects and the
 * classification that decides whether an account gets cooled.
 *
 * Kept separate from `adapter.test.ts` (whose helpers are not exported) so the
 * contract is readable on its own.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { AgyAdapter } from '../src/adapter/adapter.ts'
import type { AgyAccountSession } from '../src/adapter/adapter.ts'

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream({
    pull(controller) {
      if (index >= lines.length) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(`${lines[index]}\n\n`))
      index += 1
    },
  })
}

function session(overrides: { account?: Record<string, unknown> } = {}): AgyAccountSession {
  return {
    account: {
      email: 'r@example.com',
      refresh: 'rt|p',
      projectId: 'p',
      addedAt: 0,
      lastUsed: 0,
      ...overrides.account,
    },
    auth: { access: 'access', expires: Date.now() + 3_600_000 },
    impersonation: {
      'User-Agent': 'antigravity/1.2.3 windows/amd64',
      'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
      clientMetadata: { ideType: 'ANTIGRAVITY' },
    },
  } as unknown as AgyAccountSession
}

function options(overrides: Record<string, unknown> = {}): never {
  return {
    provider: 'agy',
    model: 'gemini-4-hydrogen-high',
    messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    ...overrides,
  } as never
}

describe('risk control', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('never puts the system prompt in the systemInstruction slot', async () => {
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''))
      return new Response(sseStream(['data: [DONE]']), { status: 200 })
    }))
    const adapter = new AgyAdapter({
      getSession: async () => session(),
      reportFailure: async () => {},
    })
    for await (const _ of adapter.stream(options({ system: 'You are Claude Code. You MUST answer.' }))) void _

    const body = JSON.parse(bodies[0]!) as {
      requestType?: string
      request: { systemInstruction?: unknown, contents: Array<{ parts: Array<{ text: string }> }> }
    }
    expect(body.requestType).toBe('agent')
    expect(body.request.systemInstruction).toBeUndefined()
    const sent = body.request.contents.flatMap((content) => content.parts.map((part) => part.text)).join('\n')
    expect(sent).toMatch(/coding assistant/)
    expect(sent).not.toMatch(/Claude Code/i)
    expect(sent).not.toMatch(/\bMUST\b/i)
  })

  it('moves the egress on a refused region without cooling the account', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '{"error":{"code":400,"message":"User location is not supported for the API use.","status":"FAILED_PRECONDITION"}}',
      { status: 400 },
    )))
    const reportFailure = vi.fn(async () => {})
    const onLocationRejected = vi.fn()
    const adapter = new AgyAdapter({
      getSession: async () => session(),
      reportFailure,
      onLocationRejected,
    })

    await expect(async () => {
      for await (const _ of adapter.stream(options())) void _
    }).rejects.toMatchObject({ code: 'RATE_LIMIT' })
    expect(onLocationRejected).toHaveBeenCalledTimes(1)
    expect(reportFailure).not.toHaveBeenCalled()
  })

  it('treats a quota-labelled 429 as content when the cache shows quota left', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}',
      { status: 429 },
    )))
    const reportFailure = vi.fn(async () => {})
    const adapter = new AgyAdapter({
      getSession: async () => session({
        account: { cachedQuota: { gemini: { remainingFraction: 0.9, resetTime: new Date(Date.now() + 3_600_000).toISOString() } } },
      }),
      reportFailure,
    })

    await expect(async () => {
      for await (const _ of adapter.stream(options())) void _
    }).rejects.toMatchObject({ code: 'RATE_LIMIT' })
    expect(reportFailure).not.toHaveBeenCalled()
  })

  it('keeps a 429 terminal when the cache shows the window spent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}',
      { status: 429 },
    )))
    const reportFailure = vi.fn(async () => {})
    const adapter = new AgyAdapter({
      getSession: async () => session({
        account: { cachedQuota: { gemini: { remainingFraction: 0, resetTime: new Date(Date.now() + 3_600_000).toISOString() } } },
      }),
      reportFailure,
    })

    await expect(async () => {
      for await (const _ of adapter.stream(options())) void _
    }).rejects.toMatchObject({ code: 'QUOTA' })
    expect(reportFailure).toHaveBeenCalled()
  })
})
