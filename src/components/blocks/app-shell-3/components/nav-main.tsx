"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { NAV_MAIN, type NavChild, type NavItem } from "./data"
import { ChevronRightIcon } from "lucide-react"

function NavSubItem({ child }: { child: NavChild }) {
  const pathname = usePathname()
  const isActive = child.url ? pathname === child.url : child.isActive

  return (
    <SidebarMenuSubItem>
      {/* Sidebar */}
      <SidebarMenuSubButton
        render={<Link href={child.url || "#"} />}
        isActive={isActive}
      >
        <span>{child.label}</span>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  )
}

function NavSubMenu({ id, children }: { id: string; children: NavChild[] }) {
  return (
    <SidebarMenuSub id={`subnav-${id}`}>
      {children.map((child) => (
        <NavSubItem key={child.id} child={child} />
      ))}
    </SidebarMenuSub>
  )
}

// ── CollapsibleNavItem ──
// Isolated component so only this item re-renders on open/close toggle.

// Collapsed (icon) rail: the inline submenu would push the next item down, so
// the children open in a side dropdown anchored to the icon button instead.
function CollapsedNavItem({
  item,
}: {
  item: NavItem & { children: NavChild[] }
}) {
  const pathname = usePathname()
  const hasActiveChild = item.children.some((c) =>
    c.url ? pathname === c.url : c.isActive
  )

  return (
    <SidebarMenuItem>
      {/* Sidebar */}
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
            {item.children.map((child) => (
              <DropdownMenuItem
                key={child.id}
                render={<Link href={child.url || "#"} />}
              >
                {child.label}
              </DropdownMenuItem>
            ))}
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
}: {
  item: NavItem & { children: NavChild[] }
  open: boolean
  onToggle: () => void
}) {
  const pathname = usePathname()
  const hasActiveChild = item.children.some((c) =>
    c.url ? pathname === c.url : c.isActive
  )

  return (
    <SidebarMenuItem>
      {/* Sidebar */}
      <SidebarMenuButton
        tooltip={item.label}
        isActive={item.isActive || hasActiveChild}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`subnav-${item.id}`}
      >
        {item.icon}
        <span className="truncate">{item.label}</span>
        <ChevronRightIcon className={cn(
                          "ml-auto size-4 shrink-0 opacity-60 transition-transform duration-200",
                          open && "rotate-90"
                        )} aria-hidden="true" />
      </SidebarMenuButton>

      {open && <NavSubMenu id={item.id}>{item.children}</NavSubMenu>}
    </SidebarMenuItem>
  )
}

function CollapsibleNavItem({
  item,
}: {
  item: NavItem & { children: NavChild[] }
}) {
  const { state } = useSidebar()
  const pathname = usePathname()
  const hasActiveChild = item.children.some((c) =>
    c.url ? pathname === c.url : c.isActive
  )
  // Kept on the always-mounted parent so the expanded open state survives a
  // collapse/expand cycle instead of resetting when the branch swaps.
  const [open, setOpen] = useState(() => hasActiveChild || item.children.some((c) => c.isActive))

  useEffect(() => {
    if (hasActiveChild) {
      setOpen(true)
    }
  }, [hasActiveChild])

  return state === "collapsed" ? (
    <CollapsedNavItem item={item} />
  ) : (
    <ExpandedNavItem
      item={item}
      open={open}
      onToggle={() => setOpen((prev) => !prev)}
    />
  )
}

function LeafNavItem({ item }: { item: NavItem }) {
  const pathname = usePathname()
  const isActive = item.url ? pathname === item.url : item.isActive

  return (
    <SidebarMenuItem>
      {/* Sidebar */}
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
  return (
    <SidebarGroup>
      {/* Sidebar */}
      <SidebarGroupLabel className="in-data-[state=collapsed]:hidden">
        Platform
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {NAV_MAIN.map((item) =>
            item.children ? (
              <CollapsibleNavItem
                key={item.id}
                item={item as NavItem & { children: NavChild[] }}
              />
            ) : (
              <LeafNavItem key={item.id} item={item} />
            )
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
