' Chay Git Bash an cua so cho Task Scheduler: wscript.exe run-hidden.vbs <ten script trong infra/>
Set sh = CreateObject("WScript.Shell")
root = Replace(Replace(Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1), "\infra", ""), "\", "/")
root = "/" & LCase(Left(root, 1)) & Mid(root, 3)
sh.Run """C:\Program Files\Git\bin\bash.exe"" -lc ""cd " & root & " && bash infra/" & WScript.Arguments(0) & """", 0, False
