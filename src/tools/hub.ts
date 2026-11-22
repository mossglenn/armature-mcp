/**
 * Orientation (plan §4.1): what the hub is and serves, the schema it holds,
 * its branches, and its modules, the usual way into a design.
 */
import * as z from 'zod';
import { answer, stamped } from '../answer.js';
import { at, atOf, RECORD_CLASSES, where } from '../args.js';
import type { Discovered, Registrar } from '../server.js';
import { firstLine, label, when } from './format.js';

export function registerHubTools(r: Registrar, discovered: Discovered | undefined): void {
  const { config } = r;

  r.read(
    null,
    'describe_hub',
    {
      title: 'Describe the hub',
      description:
        "What this Armature hub is: the instance's name, whether it is a shared hub or a person's workspace hub, the API revisions it serves, how it identifies callers, and its capabilities with their settings (coverage thresholds, export profiles); and how this server reads it. Ask this first in a conversation; the other tools' answers name the commit they read.",
      inputSchema: z.object({}),
    },
    async (_args, client) => {
      const result = await client.discover();
      const data = result.data;
      const name = data.instance?.name;
      const lines = [
        `${name ? `${name}: ` : ''}${data.role === 'workspace' ? "a person's workspace hub" : 'a shared hub'} at ${config.hubUrl}.`,
        `Newest API revision ${data.versions[0]}; ${data.versions.length} served.`,
        `Identifies callers by ${data.identity.resolver === 'header' ? 'a trusted header (loopback only)' : data.identity.resolver}.`,
        `${Object.keys(data.capabilities).length} capabilities: ${Object.keys(data.capabilities).sort().join(', ')}.`,
        `This server reads ${config.branch} unless a tool names another branch or a commit${config.user ? `, as ${config.user}` : ''}; writes are ${config.writes ? 'on' : 'off'}.`,
      ];
      if (discovered && 'unreachable' in discovered) lines.push('The hub could not be reached when this server started, so every tool is offered; restart the server to offer only those this hub serves.');
      const server = { branch: config.branch, writes: config.writes, ...(config.user ? { user: config.user } : {}), tools: r.names };
      return answer(lines.join('\n'), { ...data, server }, r);
    }
  );

  r.read(
    'armature/discover',
    'describe_schema',
    {
      title: 'Describe the schema',
      description:
        "The kinds of record the design holds and their fields, at a commit. Without a class: every class by category (artifacts such as objectives and items; relationships such as prerequisites and placements, which carry their own rationale; infrastructure) with its own field names. With a class: that class in full, each field's type and documentation, inherited fields included. Use it to learn what a field means before reading records, or which class to pass to find_records.",
      inputSchema: z.object({
        class: z.enum(RECORD_CLASSES).optional().describe('One class to describe in full. Leave out for the summary of every class.'),
        ...at,
      }),
    },
    async (args, client) => {
      const ref = atOf(args, config);
      const result = await client.schema(ref);
      const entries = result.data.schema as SchemaEntry[];
      const classes = entries.filter((e) => e['@type'] === 'Class');
      const enums = Object.fromEntries(entries.filter((e) => e['@type'] === 'Enum').map((e) => [e['@id'], (e['@value'] as string[]) ?? []]));
      const place = where(ref, result.commit);

      if (!args.class) {
        const compact = classes.map((c) => ({
          name: c['@id'],
          category: category(c),
          ...(c['@abstract'] ? { abstract: true } : {}),
          ...(inherits(c).length ? { inherits: inherits(c) } : {}),
          fields: ownFields(c).map(([field, type]) => `${field}: ${typeName(type)}`),
          comment: firstSentence(docs(c)['@comment']),
        }));
        const byCategory = new Map<string, string[]>();
        for (const c of compact) byCategory.set(c.category, [...(byCategory.get(c.category) ?? []), c.name]);
        const lines = [
          `The schema on ${place}: ${classes.length} classes and ${Object.keys(enums).length} enumerations.`,
          ...[...byCategory].map(([cat, names]) => `${cat}: ${names.join(', ')}`),
          'Pass class to see one in full, with what each field means.',
        ];
        return answer(lines.join('\n'), stamped(result, { classes: compact, enums }), { ...r, narrow: 'pass class to describe_schema for one class' });
      }

      const byName = new Map(classes.map((c) => [c['@id'], c]));
      const target = byName.get(args.class);
      if (!target) return answer(`The schema on ${place} has no class ${args.class}.`, stamped(result, { classes: classes.map((c) => c['@id']) }), r);
      const fields: Array<{ name: string; type: string; from?: string; documentation?: string }> = [];
      const seen = new Set<string>();
      for (const c of [target, ...ancestors(target, byName)]) {
        const fieldDocs = docs(c)['@properties'] ?? {};
        for (const [field, type] of ownFields(c)) {
          if (seen.has(field)) continue;
          seen.add(field);
          fields.push({ name: field, type: typeName(type), ...(c !== target ? { from: c['@id'] } : {}), ...(fieldDocs[field] ? { documentation: fieldDocs[field] } : {}) });
        }
      }
      const used = Object.fromEntries(Object.entries(enums).filter(([name]) => fields.some((f) => f.type.includes(name))));
      const lines = [
        `${args.class} on ${place}: ${category(target)}${target['@abstract'] ? ', abstract' : ''}${inherits(target).length ? `, a kind of ${inherits(target).join(' and ')}` : ''}.`,
        docs(target)['@comment'] ?? '',
        `Fields: ${fields.map((f) => `${f.name} (${f.type})`).join(', ')}.`,
        ...Object.entries(used).map(([name, values]) => `${name}: ${values.join(', ')}.`),
      ].filter(Boolean);
      const description = { name: args.class, category: category(target), abstract: Boolean(target['@abstract']), inherits: inherits(target), key: target['@key'], comment: docs(target)['@comment'], fields };
      return answer(lines.join('\n'), stamped(result, { class: description, enums: used }), r);
    }
  );

  r.read(
    'armature/branches',
    'list_branches',
    {
      title: 'List branches',
      description:
        "Every branch on the hub with its latest commit: the commit id, its author and its message, newest work first. main is the shared, agreed design; other branches are review rounds, people's workspaces or proposals. Pass a branch name or a commit id to the other tools to read there.",
      inputSchema: z.object({}),
    },
    async (_args, client) => {
      const result = await client.branches.list();
      const branches = [...result.data].sort((a, b) => (a.name === 'main' ? -1 : b.name === 'main' ? 1 : b.head.timestamp - a.head.timestamp));
      const lines = branches.map((b) => `${b.name}: ${b.head.commit} by ${b.head.author}, ${when(b.head.timestamp)}: ${firstLine(b.head.message)}`);
      return answer(`${branches.length} branch${branches.length === 1 ? '' : 'es'}:\n${lines.join('\n')}`, stamped(result, { branches }), r);
    }
  );

  r.read(
    'armature/documents',
    'list_modules',
    {
      title: 'List modules',
      description:
        "Every module in the design, by course and sequence, with its id: the usual way into a design. Pass a module's id to module_coverage, alignment_gaps or module_content.",
      inputSchema: z.object({ ...at }),
    },
    async (args, client) => {
      const ref = atOf(args, config);
      const result = await client.documents.list('Module', ref);
      const modules = [...(result.data as unknown as Array<Record<string, unknown>>)].sort(
        (a, b) => String(a.course ?? '').localeCompare(String(b.course ?? '')) || Number(a.sequence ?? 0) - Number(b.sequence ?? 0)
      );
      const lines = modules.map((m) => `${m['@id']}: ${label(m)}${m.course ? ` (${m.course}${m.sequence !== undefined ? `, module ${m.sequence}` : ''})` : ''}`);
      return answer(`${modules.length} module${modules.length === 1 ? '' : 's'} on ${where(ref, result.commit)}:\n${lines.join('\n')}`, stamped(result, { modules }), {
        ...r,
        narrow: 'use find_records on Module with a course filter',
      });
    }
  );
}

// ── The schema as the hub sends it (the store's own JSON) ────────────────────

type SchemaEntry = Record<string, unknown> & {
  '@id': string;
  '@type': string;
  '@abstract'?: unknown;
  '@inherits'?: string | string[];
  '@key'?: unknown;
  '@metadata'?: { armature?: { category?: string } };
  '@documentation'?: Documentation | Documentation[];
};

type Documentation = { '@language'?: string; '@comment'?: string; '@properties'?: Record<string, string> };

/** A class's documentation: the store sends one object, or one per language; English is preferred. */
const docs = (c: SchemaEntry): Documentation => {
  const d = c['@documentation'];
  if (!Array.isArray(d)) return d ?? {};
  return d.find((x) => x['@language'] === 'en') ?? d[0] ?? {};
};

const category = (c: SchemaEntry) => c['@metadata']?.armature?.category ?? 'uncategorized';
const inherits = (c: SchemaEntry): string[] => (c['@inherits'] === undefined ? [] : Array.isArray(c['@inherits']) ? c['@inherits'] : [c['@inherits']]);
const ownFields = (c: SchemaEntry) => Object.entries(c).filter(([key]) => !key.startsWith('@'));

function ancestors(c: SchemaEntry, byName: Map<string, SchemaEntry>): SchemaEntry[] {
  const out: SchemaEntry[] = [];
  const queue = [...inherits(c)];
  while (queue.length) {
    const next = byName.get(queue.shift()!);
    if (next && !out.includes(next)) {
      out.push(next);
      queue.push(...inherits(next));
    }
  }
  return out;
}

/** A field's type as one reads it: `xsd:string`, `Set<LearningObjective>`, `Optional<BloomsLevel>`. */
function typeName(type: unknown): string {
  if (typeof type === 'string') return type;
  if (type && typeof type === 'object') {
    const t = type as Record<string, unknown>;
    return `${String(t['@type'])}<${typeName(t['@class'])}>`;
  }
  return String(type);
}

function firstSentence(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = /^(.+?[.!?])(\s|$)/.exec(text);
  return match ? match[1] : text;
}
