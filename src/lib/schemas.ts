import { z } from "zod";
import { CATEGORY_ORDER } from "./types";

const uuid = z.string().uuid("מזהה מקום לא תקין");

/** "עבד לי" / "לא עבד לי" on an existing place. */
export const reportInput = z.object({
  placeId: uuid,
  kind: z.enum(["confirm", "not_working"]),
  benefitType: z.enum(["fighter_card", "vacation_voucher"]).nullable().optional(),
  note: z.string().trim().max(200, "ההערה ארוכה מדי, עד 200 תווים").optional(),
  turnstileToken: z.string().optional(),
});
export type ReportInput = z.infer<typeof reportInput>;

/**
 * A new place from /add.
 *
 * providerRef is required and comes from picking a search result, never from
 * typing. That is what keeps the dataset joinable: two people submitting the
 * same shop land on the same row instead of creating a near-duplicate.
 */
export const submissionInput = z.object({
  providerRef: z.string().min(1, "צריך לבחור מקום מהרשימה"),
  nameHe: z.string().trim().min(1, "חסר שם המקום").max(160),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  addressHe: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  category: z.enum(CATEGORY_ORDER as [string, ...string[]]),
  benefitFighterCard: z.boolean(),
  benefitVacationVoucher: z.boolean(),
  note: z.string().trim().max(200, "ההערה ארוכה מדי, עד 200 תווים").optional(),
  turnstileToken: z.string().optional(),
})
  .refine((v) => v.benefitFighterCard || v.benefitVacationVoucher, {
    message: "צריך לסמן לפחות סוג הטבה אחד",
    path: ["benefitFighterCard"],
  });
export type SubmissionInput = z.infer<typeof submissionInput>;

/** Moderation actions from /admin. One endpoint, password on every call: there
 *  are no user accounts in this app and one operator does not need a session. */
export const adminActionInput = z.object({
  password: z.string().min(1),
  action: z.enum(["list", "approve", "reject", "restore", "edit"]),
  placeId: uuid.optional(),
  patch: z
    .object({
      nameHe: z.string().trim().min(1).max(160).optional(),
      city: z.string().trim().max(80).nullable().optional(),
      category: z.enum(CATEGORY_ORDER as [string, ...string[]]).optional(),
      noteHe: z.string().trim().max(200).nullable().optional(),
      benefitFighterCard: z.boolean().optional(),
      benefitVacationVoucher: z.boolean().optional(),
    })
    .optional(),
}).refine((v) => v.action === "list" || Boolean(v.placeId), {
  message: "חסר מזהה מקום",
  path: ["placeId"],
});
export type AdminActionInput = z.infer<typeof adminActionInput>;

/** Turns a Zod failure into one Hebrew sentence a person can act on. */
export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "משהו בטופס לא תקין";
}
