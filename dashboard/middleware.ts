import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const BASE_DOMAIN = "stronadlatwojejfirmy.com.pl";

// Routing rules:
// - {slug}.stronadlatwojejfirmy.com.pl/        → rewrite to /sub/{slug}/index.html
// - stronadlatwojejfirmy.com.pl (apex)         → redirect to /local-only
// - stronadlatwojejfirmy.vercel.app (preview)  → redirect to /local-only
// - localhost (npm run dev)                    → no-op, everything works normally
//
// API routes are 404'd on Vercel (they need filesystem writes that don't work
// in serverless), but pass through locally.
export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") || "").toLowerCase().split(":")[0];
  const { pathname } = req.nextUrl;

  // Always pass through Next.js internals + static lead sites
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/sites/") ||
    pathname.startsWith("/sub/") ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt"
  ) {
    return NextResponse.next();
  }

  // === Subdomain on custom domain → rewrite to slug folder ===
  if (host.endsWith(`.${BASE_DOMAIN}`)) {
    const slug = host.slice(0, -BASE_DOMAIN.length - 1);
    // Root path on subdomain → serve the slug's index
    if (pathname === "/" || pathname === "") {
      const url = req.nextUrl.clone();
      url.pathname = `/sub/${slug}/index.html`;
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  // === Local dev → no further routing ===
  if (process.env.VERCEL !== "1") return NextResponse.next();

  // === On Vercel (apex domain or vercel.app preview) → restricted ===
  if (pathname.startsWith("/api/")) {
    return new NextResponse(null, { status: 404 });
  }
  if (pathname === "/local-only") {
    return NextResponse.next();
  }
  const url = req.nextUrl.clone();
  url.pathname = "/local-only";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
