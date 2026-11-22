/**
 * The server driven as an assistant drives it: the SDK's client over a linked
 * in-memory transport pair, so a test exercises tool listing, argument
 * validation and results through the protocol, not by calling handlers.
 */
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { Config } from '../src/config.js';
import { createServer, hubClient } from '../src/server.js';

export async function connected(config: Config, fetch?: typeof globalThis.fetch) {
  const server = createServer(config, hubClient(config, fetch));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'armature-mcp-test', version: '0.0.0' });
  await client.connect(clientSide);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

/** A hub that answers a few paths with canned JSON and records what it was asked. */
export function fakeHub(routes: Record<string, { status?: number; body: unknown }>) {
  const asked: Array<{ path: string; headers: Record<string, string> }> = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    asked.push({ path: url.pathname + url.search, headers });
    const route = routes[url.pathname];
    if (!route) return new Response(JSON.stringify({ error: 'not_found', message: `No route ${url.pathname}` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

export const text = (result: { content?: unknown }) =>
  ((result.content as Array<{ type: string; text?: string }>) ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
