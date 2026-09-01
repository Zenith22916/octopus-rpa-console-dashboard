# -*- coding: utf-8 -*-
"""八爪鱼 RPA MCP Server

让 AI 通过 MCP 工具直接操作八爪鱼 RPA：
  - 流程文件：列出 / 解密读取 / 全文搜索 / 修改回写 / 备份恢复
  - 密钥：查询当前 AES 密钥与重取方法
  - 企业管台：触发器清单、运行记录（只读，来自 crawler 抓取的数据）

依赖：pip install "mcp<2" cryptography
配置（WorkBuddy mcp.json）：
  "octopus-rpa": {
    "command": "<python.exe 路径>",
    "args": ["E:\\bazhuayu_crawler\\octo_mcp\\server.py"]
  }
"""
import csv
import io
import json
import os
import shutil
import time
from pathlib import Path

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from mcp.server.fastmcp import FastMCP

# ---------------------------------------------------------------------------
# 配置
# ---------------------------------------------------------------------------
APPDATA = os.environ.get("APPDATA", os.path.expanduser("~"))
WORKSPACES = Path(APPDATA) / "OctopusRPA" / "Workspaces"
CRAWLER_OUT = Path(r"E:\bazhuayu_crawler\output")

DEFAULT_KEY_HEX = "6f63746f7075737270612d3230323478"  # "octopusrpa-2024x"
DEFAULT_IV_HEX = "1a2b3c4d5e6f708192a3b4c5d6e7f809"
KEY_HEX = os.environ.get("OCTO_SUBFLOW_KEY") or DEFAULT_KEY_HEX
IV_HEX = os.environ.get("OCTO_SUBFLOW_IV") or DEFAULT_IV_HEX
KEY = bytes.fromhex(KEY_HEX)
IV = bytes.fromhex(IV_HEX)

mcp = FastMCP("octopus-rpa")


# ---------------------------------------------------------------------------
# 底层：加解密 / 定位
# ---------------------------------------------------------------------------
def _decrypt(data: bytes) -> bytes:
    c = Cipher(algorithms.AES(KEY), modes.CBC(IV)).decryptor()
    out = c.update(data) + c.finalize()
    pad = out[-1]
    if 1 <= pad <= 16 and out[-pad:] == bytes([pad]) * pad:
        out = out[:-pad]
    return out


def _encrypt(plain: bytes) -> bytes:
    pad_len = 16 - (len(plain) % 16)
    padded = plain + bytes([pad_len]) * pad_len
    c = Cipher(algorithms.AES(KEY), modes.CBC(IV)).encryptor()
    return c.update(padded) + c.finalize()


def _flow_dirs() -> dict:
    """flow_id -> 解密目录（跨 project 去重，同名取最近修改）"""
    out = {}
    if not WORKSPACES.is_dir():
        return out
    for ws in WORKSPACES.iterdir():
        if not ws.is_dir():
            continue
        for proj in ws.iterdir():
            if not proj.is_dir() or "-" not in proj.name:
                continue  # 跳过 icons/imgs/resources/screenshots
            for flow in proj.iterdir():
                if flow.is_dir():
                    m = flow.stat().st_mtime
                    if flow.name not in out or m > out[flow.name][1]:
                        out[flow.name] = (flow, m)
    return {k: v[0] for k, v in out.items()}


def _subflow_file(flow_id: str, subflow: str) -> Path:
    dirs = _flow_dirs()
    if flow_id not in dirs:
        raise ValueError(f"未找到流程 {flow_id}，可用 octo_list_projects 查看全部")
    p = dirs[flow_id] / f"{subflow}.subflow"
    if not p.is_file():
        raise ValueError(f"未找到子流程文件: {p}")
    return p


def _flow_name_map() -> dict:
    """flow_id -> 应用名（来自企业管理台抓取数据）"""
    raw = CRAWLER_OUT / "triggers_raw.json"
    out = {}
    if raw.is_file():
        try:
            data = json.loads(raw.read_text(encoding="utf-8"))
            for t in data.get("triggers", []):
                fid, fn = t.get("flowId"), (t.get("flowName") or "").strip()
                if fid and fn:
                    out.setdefault(fid, fn)
        except Exception:
            pass
    return out


def _valid_json(data: bytes) -> bool:
    s = data.decode("utf-8", errors="replace").lstrip("\ufeff \r\n\t")
    try:
        dec = json.JSONDecoder()
        while s:
            s = s.lstrip()
            if not s:
                break
            _, end = dec.raw_decode(s)
            s = s[end:]
        return True
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# 工具：流程文件
# ---------------------------------------------------------------------------
@mcp.tool()
def octo_list_projects() -> str:
    """列出八爪鱼 Workspaces 下所有流程（含应用名、子流程数、更新时间）。"""
    names = _flow_name_map()
    rows = []
    for fid, d in sorted(_flow_dirs().items(), key=lambda x: -x[1].stat().st_mtime):
        subs = [f.name[:-8] for f in d.glob("*.subflow")]
        rows.append({
            "flow_id": fid,
            "app_name": names.get(fid, ""),
            "subflows": len(subs),
            "subflow_names": subs,
            "updated": time.strftime("%Y-%m-%d", time.localtime(d.stat().st_mtime)),
        })
    return json.dumps({"total": len(rows), "flows": rows}, ensure_ascii=False, indent=1)


@mcp.tool()
def octo_read_subflow(flow_id: str, subflow: str, max_chars: int = 30000) -> str:
    """解密并读取某个子流程的明文 JSON（超长自动截断）。"""
    p = _subflow_file(flow_id, subflow)
    plain = _decrypt(p.read_bytes()).decode("utf-8", errors="replace")
    if len(plain) > max_chars:
        return json.dumps({"file": str(p), "total_chars": len(plain), "truncated": True,
                           "content": plain[:max_chars]}, ensure_ascii=False)
    return json.dumps({"file": str(p), "total_chars": len(plain), "truncated": False,
                       "content": plain}, ensure_ascii=False)


@mcp.tool()
def octo_search_flows(keyword: str, max_results: int = 10) -> str:
    """在所有子流程明文中搜索关键词（会解密全部流程，稍慢）。返回命中的 flow/子流程/上下文。"""
    hits = []
    for fid, d in _flow_dirs().items():
        for sf in d.glob("*.subflow"):
            try:
                txt = _decrypt(sf.read_bytes()).decode("utf-8", errors="replace")
            except Exception:
                continue
            idx = txt.find(keyword)
            if idx >= 0:
                ctx = txt[max(0, idx - 120): idx + 200].replace("\r", "").replace("\n", " ")
                hits.append({"flow_id": fid, "subflow": sf.name[:-8], "context": ctx})
                if len(hits) >= max_results:
                    return json.dumps({"keyword": keyword, "hits": hits}, ensure_ascii=False)
    return json.dumps({"keyword": keyword, "hits": hits}, ensure_ascii=False)


@mcp.tool()
def octo_write_subflow(flow_id: str, subflow: str, content: str) -> str:
    """修改子流程：校验 JSON → 自动备份 → AES 加密回写。

    content 为完整的流程明文 JSON（建议先 octo_read_subflow 拿到原文、改完再整体写入）。
    注意：回写前需关闭八爪鱼 Studio（文件锁）；回写后建议在 Studio 中打开保存一次以刷新 .etag，
    避免云端同步覆盖。
    """
    if not _valid_json(content.encode("utf-8")):
        raise ValueError("content 不是合法 JSON，已拒绝写入")
    p = _subflow_file(flow_id, subflow)
    ts = time.strftime("%Y%m%d_%H%M%S")
    backup = p.with_name(f"{p.stem}.subflow.bak_{ts}")
    shutil.copy2(p, backup)
    try:
        p.write_bytes(_encrypt(content.encode("utf-8")))
    except PermissionError as e:
        backup.unlink(missing_ok=True)
        raise ValueError(f"写入失败（文件被占用，请先关闭八爪鱼 Studio）: {e}")
    return json.dumps({"written": str(p), "backup": str(backup)}, ensure_ascii=False)


@mcp.tool()
def octo_list_backups(flow_id: str, subflow: str) -> str:
    """列出某子流程的全部备份文件。"""
    p = _subflow_file(flow_id, subflow)
    baks = sorted(d.name for d in p.parent.glob(f"{p.stem}.subflow.bak_*"))
    return json.dumps({"backups": baks}, ensure_ascii=False)


@mcp.tool()
def octo_restore_backup(flow_id: str, subflow: str, backup_file: str) -> str:
    """用备份恢复子流程（当前文件会先另存一份）。"""
    p = _subflow_file(flow_id, subflow)
    src = p.parent / backup_file
    if not src.is_file():
        raise ValueError(f"备份不存在: {src}")
    keep = p.with_name(f"{p.stem}.subflow.before_restore_{time.strftime('%Y%m%d_%H%M%S')}")
    shutil.copy2(p, keep)
    shutil.copy2(src, p)
    return json.dumps({"restored_from": str(src), "current_saved_as": str(keep)}, ensure_ascii=False)


# ---------------------------------------------------------------------------
# 工具：密钥
# ---------------------------------------------------------------------------
@mcp.tool()
def octo_get_key() -> str:
    """返回当前 .subflow AES 密钥与 IV。若解密失败（密钥已更换），按返回的说明用 Startup Hook 重取。"""
    return json.dumps({
        "key_hex": KEY_HEX, "iv_hex": IV_HEX,
        "key_ascii": KEY.hex() and bytes.fromhex(KEY_HEX).decode("latin1", errors="replace"),
        "env_override": ["OCTO_SUBFLOW_KEY", "OCTO_SUBFLOW_IV"],
        "re_extract_guide": (
            "密钥失效时：1) 关闭 OctopusRPA.Studio；"
            "2) cd scripts/key_extract && dotnet build -c Release（见 octopus-subflow-editor skill）；"
            "3) $env:DOTNET_STARTUP_HOOKS='<OctoStartupHook.dll 绝对路径>' 后启动 Studio；"
            "4) 读取 %APPDATA%\\OctopusRPA\\subflow_key.txt"
        ),
    }, ensure_ascii=False, indent=1)


# ---------------------------------------------------------------------------
# 工具：企业管理台（只读，来自 crawler 抓取数据）
# ---------------------------------------------------------------------------
@mcp.tool()
def octo_list_triggers(enabled_only: bool = True) -> str:
    """列出企业管理台触发器（应用名/机器人/类型/排期/启用状态）。"""
    raw = CRAWLER_OUT / "triggers_raw.json"
    if not raw.is_file():
        raise ValueError(f"未找到抓取数据 {raw}，请先运行 E:\\bazhuayu_crawler\\crawler.py")
    data = json.loads(raw.read_text(encoding="utf-8"))
    out = []
    for t in data.get("triggers", []):
        if enabled_only and not t.get("enable"):
            continue
        cal = (t.get("triggerConfig") or {}).get("calendar") or {}
        sched = ""
        if (cal.get("dailyData") or {}).get("timePoints"):
            sched = "每天 " + ",".join(f"{p.get('hour'):02d}:{p.get('minute'):02d}"
                                       for p in cal["dailyData"]["timePoints"])
        elif (cal.get("weeklyData") or {}).get("dayOfWeeks"):
            wd = ["周日","周一","周二","周三","周四","周五","周六"]
            sched = "每周" + "、".join(wd[d] for d in cal["weeklyData"]["dayOfWeeks"])
        elif t.get("triggerType") == "Webhook":
            sched = "Webhook"
        out.append({"trigger": t.get("name"), "app": t.get("flowName"),
                    "robot": t.get("executorName"), "type": t.get("triggerType"),
                    "schedule": sched, "enabled": bool(t.get("enable")),
                    "flow_id": t.get("flowId")})
    return json.dumps({"total": len(out), "triggers": out}, ensure_ascii=False, indent=1)


@mcp.tool()
def octo_list_runs(days: int = 7, limit: int = 100) -> str:
    """查看最近的流程运行记录（默认 7 天，最新的在前）。"""
    runs_file = CRAWLER_OUT / "runs_normalized.csv"
    if not runs_file.is_file():
        raise ValueError(f"未找到运行记录 {runs_file}，请先运行 crawler.py")
    rows = []
    with open(runs_file, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            rows.append(r)
    rows.sort(key=lambda x: x.get("start_time", ""), reverse=True)
    return json.dumps({"total_recent": len(rows),
                       "runs": rows[:limit]}, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    mcp.run(transport="stdio")
