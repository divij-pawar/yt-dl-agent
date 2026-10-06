import { useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { linkJob, requeueJob } from "./api"
import { useQueue } from "./queue"
import type { Requeue } from "./types"

export interface RetryTarget {
  name: string
  requeue: Requeue | null
}

/** Queue collections again. Only songs that are missing or failed get downloaded; the rest are reused. */
export function useRequeue() {
  const { enqueue } = useQueue()
  const navigate = useNavigate()

  const retry = useCallback(
    async (targets: RetryTarget[], what = "Retrying") => {
      const ok = targets.filter((t): t is { name: string; requeue: Requeue } => !!t.requeue)
      const unique = [...new Map(ok.map((t) => [JSON.stringify(t.requeue), t])).values()]
      if (!unique.length) return
      await enqueue(unique.map((t) => requeueJob(t.requeue, t.name)))
      toast.success(unique.length === 1 ? `${what}: ${unique[0].name}` : `${what}: ${unique.length} playlists & albums`, {
        description: "Only songs that are missing or failed are downloaded.",
        action: { label: "View queue", onClick: () => navigate("/") },
      })
    },
    [enqueue, navigate],
  )

  /** Just one song, by its Spotify track ID. */
  const retrySong = useCallback(
    async (trackId: string, title: string) => {
      await enqueue([linkJob("track", trackId, title)])
      toast.success(`Queued “${title}”`, { action: { label: "View queue", onClick: () => navigate("/") } })
    },
    [enqueue, navigate],
  )

  return { retry, retrySong }
}
