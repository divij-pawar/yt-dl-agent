import { CheckCircle2Icon, CopyIcon, WandSparklesIcon } from "lucide-react"
import { NavLink } from "react-router-dom"
import { toast } from "sonner"
import { Page } from "@/components/page"
import { DataTable } from "@/components/track-table"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { splitSuggestion, when } from "@/lib/format"
import { useLoad } from "@/lib/hooks"

/** songs/_Unsorted/ and .cache/unsorted.json: imports with no confident match. */
export function UnsortedPage() {
  const { data, loading } = useLoad(() => api.unsorted())

  return (
    <Page
      title="Unsorted"
      help="import"
      description="Imported files that couldn't be matched confidently. They sit in songs/_Unsorted/. Fix a file's tags or rename it to “Artist - Title”, then run Fix library to retry them all."
      actions={
        <Button render={<NavLink to="/fix" />} disabled={!data?.length}>
          <WandSparklesIcon />
          Retry with Fix library
        </Button>
      }
    >
      {loading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !data?.length ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckCircle2Icon />
            </EmptyMedia>
            <EmptyTitle>Nothing unsorted</EmptyTitle>
            <EmptyDescription>Every imported file found its place in the library.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <DataTable
          rows={data}
          columns={[
            {
              id: "file",
              header: "File",
              cell: (u) => (
                <div className="min-w-0 space-y-0.5">
                  <div className="truncate font-medium">{u.path.replace(/^_Unsorted\//, "")}</div>
                  <div className="truncate text-xs text-muted-foreground" title={u.src}>
                    from {u.src}
                  </div>
                </div>
              ),
              className: "max-w-64",
            },
            {
              id: "why",
              header: "Why",
              cell: (u) => {
                const [text, url] = splitSuggestion(u.suggestion)
                const tried = u.guesses.filter(([a]) => a).map(([a, t]) => `${a} - ${t}`)
                return (
                  <div className="space-y-1 whitespace-normal text-xs">
                    <div className="text-warning">{u.reason}</div>
                    {u.suggestion && (
                      <div>
                        Maybe:{" "}
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                            {text}
                          </a>
                        ) : (
                          text
                        )}
                      </div>
                    )}
                    {tried.length > 0 && <div className="text-muted-foreground">Tried: {tried.join("; ")}</div>}
                  </div>
                )
              },
            },
            { id: "when", header: "Added", cell: (u) => <span className="text-xs text-muted-foreground">{when(u.when)}</span>, className: "hidden w-28 md:table-cell" },
            {
              id: "copy",
              header: <span className="sr-only">Copy path</span>,
              cell: (u) => (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Copy path"
                  onClick={() => navigator.clipboard.writeText(`songs/${u.path}`).then(() => toast("Path copied"))}
                >
                  <CopyIcon />
                </Button>
              ),
              className: "w-12",
            },
          ]}
        />
      )}
    </Page>
  )
}
