Option Explicit
Dim shell, fso, base, script
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
script = fso.BuildPath(base, "lms-parser\start-ui.ps1")
shell.Run "powershell.exe -NoLogo -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Chr(34) & script & Chr(34), 0, False
