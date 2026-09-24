"use client"

import { useState, useSyncExternalStore } from "react"
import { useTheme } from "next-themes"

import { cn } from "@/lib/utils"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { WORKSPACES, type Workspace } from "./data"
import { SunIcon, MoonIcon, MonitorIcon, PaletteIcon, CheckIcon, MoreHorizontalIcon, PlusIcon, UserIcon, CreditCardIcon, SettingsIcon, LogOutIcon } from "lucide-react"

// ── Constants ──

const THEMES = [
  {
    value: "light",
    label: "Light",
    icon: (
      <SunIcon className="size-3.5" aria-hidden="true" />
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <MoonIcon className="size-3.5" aria-hidden="true" />
    ),
  },
  {
    value: "system",
    label: "System",
    icon: (
      <MonitorIcon className="size-3.5" aria-hidden="true" />
    ),
  },
]

const subscribeToNothing = () => () => {}
const getClientMountState = () => true
const getServerMountState = () => false

// ── Theme Toggle ──

function ThemeMenuItem() {
  const { theme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    getClientMountState,
    getServerMountState
  )

  const currentTheme = mounted ? (theme ?? "system") : "system"
  const currentIndex = Math.max(
    0,
    THEMES.findIndex((t) => t.value === currentTheme)
  )
  const nextTheme = THEMES[(currentIndex + 1) % THEMES.length]

  return (
    <DropdownMenuItem
      closeOnClick={false}
      label="Theme"
      onClick={() => setTheme(nextTheme.value)}
    >
      <PaletteIcon aria-hidden="true" />
      Theme
      <span className="sr-only">
        {THEMES[currentIndex].label} active, activate to switch to{" "}
        {nextTheme.label}
      </span>
      <div
        className="bg-muted/60 ml-auto inline-flex items-center gap-0.5 rounded-full p-0.5"
        aria-hidden="true"
      >
        {THEMES.map(({ value, icon }) => (
          <span
            key={value}
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-xs" }),
              "rounded-full",
              currentTheme === value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground"
            )}
          >
            {icon}
          </span>
        ))}
      </div>
    </DropdownMenuItem>
  )
}

// ── Workspace Helpers ──

function getWorkspaceInitials(name: string): string {
  return name.charAt(0).toUpperCase()
}

function WorkspaceAvatar({
  workspace,
  className,
  size = "default",
}: {
  workspace: Workspace
  className?: string
  size?: "default" | "sm" | "lg"
}) {
  const initials = getWorkspaceInitials(workspace.name)
  return (
    <Avatar size={size} className={cn("shrink-0", className)}>
      {workspace.imageUrl ? (
        <AvatarImage src={workspace.imageUrl} alt={workspace.name} />
      ) : null}
      <AvatarFallback className="bg-background border-border text-foreground border text-sm font-medium">
        {initials}
      </AvatarFallback>
    </Avatar>
  )
}

function WorkspaceItem({
  workspace,
  isActive,
  onSelect,
}: {
  workspace: Workspace
  isActive: boolean
  onSelect: (id: string) => void
}) {
  return (
    <DropdownMenuItem onClick={() => onSelect(workspace.id)}>
      <WorkspaceAvatar workspace={workspace} className="size-5!" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{workspace.name}</span>
        {workspace.tier && (
          <span className="text-muted-foreground truncate text-xs">
            {workspace.tier}
          </span>
        )}
      </div>
      {isActive && (
        <CheckIcon className="ml-auto size-3.5 shrink-0 opacity-60" aria-hidden="true" />
      )}
    </DropdownMenuItem>
  )
}

// ── Nav Workspace ──

export function NavWorkspace() {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("claude")
  const { isMobile } = useSidebar()

  const activeWorkspace =
    WORKSPACES.find((w) => w.id === activeWorkspaceId) ?? WORKSPACES[0]

  return (
    <SidebarMenu>
      {/* Sidebar */}
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="-ml-1 bg-transparent pr-0! group-data-[collapsible=icon]:ml-0! group-data-[collapsible=icon]:justify-center"
            render={<SidebarMenuButton aria-label="Open workspace menu" />}
          >
            <WorkspaceAvatar workspace={activeWorkspace} size="sm" />
            <span className="truncate text-sm font-medium in-data-[state=collapsed]:hidden">
              {activeWorkspace.name}
            </span>
            <MoreHorizontalIcon className="mr-1 ml-auto size-4 shrink-0 opacity-50 in-data-[state=collapsed]:hidden" aria-hidden="true" />
          </DropdownMenuTrigger>

          <DropdownMenuContent
            side={isMobile ? "top" : "right"}
            align="end"
            sideOffset={8}
            className="w-60"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                Organizations
              </DropdownMenuLabel>
              {WORKSPACES.map((workspace) => (
                <WorkspaceItem
                  key={workspace.id}
                  workspace={workspace}
                  isActive={activeWorkspaceId === workspace.id}
                  onSelect={setActiveWorkspaceId}
                />
              ))}
              <DropdownMenuItem>
                <PlusIcon aria-hidden="true" className="mx-0.5" />
                New Organization
              </DropdownMenuItem>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                Account
              </DropdownMenuLabel>

              <DropdownMenuItem>
                <UserIcon aria-hidden="true" />
                Profile
                <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <CreditCardIcon aria-hidden="true" />
                Billing
              </DropdownMenuItem>
              <DropdownMenuItem>
                <SettingsIcon aria-hidden="true" />
                Preferences
              </DropdownMenuItem>
              <ThemeMenuItem />
            </DropdownMenuGroup>

            <DropdownMenuSeparator />

            <DropdownMenuGroup>
              <DropdownMenuItem>
                <LogOutIcon aria-hidden="true" />
                Sign Out
                <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
