"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Check, Loader2, Send, Trash2 } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { getLang } from "@/lib/i18n"
import { jellyfinApi } from "@/lib/jellyfin-client"
import { PosterOptions } from "@/components/PosterOptions"
import { LogoOptions } from "@/components/LogoOptions"
import { EditorPanel } from "@/components/EditorPanel"
import { PosterPreview } from "@/components/PosterPreview"
import { PosterDepthEdge, PosterDepthSheen } from "@/components/PosterDepthGlow"
import { BadgeControls } from "@/components/BadgeControls"
import { TransformControls } from "@/components/TransformControls"
import { JwRankBadge } from "@/components/JwRankBadge"
import { BackButton } from "@/components/BackButton"
import { usePosterPreview } from "@/lib/usePosterPreview"

type RightTab = "logo" | "badge" | "transform"

/** Editor del poster di un titolo (route /movie/[id] e /tv/[id]). */
export default function EditView() {
  const accentColor = usePSelector((v) => v.accentColor)
  const loadingImages = usePSelector((v) => v.loadingImages)
  const logos = usePSelector((v) => v.logos)
  const mappingsMap = usePSelector((v) => v.mappingsMap)
  const posterActivePath = usePSelector((v) => v.posterActivePath)
  const posters = usePSelector((v) => v.posters)
  const previewPoster = usePSelector((v) => v.previewPoster)
  const removeLogo = usePSelector((v) => v.removeLogo)
  const removeMapping = usePSelector((v) => v.removeMapping)
  const saveConfig = usePSelector((v) => v.saveConfig)
  const selected = usePSelector((v) => v.selected)
  const selectedLogo = usePSelector((v) => v.selectedLogo)
  const selectLogo = usePSelector((v) => v.selectLogo)
  const selectPoster = usePSelector((v) => v.selectPoster)
  const titleOf = usePSelector((v) => v.titleOf)
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const mdblistKey = usePSelector((v) => v.mdblistApiKey)
  const yearOf = usePSelector((v) => v.yearOf)
  const { t, lang } = useT()
  const ed = usePosterEditor()
  const [activeRightTab, setActiveRightTab] = useState<RightTab>("logo")
  const [activePosterTab, setActivePosterTab] = useState("clean")
  const [sending, setSending] = useState(false)

  // Quando si seleziona un nuovo titolo, mostra sempre prima i clean (iso_639_1 === null)
  useEffect(() => {
    if (selected?.id) setActivePosterTab("clean")
  }, [selected?.id])

  const { imageError, setImageError, previewLoading, loadProgress, imgSrc, loadedUrl, retry } = usePosterPreview()

  // "Send to Jellyfin": salva il design (se è stato scelto un poster) e carica
  // il poster renderizzato su tutti gli item Jellyfin con questo titolo. Senza
  // scelta esplicita il server usa il poster migliore, come nella preview.
  const handleSend = useCallback(async () => {
    if (!selected || sending) return
    if (!tmdbKey) {
      toast.error("Add your TMDB API key in Settings → API keys first.")
      return
    }
    setSending(true)
    try {
      if (previewPoster) await saveConfig({ silent: true })
      const res = await jellyfinApi.pushTitle(selected.id, selected.media_type === "tv" ? "tv" : "movie", tmdbKey, getLang(), mdblistKey)
      const names = res.items.map((i) => i.name).join(", ")
      toast.success(`Sent to Jellyfin${names ? `: ${names}` : ""}`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      toast.error(`Saved, but not sent to Jellyfin: ${message}`)
    } finally {
      setSending(false)
    }
  }, [selected, previewPoster, sending, tmdbKey, mdblistKey, saveConfig])

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleSend()
      }
    }
    window.addEventListener("keydown", fn)
    return () => window.removeEventListener("keydown", fn)
  }, [handleSend])

  if (!selected) return null

  const cleanPoster = previewPoster?.iso_639_1 === null
  const mapping = mappingsMap.get(`${selected.media_type}:${selected.id}`)
  const rightTabs: { key: RightTab; label: string }[] = [
    { key: "logo", label: t("ui.logoSection") },
    { key: "badge", label: t("ui.badgeSection") },
    { key: "transform", label: t("ui.transform") },
  ]

  return (
    <div className="flex flex-col w-full">
      {/* Barra superiore: Indietro · titolo · azioni */}
      <div className="flex items-center gap-4 mb-4">
        <BackButton />
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-extrabold tracking-tight text-white truncate">{titleOf(selected) || "…"}</h1>
          <p className="text-[11px] font-mono text-zinc-500">
            {yearOf(selected)}{yearOf(selected) ? " · " : ""}{selected.media_type === "movie" ? t("ui.movie") : t("ui.tvSeries")}
            {" · "}TMDB <a href={`https://www.themoviedb.org/${selected.media_type}/${selected.id}`} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-white underline underline-offset-2">{selected.id}</a>
            {selected.imdb_id ? <> · IMDb <a href={`https://www.imdb.com/title/${selected.imdb_id}`} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-white underline underline-offset-2">{selected.imdb_id}</a></> : null}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {mapping && (
            <span className="text-[10px] font-semibold px-2 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex items-center gap-1">
              <Check className="w-3 h-3 stroke-[3]" />
              {t("ui.savedShort")}
            </span>
          )}
          <JwRankBadge tmdbId={selected.id} type={selected.media_type === "movie" ? "movie" : "tv"} regionCode={ed.defaultRegion} />
          {mapping && (
            <button type="button" aria-label={t("ui.remove")} title="Delete the saved design"
                    onClick={() => { removeMapping(mapping).catch((e) => console.error("[spatialposters] Remove mapping failed:", e)) }}
                    className="btn-danger min-h-[40px] px-3 rounded-xl text-xs">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button type="button" onClick={handleSend} disabled={sending}
                  title="Save the design and upload it to Jellyfin (Ctrl+S)"
                  className="btn-primary min-h-[40px] px-5 rounded-xl disabled:opacity-50">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send to Jellyfin
          </button>
        </div>
      </div>

      {/* Workspace a 3 colonne */}
      <div className="editor-workspace w-full mx-auto h-[clamp(620px,calc(100dvh-110px),900px)] min-h-0">
        {/* SINISTRA: poster disponibili */}
        <div className="h-full min-w-0">
          <EditorPanel className="animate-fade-scale-in-panel-left h-full" aria-label={`${selected.title || ""} — Poster selection`} title={t("ui.posterAvailable")}
                       headerRight={<span className="text-[10px] font-mono text-muted px-1.5 py-0.5 rounded-md bg-white/[0.05] border border-white/10 tabular-nums">{posters.length}</span>}>
            {loadingImages ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 rounded-lg skeleton-shimmer" />)}</div>
            ) : (
              <PosterOptions posters={posters} posterActivePath={posterActivePath} lang={lang} selectPoster={selectPoster} activeGroup={activePosterTab} onActiveGroupChange={setActivePosterTab} showTabs />
            )}
          </EditorPanel>
        </div>

        {/* CENTRO: anteprima */}
        <div className="h-full min-w-0">
          <EditorPanel className="animate-fade-scale-in h-full" title={<><span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 align-middle shadow-[0_0_6px_rgba(52,211,153,0.7)]" aria-hidden="true" />{t("ui.previewLive")}</>}>
            <div className="flex flex-col items-center h-full min-h-0">
              <div className="flex-1 min-h-0 w-full flex items-center justify-center">
                <div className="editor-preview-fit relative">
                  <div className={`editor-stage editor-stage-fill isolate ${previewPoster?.file_path ? "editor-stage-glow" : ""}`}>
                    <PosterDepthEdge edgeStrength={40} edgeCoverage={10} />
                    <div
                      className="absolute -inset-8 rounded-3xl opacity-45 blur-3xl pointer-events-none transition-all duration-700 ease-out z-0"
                      style={{
                        background: accentColor
                          ? `radial-gradient(circle at 50% 50%, ${accentColor}, transparent 70%)`
                          : "radial-gradient(circle at 50% 50%, rgba(232, 93, 42, 0.40), transparent 70%)",
                      }}
                    />
                    <div className="absolute inset-0 z-[1]">
                      <PosterPreview
                        previewLoading={previewLoading}
                        loadProgress={loadProgress}
                        imageError={imageError}
                        setImageError={setImageError}
                        imgSrc={imgSrc}
                        loadedUrl={loadedUrl}
                        onRetry={retry}
                      />
                    </div>
                    <PosterDepthSheen sheenStrength={20} />
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-zinc-500 text-center mt-3 shrink-0">
                {selectedLogo ? t("ui.logoSelected") : cleanPoster ? `${t("ui.clean")} ${t("ui.selected").toLowerCase()}` : previewPoster ? t("ui.logoHint") : t("ui.noPosterSelected")}
              </p>
            </div>
          </EditorPanel>
        </div>

        {/* DESTRA: personalizzazione */}
        <div className="h-full min-w-0">
          <EditorPanel className="animate-fade-scale-in-panel-right h-full" title={t("ui.customize")}>
            <div className="flex items-center gap-1 p-1 bg-white/[0.04] border border-white/10 rounded-xl mb-3 shadow-inner shrink-0 w-full min-w-0">
              {rightTabs.map((tab) => (
                <button
                  type="button"
                  key={tab.key}
                  onClick={() => setActiveRightTab(tab.key)}
                  className={`tab-chip h-auto min-h-[32px] flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all duration-150 cursor-pointer flex items-center justify-center whitespace-nowrap ${
                    activeRightTab === tab.key
                      ? "tab-chip-active bg-zinc-100 text-zinc-950 shadow-md shadow-white/10 border border-white/80"
                      : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="animate-tab-fade-in space-y-3">
              {activeRightTab === "logo" && <>
                <LogoOptions logos={logos} selectedLogo={selectedLogo} lang={lang} selectLogo={selectLogo} removeLogo={removeLogo} disabled={!cleanPoster} />
                {!cleanPoster && <p className="text-xs text-zinc-500 text-center mt-2 px-1">{t("ui.logoHint")}</p>}
              </>}
              {activeRightTab === "badge" && <BadgeControls />}
              {activeRightTab === "transform" && <TransformControls />}
            </div>
            {!tmdbKey && (
              <p className="text-[11px] text-amber-300 mt-4">
                Add your TMDB key in <Link href="/settings" className="underline">Settings → API keys</Link>.
              </p>
            )}
          </EditorPanel>
        </div>
      </div>
    </div>
  )
}
