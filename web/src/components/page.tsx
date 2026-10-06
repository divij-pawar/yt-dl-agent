import type { ReactNode } from "react"
import { CircleHelpIcon } from "lucide-react"
import { NavLink } from "react-router-dom"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/** Every page: header with breadcrumb, then a title row with the page's primary actions.
 *  help: a section id on the Help page, shown as a (?) next to the title. */
export function Page({
  title,
  description,
  actions,
  help,
  crumb,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  help?: string
  crumb?: string
  children: ReactNode
  className?: string
}) {
  return (
    <>
      <SiteHeader crumb={crumb} />
      <div className={cn("mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 md:p-6", className)}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-1">
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              {help && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button variant="ghost" size="icon-sm" aria-label="Help for this page" render={<NavLink to={`/help#${help}`} />} />
                    }
                  >
                    <CircleHelpIcon className="text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>How this works</TooltipContent>
                </Tooltip>
              )}
            </div>
            {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </>
  )
}
