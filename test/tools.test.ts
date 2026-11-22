/*
 * M1's tools through the protocol, against a fake hub: which tools discovery
 * offers, where each read goes, what its summary says, the size budget, and
 * refusals with what they mean.
 */
import { describe, expect, it } from 'vitest';
import { fit } from '../src/answer.js';
import { configFromEnv } from '../src/config.js';
import { ALL_TOOLS, connected, fakeHub, summary, text } from './helpers.js';

const config = (env: Record<string, string> = {}) => configFromEnv({ ARMATURE_USER: 'demo-designer@example.edu', ...env });
const HEAD = 'headcommit0000000000000000000000';

describe('the tool list follows discovery', () => {
  it('offers only the tools whose capability the hub serves, describe_hub always', async () => {
    const { client, close } = await connected(config(), fakeHub({}).fetch, { discovered: { served: ['armature/discover', 'armature/documents'] } });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['describe_hub', 'describe_schema', 'list_modules', 'get_record', 'find_records', 'record_history', 'compare_record']);
    await close();
  });

  it("declares each tool's capability to the hub, so a hub without it refuses rather than answering differently", async () => {
    const hub = fakeHub({ '/api/v1/intelligence/impact/LearningObjective/o1': { body: { document: { id: 'LearningObjective/o1', type: 'LearningObjective' }, summary: { references: 0, byType: {} }, references: [] } } });
    const { client, close } = await connected(config(), hub.fetch, { discovered: { served: ALL_SERVED } });
    await client.callTool({ name: 'what_references', arguments: { type: 'LearningObjective', id: 'o1' } });
    expect(hub.asked[0]!.headers['armature-capabilities']).toBe('armature/intelligence.impact');
    await close();
  });

  it('offers every tool and says so when the hub could not be asked at start', async () => {
    const hub = fakeHub({ '/api/v1/discover': { body: { role: 'remote', versions: ['2026-11-20'], identity: { resolver: 'header', headers: {} }, capabilities: {}, schema: { route: '/api/v1/schema' } } } });
    const { client, close } = await connected(config(), hub.fetch, { discovered: { unreachable: 'fetch failed' } });
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(ALL_TOOLS);
    const result = await client.callTool({ name: 'describe_hub', arguments: {} });
    expect(summary(result)).toContain('could not be reached when this server started, so every tool is offered');
    expect((result.structuredContent as { server: { tools: string[] } }).server.tools).toEqual(ALL_TOOLS);
    await close();
  });
});

const ALL_SERVED = [
  'armature/discover', 'armature/documents', 'armature/branches',
  'armature/intelligence.coverage', 'armature/intelligence.alignment', 'armature/intelligence.trace', 'armature/intelligence.impact',
  'armature/intelligence.attestations', 'armature/intelligence.item-statistics', 'armature/intelligence.module-content',
];

describe('where a read goes, and the commit it names', () => {
  const doc = { '@id': 'LearningObjective/o1', '@type': 'LearningObjective', label: 'Check a website', bloomsLevel: 'Apply', generatedBy: 'LearningNeed/n1', createdBy: 'User/former-designer' };

  it('reads the configured branch when a tool names none, and names the commit in the summary and the structured content', async () => {
    const hub = fakeHub({ '/api/v1/documents/LearningObjective/o1': { body: doc, commit: HEAD } });
    const { client, close } = await connected(config({ ARMATURE_BRANCH: 'review' }), hub.fetch);
    const result = await client.callTool({ name: 'get_record', arguments: { type: 'LearningObjective', id: 'LearningObjective/o1' } });
    expect(hub.asked[0]!.query).toEqual({ branch: 'review' });
    expect(summary(result).split('\n')[0]).toBe(`LearningObjective/o1 on review at commit ${HEAD}: Check a website`);
    expect(summary(result)).toContain('bloomsLevel: Apply');
    expect(result.structuredContent).toMatchObject({ record: doc, commit: HEAD, revision: '2026-11-20' });
    await close();
  });

  it('reads a commit when one is named, and passes both to the hub when both are, which refuses them', async () => {
    const hub = fakeHub({ '/api/v1/documents/LearningObjective/o1': { body: doc, commit: HEAD } });
    const { client, close } = await connected(config(), hub.fetch);
    const atCommit = await client.callTool({ name: 'get_record', arguments: { type: 'LearningObjective', id: 'o1', ref: HEAD } });
    expect(hub.asked[0]!.query).toEqual({ ref: HEAD });
    expect(summary(atCommit)).toContain(`on commit ${HEAD}:`);
    await client.callTool({ name: 'get_record', arguments: { type: 'LearningObjective', id: 'o1', ref: HEAD, branch: 'main' } });
    expect(hub.asked[1]!.query).toEqual({ branch: 'main', ref: HEAD });
    await close();
  });

  it('refuses a class the schema does not have before asking the hub', async () => {
    const hub = fakeHub({});
    const { client, close } = await connected(config(), hub.fetch);
    const result = await client.callTool({ name: 'get_record', arguments: { type: 'TextFragment', id: 'x' } });
    expect(result.isError).toBe(true);
    expect(hub.asked).toHaveLength(0);
    await close();
  });
});

describe('records', () => {
  it('find_records sends the filter and a page, and says how to get the next', async () => {
    const records = [{ '@id': 'AssessmentItem/a', label: 'A' }, { '@id': 'AssessmentItem/b', label: 'B' }];
    const hub = fakeHub({ '/api/v1/documents/AssessmentItem': { body: records } });
    const { client, close } = await connected(config(), hub.fetch);
    const result = await client.callTool({ name: 'find_records', arguments: { type: 'AssessmentItem', filter: { assesses: 'LearningObjective/o1' }, count: 2 } });
    expect(hub.asked[0]!.query).toEqual({ branch: 'main', assesses: 'LearningObjective/o1', count: '2', skip: '0' });
    expect(summary(result)).toBe(
      '2 AssessmentItem records where assesses = LearningObjective/o1 on main at commit commit0000000000000000000000000:\nAssessmentItem/a: A\nAssessmentItem/b: B\nThere may be more: pass skip 2 for the next page.'
    );
    await close();
  });

  it("answers a filter on a person with the hub's refusal and why Armature refuses it", async () => {
    const hub = fakeHub({
      '/api/v1/documents/Attestation': { status: 400, body: { error: 'person_filter_refused', message: 'attestedBy names a person; the API does not list documents by who made them (ADR-0021)' } },
    });
    const { client, close } = await connected(config(), hub.fetch);
    const result = await client.callTool({ name: 'find_records', arguments: { type: 'Attestation', filter: { attestedBy: 'User/demo-reviewer' } } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('The hub refused (400 person_filter_refused)');
    expect(text(result)).toContain("never turned into a measure of individuals' work");
    expect(result.structuredContent).toMatchObject({ error: 'person_filter_refused', status: 400 });
    await close();
  });

  it('record_history leaves the diff off unless asked, and names the person an assistant acted for', async () => {
    const entries = [
      { commit: 'c2', author: 'User/design-assistant', message: 'File a finding\n\nArmature-On-Behalf-Of: demo-designer@example.edu', timestamp: 1_790_000_200 },
      { commit: 'c1', author: 'User/former-designer', message: 'Module 1 designed', timestamp: 1_790_000_100 },
    ];
    const hub = fakeHub({ '/api/v1/documents/LearningObjective/o1/history': { body: { id: 'LearningObjective/o1', branch: 'main', start: 0, count: 20, entries } } });
    const { client, close } = await connected(config(), hub.fetch);
    const result = await client.callTool({ name: 'record_history', arguments: { type: 'LearningObjective', id: 'o1' } });
    expect(hub.asked[0]!.query).toEqual({ branch: 'main', diff: 'false' });
    const lines = summary(result).split('\n');
    expect(lines[0]).toBe('2 commits on main touched LearningObjective/o1, newest first:');
    expect(lines[1]).toMatch(/^c2 by User\/design-assistant for demo-designer@example.edu, .*: File a finding$/);
    await close();
  });

  it("compare_record says each changed field's value before and after", async () => {
    const diff = { '@id': 'LearningObjective/o1', bloomsLevel: { '@op': 'SwapValue', '@before': 'Apply', '@after': 'Evaluate' }, description: { '@op': 'Insert', '@insert': 'x' } };
    const hub = fakeHub({ '/api/v1/documents/LearningObjective/o1/diff': { body: { id: 'LearningObjective/o1', from: 'c1', to: 'c2', diff } } });
    const { client, close } = await connected(config(), hub.fetch);
    const result = await client.callTool({ name: 'compare_record', arguments: { type: 'LearningObjective', id: 'o1', from: 'c1', to: 'c2' } });
    expect(summary(result)).toBe('LearningObjective/o1 from c1 to c2:\nbloomsLevel: "Apply" → "Evaluate"\ndescription: added');
    await close();
  });
});

describe('design intelligence', () => {
  const objective = (id: string, label: string, bloomsLevel: string) => ({ id, type: 'LearningObjective', label, bloomsLevel });

  it('module_coverage states the thresholds, the tallies and each objective with its verdict', async () => {
    const report = {
      module: { id: 'Module/m2', type: 'Module', label: 'Tracing claims' },
      thresholds: { fullyAssessedAt: 2, overAssessedAbove: 4 },
      summary: { declared: 1, coverage: { Uncovered: 0, PartiallyAssessed: 1, FullyAssessed: 0, OverAssessed: 0 }, projected: { Uncovered: 0, PartiallyAssessed: 0, FullyAssessed: 1, OverAssessed: 0 }, undeclared: 0 },
      objectives: [{ id: 'ModuleObjective/x', role: 'Primary', objective: objective('LearningObjective/o4', 'Trace a viral claim', 'Analyze'), coverage: { status: 'PartiallyAssessed', items: 1 }, projected: { status: 'FullyAssessed', items: 2 }, assessedBy: [] }],
      undeclared: [],
    };
    const hub = fakeHub({ '/api/v1/intelligence/coverage/m2': { body: report } });
    const { client, close } = await connected(config(), hub.fetch);
    const result = await client.callTool({ name: 'module_coverage', arguments: { moduleId: 'Module/m2', fullyAssessedAt: 2 } });
    expect(hub.asked[0]!.query).toEqual({ branch: 'main', fullyAssessedAt: '2' });
    expect(summary(result).split('\n')).toEqual([
      'Coverage on main at commit commit0000000000000000000000000; FullyAssessed at 2 items, OverAssessed above 4.',
      'Tracing claims (Module/m2): 1 objective declared. Coverage: 1 PartiallyAssessed. Projected: 1 FullyAssessed.',
      '  Trace a viral claim (LearningObjective/o4; Analyze): PartiallyAssessed (1 item); projected FullyAssessed (2 items), role Primary',
    ]);
    await close();
  });

  it('alignment_gaps counts every kind of gap and lists each item below its objective', async () => {
    const body = {
      scope: { module: { id: 'Module/m1', type: 'Module', label: 'Checking sources' } },
      itemsBelowObjective: [{ item: { id: 'AssessmentItem/a', label: 'The .org item', bloomsLevel: 'Apply' }, objective: objective('LearningObjective/o1', 'Check a website', 'Evaluate'), levelsBelow: 2 }],
      objectivesWithoutItemAtLevel: [objective('LearningObjective/o1', 'Check a website', 'Evaluate')],
      objectivesWithoutActivity: [],
      itemsWithoutObjective: [],
      unleveled: { objectives: [], items: [] },
    };
    const hub = fakeHub({ '/api/v1/intelligence/alignment': { body } });
    const { client, close } = await connected(config(), hub.fetch);
    const result = await client.callTool({ name: 'alignment_gaps', arguments: { module: 'checking-sources', branch: 'demo-change' } });
    expect(hub.asked[0]!.query).toEqual({ branch: 'demo-change', module: 'checking-sources' });
    const lines = summary(result).split('\n');
    expect(lines[1]).toBe("1 item below its objective's level; 1 objective no item reaches at its level; 0 objectives no activity targets; 0 items assessing no objective; 0 without a level.");
    expect(lines[2]).toBe('  The .org item (AssessmentItem/a; Apply) is 2 levels below Check a website (LearningObjective/o1; Evaluate)');
    await close();
  });

  it('trace_record writes each link with labels and each note with what it is on', async () => {
    const body = {
      root: { id: 'AssessmentItem/a', type: 'AssessmentItem', label: 'The .org item' },
      nodes: [{ id: 'AssessmentItem/a', type: 'AssessmentItem', label: 'The .org item' }, objective('LearningObjective/o1', 'Check a website', 'Apply')],
      edges: [{ from: 'AssessmentItem/a', to: 'LearningObjective/o1', via: 'assesses' }],
      annotations: [{ id: 'DesignNote/n', type: 'DesignNote', label: 'Why C is the key', subject: ['AssessmentItem/a'] }],
    };
    const hub = fakeHub({ '/api/v1/intelligence/trace/AssessmentItem/a': { body } });
    const { client, close } = await connected(config(), hub.fetch);
    const lines = summary(await client.callTool({ name: 'trace_record', arguments: { type: 'AssessmentItem', id: 'a' } })).split('\n');
    expect(lines.slice(1)).toEqual(['  The .org item —assesses→ Check a website', '  DesignNote "Why C is the key" (DesignNote/n) on The .org item']);
    await close();
  });
});

describe('the size budget', () => {
  it('cuts the largest list to fit, says how much is shown, and how to see the rest', async () => {
    const records = Array.from({ length: 200 }, (_, i) => ({ '@id': `AssessmentItem/item-${i}`, label: `Item ${i}`, stem: 'x'.repeat(100) }));
    const hub = fakeHub({ '/api/v1/documents/AssessmentItem': { body: records } });
    const { client, close } = await connected(config(), hub.fetch, { budget: 5_000 });
    const result = await client.callTool({ name: 'find_records', arguments: { type: 'AssessmentItem', count: 200 } });
    const data = result.structuredContent as { records: unknown[]; truncated: Array<{ path: string; shown: number; total: number }>; commit: string };
    expect(JSON.stringify(data).length).toBeLessThanOrEqual(5_000);
    expect(data.truncated).toEqual([{ path: 'records', shown: data.records.length, total: 200 }]);
    expect(data.commit).toBeTruthy();
    expect(summary(result)).toContain(`Cut to fit: ${data.records.length} of 200 entries of records are shown.\nTo see the rest, pass a smaller count, or a filter.`);
    await close();
  });

  it('cuts nested lists, keeps entries from the start, and leaves an answer within budget alone', () => {
    const data = { report: { nodes: Array.from({ length: 50 }, (_, i) => ({ id: i, pad: 'y'.repeat(50) })) }, small: [1, 2] };
    const { data: out, truncated } = fit(data, 1_000);
    expect(truncated[0]).toMatchObject({ path: 'report.nodes', total: 50 });
    expect((out.report as { nodes: Array<{ id: number }> }).nodes[0]!.id).toBe(0);
    expect(fit({ a: [1] }, 1_000)).toEqual({ data: { a: [1] }, truncated: [] });
  });
});
