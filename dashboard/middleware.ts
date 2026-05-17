import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// On Vercel: only the public lead sites under /sites/* are served.
// Everything else (dashboard pages + mutating APIs) is redirected to /local-only.
// Locally (npm run dev): middleware is a no-op.
export function middleware(req: NextRequest) {
  // VERCEL=1 is set by Vercel runtime
  if (process.env.VERCEL !== "1") return NextResponse.next();

  const { pathname } = req.nextUrl;

  // Allow: generated lead sites, the local-only stub, Next.js internals
  if (
    pathname.startsWith("/sites/") ||
    pathname === "/local-only" ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt"
  ) {
    return NextResponse.next();
  }

  // Block API routes with 404 (they all need filesystem / DB writes that don't work serverless)
  if (pathname.startsWith("/api/")) {
    return new NextResponse(null, { status: 404 });
  }

  // Dashboard pages → redirect to stub
  const url = req.nextUrl.clone();
  url.pathname = "/local-only";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
