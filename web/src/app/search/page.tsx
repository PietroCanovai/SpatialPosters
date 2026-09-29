"use client"

import { Suspense } from "react"
import { PictoriumRoot } from "@/lib/context"
import { AppShell } from "@/components/AppShell"
import { SearchView } from "@/components/SearchView"
import { BackButton } from "@/components/BackButton"

export default function SearchPage() {
  return (
    <PictoriumRoot>
      <AppShell>
        <div className="mb-4"><BackButton /></div>
        {/* useSearchParams richiede un confine Suspense nelle pagine prerenderizzate */}
        <Suspense>
          <SearchView />
        </Suspense>
      </AppShell>
    </PictoriumRoot>
  )
}
