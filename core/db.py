# -*- coding: utf-8 -*-
"""MySQL 持久层：八爪鱼 RPA 运行记录入库（幂等 upsert）。

配置（config.json -> "mysql" 段；缺该段 / 缺 pymysql / 连接失败时一律静默跳过，
不影响仪表盘任何功能）：
    "mysql": {
        "host": "127.0.0.1",
        "port": 3306,
        "user": "root",
        "password": "xxx",
        "database": "octopus_rpa"
    }

表 rpa_runs：主键 process_no（每次运行唯一）。
写入来源两种，都是幂等 upsert，跑完的终态覆盖在途状态：
  - crawler 全量/快速刷新后的 RECORDS（source="crawler"，60s 粒度）
  - underway 实时轮询的在途记录（source="underway"，8s 粒度，先行入库）

时间存毫秒时间戳（start_ms/end_ms/exec_start_ms，与内存 RECORDS 一致），
另存 start_dt（北京时间 DATETIME）方便肉眼查看与按天分组。
"""
import json
import os
import time
from datetime import datetime, timezone, timedelta

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # 项目根（core/ 的上级）
CFG_FILE = os.path.join(BASE, "config.json")
TABLE = "rpa_runs"

_BJT = timezone(timedelta(hours=8))   # 北京时间（start_dt 列用）
_last_err = [0.0, ""]          # 限频打印：[上次报错时间戳, 上次报错摘要]


def _cfg():
    """读 config.json 的 mysql 段；未配置返回 None。"""
    try:
        with open(CFG_FILE, "r", encoding="utf-8") as f:
            m = (json.load(f) or {}).get("mysql") or {}
    except Exception:
        return None
    if not m.get("host") or not m.get("database"):
        return None
    return {
        "host": m["host"],
        "port": int(m.get("port") or 3306),
        "user": m.get("user") or "root",
        "password": m.get("password") or "",
        "database": m["database"],
        "charset": m.get("charset") or "utf8mb4",
    }


def _err(msg):
    """错误限频打印：同一摘要 30 秒内只打一次。"""
    now = time.time()
    if msg != _last_err[1] or now - _last_err[0] > 30:
        print("[mysql] %s" % msg)
        _last_err[0], _last_err[1] = now, msg


def _connect(cfg=None, with_db=True):
    import pymysql
    c = cfg or _cfg()
    if not c:
        return None, None
    kw = dict(host=c["host"], port=c["port"], user=c["user"],
              password=c["password"], charset=c["charset"],
              connect_timeout=5, autocommit=True)
    if with_db:
        kw["database"] = c["database"]
    return pymysql.connect(**kw), c


def _ms_to_dt(ms):
    """毫秒时间戳 -> 北京时间 DATETIME 字符串（None 原样返回）。"""
    if not ms:
        return None
    return datetime.fromtimestamp(int(ms) / 1000, _BJT).strftime("%Y-%m-%d %H:%M:%S")


def iso_to_ms(v):
    """ISO 8601 / 13 位毫秒 / 10 位秒 -> 毫秒时间戳；失败返回 None。"""
    if not v:
        return None
    s = str(v)
    try:
        if s.isdigit():
            return int(s) * (1000 if len(s) == 10 else 1)
        from datetime import datetime as dt
        d = dt.fromisoformat(s.replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return int(d.timestamp() * 1000)
    except Exception:
        return None


DDL_DATABASE = "CREATE DATABASE IF NOT EXISTS `{db}` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
DDL_TABLE = """
CREATE TABLE IF NOT EXISTS `{db}`.`{table}` (
  process_no     VARCHAR(32)  NOT NULL,
  flow_id        VARCHAR(64)  NOT NULL DEFAULT '',
  flow_name      VARCHAR(255) NOT NULL DEFAULT '',
  bot_name       VARCHAR(128) NOT NULL DEFAULT '',
  trigger_name   VARCHAR(255) NOT NULL DEFAULT '',
  start_way      VARCHAR(32)  NOT NULL DEFAULT '',
  status         VARCHAR(32)  NOT NULL DEFAULT '',
  start_ms       BIGINT       NOT NULL,
  start_dt       DATETIME         NULL,
  end_ms         BIGINT           NULL,
  exec_start_ms  BIGINT           NULL,
  source         VARCHAR(16)  NOT NULL DEFAULT '',
  updated_at     DATETIME     NOT NULL,
  PRIMARY KEY (process_no),
  KEY idx_start_ms (start_ms),
  KEY idx_bot (bot_name),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

_UPSERT = """
INSERT INTO `{db}`.`{table}`
  (process_no, flow_id, flow_name, bot_name, trigger_name, start_way,
   status, start_ms, start_dt, end_ms, exec_start_ms, source, updated_at)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
ON DUPLICATE KEY UPDATE
  status=VALUES(status), end_ms=VALUES(end_ms), exec_start_ms=VALUES(exec_start_ms),
  bot_name=VALUES(bot_name), source=VALUES(source),
  updated_at=IF(status=VALUES(status) AND end_ms<=>VALUES(end_ms)
                AND exec_start_ms<=>VALUES(exec_start_ms)
                AND bot_name=VALUES(bot_name) AND source=VALUES(source),
                updated_at, VALUES(updated_at))
"""


def init_db():
    """建库建表（幂等）。未配置/失败返回 False，不抛错。"""
    cfg = _cfg()
    if not cfg:
        return False
    try:
        conn, _ = _connect(cfg, with_db=False)
        if conn is None:
            return False
        with conn.cursor() as cur:
            cur.execute(DDL_DATABASE.format(db=cfg["database"]))
        conn.close()
        conn, _ = _connect(cfg)
        with conn.cursor() as cur:
            cur.execute(DDL_TABLE.format(db=cfg["database"], table=TABLE))
        conn.close()
        print("[mysql] 就绪：%s.%s" % (cfg["database"], TABLE))
        return True
    except ImportError:
        _err("未安装 pymysql（pip install pymysql），入库跳过")
        return False
    except Exception as e:
        _err("连接失败，入库跳过：%s" % e)
        return False


def upsert_raw_runs(rows, source="crawler"):
    """运行记录批量 upsert（crawler 的原始行，时间为 ISO 8601 字符串）。

    rows：crawler.normalize_run_record() 输出的行
          （flow_id/process_no/flow_name/bot_name/trigger_name/start_way/
            status/start_time/end_time/execution_start_time）。
    幂等：同 process_no 以最后一次写入为准（在途 -> 终态覆盖）。
    返回「实际发生变更的 process_no 列表」（新写或内容有更新；与库中完全
    一致的重放行不算）——空列表 = 库无变化。records_poller 据此决定要不要
    bump DATA_REV / 广播 SSE，并把 pno 随事件带给前端做精确增量拉取。
    """
    cfg = _cfg()
    if not cfg or not rows:
        return []
    out, now = [], datetime.now(_BJT).strftime("%Y-%m-%d %H:%M:%S")
    for r in rows:
        pno = str(r.get("process_no") or "")
        start = iso_to_ms(r.get("start_time"))
        if not pno or not start:
            continue
        out.append((
            pno, r.get("flow_id") or "", r.get("flow_name") or "",
            r.get("bot_name") or "", r.get("trigger_name") or "", r.get("start_way") or "",
            r.get("status") or "", start, _ms_to_dt(start),
            iso_to_ms(r.get("end_time")), iso_to_ms(r.get("execution_start_time")),
            source, now,
        ))
    if not out:
        return []
    try:
        conn, _ = _connect(cfg)
        if conn is None:
            return []
        changed = []
        with conn.cursor() as cur:
            # 逐行执行而非 executemany：executemany 的合并 rowcount 无法区分
            # 「每行没变化（affected=0）」，逐行才能精确知道哪些行真的变了。
            # rowcount 语义：1=新插入，2=更新且有变化，0=内容与库中完全一致。
            for row in out:
                cur.execute(_UPSERT_SINGLE.format(db=cfg["database"], table=TABLE), row)
                if cur.rowcount and cur.rowcount > 0:
                    changed.append(row[0])
        conn.close()
        return changed
    except ImportError:
        _err("未安装 pymysql，入库跳过")
        return []
    except Exception as e:
        _err("写入失败：%s" % e)
        return []


def UPSERT_SQL(cfg):
    return _UPSERT.format(db=cfg["database"], table=TABLE)


_UPSERT_SINGLE = _UPSERT   # 逐行执行与批量共用同一条 SQL 模板


_COLS = "process_no, flow_id, flow_name, bot_name, trigger_name, start_way, status, start_ms, end_ms, exec_start_ms"


def fetch_records(limit=None, since_ms=None, pnos=None):
    """按 start_ms 倒序查询（最新在前）。
    limit 给定时只取最新 N 条；since_ms 给定时只取「在途或 end >= since_ms」的行
    （按与时间范围的 overlapped 判定，覆盖跨界的长任务）；
    pnos 给定时只取这些 process_no 的行（SSE 精确增量拉取：变更了哪几条就取哪几条），
    与 limit/since_ms 可叠加（取交叠行后仍按 start_ms 倒序 + limit 截断）。"""
    cfg = _cfg()
    if not cfg:
        return []
    try:
        conn, _ = _connect(cfg)
        if conn is None:
            return []
        sql = "SELECT {cols} FROM `{db}`.`{table}`".format(
            cols=_COLS, db=cfg["database"], table=TABLE)
        conds, params = [], []
        if pnos:
            # 分批拼占位符（process_no 是主键，一批 pnos 数量有限）
            ph = ",".join(["%s"] * len(pnos))
            conds.append("process_no IN (%s)" % ph)
            params.extend(str(p) for p in pnos)
        if since_ms:
            conds.append("(end_ms IS NULL OR end_ms >= %s)")
            params.append(int(since_ms))
        if conds:
            sql += " WHERE " + " AND ".join(conds)
        if limit:
            sql += " ORDER BY start_ms DESC LIMIT %s"
            params.append(int(limit))
        elif conds:
            sql += " ORDER BY start_ms DESC"
        with conn.cursor(pymysql_ss()) as cur:
            cur.execute(sql, params or None)
            cols = [c[0] for c in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        conn.close()
        rows.sort(key=lambda r: r["start_ms"], reverse=True)
        return rows
    except Exception as e:
        _err("查询失败：%s" % e)
        return []


def pymysql_ss():
    """游标类（延迟导入，避免模块顶层依赖 pymysql）。"""
    import pymysql.cursors
    return pymysql.cursors.SSCursor


def fetch_run_by_pno(pno):
    """按 process_no 查单条。"""
    pno = str(pno or "")
    if not pno:
        return None
    cfg = _cfg()
    if not cfg:
        return None
    try:
        conn, _ = _connect(cfg)
        if conn is None:
            return None
        with conn.cursor() as cur:
            cur.execute("SELECT {cols} FROM `{db}`.`{table}` WHERE process_no=%s".format(
                cols=_COLS, db=cfg["database"], table=TABLE), (pno,))
            cols = [c[0] for c in cur.description]
            row = cur.fetchone()
        conn.close()
        return dict(zip(cols, row)) if row else None
    except Exception as e:
        _err("查询失败：%s" % e)
        return None


def count_runs():
    """表内总行数（/api/refresh、启动横幅用）。"""
    cfg = _cfg()
    if not cfg:
        return 0
    try:
        conn, _ = _connect(cfg)
        if conn is None:
            return 0
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM `{db}`.`{table}`".format(
                db=cfg["database"], table=TABLE))
            n = cur.fetchone()[0]
        conn.close()
        return int(n)
    except Exception:
        return 0


def stats():
    """调试用：表内行数与最近一条 start_dt。"""
    cfg = _cfg()
    if not cfg:
        return None
    try:
        conn, _ = _connect(cfg)
        if conn is None:
            return None
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), MAX(start_dt) FROM `{db}`.`{table}`".format(
                db=cfg["database"], table=TABLE))
            n, latest = cur.fetchone()
        conn.close()
        return {"rows": n, "latest_start": str(latest) if latest else None}
    except Exception as e:
        _err("查询失败：%s" % e)
        return None


if __name__ == "__main__":
    # python db.py init   建库建表
    # python db.py stats  看行数
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "init":
        print("init:", init_db())
    elif len(sys.argv) > 1 and sys.argv[1] == "stats":
        print("stats:", stats())
    else:
        print("用法: python db.py init|stats")
