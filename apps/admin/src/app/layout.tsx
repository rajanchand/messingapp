import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/providers";

const APP_NAME = process.env.APP_NAME ?? "Zero Trust Security";
const APP_FAVICON = process.env.APP_FAVICON ?? "/branding/favicon.svg";

// Render every page per-request. Static prerendering would bake HTML at
// build time, which breaks the per-request CSP script nonce set in proxy.ts
// (Next.js can only attach the nonce to inline scripts during a dynamic
// render). An authenticated admin console gains nothing from static pages.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: "Secure Matrix collaboration and administration platform",
  icons: { icon: APP_FAVICON },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
