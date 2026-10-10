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
from urllib.parse import urlparse, parse_qs, unquote, quote

import dashboard    # 数据聚合层（load_records / build_schedule_payload / build_schedule_export）
import octo_api     # 八爪鱼调度 API（详情页"重新运行" + underway 实时轮询）
import feishu_cfg   # 飞书多维表格配置中心读写（项目全览页）
import xlsx_writer  # 排期导出：纯标准库拼 xlsx（build_xlsx）
import db           # MySQL 持久层（运行记录入库，config.json -> mysql 段，未配置时静默跳过）

PORT = 8000
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # 项目根
DIR = os.path.join(BASE, "output")
WEB = os.path.join(BASE, "web")        # 前端静态目录（前后端分离：index.html/app.js/style.css）
ECHARTS = os.path.join(BASE, "assets", "echarts.min.js")
MONACO_ROOT = os.path.join(BASE, "assets", "monaco")         # Monaco Editor（日志高亮，离线自托管；URL /monaco/vs/... → assets/monaco/vs/...）
UPDATE_HOUR, UPDATE_MINUTE = 12, 0   # 每天完整更新时间
LAST_UPDATE_TIME = [""]              # 数据源最后成功爬取完成时刻（"YYYY-MM-DD HH:MM:SS"）；节流跳过不更新
UPDATE_LOCK = threading.Lock()       # 防止完整更新与快速刷新并发写 output
LOG_PAGE = 5000                      # 日志分段获取：每页行数（前端"加载更多"逐段拉取，避免大文件卡死）
MAX_PAGE = 20000                     # 单页行数上限（防止恶意超大 limit）

# ---- 数据真相源：MySQL ----
# 运行记录不再进内存：crawler 增量/全量抓到后直接 upsert 入库（db.upsert_raw_runs），
# 前端各接口按需查库（db.fetch_records/fetch_run_by_pno），CSV 只是全量快照备份。

# ---- 运行记录实时轮询（桌面客户端 runningRecords 接口）----
# 桌面客户端以固定频率轮询"运行中"记录（纯 REST 轮询、无推送）。这里每 6 秒
# 拉一页 runningRecords（最新 50 条，Executing/Finished 全状态）upsert 入库，
# 在途与终态一次同步——库即最新状态，无内存态。
UNDERWAY_INTERVAL = 6                # 轮询间隔（秒）
LAST_UNDERWAY_TS = [0.0]             # 上一轮成功时间戳；0 = 从未成功（前端 live.ok=False）


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


def _db_records_from_rows(rows):
    """db.fetch_records()/fetch_run_by_pno 的原始行 -> 前端/dashboard 同构记录。

    日志目录按 robot_logs.json 映射推算（与原 load_records 同规则）。
    """
    logmap = None
    out = []
    for r in rows:
        fid = r.get("flow_id") or ""
        pno = str(r.get("process_no") or "")
        start = r.get("start_ms")
        if not pno or not start:
            continue
        robot = r.get("bot_name") or "(未指定机器人)"
        if logmap is None:
            logmap = dashboard.load_logmap()
        iso_start = datetime.datetime.fromtimestamp(
            start / 1000, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "+00:00"
        log_path, log_ok = dashboard.resolve_log_dir(
            robot, iso_start, pno, r.get("flow_name"), logmap)
        out.append({
            "id": dashboard.file_safe_id(fid, pno),
            "fid": fid,
            "pno": pno,
            "robot": robot,
            "name": r.get("flow_name") or r.get("trigger_name") or "运行记录",
            "app": r.get("flow_name") or "",
            "trigger": r.get("trigger_name") or "",
            "start": start,
            "end": r.get("end_ms"),
            "status": r.get("status") or "",
            "execStart": r.get("exec_start_ms"),
            "way": r.get("start_way") or "",
            "log": log_path,
            "logOk": log_ok,
        })
    return out


def _db_records(limit=None, since_ms=None):
    """从 MySQL 查运行记录并组装成前端/dashboard 同构的记录列表。

    数据库是唯一真相源：在途记录（end 为空）与终态由轮询线程写入，
    同 process_no 永远只有一行、且是最新状态。
    limit 给定时只取最新 N 条（前端 5s 轻量刷新用）；
    since_ms 给定时只取与「now-since_ms ~ now」有交集的记录（前端总长范围刷新用）。
    """
    return _db_records_from_rows(db.fetch_records(limit=limit, since_ms=since_ms))


def load_log_roots():
    """允许读取的日志根目录白名单（防任意文件读取）：来自 config.json -> robot_logs 段。"""
    return list(dashboard.load_logmap().values())


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


def _resolve_log_file(raw, fn):
    """校验日志目录与文件名，返回 (文件绝对路径, 错误信息)。
    严格限制文件落在允许的日志根目录内，杜绝目录穿越。"""
    if not raw or not fn:
        return None, "缺少目录或文件参数"
    if not is_allowed(raw):
        return None, "目录不在允许的日志根范围内"
    p = os.path.normpath(raw)
    if not os.path.isdir(p):
        return None, "目录不存在或无法访问"
    fp = os.path.normpath(os.path.join(p, fn))
    if fp != p and not fp.startswith(p + os.sep):
        return None, "非法文件名"
    if not os.path.isfile(fp) or not fn.lower().endswith(".log"):
        return None, "文件不存在或非日志文件"
    return fp, ""


def read_log_file_slice(raw, fn, offset, limit):
    """分段读取单个 .log 文件内容（供详情页"加载更多"逐段拉取）。"""
    fp, err = _resolve_log_file(raw, fn)
    if err:
        return {"ok": False, "error": err}
    try:
        size = os.path.getsize(fp)
        collected, has_more = read_log_slice(fp, offset, limit)
        return {"ok": True, "error": "", "name": fn, "size": size,
                "offset": offset, "limit": limit,
                "lines": len(collected), "hasMore": has_more,
                "content": "\n".join(collected)}
    except Exception as e:
        return {"ok": False, "error": "读取失败：%s" % e}


def read_log_refresh_slice(raw, fn, offset, limit):
    """刷新当前日志文件（详情页「刷新」按钮）：从 offset 行起取一页，并额外返回
    锚点行与当前总行数，供前端安全地做增量追加。

    - anchor = 第 offset 行内容。前端拿它和「已加载的最后一行」比对：一致说明文件
      只是在尾部追加，可以把新行接到模型末尾（滚动位置与搜索状态都不受影响）；
      不一致说明文件被重写/轮转/变短，前端退回整段重载，避免新旧内容错接。
    - total 必须扫完整个文件才能得到，而 read_log_file_slice 取满一页就停，
      所以刷新单独走这个函数（不为此给每次翻页都加一遍全文件扫描）。"""
    fp, err = _resolve_log_file(raw, fn)
    if err:
        return {"ok": False, "error": err}
    try:
        size = os.path.getsize(fp)
        collected, anchor, total = [], None, 0
        with open(fp, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                total += 1
                if total <= offset:
                    anchor = line.rstrip("\n")   # 逐行覆盖，循环结束时即第 offset 行
                    continue
                if len(collected) < limit:
                    collected.append(line.rstrip("\n"))
        return {"ok": True, "error": "", "name": fn, "size": size,
                "offset": offset, "limit": limit, "total": total,
                "anchor": anchor, "lines": len(collected),
                "hasMore": total > offset + len(collected),
                "content": "\n".join(collected)}
    except Exception as e:
        return {"ok": False, "error": "读取失败：%s" % e}



# 行级别判定（与前端 app.js 的 LG_RE 同一套语义：1=错误 2=警告 3=成功 0=普通）
LOG_LEVEL_RE = re.compile(
    r"(error|exception|traceback|fail(?:ed)?|fatal|失败|错误|异常|中断|中止)"
    r"|(warn(?:ing)?|timeout|retry|警告|重试|超时(?![\[0-9]))"
    r"|(success(?:ful)?|succeed|done|finish(?:ed)?|成功|完成)", re.I)
LOG_LEVEL_EXC = re.compile(r"(已启用异常监控|触发错误处理的|忽略异常并执行)")


def log_line_level(line):
    """按与前端一致的关键词规则判定单行级别：1 错误 / 2 警告 / 3 成功 / 0 普通。"""
    if not line or len(line) > 20000:
        return 0
    if LOG_LEVEL_EXC.search(line):
        return 0
    lv = 0
    for m in LOG_LEVEL_RE.finditer(line):
        c = 1 if m.group(1) else (2 if m.group(2) else 3)
        if c == 1:
            return 1
        if lv == 0 or c < lv:
            lv = c
    return lv


SEARCH_SNIPPET = 240       # 命中行片段宽度（超长行以关键词为中心截取）
SEARCH_MAX_HITS = 400      # 单次检索最多返回的命中数
SEARCH_MAX_RECORDS = 60    # 单次检索最多扫描的运行记录数
SEARCH_MAX_LINES = 400000  # 单次检索最多扫描的行数（防止海量日志把请求拖死）


def _search_snippet(line, pos, kw_len, width=SEARCH_SNIPPET):
    """把命中行截成以关键词为中心的片段（超长行首尾加省略号）。"""
    s = line.rstrip("\n").rstrip()
    if len(s) <= width:
        return s
    half = max(0, (width - kw_len) // 2)
    start = max(0, pos - half)
    end = min(len(s), start + width)
    start = max(0, end - width)
    return ("…" if start > 0 else "") + s[start:end] + ("…" if end < len(s) else "")


def search_logs(records, kw, robot="", days=7, only_lvl=None,
                max_hits=SEARCH_MAX_HITS, max_records=SEARCH_MAX_RECORDS,
                max_lines=SEARCH_MAX_LINES):
    """在运行记录对应的共享日志目录里按关键词检索（仅限白名单根目录内的 .log）。

    只扫「日志目录确实存在」的记录（load_records 已解析出 logOk），按时间倒序逐条扫描；
    受 max_records / max_lines / max_hits 三重上限约束，命中或扫满即停并置 truncated=True。
    only_lvl：None=所有行；1=只要错误行；2=错误 + 警告行（放在后端过滤，
    否则「超时」这类关键词会被 [0/3000] 等待进度噪声占满名额，真正的错误反而被截断）。
    返回 {ok, hits, scanned:{records,files,lines}, truncated, candidates}。
    """
    kw_low = str(kw or "").lower()
    now_ms = int(time.time() * 1000)
    since = now_ms - int(days) * 86400000

    cands = []
    for r in records:
        if not r.get("start") or r["start"] < since:
            continue
        if not r.get("log") or not r.get("logOk"):
            continue
        if robot and robot != "__ALL__" and (r.get("robot") or "") != robot:
            continue
        cands.append(r)
    cands.sort(key=lambda r: r["start"], reverse=True)

    hits, scanned = [], {"records": 0, "files": 0, "lines": 0}
    truncated = stop = False

    for r in cands:
        if stop:
            break
        if scanned["records"] >= max_records:
            truncated = True
            break
        d = os.path.normpath(r["log"])
        if not is_allowed(d):
            continue
        try:
            if not os.path.isdir(d):
                continue
            names = sorted(fn for fn in os.listdir(d) if fn.lower().endswith(".log"))
        except Exception:
            continue
        scanned["records"] += 1
        for fn in names:
            if stop:
                break
            fp = os.path.normpath(os.path.join(d, fn))
            if not fp.startswith(d + os.sep) or not os.path.isfile(fp):
                continue
            scanned["files"] += 1
            try:
                with open(fp, "r", encoding="utf-8", errors="replace") as f:
                    for ln, line in enumerate(f, 1):
                        scanned["lines"] += 1
                        if scanned["lines"] >= max_lines:
                            truncated = stop = True
                            break
                        pos = line.lower().find(kw_low)
                        if pos < 0:
                            continue
                        lv = log_line_level(line)
                        # 级别筛选：1=只看错误；2=错误 + 警告
                        if only_lvl == 1 and lv != 1:
                            continue
                        if only_lvl == 2 and lv not in (1, 2):
                            continue
                        hits.append({
                            "rid": r.get("id"), "robot": r.get("robot") or "",
                            "name": r.get("name") or r.get("app") or "",
                            "start": r.get("start"), "status": r.get("status") or "",
                            "file": fn, "line": ln,
                            "lvl": lv,
                            "text": _search_snippet(line, pos, len(kw_low)),
                        })
                        if len(hits) >= max_hits:
                            truncated = stop = True
                            break
            except Exception:
                continue

    return {"ok": True, "hits": hits, "scanned": scanned, "truncated": truncated,
            "candidates": len(cands)}


def _rgba_to_hex(rgba, bg=255):
    """网页的 rgba(...) 半透明色 → Excel 实色（按 alpha 叠到底色上，默认白底）。"""
    m = re.match(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)", rgba or "")
    if not m:
        return "D9D9D9"
    a = float(m.group(4)) if m.group(4) else 1.0
    return "".join("%02X" % round(int(m.group(i)) * a + bg * (1 - a)) for i in (1, 2, 3))


def _sched_head_note(ex):
    """三张表共用的筛选说明行。"""
    return "筛选：%s　机器人：%s　状态：%s　导出时间：%s" % (
        ex["viewLabel"], ex["robotLabel"], ex["statusLabel"], ex["generated"])


def sheet_for_schedule_calendar(ex):
    """排期日历（第一张表）：行=时刻×应用，列=周几/日期，同应用的连续排期日合并成色块。

    版式对齐页面图表：一个色块 = 同一应用在该时刻的排期日（跨机器人合并，颜色取图表调色板），
    「时刻」列在同一时刻的多行之间纵向合并。空白格保留边框，整体就是一张日历。
    """
    cal = ex["calendar"]
    labels = cal["colLabels"]
    ncol = len(labels)
    week = cal["view"] != "month"

    # 每个应用色一个样式；「时刻」列用浅灰底把纵轴和日历格子区分开
    styles = {"timecell": {"fill": "F2F2F2", "color": "404040", "bold": True,
                           "align": "center", "border": True}}
    color_style = {}
    for r in cal["rows"]:
        hx = _rgba_to_hex(r["color"])
        if hx not in color_style:
            name = "c%d" % len(color_style)
            color_style[hx] = name
            styles[name] = {"fill": hx, "color": "0B0E13", "align": "center",
                            "border": True, "wrap": True}

    body, merges = [], []
    for i, r in enumerate(cal["rows"]):
        style = color_style[_rgba_to_hex(r["color"])]
        cells = [{"v": r["time"], "s": "timecell"}] + [None] * ncol
        for a, b in r["runs"]:
            for c in range(a, b + 1):
                # 合并区每格都写样式，非首格留空值
                cells[c + 1] = {"v": r["short"] if c == a else "", "s": style}
            if b > a:
                row_no = 4 + i
                merges.append("%s%d:%s%d" % (xlsx_writer.col_letter(a + 1), row_no,
                                             xlsx_writer.col_letter(b + 1), row_no))
        body.append(cells)

    i = 0
    while i < len(cal["rows"]):     # 同一时刻的行纵向合并「时刻」列
        j = i
        while j + 1 < len(cal["rows"]) and cal["rows"][j + 1]["time"] == cal["rows"][i]["time"]:
            j += 1
        if j > i:
            merges.append("A%d:A%d" % (4 + i, 4 + j))
        i = j + 1

    return {
        "name": "排期日历",
        "title": "触发器排期日历（%s）" % ex["viewLabel"],
        "note": _sched_head_note(ex) + "　共 %d 个时刻 / %d 行应用排期"
                "（色块=该应用在此刻的排期日，连续日期合并；灰色=已停用）"
                % (len({r["time"] for r in cal["rows"]}), len(cal["rows"])),
        "headers": ["时刻"] + labels,
        # 列宽按最长应用短名（「广告计划Listing」11 字）定，放不下时靠自动换行折成两行
        "widths": [10] + ([19] * ncol if week else [13] * ncol),
        "styles": styles,
        "rows": body,
        "merges": merges,
        "data_height": 30,
        "filter": False,      # 日历靠合并色块表达，不要自动筛选
    }


def sheet_for_schedule_detail(ex):
    """排期明细表：一行一个排期点（与图表同口径展开）。"""
    detail = [[d["no"], d["robot"], d["app"], d["trigger"], d["way"], d["kind"],
               d["day"], d["time"], d["enabled"], d["update"], d["tid"]]
              for d in ex["detail"]]
    return {
        "name": "排期明细",
        "title": "触发器排期明细（%s）" % ex["viewLabel"],
        "note": _sched_head_note(ex) + "　共 %d 条排期点" % len(detail),
        "headers": ["序号", "机器人", "应用", "触发器名", "触发方式", "周期类型",
                    "排期日", "触发时间", "状态", "更新时间", "触发器ID"],
        "widths": [6, 16, 34, 30, 10, 10, 12, 10, 9, 18, 26],
        "center": [0, 5, 8],
        "rows": detail,
    }


def sheet_for_schedule_summary(ex):
    """触发器汇总表：命中筛选的全部触发器（含 Webhook 与未排期项）。"""
    summary = [[t["robot"], t["app"], t["trigger"], t["way"], t["kind"], t["plan"],
                t["enabled"], t["update"], t["tid"]]
               for t in ex["triggers"]]
    return {
        "name": "触发器汇总",
        "title": "触发器汇总（%s，不受视图限制）" % ex["robotLabel"],
        "note": _sched_head_note(ex) + "　含 Webhook 与未排期触发器，共 %d 条" % len(summary),
        "headers": ["机器人", "应用", "触发器名", "触发方式", "周期类型", "排期描述",
                    "状态", "更新时间", "触发器ID"],
        "widths": [16, 34, 30, 10, 10, 46, 9, 18, 26],
        "center": [4, 6],
        "rows": summary,
    }


def sheets_for_schedule(ex):
    """导出工作簿：日历（主表） + 排期明细 + 触发器汇总。"""
    return [sheet_for_schedule_calendar(ex),
            sheet_for_schedule_detail(ex),
            sheet_for_schedule_summary(ex)]


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
        if path0.startswith("/monaco/"):
            return self._serve_monaco()
        if path0 == "/api/log":
            self.handle_log_fetch()
            return
        if path0 == "/api/runs":
            self.handle_api_runs()
            return
        if path0 == "/api/run":
            self.handle_api_run()
            return
        if path0 == "/api/bots":
            self.handle_api_bots()
            return
        if path0 == "/api/schedule/export":
            self.handle_api_schedule_export()
            return
        if path0 == "/api/schedule":
            self.handle_api_schedule()
            return
        if path0 == "/api/botstatus":
            self.handle_api_botstatus()
            return
        if path0 == "/api/compliance":
            self.handle_api_compliance()
            return
        if path0 == "/api/logsearch":
            self.handle_log_search()
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
        """POST /api/refresh —— 标题栏「立刻更新」按钮。

        force=1：立即全量爬取（运行记录 + 触发器排期），不受后台轮询节流影响，
        跑完把抓取结果直接入库（MySQL 为唯一真相源）并返回。失败（如登录态过期
        且无法重新登录）如实返回 ok=False，前端据此提示刷新失败。

        不带 force：只返回当前库中数据，不触发任何抓取（抓取由后台线程自动完成）。
        """
        q = parse_qs(urlparse(self.path).query)
        force = q.get("force", ["0"])[0].lower() in ("1", "true", "yes")
        ok, error = True, ""
        if force:
            ok = run_refresh()
            if not ok:
                error = "刷新失败，详见 output/update_log.txt"
        payload = {
            "ok": ok,
            "count": db.count_runs(),
            "time": LAST_UPDATE_TIME[0] or now_text(),
            "error": error,
            "records": _db_records(),
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
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

    def _json_body(self):
        """读取并解析请求体 JSON；缺失或解析失败返回 {}。"""
        try:
            length = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except Exception:
            return {}

    def _run_flow(self, body):
        """触发一次应用运行，返回 (响应体, HTTP 码)。

        body: {"flow_id", "bot_id"?}；bot_id 为空时自动复用该流程历史成功运行的机器人。
        """
        flow_id = str(body.get("flow_id") or "").strip()
        if not flow_id:
            return {"ok": False, "message": "缺少 flow_id"}, 400
        try:
            with open(os.path.join(BASE, "config.json"), "r", encoding="utf-8") as f:
                cfg = json.load(f)
            r = octo_api.start_flow(cfg, flow_id, bot_id=body.get("bot_id") or None)
            pno = r.get("processNo", "") if isinstance(r, dict) else r
            return {"ok": True, "flowId": flow_id, "flowProcessNo": str(pno),
                    "botId": r.get("botId") if isinstance(r, dict) else None,
                    "botName": r.get("botName") if isinstance(r, dict) else ""}, 200
        except Exception as e:
            return {"ok": False, "message": str(e)}, 502

    def handle_rerun(self):
        """POST /api/rerun：详情页「重新运行」。请求体 {"flow_id", "bot_id"?}。"""
        return self._send_json(*self._run_flow(self._json_body()))

    def handle_api_bots(self):
        """GET /api/bots?flow_id=：可选执行机器人清单（详情页/项目页「运行」弹窗）。

        排序为「本流程跑过的 → 在线可用 → 离线/停用」，recommended 标记本流程最近一次
        成功运行的机器人；离线/停用机器人仍返回，由前端置灰展示。
        """
        q = parse_qs(urlparse(self.path).query)
        flow_id = unquote(q.get("flow_id", [""])[0]).strip()
        try:
            with open(os.path.join(BASE, "config.json"), "r", encoding="utf-8") as f:
                cfg = json.load(f)
            d = octo_api.list_bots(cfg, flow_id)
            d["ok"] = True
            return self._send_json(d)
        except Exception as e:
            return self._send_json({"ok": False, "message": str(e), "items": []}, 502)

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
        """POST /api/projects/run：项目控制台「运行该应用」。
        请求体 {"flow_id", "bot_id"?}；机器人未指定时自动复用该流程历史成功运行的机器人。
        """
        return self._send_json(*self._run_flow(self._json_body()))

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
        - 分段模式 ?dir=<目录>&file=<文件名>&offset=<行号>&limit=<行数>：返回该文件某一页内容；
        - 刷新模式（在分段模式上加 &refresh=1）：额外返回 anchor（offset 行原文）与 total（当前总行数），
          供前端判断文件是「尾部追加」还是「被重写」，只刷新文件内容而不重建页面。
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
            if q.get("refresh", ["0"])[0] == "1":
                payload = read_log_refresh_slice(raw, fn, offset, limit)
            else:
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

    def _serve_monaco(self):
        """提供本地 Monaco Editor 静态资源（assets/monaco/vs/，日志只读高亮用）。
        库文件内容固定，允许浏览器长缓存；路径严格限制在 monaco 根内防穿越。"""
        rel = unquote(self.path[len("/monaco/"):].split("?")[0])
        fp = os.path.normpath(os.path.join(MONACO_ROOT, rel))
        if not fp.startswith(MONACO_ROOT + os.sep) and fp != MONACO_ROOT:
            return self.send_error(403, "Forbidden")
        if not os.path.isfile(fp):
            return self.send_error(404, "Not Found")
        ctype = {".js": "application/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8",
                 ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2",
                 ".json": "application/json; charset=utf-8"}.get(
            os.path.splitext(fp)[1].lower(), "application/octet-stream")
        try:
            with open(fp, "rb") as f:
                data = f.read()
        except Exception:
            return self.send_error(500, "Read Error")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=604800")
        self.end_headers()
        self.wfile.write(data)

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
        """GET /api/runs[?limit=N][?since=ms]：返回运行记录（时间轴/分析视图共用），按需查 MySQL。
        limit：只返回最新 N 条（前端 5s 轻量刷新）。
        since：只返回与 now-since 有交集的记录（前端按「总长」范围刷新）。"""
        q = parse_qs(urlparse(self.path).query)
        limit = None
        try:
            limit = int(q.get("limit", [""])[0]) or None
        except ValueError:
            pass
        since_ms = None
        try:
            since_ms = int(q.get("since", [""])[0]) or None
        except ValueError:
            pass
        records = _db_records(limit=limit, since_ms=since_ms)
        payload = {"ok": True, "records": records, "count": len(records),
                   "time": LAST_UPDATE_TIME[0] or now_text()}
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def handle_api_run(self):
        """GET /api/run?id=<rid>：返回单条运行记录详情（含日志目录路径），查 MySQL。"""
        q = parse_qs(urlparse(self.path).query)
        rid = unquote(q.get("id", [""])[0])
        rec = None
        if rid and "_" in rid:
            # id = file_safe_id(flow_id, process_no)，id 尾段即 process_no
            pno = rid.rsplit("_", 1)[-1]
            row = db.fetch_run_by_pno(pno)
            if row and row.get("flow_id") is not None:
                candidates = _db_records_from_rows([row])
                for r in candidates:
                    if r["id"] == rid:
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

    def handle_api_schedule_export(self):
        """GET /api/schedule/export?view=&robot=&status=：按排期页当前筛选条件导出 xlsx。

        xlsx 在内存里生成后直接下发（不落盘），浏览器据 Content-Disposition 触发下载。
        三张工作表：排期日历（版式对齐页面图表，同行/列合并成色块）+ 排期明细 + 触发器汇总。
        """
        q = parse_qs(urlparse(self.path).query)
        view = (q.get("view", ["week"])[0] or "week").lower()
        view = "month" if view == "month" else "week"
        robot = unquote(q.get("robot", ["__ALL__"])[0]) or "__ALL__"
        status = (q.get("status", ["enabled"])[0] or "enabled").lower()
        if status not in ("enabled", "disabled", "__all__"):
            status = "enabled"
        if status == "__all__":
            status = "__ALL__"

        path = os.path.join(DIR, "triggers_normalized.csv")
        if not os.path.exists(path):
            return self._send_json({"ok": False, "error": "缺少 triggers_normalized.csv"})
        try:
            with open(path, "r", encoding="utf-8-sig") as f:
                rows = list(csv.DictReader(f))
            ex = dashboard.build_schedule_export(rows, view=view, robot=robot, status=status)
            ex["calendar"] = dashboard.build_schedule_calendar(ex)
        except Exception as e:
            return self._send_json({"ok": False, "error": "排期导出数据整理失败：%s" % e})

        try:
            data = xlsx_writer.build_xlsx(sheets_for_schedule(ex))
        except Exception as e:
            return self._send_json({"ok": False, "error": "Excel 生成失败：%s" % e})
        if not ex["detail"] and not ex["triggers"]:
            return self._send_json({"ok": False, "error": "当前筛选条件下没有排期数据"})

        stem = "触发器排期_%s_%s_%s" % (ex["viewLabel"], ex["robotLabel"], ex["statusLabel"])
        fname = "%s_%s.xlsx" % (stem, datetime.datetime.now().strftime("%Y-%m-%d"))
        ascii_name = "schedule_%s_%s.xlsx" % (ex["view"], datetime.datetime.now().strftime("%Y%m%d"))
        print("[导出] 排期 xlsx：%s（明细 %d 行 / 触发器 %d 条）"
              % (fname, len(ex["detail"]), len(ex["triggers"])))
        self.send_response(200)
        self.send_header("Content-Type",
                         "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        # 中文名走 RFC 5987 的 filename*；老浏览器回落到 ASCII 名
        self.send_header("Content-Disposition",
                         'attachment; filename="%s"; filename*=UTF-8\'\'%s'
                         % (ascii_name, quote(fname, safe="")))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def handle_api_botstatus(self):
        """GET /api/botstatus：各机器人实时状态（运行中/排队中/空闲 + 当前任务 + 近期负载）。

        在途部分优先用 underway 实时轮询（桌面 API，~8s 一轮），
        在途记录（end 为空）来自 underway 轮询入库，终态由 60s 增量抓取覆盖。
        live: {ok, age, count} 告诉前端实时层状态（ok=False 显示"离线快照"）。
        """
        try:
            records = _db_records()
            payload = dashboard.build_bot_status(records)
            payload["time"] = LAST_UPDATE_TIME[0] or now_text()
            payload["live"] = {
                "ok": bool(LAST_UNDERWAY_TS[0]),
                "age": int(time.time() - LAST_UNDERWAY_TS[0]) if LAST_UNDERWAY_TS[0] else None,
                "count": sum(1 for r in records if r.get("end") is None),
            }
        except Exception as e:
            payload = {"ok": False, "error": "机器人状态聚合失败：%s" % e}
        self._send_json(payload)

    def handle_api_compliance(self):
        """GET /api/compliance?days=7&window=60：触发器排期 vs 实际运行（命中/延迟/漏跑）。"""
        q = parse_qs(urlparse(self.path).query)

        def _int(name, dflt, lo, hi):
            try:
                v = int(q.get(name, [str(dflt)])[0])
            except Exception:
                return dflt
            return max(lo, min(hi, v))

        days = _int("days", 7, 1, 30)
        window = _int("window", 60, 5, 720)
        path = os.path.join(DIR, "triggers_normalized.csv")
        if not os.path.exists(path):
            return self._send_json({"ok": False, "error": "缺少 triggers_normalized.csv"})
        try:
            with open(path, "r", encoding="utf-8-sig") as f:
                rows = list(csv.DictReader(f))
            payload = dashboard.build_compliance(rows, _db_records(), days=days, window_min=window)
        except Exception as e:
            payload = {"ok": False, "error": "命中率聚合失败：%s" % e}
        self._send_json(payload)

    def handle_log_search(self):
        """GET /api/logsearch?q=&robot=&days=：跨运行记录的日志关键词检索。

        结果里每条命中带运行记录 id 与文件名，前端据此跳详情页并自动定位关键词。
        """
        q = parse_qs(urlparse(self.path).query)
        kw = unquote(q.get("q", [""])[0]).strip()
        robot = unquote(q.get("robot", [""])[0]).strip()
        lvl = unquote(q.get("lvl", ["all"])[0]).strip().lower()
        only_lvl = 1 if lvl == "err" else (2 if lvl == "warn" else None)
        try:
            days = int(q.get("days", ["7"])[0])
        except Exception:
            days = 7
        days = max(1, min(30, days))
        if len(kw) < 2:
            return self._send_json({"ok": False, "error": "关键词至少 2 个字符", "hits": []})
        payload = search_logs(_db_records(), kw, robot=robot, days=days, only_lvl=only_lvl)
        payload["q"] = kw
        payload["days"] = days
        payload["lvl"] = lvl
        self._send_json(payload)

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
            [py, os.path.join("core", "crawler.py"), "--config", "config.json", "--out", "output"],
            [py, os.path.join("core", "organize.py"), "--input", os.path.join("output", "triggers_normalized.csv"), "--out", "output"],
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
        stamp_data_time()  # 每日完整更新成功：刷新“数据获取”时间


def run_refresh():
    """全量抓取：crawler 完整爬取（触发器 + 运行记录全量，写 CSV + 入库）。

    只有两个入口：服务器启动时的 initial_full_fetch、标题栏「立刻更新」按钮。
    日常在途与终态同步走桌面 API（records_poller 每 6s 拉最新 50 条 upsert），
    不经过这里——网页版会话失效只影响触发器排期的刷新，不影响运行记录。

    登录态失效由 crawler 自身的 authenticate() 处理：缓存会话/配置 Cookie 失效时
    自动回退到 config.json 的账号密码重新登录，登录成功后才继续抓。

    成功后刷新"数据获取"时间；失败把摘要写入 update_log.txt。返回 True=成功 False=失败。"""
    with UPDATE_LOCK:
        py = sys.executable
        log = os.path.join(DIR, "update_log.txt")
        cmd = [py, os.path.join("core", "crawler.py"), "--config", "config.json", "--out", "output"]
        try:
            r = subprocess.run(cmd, cwd=BASE, capture_output=True, encoding="utf-8",
                               errors="replace", timeout=600)
            out = (r.stdout or "")
            # 登录态失效且重新登录失败：crawler 会打印 [AUTH_FAILED]（此时退出码为 0，不会中断服务器启动），
            # 这里据此把刷新判为失败，让网页提示「刷新失败」而不是误以为成功。
            if r.returncode != 0 or "[AUTH_FAILED]" in out:
                with open(log, "a", encoding="utf-8") as f:
                    f.write("[%s] 刷新失败: %s\n%s\n" % (
                        datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        " ".join(cmd), (out + (r.stderr or ""))[-600:]))
                print("[刷新] %s 全量抓取失败（登录态可能已过期，下个周期会自动重试）"
                      % datetime.datetime.now().strftime("%H:%M:%S"))
                return False
            stamp_data_time()   # 记录“数据获取”时间
            print("[刷新] %s 运行记录 + 触发器排期已更新（全量抓取，完整爬取）" % datetime.datetime.now().strftime("%H:%M:%S"))
            return True
        except Exception as e:
            with open(log, "a", encoding="utf-8") as f:
                f.write("[%s] 刷新异常: %s\n" % (datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), e))
            print("[刷新] 异常:", e)
            return False


def _robot_filters():
    """config.json 的 include/exclude 机器人过滤规则（与 crawler 的 keep_name 同口径）。"""
    try:
        with open(os.path.join(BASE, "config.json"), "r", encoding="utf-8") as f:
            cfg = json.load(f)
        return ([str(k) for k in (cfg.get("include_robots") or [])],
                [str(k) for k in (cfg.get("exclude_robots") or [])])
    except Exception:
        return [], []


def _keep_name(name, include, exclude):
    """机器人名过滤：与 crawler.keep_name 一致（空名不保留）。"""
    if not name:
        return False
    if include and not any(name.startswith(p) for p in include):
        return False
    if any(k in name for k in exclude):
        return False
    return True


def _raw_rows(items):
    """桌面 API 记录 items（runningRecords / underway 同构）-> db 原始行，
    应用 include/exclude 机器人过滤。source 由调用方在 upsert 时指定。"""
    include, exclude = _robot_filters()
    out = []
    for it in items:
        if not it.get("startWay") or not _keep_name(it.get("botName") or "", include, exclude):
            continue
        out.append({
            "process_no": str(it.get("flowProcessNo") or ""),
            "flow_id": it.get("flowId") or "",
            "flow_name": it.get("flowName") or "",
            "bot_name": it.get("botName") or "",
            "trigger_name": it.get("triggerName") or "",
            "start_way": it.get("startWay") or "",
            "status": it.get("status") or "",
            "start_time": it.get("startTime") or "",
            "end_time": it.get("endTime") or "",
            "execution_start_time": it.get("executionStartTime") or "",
        })
    return out


def records_poller():
    """后台常驻线程：每 UNDERWAY_INTERVAL(6) 秒拉一页 runningRecords（最新 50 条）upsert 入库。

    runningRecords 一页同时含在途（Executing，endTime 空）与终态（Finished，
    endTime 有值），upsert 幂等（同 process_no 以最后一次写入为准，在途被终态
    覆盖），所以无需 underway 差异比对——一条轻 GET 每 6s 就能把新增和终态
    都同步进库，前端感知延迟 ≤6s。60s 无成功轮询时前端显示「离线快照」。
    失败静默跳过本轮，限频打印避免刷屏；octo_api 内部 401 时会自行续期/重登。
    """
    fail = 0
    time.sleep(5)   # 让主服务先起来（token 缓存/配置就绪）
    while True:
        try:
            with open(os.path.join(BASE, "config.json"), "r", encoding="utf-8") as f:
                cfg = json.load(f)
            page = octo_api.fetch_recent_records(cfg, take=50)
            n = db.upsert_raw_runs(_raw_rows(page), source="desktop")
            if n:
                stamp_data_time()   # 有改库：刷新「数据获取」时间
            LAST_UNDERWAY_TS[0] = time.time()
            fail = 0
        except Exception as e:
            fail += 1
            if fail == 1 or fail % 60 == 0:
                print("[轮询] 运行记录抓取失败 x%d: %s" % (fail, e))
        time.sleep(UNDERWAY_INTERVAL)


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
    db.init_db()       # MySQL 建库建表（幂等；未配置 config.json -> mysql 段时静默跳过）
    _init_data_time_from_file()   # “数据获取”时间初始为数据文件生成时刻
    print("[启动] 运行记录 %d 条在库（MySQL 为唯一真相源）" % db.count_runs())

    def initial_full_fetch():
        """服务器启动时先全量抓一轮（触发器 + 运行记录全量，写 CSV + 入库），
        保证重启后数据完整；与 records_poller 通过 UPDATE_LOCK 串行。"""
        try:
            run_refresh()
        except Exception as e:
            print("[启动] 全量抓取异常:", e)

    threading.Thread(target=initial_full_fetch, daemon=True).start()
    threading.Thread(target=scheduler, daemon=True).start()
    threading.Thread(target=records_poller, daemon=True).start()
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
        print("  运行记录轮询: 每 %d 秒桌面 API runningRecords 最新 50 条入库（在途+终态一次同步）" % UNDERWAY_INTERVAL)
        print("  网页读取:     按需查询 MySQL（唯一真相源），不触发抓取")
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
