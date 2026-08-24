import type { Metadata, Viewport } from "next";
import { WelcomeGateOverlay } from "@/components/auth/WelcomeGateOverlay";
import { PwaLifecycle } from "@/components/pwa/PwaLifecycle";
import { welcomeIntroBootstrapScript } from "@/lib/welcome-intro";
import "./globals.css";

export const metadata: Metadata = {
  title: "WESCOMM",
  description: "Centralized commissary platform for Wesleyan students, staff, and administrators.",
  applicationName: "WESCOMM",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "WESCOMM",
    statusBarStyle: "default"
  },
  icons: {
    icon: [
      { url: "/icons/wescomm-icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/wescomm-icon-512.png", type: "image/png", sizes: "512x512" }
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", type: "image/png", sizes: "180x180" }]
  },
  formatDetection: {
    telephone: false
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#006633"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const enableServiceWorker =
    process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_E2E_TEST === "true";
  const enableRuntimeCaching = process.env.NODE_ENV === "production";

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* This first-party bootstrap must execute while HTML is parsed so a
            reload never paints or downloads the already-seen intro. */}
        <script
          id="wescomm-welcome-intro"
          dangerouslySetInnerHTML={{ __html: welcomeIntroBootstrapScript() }}
        />
        <WelcomeGateOverlay />
        <PwaLifecycle
          enableServiceWorker={enableServiceWorker}
          enableRuntimeCaching={enableRuntimeCaching}
        />
        {children}
      </body>
    </html>
  );
}
