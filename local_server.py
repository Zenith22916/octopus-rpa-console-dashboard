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
import re
import os
import socket
import socketserver
import subprocess
import sys
import threading
import time
from urllib.parse import urlparse, parse_qs, unquote

import dashboard  # 数据聚合层（load_records / build_schedule_payload）
import octo_api    # 八爪鱼调度 API（详情页"重新运行"）
import feishu_cfg  # 飞书多维表格配置中心读写（项目全览页）

PORT = 8000
BASE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(BASE, "output")
WEB = os.path.join(BASE, "web")        # 前端静态目录（前后端分离：index.html/app.js/style.css）
ECHARTS = os.path.join(BASE, "assets", "echarts.min.js")
UPDATE_HOUR, UPDATE_MINUTE = 12, 0   # 每天完整更新时间
REFRESH_INTERVAL = 60                # 网页触发刷新去重窗口（秒）：1 分钟内已爬过则跳过
LAST_REFRESH = [0.0]                 # 上次实际爬取运行记录的时间戳（节流状态）
LAST_UPDATE_TIME = [""]              # 数据源最后成功爬取完成时刻（"YYYY-MM-DD HH:MM:SS"）；节流跳过不更新
UPDATE_LOCK = threading.Lock()       # 防止完整更新与快速刷新并发写 output
LOG_PAGE = 2000                      # 日志分段获取：每页行数（前端"加载更多"逐段拉取，避免大文件卡死）
MAX_PAGE = 20000                     # 单页行数上限（防止恶意超大 limit）

RECORDS = []                         # 运行记录内存缓存（启动/刷新/每日更新后重载，前端 /api/runs 读取）


def now_text():
    """当前时间的展示格式。"""
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def stamp_data_time():
    """数据源成功爬取完成时调用：记录此刻为“数据获取”时间。"""
    LAST_UPDATE_TIME[0] = now_text()


def _init_data_time_from_file():
    """启动时以 runs_normalized.csv 的修改时间作为“数据源爬取完成时刻”（服务器刚起、尚未爬取过）。"""
    try:
        p = os.path.join(DIR, "runs_normalized.csv")
        if os.path.exists(p):
            LAST_UPDATE_TIME[0] = datetime.datetime.fromtimestamp(
                os.path.getmtime(p)).strftime("%Y-%m-%d %H:%M:%S")
            return
    except Exception:
        pass
    LAST_UPDATE_TIME[0] = now_text()


def load_feishu_cfg():
    """从 config.json 读取 feishu 段（app_id/app_secret/app_token/table_id）。"""
    p = os.path.join(BASE, "config.json")
    if os.path.exists(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f).get("feishu", {})
        except Exception:
            pass
    return {}


FEISHU_CFG = load_feishu_cfg()       # 飞书多维表格配置中心凭据（项目全览页用）


def reload_records():
    """从 runs_normalized.csv 重载运行记录到内存（含日志目录解析）。"""
    global RECORDS
    RECORDS = dashboard.load_records(DIR)
    return RECORDS


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


def read_log_text(path):
    """读取日志文件完整文本（utf-8 容错解码）。供 full=1 全量加载使用。"""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except Exception:
        try:
            with open(path, "rb") as f:
                return f.read().decode("utf-8", errors="replace")
        except Exception:
            return ""


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


def read_log_dir(raw, full=False):
    """列出日志目录下的 .log 文件。默认仅元数据（名称/大小/行数）；
    full=True 时附带完整内容（一次性全量返回，供"不分段加载"测试使用）。"""
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
                item = {"name": fn, "size": size, "lines": lines}
                if full:
                    item["content"] = read_log_text(fp)
                logs.append(item)
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
        super().__init__(*args, directory=WEB, **kwargs)

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
            self.path = "/index.html"
            return super().do_GET()
        if path0 == "/echarts.min.js":
            return self._serve_echarts()
        if path0 == "/api/log":
            self.handle_log_fetch()
            return
        if path0 == "/api/runs":
            self.handle_api_runs()
            return
        if path0 == "/api/run":
            self.handle_api_run()
            return
        if path0 == "/api/schedule":
            self.handle_api_schedule()
            return
        if path0 == "/api/projects":
            self.handle_api_projects()
            return
        if path0 == "/api/projects/config":
            self.handle_projects_config_get()
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
        if path0 == "/api/rerun":
            if not self._authorized():
                return self._send_401({"error": "unauthorized", "message": "需要访问密码"})
            return self.handle_rerun()
        if path0 == "/api/projects/config":
            if not self._authorized():
                return self._send_401({"error": "unauthorized", "message": "需要访问密码"})
            return self.handle_projects_config_post()
        if path0 == "/api/projects/run":
            if not self._authorized():
                return self._send_401({"error": "unauthorized", "message": "需要访问密码"})
            return self.handle_projects_run()
        self.send_error(404, "Not Found")

    def handle_refresh(self):
        """网页每分钟请求一次：若 60 秒内已爬取过则跳过，直接返回最新数据。
        带 ?force=1（标题栏"立刻更新"按钮）时忽略 60 秒节流，立即爬取。
        run_refresh 失败（如登录态过期且无法重新登录）时如实返回 ok=False，
        客户端据此提示刷新失败，而不是误以为成功、一直显示陈旧数据。"""
        q = parse_qs(urlparse(self.path).query)
        force = q.get("force", ["0"])[0].lower() in ("1", "true", "yes")
        now = time.time()
        skipped = False
        ok = True
        error = ""
        if not force and now - LAST_REFRESH[0] < REFRESH_INTERVAL:
            skipped = True
        else:
            ok = run_refresh()
            if ok:
                LAST_REFRESH[0] = time.time()
            else:
                error = "刷新失败，详见 output/update_log.txt"
        records = reload_records()
        payload = {
            "ok": ok,
            "skipped": skipped,
            "count": len(records),
            "time": LAST_UPDATE_TIME[0] or now_text(),
            "error": error,
            "records": records,
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_rerun(self):
        """POST /api/rerun：手动触发应用重新运行。

        请求体: {"flow_id": "...", "bot_id": "可选"}
        成功返回 {"ok": true, "flowProcessNo": "批次号"}。
        """
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except Exception:
            body = {}
        flow_id = str(body.get("flow_id") or "").strip()
        if not flow_id:
            return self._send_json({"ok": False, "message": "缺少 flow_id"}, 400)
        try:
            cfg_path = os.path.join(BASE, "config.json")
            with open(cfg_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            result = octo_api.start_flow(cfg, flow_id, bot_id=body.get("bot_id") or None)
            pno = result.get("processNo", "") if isinstance(result, dict) else result
            bot = result.get("botId") if isinstance(result, dict) else None
            return self._send_json({"ok": True, "flowId": flow_id,
                                    "flowProcessNo": str(pno),
                                    "botId": bot})
        except Exception as e:
            return self._send_json({"ok": False, "message": str(e)}, 502)

    # ---- 项目全览：列表 / 配置读写 / 运行 ----
    def handle_api_projects(self):
        """GET /api/projects：全项目（流程）列表 + 每个项目的配置组映射。

        项目列表来自八爪鱼 flows 接口；配置组映射存配置中心
        （group=project 组，key=p.<flowId>，value=配置组名）。
        """
        try:
            with open(os.path.join(BASE, "config.json"), "r", encoding="utf-8") as f:
                cfg = json.load(f)
            flows = octo_api.list_flows(cfg)
        except Exception as e:
            return self._send_json({"ok": False, "error": "拉取项目列表失败：%s" % e})
        proj_map = {}
        if FEISHU_CFG.get("app_token"):
            try:
                for it in feishu_cfg.get_group_items(FEISHU_CFG, "project"):
                    if it["key"].startswith("p."):
                        proj_map[it["key"][2:]] = it["value"]
            except Exception:
                pass
        for f in flows:
            f["group"] = proj_map.get(f["flow_id"], "")
        return self._send_json({"ok": True, "items": flows})

    def handle_projects_config_get(self):
        """GET /api/projects/config?group=xxx：读取某配置组的全部配置项。"""
        q = parse_qs(urlparse(self.path).query)
        group = unquote(q.get("group", [""])[0]).strip()
        if not FEISHU_CFG.get("app_token"):
            return self._send_json({"ok": False, "error": "config.json 未配置 feishu 段"})
        if not group:
            return self._send_json({"ok": False, "error": "缺少 group 参数"})
        try:
            items = feishu_cfg.get_group_items(FEISHU_CFG, group)
            return self._send_json({"ok": True, "group": group, "items": items})
        except Exception as e:
            return self._send_json({"ok": False, "error": str(e)})

    def handle_projects_config_post(self):
        """POST /api/projects/config：新增/更新配置项。

        请求体 {"group","key","value","type","desc"}；按 group+key 定位，存在则更新、否则新增。
        另支持 {"group":"project","key":"p.<flowId>","value":"<配置组>"} 修改项目↔配置组映射。
        """
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except Exception:
            body = {}
        group = str(body.get("group") or "").strip()
        key = str(body.get("key") or "").strip()
        if not group or not key:
            return self._send_json({"ok": False, "error": "缺少 group/key"})
        # ---- 格式校验与规范化 ----
        type_ = str(body.get("type") or "string").strip()
        if type_ not in ("string", "number", "bool", "json"):
            return self._send_json({"ok": False, "error": "type 必须是 string/number/bool/json 之一"})
        if not re.match(r"^[A-Za-z0-9._-]+$", key):
            return self._send_json({"ok": False, "error": "key 只能含字母/数字/._-，且不能为空"})
        if not re.match(r"^[A-Za-z0-9._-]+$", group):
            return self._send_json({"ok": False, "error": "group 只能含字母/数字/._-，且不能为空"})
        raw_value = str(body.get("value") or "").strip()
        try:
            if type_ == "json":
                obj = json.loads(raw_value)
                # 规范化：紧凑单行存储（前端展示时再格式化）
                raw_value = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
            elif type_ == "number":
                float(raw_value)   # 仅校验可转数字，原样存
            elif type_ == "bool":
                if raw_value.lower() not in ("true", "false", "1", "0"):
                    return self._send_json({"ok": False, "error": "bool 值必须是 true/false"})
                raw_value = raw_value.lower() in ("true", "1") and "true" or "false"
        except ValueError:
            return self._send_json({"ok": False, "error": "value 不符合 %s 类型格式" % type_})
        # desc 回写去掉换行（转单行），避免表格内嵌换行符
        desc = str(body.get("desc") or "").replace("\r", " ").replace("\n", " ")
        desc = re.sub(r"[ \t]+", " ", desc).strip() or None
        try:
            r = feishu_cfg.upsert_item(FEISHU_CFG, group, key, raw_value, type_, desc)
            return self._send_json(r)
        except Exception as e:
            return self._send_json({"ok": False, "error": str(e)})

    def handle_projects_run(self):
        """POST /api/projects/run：操作机器人运行该应用。

        请求体 {"flow_id", "bot_id"?}；机器人未指定时自动复用该流程历史成功运行的机器人。
        """
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except Exception:
            body = {}
        flow_id = str(body.get("flow_id") or "").strip()
        if not flow_id:
            return self._send_json({"ok": False, "message": "缺少 flow_id"}, 400)
        try:
            with open(os.path.join(BASE, "config.json"), "r", encoding="utf-8") as f:
                cfg = json.load(f)
            result = octo_api.start_flow(cfg, flow_id, bot_id=body.get("bot_id") or None)
            pno = result.get("processNo", "") if isinstance(result, dict) else result
            return self._send_json({"ok": True, "flowId": flow_id,
                                    "flowProcessNo": str(pno),
                                    "botId": result.get("botId") if isinstance(result, dict) else None})
        except Exception as e:
            return self._send_json({"ok": False, "message": str(e)}, 502)

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
            full = q.get("full", ["0"])[0] == "1"
            payload = read_log_dir(raw, full=full)
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _serve_echarts(self):
        """提供本地 echarts.min.js（assets/ 下，前端离线可用，不依赖 CDN）。"""
        try:
            with open(ECHARTS, "rb") as f:
                data = f.read()
        except Exception:
            self.send_error(404, "echarts.min.js not found")
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/javascript; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def handle_api_runs(self):
        """GET /api/runs：返回运行记录（时间轴/分析视图共用），数据来自内存缓存。"""
        payload = {"ok": True, "records": RECORDS, "count": len(RECORDS),
                   "time": LAST_UPDATE_TIME[0] or now_text()}
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def handle_api_run(self):
        """GET /api/run?id=<rid>：返回单条运行记录详情（含日志目录路径）。"""
        q = parse_qs(urlparse(self.path).query)
        rid = unquote(q.get("id", [""])[0])
        rec = None
        if rid:
            for r in RECORDS:
                if r.get("id") == rid:
                    rec = r
                    break
        payload = {"ok": rec is not None, "rec": rec}
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def handle_api_schedule(self):
        """GET /api/schedule：触发器日程表数据（周/月视图 + 统计）。"""
        path = os.path.join(DIR, "triggers_normalized.csv")
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8-sig") as f:
                    rows = list(csv.DictReader(f))
                payload = dashboard.build_schedule_payload(rows)
            except Exception as e:
                payload = {"ok": False, "error": "日程数据聚合失败：%s" % e}
        else:
            payload = {"ok": False, "error": "缺少 triggers_normalized.csv"}
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


def run_update():
    """执行完整更新流程：抓取 -> 整理文档（数据进内存缓存，不生成 HTML）。
    日志写 output/update_log.txt。"""
    with UPDATE_LOCK:
        py = sys.executable
        log = os.path.join(DIR, "update_log.txt")
        commands = [
            [py, "crawler.py", "--config", "config.json", "--out", "output"],
            [py, "organize.py", "--input", os.path.join("output", "triggers_normalized.csv"), "--out", "output"],
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
        reload_records()   # 完整更新后刷新内存缓存
        stamp_data_time()  # 每日完整更新成功：刷新“数据获取”时间


def run_refresh():
    """快速刷新：运行记录（最近 7 天，手动/定时/Webhook 全部触发方式），由网页 /api/refresh 触发。
    数据进入内存缓存（reload_records），不再生成任何 HTML。成功仅打印一行时间戳；
    失败把摘要写入 update_log.txt。返回 True=成功 False=失败。"""
    with UPDATE_LOCK:
        py = sys.executable
        log = os.path.join(DIR, "update_log.txt")
        cmds = [
            [py, "crawler.py", "--config", "config.json", "--out", "output",
             "--only-runs", "--days", "7"],
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
            stamp_data_time()   # 爬取成功：记录“数据获取”时间
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
    reload_records()   # 启动时把运行记录读入内存缓存（/api/runs、/api/run 数据源）
    _init_data_time_from_file()   # “数据获取”时间初始为数据文件生成时刻
    print("[启动] 运行记录 %d 条已载入内存" % len(RECORDS))
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
