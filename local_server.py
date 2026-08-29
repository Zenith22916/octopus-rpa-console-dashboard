# -*- coding: utf-8 -*-
"""
局域网/公网仪表盘服务器
=======================
把 output 目录通过 HTTP 共享，其他电脑或公网（配合内网穿透）浏览器访问：
    http://<本机IP>:8000   （自动打开 analysis.html 运行分析仪表盘）

访问保护：config.json 的 access_password 字段为访问密码，未设置则不启用。
公网暴露前务必设置，否则任何人可查看运行记录与日志。

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
from urllib.parse import urlparse, parse_qs, unquote

PORT = 8000
BASE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(BASE, "output")
UPDATE_HOUR, UPDATE_MINUTE = 12, 0   # 每天完整更新时间
REFRESH_INTERVAL = 60                # 网页触发刷新去重窗口（秒）：1 分钟内已爬过则跳过
LAST_REFRESH = [0.0]                 # 上次实际爬取运行记录的时间戳（节流状态）
UPDATE_LOCK = threading.Lock()       # 防止完整更新与快速刷新并发写 output
LOG_PAGE = 2000                      # 日志分段获取：每页行数（前端"加载更多"逐段拉取，避免大文件卡死）
MAX_PAGE = 20000                     # 单页行数上限（防止恶意超大 limit）


def load_log_roots():
    """从 robot_logs.json 读取允许的日志根目录（白名单，防止任意文件读取）。"""
    roots = []
    cfg = os.path.join(BASE, "robot_logs.json")
    if os.path.exists(cfg):
        try:
            with open(cfg, "r", encoding="utf-8") as f:
                data = json.load(f)
            for k, v in data.items():
                if k.startswith("_"):
                    continue
                if isinstance(v, str) and v:
                    roots.append(v)
        except Exception:
            pass
    return roots


LOG_ROOTS = load_log_roots()


def load_access_password():
    """从 config.json 读取仪表盘访问密码（复用爬虫配置文件，新增 access_password 字段）。
    返回空字符串表示不启用密码（保持本机无密码访问的兼容）。"""
    cfg = os.path.join(BASE, "config.json")
    if not os.path.exists(cfg):
        return ""
    try:
        with open(cfg, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("access_password", "") or ""
    except Exception:
        return ""


ACCESS_PASSWORD = load_access_password()
COOKIE_NAME = "wb_pwd"


def is_allowed(raw):
    """目录是否在允许的日志根白名单内（防任意文件读取）。"""
    if not raw:
        return False
    p = os.path.normpath(raw)
    for root in LOG_ROOTS:
        rp = os.path.normpath(root)
        if p == rp or p.startswith(rp + os.sep):
            return True
    return False


def count_lines(path):
    """统计文件行数（逐行迭代，不把整文件读入内存，避免大文件占满内存）。"""
    n = 0
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for _ in f:
                n += 1
    except Exception:
        pass
    return n


def read_log_slice(path, offset, limit):
    """分段读取日志：从 offset 行起取 limit 行，返回 (行列表, 是否还有更多)。
    只遍历到所需位置，不一次性读入整个文件。"""
    collected, more = [], False
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            n = 0
            for line in f:
                if n < offset:
                    n += 1
                    continue
                if len(collected) < limit:
                    collected.append(line.rstrip("\n"))
                    n += 1
                    continue
                more = True          # 已取满一页，确认后面还有内容
                break
    except Exception:
        pass
    return collected, more


def read_log_dir(raw):
    """列出日志目录下的 .log 文件（仅元数据：名称/大小/行数，不含内容）。
    供详情页首次请求；内容由前端按需分段拉取，避免大文件一次性返回导致卡死。"""
    if not raw:
        return {"ok": False, "error": "缺少目录参数", "logs": []}
    if not is_allowed(raw):
        return {"ok": False, "error": "目录不在允许的日志根范围内", "logs": []}
    p = os.path.normpath(raw)
    if not os.path.isdir(p):
        return {"ok": False, "error": "目录不存在或无法访问（请确认本机已连接对应局域网共享）", "logs": []}
    logs = []
    try:
        for fn in sorted(os.listdir(p)):
            fp = os.path.join(p, fn)
            if not os.path.isfile(fp) or not fn.lower().endswith(".log"):
                continue
            try:
                size = os.path.getsize(fp)
                lines = count_lines(fp)
                logs.append({"name": fn, "size": size, "lines": lines})
            except Exception as e:
                logs.append({"name": fn, "size": 0, "lines": 0, "error": str(e)})
    except Exception as e:
        return {"ok": False, "error": "读取目录失败：%s" % e, "logs": []}
    return {"ok": True, "error": "", "logs": logs}


def read_log_file_slice(raw, fn, offset, limit):
    """分段读取单个 .log 文件内容（供详情页"加载更多"逐段拉取）。
    严格校验文件落在允许目录内，杜绝目录穿越。"""
    if not raw or not fn:
        return {"ok": False, "error": "缺少目录或文件参数"}
    if not is_allowed(raw):
        return {"ok": False, "error": "目录不在允许的日志根范围内"}
    p = os.path.normpath(raw)
    if not os.path.isdir(p):
        return {"ok": False, "error": "目录不存在或无法访问"}
    fp = os.path.normpath(os.path.join(p, fn))
    if fp != p and not fp.startswith(p + os.sep):
        return {"ok": False, "error": "非法文件名"}
    if not os.path.isfile(fp) or not fn.lower().endswith(".log"):
        return {"ok": False, "error": "文件不存在或非日志文件"}
    try:
        size = os.path.getsize(fp)
        collected, has_more = read_log_slice(fp, offset, limit)
        return {"ok": True, "error": "", "name": fn, "size": size,
                "offset": offset, "limit": limit,
                "lines": len(collected), "hasMore": has_more,
                "content": "\n".join(collected)}
    except Exception as e:
        return {"ok": False, "error": "读取失败：%s" % e}



class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def end_headers(self):
        # 页面数据每分钟刷新，禁用缓存避免浏览器拿到旧版本
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path0 = self.path.split("?")[0]
        if path0 == "/login":
            return self.handle_login_get()
        if not self._authorized():
            if path0.startswith("/api/"):
                return self._send_401({"error": "unauthorized", "message": "需要访问密码"})
            return self._send_login_page()
        if self.path in ("/", ""):
            self.path = "/analysis.html"
            return super().do_GET()
        if path0 == "/api/log":
            self.handle_log_fetch()
            return
        return super().do_GET()

    def do_POST(self):
        path0 = self.path.split("?")[0]
        if path0 == "/login":
            return self.handle_login_post()
        if path0 == "/api/refresh":
            if not self._authorized():
                return self._send_401({"error": "unauthorized", "message": "需要访问密码"})
            self.handle_refresh()
            return
        self.send_error(404, "Not Found")

    def handle_refresh(self):
        """网页每分钟请求一次：若 60 秒内已爬取过则跳过，直接返回最新数据。
        run_refresh 失败（如登录态过期且无法重新登录）时如实返回 ok=False，
        客户端据此提示刷新失败，而不是误以为成功、一直显示陈旧数据。"""
        now = time.time()
        skipped = False
        ok = True
        error = ""
        if now - LAST_REFRESH[0] < REFRESH_INTERVAL:
            skipped = True
        else:
            ok = run_refresh()
            if ok:
                LAST_REFRESH[0] = time.time()
            else:
                error = "刷新失败，详见 output/update_log.txt"
        records = load_run_records()
        payload = {
            "ok": ok,
            "skipped": skipped,
            "count": len(records),
            "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "error": error,
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

    def handle_error(self, request, client_address):
        import sys
        exc = sys.exc_info()[1]
        # 客户端中途断开连接（关标签页 / 网络中断 / 跨设备访问时对方关闭）属正常情况，
        # 典型为 WinError 10053 / BrokenPipe / ConnectionReset；静默忽略，避免控制台刷满 traceback
        if isinstance(exc, (ConnectionAbortedError, BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)

    def handle_log_fetch(self):
        """详情页实时读取日志，支持分段获取：
        - 列表模式 ?dir=<目录>：返回该目录下所有 .log 文件的元数据（名称/大小/行数），不含内容；
        - 分段模式 ?dir=<目录>&file=<文件名>&offset=<行号>&limit=<行数>：返回该文件某一页内容。
        内容改为前端按需分段拉取，避免超长日志一次性返回导致浏览器卡死。"""
        q = parse_qs(urlparse(self.path).query)
        raw = unquote(q.get("dir", [""])[0])
        fn = unquote(q.get("file", [""])[0])
        if fn:
            try:
                offset = int(q.get("offset", ["0"])[0])
            except Exception:
                offset = 0
            try:
                limit = int(q.get("limit", [str(LOG_PAGE)])[0])
            except Exception:
                limit = LOG_PAGE
            if offset < 0:
                offset = 0
            if limit <= 0 or limit > MAX_PAGE:
                limit = LOG_PAGE
            payload = read_log_file_slice(raw, fn, offset, limit)
        else:
            payload = read_log_dir(raw)
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    # ---- 访问密码保护 ----
    def _provided_pwd(self):
        cookies = {}
        c = self.headers.get("Cookie", "")
        for part in c.split(";"):
            part = part.strip()
            if "=" in part:
                k, v = part.split("=", 1)
                cookies[k.strip()] = v
        if COOKIE_NAME in cookies:
            return cookies[COOKIE_NAME]
        q = parse_qs(urlparse(self.path).query)
        return unquote(q.get("pwd", [""])[0])

    def _authorized(self):
        if not ACCESS_PASSWORD:
            return True
        return self._provided_pwd() == ACCESS_PASSWORD

    def _send_401(self, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(401)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_login_page(self, error=""):
        page = (
            "<!doctype html><html lang='zh'><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>访问验证</title><style>"
            "body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;"
            "background:#0f1115;color:#e6e6e6;font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif}"
            ".box{background:#181b21;border:1px solid #262a33;border-radius:12px;padding:28px 32px;width:300px;text-align:center}"
            "h2{margin:0 0 6px;font-size:18px;font-weight:600}.sub{color:#8b8f98;font-size:13px;margin-bottom:18px}"
            "input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid #343a45;"
            "background:#0f1115;color:#e6e6e6;font-size:14px;margin-bottom:12px;outline:none}"
            "input:focus{border-color:#4a90d9}"
            "button{width:100%;padding:10px;border:0;border-radius:8px;background:#4a90d9;color:#fff;"
            "font-size:14px;cursor:pointer}"
            "button:hover{background:#5a9ee6}.err{color:#ff6b6b;font-size:13px;margin-bottom:12px;min-height:16px}"
            "</style></head><body><div class='box'>"
            "<h2>仪表盘访问验证</h2><div class='sub'>请输入访问密码</div>"
            "<form method='post' action='/login'>"
            "<div class='err'>__ERR__</div>"
            "<input type='password' name='pwd' placeholder='访问密码' autofocus>"
            "<button type='submit'>进入</button></form></div></body></html>"
        ).replace("__ERR__", error)
        body = page.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _do_login(self, pwd):
        if ACCESS_PASSWORD and pwd == ACCESS_PASSWORD:
            body = ("<html><body style='font-family:sans-serif;background:#0f1115;color:#e6e6e6;"
                    "text-align:center;padding-top:90px'><h3>验证成功，正在跳转…</h3>"
                    "<script>setTimeout(function(){location.href='/'},700)</script></body></html>"
                    ).encode("utf-8")
            self.send_response(302)
            self.send_header("Location", "/")
            self.send_header("Set-Cookie",
                             "%s=%s; Path=/; Max-Age=2592000; HttpOnly" % (COOKIE_NAME, pwd))
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return True
        return False

    def handle_login_get(self):
        q = parse_qs(urlparse(self.path).query)
        pwd = unquote(q.get("pwd", [""])[0])
        if pwd:
            if self._do_login(pwd):
                return
            return self._send_login_page("密码错误")
        return self._send_login_page()

    def handle_login_post(self):
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            raw = self.rfile.read(length).decode("utf-8", "replace")
        except Exception:
            raw = ""
        qs = parse_qs(raw)
        pwd = qs.get("pwd", [""])[0]
        if self._do_login(pwd):
            return
        return self._send_login_page("密码错误")

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
                "name": r.get("flow_name") or r.get("trigger_name") or "运行记录",
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
                out = (r.stdout or "")
                # 登录态失效且重新登录失败：crawler 会打印 [AUTH_FAILED]（此时退出码为 0，不会中断服务器启动），
                # 这里据此把刷新判为失败，让网页提示「刷新失败」而不是误以为成功。
                if r.returncode != 0 or "[AUTH_FAILED]" in out:
                    with open(log, "a", encoding="utf-8") as f:
                        f.write("[%s] 刷新失败: %s\n%s\n" % (
                            datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                            " ".join(cmd), (out + (r.stderr or ""))[-600:]))
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
        if ACCESS_PASSWORD:
            print("  访问密码:   已启用（config.json -> access_password，登录后 Cookie 30 天有效）")
        else:
            print("  访问密码:   未启用（config.json 无 access_password 字段，任何人可访问）")
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
