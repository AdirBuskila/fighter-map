import { z } from "zod";
import { CATEGORY_ORDER } from "./types";

const uuid = z.string().uuid("מזהה מקום לא תקין");

/**
 * The issuers of place identity, and the shapes they issue.
 *
 * This used to be any non-empty string, which was fine while OpenStreetMap was
 * the only issuer and the ref could only come from picking a search result.
 * With Google links accepted the field is caller-supplied in a second way, and
 * an unconstrained identity column is how one row gets claimed by a ref nobody
 * can trace back to anything.
 */
export const PROVIDER_REF =
  /^(?:osm:(?:node|way|relation)\/\d{1,20}|gmaps:(?:ftid\/0x[0-9a-f]{1,16}:0x[0-9a-f]{1,16}|cid\/\d{1,20}|place\/[\w-]{10,128}))$/;

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
 * providerRef comes from picking a search result or from a Google Maps link,
 * never from typing. Where the link carries no Google id, it is null, which is
 * the honest answer: minting gmaps:at/31.80,35.31 would write a false identity
 * that a later submission collides with. The column is nullable and merely
 * UNIQUE, and Postgres permits many nulls, so what keeps the dataset joinable
 * there is place_near_match() rather than the ref.
 */
export const submissionInput = z.object({
  providerRef: z.string().regex(PROVIDER_REF, "מזהה המקום לא תקין").nullable(),
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
  action: z.enum(["list", "approve", "reject", "restore", "edit", "locate"]),
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
  // Pinning a place the geocoders could not find. The moderator searches and
  // picks, so identity still comes from the provider and never from typing.
  location: z
    .object({
      providerRef: z.string().regex(PROVIDER_REF, "מזהה המקום לא תקין"),
      lat: z.number().gte(-90).lte(90),
      lng: z.number().gte(-180).lte(180),
      addressHe: z.string().trim().max(300).nullable().optional(),
      city: z.string().trim().max(80).nullable().optional(),
    })
    .optional(),
}).refine((v) => v.action === "list" || Boolean(v.placeId), {
  message: "חסר מזהה מקום",
  path: ["placeId"],
}).refine((v) => v.action !== "locate" || Boolean(v.location), {
  message: "צריך לבחור מקום מהחיפוש",
  path: ["location"],
});
export type AdminActionInput = z.infer<typeof adminActionInput>;

/** Turns a Zod failure into one Hebrew sentence a person can act on. */
export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "משהו בטופס לא תקין";
}
