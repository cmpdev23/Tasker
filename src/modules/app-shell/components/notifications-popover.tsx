"use client"

import type { ReactNode } from "react"
import { Badge } from "@/components/reui/badge"
import { Rating } from "@/components/reui/rating"

import { cn } from "@/lib/utils"
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  NOTIFICATIONS,
  type Notification,
  type NotificationGroupMember,
  type NotificationType,
  type NotificationVariant,
} from "./data"
import { MessageSquareIcon, PaperclipIcon, UserPlusIcon, CreditCardIcon, ShieldAlertIcon, SparklesIcon, RocketIcon, ActivityIcon, AlertCircleIcon, CircleCheckIcon, LinkIcon, StarIcon, ThumbsUpIcon, UsersIcon, SmileIcon, CalendarIcon, DownloadIcon, CheckCheckIcon, BellIcon } from "lucide-react"

const NOTIFICATION_ICONS: Record<NotificationType, ReactNode> = {
  mention: (
    <MessageSquareIcon aria-hidden="true" />
  ),
  comment: (
    <MessageSquareIcon aria-hidden="true" />
  ),
  share: (
    <PaperclipIcon aria-hidden="true" />
  ),
  invite: (
    <UserPlusIcon aria-hidden="true" />
  ),
  billing: (
    <CreditCardIcon aria-hidden="true" />
  ),
  security: (
    <ShieldAlertIcon aria-hidden="true" />
  ),
  feature: (
    <SparklesIcon aria-hidden="true" />
  ),
  deployment: (
    <RocketIcon aria-hidden="true" />
  ),
  usage: (
    <ActivityIcon aria-hidden="true" />
  ),
  system: (
    <AlertCircleIcon aria-hidden="true" />
  ),
  task: (
    <CircleCheckIcon aria-hidden="true" />
  ),
  approval: (
    <CircleCheckIcon aria-hidden="true" />
  ),
  integration: (
    <LinkIcon aria-hidden="true" />
  ),
  achievement: (
    <StarIcon aria-hidden="true" />
  ),
  feedback: (
    <ThumbsUpIcon aria-hidden="true" />
  ),
  team_join: (
    <UsersIcon aria-hidden="true" />
  ),
  reaction: (
    <SmileIcon aria-hidden="true" />
  ),
  review: (
    <StarIcon aria-hidden="true" />
  ),
  event: (
    <CalendarIcon aria-hidden="true" />
  ),
}

const VARIANT_COLORS: Record<NotificationVariant, string> = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
}

// ── Notification Avatar Group ──

function NotifAvatarGroup({
  members,
  count,
}: {
  members: NotificationGroupMember[]
  count?: number
}) {
  return (
    <AvatarGroup className="mt-1.5 -space-x-1">
      {members.map((m) => (
        <Avatar key={m.src} className="size-5">
          <AvatarImage src={m.src} alt={m.fallback} />
          <AvatarFallback className="text-[9px]">{m.fallback}</AvatarFallback>
        </Avatar>
      ))}
      {count && count > 0 ? (
        <AvatarGroupCount className="size-5 text-[9px] leading-none">
          +{count}
        </AvatarGroupCount>
      ) : null}
    </AvatarGroup>
  )
}

// ── Segmented Meta Badge ──

function MetaBadge({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: string
}) {
  return (
    <span className="border-border/60 inline-flex h-[18px] shrink-0 items-center overflow-hidden rounded-sm border text-[10px] font-medium">
      <span className="bg-muted/60 text-muted-foreground border-border/50 flex h-full items-center border-r px-1.5 leading-none">
        {label}
      </span>
      <span
        className={cn(
          "flex h-full items-center px-1.5 leading-none",
          color || "text-foreground"
        )}
      >
        {value}
      </span>
    </span>
  )
}

// ── Mini Progress Bar ──

function MiniProgress({
  value,
  variant = "default",
}: {
  value: number
  variant?: "default" | "success"
}) {
  const indicatorColor =
    variant === "success"
      ? "**:data-[slot=progress-indicator]:bg-success"
      : value >= 80
        ? "**:data-[slot=progress-indicator]:bg-warning"
        : "**:data-[slot=progress-indicator]:bg-primary"

  return (
    <div className="bg-muted/55 relative mt-1.5 h-1 overflow-hidden rounded-full">
      <div
        className="text-muted-foreground pointer-events-none absolute inset-0 opacity-20"
        aria-hidden="true"
        style={{
          backgroundImage:
            "repeating-linear-gradient(-45deg, currentColor 0, currentColor 1px, transparent 0, transparent 4px)",
        }}
      />
      <Progress
        value={value}
        className={cn(
          "absolute inset-0 gap-0",
          "**:data-[slot=progress-track]:h-full **:data-[slot=progress-track]:rounded-none **:data-[slot=progress-track]:bg-transparent",
          "**:data-[slot=progress-indicator]:rounded-none",
          indicatorColor
        )}
      />
    </div>
  )
}

// ── Notification Item ──

function NotificationItem({ notification }: { notification: Notification }) {
  const {
    type,
    variant = "info",
    title,
    body,
    time,
    unread,
    avatar,
    username,
    link,
    badge,
    actions,
    attachment,
    meta,
    progress,
    avatarGroup,
    avatarGroupCount,
    rating,
    eventDate,
    eventTime,
    progressVariant,
  } = notification

  const iconColor = VARIANT_COLORS[variant]
  const hasAvatar = Boolean(avatar)
  const hasActions = Boolean(actions?.length)
  const hasInteractiveChildren = hasActions || Boolean(attachment)

  const content = (
    <>
      {/* Left column: Avatar or Icon */}
      <div className="shrink-0">
        {hasAvatar ? (
          <Avatar size="sm">
            <AvatarImage src={avatar?.src} alt={avatar?.fallback} />
            <AvatarFallback>{avatar?.fallback}</AvatarFallback>
          </Avatar>
        ) : (
          <div
            className={cn(
              "flex size-6 items-center justify-center [&_svg]:size-4",
              iconColor
            )}
          >
            {NOTIFICATION_ICONS[type]}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-1">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2">
          <p className="text-foreground text-xs leading-snug">
            {username && (
              <span className="text-primary font-medium">{username}</span>
            )}{" "}
            {hasAvatar ? (
              <>
                {title}{" "}
                {link && (
                  <span className="text-primary font-medium">{link}</span>
                )}
              </>
            ) : (
              <span className="font-medium">{title}</span>
            )}
          </p>
          {badge && (
            <Badge tone="outline">
              {badge}
            </Badge>
          )}
        </div>

        {/* Body */}
        {body && (
          <p className="text-muted-foreground line-clamp-2 text-xs">{body}</p>
        )}

        {/* Avatar group */}
        {avatarGroup && avatarGroup.length > 0 && (
          <NotifAvatarGroup members={avatarGroup} count={avatarGroupCount} />
        )}

        {/* Star rating */}
        {rating !== undefined && (
          <Rating rating={rating} size="sm" className="mt-0.5" />
        )}

        {/* Event date/time chip */}
        {(eventDate || eventTime) && (
          <div className="bg-muted/50 border-border/50 text-muted-foreground mt-1 inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px]">
            <CalendarIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
            {eventDate && (
              <span className="text-foreground font-medium">{eventDate}</span>
            )}
            {eventTime && <span className="opacity-70">{eventTime}</span>}
          </div>
        )}

        {/* Progress bar */}
        {progress !== undefined && (
          <MiniProgress value={progress} variant={progressVariant} />
        )}

        {/* Attachment */}
        {attachment && (
          <div className="flex items-center gap-1 py-1">
            <ButtonGroup>
              <Button variant="outline" size="xs">
                <PaperclipIcon aria-hidden="true" />
                {attachment.name}
                <span className="opacity-60">({attachment.size})</span>
              </Button>
              <Button variant="outline" size="icon-xs" aria-label="Download">
                <DownloadIcon aria-hidden="true" />
              </Button>
            </ButtonGroup>
          </div>
        )}

        {/* Actions */}
        {hasActions && (
          <div className="flex items-center gap-1 py-1">
            {actions?.map((action) => (
              <Button
                key={action.label}
                size="xs"
                variant={action.variant === "outline" ? "outline" : "default"}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}

        {/* Timestamp + Meta badge on the same line */}
        <div className="flex items-center gap-2 pt-0.5">
          <p className="text-muted-foreground text-[11px]">{time}</p>
          {meta && (
            <MetaBadge
              label={meta.label}
              value={meta.value}
              color={meta.color}
            />
          )}
        </div>
      </div>
    </>
  )

  return (
    <div className="relative">
      {/* Unread indicator: top-right dot on the row */}
      {unread && (
        <span
          className="bg-primary ring-background pointer-events-none absolute top-3 right-3 z-10 size-1.5 rounded-full ring-1"
          aria-hidden="true"
        />
      )}
      {hasInteractiveChildren ? (
        <div className="flex w-full items-start gap-2 p-2 text-left">
          {content}
        </div>
      ) : (
        <Button
          variant="ghost"
          className="h-auto w-full items-start justify-start rounded-none p-2 text-left whitespace-normal"
        >
          {content}
        </Button>
      )}
    </div>
  )
}

// ── Notifications Panel ──

function NotificationsPanel() {
  const unreadCount = NOTIFICATIONS.filter((n) => n.unread).length

  return (
    <>
      {/* Header */}
      <div className="border-border/40 flex items-center justify-between border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <Badge>
              {unreadCount}
            </Badge>
          )}
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="opacity-60 hover:opacity-100"
                  aria-label="Mark all as read"
                />
              }
            >
              <CheckCheckIcon className="size-3.5" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>Mark all as read</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Content */}
      <div className="relative flex max-h-full">
        <ScrollArea className="max-h-[320px] grow">
          {NOTIFICATIONS.map((notification, index) => (
            <div key={notification.id}>
              <NotificationItem notification={notification} />
              {index < NOTIFICATIONS.length - 1 && (
                <Separator className="opacity-60" />
              )}
            </div>
          ))}
        </ScrollArea>
      </div>

      {/* Footer */}
      <div className="border-border/60 border-t px-2 py-1">
        <Button variant="ghost" size="sm" className="w-full text-xs">
          View all notifications
        </Button>
      </div>
    </>
  )
}

// ── Notifications Popover ──

export function NotificationsPopover() {
  const hasUnread = NOTIFICATIONS.some((n) => n.unread)

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Open notifications"
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Notifications"
            className="relative [&_svg]:opacity-60 [&_svg]:hover:opacity-100"
          />
        }
      >
        <BellIcon aria-hidden="true" />
        {hasUnread && (
          <span
            className="bg-primary absolute top-0.5 right-1 size-1.5 rounded-full"
            aria-hidden="true"
          />
        )}
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className="w-80 gap-0 p-0"
      >
        <NotificationsPanel />
      </PopoverContent>
    </Popover>
  )
}
