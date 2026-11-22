/**
 * The tools against a real hub seeded with Armature's ICICLE demo seed
 * (scripts/seed_icicle_demo.js; `npm run demo:reset` and `demo:start` in
 * Armature), the hub the demonstration and CI's contract job run. Skipped
 * unless ARMATURE_HUB_URL names one. M1's acceptance: every tool returns the
 * seed's known answer with its commit, and a person filter is refused with the
 * hub's code.
 *
 * The last block makes beat 3's change on a branch of its own, which also
 * writes its owner's grant on main; the earlier blocks read main as the seed
 * left it, so run `npm run demo:reset` in Armature before running this again.
 */
import { createClient } from '@armature/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv } from '../src/config.js';
import { discoverHub, HUB_REVISION } from '../src/server.js';
import { ALL_TOOLS, connected, summary, text } from './helpers.js';

const hub = process.env.ARMATURE_HUB_URL;

type Result = Awaited<ReturnType<Awaited<ReturnType<typeof connected>>['client']['callTool']>>;
const data = <T>(result: Result) => result.structuredContent as T;

describe.skipIf(!hub)('against a hub with the ICICLE seed', () => {
  const config = () => configFromEnv({ ARMATURE_HUB_URL: hub, ARMATURE_USER: 'demo-designer@example.edu' });
  let call: (name: string, args?: Record<string, unknown>) => Promise<Result>;
  let tools: string[];
  let close: () => Promise<void>;
  let main: string;

  beforeAll(async () => {
    const discovered = await discoverHub(config());
    const c = await connected(config(), undefined, { discovered });
    tools = (await c.client.listTools()).tools.map((t) => t.name);
    call = async (name, args = {}) => {
      const result = await c.client.callTool({ name, arguments: args });
      expect(result.isError, text(result)).toBeFalsy();
      return result;
    };
    close = c.close;
    return () => close();
  });

  describe('orientation', () => {
    it('offers every read tool: the hub serves every capability they need', () => {
      expect(tools).toEqual(ALL_TOOLS);
    });

    it('describe_hub: a shared hub under header identity that serves the revision this server relies on', async () => {
      const result = await call('describe_hub');
      const d = data<{ role: string; versions: string[]; identity: { resolver: string } }>(result);
      expect(d.role).toBe('remote');
      expect(d.versions).toContain(HUB_REVISION);
      expect(d.identity.resolver).toBe('header');
      expect(summary(result)).toContain('a shared hub');
    });

    it("list_branches: main's latest commit is the reviewer's affirmation", async () => {
      const result = await call('list_branches');
      const branch = data<{ branches: Array<{ name: string; head: { commit: string; author: string; message: string } }> }>(result).branches.find((b) => b.name === 'main')!;
      expect(branch.head).toMatchObject({ author: 'User/demo-reviewer', message: "SME review: the .org item's key affirmed" });
      expect(summary(result).split('\n')[1]).toMatch(new RegExp(`^main: ${branch.head.commit} by User/demo-reviewer, [^:]+:\\d\\d UTC: SME review: the \\.org item's key affirmed$`));
      main = branch.head.commit;
    });

    it('describe_schema: the classes by category, and one class in full with what its fields mean', async () => {
      const all = await call('describe_schema');
      expect(summary(all)).toMatch(/^The schema on main at commit \w+: \d+ classes and \d+ enumerations\./);
      expect(summary(all)).toMatch(/relationship: .*PrerequisiteRecord/);
      const one = await call('describe_schema', { class: 'PrerequisiteRecord' });
      const fields = data<{ class: { category: string; fields: Array<{ name: string; documentation?: string; from?: string }> } }>(one).class;
      expect(fields.category).toBe('relationship');
      expect(fields.fields.map((f) => f.name)).toEqual(expect.arrayContaining(['objective', 'prerequisite', 'prerequisiteType', 'rationale']));
      expect(fields.fields.find((f) => f.name === 'createdBy')?.documentation).toBeTruthy();
      expect(fields.fields.find((f) => f.name === 'label')?.from).toBeTruthy();
      expect(data<{ commit: string }>(one).commit).toBe(main);
    });

    it('list_modules: the two modules in sequence', async () => {
      const result = await call('list_modules');
      expect(summary(result).split('\n')).toEqual([
        `2 modules on main at commit ${main}:`,
        'Module/checking-sources: Checking sources online (Course/first-year-info-lit, module 1)',
        'Module/tracing-claims: Tracing claims (Course/first-year-info-lit, module 2)',
      ]);
    });
  });

  describe('records', () => {
    it("get_record (beat 2): the note's rationale, which the trace carries only by label", async () => {
      const result = await call('get_record', { type: 'DesignNote', id: 'org-item-key-rationale' });
      expect(summary(result)).toContain(`DesignNote/org-item-key-rationale on main at commit ${main}: Why C is the key of the .org item`);
      expect(data<{ record: { rationale: string } }>(result).record.rationale).toContain('Fact-checkers leave a page');
    });

    it('find_records: the two items that assess the lateral-reading objective', async () => {
      const result = await call('find_records', { type: 'AssessmentItem', filter: { assesses: 'LearningObjective/lateral-reading-check' } });
      expect(data<{ records: Array<{ '@id': string }> }>(result).records.map((d) => d['@id']).sort()).toEqual(['AssessmentItem/healthy-living-post', 'AssessmentItem/org-site-first-step']);
    });

    it('find_records: a filter on a person is refused with the hub\'s code and why', async () => {
      const { client, close: done } = await connected(config());
      const result = await client.callTool({ name: 'find_records', arguments: { type: 'Attestation', filter: { attestedBy: 'User/demo-reviewer' } } });
      expect(result.isError).toBe(true);
      expect(data<{ error: string }>(result).error).toBe('person_filter_refused');
      expect(text(result)).toContain('ADR-0021');
      await done();
    });

    it('record_history and compare_record: the objective was written once, by the former designer, and is unchanged since', async () => {
      const history = await call('record_history', { type: 'LearningObjective', id: 'lateral-reading-check' });
      const entries = data<{ entries: Array<{ commit: string; author: string; message: string; diff?: unknown }> }>(history).entries;
      expect(entries.map((e) => [e.author, e.message])).toEqual([['User/former-designer', 'Module 1 designed: checking sources online']]);
      expect(entries[0]!.diff).toBeUndefined();
      const compared = await call('compare_record', { type: 'LearningObjective', id: 'lateral-reading-check', from: entries[0]!.commit, to: main });
      expect(summary(compared)).toBe(`LearningObjective/lateral-reading-check from ${entries[0]!.commit} to ${main}:\nNo change.`);
    });

    it('branch_changes: since Module 1, main gained Module 2 and the review', async () => {
      const history = await call('record_history', { type: 'LearningObjective', id: 'lateral-reading-check' });
      const since = data<{ entries: Array<{ commit: string }> }>(history).entries[0]!.commit;
      const result = await call('branch_changes', { branch: 'main', since });
      const changes = data<{ changes: Array<{ id: string; op: string }> }>(result).changes;
      expect(changes).toContainEqual({ id: 'Module/tracing-claims', op: 'insert' });
      expect(changes.every((c) => c.op === 'insert')).toBe(true);
      expect(summary(result)).toMatch(new RegExp(`^${changes.length} records changed on main from ${since} to ${main}: ${changes.length} inserted, 0 updated, 0 deleted\\.`));
    });
  });

  describe('design intelligence', () => {
    it('module_coverage: Module 1 FullyAssessed on all three objectives, Module 2 PartiallyAssessed', async () => {
      const m1 = await call('module_coverage', { moduleId: 'checking-sources' });
      expect(summary(m1).split('\n')[1]).toBe('Checking sources online (Module/checking-sources): 3 objectives declared. Coverage: 3 FullyAssessed. Projected: 3 FullyAssessed.');
      expect(data<{ commit: string }>(m1).commit).toBe(main);
      const m2 = await call('module_coverage', { moduleId: 'Module/tracing-claims' });
      expect(data<{ objectives: Array<{ coverage: { status: string } }> }>(m2).objectives.map((o) => o.coverage.status)).toEqual(['PartiallyAssessed']);
    });

    it('course_coverage: both modules of the course', async () => {
      const result = await call('course_coverage', { course: 'first-year-info-lit' });
      expect(data<{ modules: Array<{ module: { id: string } }> }>(result).modules.map((m) => m.module.id)).toEqual(['Module/checking-sources', 'Module/tracing-claims']);
    });

    it('alignment_gaps: none in Module 1 before the change', async () => {
      const result = await call('alignment_gaps', { module: 'checking-sources' });
      expect(summary(result).split('\n')[1]).toBe("0 items below its objective's level; 0 objectives no item reaches at its level; 0 objectives no activity targets; 0 items assessing no objective; 0 without a level.");
    });

    it("trace_record (beat 2): the .org item's trace carries its reason and the level note", async () => {
      const result = await call('trace_record', { type: 'AssessmentItem', id: 'org-site-first-step' });
      expect(summary(result)).toContain('—assesses→ Check a website with lateral reading');
      expect(summary(result)).toContain('DesignNote "Why C is the key of the .org item" (DesignNote/org-item-key-rationale)');
      expect(summary(result)).toContain('DesignNote "Apply, not Evaluate, on purpose"');
    });

    it('what_references (beat 3): six records reference the lateral-reading objective, the prerequisite from Module 2 among them', async () => {
      const result = await call('what_references', { type: 'LearningObjective', id: 'lateral-reading-check' });
      const refs = data<{ references: Array<{ type: string; field: string }> }>(result).references;
      expect(refs.map((x) => `${x.type}.${x.field}`).sort()).toEqual([
        'AssessmentItem.assesses',
        'AssessmentItem.assesses',
        'DesignNote.subject',
        'LearningActivity.targets',
        'ModuleObjective.references',
        'PrerequisiteRecord.prerequisite',
      ]);
      expect(summary(result).split('\n')[0]).toMatch(/^6 records reference Check a website with lateral reading/);
    });

    it("attestation_status (beat 2): the reviewer's affirmation is current", async () => {
      const result = await call('attestation_status', { type: 'AssessmentItem', id: 'org-site-first-step' });
      expect(summary(result).split('\n')[0]).toMatch(/^1 attestation on .*: 1 Current\.$/);
      expect(summary(result)).toMatch(/Affirmed .*by User\/demo-reviewer as of \w+: Current/);
    });

    it("module_content: Module 1's three activities in teaching order, one formative use", async () => {
      const result = await call('module_content', { moduleId: 'checking-sources' });
      expect(data<{ summary: { activities: number; formativeUses: number } }>(result).summary).toMatchObject({ activities: 3, formativeUses: 1 });
      expect(summary(result).split('\n')[1]).toMatch(/^ {2}1\. .*\(LearningActivity\/lateral-reading-practice\)/);
    });

    it('item_statistics: the seed records no metrics about its six items', async () => {
      const result = await call('item_statistics', { module: 'checking-sources' });
      expect(summary(result).split('\n')).toEqual([`0 metrics about 6 items of Checking sources online (Module/checking-sources) on main at commit ${main}; units: none.`, '  6 items without statistics.']);
    });

    it('every read at a commit answers from that commit', async () => {
      const result = await call('module_coverage', { moduleId: 'checking-sources', ref: main });
      expect(summary(result)).toContain(`Coverage on commit ${main};`);
      expect(data<{ commit: string }>(result).commit).toBe(main);
    });
  });

  describe('beat 3: after the objective is raised to Evaluate, on a branch', () => {
    const branch = `mcp-contract-${Date.now()}`;

    beforeAll(async () => {
      // The change is the presenter's, made outside the server, as demo:change makes it.
      const writer = createClient({ baseUrl: hub!, user: 'demo-designer@example.edu' });
      await writer.branches.create(branch, { branch: 'main' });
      const { data: o1 } = await writer.documents.get('LearningObjective', 'lateral-reading-check', { branch });
      await writer.documents.put('LearningObjective', 'lateral-reading-check', {
        branch,
        message: 'Raise the lateral-reading objective to Evaluate',
        document: { ...(o1 as unknown as Record<string, unknown>), label: "Evaluate a website's credibility", bloomsLevel: 'Evaluate' },
      });
    });

    it('alignment_gaps flags the two items two levels below the raised objective', async () => {
      const result = await call('alignment_gaps', { module: 'checking-sources', branch });
      const below = data<{ itemsBelowObjective: Array<{ item: { id: string }; levelsBelow: number }> }>(result).itemsBelowObjective;
      expect(below.map((x) => [x.item.id, x.levelsBelow]).sort()).toEqual([
        ['AssessmentItem/healthy-living-post', 2],
        ['AssessmentItem/org-site-first-step', 2],
      ]);
      expect(summary(result)).toContain("is 2 levels below Evaluate a website's credibility (LearningObjective/lateral-reading-check; Evaluate");
    });

    it('what_references still finds the prerequisite from Module 2, and get_record reads its assumption', async () => {
      const refs = await call('what_references', { type: 'LearningObjective', id: 'lateral-reading-check', branch });
      const prereq = data<{ references: Array<{ id: string; type: string }> }>(refs).references.find((x) => x.type === 'PrerequisiteRecord')!;
      const record = await call('get_record', { type: 'PrerequisiteRecord', id: prereq.id, branch });
      expect(data<{ record: { rationale: string } }>(record).record.rationale).toContain('two minutes per hop');
    });

    describe('beat 4: the assistant files the finding for the designer, on a proposal branch', () => {
      const writing = () => configFromEnv({ ARMATURE_HUB_URL: hub, ARMATURE_USER: 'demo-designer@example.edu', ARMATURE_AGENT: 'agent:armature-mcp', ARMATURE_WRITES: 'on' });
      let propose: (name: string, args: Record<string, unknown>) => Promise<Result>;
      let raw: Awaited<ReturnType<typeof connected>>['client'];
      let mainBefore: string;

      beforeAll(async () => {
        const c = await connected(writing(), undefined, { discovered: await discoverHub(writing()) });
        raw = c.client;
        propose = async (name, args) => {
          const result = await c.client.callTool({ name, arguments: args });
          expect(result.isError, text(result)).toBeFalsy();
          return result;
        };
        mainBefore = data<{ branches: Array<{ name: string; head: { commit: string } }> }>(await call('list_branches')).branches.find((b) => b.name === 'main')!.head.commit;
        return () => c.close();
      });

      it('opens a proposal branch, files the finding on the prerequisite, and the record says the agent did it for the designer', async () => {
        const topic = `split-objective-${Date.now()}`;
        const opened = await propose('start_proposal_branch', { topic, branch });
        const proposal = `agent-${topic}`;
        const { commit: basedOn } = data<{ commit: string }>(opened);

        const refs = await call('what_references', { type: 'LearningObjective', id: 'lateral-reading-check', branch: proposal });
        const prereq = data<{ references: Array<{ id: string; type: string }> }>(refs).references.find((x) => x.type === 'PrerequisiteRecord')!.id;
        const filed = await propose('propose_finding', {
          branch: proposal,
          subject: [prereq],
          regarding: 'LearningObjective/lateral-reading-check',
          label: 'Module 2 depends on the quick check this change removes',
          finding: 'Lateral reading is now an Evaluate objective, taught as slow, deliberate weighing. Module 2 tracing chains several quick checks at about two minutes per hop and does not reteach the check, so its prerequisite no longer holds. Consider splitting the objective.',
          confidence: 'High',
          message: 'The raised objective conflicts with the prerequisite Module 2 was built on',
          basedOn,
        });
        const { id } = data<{ id: string }>(filed);
        expect(summary(filed)).toContain('as agent:armature-mcp for demo-designer@example.edu');

        // The agent is the author and the creator; the hub, not the agent, named the person.
        const history = await call('record_history', { type: 'DesignFinding', id, branch: proposal });
        const [entry] = data<{ entries: Array<{ author: string; message: string }> }>(history).entries;
        expect(entry!.author).toBe('User/design-assistant');
        expect(entry!.message).toContain('Armature-On-Behalf-Of: demo-designer@example.edu');
        expect(summary(history)).toContain('by User/design-assistant for demo-designer@example.edu');
        const finding = await call('get_record', { type: 'DesignFinding', id, branch: proposal });
        expect(data<{ record: Record<string, unknown> }>(finding).record).toMatchObject({ createdBy: 'User/design-assistant', status: 'Open', asOf: basedOn });
        const onPrereq = await call('what_references', { type: 'PrerequisiteRecord', id: prereq, branch: proposal });
        expect(data<{ references: Array<{ id: string }> }>(onPrereq).references.map((x) => x.id)).toContain(id);

        // No design record on main changed: opening the branch wrote only its owner's grant there.
        const onMain = await call('branch_changes', { branch: 'main', since: mainBefore });
        expect(data<{ changes: Array<{ id: string }> }>(onMain).changes.every((x) => x.id.startsWith('Grant/'))).toBe(true);
        await expect(raw.callTool({ name: 'get_record', arguments: { type: 'DesignFinding', id } })).resolves.toMatchObject({ isError: true });

        // A write against a state the assistant has not seen is refused.
        const stale = await raw.callTool({ name: 'propose_note', arguments: { branch: proposal, subject: [prereq], label: 'l', rationale: 'r', message: 'm', basedOn } });
        expect(stale.isError).toBe(true);
        expect(data<{ error: string }>(stale).error).toBe('precondition_failed');
      });
    });
  });
});
