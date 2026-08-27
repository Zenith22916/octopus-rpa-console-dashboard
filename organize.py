# -*- coding: utf-8 -*-
"""
时刻表整理脚本
==============
读取 crawler.py 产出的 normalized 数据（triggers_normalized.csv）或原始 JSON（triggers_raw.json），
按机器人分组，解析 cron 表达式 / 结构化日历为人类可读的执行时刻，输出：
  - schedule_<机器人>.md   每个机器人一份时刻表
  - schedule_all.md        总览（含启用/停用标记）
  - schedule_all.xlsx      汇总 Excel（每个机器人分 Sheet + 总表）
  - schedule_all.csv       扁平 CSV（每触发器一行，便于导入飞书等）

用法：
    python organize.py --input output/triggers_normalized.csv --out output
    python organize.py --input output/triggers_raw.json --out output
"""
import argparse
import csv
import json
import os
import re
from collections import OrderedDict, defaultdict

# Windows 控制台编码保护（机器人名含 emoji，GBK 下打印会崩溃）
import sys as _sys
for _s in (_sys.stdout, _sys.stderr):
    try:
        _s.reconfigure(errors="replace")
    except Exception:
        pass

WEEKDAY_CN = ["日", "一", "二", "三", "四", "五", "六"]
# 八爪鱼日历 dayOfWeeks：0=周日 ... 6=周六（C# DayOfWeek 约定）
BZ_WEEKDAY = {0: "周日", 1: "周一", 2: "周二", 3: "周三", 4: "周四", 5: "周五", 6: "周六"}


def fmt_time_points(tps):
    """timePoints: [{hour, minute}] -> ['09:00', ...]"""
    times = []
    for tp in tps or []:
        try:
            times.append(f"{int(tp['hour']):02d}:{int(tp['minute']):02d}")
        except (KeyError, TypeError, ValueError):
            continue
    return sorted(set(times))


def describe_calendar(cal):
    """
    把八爪鱼触发器的结构化日历转成人类可读描述。
    calendar.type: 1=一次 2=每天 3=每周 4=每月 5=间隔（若存在）
    返回描述字符串或 None（无法解析）。
    """
    if not cal or not isinstance(cal, dict):
        return None
    t = cal.get("type")
    # 自定义 cron
    cron_data = cal.get("cronExpressionData")
    if cron_data and cron_data.get("text"):
        return describe_cron(cron_data["text"])
    # 一次性
    if t == 1 or cal.get("onceData"):
        once = cal.get("onceData") or {}
        dt = once.get("time") or once.get("dateTime") or once.get("startTime") or ""
        return ("一次性执行" + (f"（{fmt_ts(dt)}）" if dt else "")) or None
    # 间隔
    if cal.get("intervalData"):
        iv = cal.get("intervalData") or {}
        n = iv.get("interval") or iv.get("value")
        unit = iv.get("unit") or iv.get("type")
        if n:
            unit_cn = {1: "分钟", 2: "小时", 3: "天"}.get(unit, "间隔")
            return f"每 {n} {unit_cn}"
        return "间隔触发"
    # 每天
    if cal.get("dailyData"):
        times = fmt_time_points(cal["dailyData"].get("timePoints"))
        if times:
            return "每天 " + (",".join(times) if len(times) <= 6 else f"{times[0]}~{times[-1]}（共{len(times)}个时间点）")
        return "每天"
    # 每周
    if cal.get("weeklyData"):
        wd = cal["weeklyData"]
        days = [BZ_WEEKDAY.get(d) for d in (wd.get("dayOfWeeks") or []) if BZ_WEEKDAY.get(d)]
        times = fmt_time_points(wd.get("timePoints"))
        if not days:
            return None
        if len(days) == 7:
            day_desc = "每天"
        elif sorted(wd.get("dayOfWeeks") or []) == [1, 2, 3, 4, 5]:
            day_desc = "周一至周五"
        elif sorted(wd.get("dayOfWeeks") or []) == [0, 6]:
            day_desc = "周末"
        else:
            day_desc = "、".join(days)
        if times:
            return f"{day_desc} " + (",".join(times) if len(times) <= 6 else f"{times[0]}~{times[-1]}（共{len(times)}个时间点）")
        return day_desc
    # 每月
    if cal.get("monthlyData"):
        md = cal["monthlyData"]
        days = sorted(md.get("days") or [])
        last = sorted(md.get("lastDays") or [])
        times = fmt_time_points(md.get("timePoints"))
        parts = []
        if days:
            parts.append("每月" + "、".join(f"{d}日" for d in days[:8]) + ("等" if len(days) > 8 else ""))
        if last:
            parts.append("每月最后" + "、".join(f"{d}天" for d in last))
        if not parts:
            return None
        if times:
            return " ".join(parts) + " " + ",".join(times)
        return " ".join(parts)
    return None


def parse_cron(expr):
    """
    解析 5/6/7 段 cron 表达式，返回结构化描述或 None。
    支持：*  */n  数字  范围 a-b  a-b/n  逗号列表  星期中的 ? 与 1-7/0-6
    """
    if not expr or not isinstance(expr, str):
        return None
    parts = expr.strip().split()
    if len(parts) not in (5, 6, 7):
        return None
    if len(parts) == 5:
        minute, hour, dom, month, dow = parts
    else:
        # 6/7 段：首位为秒，末位为（可选）年
        _, minute, hour, dom, month, dow = parts[:6]
    return {"minute": minute, "hour": hour, "dom": dom, "month": month, "dow": dow}


DAY_NAMES = {"SUN": 1, "MON": 2, "TUE": 3, "WED": 4, "THU": 5, "FRI": 6, "SAT": 7}


def expand(field, lo, hi, names=None):
    """把字段展开成集合。'?' 视为 *。names 用于星期名（Quartz 约定 SUN=1...SAT=7）"""
    if field in ("*", "?"):
        return set(range(lo, hi + 1))
    nums = set()
    for part in field.split(","):
        part = part.strip()
        if names and re.match(r"^[A-Za-z]{3}(?:-[A-Za-z]{3})?$", part):
            up = part.upper()
            if "-" in up:
                a, b = up.split("-")
                a, b = names[a], names[b]
                if b < a:
                    b, a = a, b
                nums.update(range(a, b + 1))
            else:
                nums.add(names[up])
            continue
        m = re.match(r"^(\d+|\*)(?:-(\d+))?(?:/(\d+))?$", part)
        if not m:
            return None
        a, b, step = m.groups()
        step = int(step) if step else 1
        if a == "*":
            vals = range(lo, hi + 1)
        else:
            a = int(a)
            b = int(b) if b is not None else a
            if b < a:
                b, a = a, b
            vals = range(a, min(b, hi) + 1)
        nums.update(v for i, v in enumerate(vals) if i % step == 0)
    return {v for v in nums if lo <= v <= hi}


def fmt_dow(dow_set):
    """把星期集合（内部：0=周日 ... 6=周六）转成中文描述"""
    if dow_set is None:
        return ""
    if len(dow_set) == 7:
        return "每天"
    if dow_set == {1, 2, 3, 4, 5}:  # 周一~周五
        return "周一至周五"
    if dow_set == {0, 6}:
        return "周末"
    # 按周一起始排序展示
    ordered = sorted(dow_set, key=lambda d: (d % 7 + 6) % 7) if dow_set != {0} else [0]
    names = [WEEKDAY_CN[d] for d in ordered]
    return "周" + "/周".join(names)


def describe_cron(expr):
    """
    把 cron 转成人类可读时间描述。
    返回形如：每天 09:00 / 周一至周五 09:00,18:00 / 每小时 / 每 30 分钟等
    """
    c = parse_cron(expr)
    if not c:
        return None

    # 每分钟 / 每N分钟
    if re.fullmatch(r"\*|(?:0+|\*)?/\d+", c["minute"]) and c["hour"] == "*" and c["dom"] == "*" and c["month"] == "*" and c["dow"] in ("*", "?"):
        if c["minute"] == "*":
            return "每分钟"
        step = int(c["minute"].split("/")[1])
        return f"每 {step} 分钟"

    # 每小时 / 每N小时
    if re.fullmatch(r"\*|0*/\d+", c["hour"]) and c["minute"] in ("0", "*", "0/1") and c["dom"] == "*" and c["month"] == "*" and c["dow"] in ("*", "?"):
        if c["hour"] == "*":
            return "每小时"
        step = int(c["hour"].split("/")[1])
        return f"每 {step} 小时"

    # Quartz 约定检测：dom 用 ? 或星期用名称时，按 SUN=1...SAT=7 映射
    use_quartz = ("?" in c["dom"]) or bool(re.search(r"[A-Za-z]", c["dow"]))
    dow_raw = expand(c["dow"], 0, 7, names=DAY_NAMES if use_quartz else None)
    if dow_raw is None:
        return None
    if use_quartz:
        dow_set = {(v - 1) % 7 for v in dow_raw}   # 1..7 → 0..6
    else:
        dow_set = {v % 7 for v in dow_raw}          # 0..7 → 0..6（7 视为周日）
    dom_set = expand(c["dom"], 1, 31)
    month_set = expand(c["month"], 1, 12)

    if dom_set is None or month_set is None:
        return None

    # 星期/日期限定 + 具体时间点
    minutes = expand(c["minute"], 0, 59)
    hours = expand(c["hour"], 0, 23)
    if minutes is None or hours is None:
        return None

    times = sorted(f"{h:02d}:{m:02d}" for h in sorted(hours) for m in sorted(minutes))

    if month_set != set(range(1, 13)):
        month_desc = "/".join(str(m) for m in sorted(month_set)) + "月"
    else:
        month_desc = None

    every_day = dow_set == set(range(0, 7))
    dom_specific = dom_set != set(range(1, 32))

    if dom_specific and not every_day:
        # 日期与星期同时受限：按"每月的日期"优先描述（多数场景为每月 N 日）
        days = sorted(dom_set)
        if len(days) > 6:
            day_desc = f"每月{len(days)}天"
        else:
            day_desc = "每月" + "、".join(f"{d}日" for d in days)
        if dow_set and dow_set != set(range(0, 7)):
            day_desc += f"（{fmt_dow(dow_set)}）"
    elif dom_specific:
        days = sorted(dom_set)
        if len(days) > 6:
            day_desc = f"每月{len(days)}天"
        else:
            day_desc = "每月" + "、".join(f"{d}日" for d in days)
    elif every_day:
        day_desc = "每天"
    else:
        day_desc = fmt_dow(dow_set)

    if month_desc:
        if day_desc.startswith("每月"):
            day_desc = day_desc[len("每月"):]
        day_desc = f"{month_desc}{day_desc}"

    if len(times) == 1:
        time_desc = times[0]
    elif len(times) <= 8:
        time_desc = ",".join(times)
    else:
        time_desc = f"{times[0]}~{times[-1]}（共{len(times)}个时间点）"

    return f"{day_desc} {time_desc}"


def fmt_ts(v):
    """把各种时间格式转成 YYYY-MM-DD HH:MM:SS"""
    if not v:
        return ""
    s = str(v)
    # 时间戳（秒/毫秒）
    if re.fullmatch(r"\d{10,13}", s):
        s = int(s)
        s = s / 1000 if s > 1e12 else s
        from datetime import datetime, timezone, timedelta
        return datetime.fromtimestamp(s, tz=timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M:%S")
    # ISO 8601
    m = re.search(r"(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})", s)
    if m:
        return f"{m.group(1)} {m.group(2)}"
    return s


def normalize_rows(data):
    """统一数据形态为 list[dict]"""
    if isinstance(data, dict):
        for k in ("records", "rows", "list", "items", "data"):
            if isinstance(data.get(k), list):
                return data[k]
        return [data]
    if isinstance(data, list):
        return data
    return []


def exec_desc(r):
    """综合描述触发时刻：优先解析八爪鱼结构化日历，其次 cron 表达式"""
    cal_json = r.get("calendar") or ""
    if cal_json:
        try:
            cal = json.loads(cal_json) if isinstance(cal_json, str) else cal_json
            d = describe_calendar(cal)
            if d:
                return d
        except Exception:
            pass
    d = describe_cron(r.get("cron", ""))
    if d:
        return d
    if str(r.get("trigger_type", "")).lower() in ("webhook", "webhook触发"):
        return "Webhook 触发（被外部调用时执行）"
    return None


def main():
    ap = argparse.ArgumentParser(description="按机器人整理触发器时刻表")
    ap.add_argument("--input", required=True, help="crawler 产出的 CSV 或 JSON")
    ap.add_argument("--out", default="output", help="输出目录")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    inp = args.input

    if inp.endswith(".csv"):
        with open(inp, "r", encoding="utf-8-sig") as f:
            rows = list(csv.DictReader(f))
    else:
        with open(inp, "r", encoding="utf-8") as f:
            rows = normalize_rows(json.load(f))

    # 按机器人分组
    groups = OrderedDict()
    for r in rows:
        robot = (r.get("robot_name") or "").strip() or "(未指定机器人)"
        groups.setdefault(robot, []).append(r)

    md_lines_all = []
    md_lines_all.append("# RPA 触发器时刻表总览\n")
    md_lines_all.append(f"共 {len(rows)} 个触发器，{len(groups)} 台机器人。\n")
    md_lines_all.append("| 机器人 | 触发器 | 应用 | 执行时刻 | 状态 |")
    md_lines_all.append("|---|---|---|---|---|---|---|")

    # Excel
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
        HAS_XLSX = True
    except ImportError:
        HAS_XLSX = False
        print("[!] 未安装 openpyxl，跳过 Excel 输出（pip install openpyxl）")

    wb = Workbook() if HAS_XLSX else None
    wb.remove(wb.active) if HAS_XLSX else None

    header_fill = PatternFill("solid", fgColor="4472C4") if HAS_XLSX else None
    header_font = Font(bold=True, color="FFFFFF") if HAS_XLSX else None

    xlsx_headers = ["触发器名称", "应用", "执行时刻", "状态", "触发器ID"]

    for robot, rlist in groups.items():
        enabled_count = sum(1 for r in rlist if str(r.get("enabled", "")).lower() not in ("0", "false", "no", "停用", "disabled", ""))
        md_lines_all.append("")
        md_lines_all.append(f"## {robot}（{len(rlist)} 个触发器，启用 {enabled_count}）\n")
        md_lines_all.append("| 触发器 | 应用 | 执行时刻 | 状态 |")
        md_lines_all.append("|---|---|---|---|---|---|")

        if HAS_XLSX:
            ws = wb.create_sheet(title=robot[:31])
            ws.append(xlsx_headers)
            for cell in ws[1]:
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal="center")

        for r in sorted(rlist, key=lambda x: exec_desc(x) or ""):
            name = r.get("trigger_name") or r.get("trigger_id") or "(未命名)"
            app = r.get("app_name") or "-"
            desc = exec_desc(r) or "（无法解析/非定时触发）"
            en = str(r.get("enabled", "")).lower()
            status = "停用" if en in ("0", "false", "no", "停用", "disabled") else ("启用" if en else "-")

            md_lines_all.append(f"| {name} | {app} | {desc} | {status} |")

            if HAS_XLSX:
                ws.append([name, app, desc, status, r.get("trigger_id", "")])
                for col, w in zip("ABCDE", (30, 22, 30, 8, 36)):
                    ws.column_dimensions[col].width = max(ws.column_dimensions[col].width or 10, len(col) * 2)

    # 总表（每个触发器一行）
    if HAS_XLSX:
        ws_all = wb.create_sheet(title="总表")
        ws_all.append(["机器人"] + xlsx_headers)
        for cell in ws_all[1]:
            cell.fill = header_fill
            cell.font = header_font
        for robot, rlist in groups.items():
            for r in rlist:
                en = str(r.get("enabled", "")).lower()
                status = "停用" if en in ("0", "false", "no", "停用", "disabled") else ("启用" if en else "-")
                ws_all.append([
                    robot,
                    r.get("trigger_name") or r.get("trigger_id") or "(未命名)",
                    r.get("app_name") or "-",
                    exec_desc(r) or "（无法解析）",
                    status,
                    r.get("trigger_id", ""),
                ])
        for col, w in zip("ABCDEF", (16, 30, 22, 30, 8, 36)):
            ws_all.column_dimensions[col].width = max(ws_all.column_dimensions[col].width or 10, w)

        xlsx_path = os.path.join(args.out, "schedule_all.xlsx")
        wb.save(xlsx_path)
        print(f"[+] Excel 已生成: {xlsx_path}")

    # 总览 md
    all_path = os.path.join(args.out, "schedule_all.md")
    with open(all_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines_all))
    print(f"[+] 总览已生成: {all_path}")

    # 每个机器人一份 md
    for robot, rlist in groups.items():
        safe = re.sub(r'[\\/:*?"<>|]', "_", robot)
        path = os.path.join(args.out, f"schedule_{safe}.md")
        lines = [f"# {robot} 执行时刻表\n"]
        lines.append(f"触发器数量：{len(rlist)}\n")
        lines.append("| 触发器 | 应用 | 执行时刻 | 状态 |")
        lines.append("|---|---|---|---|---|---|")
        for r in sorted(rlist, key=lambda x: exec_desc(x) or ""):
            en = str(r.get("enabled", "")).lower()
            status = "停用" if en in ("0", "false", "no", "停用", "disabled") else ("启用" if en else "-")
            lines.append(
                f"| {r.get('trigger_name') or r.get('trigger_id') or '(未命名)'} "
                f"| {r.get('app_name') or '-'} "
                f"| {exec_desc(r) or '（无法解析/非定时）'} "
                f"| {status} |"
            )
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        print(f"[+] 已生成: {path}")

    # 供飞书上传用的扁平 CSV（每触发器一行）
    csv_path = os.path.join(args.out, "schedule_all.csv")
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        import csv as _csv
        w = _csv.writer(f)
        w.writerow(["机器人", "触发器名称", "应用", "执行时刻", "状态", "触发器ID"])
        for robot, rlist in groups.items():
            for r in rlist:
                en = str(r.get("enabled", "")).lower()
                status = "停用" if en in ("0", "false", "no", "停用", "disabled") else ("启用" if en else "-")
                w.writerow([
                    robot,
                    r.get("trigger_name") or r.get("trigger_id") or "(未命名)",
                    r.get("app_name") or "-",
                    r.get("cron") or "-",
                    exec_desc(r) or "（无法解析）",
                    status,
                    r.get("trigger_id", ""),
                ])
    print(f"[+] 飞书上传用 CSV 已生成: {csv_path}")

    print("\n[✓] 时刻表整理完成")


if __name__ == "__main__":
    main()
