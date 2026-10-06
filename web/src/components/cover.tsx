import { useState } from "react"
import { ListMusicIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** A playlist/album cover saved by covers.py, or a placeholder until it's downloaded. */
export function Cover({ src, alt = "", className }: { src?: string | null; alt?: string; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null)
  const ok = src && broken !== src
  return (
    <div className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground", className)}>
      {ok ? (
        <img src={src} alt={alt} loading="lazy" className="size-full object-cover" onError={() => setBroken(src)} />
      ) : (
        <ListMusicIcon className="size-1/2" aria-hidden />
      )}
    </div>
  )
}
