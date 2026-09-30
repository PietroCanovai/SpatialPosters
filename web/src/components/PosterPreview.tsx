"use client"

import { ImageOff, RefreshCw } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { computeLogoLayout } from "@/lib/logo-layout"
import { posterCropWindow } from "@/lib/poster-config"
import { posterUrl } from "@/lib/utils"

// Canvas del renderer (STD_W × STD_H): tutte le geometrie sono in questa unità.
const CANVAS_W = 500
const CANVAS_H = 750

interface PosterPreviewProps {
  previewLoading: boolean
  loadProgress: number
  imageError: boolean
  setImageError: (error: boolean) => void
  imgSrc: string
  /** URL del render mostrato (per sapere con quale trasformazione è stato fatto). */
  loadedUrl?: string
  onRetry?: () => void
}

function transformFromUrl(url: string | undefined): { scale: number; x: number; y: number } {
  try {
    const q = new URL(url || "", "http://x").searchParams
    return { scale: Number(q.get("pscale")) || 100, x: Number(q.get("pox")) || 0, y: Number(q.get("poy")) || 0 }
  } catch {
    return { scale: 100, x: 0, y: 0 }
  }
}

const pct = (v: number, of: number) => `${(v / of) * 100}%`

/**
 * Preview dell'editor. Il render server contiene poster, sfumature e badge ma
 * NON il logo (nologo=1): il logo è un livello client posizionato con la
 * stessa computeLogoLayout del server, così trascinarlo è istantaneo. Mentre
 * zoom/pan del poster differiscono da quelli del render mostrato, il poster è
 * disegnato lato client con la stessa finestra di crop del server
 * (posterCropWindow) finché il nuovo render non arriva.
 */
export function PosterPreview({ previewLoading, loadProgress, imageError, setImageError, imgSrc, loadedUrl, onRetry }: PosterPreviewProps) {
  const selected = usePSelector((v) => v.selected)
  const selectedLogo = usePSelector((v) => v.selectedLogo)
  const previewPoster = usePSelector((v) => v.previewPoster)
  const previewUrl = usePSelector((v) => v.previewUrl)
  const ed = usePosterEditor()
  const { t } = useT()

  const rendered = transformFromUrl(loadedUrl)
  const livePoster = !!previewPoster && !!imgSrc && (
    Math.round(ed.posterScale) !== rendered.scale ||
    Math.round(ed.posterOffsetX) !== rendered.x ||
    Math.round(ed.posterOffsetY) !== rendered.y
  )
  const crop = posterCropWindow(CANVAS_W, CANVAS_H, {
    posterScale: ed.posterScale, posterOffsetX: ed.posterOffsetX, posterOffsetY: ed.posterOffsetY,
  })

  const showLogo = !!selectedLogo && previewPoster?.iso_639_1 === null && !!imgSrc
  // Il server alza il logo solo se c'è davvero un badge genere/anno/voto.
  const hasGenreBadge = ed.globalBadges && (ed.badgeGenre || ed.badgeYear || ed.badgeRating)
  const logo = showLogo && selectedLogo
    ? computeLogoLayout({
        posterW: CANVAS_W, posterH: CANVAS_H,
        logoW: selectedLogo.width || 200, logoH: selectedLogo.height || 100,
        logoScale: ed.logoScale, logoOffsetX: ed.logoOffsetX, logoOffsetY: ed.logoOffsetY,
        hasBadges: hasGenreBadge,
      })
    : null

  return (
    <div role="img" aria-label={t("ui.previewAria", { title: selected?.title || selected?.name || "" })}
         className={`preview-frame w-full rounded-[1.35rem] overflow-hidden relative ${previewPoster ? "preview-frame-active" : ""}`}>
      <div className="relative aspect-[2/3] select-none pointer-events-none bg-zinc-950/70 overflow-hidden rounded-[1.2rem]">
        {previewUrl ? (
          <>
            <div className="loading-bar-overlay" style={{ opacity: previewLoading && !livePoster ? 1 : 0, pointerEvents: "none" }} />
            <div className="loading-bar-container" style={{ opacity: previewLoading && !livePoster ? 1 : 0, transition: "opacity 0.3s ease" }}>
              <div className="loading-bar-track" style={{ transform: `scaleX(${loadProgress / 100})`, transformOrigin: "left" }} />
              <span className="loading-bar-text">{loadProgress}%</span>
            </div>
            {imgSrc && (
              /* eslint-disable-next-line @next/next/no-img-element -- server-rendered poster */
              <img src={imgSrc} alt={selected?.title || selected?.name || ""} className="absolute inset-0 w-full h-full object-cover"
                   style={{ visibility: livePoster ? "hidden" : "visible" }} />
            )}
            {livePoster && previewPoster && (
              /* eslint-disable-next-line @next/next/no-img-element -- live zoom/pan while dragging */
              <img
                src={posterUrl(previewPoster.file_path, "w780")}
                alt=""
                className="absolute max-w-none object-cover"
                style={{
                  width: pct(crop.scaledW, CANVAS_W),
                  height: pct(crop.scaledH, CANVAS_H),
                  left: pct(-crop.left, CANVAS_W),
                  top: pct(-crop.top, CANVAS_H),
                }}
              />
            )}
            {logo && selectedLogo && (
              /* eslint-disable-next-line @next/next/no-img-element -- live logo layer */
              <img
                src={posterUrl(selectedLogo.file_path, "w500")}
                alt=""
                className="absolute object-contain"
                style={{
                  left: pct(logo.left, CANVAS_W),
                  top: pct(logo.top, CANVAS_H),
                  width: pct(logo.width, CANVAS_W),
                  height: pct(logo.height, CANVAS_H),
                  objectPosition: "center bottom",
                }}
              />
            )}
          </>
        ) : selected ? (
          <div className="absolute inset-0 bg-surface2/50 animate-pulse rounded-2xl" />
        ) : null}
        {imageError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface/80 text-center p-8 z-20 pointer-events-auto">
            <ImageOff className="w-12 h-12 mb-3 text-zinc-500" />
            <p className="text-sm text-muted font-medium">{t("ui.imageNotAvailable")}</p>
            <p className="text-xs text-zinc-500 mt-1">{t("ui.posterLoadError")}</p>
            <button type="button" aria-label={t("ui.retry")} onClick={() => { setImageError(false); onRetry?.() }}
                    className="mt-3 px-3 py-1.5 text-xs text-muted hover:text-white border border-border hover:border-zinc-500 rounded-lg transition-all duration-150">
              <span className="flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" />{t("ui.retry")}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
