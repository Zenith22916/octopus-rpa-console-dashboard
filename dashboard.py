# -*- coding: utf-8 -*-
"""
RPA 数据聚合模块（前后端分离架构下的数据层）
==================================================
读取 crawler 产出的 runs_normalized.csv / triggers_normalized.csv，为 local_server.py
的 JSON API 提供聚合数据（运行记录、单条详情含日志目录解析、触发器日程）。不再生成任何 HTML。

职责：
  - load_records(out_dir)        → 运行记录列表（时间轴/分析共用，含日志目录解析）
  - resolve_log_dir(...)         → 根据机器人 + 开始时间 + 流程编号推算日志共享目录
  - build_schedule_payload(rows) → 触发器日程表数据（周/月视图 + 统计）

用法（一般由 local_server.py import，不直接执行）。
"""
import calendar
import csv
import json
import os
import re
import sys
from collections import OrderedDict
from datetime import datetime, timezone, timedelta

# 强制 stdout/stderr 使用 UTF-8，避免中文 Windows 下（GBK）打印报错
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        try:
            _s.reconfigure(encoding="utf-8")
        except Exception:
            pass

# 北京时间时区（触发器 update_time 为 UTC，展示统一转北京时间）
BJT = timezone(timedelta(hours=8))
BASE = os.path.dirname(os.path.abspath(__file__))

# 深色背景下的 12 色配色（同应用同色，按出现顺序分配）——半透明底色（alpha 0.6）
PALETTE = [
    "rgba(29,158,117,0.6)", "rgba(55,138,221,0.6)", "rgba(216,90,48,0.6)", "rgba(127,119,221,0.6)",
    "rgba(226,75,74,0.6)", "rgba(239,159,39,0.6)", "rgba(31,184,184,0.6)", "rgba(184,110,232,0.6)",
    "rgba(151,196,89,0.6)", "rgba(240,153,123,0.6)", "rgba(93,202,165,0.6)", "rgba(237,147,177,0.6)",
]


def to_ms(v):
    """ISO 8601（含时区）/ 时间戳 -> 北京时间毫秒。解析失败返回 None。"""
    if not v:
        return None
    s = str(v)
    try:
        if s.isdigit() and len(s) in (10, 13):
            return int(s) * (1000 if len(s) == 10 else 1)
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=BJT)
    else:
        dt = dt.astimezone(BJT)
    return int(dt.timestamp() * 1000)


_SAFE_ID_RE = re.compile(r"[^A-Za-z0-9._-]")


def run_id(fid, pno):
    """运行记录唯一 id（用于跳转与查找）。"""
    return "%s_%s" % ((fid or ""), (pno or ""))


def file_safe_id(fid, pno):
    """run_id 的安全版本（仅保留字母数字、. _ -，保证 URL 与 id 一致）。"""
    return _SAFE_ID_RE.sub("_", run_id(fid, pno))


def is_enabled(v):
    return str(v).lower() in ("true", "1", "yes", "启用")


def app_short(name):
    """应用短名：第一个下划线之后、去掉末尾日期(连续4-8位数字)前的名称。"""
    if not name:
        return ""
    raw = name.split("_", 1)[1] if "_" in name else name
    s = re.sub(r"\d{4,8}$", "", raw).rstrip("_")
    return s if s else raw


def parse_points(cal):
    if not cal:
        return None
    t = cal.get("type")
    if t == 2 and cal.get("dailyData"):
        pts = [(p["hour"], p["minute"]) for p in cal["dailyData"].get("timePoints") or []]
        return ("daily", list(range(7)), pts)
    if t == 3 and cal.get("weeklyData"):
        # 八爪鱼 dayOfWeeks：0=周日…6=周六；周视图横轴为周一起点，统一偏移映射
        days = [(d + 6) % 7 for d in (cal["weeklyData"].get("dayOfWeeks") or [])]
        pts = [(p["hour"], p["minute"]) for p in cal["weeklyData"].get("timePoints") or []]
        return ("weekly", days, pts)
    if t == 4 and cal.get("monthlyData"):
        pts = [(p["hour"], p["minute"]) for p in cal["monthlyData"].get("timePoints") or []]
        return ("monthly", None, pts)
    return None


def month_days_for(cal, ndays):
    md = cal.get("monthlyData", {})
    days = set(md.get("days") or [])
    for n in (md.get("lastDays") or []):
        days.add(ndays - int(n) + 1)
    return sorted(d for d in days if 1 <= d <= ndays)


def load_logmap():
    """读取 robot_logs.json → {机器人: 共享日志根目录}。失败返回空 dict。"""
    logmap = {}
    cfg = os.path.join(BASE, "robot_logs.json")
    if os.path.exists(cfg):
        try:
            with open(cfg, "r", encoding="utf-8") as f:
                raw = json.load(f)
            for k, v in raw.items():
                if k.startswith("_"):
                    continue
                logmap[k] = v
        except Exception:
            pass
    return logmap


def resolve_log_dir(robot, start_time, pno, flow_name, logmap):
    """根据机器人 + 开始时间(UTC) + 流程编号推算日志共享目录。
    目录格式：<共享根>/<北京时间 YYYYMMDD>/<HHMMSS>-<流程名>-<process_no>。
    返回 (path, ok)：ok=True 目录存在；ok=False 目录不存在（可能未同步/未连接共享）；
    无配置则 path=""、ok=None。"""
    root = logmap.get(robot)
    if not root or not pno or not start_time:
        return "", None
    try:
        bj = datetime.fromisoformat(str(start_time).replace("Z", "+00:00")).astimezone(BJT)
    except Exception:
        return "", None
    date_folder = bj.strftime("%Y%m%d")
    hhmmss = bj.strftime("%H%M%S")
    flow = flow_name or ""
    illegals = set("\\/:*?\"<>|")
    cand_names = ["%s-%s-%s" % (hhmmss, flow, pno),
                  "%s-%s-%s" % (hhmmss, "".join("_" if c in illegals else c for c in flow), pno)]
    for cn in cand_names:
        p = os.path.join(root, date_folder, cn)
        try:
            if os.path.isdir(p):
                return p, True
        except Exception:
            pass
    return os.path.join(root, date_folder, cand_names[0]), False


def load_records(out_dir):
    """读取 runs_normalized.csv → 运行记录列表（与前端时间轴/分析结构一致，含日志目录解析）。"""
    logmap = load_logmap()
    path = os.path.join(out_dir, "runs_normalized.csv")
    if not os.path.exists(path):
        return []
    records = []
    with open(path, "r", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            start = to_ms(r.get("start_time"))
            if start is None:
                continue
            fid = r.get("flow_id") or ""
            pno = r.get("process_no") or ""
            robot = r.get("bot_name") or "(未指定机器人)"
            log_path, log_ok = resolve_log_dir(robot, r.get("start_time"), pno,
                                               r.get("flow_name"), logmap)
            records.append({
                "id": file_safe_id(fid, pno),
                "fid": fid,
                "pno": pno,
                "robot": robot,
                "name": r.get("flow_name") or r.get("trigger_name") or "运行记录",
                "app": r.get("flow_name") or "",
                "trigger": r.get("trigger_name") or "",
                "start": start,
                "end": to_ms(r.get("end_time")),           # 为空 = 运行中/排队中，前端延伸到现在
                "status": r.get("status") or "",
                "execStart": to_ms(r.get("execution_start_time")),
                "way": r.get("start_way") or "",
                "log": log_path,
                "logOk": log_ok,
            })
    records.sort(key=lambda s: s["start"])
    return records


def build_schedule_payload(rows):
    """从 triggers_normalized.csv 聚合触发器日程数据（周/月视图 + 统计），返回 dict。"""
    today = datetime.now()
    year, month = today.year, today.month
    ndays = calendar.monthrange(year, month)[1]

    app_order = OrderedDict()
    for r in rows:
        app = r["app_name"]
        if app and app not in app_order:
            app_order[app] = None

    robots = OrderedDict()
    for r in rows:
        rname = r["robot_name"]
        rb = robots.setdefault(rname, {"total": 0, "enabled": 0, "webhook": 0,
                                       "week": [], "month": []})
        rb["total"] += 1
        en = is_enabled(r["enabled"])
        if en:
            rb["enabled"] += 1
        if r["trigger_type"] == "Webhook":
            rb["webhook"] += 1
        cal = json.loads(r["calendar"]) if r["calendar"] else None
        parsed = parse_points(cal)
        if parsed is None:
            continue
        kind, days, pts = parsed
        color = PALETTE[list(app_order.keys()).index(r["app_name"]) % len(PALETTE)] if en else "rgba(95,94,90,0.6)"
        short = app_short(r["app_name"])
        for (h, m) in pts:
            t = round(h + m / 60.0, 2)
            info = {"t": t, "app": r["app_name"], "short": short, "color": color, "enabled": en}
            if kind in ("daily", "weekly"):
                for wd in days:
                    rb["week"].append({"wd": wd, **info})
            if kind == "monthly":
                for d in month_days_for(cal, ndays):
                    rb["month"].append({"day": d, **info})

    robot_names = sorted(robots.keys())
    all_days = set()
    for rb in robots.values():
        for p in rb["month"]:
            all_days.add(p["day"])
    month_labels = [f"{d}日" for d in sorted(all_days)]

    stats = {
        "total": len(rows),
        "enabled": sum(1 for r in rows if is_enabled(r["enabled"])),
        "webhook": sum(1 for r in rows if r["trigger_type"] == "Webhook"),
        "disabled": sum(1 for r in rows if not is_enabled(r["enabled"])),
        "robots": len(robot_names),
    }

    def group(points, key):
        out = {}
        for p in points:
            out.setdefault(p[key], []).append({k: v for k, v in p.items() if k != key})
        return out

    return {
        "ok": True,
        "robots": robot_names,
        "week": {n: group(rb["week"], "wd") for n, rb in robots.items()},
        "month": {n: group(rb["month"], "day") for n, rb in robots.items()},
        "monthLabels": month_labels,
        "stats": stats,
        "year": year,
        "monthNum": month,
    }


def main():
    print("dashboard.py 已重构为数据聚合模块（不生成 HTML）。")
    print("请通过 local_server.py 启动服务：python local_server.py")


if __name__ == "__main__":
    main()
