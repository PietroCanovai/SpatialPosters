// Hook di avvio del server Next.js: applica a process.env le chiavi provider
// salvate dalla UI (vedi lib/provider-keys.ts) prima che arrivi qualsiasi
// richiesta.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { applyProviderKeys } = await import("@/lib/provider-keys")
  applyProviderKeys()
}
