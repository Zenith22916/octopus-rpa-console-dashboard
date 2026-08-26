' Start RPA dashboard LAN server in a cmd window.
' Ctrl+C stops the server gracefully WITHOUT the batch "terminate batch job" prompt.
Set ws = CreateObject("WScript.Shell")
ws.Run "cmd /k ""cd /d E:\bazhuayu_crawler && python local_server.py""", 1, False
