import type { Metadata } from "next";
import Link from "next/link";
import HeroConstellation from "@/components/HeroConstellation";
import { countPublishedPlaces, fetchMappedPlaces } from "@/lib/places";

/**
 * The page to send someone who has not used the site.
 *
 * `/` is the working tool, and it is right for a reservist standing outside a
 * shop deciding whether to walk in. It is wrong for the message that says
 * "there's a map for this": a first-time reader lands in the middle of an
 * interface and has to work out what it is and why to believe it.
 *
 * This exists so `/` never has to explain itself, and it is additive -- every
 * shared link still means what it meant.
 */

// The same window the map and the place pages use. There is no reason for the
// landing page to be fresher or staler than the map it advertises.
export const revalidate = 120;

export const metadata: Metadata = {
  title: "על המפה",
  description:
    "מפה קהילתית של מקומות שבהם כרטיס פייטר ושובר החופשה עבדו, לפי דיווחים של מילואימניקים.",
};

export default async function AboutPage() {
  // Both counts come from the database on every revalidation rather than being
  // written down here. The corpus went from 935 rows to over a thousand while
  // this page was being designed; a hardcoded number was already wrong once.
  const [places, publishedTotal] = await Promise.all([
    fetchMappedPlaces(),
    countPublishedPlaces(),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16">
      <HeroConstellation places={places} publishedTotal={publishedTotal} />

      <section className="hero-const__prose">
        <h2>מה זה המקום הזה</h2>
        <p>
          זו מפה קהילתית, לא רשמית. כל מקום שמופיע כאן הגיע מדיווח של מישהו
          ששילם שם בכרטיס פייטר או מימש שובר חופשה, ולא מרשימה של מפעיל הכרטיס.
          אין לנו קשר למשרד הביטחון, לפייטר או למנפיק הכרטיס.
        </p>

        <h2>למה חלק מהמקומות בלי סימון על המפה</h2>
        <p>
          המפה יודעת להראות רק מקומות שיש להם נקודה מדויקת, ולעסקים קטנים בישראל
          פשוט אין רישום במאגרים הפתוחים שאנחנו משתמשים בהם. במקום להמציא נקודה
          ולשלוח אתכם לבניין הלא נכון, המקומות האלה מופיעים ברשימה, והכפתור
          בעמוד שלהם פותח חיפוש בגוגל מפות לפי השם והעיר.
        </p>

        <h2>איך מוסיפים מקום</h2>
        <p>
          דרך <Link href="/add">הוספת מקום</Link>. אם החיפוש לא מוצא את בית העסק, אפשר
          להדביק קישור מגוגל מפות והמיקום ייקבע ממנו. מקום חדש מתפרסם מיד, ומסומן
          כדיווח יחיד עד שעוד מישהו מאשר אותו.
        </p>
      </section>
    </main>
  );
}
