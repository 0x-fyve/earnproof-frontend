import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { ContractMigrationStatusBanner } from "@/components/common/contract-migration-banner";
import { WebVitalsReporter } from "@/components/common/web-vitals-reporter";
import { PrivacyProvider } from "@/contexts/privacy-context";
import { AppQueryProvider } from "@/lib/query/provider";
import "./globals.css";

// Mirrors lib/storage's STORAGE_KEYS.DISPLAY_PREFERENCES: a plain <script>
// cannot import the module, so the key is duplicated here (same tradeoff
// already made for SESSION_KEY in components/organizations/organization-management.tsx).
const DISPLAY_PREFERENCES_STORAGE_KEY = "earnproof.display-preferences";

// Applies any explicit reduced-motion/high-contrast override before first
// paint, so the page never flashes the system-default appearance first.
// "system" needs no JS (the CSS media queries alone govern it), so this
// only touches the DOM when the user has explicitly overridden a mode.
const DISPLAY_PREFERENCES_BOOTSTRAP_SCRIPT = `(function() {
  try {
    var raw = window.localStorage.getItem(${JSON.stringify(DISPLAY_PREFERENCES_STORAGE_KEY)});
    if (!raw) return;
    var parsed = JSON.parse(raw);
    var data = parsed && parsed.data;
    if (!data) return;
    var root = document.documentElement;
    if (data.reducedMotion === "enabled") {
      root.dataset.motion = "reduced";
    } else if (data.reducedMotion === "disabled") {
      root.dataset.motion = "full";
    }
    if (data.highContrast === "enabled") {
      root.dataset.contrast = "high";
    }
  } catch (e) {}
})();`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EarnProof",
  description:
    "Privacy-preserving income and payment verification on Stellar testnet.",
  icons: {
    icon: "/logo.svg",
    shortcut: "/logo.svg",
    apple: "/logo.svg",
  },
};

// Nonce-based CSP requires request-time rendering so Next can tag its
// framework scripts and inline bootstrap with the per-request nonce.
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <AppQueryProvider>
          <PrivacyProvider>
            <WebVitalsReporter />
            <ContractMigrationStatusBanner />
            {children}
          </PrivacyProvider>
        </AppQueryProvider>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: DISPLAY_PREFERENCES_BOOTSTRAP_SCRIPT }}
        />
      </body>
    </html>
  );
}
