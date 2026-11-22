/**
 * The stdio entry (plan §3, question 3): an assistant starts this process and
 * speaks MCP on its standard input and output. Standard output is the protocol,
 * so everything the server says to a person goes to standard error.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ConfigError, configFromEnv } from './config.js';
import { createServer, discoverHub, SERVER_VERSION } from './server.js';

let config;
try {
  config = configFromEnv();
} catch (err) {
  if (err instanceof ConfigError) {
    process.stderr.write(`armature-mcp: ${err.message}\n`);
    process.exit(2);
  }
  throw err;
}

// The tool list follows what the hub serves (plan §8), so it is read once, before serving.
const discovered = await discoverHub(config);
serveStdio(() => createServer(config, { discovered }));
const reach = 'served' in discovered ? `${discovered.served.length} capabilities` : `not reachable (${discovered.unreachable}); offering every tool`;
process.stderr.write(`armature-mcp ${SERVER_VERSION}: serving ${config.hubUrl} on stdio${config.user ? ` as ${config.user}` : ''}; hub ${reach}\n`);
