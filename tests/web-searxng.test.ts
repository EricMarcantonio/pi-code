import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCompleteBackend } from '../extensions/internal/model-complete.ts'
import { httpFetch } from '../extensions/internal/web-transport.ts'
import webExtension, { parseSearxngResults, readWebSettings, searxngStarter } from '../extensions/web.ts'

vi.mock('node:child_process', () => ({ spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })) }))
vi.mock('../extensions/internal/web-transport.ts', () => ({ httpFetch: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }))

type ToolResult = { content: Array<{ type: string; text: string }> }
type Tool = { name: string; description: string; parameters: { properties: Record<string, unknown> }; execute: (...args: unknown[]) => Promise<ToolResult> }

const spawnMock = vi.mocked(spawn)
const transportMock = vi.mocked(httpFetch)

function agentDir(settings: Record<string, unknown>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pi-code-searxng-'))
  writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings))
  return dir
}

function load(settings: Record<string, unknown>): Map<string, Tool> {
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir(settings))
  const tools = new Map<string, Tool>()
  webExtension({ on: () => {}, registerCommand: () => {}, registerTool: (tool: Tool) => tools.set(tool.name, tool) } as never)
  return tools
}

const search = (tools: Map<string, Tool>, query: string) => tools.get('web_search')?.execute('call-1', { query }) as Promise<ToolResult>

const SEARXNG = { webSearch: { searxngUrl: 'http://127.0.0.1:8888', startCommand: 'docker compose -f services/compose.yml up -d searxng' } }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.stubEnv('SEARXNG_URL', '')
  spawnMock.mockClear()
  transportMock.mockReset()
  fetchMock = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  setCompleteBackend(null)
})

describe('readWebSettings', () => {
  it('reads webSearch and webFetch from settings.json, with defaults', () => {
    expect(readWebSettings(agentDir({}), {})).toEqual({ searxngUrl: undefined, startCommand: undefined, fetchPrompt: true })
    const dir = agentDir({ ...SEARXNG, webFetch: { prompt: false } })
    expect(readWebSettings(dir, {})).toEqual({ searxngUrl: 'http://127.0.0.1:8888', startCommand: SEARXNG.webSearch.startCommand, fetchPrompt: false })
  })

  it('lets SEARXNG_URL override the settings URL', () => {
    expect(readWebSettings(agentDir(SEARXNG), { SEARXNG_URL: 'http://localhost:9999' }).searxngUrl).toBe('http://localhost:9999')
  })

  it('keeps defaults when settings.json is missing or malformed', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pi-code-searxng-'))
    expect(readWebSettings(dir, {}).fetchPrompt).toBe(true)
    writeFileSync(path.join(dir, 'settings.json'), '{not json')
    expect(readWebSettings(dir, {}).searxngUrl).toBeUndefined()
  })
})

describe('parseSearxngResults', () => {
  it('keeps http(s) results up to the limit and falls back to the URL as title', () => {
    const results = parseSearxngResults(
      {
        results: [{ title: 'A', url: 'https://a.example/', content: 'first' }, { title: 'Bad', url: 'javascript:alert(1)' }, { url: 'http://b.example/x' }, { title: 'C', url: 'https://c.example/' }],
      },
      2,
    )
    expect(results).toEqual([
      { title: 'A', url: 'https://a.example/', snippet: 'first' },
      { title: 'http://b.example/x', url: 'http://b.example/x', snippet: '' },
    ])
    expect(parseSearxngResults({}, 5)).toEqual([])
    expect(parseSearxngResults(null, 5)).toEqual([])
  })
})

describe('web_search with SearXNG', () => {
  it('queries the JSON API and formats results, without touching DuckDuckGo', async () => {
    fetchMock.mockResolvedValue(json({ results: [{ title: 'pi', url: 'https://pi.dev/', content: 'coding agent' }] }))
    const tools = load({ webSearch: { searxngUrl: 'http://127.0.0.1:8888' } })
    const result = await search(tools, 'pi agent')
    expect(result.content[0].text).toBe('1. pi\n   https://pi.dev/\n   coding agent')
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://127.0.0.1:8888/search?q=pi+agent&format=json')
    expect(transportMock).not.toHaveBeenCalled()
    expect(tools.get('web_search')?.description).toContain('SearXNG')
  })

  it('starts SearXNG in the background when it is down, once per minute', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const tools = load(SEARXNG)
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1)) // warm-up at load
    const first = await search(tools, 'q')
    const second = await search(tools, 'q')
    expect(first.content[0].text).toContain('starting in the background; retry web_search')
    expect(second.content[0].text).toContain('starting in the background')
    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock.mock.calls[0][0]).toBe(SEARXNG.webSearch.startCommand)
    expect(spawnMock.mock.calls[0][1]).toMatchObject({ detached: true, shell: true, stdio: 'ignore' })
  })

  it('says to start it by hand when no start command is configured', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const result = await search(load({ webSearch: { searxngUrl: 'http://127.0.0.1:8888' } }), 'q')
    expect(result.content[0].text).toContain('Start it, then retry web_search')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('reports a disabled JSON format instead of trying to start anything', async () => {
    fetchMock.mockResolvedValue(json({}, 403))
    const result = await search(load({ webSearch: { searxngUrl: 'http://127.0.0.1:8888' } }), 'q')
    expect(result.content[0].text).toContain('enable the json format')
  })

  it('does not start SearXNG at load when it is already up', async () => {
    fetchMock.mockResolvedValue(new Response('OK'))
    load(SEARXNG)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(fetchMock).toHaveBeenCalledWith(new URL('http://127.0.0.1:8888/healthz'), expect.anything())
    expect(spawnMock).not.toHaveBeenCalled()
  })
})

describe('searxngStarter', () => {
  it('reruns the command only after the interval', () => {
    let now = 0
    const start = searxngStarter('true', '/tmp', () => now)
    start()
    now = 59_999
    start()
    now = 60_000
    start()
    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(searxngStarter(undefined, '/tmp')()).toBe(false)
  })
})

describe('web_fetch with webFetch.prompt off', () => {
  it('drops the prompt parameter and never calls the model', async () => {
    transportMock.mockResolvedValue(new Response('<p>page</p>', { headers: { 'content-type': 'text/html' } }))
    const backend = vi.fn()
    setCompleteBackend(backend as never)
    const fetchTool = load({ webFetch: { prompt: false } }).get('web_fetch')
    expect(Object.keys(fetchTool?.parameters.properties ?? {})).toEqual(['url'])
    expect(fetchTool?.description).not.toContain('prompt')
    const result = await fetchTool?.execute('call-1', { url: 'https://example.com/', prompt: 'summarize' }, undefined, undefined, { model: {} })
    expect(result?.content[0].text).toBe('page')
    expect(backend).not.toHaveBeenCalled()
  })
})
