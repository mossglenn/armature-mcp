/*
 * M4's proposal tools through the protocol, against a fake hub: offered only
 * when writes are on, sent as the agent acting for the person, held to the
 * server's own rules before the hub is asked, and refusals explained.
 */
import { describe, expect, it } from 'vitest';
import { configFromEnv } from '../src/config.js';
import { ALL_TOOLS, connected, fakeHub, summary, text } from './helpers.js';

const WRITERS = { ARMATURE_USER: 'demo-designer@example.edu', ARMATURE_AGENT: 'agent:armature-mcp', ARMATURE_WRITES: 'on' };
const REMOTE = ['armature/discover', 'armature/documents', 'armature/branches'];
const WORKSPACE = [...REMOTE, 'armature/workspace'];
const HEAD = 'branchhead000000000000000000000';
const FINDING = {
  branch: 'agent-split-objective',
  subject: ['PrerequisiteRecord/p1'],
  regarding: 'LearningObjective/o1',
  label: 'Module 2 depends on the quick check this change removes',
  finding: 'Lateral reading is now an Evaluate objective.',
  confidence: 'High',
  message: 'The raised objective conflicts with the prerequisite Module 2 was built on',
};
const batchHub = (status = 200, body: unknown = { commit: 'filed00000000000000000000000000', ids: ['DesignFinding/abc'] }) =>
  fakeHub({ '/api/v1/documents': { status, body } });

describe('which tools are offered', () => {
  it('offers no write tool unless writes are on', async () => {
    const { client, close } = await connected(configFromEnv({ ARMATURE_USER: 'demo-designer@example.edu', ARMATURE_AGENT: 'agent:armature-mcp' }), fakeHub({}).fetch);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(ALL_TOOLS);
    await close();
  });

  it('offers the three proposal tools after the reads when writes are on, each a write that destroys nothing', async () => {
    const { client, close } = await connected(configFromEnv(WRITERS), fakeHub({}).fetch);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([...ALL_TOOLS, 'start_proposal_branch', 'propose_note', 'propose_finding']);
    for (const t of tools.slice(ALL_TOOLS.length)) expect(t.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
    await close();
  });

  it('on a workspace hub offers no branch tool, which the hub refuses there (remote_only)', async () => {
    const { client, close } = await connected(configFromEnv(WRITERS), fakeHub({}).fetch, { discovered: { served: WORKSPACE } });
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('propose_finding');
    expect(names).not.toContain('start_proposal_branch');
    await close();
  });
});

describe('start_proposal_branch', () => {
  it('opens agent-<topic> from the branch the conversation read, as the agent for the person, and answers with its latest commit', async () => {
    const summaryOf = { name: 'agent-split-objective', head: { commit: HEAD, author: 'User/demo-designer', message: 'x', timestamp: 1 } };
    const hub = fakeHub({ '/api/v1/branches': { status: 201, body: summaryOf }, '/api/v1/branches/agent-split-objective': { body: summaryOf } });
    const { client, close } = await connected(configFromEnv(WRITERS), hub.fetch, { discovered: { served: REMOTE } });
    const result = await client.callTool({ name: 'start_proposal_branch', arguments: { topic: 'split-objective', branch: 'demo-change' } });
    expect(hub.asked[0]).toMatchObject({ method: 'POST', body: { name: 'agent-split-objective', from: { branch: 'demo-change' } } });
    expect(hub.asked[0]!.headers).toMatchObject({ 'armature-user': 'demo-designer@example.edu', 'armature-agent': 'agent:armature-mcp' });
    expect(summary(result).split('\n')[0]).toBe(`Opened the proposal branch agent-split-objective from demo-change, as agent:armature-mcp for demo-designer@example.edu; its latest commit is ${HEAD}.`);
    expect(result.structuredContent).toMatchObject({ branch: 'agent-split-objective', commit: HEAD });
    await close();
  });

  it('refuses a topic that would not make a branch name, before asking the hub', async () => {
    const hub = fakeHub({});
    const { client, close } = await connected(configFromEnv(WRITERS), hub.fetch);
    const result = await client.callTool({ name: 'start_proposal_branch', arguments: { topic: 'Split Objective!' } });
    expect(result.isError).toBe(true);
    expect(hub.asked).toHaveLength(0);
    await close();
  });
});

describe('propose_finding and propose_note', () => {
  it('files one Open finding in one commit, If-Match the commit read, with no author fields of its own', async () => {
    const hub = batchHub();
    const { client, close } = await connected(configFromEnv(WRITERS), hub.fetch, { discovered: { served: REMOTE } });
    const result = await client.callTool({ name: 'propose_finding', arguments: { ...FINDING, basedOn: HEAD } });
    expect(result.isError, text(result)).toBeFalsy();
    const asked = hub.asked[0]!;
    expect(asked).toMatchObject({ method: 'POST', path: '/api/v1/documents', query: { branch: 'agent-split-objective' } });
    expect(asked.headers).toMatchObject({ 'if-match': `"${HEAD}"`, 'armature-agent': 'agent:armature-mcp', 'armature-user': 'demo-designer@example.edu' });
    expect(asked.body).toEqual({
      message: FINDING.message,
      documents: [{ '@type': 'DesignFinding', label: FINDING.label, finding: FINDING.finding, subject: FINDING.subject, status: 'Open', regarding: FINDING.regarding, confidence: 'High' }],
    });
    expect(summary(result).split('\n')[0]).toBe(
      `Filed DesignFinding/abc on agent-split-objective in commit filed00000000000000000000000000, as agent:armature-mcp for demo-designer@example.edu: "${FINDING.label}".`
    );
    await close();
  });

  it('files a note with its rationale and category', async () => {
    const hub = batchHub(200, { commit: 'c', ids: ['DesignNote/n'] });
    const { client, close } = await connected(configFromEnv(WRITERS), hub.fetch);
    await client.callTool({
      name: 'propose_note',
      arguments: { branch: 'agent-x', subject: ['LearningObjective/o1'], label: 'Why Evaluate', rationale: 'The liaison asked.', category: 'BloomsLevelChoice', message: 'Record why' },
    });
    expect((hub.asked[0]!.body as { documents: unknown[] }).documents[0]).toEqual({ '@type': 'DesignNote', label: 'Why Evaluate', rationale: 'The liaison asked.', subject: ['LearningObjective/o1'], category: 'BloomsLevelChoice' });
    await close();
  });

  it('refuses main, and on a shared hub any branch but a proposal branch, before asking the hub', async () => {
    const hub = batchHub();
    const { client, close } = await connected(configFromEnv(WRITERS), hub.fetch, { discovered: { served: REMOTE } });
    const onMain = await client.callTool({ name: 'propose_finding', arguments: { ...FINDING, branch: 'main' } });
    expect(onMain.isError).toBe(true);
    expect(onMain.structuredContent).toMatchObject({ error: 'main_refused', refusedBy: 'armature-mcp' });
    const onReview = await client.callTool({ name: 'propose_note', arguments: { branch: 'demo-change', subject: ['LearningObjective/o1'], label: 'l', rationale: 'r', message: 'm' } });
    expect(onReview.structuredContent).toMatchObject({ error: 'not_a_proposal_branch' });
    expect(text(onReview)).toContain('start_proposal_branch');
    expect(hub.asked).toHaveLength(0);
    await close();
  });

  it('on a workspace hub files on the workspace, but never on main', async () => {
    const hub = batchHub();
    const { client, close } = await connected(configFromEnv(WRITERS), hub.fetch, { discovered: { served: WORKSPACE } });
    const result = await client.callTool({ name: 'propose_finding', arguments: { ...FINDING, branch: 'my-revision' } });
    expect(result.isError, text(result)).toBeFalsy();
    expect(hub.asked[0]!.query).toEqual({ branch: 'my-revision' });
    expect((await client.callTool({ name: 'propose_finding', arguments: { ...FINDING, branch: 'main' } })).isError).toBe(true);
    expect(hub.asked).toHaveLength(1);
    await close();
  });

  it('answers a moved branch (412) with what to do, and each rule a proposal breaks', async () => {
    const stale = batchHub(412, { error: 'precondition_failed', message: 'Branch agent-split-objective has moved since commit x', expected: 'x', current: 'y' });
    const a = await connected(configFromEnv(WRITERS), stale.fetch);
    const moved = await a.client.callTool({ name: 'propose_finding', arguments: { ...FINDING, basedOn: 'x' } });
    expect(moved.isError).toBe(true);
    expect(text(moved)).toContain('The hub refused (412 precondition_failed)');
    expect(text(moved)).toContain('file again with basedOn the new commit');
    expect(moved.structuredContent).toMatchObject({ current: 'y' });
    await a.close();

    const broken = batchHub(422, {
      error: 'invariant_violation',
      message: '1 invariant violation(s)',
      violations: [{ code: 'fragment_needs_one_subject', index: 0, field: 'fragmentId', message: 'A fragmentId needs exactly one subject' }],
    });
    const b = await connected(configFromEnv(WRITERS), broken.fetch);
    const refused = await b.client.callTool({ name: 'propose_finding', arguments: { ...FINDING, subject: ['A/1', 'B/2'], fragmentId: 'f' } });
    expect(text(refused)).toContain('nothing was written');
    expect(text(refused)).toContain('- fragment_needs_one_subject (fragmentId): A fragmentId needs exactly one subject');
    await b.close();
  });
});
