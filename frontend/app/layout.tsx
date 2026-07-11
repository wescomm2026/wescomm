import type { Metadata, Viewport } from "next";
import { StudentAuthProvider } from "@/components/auth/StudentAuthProvider";
import { StudentCartProvider } from "@/components/cart/StudentCartProvider";
import { StudentRestrictionProvider } from "@/components/restrictions/StudentRestrictionProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "WESCOMM",
  description: "Centralized commissary platform for Wesleyan students, staff, and administrators.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "WESCOMM",
    statusBarStyle: "default"
  },
  icons: {
    icon: "/assets/wescomm-logo.png",
    apple: "/assets/wescomm-logo.png"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#006633"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StudentAuthProvider>
          <StudentRestrictionProvider>
            <StudentCartProvider>{children}</StudentCartProvider>
          </StudentRestrictionProvider>
        </StudentAuthProvider>
      </body>
    </html>
  );
}
