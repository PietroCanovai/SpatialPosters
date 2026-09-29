"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { SearchBar } from "@/components/SearchBar"
import { ScrollReveal } from "@/components/ScrollReveal"
import { SavedPostersBundle } from "@/components/SavedPostersBundle"

export function HomeView() {
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const query = usePSelector((v) => v.query)
  const setQuery = usePSelector((v) => v.setQuery)
  const navigateToPoster = usePSelector((v) => v.navigateToPoster)
  const recentSearches = usePSelector((v) => v.recentSearches)
  const clearRecentSearches = usePSelector((v) => v.clearRecentSearches)
  const removeRecentSearch = usePSelector((v) => v.removeRecentSearch)
  const router = useRouter()
  const { t } = useT()

  return (
    <div>
      <div className="flex flex-col items-center pt-6 pb-8">
        {/* eslint-disable-next-line @next/next/no-img-element -- logo locale */}
        <img src="/SpatialPosters.png" alt="SpatialPosters" decoding="async" className="header-logo h-20 w-auto mb-8" />
        <div className="w-full max-w-lg relative z-[100] isolate">
          <SearchBar
            tmdbKey={tmdbKey}
            value={query}
            onChange={setQuery}
            onSearch={(q) => router.push(`/search?q=${encodeURIComponent(q.trim())}`)}
            onSelectResult={(item) => navigateToPoster(item)}
            recentSearches={recentSearches}
            onClearRecentSearches={clearRecentSearches}
            onRemoveRecentSearch={removeRecentSearch}
            large
          />
        </div>
      </div>

      {!tmdbKey ? (
        <div className="max-w-md mx-auto mt-8 mb-16">
          <div className="glass-panel relative overflow-hidden p-8 flex flex-col items-center text-center animate-fade-scale-in-hero">
            <h2 className="text-lg font-bold text-zinc-100 mb-2">{t("ui.welcomePanelTitle")}</h2>
            <p className="text-sm text-muted mb-6 leading-relaxed">{t("ui.noKey")}</p>
            <Link href="/settings" className="btn-primary px-5 py-2.5 text-sm">
              {t("ui.openSettings")}
            </Link>
          </div>
        </div>
      ) : (
        <ScrollReveal animation="fade-up" threshold={0.05}>
          <SavedPostersBundle />
        </ScrollReveal>
      )}
    </div>
  )
}
