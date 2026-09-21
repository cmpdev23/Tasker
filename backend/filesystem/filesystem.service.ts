import { exec } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface SelectDirectoryResult {
  path: string | null;
  canceled: boolean;
  error?: string;
}

export type SelectFileResult = SelectDirectoryResult;

export class FilesystemService {
  /**
   * Opens a native folder picker dialog on the host OS and returns the selected directory path.
   */
  async openDirectoryPicker(initialPath?: string): Promise<SelectDirectoryResult> {
    const platform = os.platform();

    return new Promise((resolve) => {
      let command: string;

      if (platform === "win32") {
        // Modern Windows 10/11 FileOpenDialog with FOS_PICKFOLDERS via native-folder-picker.ps1
        const scriptPath = path.resolve(
          process.cwd(),
          "backend/filesystem/native-folder-picker.ps1"
        );
        const args = initialPath ? ` -InitialPath "${initialPath.replace(/"/g, '`"')}"` : "";
        command = `powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "${scriptPath}" -Title "Select local repository"${args}`;
      } else if (platform === "darwin") {
        command = `osascript -e 'POSIX path of (choose folder with prompt "Select local repository")'`;
      } else {
        // Linux: try zenity or kdialog
        command = `zenity --file-selection --directory --title="Select local repository" 2>/dev/null || kdialog --getexistingdirectory 2>/dev/null`;
      }

      exec(command, { timeout: 120000 }, (error, stdout, stderr) => {
        if (stderr) {
          console.error("Native folder picker stderr:", stderr);
        }
        if (error) {
          // If the user cancelled or the process was terminated
          if (error.killed || error.code === 1 || error.code === 5) {
            return resolve({ path: null, canceled: true });
          }
          return resolve({
            path: null,
            canceled: true,
            error: error.message,
          });
        }

        const selectedPath = stdout.trim();
        if (!selectedPath) {
          return resolve({ path: null, canceled: true });
        }

        if (fs.existsSync(selectedPath) && fs.statSync(selectedPath).isDirectory()) {
          return resolve({ path: selectedPath, canceled: false });
        }

        return resolve({
          path: null,
          canceled: false,
          error: `Selected path "${selectedPath}" does not exist or is not a directory.`,
        });
      });
    });
  }

  /** Opens a native file picker restricted to likely Python launchers. */
  async openPythonExecutablePicker(): Promise<SelectFileResult> {
    const platform = os.platform();
    return new Promise((resolve) => {
      let command: string;
      if (platform === "win32") {
        const scriptPath = path.resolve(process.cwd(), "backend/filesystem/native-python-picker.ps1");
        command = `powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "${scriptPath}"`;
      } else if (platform === "darwin") {
        command = `osascript -e 'POSIX path of (choose file with prompt "Select Python interpreter")'`;
      } else {
        command = `zenity --file-selection --title="Select Python interpreter" 2>/dev/null || kdialog --getopenfilename 2>/dev/null`;
      }
      exec(command, { timeout: 120000 }, (error, stdout, stderr) => {
        if (stderr) console.error("Native Python picker stderr:", stderr);
        if (error) {
          if (error.killed || error.code === 1 || error.code === 5) return resolve({ path: null, canceled: true });
          return resolve({ path: null, canceled: true, error: error.message });
        }
        const selectedPath = stdout.trim();
        if (!selectedPath) return resolve({ path: null, canceled: true });
        if (fs.existsSync(selectedPath) && fs.statSync(selectedPath).isFile()) {
          return resolve({ path: selectedPath, canceled: false });
        }
        return resolve({ path: null, canceled: false,
          error: `Selected path "${selectedPath}" does not exist or is not a file.` });
      });
    });
  }

  isDirectory(targetPath: string): boolean {
    try {
      return fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
    } catch {
      return false;
    }
  }

  exists(targetPath: string): boolean {
    try {
      return fs.existsSync(targetPath);
    } catch {
      return false;
    }
  }
}

export const filesystemService = new FilesystemService();
