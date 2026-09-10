"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { ACTIVE_PROJECTS, type Project } from "./data"
import { ItemActionMenu } from "./item-action-menu"
import { ChevronDownIcon } from "lucide-react"

const RADIUS = 6
const CX = 8
const CY = 8
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function PieProgress({ progress, color }: { progress: number; color: string }) {
  const offset =
    CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, progress)) / 100)

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      className="shrink-0 -rotate-90 opacity-100!"
      aria-hidden="true"
    >
      <circle
        cx={CX}
        cy={CY}
        r={RADIUS}
        fill="none"
        className="stroke-muted-foreground/20"
        strokeWidth="2.5"
      />
      <circle
        cx={CX}
        cy={CY}
        r={RADIUS}
        fill="none"
        className={color}
        strokeWidth="2.5"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={offset}
        strokeLinecap="round"
      />
    </svg>
  )
}

// ── Project Item ──

function ProjectItem({ project }: { project: Project }) {
  return (
    <SidebarMenuItem>
      {/* Sidebar */}
      <SidebarMenuButton
        tooltip={`${project.name} · ${project.progress}% complete`}
        render={<a href="#" />}
      >
        <PieProgress progress={project.progress} color={project.color} />
        <span className="min-w-0 truncate">{project.name}</span>
      </SidebarMenuButton>
      {/* Row */}
      <ItemActionMenu label={project.name} />
    </SidebarMenuItem>
  )
}

function ProjectList() {
  return (
    <SidebarGroupContent id="active-projects-list">
      {/* Sidebar */}
      <SidebarMenu className="gap-0.25">
        {ACTIVE_PROJECTS.map((project) => (
          <ProjectItem key={project.id} project={project} />
        ))}
      </SidebarMenu>
    </SidebarGroupContent>
  )
}

export function NavProjects() {
  const [open, setOpen] = useState(true)

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      {/* Sidebar */}
      <SidebarGroupLabel
        render={
          <button
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            aria-controls="active-projects-list"
          />
        }
        className="focus-visible:ring-sidebar-ring w-full cursor-pointer whitespace-nowrap focus-visible:ring-2 focus-visible:outline-none"
      >
        Active Projects
        <ChevronDownIcon className={cn(
                          "ml-auto size-4 shrink-0 opacity-60 transition-transform duration-200",
                          !open && "-rotate-90"
                        )} aria-hidden="true" />
      </SidebarGroupLabel>

      {open && <ProjectList />}
    </SidebarGroup>
  )
}