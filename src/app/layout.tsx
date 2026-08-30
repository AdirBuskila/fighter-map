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

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://fighter-map.vercel.app";
const DESCRIPTION =
  "איפה באמת עובד כרטיס פייטר ושובר החופשה. מפה קהילתית לפי דיווחי מילואימניקים, עם אפשרות להוסיף מקום ולדווח אם הפסיק לעבוד.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "מפת הטבות פייטר",
    template: "%s · מפת הטבות פייטר",
  },
  description: DESCRIPTION,
  applicationName: "מפת הטבות פייטר",
  robots: { index: true, follow: true },
  // The whole distribution plan is one link passed between people, so the
  // preview card is not decoration: a link with no card reads as spam.
  openGraph: {
    type: "website",
    siteName: "מפת הטבות פייטר",
    title: "מפת הטבות פייטר",
    description: DESCRIPTION,
    url: SITE,
    locale: "he_IL",
  },
  twitter: {
    card: "summary_large_image",
    title: "מפת הטבות פייטר",
    description: DESCRIPTION,
  },
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
    <header className="masthead sticky top-0 z-40">
      <div
        className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4"
        style={{ height: "var(--header-h)" }}
      >
        <Link href="/" className="tap flex items-center gap-2.5">
          <span aria-hidden="true" className="brandmark">
            <span />
            <span />
          </span>
          <span
            className="font-extrabold tracking-tight"
            style={{ fontSize: "var(--text-lg)" }}
          >
            מפת הטבות פייטר
          </span>
        </Link>
        <nav className="mr-auto flex items-center">
          <Link
            href="/add"
            className="masthead-cta tap flex items-center px-3.5"
            style={{ fontSize: "var(--text-sm)" }}
          >
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
          <Link href="/about" className="underline">
            על המפה
          </Link>
          {" · "}
          <Link href="/admin" className="underline">
            ניהול
          </Link>
        </p>
      </div>
    </footer>
  );
}
