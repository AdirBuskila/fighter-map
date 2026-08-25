import Explorer from "@/components/Explorer";
import { fetchMappedPlaces, fetchUnmappedPlaces } from "@/lib/places";
import { supabaseConfigured } from "@/lib/supabase";

// The dataset changes only when someone reports, so a short revalidation window
// keeps the first paint cheap without letting the map go stale for long.
export const revalidate = 120;

export default async function HomePage() {
  const [mapped, unmapped] = await Promise.all([
    fetchMappedPlaces(),
    fetchUnmappedPlaces(),
  ]);

  const empty = mapped.length === 0 && unmapped.length === 0;
  if (!supabaseConfigured && empty) return <NotConfigured />;
  if (empty) return <NoData />;

  return <Explorer mapped={mapped} unmapped={unmapped} />;
}

function NotConfigured() {
  return (
    <Shell title="בסיס הנתונים לא מחובר">
      <p>
        חסרים NEXT_PUBLIC_SUPABASE_URL ו NEXT_PUBLIC_SUPABASE_ANON_KEY בקובץ
        env.local. העתיקו אותם מלוח הבקרה של Supabase והריצו מחדש את npm run dev.
      </p>
    </Shell>
  );
}

function NoData() {
  return (
    <Shell title="אין עדיין מקומות במפה">
      <p>
        הטבלה ריקה. הריצו את scripts/05_seed_supabase.py כדי לטעון את הנתונים
        מהקובץ, או הוסיפו מקום ראשון דרך הוספת מקום.
      </p>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 items-center px-4 py-16">
      <div>
        <h1 className="font-extrabold" style={{ fontSize: "var(--text-2xl)" }}>
          {title}
        </h1>
        <div
          className="mt-3 text-ink-soft"
          style={{ fontSize: "var(--text-base)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
