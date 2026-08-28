# -*- coding: utf-8 -*-
"""
八爪鱼 RPA 触发器 & 运行记录爬虫（企业版）
=========================================
从 https://rpa.bazhuayu.com/management/enterprise/robot-trigger 获取企业版所有 RPA 机器人的
触发器与运行记录，输出归一化数据：
  - triggers_normalized.csv / triggers_raw.json：触发器（机器人、应用、触发类型、cron、状态）
  - runs_normalized.csv：运行记录（机器人、应用、触发方式、状态、起止时间、排队/执行拆分）

用法：
    python crawler.py --config config.json --out output
    python crawler.py --config config.json --out output --only-runs --days 7   # 仅快速刷新运行记录

流程：
    1. 账号密码登录（identity.bazhuayu.com OIDC 链路），会话缓存到 output/session.json
    2. 获取账号下企业列表，选择企业（config 的 enterprise_id 可指定；默认选第一个非个人账号）
    3. 切换企业会话（GET /management/api/session?enterprise_id=xxx），后续请求带 EnterpriseId 头
    4. 拉取运行记录（最近 N 天；--only-runs 时跳过触发器/机器人，仅刷新运行记录）
    5. 完整流程：分页拉取全部触发器与机器人列表，归一化输出 CSV；机器人按 include/exclude 过滤

鉴权备用方案：
    - config.json 的 cookie 字段：浏览器 F12 -> Console 执行 document.cookie 填入
"""
import argparse
import base64
import csv
import json
import os
import re
import sys
import time
import urllib.parse
from datetime import datetime, timezone

import requests

# Windows 控制台编码保护（机器人名含 emoji，GBK 下打印会崩溃）
import sys as _sys
for _s in (_sys.stdout, _sys.stderr):
    try:
        _s.reconfigure(errors="replace")
    except Exception:
        pass

DEFAULT_BASE = "https://rpa.bazhuayu.com"
IDENTITY_BASE = "https://identity.bazhuayu.com"
CLIENT_ID = "OctopusRPAWeb"
SESSION_FILE = "session.json"

# 已逆向确认的接口（baseURL = /management/api）
API_TRIGGERS = "/management/api/officialSite/triggers"
API_BOTS = "/management/api/officialSite/bots/bots"
API_ENTERPRISES = "/management/api/officialSite/enterprises/enterprises"
API_SESSION = "/management/api/session"
API_ME = "/management/api/officialSite/identity/accounts/me"
API_RUNNING_RECORDS = "/management/api/officialSite/bots/runningRecords"


def b64(s):
    """登录参数编码（与前端 pd.encode 一致）"""
    if isinstance(s, str):
        s = s.encode("utf-8")
    return base64.b64encode(s).decode()


def to_ms(v):
    """ISO 8601 / 时间戳 -> 绝对毫秒。解析失败返回 None。"""
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
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def login_by_password(session, username, password, out_dir):
    """OIDC 密码登录，成功后 session 持有 rpa 域会话 cookie。返回是否成功。"""
    print("[*] 尝试账号密码登录 ...")
    r = session.get(DEFAULT_BASE + "/api/auth", allow_redirects=False, timeout=30)
    if r.status_code not in (301, 302, 307, 308):
        print("[!] /api/auth 未返回跳转，可能接口已变更")
        return False
    auth_url = r.headers.get("Location", "")
    r2 = session.get(auth_url, allow_redirects=False, timeout=30)
    loc2 = r2.headers.get("Location", "")
    m = re.search(r"[?&]ReturnUrl=([^&]+)", loc2)
    if not m:
        print("[!] 未从授权流程中取得 ReturnUrl")
        return False
    return_url = urllib.parse.unquote(m.group(1))
    if return_url.startswith("/"):
        return_url = IDENTITY_BASE + return_url

    payload = {
        "userName": username,
        "password": password,
        "clientId": CLIENT_ID,
        "returnUrl": b64(return_url),
        "channelType": "",
        "channelCode": "",
        "channelSessionId": "",
    }
    r3 = session.post(
        IDENTITY_BASE + "/api/login/byCookie",
        json={"data": b64(json.dumps(payload))},
        headers={"Referer": IDENTITY_BASE + "/account/RegisterOrLogin"},
        timeout=30,
    )
    try:
        d = r3.json()
    except Exception:
        print(f"[!] 登录接口返回非 JSON: {r3.text[:200]}")
        return False
    if d.get("errorCode") != "success":
        print(f"[!] 登录失败: {d.get('errorCode')} - {d.get('errorDescription')}")
        return False

    session.get(return_url, allow_redirects=True, timeout=30)
    os.makedirs(out_dir, exist_ok=True)
    sess_path = os.path.join(out_dir, SESSION_FILE)
    with open(sess_path, "w", encoding="utf-8") as f:
        json.dump(session.cookies.get_dict(), f, ensure_ascii=False, indent=2)
    print(f"[+] 登录成功，会话已缓存: {sess_path}")
    return True


def load_session(session, out_dir):
    path = os.path.join(out_dir, SESSION_FILE)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            cookies = json.load(f)
        for k, v in cookies.items():
            session.cookies.set(k, v)
        print(f"[*] 已从 {path} 恢复登录会话")
        return True
    return False


def fetch_enterprises(session):
    """拉取企业列表，登录态有效时返回 list，否则返回 None。"""
    try:
        r = session.get(DEFAULT_BASE + API_ENTERPRISES, timeout=20)
        if r.status_code != 200:
            return None
        data = r.json()
    except Exception as e:
        print(f"[!] 获取企业列表失败: {e}")
        return None
    if not isinstance(data, list):
        return None
    return data


def pick_enterprise(session, cfg, ents=None):
    """获取企业列表并选择目标企业，返回 enterprise dict 或 None。
    ents 可传入已拉取的企业列表，避免重复请求。"""
    if ents is None:
        ents = fetch_enterprises(session)
    if ents is None:
        print("[!] 获取企业列表失败（可能登录态已失效）")
        return None
    if not ents:
        print("[!] 账号未加入任何企业（含个人账号）")
        return None

    want = (cfg.get("enterprise_id") or "").strip()
    if want:
        for e in ents:
            if e.get("id") == want:
                return e
        print(f"[!] 配置的 enterprise_id 未在账号企业列表中找到: {want}")

    # 优先非个人账号
    for e in ents:
        if not e.get("isIndividualAccount"):
            return e
    return ents[0]


def authenticate(session, cfg, out_dir):
    """确保已登录且能取到企业列表，返回选中的 enterprise dict 或 None。
    任一方式成功即返回；只要前面方式失效，都会自动回退到账号密码重新登录，不会直接退出。
    尝试顺序：config 的 cookie → 缓存会话（有效复用，失效删后重登）→ 账号密码登录。"""
    def login_by_account():
        acc = cfg.get("account", {})
        username = acc.get("username") or acc.get("phone") or acc.get("email") or ""
        password = acc.get("password", "")
        if not (username and password):
            print("[!] 未配置账号密码，无法重新登录（请在 config.json 的 account 中填写用户名与密码）")
            return None
        try:
            ok = login_by_password(session, username, password, out_dir)
        except Exception as e:
            print("[!] 账号密码登录过程出错: %s" % e)
            return None
        if not ok:
            print("[!] 账号密码登录失败，请检查账号密码是否正确、账号是否已加入企业")
            return None
        print("[*] 已通过账号密码重新登录")
        return pick_enterprise(session, cfg)

    # 1) config 中的 cookie（若配置）
    cookie = cfg.get("cookie", "")
    if cookie:
        print("[*] 使用 config.json 中的 Cookie")
        # 用 session.cookies 承载，避免与后续账号登录的 cookie 冲突
        session.headers.update({"Cookie": cookie})
        ent = pick_enterprise(session, cfg)
        if ent is not None:
            return ent
        # cookie 失效：清除手动 Cookie 头，回退到缓存会话 / 账号密码登录
        print("[!] 配置的 Cookie 已失效，改走账号密码重新登录")
        session.headers.pop("Cookie", None)

    # 2) 缓存会话
    if load_session(session, out_dir):
        ents = fetch_enterprises(session)
        if ents:
            print("[*] 缓存会话有效")
            ent = pick_enterprise(session, cfg, ents=ents)
            if ent is not None:
                return ent
            # 能取到企业却选不出（理论不会发生），降级到账号密码登录
            print("[!] 缓存会话有效但无法选定企业，改用账号密码登录")
        else:
            print("[!] 缓存会话已失效（企业列表为空），删除并改用账号密码重新登录")
            try:
                os.remove(os.path.join(out_dir, SESSION_FILE))
            except OSError:
                pass

    # 3) 账号密码重新登录
    return login_by_account()


def switch_enterprise(session, ent):
    """切换企业会话并设置 EnterpriseId 请求头"""
    ent_id = ent["id"]
    r = session.get(DEFAULT_BASE + API_SESSION, params={"enterprise_id": ent_id}, timeout=20)
    ok = r.status_code == 200 and r.json().get("success") is True
    session.headers["EnterpriseId"] = ent_id
    print(f"[+] 已切换到企业: {ent.get('name')}（id={ent_id}）"
          f"{'会话切换成功' if ok else '，但会话切换接口返回异常'}")
    return ok


def fetch_all(session, path, limit=50, cut_off_ms=None, time_field="startTime"):
    """按 start/limit 偏移分页拉取记录。
    cut_off_ms 非空时：假定接口按 time_field 倒序返回（最新在前），
    遇到早于截止时间的记录即提前停止（后续只会更旧），用于快速抓取最近 N 天。
    """
    all_items, start = [], 0
    while True:
        r = session.get(DEFAULT_BASE + path, params={"start": start, "limit": limit}, timeout=30)
        d = r.json()
        items = d.get("items", []) or []
        truncated = False
        for it in items:
            all_items.append(it)
            if cut_off_ms is not None:
                t = to_ms(it.get(time_field))
                if t is not None and t < cut_off_ms:
                    truncated = True
                    break  # 本页及后续页都是更旧的记录，停止
        total = d.get("total", len(all_items))
        print(f"  已拉取 {len(all_items)}/{total}")
        if truncated or not items or len(all_items) >= total:
            break
        start += limit
    # 按 id 去重（接口可能重复返回）
    seen, uniq = set(), []
    for it in all_items:
        if it.get("id") not in seen:
            seen.add(it.get("id"))
            uniq.append(it)
    return uniq


def normalize_trigger(it):
    """把触发器原始记录映射为统一字段"""
    cfg_ = it.get("triggerConfig") or {}
    calendar = cfg_.get("calendar") or {}
    trigger_type = it.get("triggerType") or ""
    ttype_cn = {"BotTiming": "定时", "Webhook": "Webhook"}.get(trigger_type, trigger_type or "-")
    cron_text = (calendar.get("cronExpressionData") or {}).get("text") or ""
    return {
        "trigger_id": it.get("id") or "",
        "trigger_name": it.get("name") or "",
        "robot_name": it.get("executorName") or "(未指定机器人)",
        "app_name": it.get("flowName") or "",
        "trigger_type": ttype_cn,
        "cron": cron_text,
        "enabled": it.get("enable"),
        "calendar": json.dumps(calendar, ensure_ascii=False) if calendar else "",
        "update_time": it.get("updateTime") or "",
        "raw": json.dumps(it, ensure_ascii=False),
    }


def normalize_run_record(it):
    """把运行记录原始记录映射为统一字段"""
    return {
        "flow_id": it.get("flowId") or "",
        "process_no": it.get("flowProcessNo") or "",
        "flow_name": it.get("flowName") or "",
        "bot_name": it.get("botName") or "(未指定机器人)",
        "trigger_id": it.get("triggerId") or "",
        "trigger_name": it.get("triggerName") or "",
        "start_way": it.get("startWay") or "",
        "status": it.get("status") or "",
        "start_time": it.get("startTime") or "",
        "end_time": it.get("endTime") or "",
        "execution_start_time": it.get("executionStartTime") or "",
        "raw": json.dumps(it, ensure_ascii=False),
    }


def main():
    ap = argparse.ArgumentParser(description="八爪鱼 RPA 触发器爬虫（企业版）")
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--out", default="output")
    ap.add_argument("--only-runs", action="store_true",
                    help="仅抓取运行记录（快速刷新用，跳过触发器/机器人）")
    ap.add_argument("--days", type=int, default=7,
                    help="运行记录只保留最近 N 天（默认 7）")
    args = ap.parse_args()

    with open(args.config, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    os.makedirs(args.out, exist_ok=True)

    # 建立会话（Cookie / 缓存会话 / 账号密码）
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Referer": DEFAULT_BASE + "/management/enterprise/robot-trigger",
        "Accept": "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
    })
    # 鉴权：Cookie 优先；其次缓存会话（验证失效则删除并回退账号密码重新登录）
    ent = authenticate(session, cfg, args.out)
    if not ent:
        # 不再直接退出（否则 start_server.bat 会中断、服务器起不来）。
        # 打印 [AUTH_FAILED] 哨兵，服务器仍会启动并显示最近一次成功抓取的数据；
        # 网页的自动刷新会持续尝试重新登录。
        print("[AUTH_FAILED] 登录失败：无法确定目标企业。服务器仍会启动并显示最近一次成功抓取的数据；"
              "网页自动刷新会持续尝试重新登录。请检查 config.json 的 account 账号密码是否正确。")
        return
    switch_enterprise(session, ent)

    # 机器人过滤规则（运行记录与触发器共用）
    include = [str(k) for k in (cfg.get("include_robots") or [])]
    exclude = [str(k) for k in (cfg.get("exclude_robots") or [])]

    def keep_name(name):
        # 空名（未指定机器人）不保留：仅保留有明确机器人名称的记录
        if not name:
            return False
        if include and not any(name.startswith(p) for p in include):
            return False
        if any(k in name for k in exclude):
            return False
        return True

    # 拉取运行记录：只保留最近 args.days 天、符合机器人过滤（保留手动/定时/Webhook 全部触发方式）
    cut_off_ms = int(time.time() * 1000) - args.days * 86400000
    print(f"[*] 拉取运行记录（最近 {args.days} 天）...")
    runs = fetch_all(session, API_RUNNING_RECORDS, cut_off_ms=cut_off_ms)
    print(f"[+] 运行记录共 {len(runs)} 条")
    keep_runs = [r for r in runs
                 if (r.get("startWay") or "") and keep_name(r.get("botName") or "")]
    from collections import Counter as _W
    way_dist = _W(r.get("startWay") for r in keep_runs)
    print(f"    保留 {len(keep_runs)} 条（已按 include/exclude 过滤机器人），触发方式: {dict(way_dist)}")
    run_rows = [normalize_run_record(r) for r in keep_runs]
    run_header = ["flow_id", "process_no", "flow_name", "bot_name", "trigger_id",
                  "trigger_name", "start_way", "status", "start_time", "end_time",
                  "execution_start_time"]
    with open(os.path.join(args.out, "runs_normalized.csv"), "w",
              encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(run_header)
        for r in run_rows:
            w.writerow([r[h] for h in run_header])
    print(f"[+] 运行记录已保存: {args.out}/runs_normalized.csv")
    if run_rows:
        from collections import Counter as _C
        by_status = _C(r["status"] for r in run_rows)
        by_robot = _C(r["bot_name"] for r in run_rows)
        print(f"    状态分布: {dict(by_status)}")
        print(f"    机器人数: {len(by_robot)}")

    if args.only_runs:
        print("[✓] 运行记录刷新完成")
        return

    # ---- 完整流程：触发器 + 机器人 + 归一化 CSV + 统计 ----
    # 拉取触发器
    print("[*] 拉取触发器列表 ...")
    triggers = fetch_all(session, API_TRIGGERS)
    print(f"[+] 触发器共 {len(triggers)} 条")

    # 拉取机器人（供对照）
    try:
        bots = fetch_all(session, API_BOTS, limit=50)
        print(f"[+] 机器人共 {len(bots)} 台")
    except Exception as e:
        bots = []
        print(f"[!] 机器人列表拉取失败: {e}")

    # 保存原始数据
    with open(os.path.join(args.out, "triggers_raw.json"), "w", encoding="utf-8") as f:
        json.dump({"enterprise": ent, "triggers": triggers, "bots": bots},
                  f, ensure_ascii=False, indent=2)
    print(f"[+] 原始数据已保存: {args.out}/triggers_raw.json")

    # 归一化 CSV（支持按机器人前缀保留 + 关键词排除）
    header = ["trigger_id", "trigger_name", "robot_name", "app_name",
              "trigger_type", "cron", "enabled", "calendar", "update_time"]

    def keep(t):
        return keep_name(t.get("executorName") or "")

    kept = [t for t in triggers if keep(t)]
    dropped = len(triggers) - len(kept)
    if dropped:
        print(f"[*] 已过滤 {dropped} 条（include={include}, exclude={exclude}）")
    rows = [normalize_trigger(t) for t in kept]
    with open(os.path.join(args.out, "triggers_normalized.csv"), "w",
              encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        for r in rows:
            w.writerow([r[h] for h in header])
    print(f"[+] 归一化数据已保存: {args.out}/triggers_normalized.csv")

    # 统计
    from collections import Counter
    by_robot = Counter(r["robot_name"] for r in rows)
    by_type = Counter(r["trigger_type"] for r in rows)
    enabled = sum(1 for r in rows if r["enabled"] is True)
    print(f"\n=== 统计 ===")
    print(f"触发器总数: {len(rows)}（启用 {enabled}）")
    print(f"触发类型: {dict(by_type)}")
    print(f"机器人数: {len(by_robot)}")
    for name, c in by_robot.most_common():
        print(f"  {name}: {c}")
    print("\n[✓] 爬取完成")


if __name__ == "__main__":
    main()
