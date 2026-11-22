/**
 * Design intelligence (plan §4.3): the hub's computed reads, each answering a
 * question a designer asks. The verdicts and counts are the hub's, computed at
 * the commit read (ADR-0056: nothing derived is stored); the summaries only
 * restate them.
 */
import type { CoverageReport, CoverageVerdict } from '@armature/client';
import * as z from 'zod';
import { answer, stamped } from '../answer.js';
import { at, atOf, record, where } from '../args.js';
import type { Registrar } from '../server.js';
import { clip, label, named, plural } from './format.js';

const moduleId = z.string().describe("The module's id, as Module/local or the local part alone; list_modules gives them.");

const thresholds = {
  fullyAssessedAt: z.number().int().min(1).optional().describe("Distinct eligible items at which an objective is FullyAssessed; the hub's setting (2 unless configured) when left out."),
  overAssessedAbove: z.number().int().min(1).optional().describe("Distinct eligible items above which an objective is OverAssessed; the hub's setting (4 unless configured) when left out."),
};

const VERDICTS: CoverageVerdict[] = ['Uncovered', 'PartiallyAssessed', 'FullyAssessed', 'OverAssessed'];
const tally = (counts: Record<string, number>) =>
  VERDICTS.filter((v) => counts[v]).map((v) => `${counts[v]} ${v}`).join(', ') || 'none';

/** One module's coverage as summary lines. */
function coverageLines(report: CoverageReport): string[] {
  const s = report.summary;
  const lines = [
    `${named(report.module)}: ${plural(s.declared, 'objective')} declared. Coverage: ${tally(s.coverage)}. Projected: ${tally(s.projected)}.`,
  ];
  for (const o of report.objectives) {
    const projected = o.projected.status !== o.coverage.status ? `; projected ${o.projected.status} (${plural(o.projected.items, 'item')})` : '';
    lines.push(`  ${named(o.objective)}: ${o.coverage.status} (${plural(o.coverage.items, 'item')})${projected}${o.role ? `, role ${o.role}` : ''}`);
  }
  for (const u of report.undeclared) lines.push(`  Assessed but not declared by the module: ${named(u.objective)} (${plural(u.assessedBy.length, 'item')})`);
  return lines;
}

export function registerIntelligenceTools(r: Registrar): void {
  const { config } = r;

  r.read(
    'armature/intelligence.coverage',
    'module_coverage',
    {
      title: "A module's coverage",
      description:
        "How well a module's assessment covers the objectives it declares: for each objective, a verdict (Uncovered, PartiallyAssessed, FullyAssessed, OverAssessed) from the number of distinct items assessing it in the module's own assessments. Coverage counts approved items in approved placements, what students meet; projected counts every item and placement not retired, what the module will deliver once drafts are cleared. Each declaration carries its role and the rationale for it. Computed at the commit read, never stored.",
      inputSchema: z.object({ moduleId, ...thresholds, ...at }),
    },
    async (args, client) => {
      const ref = atOf(args, config);
      const result = await client.intelligence.coverage(args.moduleId, {
        ...ref,
        ...(args.fullyAssessedAt ? { fullyAssessedAt: args.fullyAssessedAt } : {}),
        ...(args.overAssessedAbove ? { overAssessedAbove: args.overAssessedAbove } : {}),
      });
      const t = result.data.thresholds;
      const lines = [
        `Coverage on ${where(ref, result.commit)}; FullyAssessed at ${t.fullyAssessedAt} items, OverAssessed above ${t.overAssessedAbove}.`,
        ...coverageLines(result.data),
      ];
      return answer(lines.join('\n'), stamped(result), r);
    }
  );

  r.read(
    'armature/intelligence.coverage',
    'course_coverage',
    {
      title: "A course's coverage",
      description:
        "module_coverage for every module of a course, in sequence order, or for every module in the design when no course is named: the overview before looking at one module.",
      inputSchema: z.object({
        course: z.string().optional().describe("The course's id, as Course/local or the local part; every module in the design when left out."),
        ...thresholds,
        ...at,
      }),
    },
    async (args, client) => {
      const ref = atOf(args, config);
      const result = await client.intelligence.courseCoverage({
        ...ref,
        ...(args.course ? { course: args.course } : {}),
        ...(args.fullyAssessedAt ? { fullyAssessedAt: args.fullyAssessedAt } : {}),
        ...(args.overAssessedAbove ? { overAssessedAbove: args.overAssessedAbove } : {}),
      });
      const t = result.data.thresholds;
      const lines = [
        `Coverage of ${plural(result.data.modules.length, 'module')} on ${where(ref, result.commit)}; FullyAssessed at ${t.fullyAssessedAt} items, OverAssessed above ${t.overAssessedAbove}.`,
        ...result.data.modules.flatMap(coverageLines),
      ];
      return answer(lines.join('\n'), stamped(result), { ...r, narrow: 'call module_coverage for one module' });
    }
  );

  r.read(
    'armature/intelligence.alignment',
    'alignment_gaps',
    {
      title: 'Alignment gaps',
      description:
        "Where assessment and objectives disagree by Bloom's level, for one module's declared objectives or the whole design: items below the level of the objective they assess (and by how many levels), objectives no item reaches at their level, objectives no activity targets, items that assess no objective, and objectives or items with no level. Empty lists mean no gap of that kind. Run it after an objective's level changes to see what the change left behind.",
      inputSchema: z.object({
        module: z.string().optional().describe("A module's id, to check its declared objectives; the whole design when left out."),
        ...at,
      }),
    },
    async (args, client) => {
      const ref = atOf(args, config);
      const result = await client.intelligence.alignment({ ...ref, ...(args.module ? { module: args.module } : {}) });
      const a = result.data;
      const scope = (a.scope as { module?: unknown } | undefined)?.module;
      const lines = [
        `Alignment ${scope ? `of ${named(scope)} ` : 'of the whole design '}on ${where(ref, result.commit)}:`,
        `${plural(a.itemsBelowObjective.length, 'item')} below its objective's level; ${plural(a.objectivesWithoutItemAtLevel.length, 'objective')} no item reaches at its level; ${plural(a.objectivesWithoutActivity.length, 'objective')} no activity targets; ${plural(a.itemsWithoutObjective.length, 'item')} assessing no objective; ${a.unleveled.objectives.length + a.unleveled.items.length} without a level.`,
        ...a.itemsBelowObjective.map((x) => `  ${named(x.item)} is ${plural(x.levelsBelow, 'level')} below ${named(x.objective)}`),
        ...a.objectivesWithoutItemAtLevel.map((o) => `  No item reaches ${named(o)}`),
        ...a.objectivesWithoutActivity.map((o) => `  No activity targets ${named(o)}`),
        ...a.itemsWithoutObjective.map((i) => `  ${named(i)} assesses no objective`),
      ];
      return answer(lines.join('\n'), stamped(result), { ...r, narrow: 'pass module to check one module' });
    }
  );

  r.read(
    'armature/intelligence.trace',
    'trace_record',
    {
      title: 'Trace a record',
      description:
        "Where a record comes from and where it leads, both ways along the design's lifecycle: evidence and the need it supports, the objective the need generated, the items that assess it, their placements and assessments, and the datasets and metrics measured on them; with the notes and findings written on the records passed. Each link names the field it follows. The answer carries labels: read a note's or a relationship's rationale with get_record.",
      inputSchema: z.object({ ...record, ...at }),
    },
    async (args, client) => {
      const ref = atOf(args, config);
      const result = await client.intelligence.trace(args.type, args.id, ref);
      const t = result.data;
      const labels = new Map(t.nodes.map((n) => [n.id, n.label ?? n.id]));
      const annotations = t.annotations as Array<Record<string, unknown>>;
      const lines = [
        `Trace from ${named(t.root)} on ${where(ref, result.commit)}: ${plural(t.nodes.length, 'record')}, ${plural(t.edges.length, 'link')}, ${plural(annotations.length, 'note or finding', 'notes and findings')}.`,
        ...t.edges.map((e) => `  ${labels.get(e.from) ?? e.from} —${e.via}→ ${labels.get(e.to) ?? e.to}${e.through ? ` (through ${String(e.through)})` : ''}`),
        ...annotations.map((a) => `  ${String(a.type)} ${a.label ? `"${String(a.label)}" ` : ''}(${String(a.id)}) on ${[a.subject].flat().map((s) => labels.get(String(s)) ?? String(s)).join(', ')}`),
      ];
      return answer(lines.join('\n'), stamped(result), { ...r, narrow: 'trace a record further along, such as an objective rather than a whole module' });
    }
  );

  r.read(
    'armature/intelligence.impact',
    'what_references',
    {
      title: 'What references a record',
      description:
        "Every record that points at this one, and through which field: the items that assess an objective, the modules that declare it, the prerequisites that rely on it, the notes written on it. Ask it before changing a record, to see what the change would reach, including in other modules.",
      inputSchema: z.object({ ...record, ...at }),
    },
    async (args, client) => {
      const ref = atOf(args, config);
      const result = await client.intelligence.impact(args.type, args.id, ref);
      const i = result.data;
      const lines = [
        `${plural(i.summary.references, 'record')} reference ${named(i.document)} on ${where(ref, result.commit)}: ${Object.entries(i.summary.byType).map(([type, n]) => `${n} ${type}`).join(', ') || 'none'}.`,
        ...i.references.map((x) => `  ${x.type} ${x.label ? `"${x.label}" ` : ''}(${x.id}) through ${x.field}`),
      ];
      return answer(lines.join('\n'), stamped(result), r);
    }
  );

  r.read(
    'armature/intelligence.attestations',
    'attestation_status',
    {
      title: 'Attestation status',
      description:
        "Who affirmed or declined what about a record, as of which commit, and whether the record has changed since: Current (unchanged since the verdict), Stale (changed since), FragmentRemoved (the part it was about is gone), Unanchored (no commit to compare with). A stale affirmation is one a reviewer gave to an earlier version.",
      inputSchema: z.object({ ...record, ...at }),
    },
    async (args, client) => {
      const ref = atOf(args, config);
      const result = await client.intelligence.attestations(args.type, args.id, ref);
      const a = result.data;
      const states = Object.entries(a.summary.byState).filter(([, n]) => n).map(([state, n]) => `${n} ${state}`).join(', ');
      const lines = [
        `${plural(a.summary.attestations, 'attestation')} on ${named(a.subject)} on ${where(ref, result.commit)}${states ? `: ${states}` : ''}.`,
        ...a.attestations.map((x) => {
          const claim = x.claimText ? ` the claim "${clip(x.claimText, 80)}"` : '';
          const part = x.fragmentId ? ` (part ${String(x.fragmentId)})` : '';
          return `  ${String(x.verdict ?? '')}${claim}${part} by ${String(x.attestedBy ?? '')} as of ${String(x.asOf ?? '')}: ${x.state}`;
        }),
      ];
      return answer(lines.join('\n'), stamped(result), r);
    }
  );

  r.read(
    'armature/intelligence.module-content',
    'module_content',
    {
      title: "A module's content",
      description:
        'A module\'s activities and lessons in teaching order, each lesson with its activities in their own order, each activity with the objectives it targets and the items it uses formatively (for practice, not graded). Shows activities placed more than once.',
      inputSchema: z.object({ moduleId, ...at }),
    },
    async (args, client) => {
      const ref = atOf(args, config);
      const result = await client.intelligence.moduleContent(args.moduleId, ref);
      const m = result.data;
      const activity = (p: { sequence?: number; activity: { label?: string; id: string; targets: string[] }; items: unknown[] }, indent: string) =>
        `${indent}${p.sequence ?? '–'}. ${label(p.activity)} (${p.activity.id})${p.activity.targets.length ? `, targets ${p.activity.targets.join(', ')}` : ''}${p.items.length ? `, ${plural(p.items.length, 'practice item')}` : ''}`;
      const lines = [
        `${named(m.module)} on ${where(ref, result.commit)}: ${plural(m.summary.entries, 'entry', 'entries')}, ${plural(m.summary.lessons, 'lesson')}, ${plural(m.summary.activities, 'activity', 'activities')}, ${plural(m.summary.formativeUses, 'formative item use')}.`,
        ...m.content.flatMap((e) =>
          e.kind === 'activity' ? [activity(e, '  ')] : [`  ${e.sequence ?? '–'}. Lesson ${label(e.lesson)} (${e.lesson.id})`, ...e.members.map((p) => activity(p, '      '))]
        ),
        ...m.repeated.map((x) => `  Placed ${x.placements.length} times: ${label(x.activity)}`),
      ];
      return answer(lines.join('\n'), stamped(result), r);
    }
  );

  r.read(
    'armature/intelligence.item-statistics',
    'item_statistics',
    {
      title: 'Item statistics',
      description:
        "Every measurement recorded about each item (difficulty, discrimination, any metric a dataset supplied), newest administration first, with the dataset and cohort it came from; for one module's items or all. Nothing is averaged or summarized: each value is as recorded, with the commit it was measured against.",
      inputSchema: z.object({
        module: z.string().optional().describe("A module's id, for its items only; every item when left out."),
        unit: z.string().optional().describe('Keep only metrics in this unit; the answer lists the units present.'),
        ...at,
      }),
    },
    async (args, client) => {
      const ref = atOf(args, config);
      const result = await client.intelligence.itemStatistics({ ...ref, ...(args.module ? { module: args.module } : {}), ...(args.unit ? { unit: args.unit } : {}) });
      const s = result.data;
      const lines = [
        `${plural(s.scope.metrics, 'metric')} about ${plural(s.scope.items, 'item')}${s.scope.module ? ` of ${named(s.scope.module)}` : ''} on ${where(ref, result.commit)}; units: ${s.units.join(', ') || 'none'}.`,
        ...s.items.flatMap(({ item, statistics }) => [
          `  ${named(item)}:`,
          ...statistics.map((st) => `      ${label(st.metric)}: ${st.metric.value ?? ''}${st.metric.unit ? ` ${st.metric.unit}` : ''}${st.dataset ? ` from ${label(st.dataset)}${st.dataset.cohort ? `, ${st.dataset.cohort}` : ''}` : ''}${st.collectedAt ? `, ${st.collectedAt}` : ''}`),
        ]),
        ...(s.itemsWithoutStatistics.length ? [`  ${plural(s.itemsWithoutStatistics.length, 'item')} without statistics.`] : []),
      ];
      return answer(lines.join('\n'), stamped(result), { ...r, narrow: 'pass module, or unit' });
    }
  );
}
