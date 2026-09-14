import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/blocks/app-shell-3/components/app-shell";
import { DevAgentation } from "@/components/dev/agentation";
import { ProjectsProvider } from "@/contexts/projects-context";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tasker",
  description: "Un espace de travail pour vos tâches Codex.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            <ProjectsProvider>
              <AppShell>{children}</AppShell>
              <Toaster position="bottom-right" richColors />
              <DevAgentation />
            </ProjectsProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
