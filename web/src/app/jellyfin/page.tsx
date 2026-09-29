"use client"

import { PictoriumRoot } from "@/lib/context"
import { AppShell } from "@/components/AppShell"
import { JellyfinView } from "@/components/JellyfinView"

export default function JellyfinPage() {
  return (
    <PictoriumRoot>
      <AppShell>
        <JellyfinView />
      </AppShell>
    </PictoriumRoot>
  )
}
