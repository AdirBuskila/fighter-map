import type { Metadata } from "next";
import AdminPanel from "@/components/AdminPanel";

export const metadata: Metadata = {
  title: "ניהול · מפת הטבות פייטר",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-3 py-4">
      <h1 className="font-extrabold" style={{ fontSize: "var(--text-2xl)" }}>
        תור הניהול
      </h1>
      <AdminPanel />
    </div>
  );
}
