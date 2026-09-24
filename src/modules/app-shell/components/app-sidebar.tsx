import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import Link from "next/link";

import { Logo } from "./logo";
import { NavMain } from "./nav-main";
import { NavProjects } from "./nav-projects";
import { NavWorkspace } from "./nav-workspace";
import { NotificationsPopover } from "./notifications-popover";

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon" variant="inset">
      {/* Header */}
      <SidebarHeader className="flex flex-row items-center justify-between in-data-[state=collapsed]:flex-col in-data-[state=collapsed]:items-start in-data-[state=collapsed]:justify-center">
        <Link
          href="/"
          className="inline-flex min-h-10 items-center gap-2 px-0.5 transition-all duration-200 ease-linear hover:opacity-80"
        >
          <Logo />
          <span className="text-sm font-medium in-data-[state=collapsed]:hidden">
            Tasker
          </span>
        </Link>

        <div className="inline-flex items-center gap-0.5 in-data-[state=collapsed]:flex-col">
          <NotificationsPopover />
          <SidebarTrigger className="opacity-60 hover:opacity-100 [&_svg]:transition-transform [&_svg]:duration-200 in-data-[state=collapsed]:[&_svg]:rotate-180" />
        </div>
      </SidebarHeader>

      {/* Sidebar */}
      <SidebarContent>
        <NavMain />
        <NavProjects />
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter>
        <NavWorkspace />
      </SidebarFooter>
    </Sidebar>
  );
}
