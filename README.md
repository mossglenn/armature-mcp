# armature-mcp

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant (Claude Desktop, Claude Code, any MCP client) ask an [Armature](https://github.com/mossglenn/armature) hub about a learning design: what it holds, why each decision was made, what a change would touch. It is a client of the hub like any other tool: it reads `/api/v1` through `@armature/client` and never touches the store.

**Status: M4** (2026-11-21). Seventeen read tools (the hub, its schema and branches, records and their history, and the hub's design intelligence), and, when writes are on, three proposal tools that open a proposal branch and file notes and findings on it as an agent acting for the person. That is every tool the ICICLE demonstration uses. Next: M2 (export, resources, prompts) and M3 (the evaluation). The plan, with every decision and its reason, is [docs/plan.md](docs/plan.md).

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

Restart Claude Desktop; `armature` appears among its tools. Ask: *"Describe the Armature hub."* Then the demonstration's questions: *"Why does the .org item have C as its key?"*, *"What would raising the lateral-reading objective to Evaluate affect?"*

## Configuration

Environment variables only; the server reads nothing else.

| Variable | Default | Meaning |
| --- | --- | --- |
| `ARMATURE_HUB_URL` | `http://localhost:3100` | The hub's origin |
| `ARMATURE_USER` | none | The person's external identifier, sent as `Armature-User`; on a workspace hub, its owner |
| `ARMATURE_AGENT` | none | The agent's external identifier (`agent:…`), sent as `Armature-Agent` on writes; registered on the hub as an agent `User` (the ICICLE seed has `agent:armature-mcp`) |
| `ARMATURE_BRANCH` | `main` | The branch read when a tool names none |
| `ARMATURE_WRITES` | `off` | `on` offers the proposal tools; needs `ARMATURE_USER` and `ARMATURE_AGENT` |
| `ARMATURE_LOCAL_TOKEN` | none | A workspace hub's pairing key, from Armature Desktop |

A bad value stops the server at start with a message on standard error and exit code 2. Standard output is the protocol, so the server never writes anything else there.

## Tools

The server reads `GET /discover` when it starts and offers only the tools whose capability the hub serves; if the hub cannot be reached then, it offers every tool and says so in `describe_hub`. Restart it after the hub is upgraded.

Every read takes `branch` or `ref` (a commit id), not both, and reads `ARMATURE_BRANCH` when given neither. Records are named by `type` (a class, such as `LearningObjective`) and `id` (`Type/local` or the local part).

| Tool | Reads | Answers |
| --- | --- | --- |
| `describe_hub` | `GET /discover` | The instance, its role, the revisions it serves, how it identifies callers, its capabilities; and how this server reads |
| `describe_schema` | `GET /schema` | Every class by category with its fields, or one class in full with what each field means |
| `list_branches` | `GET /branches` | Every branch with its latest commit, author and message |
| `list_modules` | `GET /documents/Module` | Every module by course and sequence |
| `get_record` | `GET /documents/:type/:id` | One record whole: its fields, its parts, its rationale |
| `find_records` | `GET /documents/:type` | Records of a class whose fields equal given values, paged |
| `record_history` | `GET /documents/:type/:id/history` | The commits that touched a record, with author, reason and the person an assistant acted for |
| `compare_record` | `GET /documents/:type/:id/diff` | Each field of a record that changed between two commits, before and after |
| `branch_changes` | `GET /branches/:name/changes` | What a branch inserted, updated and deleted since a commit |
| `module_coverage` | `GET /intelligence/coverage/:module` | Each declared objective's coverage verdict, delivered and projected |
| `course_coverage` | `GET /intelligence/coverage` | The same for every module of a course |
| `alignment_gaps` | `GET /intelligence/alignment` | Items below their objective's Bloom's level, objectives no item or activity reaches |
| `trace_record` | `GET /intelligence/trace/:type/:id` | From evidence to metric, both ways, with the notes and findings on the way |
| `what_references` | `GET /intelligence/impact/:type/:id` | Every record that points at this one, and through which field |
| `attestation_status` | `GET /intelligence/attestations/:type/:id` | Who affirmed or declined what, and whether the record changed since |
| `module_content` | `GET /intelligence/module-content/:module` | Activities and lessons in teaching order, with practice items |
| `item_statistics` | `GET /intelligence/item-statistics` | Every metric about each item, as recorded |

Each answer is a short summary the server writes, naming the commit it read, followed by the hub's JSON, which is also the result's structured content with `commit` and `revision` added. An answer over 40,000 characters is cut to fit, its largest list first, and says how much is shown and how to narrow the question. A refusal from the hub is a tool error carrying the hub's code and message, what the code means, and what to try next, so the assistant can explain it: Armature refuses to list records by the person who made them, and the refusal says why.

## Proposals (writes)

With `ARMATURE_WRITES=on` the server also offers three tools. Each writes as the agent (`ARMATURE_AGENT`) acting for the person (`ARMATURE_USER`). The agent is the commit's author and the record's `createdBy`, and the hub itself adds an `Armature-On-Behalf-Of` trailer naming the person, so the history says who did it for whom.

| Tool | Writes | What |
| --- | --- | --- |
| `start_proposal_branch` | `POST /branches` | A branch `agent-<topic>` from the branch or commit the conversation read; answers with its latest commit |
| `propose_note` | `POST /documents` | One `DesignNote` on a proposal branch: a reason or an intent, on the records it is about |
| `propose_finding` | `POST /documents` | One `DesignFinding`, status `Open`, on a proposal branch: a concern, its evidence, a suggestion |

The server applies its own rules before the hub sees a write:
- Nothing is written to `main`.
- On a shared hub, writes go only to branches named `agent-…`. On a workspace hub, they go to the person's workspace, and `start_proposal_branch` is not offered, since the hub refuses branch creation there.
- It writes only notes and findings, never objectives, items or activities, and it never merges or deletes.

Pass `basedOn`, the branch's latest commit as last read, and the hub refuses the write with `precondition_failed` if someone has written to the branch since. A person reads the proposal and decides; a finding is marked Addressed or Dismissed by a person, not by the agent.

For the demonstration's fourth beat, add the two variables to the configuration above:

```json
"ARMATURE_AGENT": "agent:armature-mcp",
"ARMATURE_WRITES": "on"
```

A host asks the person before it runs a tool that writes; each write tool's description says what it will write and where.

## Development

```sh
pnpm run typecheck
pnpm run build
pnpm test                                      # unit tests, and the built server over stdio
ARMATURE_HUB_URL=http://localhost:3199 pnpm test   # also against a hub with a fresh ICICLE seed (below)
```

The contract tests expect `main` as the seed leaves it, and their last block writes a branch, so each run needs a fresh seed. Give them a database and a hub of their own, so they stay off the demonstration's: in Armature, `TERMINUS_DB=armature_mcp_contract npm run demo:reset`, then `TERMINUS_DB=armature_mcp_contract PORT=3199 node dist/server.mjs` in `app/` (after `npm run build:hub`), and `ARMATURE_HUB_URL=http://localhost:3199 pnpm test` here; reset before each run. CI's `contract` job checks out Armature at the commit `package.json` pins for `@armature/client`, seeds it and starts its hub.

The server asks the hub for API revision `HUB_REVISION` (`src/server.ts`), the oldest that has every route it calls, so a hub one revision behind still answers. Raise it only when a tool needs a newer route, and move the Armature pin with it.

## License

MIT
