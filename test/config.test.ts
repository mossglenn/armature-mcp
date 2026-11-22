import { describe, expect, it } from 'vitest';
import { ConfigError, configFromEnv } from '../src/config.js';

describe('configFromEnv', () => {
  it('defaults to a local hub, main, and no writes', () => {
    expect(configFromEnv({})).toEqual({ hubUrl: 'http://localhost:3100', branch: 'main', writes: false });
  });

  it('reads every variable, trimming a trailing slash from the hub', () => {
    expect(
      configFromEnv({
        ARMATURE_HUB_URL: 'http://localhost:3101/',
        ARMATURE_USER: 'demo-designer@example.edu',
        ARMATURE_AGENT: 'agent:armature-mcp',
        ARMATURE_BRANCH: 'demo-change',
        ARMATURE_WRITES: 'ON',
        ARMATURE_LOCAL_TOKEN: 'k',
      })
    ).toEqual({ hubUrl: 'http://localhost:3101', user: 'demo-designer@example.edu', agent: 'agent:armature-mcp', branch: 'demo-change', writes: true, localToken: 'k' });
  });

  it('refuses what would fail later, with what to fix', () => {
    expect(() => configFromEnv({ ARMATURE_HUB_URL: 'localhost:3100' })).toThrow(ConfigError);
    expect(() => configFromEnv({ ARMATURE_HUB_URL: 'not a url' })).toThrow(/not a URL/);
    expect(() => configFromEnv({ ARMATURE_AGENT: 'armature-mcp' })).toThrow(/agent:/);
    expect(() => configFromEnv({ ARMATURE_WRITES: 'yes' })).toThrow(/on or off/);
    expect(() => configFromEnv({ ARMATURE_WRITES: 'on', ARMATURE_USER: 'demo-designer@example.edu' })).toThrow(/ARMATURE_AGENT/);
    expect(() => configFromEnv({ ARMATURE_WRITES: 'on', ARMATURE_AGENT: 'agent:armature-mcp' })).toThrow(/ARMATURE_USER/);
  });
});
