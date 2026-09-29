"use client"

import React, { useState, useRef, useEffect, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, RefreshCw, Settings, Check, Tv } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { setLang, getLang } from "@/lib/i18n"
import { LANG_NAMES, UI_LANGUAGES } from "@/lib/utils"
import { usePSelector } from "@/lib/context"
import { BladeSpinner } from "@/components/ui/BladeSpinner"

function Tooltip({ children }: { children: ReactNode }) {
  return (
    <span className="pointer-events-none absolute left-full ml-3.5 px-2.5 py-1 text-xs font-semibold rounded-xl border opacity-0 group-hover:opacity-100 transition-all duration-200 whitespace-nowrap shadow-xl z-50 bg-zinc-900 text-zinc-100 border-white/10 shadow-black/80">
      {children}
    </span>
  )
}

function IconImg({ src, alt }: { src: string; alt: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- custom icon
    <img src={src} alt={alt} className="w-4.5 h-4.5 object-contain transition-all duration-200 brightness-0 invert opacity-75 group-hover:opacity-100" />
  )
}

function NavLink({ href, active, label, children, badge }: { href: string; active: boolean; label: string; children: ReactNode; badge?: ReactNode }) {
  return (
    <Link href={href} title={label} className={`group sidebar-dock-btn ${active ? "sidebar-dock-btn-active" : ""}`}>
      {children}
      {badge}
      <Tooltip>{label}</Tooltip>
    </Link>
  )
}

export function DesktopSidebar() {
  const { t } = useT()
  const pathname = usePathname()
  const mappings = usePSelector((v) => v.mappings)
  const refreshLists = usePSelector((v) => v.refreshLists)

  const [refreshing, setRefreshing] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [currentLang, setCurrentLangState] = useState("en")
  const langRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try { setCurrentLangState(getLang()) } catch {}
  }, [])

  // Chiude il menu lingua se si clicca fuori
  useEffect(() => {
    if (!langOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [langOpen])

  const pickLanguage = (code: string) => {
    setLang(code)
    setCurrentLangState(code)
    try { localStorage.setItem("preferred_lang", code) } catch {}
  }

  const iconClass = "w-4.5 h-4.5 transition-all duration-200 text-zinc-300 group-hover:text-white"

  return (
    <aside className="flex fixed left-5 top-1/2 -translate-y-1/2 z-50 flex-col items-center gap-2 p-2 sidebar-dock-shell">
      <div className="flex flex-col items-center gap-1.5">
        <NavLink href="/" active={pathname === "/" || pathname === "/search"} label={t("ui.home") || "Home"}>
          <Home className={iconClass} />
        </NavLink>
        <NavLink href="/jellyfin" active={pathname === "/jellyfin"} label="Jellyfin">
          <Tv className={iconClass} />
        </NavLink>
        <NavLink
          href="/myposters"
          active={pathname === "/myposters"}
          label={`${t("ui.myPosters") || "My posters"} (${mappings.length})`}
          badge={mappings.length > 0 ? (
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold shadow-md bg-white text-zinc-950">
              {mappings.length > 99 ? "99+" : mappings.length}
            </span>
          ) : undefined}
        >
          <IconImg src="/icon/myposter.webp" alt="My posters" />
        </NavLink>
      </div>

      <div className="w-7 h-px my-0.5 bg-white/10" />

      <div className="flex flex-col items-center gap-1.5">
        <button
          type="button"
          onClick={async () => { setRefreshing(true); try { await refreshLists() } finally { setRefreshing(false) } }}
          disabled={refreshing}
          title={t("ui.refreshLists")}
          className="group sidebar-dock-btn"
        >
          {refreshing ? <BladeSpinner size="16px" /> : <RefreshCw className={iconClass} />}
          <Tooltip>{t("ui.refreshLists")}</Tooltip>
        </button>

        <div ref={langRef} className="relative group">
          <button
            type="button"
            onClick={() => setLangOpen((o) => !o)}
            title={LANG_NAMES[currentLang] || "Language"}
            className={`sidebar-dock-btn ${langOpen ? "sidebar-dock-btn-active" : ""}`}
          >
            <IconImg src="/icon/lang.webp" alt="Language" />
          </button>
          {!langOpen && <Tooltip>{LANG_NAMES[currentLang]} ({currentLang.toUpperCase()})</Tooltip>}
          {langOpen && (
            <div className="absolute left-full top-0 ml-3 backdrop-blur-2xl border rounded-2xl p-1.5 shadow-2xl z-50 min-w-44 bg-zinc-950/95 border-white/15 text-white shadow-black/90 animate-fade-scale-in">
              {UI_LANGUAGES.map((l) => (
                <button
                  type="button"
                  key={l.code}
                  onClick={() => { pickLanguage(l.code); setLangOpen(false) }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all duration-150 text-left hover:bg-white/10 cursor-pointer ${
                    l.code === currentLang ? "bg-white text-zinc-950 font-bold" : "text-zinc-300"
                  }`}
                >
                  <span className="flex items-center gap-2"><span>{l.flag}</span><span>{l.name}</span></span>
                  {l.code === currentLang && <Check className="w-3.5 h-3.5 shrink-0 text-zinc-950" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <NavLink href="/status" active={pathname === "/status"} label={t("ui.statusTitle") || "Status"}>
          <IconImg src="/icon/status.webp" alt="Status" />
        </NavLink>
        <NavLink href="/settings" active={pathname === "/settings"} label={t("ui.settings")}>
          <Settings className={iconClass} />
        </NavLink>
      </div>
    </aside>
  )
}
