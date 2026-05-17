"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, Users, Globe, Settings, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Cockpit", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/sites", label: "Voorbeeld-sites", icon: Globe },
  { href: "/settings", label: "Instellingen", icon: Settings },
] as const;

function Brand({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <Link href="/" className="font-display text-sm font-semibold text-white leading-tight">
        Strona dla <span className="text-white/55 italic font-normal">Twojej Firmy</span>
      </Link>
    );
  }
  return (
    <h1 className="font-display text-lg font-semibold text-white leading-tight">
      Strona dla
      <br />
      <span className="text-white/55 italic font-normal text-base">Twojej Firmy</span>
    </h1>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="px-3 space-y-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors",
              active
                ? "bg-white/12 text-white font-medium"
                : "text-white/60 hover:text-white hover:bg-white/6"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar */}
      <header className="lg:hidden bg-navy text-white flex items-center justify-between px-4 h-14 shrink-0 sticky top-0 z-40 border-b border-white/10">
        <Brand compact />
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="h-9 w-9 rounded-md flex items-center justify-center hover:bg-white/10 transition-colors"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative bg-navy text-white w-64 max-w-[80vw] h-full flex flex-col shadow-2xl animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
              <Brand compact />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Sluit menu"
                className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-white/10 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 pt-4">
              <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            </div>
            <div className="px-5 py-4 border-t border-white/10">
              <p className="text-xs text-white/40">Vanaf 149 zł/mies.</p>
            </div>
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-56 shrink-0 bg-navy text-sidebar-foreground flex-col h-full">
        <div className="px-5 py-6">
          <Brand />
        </div>
        <div className="flex-1">
          <NavLinks pathname={pathname} />
        </div>
        <div className="px-5 py-4 border-t border-white/10">
          <p className="text-xs text-white/40">Vanaf 149 zł/mies.</p>
        </div>
      </aside>
    </>
  );
}
