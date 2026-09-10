"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { NAV_MAIN, type NavChild, type NavItem } from "./data"
import { ChevronRightIcon, PlusIcon } from "lucide-react"
import { useProjects } from "@/contexts/projects-context"
import { CreateProjectDialog } from "@/components/create-project-dialog"

function NavSubItem({ child }: { child: NavChild }) {
  const pathname = usePathname()
  const isActive = child.url ? pathname === child.url : child.isActive

  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        render={<Link href={child.url || "#"} />}
        isActive={isActive}
      >
        <span className="truncate">{child.label}</span>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  )
}

function NavSubMenu({
  id,
  items,
  onAddProject,
}: {
  id: string
  items: NavChild[]
  onAddProject?: () => void
}) {
  return (
    <SidebarMenuSub id={`subnav-${id}`}>
      {items.map((child) => (
        <NavSubItem key={child.id} child={child} />
      ))}
      {onAddProject && (
        <SidebarMenuSubItem>
          <button
            type="button"
            onClick={onAddProject}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent cursor-pointer transition-colors"
          >
            <PlusIcon className="size-3.5" />
            <span>Create project</span>
          </button>
        </SidebarMenuSubItem>
      )}
    </SidebarMenuSub>
  )
}

// Collapsed (icon) rail: the inline submenu would push the next item down, so
// the children open in a side dropdown anchored to the icon button instead.
function CollapsedNavItem({
  item,
  onAddProject,
}: {
  item: NavItem & { children: NavChild[] }
  onAddProject?: () => void
}) {
  const pathname = usePathname()
  const hasActiveChild = item.children.some((c) =>
    c.url ? pathname === c.url : c.isActive
  )

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuButton
              tooltip={item.label}
              isActive={item.isActive || hasActiveChild}
              aria-label={item.label}
            />
          }
        >
          {item.icon}
          <span>{item.label}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="start"
          sideOffset={8}
          className="min-w-48"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>{item.label}</DropdownMenuLabel>
            {item.children.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                No projects yet
              </div>
            ) : (
              item.children.map((child) => (
                <DropdownMenuItem
                  key={child.id}
                  render={<Link href={child.url || "#"} />}
                >
                  <span className="truncate">{child.label}</span>
                </DropdownMenuItem>
              ))
            )}
            {onAddProject && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onAddProject}>
                  <PlusIcon className="mr-2 size-4" />
                  <span>Create project</span>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

// Expanded rail: the submenu expands inline under its parent button.
function ExpandedNavItem({
  item,
  open,
  onToggle,
  onAddProject,
}: {
  item: NavItem & { children: NavChild[] }
  open: boolean
  onToggle: () => void
  onAddProject?: () => void
}) {
  const pathname = usePathname()
  const hasActiveChild = item.children.some((c) =>
    c.url ? pathname === c.url : c.isActive
  )

  return (
    <SidebarMenuItem className="relative">
      <SidebarMenuButton
        tooltip={item.label}
        isActive={item.isActive || hasActiveChild}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`subnav-${item.id}`}
      >
        {item.icon}
        <span className="truncate">{item.label}</span>
        <ChevronRightIcon
          className={cn(
            "ml-auto size-4 shrink-0 opacity-60 transition-transform duration-200",
            open && "rotate-90"
          )}
          aria-hidden="true"
        />
      </SidebarMenuButton>

      {onAddProject && (
        <SidebarMenuAction
          showOnHover
          onClick={(e) => {
            e.stopPropagation()
            onAddProject()
          }}
          title="Create project"
          aria-label="Create project"
        >
          <PlusIcon className="size-3.5" />
        </SidebarMenuAction>
      )}

      {open && (
        <NavSubMenu
          id={item.id}
          items={item.children}
          onAddProject={onAddProject}
        />
      )}
    </SidebarMenuItem>
  )
}

function CollapsibleNavItem({
  item,
  onAddProject,
}: {
  item: NavItem & { children: NavChild[] }
  onAddProject?: () => void
}) {
  const { state } = useSidebar()
  const pathname = usePathname()
  const hasActiveChild = item.children.some((c) =>
    c.url ? pathname === c.url : c.isActive
  )
  const [open, setOpen] = useState(
    () => hasActiveChild || item.children.some((c) => c.isActive) || item.id === "projects"
  )

  const [previousHasActiveChild, setPreviousHasActiveChild] = useState(hasActiveChild)

  // Reopen only when entering this group. Manual collapse while a child stays
  // active, and the open state when leaving the group, remain user-controlled.
  if (previousHasActiveChild !== hasActiveChild) {
    setPreviousHasActiveChild(hasActiveChild)
    if (hasActiveChild) {
      setOpen(true)
    }
  }

  return state === "collapsed" ? (
    <CollapsedNavItem item={item} onAddProject={onAddProject} />
  ) : (
    <ExpandedNavItem
      item={item}
      open={open}
      onToggle={() => setOpen((prev) => !prev)}
      onAddProject={onAddProject}
    />
  )
}

function LeafNavItem({ item }: { item: NavItem }) {
  const pathname = usePathname()
  const isActive = item.url ? pathname === item.url : item.isActive

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={item.label}
        isActive={isActive}
        render={<Link href={item.url || "#"} />}
      >
        {item.icon}
        <span>{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function NavMain() {
  const { projects } = useProjects()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  const items = NAV_MAIN.map((item) => {
    if (item.id === "projects") {
      const children: NavChild[] = projects.map((p) => ({
        id: p.id,
        label: p.name,
        url: `/${p.slug}`,
      }))
      return {
        ...item,
        children,
      }
    }
    return item
  })

  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel className="in-data-[state=collapsed]:hidden">
          Platform
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {items.map((item) =>
              item.children ? (
                <CollapsibleNavItem
                  key={item.id}
                  item={item as NavItem & { children: NavChild[] }}
                  onAddProject={
                    item.id === "projects"
                      ? () => setCreateDialogOpen(true)
                      : undefined
                  }
                />
              ) : (
                <LeafNavItem key={item.id} item={item} />
              )
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <CreateProjectDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
    </>
  )
}
