import { type ReactNode } from "react"
import { FolderIcon, SquareCheckIcon, ExternalLinkIcon, UserPlusIcon, FlagIcon, CopyIcon, ArchiveIcon } from "lucide-react"

// ── Types ──

export type NavChild = {
  id: string
  label: string
  url?: string
  isActive?: boolean
}

export type NavItem = {
  id: string
  label: string
  icon: ReactNode
  url?: string
  isActive?: boolean
  children?: NavChild[]
}

export type Workspace = {
  id: string
  name: string
  tier?: string
  imageUrl?: string
}

export type Project = {
  id: string
  name: string
  progress: number
  color: string
}

export type ItemAction = {
  id: string
  label: string
  icon: ReactNode
  destructive: boolean
}

// ── Workspaces ──

export const WORKSPACES: Workspace[] = [
  {
    id: "claude",
    name: "Claude",
    tier: "Enterprise",
    imageUrl: "https://github.com/claude.png",
  },
  {
    id: "vercel",
    name: "Vercel",
    tier: "Pro",
    imageUrl: "https://github.com/vercel.png",
  },
  {
    id: "openai",
    name: "OpenAI",
    tier: "Team",
    imageUrl: "https://github.com/openai.png",
  },
]

// ── Nav Main ──

export const NAV_MAIN: NavItem[] = [
  {
    id: "projects",
    label: "Projects",
    icon: (
      <FolderIcon aria-hidden="true" />
    ),
    children: [
      { id: "cmt", label: "cmt", url: "/cmt" },
    ],
  },
  {
    id: "tasks",
    label: "My Tasks",
    icon: (
      <SquareCheckIcon aria-hidden="true" />
    ),
    url: "#",
  },
]

// ── Active Projects ──

export const ACTIVE_PROJECTS: Project[] = [
  {
    id: "design-sys",
    name: "Design System",
    progress: 72,
    color: "stroke-blue-500",
  },
]

// ── Item Actions ──

export const ITEM_ACTIONS: ItemAction[] = [
  {
    id: "open",
    label: "Open Project",
    icon: (
      <ExternalLinkIcon aria-hidden="true" />
    ),
    destructive: false,
  },
  {
    id: "assign",
    label: "Assign Members",
    icon: (
      <UserPlusIcon aria-hidden="true" />
    ),
    destructive: false,
  },
  {
    id: "milestone",
    label: "Set Milestone",
    icon: (
      <FlagIcon aria-hidden="true" />
    ),
    destructive: false,
  },
  {
    id: "duplicate",
    label: "Duplicate",
    icon: (
      <CopyIcon aria-hidden="true" />
    ),
    destructive: false,
  },
  {
    id: "archive",
    label: "Archive",
    icon: (
      <ArchiveIcon aria-hidden="true" />
    ),
    destructive: true,
  },
]

// ── Notification Types ──

export type NotificationType =
  | "mention"
  | "comment"
  | "share"
  | "invite"
  | "billing"
  | "security"
  | "feature"
  | "deployment"
  | "usage"
  | "system"
  | "task"
  | "approval"
  | "integration"
  | "achievement"
  | "feedback"
  | "team_join"
  | "reaction"
  | "review"
  | "event"

export type NotificationVariant = "info" | "success" | "warning" | "destructive"

export type NotificationAction = {
  label: string
  variant?: "default" | "outline" | "destructive"
}

export type NotificationAttachment = {
  name: string
  size: string
}

export type NotificationAvatar = {
  src: string
  fallback: string
}

export type NotificationGroupMember = {
  src: string
  fallback: string
  online?: boolean
}

export type NotificationMeta = {
  label: string
  value: string
  color?: string
}

export type Notification = {
  id: string
  type: NotificationType
  variant?: NotificationVariant
  title: string
  body?: string
  time: string
  unread?: boolean
  avatar?: NotificationAvatar
  username?: string
  link?: string
  badge?: string
  actions?: NotificationAction[]
  attachment?: NotificationAttachment
  meta?: NotificationMeta
  progress?: number
  progressVariant?: "default" | "success"
  avatarGroup?: NotificationGroupMember[]
  avatarGroupCount?: number
  rating?: number
  eventDate?: string
  eventTime?: string
}

// ── Notifications Data ──

export const NOTIFICATIONS: Notification[] = [
  {
    id: "n1",
    type: "mention",
    title: "mentioned you in",
    body: '"Can you review the changes?"',
    time: "2m ago",
    unread: false,
    avatar: {
      src: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=96&h=96&dpr=2&q=80",
      fallback: "SR",
    },
    username: "@sarah_smith",
    link: "#PR-1024",
  },
  {
    id: "n2",
    type: "approval",
    variant: "warning",
    title: "Pending approval",
    body: "Design System v2.0 release requires your approval before deployment.",
    time: "5m ago",
    unread: true,
    actions: [
      { label: "Approve", variant: "default" },
      { label: "Review", variant: "outline" },
    ],
    meta: { label: "Priority", value: "High", color: "text-warning" },
  },
  {
    id: "n3",
    type: "share",
    title: "shared",
    body: "Project Timeline",
    time: "15m ago",
    unread: true,
    avatar: {
      src: "https://images.unsplash.com/photo-1485206412256-701ccc5b93ca?w=96&h=96&dpr=2&q=80",
      fallback: "MA",
    },
    username: "@maverick",
    attachment: {
      name: "project-plan.pdf",
      size: "2mb",
    },
  },
  {
    id: "n4",
    type: "task",
    variant: "info",
    title: "Task assigned to you",
    body: "Implement user authentication flow for the mobile app.",
    time: "30m ago",
    unread: true,
    meta: { label: "Due", value: "Tomorrow", color: "text-destructive" },
  },
  {
    id: "n4b",
    type: "team_join",
    variant: "success",
    title: "4 people joined your workspace",
    body: "Sarah, Mike, Emma and James just joined ReUI Pro.",
    time: "45m ago",
    unread: true,
    avatarGroup: [
      {
        src: "https://images.unsplash.com/photo-1519699047748-de8e457a634e?w=96&h=96&dpr=2&q=80",
        fallback: "SC",
        online: true,
      },
      {
        src: "https://images.unsplash.com/photo-1584308972272-9e4e7685e80f?w=96&h=96&dpr=2&q=80",
        fallback: "MR",
      },
      {
        src: "https://images.unsplash.com/photo-1485893086445-ed75865251e0?w=96&h=96&dpr=2&q=80",
        fallback: "EW",
      },
    ],
    avatarGroupCount: 1,
  },
  {
    id: "n4c",
    type: "reaction",
    variant: "info",
    title: "Reactions on your comment",
    body: "Sarah and 2 others reacted to your comment in #design-system.",
    time: "1h ago",
    avatarGroup: [
      {
        src: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=96&h=96&dpr=2&q=80",
        fallback: "SR",
        online: true,
      },
      {
        src: "https://images.unsplash.com/photo-1485206412256-701ccc5b93ca?w=96&h=96&dpr=2&q=80",
        fallback: "MA",
      },
    ],
    avatarGroupCount: 1,
    badge: "👍 5",
  },
  {
    id: "n4d",
    type: "review",
    variant: "success",
    title: "New review received",
    body: "Emma left a review on Design System v2.0.",
    time: "2h ago",
    avatar: {
      src: "https://images.unsplash.com/photo-1485893086445-ed75865251e0?w=96&h=96&dpr=2&q=80",
      fallback: "EW",
    },
    username: "@emma",
    rating: 4,
  },
  {
    id: "n4e",
    type: "event",
    variant: "info",
    title: "Upcoming event reminder",
    body: "Design system review with the product team.",
    time: "3h ago",
    unread: true,
    eventDate: "Mar 3, 2026",
    eventTime: "10:00 to 11:00 AM",
    meta: { label: "Where", value: "Google Meet", color: "text-info" },
    actions: [
      { label: "Join", variant: "default" },
      { label: "Decline", variant: "outline" },
    ],
  },
  {
    id: "n5",
    type: "invite",
    variant: "info",
    title: "Team Invitation",
    body: "Alex invited you to join ReUI Pro.",
    time: "1h ago",
    unread: false,
    actions: [
      { label: "Accept", variant: "default" },
      { label: "Decline", variant: "outline" },
    ],
  },
  {
    id: "n6",
    type: "integration",
    variant: "success",
    title: "Slack connected",
    body: "Your Slack workspace is now synced with notifications.",
    time: "2h ago",
  },
  {
    id: "n7",
    type: "billing",
    variant: "info",
    title: "Payment processed",
    body: "Your monthly subscription was renewed.",
    time: "3h ago",
    badge: "$49.00",
  },
  {
    id: "n8",
    type: "achievement",
    variant: "success",
    title: "Monthly milestone reached!",
    body: "100 of 100 tasks completed this month. Outstanding work!",
    time: "4h ago",
    progress: 100,
    progressVariant: "success",
    meta: { label: "Goal", value: "100 tasks", color: "text-success" },
  },
  {
    id: "n9",
    type: "security",
    variant: "destructive",
    title: "New sign-in detected",
    body: "We noticed a new login from Mac OS, Chrome.",
    time: "Yesterday",
  },
  {
    id: "n10",
    type: "feedback",
    variant: "info",
    title: "Feedback requested",
    body: "How was your experience with the new dashboard?",
    time: "Yesterday",
    actions: [
      { label: "Rate", variant: "default" },
      { label: "Later", variant: "outline" },
    ],
  },
  {
    id: "n11",
    type: "feature",
    variant: "warning",
    title: "Introducing AI Copilot",
    body: "Generate code, fix bugs, and write tests faster with our new AI assistant.",
    time: "2 days ago",
  },
  {
    id: "n12",
    type: "comment",
    variant: "info",
    title: "New comment on Issue #84",
    body: '"I think we should prioritize this for the next sprint..."',
    time: "3 days ago",
  },
  {
    id: "n13",
    type: "deployment",
    variant: "success",
    title: "Deployment successful",
    body: "Production branch deployed to Vercel.",
    time: "4 days ago",
    meta: { label: "Env", value: "Production", color: "text-success" },
  },
  {
    id: "n14",
    type: "usage",
    variant: "warning",
    title: "API usage at 80%",
    body: "You've used 80% of your monthly API quota.",
    time: "5 days ago",
    progress: 80,
  },
  {
    id: "n15",
    type: "system",
    variant: "info",
    title: "Scheduled maintenance",
    body: "We'll be performing maintenance on Feb 28, 2026 at 2:00 AM UTC.",
    time: "1 week ago",
  },
]