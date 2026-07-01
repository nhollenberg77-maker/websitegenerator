"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Bot, Users, Globe, Settings, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Agent Swarm", icon: Bot, hint: "Team HQ" },
  { href: "/leads", label: "Leads", icon: Users, hint: "Gevonden bedrijven" },
  { href: "/sites", label: "Concept-sites", icon: Globe, hint: "Door Builder gemaakt" },
  { href: "/settings", label: "Instellingen", icon: Settings, hint: "SMTP · agents" },
] as const;

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 group">
      <div className="h-9 w-9 rounded-xl bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center shrink-0">
        <Bot className="h-4.5 w-4.5 text-emerald-400" />
      </div>
      <div className="leading-tight">
        <div className="font-display text-sm font-semibold text-white">Agent Swarm</div>
        <div className="text-[11px] text-white/40">Strona dla Twojej Firmy</div>
      </div>
    </Link>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="px-3 space-y-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon, hint }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group",
              active
                ? "bg-gradient-to-r from-emerald-500/[0.14] to-emerald-500/[0.03] text-white ring-1 ring-inset ring-emerald-400/15"
                : "text-white/55 hover:text-white hover:bg-white/[0.04]"
            )}
          >
            {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" />}
            <Icon className={cn("h-4 w-4 shrink-0 transition-colors", active ? "text-emerald-400" : "text-white/45 group-hover:text-white/70")} />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium leading-tight">{label}</span>
              <span className="block text-[10px] text-white/35 leading-tight">{hint}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

// Publieke routes zonder dashboard-sidebar.
const PUBLIC_ROUTES = ["/unsubscribe"];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))) {
    return null;
  }

  return (
    <>
      {/* Mobile top bar */}
      <header className="lg:hidden bg-[#0b0f0c] text-white flex items-center justify-between px-4 h-14 shrink-0 sticky top-0 z-40 border-b border-white/8">
        <Brand />
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
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <aside className="relative bg-[#0b0f0c] w-72 max-w-[82vw] h-full flex flex-col shadow-2xl border-r border-white/8 animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between px-5 py-5 border-b border-white/8">
              <Brand />
              <button type="button" onClick={() => setMobileOpen(false)} aria-label="Sluit menu" className="h-8 w-8 rounded-md flex items-center justify-center hover:bg-white/10 transition-colors text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 pt-4">
              <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            </div>
            <Footer />
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-60 shrink-0 bg-[#0b0f0c] border-r border-white/8 flex-col h-full">
        <div className="px-5 py-6">
          <Brand />
        </div>
        <div className="flex-1">
          <NavLinks pathname={pathname} />
        </div>
        <Footer />
      </aside>
    </>
  );
}

function Footer() {
  return (
    <div className="px-5 py-4 border-t border-white/8">
      <div className="flex items-center gap-2 text-[11px] text-white/40">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Autonoom · goedkeuring vereist voor mail
      </div>
    </div>
  );
}
