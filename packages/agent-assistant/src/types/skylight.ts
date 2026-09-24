import { z } from "zod";

export const BoardSchema = z.object({
  id: z.string().min(1),
  /** Also the join key Desk projects match against. */
  pseudonym: z.string().min(1),
});
export type Board = z.infer<typeof BoardSchema>;

export const ColumnSchema = z.object({
  id: z.string().min(1),
  boardId: z.string().min(1),
  name: z.string().min(1),
  /**
   * "Completed" is defined as a move into a column literally named "Done"
   * (M0 open question #4, resolved that way — see the milestone doc).
   */
  isDoneColumn: z.boolean(),
  order: z.number().int().nonnegative(),
});
export type Column = z.infer<typeof ColumnSchema>;

export const CardSchema = z.object({
  id: z.string().min(1),
  boardId: z.string().min(1),
  columnId: z.string().min(1),
  title: z.string().min(1),
  dueDate: z.string().date().optional(),
  labels: z.array(z.string()),
  tags: z.array(z.string()),
  /** Soft-deleted cards stay out of current-state queries but remain in activity history. */
  deletedAt: z.string().datetime().optional(),
});
export type Card = z.infer<typeof CardSchema>;

export const ChecklistSchema = z.object({
  id: z.string().min(1),
  cardId: z.string().min(1),
  name: z.string().min(1),
});
export type Checklist = z.infer<typeof ChecklistSchema>;

export const ChecklistItemSchema = z.object({
  id: z.string().min(1),
  checklistId: z.string().min(1),
  text: z.string().min(1),
  done: z.boolean(),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const CommentSchema = z.object({
  id: z.string().min(1),
  cardId: z.string().min(1),
  author: z.string().min(1),
  text: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const NoteSchema = z.object({
  id: z.string().min(1),
  cardId: z.string().min(1),
  text: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type Note = z.infer<typeof NoteSchema>;

export const ActivityTypeSchema = z.enum(["created", "moved", "commented", "deleted"]);

export const ActivityLogEntrySchema = z.object({
  id: z.string().min(1),
  boardId: z.string().min(1),
  cardId: z.string().min(1),
  type: ActivityTypeSchema,
  fromColumnId: z.string().min(1).optional(),
  toColumnId: z.string().min(1).optional(),
  at: z.string().datetime(),
  actor: z.string().min(1),
});
export type ActivityLogEntry = z.infer<typeof ActivityLogEntrySchema>;

export const SkylightSnapshotSchema = z.object({
  boards: z.array(BoardSchema),
  columns: z.array(ColumnSchema),
  cards: z.array(CardSchema),
  checklists: z.array(ChecklistSchema),
  checklistItems: z.array(ChecklistItemSchema),
  comments: z.array(CommentSchema),
  notes: z.array(NoteSchema),
  activityLog: z.array(ActivityLogEntrySchema),
});
export type SkylightSnapshot = z.infer<typeof SkylightSnapshotSchema>;
