/* The tools through the protocol, against a fake hub. */
import { describe, expect, it } from 'vitest';
import { configFromEnv } from '../src/config.js';
import { HUB_REVISION } from '../src/server.js';
import { connected, fakeHub, text } from './helpers.js';

const DISCOVERY = {
  role: 'remote',
  versions: ['2026-11-21', '2026-11-20'],
  identity: { resolver: 'header', headers: { 'Armature-User': 'person' } },
  instance: { name: 'Demo Armature' },
  capabilities: { 'armature/branches': { fallback: 'reject' }, 'armature/intelligence': { fallback: 'reject' } },
  schema: { route: '/api/v1/schema' },
};
const commit = (id: string, author: string, message: string, timestamp: number) => ({ commit: id, author, message, timestamp });
const BRANCHES = [
  { name: 'demo-change', head: commit('demochangehead00', 'User/demo-designer', 'Raise the objective\n\nArmature-On-Behalf-Of: x', 1_790_000_200) },
  { name: 'main', head: commit('mainhead00000000', 'User/demo-reviewer', "SME review: the .org item's key affirmed", 1_790_000_100) },
];

describe('the server', () => {
  it('offers describe_hub and list_branches, both read-only', async () => {
    const { client, close } = await connected(configFromEnv({}), fakeHub({}).fetch);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['describe_hub', 'list_branches']);
    for (const t of tools) expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    await close();
  });

  it("describe_hub summarizes the hub's discovery and returns it whole, with how this server reads", async () => {
    const hub = fakeHub({ '/api/v1/discover': { body: DISCOVERY } });
    const { client, close } = await connected(configFromEnv({ ARMATURE_USER: 'demo-designer@example.edu' }), hub.fetch);
    const result = await client.callTool({ name: 'describe_hub', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('Demo Armature: a shared hub at http://localhost:3100.');
    expect(text(result)).toContain('Newest API revision 2026-11-21; 2 served.');
    expect(text(result)).toContain('This server reads main unless a tool names another branch or a commit, as demo-designer@example.edu; writes are off.');
    expect(result.structuredContent).toMatchObject({ role: 'remote', server: { branch: 'main', writes: false, user: 'demo-designer@example.edu' } });
    // The hub is asked at the revision the server relies on, as the configured person.
    expect(hub.asked[0].headers).toMatchObject({ 'armature-version': HUB_REVISION, 'armature-user': 'demo-designer@example.edu' });
    await close();
  });

  it('list_branches lists main first, each head with its author and first line', async () => {
    const { client, close } = await connected(configFromEnv({}), fakeHub({ '/api/v1/branches': { body: BRANCHES } }).fetch);
    const result = await client.callTool({ name: 'list_branches', arguments: {} });
    const lines = text(result).split('\n');
    expect(lines[0]).toBe('2 branches:');
    expect(lines[1]).toMatch(/^main: mainhead0000 by User\/demo-reviewer, .* UTC: SME review: the \.org item's key affirmed$/);
    expect(lines[2]).toMatch(/^demo-change: demochangehe by User\/demo-designer, .*: Raise the objective$/);
    expect((result.structuredContent as { branches: unknown[] }).branches).toHaveLength(2);
    await close();
  });

  it("answers a hub's refusal as a tool error carrying its code, and an unreachable hub as one too", async () => {
    const refusing = fakeHub({ '/api/v1/discover': { status: 400, body: { error: 'unsupported_version', message: 'This hub serves 2026-11-16 and older', supported: ['2026-11-16'] } } });
    const a = await connected(configFromEnv({}), refusing.fetch);
    const refused = await a.client.callTool({ name: 'describe_hub', arguments: {} });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toBe('The hub refused (400 unsupported_version): This hub serves 2026-11-16 and older');
    expect(refused.structuredContent).toMatchObject({ error: 'unsupported_version', supported: ['2026-11-16'] });
    await a.close();

    const down = (async () => { throw new TypeError('fetch failed'); }) as typeof globalThis.fetch;
    const b = await connected(configFromEnv({}), down);
    const unreachable = await b.client.callTool({ name: 'list_branches', arguments: {} });
    expect(unreachable.isError).toBe(true);
    expect(text(unreachable)).toContain('The hub could not be reached: fetch failed.');
    await b.close();
  });
});
