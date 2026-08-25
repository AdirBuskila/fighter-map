"use client";

import { useCallback, useState } from "react";
import { CATEGORY_LABELS, CATEGORY_ORDER, type Category } from "@/lib/types";

type QueueRow = {
  id: string;
  provider_ref: string | null;
  name_he: string;
  name_en: string | null;
  category: Category;
  is_chain: boolean;
  is_online: boolean;
  address_he: string | null;
  city: string | null;
  note_he: string | null;
  status: string;
  source: string;
  review_reason: string | null;
  confirm_count: number;
  report_count: number;
  created_at: string;
};

type Queues = { pending: QueueRow[]; flagged: QueueRow[]; revived: QueueRow[] };

const REASON_LABELS: Record<string, string> = {
  low_match_confidence: "ההתאמה שנמצאה לא בטוחה מספיק",
  no_osm_match: "לא נמצאה התאמה במפה",
  not_located: "עוד לא נבדק מול המפה",
  low_confidence: "השם מהקובץ לא ברור מספיק",
  unclear: "לא ברור איזה עסק זה",
};

export default function AdminPanel() {
  const [password, setPassword] = useState("");
  const [queues, setQueues] = useState<Queues | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const call = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, password }),
      });
      const parsed = (await res.json()) as Record<string, unknown> & { error?: string };
      if (!res.ok) throw new Error(parsed.error ?? "הפעולה נכשלה");
      return parsed;
    },
    [password],
  );

  async function load(event?: React.FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const data = (await call({ action: "list" })) as unknown as Queues;
      setQueues(data);
    } catch (cause) {
      setQueues(null);
      setError(cause instanceof Error ? cause.message : "הטעינה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function act(
    placeId: string,
    action: "approve" | "reject" | "restore" | "edit",
    patch?: Record<string, unknown>,
  ) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await call({ action, placeId, patch });
      setMessage(
        action === "approve"
          ? "המקום פורסם"
          : action === "reject"
            ? "המקום נדחה"
            : action === "restore"
              ? "המקום הוחזר למפה"
              : "השינוי נשמר",
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "הפעולה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  if (!queues) {
    return (
      <form onSubmit={load} className="mt-6 max-w-sm">
        <label
          htmlFor="admin-password"
          className="mb-1 block font-bold"
          style={{ fontSize: "var(--text-base)" }}
        >
          סיסמת ניהול
        </label>
        <input
          id="admin-password"
          type="password"
          className="field"
          value={password}
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && (
          <p role="alert" className="mt-2 text-warn" style={{ fontSize: "var(--text-sm)" }}>
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary mt-4 w-full" disabled={busy}>
          {busy ? "בודק" : "כניסה"}
        </button>
      </form>
    );
  }

  return (
    <div className="mt-6">
      {message && (
        <p role="status" className="mb-3 text-ok" style={{ fontSize: "var(--text-sm)" }}>
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mb-3 text-warn" style={{ fontSize: "var(--text-sm)" }}>
          {error}
        </p>
      )}

      <Section
        title="ממתינים לאישור"
        hint="הגשות משתמשים, ושורות מהקובץ שלא נמצאה להן התאמה במפה."
        rows={queues.pending}
        empty="אין כלום בתור. אפשר לסגור את הדף."
        busy={busy}
        onAct={act}
        actions={["approve", "reject", "edit"]}
      />

      <Section
        title="דווחו כלא עובדים, אבל ממשיכים לקבל אישורים"
        hint="שווה לבדוק. המערכת לא מחזירה מקום למפה לבד."
        rows={queues.revived}
        empty="אין סתירות כרגע."
        busy={busy}
        onAct={act}
        actions={["restore", "reject"]}
      />

      <Section
        title="דווחו כלא עובדים"
        hint="מוצגים במפה באפור עם תווית אזהרה."
        rows={queues.flagged}
        empty="אף מקום לא סומן כלא עובד."
        busy={busy}
        onAct={act}
        actions={["restore", "reject"]}
      />

      <button type="button" className="btn mt-6" onClick={() => void load()} disabled={busy}>
        רענון התור
      </button>
    </div>
  );
}

function Section({
  title,
  hint,
  rows,
  empty,
  busy,
  actions,
  onAct,
}: {
  title: string;
  hint: string;
  rows: QueueRow[];
  empty: string;
  busy: boolean;
  actions: Array<"approve" | "reject" | "restore" | "edit">;
  onAct: (
    id: string,
    action: "approve" | "reject" | "restore" | "edit",
    patch?: Record<string, unknown>,
  ) => void;
}) {
  return (
    <section className="mt-8">
      <h2 className="font-extrabold" style={{ fontSize: "var(--text-xl)" }}>
        {title}{" "}
        <span className="tabular-nums text-ink-faint">{rows.length}</span>
      </h2>
      <p className="mt-1 text-ink-soft" style={{ fontSize: "var(--text-sm)" }}>
        {hint}
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-ink-faint" style={{ fontSize: "var(--text-sm)" }}>
          {empty}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {rows.map((row) => (
            <QueueItem
              key={row.id}
              row={row}
              busy={busy}
              actions={actions}
              onAct={onAct}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function QueueItem({
  row,
  busy,
  actions,
  onAct,
}: {
  row: QueueRow;
  busy: boolean;
  actions: Array<"approve" | "reject" | "restore" | "edit">;
  onAct: (
    id: string,
    action: "approve" | "reject" | "restore" | "edit",
    patch?: Record<string, unknown>,
  ) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.name_he);
  const [city, setCity] = useState(row.city ?? "");
  const [category, setCategory] = useState<Category>(row.category);

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-extrabold" style={{ fontSize: "var(--text-lg)" }}>
          {row.name_he}
        </h3>
        <span className="chip">{CATEGORY_LABELS[row.category]}</span>
        {row.review_reason && (
          <span className="chip chip-warn">
            {REASON_LABELS[row.review_reason] ?? row.review_reason}
          </span>
        )}
        {row.source === "user_submission" && <span className="chip">הגשת משתמש</span>}
      </div>
      <p className="mt-0.5 text-ink-soft" style={{ fontSize: "var(--text-sm)" }}>
        {[row.city, row.address_he].filter(Boolean).join(" · ") || "בלי כתובת"}
      </p>
      <p className="text-ink-faint tabular-nums" style={{ fontSize: "var(--text-2xs)" }}>
        אישורים {row.confirm_count} · דיווחי כשל {row.report_count}
        {row.provider_ref ? " · מזוהה במפה" : " · בלי מזהה מפה"}
      </p>
      {row.note_he && (
        <p className="mt-1 text-ink-soft" style={{ fontSize: "var(--text-sm)" }}>
          {row.note_he}
        </p>
      )}

      {editing && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <input
            className="field"
            value={name}
            aria-label="שם"
            onChange={(event) => setName(event.target.value)}
          />
          <input
            className="field"
            value={city}
            aria-label="עיר"
            placeholder="עיר"
            onChange={(event) => setCity(event.target.value)}
          />
          <select
            className="field"
            value={category}
            aria-label="קטגוריה"
            onChange={(event) => setCategory(event.target.value as Category)}
          >
            {CATEGORY_ORDER.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {actions.includes("approve") && (
          <button
            type="button"
            className="btn btn-primary px-3"
            style={{ fontSize: "var(--text-sm)" }}
            disabled={busy}
            onClick={() => onAct(row.id, "approve")}
          >
            פרסום
          </button>
        )}
        {actions.includes("restore") && (
          <button
            type="button"
            className="btn btn-primary px-3"
            style={{ fontSize: "var(--text-sm)" }}
            disabled={busy}
            onClick={() => onAct(row.id, "restore")}
          >
            החזרה למפה
          </button>
        )}
        {actions.includes("edit") &&
          (editing ? (
            <>
              <button
                type="button"
                className="btn px-3"
                style={{ fontSize: "var(--text-sm)" }}
                disabled={busy}
                onClick={() =>
                  onAct(row.id, "edit", {
                    nameHe: name,
                    city: city || null,
                    category,
                  })
                }
              >
                שמירה
              </button>
              <button
                type="button"
                className="btn px-3"
                style={{ fontSize: "var(--text-sm)" }}
                onClick={() => setEditing(false)}
              >
                ביטול
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn px-3"
              style={{ fontSize: "var(--text-sm)" }}
              onClick={() => setEditing(true)}
            >
              עריכה
            </button>
          ))}
        {actions.includes("reject") && (
          <button
            type="button"
            className="btn px-3 text-warn"
            style={{ fontSize: "var(--text-sm)", borderColor: "var(--warn)" }}
            disabled={busy}
            onClick={() => onAct(row.id, "reject")}
          >
            דחייה
          </button>
        )}
      </div>
    </li>
  );
}
