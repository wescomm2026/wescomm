import type { Metadata, Viewport } from "next";
import { StudentAuthProvider } from "@/components/auth/StudentAuthProvider";
import { StudentCartProvider } from "@/components/cart/StudentCartProvider";
import { PwaLifecycle } from "@/components/pwa/PwaLifecycle";
import { StudentRestrictionProvider } from "@/components/restrictions/StudentRestrictionProvider";
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
    <html lang="en">
      <head>
        <link
          rel="preload"
          href="/assets/wescomm-logo-intro.mp4"
          as="video"
          type="video/mp4"
          media="(prefers-reduced-motion: no-preference)"
        />
      </head>
      <body>
        <PwaLifecycle
          enableServiceWorker={enableServiceWorker}
          enableRuntimeCaching={enableRuntimeCaching}
        />
        <StudentAuthProvider>
          <StudentRestrictionProvider>
            <StudentCartProvider>{children}</StudentCartProvider>
          </StudentRestrictionProvider>
        </StudentAuthProvider>
      </body>
    </html>
  );
}
