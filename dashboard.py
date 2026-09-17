# -*- coding: utf-8 -*-
"""
RPA 数据聚合模块（前后端分离架构下的数据层）
==================================================
读取 crawler 产出的 runs_normalized.csv / triggers_normalized.csv，为 local_server.py
的 JSON API 提供聚合数据（运行记录、单条详情含日志目录解析、触发器日程）。不再生成任何 HTML。

职责：
  - load_records(out_dir)          → 运行记录列表（时间轴/分析共用，含日志目录解析）
  - resolve_log_dir(...)           → 根据机器人 + 开始时间 + 流程编号推算日志共享目录
  - build_schedule_payload(rows)   → 触发器日程表数据（周/月视图 + 统计）
  - build_bot_status(records)      → 机器人实时状态（运行中/排队中/空闲 + 当前任务 + 近期负载）
  - build_compliance(rows, records)→ 触发器排期 vs 实跑比对（命中 / 延迟 / 漏跑）

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


def build_bot_status(records):
    """从运行记录聚合各机器人的实时状态（机器人状态视图数据源）。

    状态口径：
      - running：存在 end 为空且 status=Executing 的记录（正在跑）；
      - queued ：无运行中记录，但存在 end 为空且状态非 Executing 的记录（排队中）；
      - idle   ：没有在途记录。
    返回 {ok, now, summary:{robots,running,queued,idle,tasks}, bots:[...]}，
    bots 已按「运行中 → 排队中 → 空闲，近 7 天记录数降序」排好序。
    """
    DAY = 86400000
    now_ms = int(datetime.now(BJT).timestamp() * 1000)
    bots = OrderedDict()

    for r in records:
        rb = r.get("robot") or "(未指定机器人)"
        u = bots.get(rb)
        if u is None:
            u = bots[rb] = {
                "robot": rb, "tasks": [], "running": 0, "queued": 0,
                "lastSeen": None, "lastEnd": None, "lastName": "", "logReady": False,
                "d1c": 0, "d1f": 0, "w7c": 0, "w7f": 0,
                "w7waitSum": 0, "w7waitN": 0, "w7runSum": 0, "w7runN": 0,
            }
        st = r.get("start") or 0
        en = r.get("end")
        ex = r.get("execStart")
        # 近 24 小时 / 近 7 天统计窗口
        if now_ms - st <= DAY:
            u["d1c"] += 1
            if r.get("status") == "Failed":
                u["d1f"] += 1
        if now_ms - st <= 7 * DAY:
            u["w7c"] += 1
            if r.get("status") == "Failed":
                u["w7f"] += 1
            if ex and ex > st:
                u["w7waitSum"] += ex - st
                u["w7waitN"] += 1
            run_from = ex if (ex and ex > st) else st
            if en and en > run_from:
                u["w7runSum"] += en - run_from
                u["w7runN"] += 1
        if r.get("logOk"):
            u["logReady"] = True
        if en is None:
            # 在途记录：Executing 记为运行中，其余（Waiting 等）记为排队中
            if r.get("status") == "Executing":
                u["running"] += 1
            else:
                u["queued"] += 1
            run_from = ex if (ex and ex > st) else st
            u["tasks"].append({
                "id": r.get("id"), "name": r.get("name") or r.get("app") or "",
                "app": r.get("app") or "", "status": r.get("status") or "",
                "way": r.get("way") or "", "start": st, "execStart": ex,
                "elapsed": max(0, now_ms - run_from),
                "waited": (ex - st) if (ex and ex > st) else 0,
            })
        else:
            if u["lastEnd"] is None or en > u["lastEnd"]:
                u["lastEnd"] = en
                u["lastName"] = r.get("name") or r.get("app") or ""
        seen = en if en else st
        if u["lastSeen"] is None or seen > u["lastSeen"]:
            u["lastSeen"] = seen

    out = []
    for u in bots.values():
        state = "running" if u["running"] else ("queued" if u["queued"] else "idle")
        idle_ms = None
        marker = u["lastEnd"] if u["lastEnd"] is not None else u["lastSeen"]
        if marker is not None:
            idle_ms = max(0, now_ms - marker)
        u["tasks"].sort(key=lambda t: t["start"])
        out.append({
            "robot": u["robot"], "state": state, "tasks": u["tasks"],
            "running": u["running"], "queued": u["queued"],
            "lastSeen": u["lastSeen"], "lastEnd": u["lastEnd"],
            "idleMs": idle_ms, "lastName": u["lastName"], "logReady": u["logReady"],
            "recent": {"count": u["d1c"], "failed": u["d1f"]},
            "week": {
                "count": u["w7c"], "failed": u["w7f"],
                "failRate": (u["w7f"] / float(u["w7c"])) if u["w7c"] else 0.0,
                "avgWait": (u["w7waitSum"] / float(u["w7waitN"])) if u["w7waitN"] else 0.0,
                "avgRun": (u["w7runSum"] / float(u["w7runN"])) if u["w7runN"] else 0.0,
            },
        })

    order = {"running": 0, "queued": 1, "idle": 2}
    out.sort(key=lambda b: (order.get(b["state"], 3), -b["week"]["count"], b["robot"]))
    summary = {
        "robots": len(out),
        "running": sum(1 for b in out if b["state"] == "running"),
        "queued": sum(1 for b in out if b["state"] == "queued"),
        "idle": sum(1 for b in out if b["state"] == "idle"),
        "tasks": sum(len(b["tasks"]) for b in out),
    }
    return {"ok": True, "now": now_ms, "summary": summary, "bots": out}


def build_compliance(rows, records, days=7, window_min=60, late_min=5, limit=600):
    """把触发器排期（triggers_normalized.csv）与实际运行记录做比对，判定命中 / 延迟 / 漏跑。

    判定口径（写死在这里，前端只做展示，避免两处口径漂移）：
      - 只统计「已启用且 calendar 可解析」的触发器，逐日展开排期点；
      - 计划时刻取自 calendar 的 timePoints，时区统一按北京时间（BJT）；
      - 命中窗口 = [计划时刻 - 2 分钟, 计划时刻 + window_min 分钟]，匹配条件为同机器人 + 同应用；
      - 命中窗口内最早的那条记录即算该次排期的命中，延误超过 late_min 分钟记为「延迟」；
      - 应用没跑，但同一触发器名在窗口内有记录 → 「应用不符」（触发到了，跑的是别的应用）；
      - 计划时刻 + 窗口已完整过去仍无记录 → 「漏跑」；窗口尚未走完 → 「待定」（不计入分母）；
      - 早于运行记录最早时刻的排期点无法判定（爬虫只保留最近 N 天）→ 记为「超出数据范围」并排除。

    为什么按「应用名」而不是「触发器名」匹配：业务语义是「该应用到点有没有跑起来」。
    实测两条口径会打架 —— 触发器表里存在同一应用的多条触发器（如 宝实2_/宝实3_清理过期录屏），
    其中一条从不触发、另一条正常触发同一个应用；按触发器名会把它误判成漏跑。因此以应用名为主口径，
    触发器名只作为「应用不符」的辅助证据。

    返回 {ok, days, window, lateMin, coverageFrom, stats, perRobot, items}。
    """
    now = datetime.now(BJT)
    now_ms = int(now.timestamp() * 1000)
    win_start = now - timedelta(days=days)
    starts = [r.get("start") for r in records if r.get("start")]
    rec_min = min(starts) if starts else None
    grace_ms = 2 * 60000          # 允许记录比计划时刻早 2 分钟（时钟误差/提前排队）

    # (机器人, 应用) -> [(开始时间 ms, 记录)]，按开始时间升序，供窗口内线性查找
    index = {}
    # (机器人, 触发器名) -> 同上：应用没跑时的辅助证据（触发到了、但跑的是别的应用）
    tindex = {}
    for r in records:
        st = r.get("start")
        if not st:
            continue
        index.setdefault((r.get("robot") or "", r.get("app") or ""), []).append((st, r))
        if r.get("trigger"):
            tindex.setdefault((r.get("robot") or "", r["trigger"]), []).append((st, r))
    for k in index:
        index[k].sort(key=lambda t: t[0])
    for k in tindex:
        tindex[k].sort(key=lambda t: t[0])

    def find_in(idx, key, at_ms):
        """返回窗口内最早的一条记录 (start, rec)；无则 None。"""
        cand = idx.get(key)
        if not cand:
            return None
        lo, hi = at_ms - grace_ms, at_ms + window_min * 60000
        for st, r in cand:
            if st < lo:
                continue
            if st > hi:
                break
            return (st, r)
        return None

    stat = {"scheduled": 0, "hit": 0, "late": 0, "mismatch": 0,
            "missed": 0, "pending": 0, "unknown": 0}
    per = OrderedDict()
    items = []

    for row in rows:
        if not is_enabled(row.get("enabled")):
            continue
        try:
            cal = json.loads(row.get("calendar") or "null")
        except Exception:
            cal = None
        parsed = parse_points(cal) if cal else None
        if parsed is None:
            continue
        kind, wdays, pts = parsed
        robot = row.get("robot_name") or ""
        app = row.get("app_name") or ""
        if not robot or not app or not pts:
            continue
        rb = per.setdefault(robot, {"robot": robot, "scheduled": 0, "hit": 0, "late": 0,
                                    "mismatch": 0, "missed": 0, "pending": 0})
        d = win_start.date()
        last = now.date()
        while d <= last:
            if kind == "monthly":
                nd = calendar.monthrange(d.year, d.month)[1]
                active = d.day in month_days_for(cal, nd)
            else:
                active = d.weekday() in wdays      # parse_points 已把 dayOfWeeks 映射为 0=周一
            if active:
                for (hh, mm) in pts:
                    at = datetime(d.year, d.month, d.day, hh, mm, tzinfo=BJT)
                    if at > now:
                        continue                    # 未来时刻不判
                    at_ms = int(at.timestamp() * 1000)
                    if rec_min is not None and at_ms < rec_min:
                        stat["unknown"] += 1        # 早于数据范围，判不了
                        continue
                    stat["scheduled"] += 1
                    rb["scheduled"] += 1
                    hit = find_in(index, (robot, app), at_ms)
                    item = {"sched": at_ms, "robot": robot, "app": app,
                            "short": app_short(app), "trigger": row.get("trigger_name") or "",
                            "runStart": None, "runId": None, "lateMs": None,
                            "runApp": None}
                    if hit is None:
                        # 应用没跑：看同一触发器名有没有在窗口内触发（触发到了但跑的是别的应用）
                        t = find_in(tindex, (robot, row.get("trigger_name") or ""), at_ms)
                        if t is not None:
                            item["status"] = "mismatch"
                            item["runStart"] = t[0]
                            item["runId"] = t[1].get("id")
                            item["runApp"] = t[1].get("app") or ""
                            stat["mismatch"] += 1
                            rb["mismatch"] += 1
                        elif at_ms + window_min * 60000 > now_ms:
                            item["status"] = "pending"
                            stat["pending"] += 1
                            rb["pending"] += 1
                        else:
                            item["status"] = "missed"
                            stat["missed"] += 1
                            rb["missed"] += 1
                    else:
                        late_ms = hit[0] - at_ms
                        item["status"] = "late" if late_ms > late_min * 60000 else "hit"
                        item["runStart"] = hit[0]
                        item["runId"] = hit[1].get("id")
                        item["lateMs"] = late_ms
                        stat[item["status"]] += 1
                        rb[item["status"]] += 1
                    items.append(item)
            d += timedelta(days=1)

    items.sort(key=lambda it: it["sched"], reverse=True)
    items = items[:limit]

    evaluated = stat["hit"] + stat["late"] + stat["mismatch"] + stat["missed"]
    stats = dict(stat)
    stats["evaluated"] = evaluated
    # 命中率 = 该应用按时跑起来（含延迟）/ 可判定次数；准点率 = 准点 / 可判定次数
    stats["rate"] = (stat["hit"] + stat["late"]) / float(evaluated) if evaluated else 0.0
    stats["onTimeRate"] = stat["hit"] / float(evaluated) if evaluated else 0.0

    per_robot = []
    for u in per.values():
        ev = u["hit"] + u["late"] + u["mismatch"] + u["missed"]
        per_robot.append({
            "robot": u["robot"], "scheduled": u["scheduled"],
            "hit": u["hit"], "late": u["late"], "mismatch": u["mismatch"],
            "missed": u["missed"], "pending": u["pending"], "evaluated": ev,
            "rate": (u["hit"] + u["late"]) / float(ev) if ev else 0.0,
            "onTimeRate": u["hit"] / float(ev) if ev else 0.0,
        })
    per_robot.sort(key=lambda b: (-b["missed"], -b["mismatch"], -b["scheduled"], b["robot"]))

    return {"ok": True, "days": days, "window": window_min, "lateMin": late_min,
            "coverageFrom": rec_min, "now": now_ms,
            "stats": stats, "perRobot": per_robot, "items": items}


def main():
    print("dashboard.py 已重构为数据聚合模块（不生成 HTML）。")
    print("请通过 local_server.py 启动服务：python local_server.py")


if __name__ == "__main__":
    main()
