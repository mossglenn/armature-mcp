/**
 * The built server as an assistant starts it (M0's acceptance): `node
 * dist/armature-mcp.mjs` over stdio, its configuration from the environment.
 * Needs `pnpm run build` first, which CI runs before the tests; skipped when
 * there is no build. A hub is needed only for the last case.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, text } from './helpers.js';

const bin = fileURLToPath(new URL('../dist/armature-mcp.mjs', import.meta.url));
const hub = process.env.ARMATURE_HUB_URL;

async function start(env: Record<string, string>) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [bin], env: { ...getDefaultEnvironment(), ...env }, stderr: 'pipe' });
  const client = new Client({ name: 'armature-mcp-stdio-test', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

describe.skipIf(!existsSync(bin))('the built server over stdio', () => {
  it('lists every tool when no hub answers at start, and answers a call as unreachable', async () => {
    const client = await start({ ARMATURE_HUB_URL: 'http://127.0.0.1:9' });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(ALL_TOOLS);
    const down = await client.callTool({ name: 'describe_hub', arguments: {} });
    expect(down.isError).toBe(true);
    await client.close();
  });

  it('offers the proposal tools when writes are on, and will not start with writes on but no agent', async () => {
    const client = await start({ ARMATURE_HUB_URL: 'http://127.0.0.1:9', ARMATURE_USER: 'demo-designer@example.edu', ARMATURE_AGENT: 'agent:armature-mcp', ARMATURE_WRITES: 'on' });
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([...ALL_TOOLS, 'start_proposal_branch', 'propose_note', 'propose_finding']);
    await client.close();
    const refused = spawnSync(process.execPath, [bin], { env: { ...process.env, ARMATURE_USER: 'demo-designer@example.edu', ARMATURE_WRITES: 'on', ARMATURE_AGENT: '' }, encoding: 'utf8' });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('ARMATURE_WRITES=on needs');
  });

  it.skipIf(!hub)('answers describe_hub from the hub', async () => {
    const client = await start({ ARMATURE_HUB_URL: hub!, ARMATURE_USER: 'demo-designer@example.edu' });
    const result = await client.callTool({ name: 'describe_hub', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('a shared hub');
    await client.close();
  });
});
