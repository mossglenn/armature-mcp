# armature-mcp

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant (Claude Desktop, Claude Code, any MCP client) ask an [Armature](https://github.com/mossglenn/armature) hub about a learning design: what it holds, why each decision was made, what a change would touch. It is a client of the hub like any other tool: it reads `/api/v1` through `@armature/client` and never touches the store.

**Status: M0** (2026-11-21). Two tools, `describe_hub` and `list_branches`, end to end. Next: M1 (every read: records, history, coverage, alignment, trace, impact, attestations), then M4 (filing notes and findings on a proposal branch). The plan, with every decision and its reason, is [docs/plan.md](docs/plan.md).

## Running it

Needs Node 22 or later, pnpm 10 (`corepack enable` gives it), and an Armature hub to talk to.

```sh
pnpm install
pnpm run build          # → dist/armature-mcp.mjs
```

A hub with the ICICLE demonstration's seed, from an Armature checkout:

```sh
npm run demo:reset      # seeds the database armature_icicle on the local store
npm run demo:start      # a hub on http://localhost:3100 and the viewer on :3000
```

### In Claude Code

```sh
claude mcp add armature \
  -e ARMATURE_HUB_URL=http://localhost:3100 \
  -e ARMATURE_USER=demo-designer@example.edu \
  -- node /absolute/path/to/armature-mcp/dist/armature-mcp.mjs
```

### In Claude Desktop

In `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "armature": {
      "command": "node",
      "args": ["/absolute/path/to/armature-mcp/dist/armature-mcp.mjs"],
      "env": {
        "ARMATURE_HUB_URL": "http://localhost:3100",
        "ARMATURE_USER": "demo-designer@example.edu"
      }
    }
  }
}
```

Restart Claude Desktop; `armature` appears among its tools. Ask: *"Describe the Armature hub."*

## Configuration

Environment variables only; the server reads nothing else.

| Variable | Default | Meaning |
| --- | --- | --- |
| `ARMATURE_HUB_URL` | `http://localhost:3100` | The hub's origin |
| `ARMATURE_USER` | none | The person's external identifier, sent as `Armature-User`; on a workspace hub, its owner |
| `ARMATURE_AGENT` | none | The agent's external identifier (`agent:…`), sent as `Armature-Agent` on writes (M4) |
| `ARMATURE_BRANCH` | `main` | The branch read when a tool names none |
| `ARMATURE_WRITES` | `off` | `on` offers the proposal tools (M4) |
| `ARMATURE_LOCAL_TOKEN` | none | A workspace hub's pairing key, from Armature Desktop |

A bad value stops the server at start with a message on standard error and exit code 2. Standard output is the protocol, so the server never writes anything else there.

## Tools

| Tool | Reads | Answers |
| --- | --- | --- |
| `describe_hub` | `GET /discover` | The instance, its role, the revisions it serves, how it identifies callers, its capabilities; and how this server reads |
| `list_branches` | `GET /branches` | Every branch with its latest commit, author and message |

Each answer is a short summary followed by the hub's JSON, which is also the result's structured content. A refusal from the hub is a tool error carrying the hub's code and message, so the assistant can explain it.

## Development

```sh
pnpm run typecheck
pnpm run build
pnpm test                                      # unit tests, and the built server over stdio
ARMATURE_HUB_URL=http://localhost:3100 pnpm test   # also against a hub with the ICICLE seed
```

The contract tests expect `main` as the seed leaves it: run `npm run demo:reset` in Armature first. CI's `contract` job checks out Armature at the commit `package.json` pins for `@armature/client`, seeds it and starts its hub.

The server asks the hub for API revision `HUB_REVISION` (`src/server.ts`), the oldest that has every route it calls, so a hub one revision behind still answers. Raise it only when a tool needs a newer route, and move the Armature pin with it.

## License

MIT
