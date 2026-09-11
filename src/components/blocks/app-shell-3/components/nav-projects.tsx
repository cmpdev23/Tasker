"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"

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
import { ProjectActionMenu } from "./item-action-menu"
import { ChevronDownIcon, PlusIcon, ArchiveIcon, ExternalLinkIcon, PencilIcon, Trash2Icon, Loader2Icon } from "lucide-react"
import { useProjects, type ProjectItem as ProjectType } from "@/contexts/projects-context"
import { CreateProjectDialog } from "@/components/create-project-dialog"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"

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
  const { updateProject, deleteProject } = useProjects()
  const router = useRouter()
  const pathname = usePathname()
  const [dialog, setDialog] = useState<"rename" | "archive" | "delete" | null>(null)
  const [name, setName] = useState(project.name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function openProject() {
    router.push(`/${project.slug}`)
  }

  function openDialog(next: "rename" | "archive" | "delete") {
    setError(null)
    if (next === "rename") setName(project.name)
    setDialog(next)
  }

  function closeDialog() {
    if (!saving) setDialog(null)
  }

  async function renameProject(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const updated = await updateProject(project.id, { name: name.trim() })
      setDialog(null)
      toast.success(`Projet renommé en « ${updated.name} ».`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible de renommer le projet.")
    } finally {
      setSaving(false)
    }
  }

  async function archiveProject() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await updateProject(project.id, { archived: true })
      setDialog(null)
      if (pathname === `/${project.slug}` || pathname.startsWith(`/${project.slug}/`)) router.replace("/")
      toast.success(`Projet « ${project.name} » archivé.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible d’archiver le projet.")
    } finally {
      setSaving(false)
    }
  }

  async function removeProject() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await deleteProject(project.id)
      setDialog(null)
      if (pathname === `/${project.slug}` || pathname.startsWith(`/${project.slug}/`)) router.replace("/")
      toast.success(`Projet « ${project.name} » supprimé.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible de supprimer le projet.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <SidebarMenuItem>
        <ContextMenu>
          <ContextMenuTrigger className="block w-full">
            <SidebarMenuButton tooltip={project.name} render={<Link href={`/${project.slug}`} />}>
              <PieProgress progress={100} color="stroke-primary" />
              <span className="min-w-0 truncate">{project.name}</span>
            </SidebarMenuButton>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={openProject}><ExternalLinkIcon />Ouvrir</ContextMenuItem>
            <ContextMenuItem onClick={() => openDialog("rename")}><PencilIcon />Renommer</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => openDialog("archive")}><ArchiveIcon />Archiver</ContextMenuItem>
            <ContextMenuItem variant="destructive" onClick={() => openDialog("delete")}><Trash2Icon />Supprimer</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <ProjectActionMenu label={project.name} onOpen={openProject} onRename={() => openDialog("rename")} onArchive={() => openDialog("archive")} onDelete={() => openDialog("delete")} />
      </SidebarMenuItem>

      <Dialog open={dialog === "rename"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent showCloseButton={!saving}>
          <form onSubmit={renameProject} className="flex flex-col gap-4">
            <DialogHeader><DialogTitle>Renommer le projet</DialogTitle><DialogDescription>Le nom affiché dans AgentTasker sera modifié. Le slug et le dossier du repository restent inchangés.</DialogDescription></DialogHeader>
            <div className="flex flex-col gap-2"><label htmlFor={`project-name-${project.id}`} className="text-sm font-medium">Nom du projet</label><Input id={`project-name-${project.id}`} value={name} onChange={(event) => { setName(event.target.value); setError(null) }} disabled={saving} autoFocus /></div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={closeDialog}>Annuler</Button><Button type="submit" disabled={saving || !name.trim()}>{saving && <Loader2Icon className="size-4 animate-spin" />}Renommer</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "archive"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent showCloseButton={!saving}>
          <DialogHeader><DialogTitle>Archiver le projet ?</DialogTitle><DialogDescription>Le projet sera retiré de la liste active et ses planifications seront suspendues. Son repository et son historique local sont conservés.</DialogDescription></DialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter><Button variant="outline" disabled={saving} onClick={closeDialog}>Conserver actif</Button><Button disabled={saving} onClick={archiveProject}>{saving && <Loader2Icon className="size-4 animate-spin" />}Archiver</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "delete"} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent showCloseButton={!saving}>
          <DialogHeader><DialogTitle>Supprimer le projet ?</DialogTitle><DialogDescription>Cette action efface le projet et son historique d’exécutions de la base locale AgentTasker. Le repository sur disque ne sera pas supprimé.</DialogDescription></DialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter><Button variant="outline" disabled={saving} onClick={closeDialog}>Annuler</Button><Button variant="destructive" disabled={saving} onClick={removeProject}>{saving && <Loader2Icon className="size-4 animate-spin" />}Supprimer le projet</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
