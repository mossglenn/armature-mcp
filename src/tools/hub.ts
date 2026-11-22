/**
 * The hub itself (plan §4.1): what it is and serves, and its branches. The
 * two tools M0 carries end to end.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { ArmatureClient } from '../server.js';
import type { Config } from '../config.js';
import { answer, guarded } from '../answer.js';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const firstLine = (message: string) => message.split('\n')[0] ?? '';
const when = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

export function registerHubTools(server: McpServer, client: ArmatureClient, config: Config): void {
  server.registerTool(
    'describe_hub',
    {
      title: 'Describe the hub',
      description:
        "What this Armature hub is: the instance's name, whether it is a shared hub or a person's workspace hub, the API revisions it serves, how it identifies callers, and its capabilities with their settings (coverage thresholds, export profiles). Ask this first in a conversation; the other tools' answers name the commit they read.",
      annotations: READ_ONLY,
    },
    () =>
      guarded(async () => {
        const { data } = await client.discover();
        const name = data.instance?.name;
        const lines = [
          `${name ? `${name}: ` : ''}${data.role === 'workspace' ? "a person's workspace hub" : 'a shared hub'} at ${config.hubUrl}.`,
          `Newest API revision ${data.versions[0]}; ${data.versions.length} served.`,
          `Identifies callers by ${data.identity.resolver === 'header' ? 'a trusted header (loopback only)' : data.identity.resolver}.`,
          `${Object.keys(data.capabilities).length} capabilities: ${Object.keys(data.capabilities).sort().join(', ')}.`,
          `This server reads ${config.branch} unless a tool names another branch or a commit${config.user ? `, as ${config.user}` : ''}; writes are ${config.writes ? 'on' : 'off'}.`,
        ];
        return answer(lines.join('\n'), { ...data, server: { branch: config.branch, writes: config.writes, ...(config.user ? { user: config.user } : {}) } });
      })
  );

  server.registerTool(
    'list_branches',
    {
      title: 'List branches',
      description:
        "Every branch on the hub with its latest commit: the commit id, its author and its message, newest work first. main is the shared, agreed design; other branches are review rounds, people's workspaces or proposals. Pass a branch name or a commit id to the other tools to read there.",
      annotations: READ_ONLY,
    },
    () =>
      guarded(async () => {
        const { data } = await client.branches.list();
        const branches = [...data].sort((a, b) => (a.name === 'main' ? -1 : b.name === 'main' ? 1 : b.head.timestamp - a.head.timestamp));
        const lines = branches.map((b) => `${b.name}: ${b.head.commit.slice(0, 12)} by ${b.head.author}, ${when(b.head.timestamp)}: ${firstLine(b.head.message)}`);
        return answer(`${branches.length} branch${branches.length === 1 ? '' : 'es'}:\n${lines.join('\n')}`, { branches });
      })
  );
}
