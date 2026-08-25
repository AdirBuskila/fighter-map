import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { CONTACT_EMAIL, CONTACT_MAILTO, LEGAL_NOTICE } from "@/lib/types";

const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "700", "800"],
  display: "swap",
  variable: "--font-heebo",
});

export const metadata: Metadata = {
  title: "מפת הטבות פייטר",
  description:
    "מפה קהילתית של מקומות שבהם מילואימניקים הצליחו לשלם עם כרטיס פייטר או לממש שובר חופשה.",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#12151a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:right-2 focus:z-50 focus:bg-surface focus:px-3 focus:py-2"
        >
          דילוג לתוכן
        </a>
        <SiteHeader />
        <main id="main" className="flex flex-1 flex-col">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}

function SiteHeader() {
  return (
    <header className="hairline sticky top-0 z-40 bg-surface">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-3 py-2">
        <Link
          href="/"
          className="tap flex items-center gap-2 font-extrabold tracking-tight"
          style={{ fontSize: "var(--text-lg)" }}
        >
          <span aria-hidden="true" className="mark mark-fighter" />
          מפת הטבות פייטר
        </Link>
        <nav className="mr-auto flex items-center gap-1">
          <Link href="/add" className="btn btn-primary px-3 text-sm">
            הוספת מקום
          </Link>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-surface-sunk">
      <div className="mx-auto w-full max-w-6xl px-3 py-4">
        <p
          className="text-ink-soft"
          style={{ fontSize: "var(--text-xs)", lineHeight: 1.6 }}
        >
          {LEGAL_NOTICE}
        </p>
        <p
          className="mt-2 text-ink-soft"
          style={{ fontSize: "var(--text-xs)", lineHeight: 1.6 }}
        >
          חסר מקום, יש הערה או רעיון לשיפור? כתבו לנו ל{" "}
          <a className="font-semibold underline" href={CONTACT_MAILTO} dir="ltr">
            {CONTACT_EMAIL}
          </a>
        </p>
        <p className="mt-2 text-ink-faint" style={{ fontSize: "var(--text-2xs)" }}>
          לא קשור למשרד הביטחון, לפייטר או למנפיק הכרטיס.{" "}
          <Link href="/admin" className="underline">
            ניהול
          </Link>
        </p>
      </div>
    </footer>
  );
}
