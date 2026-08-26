# -*- coding: utf-8 -*-
"""
局域网仪表盘服务器
==================
把 output 目录通过 HTTP 共享到局域网，其他电脑浏览器访问：
    http://<本机IP>:8000   （自动打开 dashboard.html）

用法：双击 start_server.bat，或命令行执行 python local_server.py
停止：关闭窗口 / Ctrl+C
"""
import http.server
import os
import socket
import socketserver

PORT = 8000
BASE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(BASE, "output")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def do_GET(self):
        if self.path in ("/", ""):
            self.path = "/dashboard.html"
        return super().do_GET()

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


def lan_ips():
    ips = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    if not ips:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            ips.append(s.getsockname()[0])
        except Exception:
            pass
        finally:
            s.close()
    return ips


def main():
    os.chdir(DIR)
    with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), Handler) as httpd:
        print("=" * 56)
        print("  RPA 日程仪表盘 - 局域网服务器已启动")
        print("=" * 56)
        print("  本机访问:   http://localhost:%d" % PORT)
        for ip in lan_ips():
            print("  局域网访问: http://%s:%d" % (ip, PORT))
        print("-" * 56)
        print("  其他电脑打开上面的局域网地址即可查看仪表盘")
        print("  如无法访问，请在本机防火墙中放行 Python 和端口 %d" % PORT)
        print("  按 Ctrl+C 停止服务")
        print("=" * 56)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
