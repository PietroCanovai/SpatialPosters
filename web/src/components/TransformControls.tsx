"use client"

import { useState } from "react"
import { Search, ArrowLeftRight, ArrowUpDown } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { logoDefaultScale } from "@/lib/logo-selection"
import { POSTER_SCALE_MAX, POSTER_SCALE_MIN } from "@/lib/poster-config"
import { SliderRow } from "@/components/SliderRow"

function SectionHeader({ title, onReset, resetLabel }: { title: string; onReset: () => void; resetLabel: string }) {
  return (
    <div className="control-row flex items-center justify-between mb-2 px-1">
      <h4 className="control-label">{title}</h4>
      <button type="button" aria-label={`${resetLabel} ${title}`} onClick={onReset}
              className="text-xs text-muted hover:text-accent transition-colors px-2 py-0.5 rounded-md border border-border/50 hover:border-accent/30">
        {resetLabel}
      </button>
    </div>
  )
}

/**
 * Zoom/pan del poster e scala/posizione del logo. Le modifiche sono istantanee
 * nella preview (livelli lato client in PosterPreview); il render esatto
 * arriva quando si smette di trascinare.
 */
export function TransformControls() {
  const selectedLogo = usePSelector((v) => v.selectedLogo)
  const previewPoster = usePSelector((v) => v.previewPoster)
  const logoBounds = usePSelector((v) => v.logoBounds)
  const { t } = useT()
  const ed = usePosterEditor()
  // Stato di editing del valore numerico locale (non nel context condiviso).
  const [editingValue, setEditingValue] = useState<string | null>(null)
  const [editText, setEditText] = useState("")
  const edit = { editingValue, editText, setEditingValue, setEditText }

  // Pan massimo: metà dell'eccedenza dell'immagine zoomata rispetto al canvas 500×750.
  const maxPanX = Math.round((500 * ed.posterScale / 100 - 500) / 2)
  const maxPanY = Math.round((750 * ed.posterScale / 100 - 750) / 2)
  const clampPan = (v: number, max: number) => Math.max(-max, Math.min(max, v))
  const setPosterScale = (v: number) => {
    ed.setPosterScale(v)
    // Riducendo lo zoom il pan va ristretto al nuovo margine disponibile.
    const mx = Math.round((500 * v / 100 - 500) / 2)
    const my = Math.round((750 * v / 100 - 750) / 2)
    ed.setPosterOffsetX((x) => clampPan(x, mx))
    ed.setPosterOffsetY((y) => clampPan(y, my))
  }
  const resetPoster = () => { ed.setPosterScale(100); ed.setPosterOffsetX(0); ed.setPosterOffsetY(0) }

  const logoApplies = !!selectedLogo && previewPoster?.iso_639_1 === null
  const defaultLogoScale = () => ed.setLogoScale(selectedLogo ? (logoDefaultScale(selectedLogo) ?? 75) : 75)
  const resetLogo = () => { defaultLogoScale(); ed.setLogoOffsetX(0); ed.setLogoOffsetY(0) }

  return (
    <div className="space-y-5">
      <div>
        <SectionHeader title={t("ui.posterSection") || "Poster"} onReset={resetPoster} resetLabel={t("ui.reset")} />
        <div className="space-y-2">
          <SliderRow icon={<Search className="w-3.5 h-3.5" />} label={t("ui.scale")} value={ed.posterScale} min={POSTER_SCALE_MIN} max={POSTER_SCALE_MAX}
                     boundsMin={POSTER_SCALE_MIN} boundsMax={POSTER_SCALE_MAX} onChange={setPosterScale} onDoubleClick={resetPoster}
                     editingKey="pscale" suffix="%" {...edit} />
          <SliderRow icon={<ArrowLeftRight className="w-3.5 h-3.5" />} label="X" value={ed.posterOffsetX} min={-maxPanX} max={maxPanX}
                     boundsMin={-maxPanX} boundsMax={maxPanX} onChange={(v) => ed.setPosterOffsetX(clampPan(v, maxPanX))} onDoubleClick={() => ed.setPosterOffsetX(0)}
                     editingKey="pox" {...edit} />
          <SliderRow icon={<ArrowUpDown className="w-3.5 h-3.5" />} label="Y" value={ed.posterOffsetY} min={-maxPanY} max={maxPanY}
                     boundsMin={-maxPanY} boundsMax={maxPanY} onChange={(v) => ed.setPosterOffsetY(clampPan(v, maxPanY))} onDoubleClick={() => ed.setPosterOffsetY(0)}
                     editingKey="poy" {...edit} />
          {ed.posterScale === 100 && (
            <p className="text-[11px] text-zinc-500 px-1">Zoom in to move the poster.</p>
          )}
        </div>
      </div>

      <div>
        <SectionHeader title={t("ui.logoSection") || "Logo"} onReset={resetLogo} resetLabel={t("ui.reset")} />
        {logoApplies ? (
          <div className="space-y-2">
            <SliderRow icon={<Search className="w-3.5 h-3.5" />} label={t("ui.scale")} value={ed.logoScale} min={10} max={100} boundsMin={10} boundsMax={100}
                       onChange={ed.setLogoScale} onDoubleClick={defaultLogoScale} editingKey="scale" {...edit} />
            <SliderRow icon={<ArrowLeftRight className="w-3.5 h-3.5" />} label="X" value={ed.logoOffsetX} min={logoBounds.minX} max={logoBounds.maxX}
                       boundsMin={logoBounds.minX} boundsMax={logoBounds.maxX} onChange={ed.setLogoOffsetX} onDoubleClick={() => ed.setLogoOffsetX(0)}
                       editingKey="ox" {...edit} />
            <SliderRow icon={<ArrowUpDown className="w-3.5 h-3.5" />} label="Y" value={ed.logoOffsetY} min={logoBounds.minY} max={logoBounds.maxY}
                       boundsMin={logoBounds.minY} boundsMax={logoBounds.maxY} onChange={ed.setLogoOffsetY} onDoubleClick={() => ed.setLogoOffsetY(0)}
                       editingKey="oy" {...edit} />
          </div>
        ) : (
          <p className="text-[11px] text-zinc-500 px-1">{t("ui.logoHint")}</p>
        )}
      </div>
    </div>
  )
}
