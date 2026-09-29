"use client"

import React, { useEffect } from "react"
import { PictoriumRoot, usePSelector } from "@/lib/context"
import { AppShell } from "@/components/AppShell"
import EditView from "@/components/EditView"
import { recallItemSummary } from "@/lib/useNavigation"
import { useT } from "@/lib/contexts/TranslationContext"
import { BladeSpinner } from "@/components/ui/BladeSpinner"

interface PosterEditorContainerProps {
  id: number
  mediaType: "movie" | "tv"
}

function PosterEditorContent({ id, mediaType }: PosterEditorContainerProps) {
  const { t } = useT()
  const selected = usePSelector((v) => v.selected)
  const openPoster = usePSelector((v) => v.openPoster)
  const mappingsLoaded = usePSelector((v) => v.mappingsLoaded)

  // La route definisce il titolo: caricalo nell'editor (riusando titolo/anno
  // del risultato cliccato, se disponibili, per mostrarli subito).
  useEffect(() => {
    // Aspetta i design salvati: senza, il titolo si aprirebbe con i default.
    if (!mappingsLoaded) return
    if (selected && selected.id === id && selected.media_type === mediaType) return
    const summary = recallItemSummary(mediaType, id)
    openPoster(summary ?? { id, media_type: mediaType, title: "", poster_path: null })
  }, [id, mediaType, selected, openPoster, mappingsLoaded])

  if (!selected || selected.id !== id) {
    return (
      <div className="h-96 flex flex-col items-center justify-center gap-3 text-zinc-400">
        <BladeSpinner size="24px" />
        <span className="text-xs font-medium animate-pulse">{t("ui.loadingPoster") || "Loading…"}</span>
      </div>
    )
  }
  return <EditView />
}

export function PosterEditorContainer(props: PosterEditorContainerProps) {
  return (
    <PictoriumRoot>
      <AppShell wide>
        <PosterEditorContent {...props} />
      </AppShell>
    </PictoriumRoot>
  )
}
