"use client"

import { useEffect } from "react"

/**
 * Le righe orizzontali scorrevoli (.scroll-fade-mask) sfumano i bordi solo
 * dove c'è davvero contenuto nascosto: prima la sfumatura era fissa e faceva
 * sembrare scorrevoli righe che non lo erano. Imposta data-fade-left/right in
 * base allo scroll reale; il CSS applica la maschera solo su quei lati.
 */
export function ScrollFadeManager() {
  useEffect(() => {
    const update = (el: HTMLElement) => {
      const max = el.scrollWidth - el.clientWidth
      const left = max > 1 && el.scrollLeft > 1
      const right = max > 1 && el.scrollLeft < max - 1
      if ((el.dataset.fadeLeft === "1") !== left) el.dataset.fadeLeft = left ? "1" : "0"
      if ((el.dataset.fadeRight === "1") !== right) el.dataset.fadeRight = right ? "1" : "0"
    }
    const observed = new WeakSet<HTMLElement>()
    const resize = new ResizeObserver((entries) => entries.forEach((e) => update(e.target as HTMLElement)))
    const scan = () => {
      document.querySelectorAll<HTMLElement>(".scroll-fade-mask").forEach((el) => {
        if (!observed.has(el)) {
          observed.add(el)
          resize.observe(el)
          // Anche i figli cambiano scrollWidth senza ridimensionare il contenitore.
          Array.from(el.children).forEach((c) => resize.observe(c))
        }
        update(el)
      })
    }
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement
      if (el instanceof HTMLElement && el.classList.contains("scroll-fade-mask")) update(el)
    }
    let pending = false
    const mutations = new MutationObserver(() => {
      if (pending) return
      pending = true
      requestAnimationFrame(() => { pending = false; scan() })
    })
    scan()
    mutations.observe(document.body, { childList: true, subtree: true })
    document.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", scan)
    return () => {
      mutations.disconnect()
      resize.disconnect()
      document.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", scan)
    }
  }, [])
  return null
}
