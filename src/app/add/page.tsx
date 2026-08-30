import type { Metadata } from "next";
import Link from "next/link";
import AddPlaceForm from "@/components/AddPlaceForm";

export const metadata: Metadata = {
  title: "הוספת מקום · מפת הטבות פייטר",
  description: "הוסיפו מקום שבו ההטבה עבדה לכם, כדי שאחרים ידעו.",
};

export default function AddPage() {
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-3 py-4">
      <Link
        href="/map"
        className="tap inline-flex items-center text-ink-soft"
        style={{ fontSize: "var(--text-sm)" }}
      >
        חזרה למפה
      </Link>

      <h1
        className="mt-2 font-extrabold"
        style={{ fontSize: "var(--text-2xl)", lineHeight: 1.15 }}
      >
        הוספת מקום
      </h1>
      <p className="mt-2 text-ink-soft" style={{ fontSize: "var(--text-base)" }}>
        שילמתם עם כרטיס פייטר או מימשתם שובר במקום שעוד לא במפה? ספרו לשאר.
      </p>

      <div className="mt-6">
        <AddPlaceForm />
      </div>
    </div>
  );
}
