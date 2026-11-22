/**
 * The stdio entry (plan §3, question 3): an assistant starts this process and
 * speaks MCP on its standard input and output. Standard output is the protocol,
 * so everything the server says to a person goes to standard error.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ConfigError, configFromEnv } from './config.js';
import { createServer, hubClient, SERVER_VERSION } from './server.js';

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

const client = hubClient(config);
serveStdio(() => createServer(config, client));
process.stderr.write(`armature-mcp ${SERVER_VERSION}: serving ${config.hubUrl} on stdio${config.user ? ` as ${config.user}` : ''}\n`);
