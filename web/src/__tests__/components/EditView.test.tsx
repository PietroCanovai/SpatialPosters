import { describe, it, expect } from "vitest"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import EditView from "@/components/EditView"
import { HomeView } from "@/components/HomeView"
import { renderWithCtx } from "@/__tests__/test-utils"
import type { SearchResult, TMDBImage } from "@/lib/types"

const mockSelected: SearchResult = {
  id: 550,
  media_type: "movie",
  title: "Fight Club",
  name: "",
  poster_path: "/fc.jpg",
  release_date: "1999-10-15",
}
const clean: TMDBImage = { file_path: "/clean.jpg", iso_639_1: null, vote_average: 0, width: 2000, height: 3000 }

describe("HomeView", () => {
  it("shows the search bar", () => {
    renderWithCtx(<HomeView />)
    expect(screen.getByPlaceholderText("ui.searchPlaceholderLarge")).toBeInTheDocument()
  })

  it("asks for a TMDB key when none is set", () => {
    renderWithCtx(<HomeView />, { tmdbKey: "" })
    expect(screen.getByText("ui.noKey")).toBeInTheDocument()
  })

  it("has no Stremio or animated branding", () => {
    const { container } = renderWithCtx(<HomeView />)
    expect(container.textContent).not.toMatch(/stremio|compatible platforms|enhance your poster/i)
  })
})

describe("EditView", () => {
  it("renders nothing without a selected title", () => {
    const { container } = renderWithCtx(<EditView />)
    expect(container).toBeEmptyDOMElement()
  })

  it("shows the title, the live preview and a single Send to Jellyfin action", () => {
    renderWithCtx(<EditView />, { selected: mockSelected, previewPoster: clean })
    expect(screen.getByText("Fight Club")).toBeInTheDocument()
    expect(screen.getAllByText("ui.previewLive")[0]).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /send to jellyfin/i })).toBeEnabled()
    expect(screen.queryByText("ui.savePoster")).not.toBeInTheDocument()
    expect(screen.queryByText("ui.testUrl")).not.toBeInTheDocument()
  })

  it("can send even before a poster is picked (the server picks the best one, as in the preview)", () => {
    renderWithCtx(<EditView />, { selected: mockSelected })
    expect(screen.getByRole("button", { name: /send to jellyfin/i })).toBeEnabled()
  })

  it("shows the image size on poster tiles", () => {
    renderWithCtx(<EditView />, { selected: mockSelected, posters: [clean], previewPoster: clean })
    expect(screen.getAllByText("2000×3000")[0]).toBeInTheDocument()
  })

  it("offers the transform tab (poster zoom) even without a logo", async () => {
    const u = userEvent.setup()
    renderWithCtx(<EditView />, { selected: mockSelected, posters: [clean], previewPoster: clean })
    const tab = screen.getByRole("button", { name: "ui.transform" })
    await u.click(tab)
    expect(tab).toHaveClass("tab-chip-active")
    expect(screen.getByText("Zoom in to move the poster.")).toBeInTheDocument()
  })
})
