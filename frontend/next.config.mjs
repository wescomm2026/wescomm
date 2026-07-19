function originOf(value) {
  try {
    return value ? new URL(value).origin : "";
  } catch {
    return "";
  }
}

export function isProductionDeploymentEnvironment(environment = process.env) {
  if (environment.NEXT_PUBLIC_APP_ENV === "production") return true;

  const hasVercelSystemEnvironment = environment.VERCEL === "1";
  if (hasVercelSystemEnvironment) {
    if (environment.VERCEL_ENV === "production" || environment.VERCEL_TARGET_ENV === "production") return true;
    if (environment.VERCEL_ENV === "preview") return false;
  }

  return environment.NODE_ENV === "production";
}

export function assertSafeProductionPublicFlags(environment = process.env) {
  if (!isProductionDeploymentEnvironment(environment)) return;

  if (environment.NEXT_PUBLIC_ENABLE_DEV_LOGIN === "true") {
    throw new Error("NEXT_PUBLIC_ENABLE_DEV_LOGIN must be false in production.");
  }
  if (environment.NEXT_PUBLIC_E2E_TEST === "true") {
    throw new Error("NEXT_PUBLIC_E2E_TEST must be false in production.");
  }
}

const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";
const apiOrigin = originOf(apiUrl);
const usesSameOriginApi = apiUrl.startsWith("/") && !apiUrl.startsWith("//");
const supabaseOrigin = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseWebSocketOrigin = supabaseOrigin.replace(/^http/, "ws");
const isProductionBuild = process.env.NODE_ENV === "production";
const isProductionDeployment = isProductionDeploymentEnvironment();
assertSafeProductionPublicFlags();
if (
  isProductionDeployment
  && ((!usesSameOriginApi && !apiOrigin.startsWith("https://")) || !supabaseOrigin.startsWith("https://"))
) {
  throw new Error("Production API and Supabase origins must use HTTPS.");
}
const connectSources = [
  "'self'",
  apiOrigin,
  supabaseOrigin,
  supabaseWebSocketOrigin,
  ...(!isProductionBuild ? ["http://localhost:*", "ws://localhost:*"] : [])
].filter(Boolean).join(" ");
const contentSecurityPolicyDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline'${isProductionBuild ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://*.supabase.co",
  `connect-src ${connectSources}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'"
];
if (isProductionDeployment) contentSecurityPolicyDirectives.push("upgrade-insecure-requests");
const contentSecurityPolicy = contentSecurityPolicyDirectives.join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }
];

if (isProductionDeployment) {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload"
  });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ["lucide-react"]
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" }
        ]
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }]
      },
      {
        source: "/(.*)",
        headers: securityHeaders
      }
    ];
  },
  images: {
    // Vercel Services currently routes the frontend image optimizer outside the
    // Next.js service. Serve static and Supabase images directly instead.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**"
      }
    ]
  }
};

export default nextConfig;
