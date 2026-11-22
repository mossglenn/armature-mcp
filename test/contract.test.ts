/**
 * The tools against a real hub seeded with Armature's ICICLE demo seed
 * (scripts/seed_icicle_demo.js; `npm run demo:reset` and `demo:start` in
 * Armature), the hub the demonstration and CI's contract job run. Skipped
 * unless ARMATURE_HUB_URL names one.
 */
import { describe, expect, it } from 'vitest';
import { configFromEnv } from '../src/config.js';
import { HUB_REVISION } from '../src/server.js';
import { connected, text } from './helpers.js';

const hub = process.env.ARMATURE_HUB_URL;

describe.skipIf(!hub)('against a hub with the ICICLE seed', () => {
  const config = () => configFromEnv({ ARMATURE_HUB_URL: hub, ARMATURE_USER: 'demo-designer@example.edu' });

  it('describe_hub: a shared hub under header identity that serves the revision this server relies on', async () => {
    const { client, close } = await connected(config());
    const result = await client.callTool({ name: 'describe_hub', arguments: {} });
    expect(result.isError).toBeFalsy();
    const data = result.structuredContent as { role: string; versions: string[]; identity: { resolver: string } };
    expect(data.role).toBe('remote');
    expect(data.versions).toContain(HUB_REVISION);
    expect(data.identity.resolver).toBe('header');
    expect(text(result)).toContain('a shared hub');
    await close();
  });

  it("list_branches: main's latest commit is the reviewer's affirmation", async () => {
    const { client, close } = await connected(config());
    const result = await client.callTool({ name: 'list_branches', arguments: {} });
    const main = (result.structuredContent as { branches: Array<{ name: string; head: { author: string; message: string } }> }).branches.find((b) => b.name === 'main');
    expect(main?.head).toMatchObject({ author: 'User/demo-reviewer', message: "SME review: the .org item's key affirmed" });
    expect(text(result).split('\n')[1]).toMatch(/^main: .* by User\/demo-reviewer/);
    await close();
  });
});
