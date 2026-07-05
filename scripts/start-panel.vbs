' Arrenca el Centre de Control en segon pla (sense finestra) — usat per la tasca programada de Windows
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Claude\control-center"
WshShell.Run "cmd /c node server.js", 0, False
