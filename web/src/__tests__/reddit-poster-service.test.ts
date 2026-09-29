import { describe, it, expect, vi } from "vitest"
import { fetchRedditPosters } from "@/lib/reddit-poster-service"

// We mock the fetch API to not actually hit Reddit during automated tests
// but you can comment out the mock to test it for real!
describe("Reddit Poster Service", () => {
  it("should return an empty array if fetch fails gracefully", async () => {
    // Mock fetch to fail
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      statusText: "Internal Server Error"
    })
    
    const posters = await fetchRedditPosters("550")
    expect(posters).toEqual([]) // Graceful fallback
  })

  it("should parse the Reddit RSS feed correctly", async () => {
    // Il servizio usa il feed Atom/RSS (search.rss), non l'API JSON.
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <entry>
    <author><name>/u/testuser</name></author>
    <id>t3_test1</id>
    <title>Fight Club (1999) Clean [TMDB: 550]</title>
    <content type="html">&lt;a href=&quot;https://i.redd.it/test.jpg&quot;&gt;[link]&lt;/a&gt;</content>
  </entry>
  <entry>
    <author><name>/u/testuser2</name></author>
    <id>t3_test2</id>
    <title>Just a text post [TMDB: 550]</title>
    <content type="html">no image here</content>
  </entry>
  <entry>
    <author><name>/u/testuser3</name></author>
    <id>t3_test3</id>
    <title>Other movie [TMDB: 5501]</title>
    <content type="html">&lt;a href=&quot;https://i.redd.it/other.jpg&quot;&gt;[link]&lt;/a&gt;</content>
  </entry>
</feed>`

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => rss
    })

    const posters = await fetchRedditPosters("550", true)

    // Only the image post tagged with exactly this TMDB id
    expect(posters.length).toBe(1)
    expect(posters[0].id).toBe("t3_test1")
    expect(posters[0].url).toBe("https://i.redd.it/test.jpg")
    expect(posters[0].author).toBe("testuser")
    expect(posters[0].flair).toBe("Clean Poster")
  })
})
