import { z } from "zod";

/**
 * SDLC order matters beyond display — the query layer sorts stage
 * breakdowns by this array's index, not alphabetically.
 */
export const STAGE_ORDER = ["Discovery", "Design", "Development", "Testing", "Deployment", "Maintenance"] as const;
export const StageSchema = z.enum(STAGE_ORDER);
export type Stage = z.infer<typeof StageSchema>;

export function stageIndex(stage: Stage): number {
  return STAGE_ORDER.indexOf(stage);
}

export const ProjectStatusSchema = z.enum(["active", "on_hold", "completed"]);

export const ProjectSchema = z.object({
  id: z.string().min(1),
  /** The redacted display name — also the join key Skylight boards match against. */
  pseudonym: z.string().min(1),
  status: ProjectStatusSchema,
  hourlyRateCents: z.number().int().nonnegative(),
  currency: z.literal("SGD"),
  startDate: z.string().date(),
  endDate: z.string().date().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const TimeEntrySourceSchema = z.enum(["manual", "commit"]);

export const TimeEntrySchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  stage: StageSchema,
  /** Calendar day the entry belongs to, resolved against SGT day boundaries at ingestion time. */
  date: z.string().date(),
  minutes: z.number().int().positive(),
  billable: z.boolean(),
  source: TimeEntrySourceSchema,
  note: z.string().optional(),
});
export type TimeEntry = z.infer<typeof TimeEntrySchema>;

export const AccountSchema = z.object({
  id: z.string().min(1),
  pseudonym: z.string().min(1),
  currency: z.literal("SGD"),
  openingBalanceCents: z.number().int(),
  openingDate: z.string().date(),
});
export type Account = z.infer<typeof AccountSchema>;

export const PaymentMethodSchema = z.object({
  id: z.string().min(1),
  pseudonym: z.string().min(1),
});
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const CategorySchema = z.object({
  id: z.string().min(1),
  /** Category names describe a kind of spend, not a real entity, so they aren't pseudonymized. */
  name: z.string().min(1),
});
export type Category = z.infer<typeof CategorySchema>;

export const VendorSchema = z.object({
  id: z.string().min(1),
  pseudonym: z.string().min(1),
});
export type Vendor = z.infer<typeof VendorSchema>;

export const ServiceSchema = z.object({
  id: z.string().min(1),
  pseudonym: z.string().min(1),
});
export type Service = z.infer<typeof ServiceSchema>;

export const TransactionTypeSchema = z.enum(["income", "expense"]);
export const TransactionStatusSchema = z.enum(["posted", "pending", "outstanding"]);

export const TransactionSchema = z.object({
  id: z.string().min(1),
  date: z.string().date(),
  type: TransactionTypeSchema,
  amountCents: z.number().int().positive(),
  currency: z.literal("SGD"),
  accountId: z.string().min(1),
  paymentMethodId: z.string().min(1),
  categoryId: z.string().min(1),
  vendorId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  status: TransactionStatusSchema,
  note: z.string().optional(),
});
export type Transaction = z.infer<typeof TransactionSchema>;

export const DeskDocumentSchema = z.object({
  id: z.string().min(1),
  /** Metadata only — the spec explicitly excludes document contents from the snapshot. */
  filename: z.string().min(1),
  projectId: z.string().min(1).optional(),
  transactionId: z.string().min(1).optional(),
  uploadedAt: z.string().datetime(),
});
export type DeskDocument = z.infer<typeof DeskDocumentSchema>;

export const DeskSnapshotSchema = z.object({
  projects: z.array(ProjectSchema),
  timeEntries: z.array(TimeEntrySchema),
  accounts: z.array(AccountSchema),
  paymentMethods: z.array(PaymentMethodSchema),
  categories: z.array(CategorySchema),
  vendors: z.array(VendorSchema),
  services: z.array(ServiceSchema),
  transactions: z.array(TransactionSchema),
  documents: z.array(DeskDocumentSchema),
});
export type DeskSnapshot = z.infer<typeof DeskSnapshotSchema>;
