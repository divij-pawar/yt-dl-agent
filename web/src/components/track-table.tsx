import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export interface Column<T> {
  id: string
  header: ReactNode
  cell: (row: T, i: number) => ReactNode
  className?: string
}

/** A plain paginated table; enough for a local library of a few thousand rows. */
export function DataTable<T>({
  rows,
  columns,
  onRowClick,
  rowClassName,
  pageSize = 50,
  empty,
}: {
  rows: T[]
  columns: Column<T>[]
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string | undefined
  pageSize?: number
  empty?: ReactNode
}) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  useEffect(() => setPage(0), [rows.length])
  const shown = rows.slice(page * pageSize, (page + 1) * pageSize)

  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.id} className={c.className}>
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                {empty ?? "Nothing here."}
              </TableCell>
            </TableRow>
          )}
          {shown.map((r, i) => (
            <TableRow
              key={i}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cn(onRowClick && "cursor-pointer", rowClassName?.(r))}
            >
              {columns.map((c) => (
                <TableCell key={c.id} className={c.className}>
                  {c.cell(r, page * pageSize + i)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {pages > 1 && (
        <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {page * pageSize + 1}–{Math.min(rows.length, (page + 1) * pageSize)} of {rows.length}
          </span>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)}>
              <ChevronLeftIcon />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
              <ChevronRightIcon />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
