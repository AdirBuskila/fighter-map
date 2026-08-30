import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BenefitChips, KindChip, StatusBadges } from "@/components/Badges";
import VerdictButtons from "@/components/VerdictButtons";
import { fetchPlace } from "@/lib/places";
import {
  externalUrl,
  formatDate,
  googleMapsUrl,
  isSingleSource,
  lastSignal,
  telHref,
  wazeUrl,
} from "@/lib/format";
import { CATEGORY_LABELS } from "@/lib/types";

export const revalidate = 120;

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const place = await fetchPlace((await params).id);
  if (!place) return { title: "מקום לא נמצא" };
  return {
    title: `${place.name_he} · מפת הטבות פייטר`,
    description: [
      place.name_he,
      place.city,
      place.benefit_fighter_card ? "כרטיס פייטר" : null,
      place.benefit_vacation_voucher ? "שובר חופשה" : null,
    ]
      .filter(Boolean)
      .join(", "),
  };
}

export default async function PlacePage({ params }: Params) {
  const place = await fetchPlace((await params).id);
  if (!place) notFound();

  const confirmed = formatDate(lastSignal(place));
  const hasPin = place.lat != null && place.lng != null;

  return (
    <article className="mx-auto w-full max-w-2xl flex-1 px-3 py-4">
      <Link
        href="/map"
        className="tap inline-flex items-center text-ink-soft"
        style={{ fontSize: "var(--text-sm)" }}
      >
        חזרה למפה
      </Link>

      <header className="mt-2">
        <h1
          className="font-extrabold"
          style={{ fontSize: "var(--text-2xl)", lineHeight: 1.15 }}
        >
          {place.name_he}
        </h1>
        {place.name_en && (
          <p className="text-ink-faint" style={{ fontSize: "var(--text-sm)" }} dir="ltr">
            {place.name_en}
          </p>
        )}
        <p className="mt-1 text-ink-soft" style={{ fontSize: "var(--text-base)" }}>
          {[CATEGORY_LABELS[place.category], place.city].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <BenefitChips place={place} />
          <KindChip place={place} />
          <StatusBadges place={place} />
        </div>
      </header>

      {place.status === "reported_not_working" && (
        <p
          role="status"
          className="mt-4 border-r-4 border-warn bg-warn-tint px-3 py-2"
          style={{ fontSize: "var(--text-sm)" }}
        >
          משתמשים דיווחו שההטבה הפסיקה לעבוד כאן. שווה לוודא בבית העסק לפני
          שנוסעים.
        </p>
      )}

      {/* The badge says דיווח אחד in two words; this says what to do about it.
          A single report is real information, just thin, and the fastest way
          to thicken it is the person reading this page right now. */}
      {isSingleSource(place) && place.status === "published" && (
        <p
          className="mt-4 border-r-4 border-line-strong px-3 py-2 text-ink-soft"
          style={{ fontSize: "var(--text-sm)" }}
        >
          אדם אחד דיווח שההטבה עבדה כאן, ואף אחד עוד לא אישר את זה. אם הייתם כאן,
          הדיווח שלכם יקבע.
        </p>
      )}

      {place.note_he && (
        <p className="mt-4" style={{ fontSize: "var(--text-base)" }}>
          {place.note_he}
        </p>
      )}

      <section className="mt-6 border-2 border-line-strong p-3">
        <VerdictButtons place={place} />
      </section>

      <dl className="mt-6 divide-y divide-line border-y border-line">
        {place.address_he && <Row term="כתובת">{place.address_he}</Row>}
        {confirmed && (
          <Row term={place.last_confirmed_at ? "אומת לאחרונה" : "דווח לראשונה"}>
            {confirmed}
          </Row>
        )}
        <Row term="דיווחים שההטבה עבדה">
          <span className="tabular-nums">{place.confirm_count}</span>
        </Row>
        {place.report_count > 0 && (
          <Row term="דיווחים שלא עבדה">
            <span className="tabular-nums">{place.report_count}</span>
          </Row>
        )}
      </dl>

      <nav className="mt-6 flex flex-wrap gap-2">
        {hasPin && (
          <a className="btn tap px-4" href={wazeUrl(place)} target="_blank" rel="noreferrer">
            ניווט בוויז
          </a>
        )}
        <a
          className="btn tap px-4"
          href={googleMapsUrl(place)}
          target="_blank"
          rel="noreferrer"
        >
          {hasPin ? "פתיחה בגוגל מפות" : "חיפוש בגוגל מפות"}
        </a>
        {place.phone && (
          <a className="btn tap px-4" href={telHref(place.phone)}>
            <span dir="ltr">{place.phone}</span>
          </a>
        )}
        {place.url && (
          <a
            className="btn tap px-4"
            href={externalUrl(place.url)}
            target="_blank"
            rel="noreferrer nofollow"
          >
            לאתר
          </a>
        )}
      </nav>

      {!hasPin && !place.is_chain && !place.is_online && (
        <p className="mt-6 text-ink-soft" style={{ fontSize: "var(--text-sm)" }}>
          את המקום הזה לא הצלחנו לסמן על המפה, אז הכפתור למעלה פותח חיפוש בגוגל
          מפות לפי השם והעיר. אם מצאתם אותו, אפשר להוסיף אותו עם קישור מגוגל
          מפות ולסמן אותו לכולם.
        </p>
      )}

      {place.is_chain && (
        <p className="mt-6 text-ink-soft" style={{ fontSize: "var(--text-sm)" }}>
          זו רשת ארצית, אז אין לה נקודה אחת על המפה. חזרו למפה ולחצו על סניפים
          קרובים אליי כדי לראות סניפים לידכם.
        </p>
      )}
    </article>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2.5">
      <dt
        className="w-40 shrink-0 text-ink-faint"
        style={{ fontSize: "var(--text-sm)" }}
      >
        {term}
      </dt>
      <dd style={{ fontSize: "var(--text-base)" }}>{children}</dd>
    </div>
  );
}
