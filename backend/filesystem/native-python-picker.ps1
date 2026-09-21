$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = "Select Python interpreter"
$dialog.Filter = "Python executable (python*.exe; py.exe)|python*.exe;py.exe|Executable files (*.exe)|*.exe|All files (*.*)|*.*"
$dialog.CheckFileExists = $true
$dialog.Multiselect = $false

if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.WriteLine($dialog.FileName)
  exit 0
}

exit 1
