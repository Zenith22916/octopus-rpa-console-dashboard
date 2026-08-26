# -*- coding: utf-8 -*-
"""
局域网仪表盘服务器
==================
把 output 目录通过 HTTP 共享到局域网，其他电脑浏览器访问：
    http://<本机IP>:8000   （自动打开 dashboard.html）

用法：双击 start_server.bat，或命令行执行 python local_server.py
停止：关闭窗口 / Ctrl+C
"""
import datetime
import http.server
import os
import socket
import socketserver
import subprocess
import sys
import threading
import time

PORT = 8000
BASE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(BASE, "output")
UPDATE_HOUR, UPDATE_MINUTE = 12, 0   # 每天自动更新时间


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


def seconds_until(hour, minute):
    """距下一个 hour:minute 的秒数"""
    now = datetime.datetime.now()
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += datetime.timedelta(days=1)
    return (target - now).total_seconds()


def run_update():
    """执行完整更新流程：抓取 -> 整理时刻表 -> 生成仪表盘（日志写 output/update_log.txt）"""
    py = sys.executable
    log = os.path.join(DIR, "update_log.txt")
    commands = [
        [py, "crawler.py", "--config", "config.json", "--out", "output"],
        [py, "organize.py", "--input", os.path.join("output", "triggers_normalized.csv"), "--out", "output"],
        [py, "dashboard.py", "--input", os.path.join("output", "triggers_normalized.csv"), "--out", "output"],
    ]
    with open(log, "a", encoding="utf-8") as f:
        f.write("\n[%s] ===== 每日自动更新开始 =====\n" % datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        for cmd in commands:
            f.write(">> %s\n" % " ".join(cmd))
            f.flush()
            try:
                subprocess.run(cmd, cwd=BASE, stdout=f, stderr=subprocess.STDOUT,
                               encoding="utf-8", errors="replace", timeout=1800)
            except Exception as e:
                f.write("!! 执行异常: %s\n" % e)
        f.write("[%s] ===== 每日自动更新结束 =====\n" % datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))


def scheduler():
    """每天 UPDATE_HOUR:UPDATE_MINUTE 自动更新数据"""
    while True:
        delay = seconds_until(UPDATE_HOUR, UPDATE_MINUTE)
        next_time = (datetime.datetime.now() + datetime.timedelta(seconds=delay)).strftime("%Y-%m-%d %H:%M")
        print("[定时] 下次自动更新: %s（%.1f 小时后）" % (next_time, delay / 3600))
        time.sleep(delay)
        try:
            run_update()
        except Exception as e:
            print("[定时] 更新异常:", e)


def main():
    os.chdir(DIR)
    threading.Thread(target=scheduler, daemon=True).start()
    with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), Handler) as httpd:
        print("=" * 56)
        print("  RPA 日程仪表盘 - 局域网服务器已启动")
        print("=" * 56)
        print("  本机访问:   http://localhost:%d" % PORT)
        for ip in lan_ips():
            print("  局域网访问: http://%s:%d" % (ip, PORT))
        print("-" * 56)
        print("  每日 %02d:%02d 自动更新数据（抓取->整理->仪表盘）" % (UPDATE_HOUR, UPDATE_MINUTE))
        print("  更新日志:   output\\update_log.txt")
        print("  其他电脑打开上面的局域网地址即可查看仪表盘")
        print("  如无法访问，请在本机防火墙中放行 Python 和端口 %d" % PORT)
        print("  按 Ctrl+C 停止服务")
        print("=" * 56)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n服务器已停止")


if __name__ == "__main__":
    main()
