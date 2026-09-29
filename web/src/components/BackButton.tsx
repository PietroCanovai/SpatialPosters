"use client"

import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"

/**
 * Torna alla pagina precedente della cronologia (come il tasto Indietro del
 * mouse). Solo se non c'è cronologia in-app, ad esempio all'avvio, va alla home.
 */
export function BackButton({ className = "" }: { className?: string }) {
  const router = useRouter()
  const { t } = useT()
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back()
        else router.push("/")
      }}
      className={`inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-zinc-300 hover:text-white transition-colors bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 px-3.5 py-2 rounded-xl cursor-pointer shadow-sm active:scale-95 ${className}`}
    >
      <ArrowLeft className="w-4 h-4" />
      <span>{t("ui.back") || "Back"}</span>
    </button>
  )
}
