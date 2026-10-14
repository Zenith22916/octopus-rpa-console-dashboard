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
TRIGGER_TABLE = "rpa_triggers"

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
  updated_ms     BIGINT       NOT NULL DEFAULT 0,
  PRIMARY KEY (process_no),
  KEY idx_start_ms (start_ms),
  KEY idx_bot (bot_name),
  KEY idx_status (status),
  KEY idx_updated_ms (updated_ms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

# 触发器排期表：crawler 从网页版 API 抓到的触发器归一化后落库（12h 一轮），
# 排期页/合规页/Excel 导出统一读这张表，不再依赖 CSV 文件。
DDL_TRIGGERS = """
CREATE TABLE IF NOT EXISTS `{db}`.`{ttable}` (
  trigger_id     VARCHAR(32)  NOT NULL,
  flow_id        VARCHAR(64)  NOT NULL DEFAULT '',
  trigger_name   VARCHAR(255) NOT NULL DEFAULT '',
  robot_name     VARCHAR(128) NOT NULL DEFAULT '',
  app_name       VARCHAR(255) NOT NULL DEFAULT '',
  trigger_type   VARCHAR(32)  NOT NULL DEFAULT '',
  cron           VARCHAR(255) NOT NULL DEFAULT '',
  enabled        TINYINT(1)       NULL,
  calendar       MEDIUMTEXT       NULL,
  update_time    VARCHAR(32)  NOT NULL DEFAULT '',
  updated_ms     BIGINT       NOT NULL DEFAULT 0,
  PRIMARY KEY (trigger_id),
  KEY idx_robot (robot_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

_UPSERT = """
INSERT INTO `{db}`.`{table}`
  (process_no, flow_id, flow_name, bot_name, trigger_name, start_way,
   status, start_ms, start_dt, end_ms, exec_start_ms, source, updated_at, updated_ms)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
ON DUPLICATE KEY UPDATE
  updated_ms=IF(status<=>VALUES(status) AND end_ms<=>VALUES(end_ms)
                AND exec_start_ms<=>VALUES(exec_start_ms)
                AND bot_name<=>VALUES(bot_name) AND source<=>VALUES(source),
                updated_ms, VALUES(updated_ms)),
  updated_at=IF(status<=>VALUES(status) AND end_ms<=>VALUES(end_ms)
                AND exec_start_ms<=>VALUES(exec_start_ms)
                AND bot_name<=>VALUES(bot_name) AND source<=>VALUES(source),
                updated_at, VALUES(updated_at)),
  status=VALUES(status), end_ms=VALUES(end_ms), exec_start_ms=VALUES(exec_start_ms),
  bot_name=VALUES(bot_name), source=VALUES(source)
"""

_UPSERT_TRIGGER = """
INSERT INTO `{db}`.`{ttable}`
  (trigger_id, flow_id, trigger_name, robot_name, app_name, trigger_type,
   cron, enabled, calendar, update_time, updated_ms)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
ON DUPLICATE KEY UPDATE
  updated_ms=IF(flow_id<=>VALUES(flow_id) AND trigger_name<=>VALUES(trigger_name)
                AND robot_name<=>VALUES(robot_name) AND app_name<=>VALUES(app_name)
                AND trigger_type<=>VALUES(trigger_type) AND cron<=>VALUES(cron)
                AND enabled<=>VALUES(enabled) AND calendar<=>VALUES(calendar),
                updated_ms, VALUES(updated_ms)),
  flow_id=VALUES(flow_id), trigger_name=VALUES(trigger_name),
  robot_name=VALUES(robot_name), app_name=VALUES(app_name),
  trigger_type=VALUES(trigger_type), cron=VALUES(cron),
  enabled=VALUES(enabled), calendar=VALUES(calendar),
  update_time=VALUES(update_time)
"""


def _migrate(conn, cfg):
    """已有库的结构补齐（幂等）：老库缺 updated_ms 列时加上并回填。

    CREATE TABLE IF NOT EXISTS 不会给已存在的表加列，所以升级路径必须显式 ALTER。
    回填值取 updated_at 的毫秒时间戳——老数据本来没有这个字段，用写库时刻代替，
    语义正确（那就是它们最后一次被改动的时刻）。
    """
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM information_schema.columns "
                "WHERE table_schema=%s AND table_name=%s AND column_name='updated_ms'",
                (cfg["database"], TABLE))
            if cur.fetchone()[0]:
                return
            cur.execute("ALTER TABLE `%s`.`%s` ADD COLUMN updated_ms BIGINT NOT NULL DEFAULT 0"
                        % (cfg["database"], TABLE))
            cur.execute("ALTER TABLE `%s`.`%s` ADD KEY idx_updated_ms (updated_ms)"
                        % (cfg["database"], TABLE))
            cur.execute("UPDATE `%s`.`%s` SET updated_ms=UNIX_TIMESTAMP(updated_at)*1000 "
                        "WHERE updated_ms=0" % (cfg["database"], TABLE))
            print("[mysql] 已补齐 updated_ms 列（历史行按 updated_at 回填）")
    except Exception as e:
        _err("结构补齐跳过：%s" % e)


def init_db():
    """建库建表（幂等；含老库结构补齐）。未配置/失败返回 False，不抛错。"""
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
            cur.execute(DDL_TRIGGERS.format(db=cfg["database"], ttable=TRIGGER_TABLE))
        _migrate(conn, cfg)
        conn.close()
        print("[mysql] 就绪：%s.%s + %s" % (cfg["database"], TABLE, TRIGGER_TABLE))
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
    out = []
    now = datetime.now(_BJT).strftime("%Y-%m-%d %H:%M:%S")
    now_ms = int(time.time() * 1000)   # 本轮写库时刻：增量拉取的游标基准
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
            source, now, now_ms,
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


def now_ms():
    """当前毫秒时间戳（增量游标的基准）。"""
    return int(time.time() * 1000)


def snapshot_cursor():
    """取一个「先于查询」的快照游标：比当前时刻略早，避免漏掉查询期间写入的行。

    前端下次用这个值做增量拉取（updated_ms > cursor）。快照必须在查询之前取，
    这样「取游标 -> 查询」之间新写入的行会带上更大的 updated_ms，下次必然被捞到。
    """
    return now_ms()


def fetch_records(limit=None, days=None, cursor=None):
    """查运行记录。

    days   ：按开始时间圈定最近 N 天（end 为空或 end 落在窗口内，覆盖跨界长任务）；
             启动加载 / 时间轴切到更长档位时用。
    cursor ：增量拉取——只返回 updated_ms &gt; cursor 的行（最后修改时间晚于游标）。
             被广播唤醒时用，只回真正变化的那几条。
    limit  ：只取最新 N 条（与上面两个条件可叠加）。
    默认按 start_ms 倒序（增量场景行数少，顺序不影响合并）。
    """
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
        if cursor:
            conds.append("updated_ms > %s")
            params.append(int(cursor))
        if days:
            cutoff = now_ms() - int(days) * 86400000
            conds.append("(end_ms IS NULL OR end_ms >= %s)")
            params.append(cutoff)
        if conds:
            sql += " WHERE " + " AND ".join(conds)
        if limit:
            sql += " ORDER BY start_ms DESC LIMIT %s"
            params.append(int(limit))
        else:
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


# ---- 触发器排期表 ----

def upsert_triggers(rows):
    """触发器归一化行批量 upsert（crawler.normalize_trigger 的输出）。

    返回实际变更的 trigger_id 列表；空 = 排期无变化（12h 轮询据此决定要不要广播）。
    """
    cfg = _cfg()
    if not cfg or not rows:
        return []
    now_ms_v = now_ms()
    out = []
    for r in rows:
        tid = str(r.get("trigger_id") or "")
        if not tid:
            continue
        en = r.get("enabled")
        en = None if en is None else (1 if en is True else 0)
        out.append((tid, r.get("flow_id") or "", r.get("trigger_name") or "",
                    r.get("robot_name") or "", r.get("app_name") or "",
                    r.get("trigger_type") or "", r.get("cron") or "", en,
                    r.get("calendar") or "", r.get("update_time") or "", now_ms_v))
    if not out:
        return []
    try:
        conn, _ = _connect(cfg)
        if conn is None:
            return []
        changed = []
        with conn.cursor() as cur:
            for row in out:
                cur.execute(_UPSERT_TRIGGER.format(db=cfg["database"], ttable=TRIGGER_TABLE), row)
                if cur.rowcount and cur.rowcount > 0:
                    changed.append(row[0])
        conn.close()
        return changed
    except ImportError:
        _err("未安装 pymysql，排期入库跳过")
        return []
    except Exception as e:
        _err("排期写入失败：%s" % e)
        return []


def fetch_triggers():
    """读全部触发器（排期页 / 合规页 / Excel 导出共用），按机器人+应用名排序。

    返回 crawler.normalize_trigger 同构的 dict 列表（enabled 还原成 bool），
    这样 dashboard.build_schedule_payload 等聚合函数可以原样复用。
    """
    cfg = _cfg()
    if not cfg:
        return []
    cols = ("trigger_id, flow_id, trigger_name, robot_name, app_name, "
            "trigger_type, cron, enabled, calendar, update_time")
    try:
        conn, _ = _connect(cfg)
        if conn is None:
            return []
        with conn.cursor(pymysql_ss()) as cur:
            cur.execute("SELECT %s FROM `%s`.`%s` ORDER BY robot_name, app_name"
                        % (cols, cfg["database"], TRIGGER_TABLE))
            names = [c[0] for c in cur.description]
            rows = [dict(zip(names, r)) for r in cur.fetchall()]
        conn.close()
        for r in rows:
            if r.get("enabled") is not None:
                r["enabled"] = bool(r["enabled"])
        return rows
    except Exception as e:
        _err("排期查询失败：%s" % e)
        return []


def count_triggers():
    """排期表行数（启动横幅/状态展示用）。"""
    cfg = _cfg()
    if not cfg:
        return 0
    try:
        conn, _ = _connect(cfg)
        if conn is None:
            return 0
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM `%s`.`%s`" % (cfg["database"], TRIGGER_TABLE))
            n = cur.fetchone()[0]
        conn.close()
        return int(n)
    except Exception:
        return 0


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
