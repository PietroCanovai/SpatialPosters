"use client"

import { useState, useCallback, useRef } from "react"
import type { SearchResult, TMDBImage } from "./types"

/**
 * Stato della selezione nell'editor. La navigazione tra schermate è fatta
 * solo con route Next vere (/, /search, /myposters, /movie/[id], /tv/[id], …):
 * niente più "view" interne con history.pushState manuale, che facevano
 * divergere la cronologia del browser dal router (Indietro imprevedibile).
 */
export function useNavigation() {
  const [selected, setSelected] = useState<SearchResult | null>(null)
  const [previewPoster, setPreviewPoster] = useState<TMDBImage | null>(null)
  const [selectedLogo, setSelectedLogo] = useState<TMDBImage | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [posters, setPosters] = useState<TMDBImage[]>([])
  const [logos, setLogos] = useState<TMDBImage[]>([])
  const fetchIdRef = useRef(0)

  const resetState = useCallback(() => {
    ++fetchIdRef.current
    setSelected(null)
    setPreviewPoster(null)
    setSelectedLogo(null)
    setPreviewId(null)
    setPosters([])
    setLogos([])
  }, [])

  const incrementFetchId = useCallback(() => {
    return ++fetchIdRef.current
  }, [])

  return {
    selected, setSelected,
    previewPoster, setPreviewPoster,
    selectedLogo, setSelectedLogo,
    previewId, setPreviewId,
    posters, setPosters,
    logos, setLogos,
    fetchIdRef,
    incrementFetchId,
    resetState,
  }
}

/** Titolo/anno/poster del risultato cliccato, per mostrarli subito nell'editor. */
const SUMMARY_KEY = "spatialposters:item:"

export function rememberItemSummary(item: SearchResult): void {
  try { sessionStorage.setItem(`${SUMMARY_KEY}${item.media_type}:${item.id}`, JSON.stringify(item)) } catch {}
}

export function recallItemSummary(mediaType: string, id: number): SearchResult | null {
  try {
    const raw = sessionStorage.getItem(`${SUMMARY_KEY}${mediaType}:${id}`)
    return raw ? (JSON.parse(raw) as SearchResult) : null
  } catch {
    return null
  }
}

/** URL dell'editor per un titolo. */
export function editorHref(item: { id: number; media_type: string }): string {
  return `/${item.media_type === "tv" ? "tv" : "movie"}/${item.id}`
}
