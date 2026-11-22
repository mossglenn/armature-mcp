/**
 * The server driven as an assistant drives it: the SDK's client over a linked
 * in-memory transport pair, so a test exercises tool listing, argument
 * validation and results through the protocol, not by calling handlers.
 */
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { Config } from '../src/config.js';
import { createServer, type ServerOptions } from '../src/server.js';

export async function connected(config: Config, fetch?: typeof globalThis.fetch, options: Omit<ServerOptions, 'fetch'> = {}) {
  const server = createServer(config, { ...options, ...(fetch ? { fetch } : {}) });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'armature-mcp-test', version: '0.0.0' });
  await client.connect(clientSide);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

export interface Asked {
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
}

/**
 * A hub that answers paths with canned JSON, each with the commit as its ETag,
 * and records what it was asked. A route's key is the path without the query.
 */
export function fakeHub(routes: Record<string, { status?: number; body: unknown; commit?: string }>) {
  const asked: Asked[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    asked.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), headers });
    const route = routes[url.pathname];
    const json = { 'Content-Type': 'application/json', 'Armature-Version': '2026-11-20' };
    if (!route) return new Response(JSON.stringify({ error: 'not_found', message: `No route ${url.pathname}` }), { status: 404, headers: json });
    const etag = route.commit ?? (route.status && route.status >= 400 ? undefined : 'commit0000000000000000000000000');
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200, headers: { ...json, ...(etag ? { ETag: `"${etag}"` } : {}) } });
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

export const text = (result: { content?: unknown }) =>
  ((result.content as Array<{ type: string; text?: string }>) ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

/** The summary alone: the first text block, before the JSON. */
export const summary = (result: { content?: unknown }) => ((result.content as Array<{ type: string; text?: string }>) ?? [])[0]?.text ?? '';

/** Every read tool, in the order the server lists them. */
export const ALL_TOOLS = [
  'describe_hub', 'describe_schema', 'list_branches', 'list_modules',
  'get_record', 'find_records', 'record_history', 'compare_record', 'branch_changes',
  'module_coverage', 'course_coverage', 'alignment_gaps', 'trace_record', 'what_references', 'attestation_status', 'module_content', 'item_statistics',
];
