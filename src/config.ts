/**
 * The server's configuration, from the environment, the convention for stdio
 * servers (plan §3, question 3): nothing on the command line, nothing in a file.
 *
 *   ARMATURE_HUB_URL     the hub's origin; http://localhost:3100 by default
 *   ARMATURE_USER        the person's externalId, sent as Armature-User (on a workspace hub, its owner)
 *   ARMATURE_AGENT       the agent's externalId (agent:…), sent as Armature-Agent on writes (M4)
 *   ARMATURE_BRANCH      the branch read when a tool names none; main by default
 *   ARMATURE_WRITES      "on" to offer the proposal tools (M4); off by default
 *   ARMATURE_LOCAL_TOKEN a workspace hub's pairing key, sent as Armature-Local-Token
 */

export interface Config {
  hubUrl: string;
  user?: string;
  agent?: string;
  branch: string;
  writes: boolean;
  localToken?: string;
}

export class ConfigError extends Error {}

const set = (value: string | undefined): string | undefined => (value && value.trim() ? value.trim() : undefined);

export function configFromEnv(env: Record<string, string | undefined> = process.env): Config {
  const hubUrl = (set(env.ARMATURE_HUB_URL) ?? 'http://localhost:3100').replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(hubUrl);
  } catch {
    throw new ConfigError(`ARMATURE_HUB_URL is not a URL: ${hubUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new ConfigError(`ARMATURE_HUB_URL must be http or https: ${hubUrl}`);

  const agent = set(env.ARMATURE_AGENT);
  if (agent && !agent.startsWith('agent:')) throw new ConfigError(`ARMATURE_AGENT must be an agent's externalId, agent:…; it is ${agent}`);

  const writes = set(env.ARMATURE_WRITES)?.toLowerCase();
  if (writes !== undefined && writes !== 'on' && writes !== 'off') throw new ConfigError(`ARMATURE_WRITES is on or off; it is ${env.ARMATURE_WRITES}`);

  const user = set(env.ARMATURE_USER);
  const localToken = set(env.ARMATURE_LOCAL_TOKEN);
  return {
    hubUrl,
    ...(user ? { user } : {}),
    ...(agent ? { agent } : {}),
    branch: set(env.ARMATURE_BRANCH) ?? 'main',
    writes: writes === 'on',
    ...(localToken ? { localToken } : {}),
  };
}
