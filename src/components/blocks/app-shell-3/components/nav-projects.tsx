"use client"

import { useState } from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { ItemActionMenu } from "./item-action-menu"
import { ChevronDownIcon, PlusIcon } from "lucide-react"
import { useProjects, type ProjectItem as ProjectType } from "@/contexts/projects-context"
import { CreateProjectDialog } from "@/components/create-project-dialog"

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

function ProjectItem({ project }: { project: ProjectType }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={project.name}
        render={<Link href={`/${project.slug}`} />}
      >
        <PieProgress progress={100} color="stroke-primary" />
        <span className="min-w-0 truncate">{project.name}</span>
      </SidebarMenuButton>
      <ItemActionMenu label={project.name} />
    </SidebarMenuItem>
  )
}

function ProjectList() {
  const { projects, isLoading } = useProjects()

  if (isLoading && projects.length === 0) {
    return (
      <SidebarGroupContent id="active-projects-list">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          Loading projects...
        </div>
      </SidebarGroupContent>
    )
  }

  if (projects.length === 0) {
    return (
      <SidebarGroupContent id="active-projects-list">
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          No projects yet
        </div>
      </SidebarGroupContent>
    )
  }

  return (
    <SidebarGroupContent id="active-projects-list">
      <SidebarMenu className="gap-0.25">
        {projects.map((project) => (
          <ProjectItem key={project.id} project={project} />
        ))}
      </SidebarMenu>
    </SidebarGroupContent>
  )
}

export function NavProjects() {
  const [open, setOpen] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel
          render={
            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              aria-expanded={open}
              aria-controls="active-projects-list"
            />
          }
          className="focus-visible:ring-sidebar-ring w-full cursor-pointer whitespace-nowrap focus-visible:ring-2 focus-visible:outline-none"
        >
          Active Projects
          <ChevronDownIcon
            className={cn(
              "ml-auto size-4 shrink-0 opacity-60 transition-transform duration-200",
              !open && "-rotate-90"
            )}
            aria-hidden="true"
          />
        </SidebarGroupLabel>

        <SidebarGroupAction
          onClick={() => setCreateDialogOpen(true)}
          title="Create project"
          aria-label="Create project"
        >
          <PlusIcon />
          <span className="sr-only">Create project</span>
        </SidebarGroupAction>

        {open && <ProjectList />}
      </SidebarGroup>

      <CreateProjectDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
    </>
  )
}
