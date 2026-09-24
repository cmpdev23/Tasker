"use client"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenuAction } from "@/components/ui/sidebar"
import { MoreHorizontalIcon, ArchiveIcon, ExternalLinkIcon, PencilIcon, Trash2Icon } from "lucide-react"

interface ProjectActionMenuProps {
  label: string
  onOpen: () => void
  onRename: () => void
  onArchive: () => void
  onDelete: () => void
}

export function ProjectActionMenu({ label, onOpen, onRename, onArchive, onDelete }: ProjectActionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuAction showOnHover aria-label={`Actions for ${label}`} />
        }
      >
        <MoreHorizontalIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      {/* Content */}
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={4}
        className="w-44"
      >
        <DropdownMenuItem onClick={onOpen}><ExternalLinkIcon />Ouvrir</DropdownMenuItem>
        <DropdownMenuItem onClick={onRename}><PencilIcon />Renommer</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onArchive}><ArchiveIcon />Archiver</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={onDelete}><Trash2Icon />Supprimer</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
