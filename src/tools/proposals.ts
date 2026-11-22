/**
 * Proposals (plan §4.5, M4): an assistant opens a proposal branch and files
 * notes and findings on it, offered only when ARMATURE_WRITES is on. It
 * annotates; a person changes the design and decides what reaches main.
 *
 * Every write is the agent's, acting for the person: the client sends
 * Armature-User and Armature-Agent, the hub makes the agent the commit's author
 * and the record's createdBy and writes the person into an
 * Armature-On-Behalf-Of trailer itself (ADR-0067 decisions 3 and 6).
 *
 * The server's own rules come before the hub's, so a write the person did not
 * mean never reaches it: nothing on main; on a shared hub, only on a proposal
 * branch, agent-<topic>, which this server's naming makes; only notes and
 * findings, never objectives, items or activities; no merge, no deletion.
 */
import { VALID_ConfidenceLevel, VALID_DesignNoteCategory } from '@armature/types';
import type { CallToolResult } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { answer, refuse, stamped } from '../answer.js';
import type { Registrar } from '../server.js';

/** The prefix of every proposal branch this server opens (the hub's branch names allow no slash). */
export const PROPOSAL_PREFIX = 'agent-';

const branch = z.string().describe(`The proposal branch to file on: the one start_proposal_branch opened, ${PROPOSAL_PREFIX}<topic>. Never main.`);
const subject = z
  .array(z.string())
  .min(1)
  .describe('The records it is about, as Type/id: an objective, an item, or a relationship such as a PrerequisiteRecord when the concern is the link between two records.');
const fragmentId = z.string().optional().describe("One part of the subject it is about, by fragmentId (an item's option or stem); only with a single subject.");
const message = z
  .string()
  .min(1)
  .describe('The commit message, which the history shows: one line saying what is proposed and why, written for the person who will decide. The hub adds who it was for.');
const basedOn = z
  .string()
  .optional()
  .describe("The branch's latest commit as you last read it (start_proposal_branch's answer, or the last proposal's). The hub refuses the write if the branch has moved since, so nothing is filed against a state you have not seen.");

export function registerProposalTools(r: Registrar): void {
  const { config } = r;
  const who = `as ${config.agent} for ${config.user}`;

  /** The server's rules for where a proposal may go; a refusal, or undefined when the branch is allowed. */
  const refusedBranch = (name: string): CallToolResult | undefined => {
    if (name === 'main')
      return refuse('main_refused', 'This server never writes to main.', 'Open a proposal branch with start_proposal_branch and file there; a person merges it if they accept it.');
    if (r.role !== 'workspace' && !name.startsWith(PROPOSAL_PREFIX))
      return refuse(
        'not_a_proposal_branch',
        `On a shared hub this server files only on proposal branches, named ${PROPOSAL_PREFIX}<topic>; ${name} is not one.`,
        'Open one with start_proposal_branch, from the branch the conversation has been reading.'
      );
    return undefined;
  };

  // A workspace hub refuses POST /branches (remote_only): there the person's workspace is the proposal's place.
  if (r.role !== 'workspace') {
    r.write(
      'armature/branches',
      'start_proposal_branch',
      {
        title: 'Open a proposal branch',
        description: `Writes: creates a branch named ${PROPOSAL_PREFIX}<topic> from the branch or commit the conversation has been reading, as the agent acting for the person; no record changes, and the hub records who opened it. Use it before filing notes or findings, so they land beside the design they are about and never on main. Answers with the branch's latest commit, to pass as basedOn.`,
        inputSchema: z.object({
          topic: z
            .string()
            .regex(/^[a-z0-9][a-z0-9-]{0,59}$/)
            .describe(`What the proposal is about, in a few lower-case words joined by hyphens, such as split-objective; the branch is ${PROPOSAL_PREFIX}<topic>.`),
          branch: z.string().optional().describe('The branch to start from: the one the conversation has been reading, such as a branch holding a change under discussion. The default branch when left out.'),
          ref: z.string().optional().describe('A commit to start from instead of a branch.'),
        }),
      },
      async (args, client) => {
        const name = `${PROPOSAL_PREFIX}${args.topic}`;
        const from = args.ref ? { commit: args.ref } : { branch: args.branch ?? config.branch };
        await client.branches.create(name, from);
        const head = await client.branches.head(name);
        const commit = head.data.head.commit;
        const origin = 'commit' in from ? `commit ${from.commit}` : from.branch;
        const lines = [
          `Opened the proposal branch ${name} from ${origin}, ${who}; its latest commit is ${commit}.`,
          `File on it with propose_note or propose_finding, passing branch ${name} and basedOn ${commit}.`,
          'No design record changed; the hub recorded who opened the branch.',
        ];
        return answer(lines.join('\n'), { branch: name, from, commit, ...(head.version ? { revision: head.version } : {}) }, r);
      }
    );
  }

  r.write(
    'armature/documents',
    'propose_note',
    {
      title: 'File a design note',
      description:
        "Writes: adds one DesignNote on a proposal branch, as the agent acting for the person: a label, the rationale, and the records it is about. A note records a reason or an intent (why something is as it is, what a designer meant); for a concern that something is wrong, use propose_finding. Changes no existing record; main is untouched until a person merges the branch.",
      inputSchema: z.object({
        branch,
        subject,
        label: z.string().min(1).describe('A short title, as the Design Graph and the history list it.'),
        rationale: z.string().min(1).describe('The note itself: the reason or intent, in full sentences.'),
        category: z.enum(VALID_DesignNoteCategory).optional().describe('What kind of note it is, when one fits.'),
        fragmentId,
        message,
        basedOn,
      }),
    },
    async (args, client) => {
      const refused = refusedBranch(args.branch);
      if (refused) return refused;
      const document = {
        '@type': 'DesignNote',
        label: args.label,
        rationale: args.rationale,
        subject: args.subject,
        ...(args.category ? { category: args.category } : {}),
        ...(args.fragmentId ? { fragmentId: args.fragmentId } : {}),
      };
      return filed(client, args, document);
    }
  );

  r.write(
    'armature/documents',
    'propose_finding',
    {
      title: 'File a design finding',
      description:
        "Writes: adds one DesignFinding, status Open, on a proposal branch, as the agent acting for the person: a concern about the records in subject, grounded in what the reads showed, with how confident you are and what you would suggest. When the concern is the link between two records (a prerequisite, a placement), make that relationship the subject and name the record that changed in regarding. Changes no existing record; main is untouched until a person merges the branch, and a person marks the finding Addressed or Dismissed.",
      inputSchema: z.object({
        branch,
        subject,
        label: z.string().min(1).describe('The concern in one line, as the Design Graph and the history list it.'),
        finding: z.string().min(1).describe('The finding in full: what is wrong, the evidence from the reads, and what you would suggest.'),
        regarding: z.string().optional().describe('The record whose change raised the concern, as Type/id, when it is not the subject itself.'),
        confidence: z.enum(VALID_ConfidenceLevel).optional().describe('How sure the finding is, given the evidence.'),
        evidence: z.array(z.string()).optional().describe('LearningEvidence records that support it, as Type/id.'),
        fragmentId,
        message,
        basedOn,
      }),
    },
    async (args, client) => {
      const refused = refusedBranch(args.branch);
      if (refused) return refused;
      const document = {
        '@type': 'DesignFinding',
        label: args.label,
        finding: args.finding,
        subject: args.subject,
        status: 'Open',
        ...(args.regarding ? { regarding: args.regarding } : {}),
        ...(args.confidence ? { confidence: args.confidence } : {}),
        ...(args.evidence?.length ? { evidence: args.evidence } : {}),
        ...(args.fragmentId ? { fragmentId: args.fragmentId } : {}),
      };
      return filed(client, args, document);
    }
  );

  /** Writes one proposal in one commit, If-Match the commit the model read, and says what was filed, where and for whom. */
  async function filed(
    client: Parameters<Parameters<Registrar['write']>[3]>[1],
    args: { branch: string; message: string; basedOn?: string | undefined; label: string },
    document: Record<string, unknown> & { '@type': string }
  ): Promise<CallToolResult> {
    const result = await client.documents.batch({ branch: args.branch, message: args.message, documents: [document], ...(args.basedOn ? { ifMatch: args.basedOn } : {}) });
    const { commit, ids } = result.data;
    const lines = [
      `Filed ${ids[0]} on ${args.branch} in commit ${commit}, ${who}: "${args.label}".`,
      `main is unchanged; the proposal reaches it only if a person merges ${args.branch}. To file another here, pass basedOn ${commit}.`,
    ];
    return answer(lines.join('\n'), stamped(result, { id: ids[0], branch: args.branch, commit, document }), r);
  }
}
