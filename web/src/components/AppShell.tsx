"use client"

import { useState, useEffect, useCallback, type CSSProperties, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { LangPicker } from "@/components/LangPicker"
import { ToastProvider } from "@/components/Toast"
import { AmbientBackground } from "@/components/AmbientBackground"
import { DesktopSidebar } from "@/components/DesktopSidebar"

const OnboardingTour = dynamic(() => import("@/components/OnboardingTour").then((m) => m.OnboardingTour), { ssr: false })
const PinLockModal = dynamic(() => import("@/components/PinLockModal").then((m) => m.PinLockModal), { ssr: false })

/**
 * Cornice comune a tutte le pagine (home, ricerca, editor, Jellyfin, impostazioni):
 * sidebar, sfondo, scelta lingua al primo avvio e blocco PIN. Ogni schermata è
 * una route vera, così Indietro/Avanti (anche i tasti del mouse) seguono la
 * cronologia reale.
 */
export function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const accentColor = usePSelector((v) => v.accentColor || v.autoAccentColor)
  const serviceErrors = usePSelector((v) => v.serviceErrors)
  const showLangPicker = usePSelector((v) => v.showLangPicker)
  const setShowLangPicker = usePSelector((v) => v.setShowLangPicker)
  const { t, pickLang } = useT()
  const ed = usePosterEditor()

  // Le schermate dipendono da stato solo-client (localStorage, sessionStorage,
  // chiavi caricate in modo asincrono): renderizzarle anche sul server produceva
  // errori di hydration. App desktop dietro uno splash: basta il render client.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const [hasPinConfigured, setHasPinConfigured] = useState<boolean | null>(null)
  const [isUnlocked, setIsUnlocked] = useState(false)

  const checkPinStatus = useCallback(() => {
    fetch("/api/auth/pin")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.hasPin === "boolean") {
          setHasPinConfigured(data.hasPin)
          if (typeof data.authenticated === "boolean") setIsUnlocked(data.authenticated)
        }
      })
      .catch(() => null)
  }, [])

  useEffect(() => {
    checkPinStatus()
    const handlePinChange = (e: Event) => {
      const custom = e as CustomEvent<{ unlocked?: boolean }>
      if (custom.detail?.unlocked) setIsUnlocked(true)
      checkPinStatus()
    }
    window.addEventListener("spatialposters:pin-change", handlePinChange)
    return () => window.removeEventListener("spatialposters:pin-change", handlePinChange)
  }, [checkPinStatus])

  if (!mounted) return <div className="app-shell min-h-screen" />

  return (
    <>
      <ToastProvider>
        <div className="app-shell text-foreground relative overflow-x-hidden min-h-screen" style={{ "--bg-accent": accentColor ?? undefined } as CSSProperties}>
          <AmbientBackground />
          {serviceErrors.tmdb && (
            <div className="mx-auto max-w-lg mt-2 mb-0 px-4 py-2 bg-red-900/40 border border-red-800/50 rounded-xl text-xs text-red-300 text-center">
              {t("ui.statusTmdbUnavailable")}
            </div>
          )}
          {showLangPicker && (
            <LangPicker
              onPickLang={pickLang}
              onPickRegion={(regionCode) => { ed.setDefaultRegion(regionCode); ed.setRegion(regionCode) }}
              onDone={() => setShowLangPicker(false)}
            />
          )}
          <DesktopSidebar />
          <div className={`relative z-10 mx-auto pl-24 pr-6 ${wide ? "max-w-[1760px] pt-5 pb-6" : "max-w-[1680px] pt-8 pb-10"}`}>
            {children}
          </div>
        </div>
      </ToastProvider>
      {!showLangPicker && <OnboardingTour />}
      {hasPinConfigured && !isUnlocked && !showLangPicker && (
        <PinLockModal onSuccess={() => setIsUnlocked(true)} />
      )}
    </>
  )
}
