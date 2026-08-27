# -*- coding: utf-8 -*-
"""
局域网仪表盘服务器
==================
把 output 目录通过 HTTP 共享到局域网，其他电脑浏览器访问：
    http://<本机IP>:8000   （自动打开 dashboard.html）

用法：双击 start_server.bat，或命令行执行 python local_server.py
停止：关闭窗口 / Ctrl+C
"""
import csv
import datetime
import http.server
import json
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
UPDATE_HOUR, UPDATE_MINUTE = 12, 0   # 每天完整更新时间
REFRESH_INTERVAL = 60                # 网页触发刷新去重窗口（秒）：1 分钟内已爬过则跳过
LAST_REFRESH = [0.0]                 # 上次实际爬取运行记录的时间戳（节流状态）
UPDATE_LOCK = threading.Lock()       # 防止完整更新与快速刷新并发写 output


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def end_headers(self):
        # 页面数据每分钟刷新，禁用缓存避免浏览器拿到旧版本
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path in ("/", ""):
            self.path = "/dashboard.html"
        return super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] == "/api/refresh":
            self.handle_refresh()
        else:
            self.send_error(404, "Not Found")

    def handle_refresh(self):
        """网页每分钟请求一次：若 60 秒内已爬取过则跳过，直接返回最新数据。"""
        now = time.time()
        skipped = False
        if now - LAST_REFRESH[0] < REFRESH_INTERVAL:
            skipped = True
        else:
            ok = run_refresh()
            if ok:
                LAST_REFRESH[0] = time.time()
        records = load_run_records()
        payload = {
            "ok": True,
            "skipped": skipped,
            "count": len(records),
            "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "records": records,
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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


def _to_ms(v):
    """ISO 8601（含时区）/时间戳 -> 北京时间毫秒（与 dashboard.to_ms 一致）"""
    if not v:
        return None
    s = str(v)
    try:
        if s.isdigit() and len(s) in (10, 13):
            return int(s) * (1000 if len(s) == 10 else 1)
        dt = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    bjt = datetime.timezone(datetime.timedelta(hours=8))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=bjt)
    else:
        dt = dt.astimezone(bjt)
    return int(dt.timestamp() * 1000)


def load_run_records():
    """读取 runs_normalized.csv 转甘特图 records（与 dashboard.build_runs_gantt 的 seed 结构一致）"""
    path = os.path.join(DIR, "runs_normalized.csv")
    if not os.path.exists(path):
        return []
    records = []
    with open(path, "r", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            start = _to_ms(r.get("start_time"))
            if start is None:
                continue
            records.append({
                "id": (r.get("flow_id") or "") + "_" + (r.get("process_no") or ""),
                "robot": r.get("bot_name") or "(未指定机器人)",
                "name": r.get("trigger_name") or r.get("flow_name") or "运行记录",
                "app": r.get("flow_name") or "",
                "start": start,
                "end": _to_ms(r.get("end_time")),  # 为空 = 运行中/排队中，前端延伸到现在
                "status": r.get("status") or "",
                "execStart": _to_ms(r.get("execution_start_time")),  # 实际开始运行时间（此前为排队阶段）
                "way": r.get("start_way") or "",
            })
    records.sort(key=lambda s: s["start"])
    return records


def run_update():
    """执行完整更新流程：抓取 -> 整理时刻表 -> 生成仪表盘（日志写 output/update_log.txt）"""
    with UPDATE_LOCK:
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


def run_refresh():
    """快速刷新：运行记录（最近 7 天，手动/定时/Webhook 全部触发方式）+ 甘特图页面（由网页 /api/refresh 触发）。
    成功仅打印一行时间戳；失败把摘要写入 update_log.txt。返回 True=成功 False=失败。"""
    with UPDATE_LOCK:
        py = sys.executable
        log = os.path.join(DIR, "update_log.txt")
        cmds = [
            [py, "crawler.py", "--config", "config.json", "--out", "output",
             "--only-runs", "--days", "7"],
            [py, "dashboard.py", "--input", os.path.join("output", "triggers_normalized.csv"),
             "--out", "output", "--only-gantt"],
        ]
        try:
            for cmd in cmds:
                r = subprocess.run(cmd, cwd=BASE, capture_output=True, encoding="utf-8",
                                   errors="replace", timeout=180)
                if r.returncode != 0:
                    with open(log, "a", encoding="utf-8") as f:
                        f.write("[%s] 刷新失败: %s\n%s\n" % (
                            datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                            " ".join(cmd), ((r.stdout or "") + (r.stderr or ""))[-600:]))
                    return False
            print("[刷新] %s 运行记录已更新（最近 7 天，手动/定时/Webhook 全部）" % datetime.datetime.now().strftime("%H:%M:%S"))
            return True
        except Exception as e:
            with open(log, "a", encoding="utf-8") as f:
                f.write("[%s] 刷新异常: %s\n" % (datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), e))
            print("[刷新] 异常:", e)
            return False


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
    try:
        sys.stdout.reconfigure(line_buffering=True)
        sys.stderr.reconfigure(line_buffering=True)
    except Exception:
        pass
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
        print("  运行记录刷新: 网页每分钟请求 /api/refresh 触发（%d 秒内去重）" % REFRESH_INTERVAL)
        print("  每日 %02d:%02d 自动完整更新（抓取->整理->仪表盘）" % (UPDATE_HOUR, UPDATE_MINUTE))
        print("  无需 Windows 任务计划：数据更新由本后端进程自动完成")
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
