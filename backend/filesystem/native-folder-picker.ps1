param(
    [string]$Title = "Select local repository",
    [string]$InitialPath = ""
)

$source = @'
using System;
using System.Runtime.InteropServices;

namespace NativeFolderPicker
{
    [ComImport]
    [Guid("d57c7288-d4ad-4768-be02-9d969532d960")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IFileOpenDialog
    {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes();
        void SetFileTypeIndex();
        void GetFileTypeIndex();
        void Advise();
        void Unadvise();
        void SetOptions(uint fos);
        void GetOptions(out uint fos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace(IShellItem psi, int alignment);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        void Close(int hr);
        void SetClientGuid();
        void ClearClientData();
        void SetFilter();
        void GetResults(out IntPtr ppenum);
        void GetSelectedItems(out IntPtr ppsai);
    }

    [ComImport]
    [Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IShellItem
    {
        void BindToHandler();
        void GetParent();
        void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        void GetAttributes();
        void Compare();
    }

    [ComImport]
    [Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    [ClassInterface(ClassInterfaceType.None)]
    [TypeLibType(TypeLibTypeFlags.FCanCreate)]
    public class FileOpenDialogRCW { }

    public class FolderPicker
    {
        public static string ShowDialog(string title, string initialPath)
        {
            var dialog = (IFileOpenDialog)new FileOpenDialogRCW();
            uint options;
            dialog.GetOptions(out options);
            // FOS_PICKFOLDERS = 0x20, FOS_FORCEFILESYSTEM = 0x40
            dialog.SetOptions(options | 0x00000020 | 0x00000040);

            if (!string.IsNullOrEmpty(title))
            {
                dialog.SetTitle(title);
            }

            if (!string.IsNullOrEmpty(initialPath))
            {
                IntPtr pidl = IntPtr.Zero;
                uint flags = 0;
                if (SHParseDisplayName(initialPath, IntPtr.Zero, out pidl, 0, out flags) == 0 && pidl != IntPtr.Zero)
                {
                    IShellItem item;
                    if (SHCreateShellItem(IntPtr.Zero, IntPtr.Zero, pidl, out item) == 0 && item != null)
                    {
                        dialog.SetFolder(item);
                    }
                    Marshal.FreeCoTaskMem(pidl);
                }
            }

            IntPtr owner = GetForegroundWindow();
            int hr = dialog.Show(owner);
            if (hr != 0)
            {
                return null;
            }

            IShellItem result;
            dialog.GetResult(out result);
            if (result != null)
            {
                string path;
                result.GetDisplayName(0x80058000, out path); // SIGDN_FILESYSPATH
                return path;
            }

            return null;
        }

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int SHParseDisplayName(string pszName, IntPtr pbc, out IntPtr ppidl, uint sfgaoIn, out uint psfgaoOut);

        [DllImport("shell32.dll", SetLastError = true)]
        private static extern int SHCreateShellItem(IntPtr pidlParent, IntPtr psfParent, IntPtr pidl, out IShellItem ppsi);
    }
}
'@

try {
    Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop
} catch {
    # Type might already be added in current session
}

$selected = [NativeFolderPicker.FolderPicker]::ShowDialog($Title, $InitialPath)
if ($selected) {
    [Console]::Out.Write($selected)
}
