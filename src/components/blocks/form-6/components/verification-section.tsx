import { type ReactNode } from "react"
import { Badge, type BadgeProps } from "@/components/reui/badge"
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { InfoIcon } from "lucide-react"

export type InfoRowItem = {
  label: string
  value: ReactNode
  labelHint?: string
  valueHint?: string
}

function RowHint({ label, children }: { label: string; children: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label={label}
          />
        }
      >
        <InfoIcon aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-xs leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

export function VerificationSection({
  title,
  description,
  action,
  children,
}: {
  title: string
  description: string
  action: ReactNode
  children: ReactNode
}) {
  return (
    <Frame stacked spacing="sm" className="w-full">
      <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <FrameTitle>{title}</FrameTitle>
          <FrameDescription className="truncate">
            {description}
          </FrameDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      </FrameHeader>

      <FramePanel className="p-0">{children}</FramePanel>
    </Frame>
  )
}

export function PanelHeading({
  title,
  description,
  badge,
  badgeIcon,
  badgeVariant = "success-light",
}: {
  title: string
  description?: string
  badge?: string
  badgeIcon?: ReactNode
  badgeVariant?: BadgeProps["variant"]
}) {
  return (
    <>
      <div className="flex min-w-0 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-medium">{title}</p>
          {description ? (
            <p className="text-muted-foreground truncate text-sm">
              {description}
            </p>
          ) : null}
        </div>
        {badge ? (
          <Badge variant={badgeVariant} className="self-start sm:self-center">
            {badgeIcon}
            {badge}
          </Badge>
        ) : null}
      </div>
      <Separator />
    </>
  )
}

export function InfoRows({ rows }: { rows: InfoRowItem[] }) {
  return (
    <dl className="flex flex-col">
      {rows.map((row, index) => (
        <div key={row.label}>
          <div className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:gap-5">
            <dt className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-sm">
              <span className="min-w-0 truncate">{row.label}</span>
              {row.labelHint ? (
                <RowHint label={`${row.label} info`}>{row.labelHint}</RowHint>
              ) : null}
            </dt>
            <dd className="text-foreground flex min-w-0 items-center gap-1.5 text-sm leading-6">
              <span className="min-w-0">{row.value}</span>
              {row.valueHint ? (
                <RowHint label={`${row.label} value info`}>
                  {row.valueHint}
                </RowHint>
              ) : null}
            </dd>
          </div>
          {index < rows.length - 1 ? <Separator /> : null}
        </div>
      ))}
    </dl>
  )
}

export function StackedValue({ values }: { values: string[] }) {
  return (
    <span className="flex min-w-0 flex-col">
      {values.map((value) => (
        <span key={value} className="min-w-0 truncate">
          {value}
        </span>
      ))}
    </span>
  )
}