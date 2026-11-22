/**
 * The arguments the tools share (plan §4, "Arguments"): where to read (a
 * branch or a commit, never both, as the hub requires) and which record. Each
 * carries a description, since the model reads it to choose a value.
 */
import { CLASS_CATEGORY, SUBDOCUMENT_CLASSES, type ClassName } from '@armature/types';
import * as z from 'zod';
import type { AtRef } from '@armature/client';
import type { Config } from './config.js';

/**
 * Every class a record can be: the schema's classes, as the pinned
 * @armature/types has them, less the subdocuments (an item's parts, external
 * references, attachments), which are inside a record and have no address of
 * their own. A class added to Armature later reaches this list when the pin
 * moves.
 */
export const RECORD_CLASSES = Object.keys(CLASS_CATEGORY).filter(
  (name) => !(SUBDOCUMENT_CLASSES as readonly string[]).includes(name)
) as [ClassName, ...ClassName[]];

export const at = {
  branch: z
    .string()
    .optional()
    .describe('The branch to read at its latest commit. Leave out to read the default branch (main unless configured otherwise). Pass this or ref, not both.'),
  ref: z
    .string()
    .optional()
    .describe('A commit id to read at, as an earlier answer named it: pass the commit from your first answer to every follow-up, so the conversation reads one state of the design. Pass this or branch, not both.'),
};

export const record = {
  type: z.enum(RECORD_CLASSES).describe("The record's class, such as LearningObjective, AssessmentItem, Module or DesignNote."),
  id: z.string().describe("The record's id, as Type/local (LearningObjective/lateral-reading-check) or the local part alone."),
};

/**
 * The ref a read goes to: the commit when one is named, else the branch, else
 * the configured default. Both named are passed through, and the hub refuses
 * them (400 ambiguous_ref), which the model reads as any refusal.
 */
export function atOf(args: { branch?: string | undefined; ref?: string | undefined }, config: Config): AtRef {
  if (args.ref && args.branch) return { branch: args.branch, ref: args.ref };
  if (args.ref) return { ref: args.ref };
  return { branch: args.branch ?? config.branch };
}

/** How a read's place is said: "main at commit c" or "commit c". */
export function where(ref: AtRef, commit: string | undefined): string {
  if (ref.ref) return `commit ${ref.ref}`;
  return `${ref.branch ?? 'main'}${commit ? ` at commit ${commit}` : ''}`;
}
