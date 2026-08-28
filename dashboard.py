# -*- coding: utf-8 -*-
"""
生成 RPA 触发器日程 / 运行记录时间轴 / 运行分析（ECharts HTML）
==========================================================
读取 crawler 产出的 triggers_normalized.csv / runs_normalized.csv，生成三张页面：
  - output/schedule.html：触发器日程（周/月循环任务时刻表）
  - output/timeline.html：运行记录（时间轴，数据源优先 runs_normalized.csv 真实运行记录）
  - output/analysis.html：运行分析（成功率/状态/星期×小时热力图/各机器人排队与负载）

日程仪表盘特性：
  - 单张日程时间轴，通过「每周/每月」下拉切换视图：
      * 每周视图：横轴=周一~周日，展示「每天/每周」循环的启用任务
      * 每月视图：横轴=当月有任务的日期，展示「每月」循环的启用任务
  - 同一时刻同一应用合并为横向长条（横跨多天）；同一时刻不同应用上下错开、等高贴紧
  - 按应用配色，格内显示应用短名（下划线后去日期），悬停显示明细
  - 机器人筛选：全部 / 所有硕晞 / 所有宝实 / 单台
  - 红色十字线：横线=当前时刻、竖线=今天，10 秒刷新
  - 响应式：宽屏铺满全屏，窄屏纵向滚动

用法：
    python dashboard.py --input output/triggers_normalized.csv --out output
    python dashboard.py --input output/triggers_normalized.csv --out output --only-gantt   # 仅重新生成时间轴与分析页
"""
import argparse
import calendar
import csv
import hashlib
import json
import os
import re
import sys
from collections import OrderedDict
from datetime import date, datetime, timezone, timedelta

# 强制 stdout/stderr 使用 UTF-8，避免中文 Windows 下（GBK）打印 ✓ 等符号时
# 抛出 UnicodeEncodeError，进而导致「更新成功却报刷新失败」的假错误。
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        try:
            _s.reconfigure(encoding="utf-8")
        except Exception:
            pass

# 北京时间时区（触发器 update_time 为 UTC，展示统一转北京时间）
BJT = timezone(timedelta(hours=8))

# 访问密码：留空 = 本地使用不设密码门；部署公网前填入密码（服务端无法鉴权时至少挡一般访问者）
ACCESS_PASSWORD = ""
PWD_HASH = hashlib.sha256(ACCESS_PASSWORD.encode()).hexdigest() if ACCESS_PASSWORD else ""

# 深色背景下的 12 色配色（同应用同色，按出现顺序分配）——半透明底色（alpha 0.6），柔和不刺眼
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
    """运行记录唯一 id（用于文件命名与跳转）。"""
    return "%s_%s" % ((fid or ""), (pno or ""))


def file_safe_id(fid, pno):
    """run_id 的文件名安全版本（仅保留字母数字、. _ -，保证 id 与文件名一致）。"""
    return _SAFE_ID_RE.sub("_", run_id(fid, pno))


def read_log_text(path, cap_chars=800000):
    """读取日志文本：自动探测编码（utf-8/utf-8-sig/gbk/latin-1），截断到 cap_chars 字符，返回 (text, truncated)。"""
    text = ""
    for enc in ("utf-8", "utf-8-sig", "gbk", "latin-1"):
        try:
            with open(path, "r", encoding=enc, errors="strict") as f:
                text = f.read()
            break
        except (UnicodeDecodeError, UnicodeError):
            continue
    truncated = False
    if len(text) > cap_chars:
        text = text[:cap_chars]
        truncated = True
    return text, truncated


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
        # 八爪鱼 dayOfWeeks：0=周日…6=周六（C# DayOfWeek 约定）；周视图横轴 WEEK_LABELS
        # 为周一起点（0=周一…6=周日），故统一偏移映射到横轴索引，否则数据整体晚一天
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


def finalize_html(html, out_path):
    """统一收尾：密码门（空密码时移除整段）、ECharts 内联、写出文件。"""
    if PWD_HASH:
        html = html.replace("__PWD_HASH__", PWD_HASH)
    else:
        html = re.sub(r"<!-- __LOCK_START__ -->.*?<!-- __LOCK_END__ -->", "", html, flags=re.S)

    # 内联 ECharts（存在本地 assets/echarts.min.js 时），部署后不依赖国外 CDN，国内访问更快
    CDN_TAG = '<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>'
    asset = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "echarts.min.js")
    if os.path.exists(asset) and CDN_TAG in html:
        with open(asset, "r", encoding="utf-8") as f:
            echarts_js = f.read()
        # 转义内部 "</script>"，避免提前闭合 script 标签（JS 中 \/ 等价 /）
        echarts_js = echarts_js.replace("</script>", "<\\/script>")
        html = html.replace(CDN_TAG, "<script>\n" + echarts_js + "\n</script>")
        print("[*] ECharts 已内联（自包含，不依赖外部 CDN）")
    elif CDN_TAG in html:
        print("[*] 未找到 assets/echarts.min.js，使用 CDN 引用")

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    return html


# ==================== 运行记录时间轴页面 ====================
# 页面特性：
#   - 竖轴=机器人（同一机器人时间重叠的记录自动分多行泳道堆叠），横轴=时间（右缘=当前时刻，内容随时间缓慢左移）
#   - 时间窗口下拉切换 30 分钟 ~ 7 天（锚定当前时刻）
#   - 鼠标滚轮左右平移时间窗口（向下=向未来，最多到"现在"；向上=向过去）
#   - 触发方式下拉筛选：全部 / 手动 / 定时触发器 / Webhook
#   - 自动更新勾选后每 60 秒向 /api/refresh 请求最新数据（服务器 60 秒内去重）
#   - 双击图表恢复实时跟随
#   - 种子数据优先 runs_normalized.csv（爬虫抓取的真实运行记录，手动/定时/Webhook 全部触发方式）；
#     无该文件时回退 triggers_normalized.csv 中 trigger_type=Webhook 的触发器配置
#     （回退模式：start=update_time，默认持续 30 分钟；停用触发器显示为灰色）
GANTT_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Cache-Control" content="no-store">
<meta http-equiv="Pragma" content="no-cache">
<title>运行记录</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
<style>
  html, body { height: 100%; }
  body { margin: 0; padding: 10px 14px; box-sizing: border-box;
         font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
         background: #0f1115; color: #e6e6e6;
         display: flex; flex-direction: column; overflow: hidden; }
  h1 { font-size: 18px; font-weight: 500; margin: 0; }
  .head { display: flex; align-items: center; justify-content: space-between;
          gap: 12px; margin-bottom: 10px; flex-wrap: wrap; flex: none; }
  .titlebar { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
  .datatime { font-size: 11px; color: #6f7480; margin-left: 8px; }
  #navSel { width: auto; background: transparent; color: #e6e6e6; border: 1px solid transparent;
            border-radius: 6px; padding: 2px 8px; font-size: 22px; font-weight: 600;
            cursor: pointer; font-family: inherit; }
  #navSel:hover { border-color: #333a45; background: #22262e; }
  #navSel:focus { outline: none; border-color: #333a45; }
  .metrics { display: flex; gap: 10px; flex-wrap: wrap; }
  .metric { flex: 1 1 0; min-width: 84px; background: #181b21; border: 1px solid #262a33;
            border-radius: 8px; padding: 6px 14px; text-align: center; }
  .metric .k { font-size: 11px; color: #8b8f98; }
  .metric .v { font-size: 18px; font-weight: 500; line-height: 1.25; }
  .chart-head { display: flex; align-items: center; gap: 10px; flex: none;
                background: #181b21; border: 1px solid #262a33; border-radius: 10px 10px 0 0;
                padding: 8px 14px; }
  .filter-label { font-size: 13px; color: #8b8f98; margin-right: 4px; }
  .chart-head select { background: #22262e; color: #e6e6e6; border: 1px solid #333a45;
                       border-radius: 6px; padding: 3px 8px; font-size: 12px; cursor: pointer; }
  .auto-update-label { margin-left: 18px; }
  .way-label { margin-left: 18px; }
  #chkAuto { width: 14px; height: 14px; accent-color: #378ADD; cursor: pointer;
             margin: 0; vertical-align: -2px; }
  .chart { flex: 1; min-height: 0; width: 100%; background: #181b21;
           border: 1px solid #262a33; border-top: none; border-radius: 0 0 10px 10px; }
  .hint { color: #6f7480; font-size: 11px; margin-top: 6px; flex: none; }
  .hint .legend { display: inline-block; margin-left: 12px; }
  .hint .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
  @media (max-width: 1100px) { body { overflow: auto; } .chart { min-height: 520px; flex: none; } }
</style>
</head>
<body>
<!-- __LOCK_START__ -->
<div id="lock" style="position:fixed;inset:0;background:#0f1115;z-index:9999;display:flex;align-items:center;justify-content:center;">
  <div style="text-align:center;width:300px;">
    <div style="font-size:20px;font-weight:500;margin-bottom:4px;color:#e6e6e6;">运行记录</div>
    <div style="color:#8b8f98;font-size:12px;margin-bottom:18px;">请输入访问密码</div>
    <input id="pwd" type="password" placeholder="访问密码" autocomplete="off"
      style="width:100%;box-sizing:border-box;padding:9px 12px;font-size:14px;border-radius:6px;border:1px solid #333a45;background:#22262e;color:#e6e6e6;">
    <button id="unlock" style="width:100%;margin-top:12px;padding:9px 0;background:#378ADD;border:none;border-radius:6px;color:#fff;font-size:14px;cursor:pointer;">进入</button>
    <div id="err" style="color:#E24B4A;font-size:12px;margin-top:10px;display:none;">密码错误，请重试</div>
  </div>
</div>
<!-- __LOCK_END__ -->
<div class="head">
  <div class="titlebar">
    <select id="navSel">
      <option value="schedule.html">触发器日程</option>
      <option value="timeline.html" selected>运行记录</option>
      <option value="analysis.html">运行分析</option>
    </select>
    <div class="datatime" id="dataTime">数据获取：__GEN__</div>
    <div class="datatime warn" id="refreshWarn" style="display:none;">刷新失败，登录态可能已过期，请检查 output/update_log.txt</div>
  </div>
  <div class="metrics">
    <div class="metric"><div class="k">Webhook 记录</div><div class="v" id="mTotal" style="color:#D85A30">0</div></div>
    <div class="metric"><div class="k">机器人</div><div class="v" id="mRobots" style="color:#378ADD">0</div></div>
  </div>
</div>
<div class="chart-head">
  <span class="filter-label">时间窗口：</span>
  <select id="selSpan">
    <option value="1800000">30 分钟</option>
    <option value="3600000">1 小时</option>
    <option value="7200000" selected>2 小时</option>
    <option value="21600000">6 小时</option>
    <option value="43200000">12 小时</option>
    <option value="86400000">1 天</option>
    <option value="259200000">3 天</option>
    <option value="604800000">7 天</option>
  </select>
  <span class="filter-label way-label">触发方式：</span>
  <select id="selWay">
    <option value="__ALL__" selected>全部</option>
    <option value="Manual">手动</option>
    <option value="TimingTrigger">定时触发器</option>
    <option value="Webhook">Webhook</option>
  </select>
  <span class="filter-label auto-update-label">自动更新：</span>
  <input type="checkbox" id="chkAuto">
</div>
<div id="chart" class="chart"></div>
<div class="hint">竖轴=机器人（手动/定时/Webhook 运行记录），横轴=时间（随时间缓慢左移）；「时间窗口」可切换 30 分钟~7 天范围，「触发方式」可筛选手动/定时/Webhook；滚动鼠标滚轮左右移动数据，双击图表恢复实时；点击记录查看明细。
  <span class="legend"><i style="background:rgba(29,158,117,0.6)"></i>已完成</span>
  <span class="legend"><i style="background:rgba(239,159,39,0.6)"></i>运行中</span>
  <span class="legend"><i style="background:rgba(55,138,221,0.6)"></i>排队中</span>
  <span class="legend"><i style="background:rgba(226,75,74,0.6)"></i>失败</span>
  <span class="legend"><i style="background:rgba(95,94,90,0.6)"></i>已停止</span>
</div>
<script>
var DEF_SPAN = 2 * 3600 * 1000;         // 默认时间窗口：2 小时
var STATUS_CN = { Waiting: "排队中", Executing: "运行中", Finished: "已完成",
                  Failed: "失败", Stopped: "已停止" };
var WAY_CN = { Manual: "手动", TimingTrigger: "定时触发器", Webhook: "Webhook" };
function wayOf(r){ return WAY_CN[r.way] || r.way || "-"; }

var SEED = __SEED__;                    // 八爪鱼后台爬取的真实运行记录（手动/定时/Webhook 全部触发方式，按 include/exclude_robots 过滤）
var records = SEED.slice();
var robots = [];
var state = { span: DEF_SPAN, end: Date.now(), offset: 0 };
// 数据时间范围（限制滚轮平移边界，避免滚出数据区看不到内容）
// 注意：DATA_MAX 用「记录中最大的已结束时间」，运行中记录（end=null）不算进去，
// 否则页面开久了 DATA_MAX 仍是某次陈旧快照、或被无限延伸到很远的未来，导致
// 往回滚动时 offMax 卡在负值回不到「现在」。
var DATA_MIN = Infinity, DATA_MAX = -Infinity;
function recomputeBounds(){
  DATA_MIN = Infinity; DATA_MAX = -Infinity;
  var nowT = Date.now();
  records.forEach(function(r){
    if (r.start < DATA_MIN) DATA_MIN = r.start;
    var e = r.end == null ? nowT : r.end;   // 运行中/排队中记录延伸到现在，但不固定死
    if (e > DATA_MAX) DATA_MAX = e;
  });
}
recomputeBounds();

function robotList(segs){
  var arr = [];
  segs.forEach(function(s){
    var rb = s.r.robot;
    if (rb && rb !== "(未指定机器人)" && arr.indexOf(rb) < 0) arr.push(rb);
  });
  return arr.sort();
}
// 把运行记录拆成段：start（排队开始）→ execStart（开始运行）为排队段（蓝）；
// execStart → end 为运行段（按状态着色）。execStart 缺失或无排队时间则整条为运行段。
function buildSegs(){
  var segs = [];
  records.forEach(function(r){
    var st = r.start;
    var exec = (r.execStart && r.execStart > st) ? r.execStart : null;
    // 排队时间 < 1 分钟不显示排队段（蓝条）：过短的排队只是窄缝、且悬停信息冗余
    if (exec && exec - st >= 60*1000) segs.push({ r: r, start: st, end: exec, kind: 'wait' });
    segs.push({ r: r, start: exec || st, end: r.end, kind: 'run' });
  });
  return segs;
}
function segColor(s){
  if (s.kind === 'wait') return 'rgba(55,138,221,0.6)';   // 排队段统一半透明蓝
  return statusColor(s.r);
}
function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function pad(n){ return String(n).padStart(2, "0"); }
function fmtTime(ms){
  var d = new Date(ms);
  return (d.getMonth()+1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}
function fmtSpan(ms){
  if (ms < 60*1000) return Math.round(ms/1000) + " 秒";
  if (ms < 3600*1000) return Math.round(ms/60000) + " 分钟";
  if (ms < 24*3600*1000) return Math.round(ms/3600000) + " 小时";
  return Math.round(ms/(24*3600*1000)) + " 天";
}
function fmtDur(ms){
  var m = Math.round(ms/60000);
  if (m < 60) return m + " 分钟";
  return Math.floor(m/60) + " 小时" + (m%60 ? " " + (m%60) + " 分" : "");
}
// 状态着色（半透明底色）：已完成绿 / 运行中橙 / 排队蓝 / 失败红 / 停止灰，统一透明度 0.6
function statusColor(r){
  if (r.status === "Failed") return "rgba(226,75,74,0.6)";
  if (r.status === "Executing") return "rgba(239,159,39,0.6)";
  if (r.status === "Waiting") return "rgba(55,138,221,0.6)";
  if (r.status === "Stopped") return "rgba(95,94,90,0.6)";
  return "rgba(29,158,117,0.6)";  // 已完成（含默认）统一绿色
}
// 数据块文字：用离屏 canvas 的 measureText 实测真实字宽（避免按字号估算的偏差，
// 尤其半角字符（数字/下划线/字母）实际约 8~11px，被估成 11px 会导致第一行提前换行），
// 宽度不够自动换行，最多两行；两行仍放不下则隐藏文字。
// 测量字体与 ECharts 渲染字体共用 FONT_STACK，保证「测量宽度=渲染宽度」。
var FONT_STACK = (function(){
  try { return getComputedStyle(document.body).fontFamily || 'sans-serif'; }
  catch(e){ return 'sans-serif'; }
})();
var _mc = (function(){
  try {
    var c = document.createElement('canvas').getContext('2d');
    c.font = '500 20px ' + FONT_STACK;
    return c;
  } catch(e){ return null; }
})();
function measureW(s){
  if (!_mc) return s.length * 10;   // 退化估算（极少数环境无 canvas）
  return _mc.measureText(s).width;
}
function wrapLabel(name, maxW){
  if (!name) return '';
  if (maxW < 8) return '';          // 条太窄，放不下一个字符 → 不显示
  var full = measureW(name);
  if (full <= maxW) return name;    // 整串放得下 → 单行不换行
  var lines = [], cur = '', curW = 0;
  for (var i = 0; i < name.length; i++){
    var ch = name[i];
    var cw = measureW(ch);
    if (curW + cw > maxW){
      if (lines.length >= 1) return '';   // 第二行也放不下 → 隐藏文字
      lines.push(cur);
      cur = ch; curW = cw;
    } else { cur += ch; curW += cw; }
  }
  if (cur) lines.push(cur);
  return lines.join('\\n');
}
// 运行中/排队中记录（end 为空）动态延伸到当前时刻
function effEnd(s){ return s.end == null ? state.end : s.end; }
// 布局：同一机器人按记录（排队段+运行段合并区间）拆分为泳道，同一记录的所有段强制同泳道，
// 排队段与运行段紧挨着不分开；所有泳道行全局编号，图表高度动态平均分配
function layout(segs){
  // 按记录分组为单元：合并区间 [start, end]，记录内所有段共用一个泳道
  var recs = [];
  var recOfSeg = {};
  var byRobot = {};
  segs.forEach(function(s, i){
    var rid = String(s.r.id);
    if (!(rid in recOfSeg)) {
      recOfSeg[rid] = recs.length;
      var u = { rid: rid, robot: s.r.robot, start: s.start, end: effEnd(s), segIdxs: [] };
      recs.push(u);
      (byRobot[s.r.robot] = byRobot[s.r.robot] || []).push(recs.length - 1);
    }
    var u = recs[recOfSeg[rid]];
    u.segIdxs.push(i);
    if (s.start < u.start) u.start = s.start;
    var en = effEnd(s);
    if (en > u.end) u.end = en;
  });
  var info = {};
  var yLabels = [];
  var groupLastRows = [];
  var rowCursor = 0;
  robots.forEach(function(rb){
    var idxs = (byRobot[rb] || []).slice().sort(function(a,b){ return recs[a].start - recs[b].start; });
    var lanes = [];
    var laneOfRec = {};
    idxs.forEach(function(ri){
      var u = recs[ri], st = u.start, en = u.end, lane = -1;
      for (var l = 0; l < lanes.length; l++){
        if (st >= lanes[l].end || en <= lanes[l].start){ lane = l; break; }
      }
      if (lane < 0){ lane = lanes.length; lanes.push({start: st, end: en}); }
      else { if (st < lanes[lane].start) lanes[lane].start = st;
             if (en > lanes[lane].end) lanes[lane].end = en; }
      laneOfRec[ri] = lane;
    });
    // 该机器人在当前窗口无可见记录：强制保留 1 条空泳道，避免机器人从纵轴消失
    if (lanes.length === 0) lanes.push({ start: state.end, end: state.end });
    var base = rowCursor;
    rowCursor += lanes.length;
    idxs.forEach(function(ri){
      var u = recs[ri];
      u.segIdxs.forEach(function(si){ info[si] = { row: base + laneOfRec[ri] }; });
    });
    // 每个机器人占 lanes.length 行：第一行（下方）显示机器人名，其余空
    for (var r = base; r < rowCursor; r++) yLabels.push(r === base ? rb : '');
    // 组最后一行（上方边界）= 组的分隔线位置（y 轴索引 0 在底部）
    groupLastRows.push(base + lanes.length - 1);
  });
  layout.totalRows = rowCursor;
  layout.yLabels = yLabels;
  layout.groupLastRows = groupLastRows;
  return info;
}

var chartEl = document.getElementById('chart');
var chart = echarts.init(chartEl);

function render(){
  // 窗口右缘最多到当前时刻（左移到"现在"时间轴即停，看不到未来）
  var nowW = Math.min(state.end + state.offset, state.end);
  var winStart = nowW - state.span;
  // 拆段：每条记录 → 排队段（蓝）+ 运行段（状态色），实时布局只取窗口内可见段
  var segs = buildSegs();
  // 触发方式筛选
  var waySel = document.getElementById('selWay').value;
  if (waySel !== '__ALL__') segs = segs.filter(function(s){ return s.r.way === waySel; });
  // 机器人列表基于「筛选后全部记录」而非「当前时间窗口可见记录」，
  // 保证每个机器人至少保留 1 条泳道，滚动时间窗口时不会因某机器人无可见记录而消失
  robots = robotList(segs);
  var visible = segs.filter(function(s){ return effEnd(s) >= winStart && s.start <= nowW; });
  var info = layout(visible);
  var yLabels = layout.yLabels;
  var lastRows = layout.groupLastRows || [];
  // 分隔线画在每个组的上方边界（组间分界）；最顶部组上方（图表顶部）不画
  var topGroupRow = lastRows.length ? Math.max.apply(null, lastRows) : -1;
  // 组间分隔线改为独立 series 绘制（见 sepData），不再依赖每行段计数
  // 每条记录的合并区间（排队段+运行段整体），用于文字跨两块整体居中
  var recMerge = {};
  visible.forEach(function(s){
    var rid = String(s.r.id);
    var m = recMerge[rid] || (recMerge[rid] = { min: Infinity, max: -Infinity });
    if (s.start < m.min) m.min = s.start;
    var en = effEnd(s);
    if (en > m.max) m.max = en;
  });
  var data = [];
  var textData = [];   // 顶层文字层（zlevel 2）：跨「排队+运行」整条居中，任何块悬停高亮都不会盖住文字
  visible.forEach(function(s, i){
    var li = info[i];
    var rid = String(s.r.id);
    var merge = recMerge[rid];
    // 排队段与运行段合并为同一块：只推 run 段一条数据（区间=记录完整合并区间），
    // 排队部分的蓝色在 renderItem 里用子矩形绘制；wait 段仅参与泳道布局，不再单独成块
    if (s.kind === 'run') {
      data.push({
        // value[6]=execStart, value[7]=endRaw（renderItem 没有 params.data，必须放进 value 数组）
        value: [merge.min, merge.max, li.row, 0, 1, segColor(s), s.r.execStart || 0, s.end == null ? 0 : s.end],
        rid: rid, name: s.r.name, app: s.r.app, robot: s.r.robot,
        status: s.r.status, kind: 'run', way: s.r.way,
        start: merge.min, end: merge.max,
        endRaw: s.end, execStart: s.r.execStart
      });
    }
    // 文字只画一次：运行段承载，位置=记录合并区间中心
    if (s.kind === 'run' && s.r.name) {
      textData.push({
        value: [(merge.min + merge.max) / 2, li.row, s.r.name, merge.min, merge.max]
      });
    }
  });
  // 组间分隔线独立数据：每个机器人组的上方边界行（顶组除外），
  // 与可见数据解耦，即使该组在窗口内无记录也会绘制，避免空泳道丢失分割线
  var sepData = [];
  lastRows.forEach(function(r){ if (r !== topGroupRow) sepData.push({ value: [r] }); });
  // 窗口内可见的原始记录数（同一记录排队+运行两段计 1）
  var recIds = {};
  visible.forEach(function(s){ recIds[s.r.id] = 1; });
  var recCount = Object.keys(recIds).length;
  chart.setOption({
    backgroundColor: 'transparent',
    animation: false,  // 关闭过渡动画：滚轮平移/窗口推进即时响应，避免动画跟不上
    tooltip: { trigger: 'item', confine: true, backgroundColor: '#1c2027', borderColor: '#333a45',
               textStyle: { color: '#e6e6e6', fontSize: 12 },
               formatter: function(p){
                 var d = p.data;
                 var stName = STATUS_CN[d.status] || d.status || '已完成';
                 var stColor = statusColor({status: d.status, app: d.app});
                 var s = '<b>' + esc(d.name) + '</b>'
                   + '<br/>机器人：' + esc(d.robot)
                   + (d.way && d.way !== "Manual" && d.trigger ? '<br/>触发器：' + esc(d.trigger) : '')
                   + '<br/>触发方式：' + esc(wayOf({way: d.way}))
                   + '<br/>状态：<span style="color:' + stColor + '">' + esc(stName) + '</span>';
                 var runFrom = (d.execStart && d.execStart > d.start) ? d.execStart : d.start;
                 if (d.execStart && d.execStart > d.start) {
                   s += '<br/>排队：' + fmtTime(d.start) + ' ~ ' + fmtTime(d.execStart)
                      + '（' + fmtDur(d.execStart - d.start) + '）';
                 }
                 s += '<br/>' + fmtTime(d.start) + ' ~ ' + (d.endRaw == null ? '（进行中）' : fmtTime(d.end));
                 if (d.endRaw != null) s += '（运行 ' + fmtDur(d.end - runFrom) + '）';
                 if (d.execStart && d.execStart > d.start) s += '<br/>开始运行：' + fmtTime(d.execStart);
                 return s;
               } },
    grid: { left: 100, right: 20, top: 20, bottom: 44 },
    xAxis: { type: 'time', min: nowW - state.span, max: nowW,
             axisLabel: { color: '#8b8f98', fontSize: 11, hideOverlap: true,
                          formatter: function(v){ return fmtTime(v); } },
             axisLine: { lineStyle: { color: '#333' } },
             splitLine: { show: true, lineStyle: { color: '#20242c' } } },
    yAxis: { type: 'category', data: yLabels,
             axisLabel: { color: '#c9cdd4', fontSize: 12, width: 95, overflow: 'truncate' },
             axisLine: { lineStyle: { color: '#333' } },
             splitLine: { show: true, lineStyle: { color: '#20242c' } } },
    series: [{
      type: 'custom', data: data, zlevel: 1,
      renderItem: function(params, api){
        var row = api.value(2);
        var p0 = api.coord([api.value(0), row]);
        var p1 = api.coord([api.value(1), row]);
        var y = p0[1];
        var x0 = Math.min(p0[0], p1[0]);
        var x1 = Math.max(p0[0], p1[0]);
        // 裁剪到绘图区左右边界，避免条溢出盖住竖轴标签/右边距
        var gLeft = api.coord([nowW - state.span, row])[0];
        var gRight = api.coord([nowW, row])[0];
        var x = Math.max(x0, gLeft);
        var xEnd = Math.min(x1, gRight);
        var w = xEnd - x;
        var band = api.size([0, 1])[1];   // 行高：总高度动态平均分配给所有数据格
        var children = [];
        // 组间分隔线改由独立 sepSeries 绘制（含空泳道），此处不再绘制
        if (w >= 2) {
          // 条高 = 行高 - 间距（动态平均，数据格少则格大、多则格小）
          var bh = Math.max(10, band - 4);
          // ECharts 自定义 series 的 renderItem 没有 params.data/value，
          // 自定义属性必须放进 value 数组：value[6]=execStart, value[7]=endRaw
          var exec = api.value(6);
          var hasWait = exec && exec > api.value(0);
          // 排队子段 [记录起点, execStart]：统一半透明蓝，不描边
          if (hasWait) {
            var wxs = Math.max(api.coord([api.value(0), row])[0], gLeft);
            var wxe = Math.min(api.coord([exec, row])[0], gRight);
            var qw = wxe - wxs;
            if (qw >= 2) {
              children.push({ type: 'rect', shape: { x: wxs, y: y - bh / 2, width: qw, height: bh },
                              style: { fill: 'rgba(55,138,221,0.6)' } });
            }
          }
          // 运行子段 [max(execStart,记录起点), 记录终点]：按状态着色，不描边
          var rs = hasWait ? exec : api.value(0);
          var rxs = Math.max(api.coord([rs, row])[0], gLeft);
          var rxe = Math.min(api.coord([api.value(1), row])[0], gRight);
          var rw = rxe - rxs;
          if (rw >= 2) {
            children.push({ type: 'rect', shape: { x: rxs, y: y - bh / 2, width: rw, height: bh },
                            style: { fill: api.value(5) } });
          }
          // 整条外框：透明填充 + 白描边，把排队+运行框成同一个块；pointer 提示可点击
          children.push({ type: 'rect', shape: { x: x, y: y - bh / 2, width: w, height: bh },
                          style: { fill: 'rgba(0,0,0,0)', stroke: 'rgba(255,255,255,.35)', lineWidth: 1, cursor: 'pointer' } });
        }
        if (!children.length) return null;
        return children.length === 1 ? children[0] : { type: 'group', children: children };
      },
      markLine: { silent: true, symbol: 'none', lineStyle: { color: '#E24B4A', width: 2 },
        label: { show: true, formatter: '现在', color: '#E24B4A', fontSize: 10, position: 'insideEndTop' },
        data: [{ xAxis: state.end }] }
    }, {
      // 顶层文字层：跨「排队段+运行段」整体水平居中，位于所有块之上（zlevel 2），
      // 悬停高亮任何块都不会盖住文字
      type: 'custom', data: textData, zlevel: 2, silent: true,
      renderItem: function(params, api){
        var row = api.value(1);
        var mStart = api.value(3);
        var mEnd = api.value(4) == null ? nowW : api.value(4);
        // 裁剪到可见时间窗口：文字按「可见条」居中与算宽，记录部分在窗口外时不会错位留空
        var vStart = Math.max(mStart, nowW - state.span);
        var vEnd = Math.min(mEnd, nowW);
        if (vEnd <= vStart) return null;
        var vc = (vStart + vEnd) / 2;
        var cx = api.coord([vc, row])[0];
        var y = api.coord([vc, row])[1];
        var wTotal = Math.abs(api.coord([vEnd, row])[0] - api.coord([vStart, row])[0]);
        var label = wrapLabel(api.value(2), Math.max(2, wTotal - 4));
        if (!label) return null;
        return { type: 'text', style: { text: label, x: cx, y: y, textAlign: 'center',
                 textVerticalAlign: 'middle', fill: '#10141a', fontSize: 20,
                 fontWeight: 500, fontFamily: FONT_STACK } };
      }
    }, {
      // 组间分隔线系列：独立于可见数据，横跨绘图区，空泳道也会绘制
      type: 'custom', data: sepData, zlevel: 1, silent: true,
      renderItem: function(params, api){
        var row = api.value(0);
        var c0 = api.coord([nowW - state.span, row]);
        var yc = c0[1];
        var band = api.size([0, 1])[1];          // 行高：与数据系列一致
        var gLeft = api.coord([nowW - state.span, row])[0];
        var gRight = api.coord([nowW, row])[0];
        var ly = yc - band / 2;                  // 行顶边（y 轴索引 0 在底部）
        return { type: 'line', shape: { x1: gLeft, y1: ly, x2: gRight, y2: ly },
                 style: { stroke: 'rgba(255,255,255,0.65)', lineWidth: 1.5, lineDash: [6, 4] } };
      }
    }]
  }, { lazyUpdate: true });
  document.getElementById('mTotal').textContent = recCount;
  document.getElementById('mRobots').textContent = robots.length;
}
// 时间窗口推进/变化：全量重绘（实时重算窗口内可见记录与泳道布局）
function updateWindow(){ render(); }
// 鼠标滚轮：左右平移时间窗口（移动数据）。向下滚=向未来，向上滚=向过去
// 直接用 DOM 原生 wheel 事件（zrender 内部监听旧式 mousewheel，现代浏览器不派发）
chartEl.addEventListener('wheel', function(e){
  e.preventDefault();
  state.offset += e.deltaY * (state.span / 600);
  // 限制平移边界：过去方向窗口始终与数据范围有交集；未来方向右缘最多到当前时刻（看不到未来）
  var nowT = Date.now();
  var offMin = DATA_MIN - nowT;               // 窗口右缘不早于最早记录开始
  var offMax = 0;                            // 窗口右缘不晚于当前时刻（DATA_MAX 会随运行中记录延伸，不可作上界）
  state.offset = Math.min(offMax, Math.max(offMin, state.offset));
  updateWindow();
}, { passive: false });
// 时间窗口下拉：切换窗口跨度并回到实时
document.getElementById('selSpan').onchange = function(){
  state.span = parseInt(this.value, 10);
  state.offset = 0;
  updateWindow();
};
// 触发方式下拉：筛选手动/定时/Webhook
document.getElementById('selWay').onchange = function(){
  state.offset = 0;
  updateWindow();
};
// 随时间缓慢左移（1× 实时，右缘跟随当前时刻，保留手动平移偏移）
setInterval(function(){
  state.end = Date.now();
  updateWindow();
}, 200);
// 自动更新开关（默认否）：勾选后立即同步一次，之后每分钟向服务器请求一次运行记录更新；
// 服务器若 60 秒内已爬取过则跳过爬取，直接返回最新数据；前端用返回数据无刷新重绘
function refreshData(){
  fetch('/api/refresh', { method: 'POST' })
    .then(function(r){ return r.json(); })
    .then(function(d){
      var warnEl = document.getElementById('refreshWarn');
      if (d && d.ok && Array.isArray(d.records)) {
        if (warnEl) warnEl.style.display = 'none';
        records = d.records;
        recomputeBounds();   // 数据刷新后重算数据时间范围，否则滚轮边界用陈旧 DATA_MAX 会卡死
        render();
        if (d.time) document.getElementById('dataTime').textContent = '数据获取：' + d.time;
      } else if (warnEl) {
        // 刷新失败（如登录态过期且无法重新登录）：保留旧数据并提示，不再误报成功
        warnEl.style.display = 'block';
        if (d && d.time) document.getElementById('dataTime').textContent = '数据获取：' + d.time + '（刷新失败）';
      }
    })
    .catch(function(){});
}
var autoTimer = null;
document.getElementById('chkAuto').onchange = function(){
  if (this.checked) {
    refreshData();   // 勾选后立即同步一次
    if (!autoTimer) autoTimer = setInterval(refreshData, 60000);
  } else {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  }
};
// 双击图表：恢复实时跟随（保留下拉选择的时间窗口）
chartEl.addEventListener('dblclick', function(){
  state.offset = 0;
  state.span = parseInt(document.getElementById('selSpan').value, 10);
  updateWindow();
});
// 点击数据块：跳转运行记录详情页（携带记录 id）
chart.on('click', function(params){
  if (params && params.data && params.data.rid) {
    location.href = 'detail_' + encodeURIComponent(params.data.rid) + '.html';
  }
});
// 标题下拉切换页面
document.getElementById('navSel').onchange = function(){ location.href = this.value; };
window.addEventListener('resize', function(){ chart.resize(); });
if (window.ResizeObserver) new ResizeObserver(function(){ chart.resize(); }).observe(chartEl);
render();
</script>
<script>
function sha256(a){function r(n,t){return(n>>>t)|(n<<(32-t))}function ror(n,t){return(n<<t)|(n>>>(32-t))}function s2b(s){var i,b=[],c=0;for(i=0;i<s.length*8;i+=8)c=c<<8|s.charCodeAt(i/8),i%32==24&&(b.push(c),c=0);return b}function b2h(b){var h="",i;for(i=0;i<b.length;i++)h+=((b[i]>>>24)&255).toString(16).padStart(2,"0")+((b[i]>>>16)&255).toString(16).padStart(2,"0")+((b[i]>>>8)&255).toString(16).padStart(2,"0")+(b[i]&255).toString(16).padStart(2,"0");return h}var K=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1915078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];var H=[1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225],l=a.length*8,M=s2b(a),i;M[l>>5]|=128<<24-l%32;for(i=0;i<64;i++)M.push(0);M[(l+64>>9<<4)+15]=l;for(var n=0;n<M.length;n+=16){var W=[],A=H[0],B=H[1],C=H[2],D=H[3],E=H[4],F=H[5],G=H[6],J=H[7],j,t;for(i=0;i<64;i++){if(i<16)W[i]=M[n+i];else{var w1=W[i-15],w2=W[i-2];W[i]=ror(w1,7)^ror(w1,18)^(w1>>>3)^ror(w2,17)^ror(w2,19)^(w2>>>10)}var S1=ror(E,6)^ror(E,11)^ror(E,25),ch=E&F^~E&G,t1=J+S1+ch+K[i]+W[i],S0=ror(A,2)^ror(A,13)^ror(A,22),maj=A&B^A&C^B&C,t2=S0+maj;J=G;G=F;F=E;E=D+t1>>>0;D=C;C=B;B=A;A=t1+t2>>>0}H[0]=H[0]+A>>>0;H[1]=H[1]+B>>>0;H[2]=H[2]+C>>>0;H[3]=H[3]+D>>>0;H[4]=H[4]+E>>>0;H[5]=H[5]+F>>>0;H[6]=H[6]+G>>>0;H[7]=H[7]+J>>>0}return b2h(H)}
(function(){
  var HASH = '__PWD_HASH__';
  var lock = document.getElementById('lock');
  if (!lock) return;  // 未启用密码门（本地使用）
  function tryUnlock(){
    var v = document.getElementById('pwd').value;
    if (sha256(v) === HASH) {
      sessionStorage.setItem('rpa_dash_ok', '1');
      lock.style.display = 'none';
    } else {
      document.getElementById('err').style.display = 'block';
    }
  }
  if (sessionStorage.getItem('rpa_dash_ok') === '1') { lock.style.display = 'none'; }
  else {
    document.getElementById('unlock').onclick = tryUnlock;
    document.getElementById('pwd').onkeydown = function(e){ if (e.key === 'Enter') tryUnlock(); };
    document.getElementById('pwd').focus();
  }
})();
</script>
</body>
</html>"""


# ==================== 运行记录详情页面 ====================
# 单条运行记录详情：点击甘特图数据块跳转 detail_<id>.html（每记录一个文件，日志内容已内嵌）
# 详情包含：基础信息 + 对应机器人日志目录（局域网共享文件夹，可点击打开）
DETAIL_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>运行记录详情</title>
<style>
  html, body { height: 100%; }
  body { margin: 0; padding: 14px 16px; box-sizing: border-box;
         font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
         background: #0f1115; color: #e6e6e6; }
  .topbar { display: flex; align-items: center; justify-content: space-between;
            gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
  .title { font-size: 20px; font-weight: 600; }
  .title small { font-size: 12px; color: #8b8f98; font-weight: 400; margin-left: 8px; }
  .back { background: #22262e; color: #e6e6e6; border: 1px solid #333a45;
          border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
  .back:hover { background: #2c313a; }
  .card { background: #181b21; border: 1px solid #262a33; border-radius: 10px;
          padding: 16px 18px; }
  .card h3 { margin: 0 0 12px; font-size: 14px; color: #c9cdd4; font-weight: 600; }
  .detail-wrap { display: flex; gap: 14px; align-items: flex-start; }
  .info-card { flex: 0 0 400px; max-width: 400px; min-width: 0; }
  .log-card { flex: 1 1 auto; min-width: 0; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .field { background: #0f1115; border: 1px solid #262a33; border-radius: 8px; padding: 10px 12px;
           min-height: 60px; display: flex; flex-direction: column; justify-content: center; }
  .field .k { font-size: 11px; color: #8b8f98; margin-bottom: 4px; }
  .field .v { font-size: 14px; font-weight: 500; word-break: break-all; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 6px; font-size: 13px; font-weight: 500; }
  .warn { color: #E24B4A; font-size: 13px; margin-top: 8px; }
  .tip { color: #8b8f98; font-size: 12px; margin-top: 6px; }
  .empty { color: #8b8f98; padding: 40px; text-align: center; }
  .logfile { margin-top: 12px; border: 1px solid #262a33; border-radius: 8px; overflow: hidden; }
  .logfile .lf-head { display: flex; align-items: center; justify-content: space-between; gap: 10px;
                      padding: 9px 12px; background: #11141a; cursor: pointer; }
  .logfile .lf-name { font-family: Consolas, "Microsoft YaHei", monospace; font-size: 13px; color: #d6dae0; word-break: break-all; }
  .logfile .lf-meta { font-size: 11px; color: #8b8f98; white-space: nowrap; }
  .logfile pre { margin: 0; max-height: 72vh; overflow: auto; padding: 12px 14px;
                 background: #0b0d11; color: #cdd3da;
                 font-family: Consolas, "Microsoft YaHei", monospace; font-size: 12.5px; line-height: 1.6;
                 white-space: pre-wrap; word-break: break-all; }
  @media (max-width: 900px) {
    .detail-wrap { flex-direction: column; }
    .info-card { flex: 1 1 auto; max-width: none; width: 100%; }
  }
  @media (max-width: 480px) {
    .grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="topbar">
  <div class="title"><span id="ttl">运行记录详情</span> <small id="sub"></small></div>
  <button class="back" onclick="location.href='timeline.html'">← 返回运行记录</button>
</div>
<div id="app"></div>
<script>
var REC = __REC__;
var GEN = "__GEN__";
function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function pad(n){ return String(n).padStart(2,"0"); }
function fmtFull(ms){
  if (ms == null) return "—";
  var d = new Date(ms);
  return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+" "+
         pad(d.getHours())+":"+pad(d.getMinutes())+":"+pad(d.getSeconds());
}
function fmtDur(ms){
  if (ms == null || ms < 0) return "—";
  var s = Math.round(ms/1000);
  if (s < 60) return s + " 秒";
  var m = Math.floor(s/60), sec = s%60;
  if (m < 60) return m + " 分" + (sec? " "+sec+" 秒":"");
  var h = Math.floor(m/60), mm = m%60;
  return h + " 小时" + (mm? " "+mm+" 分":"");
}
function statusBadge(st){
  var map = { Failed:["失败","rgba(226,75,74,0.18)","#E24B4A"],
             Executing:["运行中","rgba(239,159,39,0.18)","#EF9F27"],
             Waiting:["排队中","rgba( 55,138,221,0.18)","#378ADD"],
             Stopped:["已停止","rgba(95,94,90,0.18)","#8b8f98"] };
  var m = map[st] || ["已完成","rgba(29,158,117,0.18)","#1D9E75"];
  return '<span class="badge" style="background:'+m[1]+';color:'+m[2]+'">'+m[0]+'</span>';
}
function wayCN(w){ return ({Manual:"手动",TimingTrigger:"定时触发器",Webhook:"Webhook"}[w]) || w || "—"; }
function getParam(name){
  var m = new RegExp("[?&]" + name + "=([^&]*)").exec(location.search);
  return m ? decodeURIComponent(m[1]) : null;
}
function fmtSize(b){
  if (b == null) return "";
  if (b < 1024) return b + " B";
  if (b < 1024*1024) return (b/1024).toFixed(1) + " KB";
  return (b/1024/1024).toFixed(2) + " MB";
}
function render(){
  var rec = REC;
  var app = document.getElementById("app");
  if (!rec){
    app.innerHTML = '<div class="empty">未找到该运行记录。</div>';
    return;
  }
  document.getElementById("ttl").textContent = rec.name || "运行记录";
  document.getElementById("sub").textContent = rec.robot || "";
  var queueMs = (rec.execStart && rec.execStart > rec.start) ? (rec.execStart - rec.start) : 0;
  var runFrom = (rec.execStart && rec.execStart > rec.start) ? rec.execStart : rec.start;
  var runMs = (rec.end == null) ? null : (rec.end - runFrom);

  var info = '<div class="card info-card"><h3>基础信息</h3><div class="grid">'
    + fld("机器人", esc(rec.robot))
    + fld("状态", statusBadge(rec.status))
    + fld("触发方式", wayCN(rec.way))
    + (rec.way && rec.way !== "Manual" && rec.trigger ? fld("触发器", esc(rec.trigger)) : "")
    + fld("流程ID (flow_id)", esc(rec.fid || "—"))
    + fld("流程编号 (process_no)", esc(rec.pno || "—"))
    + fld("开始时间", fmtFull(rec.start))
    + (rec.execStart ? fld("开始运行", fmtFull(rec.execStart)) : "")
    + fld("结束时间", rec.end == null ? '<span style="color:#EF9F27">进行中</span>' : fmtFull(rec.end))
    + (queueMs ? fld("排队时长", fmtDur(queueMs)) : "")
    + (runMs!=null ? fld("运行时长", fmtDur(runMs)) : "")
    + '</div></div>';

  var logCard = '<div class="card log-card"><h3>日志内容</h3><div id="logbox" class="tip">正在读取日志…</div></div>';

  app.innerHTML = '<div class="detail-wrap">' + info + logCard + '</div>';
}
function fld(k, v){ return '<div class="field"><div class="k">'+k+'</div><div class="v">'+v+'</div></div>'; }
function loadLogs(){
  var box = document.getElementById("logbox");
  if (!box) return;
  if (!REC.log){
    box.innerHTML = '<div class="tip">未配置该机器人的日志目录，无法确定日志路径。请在 robot_logs.json 中补充该机器人的共享日志目录（参考其他机器人配置）。</div>';
    return;
  }
  if (location.protocol === "file:"){
    var cur = location.pathname.split("/").pop();
    box.innerHTML = '<div class="warn">⚠ 当前以 file:// 方式打开，浏览器禁止实时读取日志。请改用本地服务器：运行 start_server.bat，再打开 <a href="http://localhost:8000/'+esc(cur)+'" target="_blank" rel="noopener">http://localhost:8000/'+esc(cur)+'</a></div>';
    return;
  }
  var url = "/api/log?dir=" + encodeURIComponent(REC.log);
  box.innerHTML = '<div class="tip">正在读取日志…</div>';
  fetch(url).then(function(r){ return r.json(); }).then(function(d){
    if (!d.ok){
      box.innerHTML = '<div class="warn">⚠ 读取日志失败：'+esc(d.error || "未知错误")+'</div>';
      return;
    }
    if (!d.logs || d.logs.length === 0){
      box.innerHTML = '<div class="tip">目录下没有 .log 文件。</div>';
      return;
    }
    var h = "";
    for (var i=0;i<d.logs.length;i++){
      var lf = d.logs[i], lid = "lf"+i;
      h += '<div class="logfile">'
        + '<div class="lf-head" data-tid="'+lid+'">'
        + '<span class="lf-name">📄 '+esc(lf.name)+'</span>'
        + '<span class="lf-meta">'+fmtSize(lf.size)+' · 点击折叠/展开</span>'
        + '</div>'
        + '<pre id="'+lid+'">'+esc(lf.content)+'</pre>'
        + '</div>';
    }
    box.innerHTML = h;
    var heads = box.querySelectorAll(".lf-head");
    for (var j=0;j<heads.length;j++){
      (function(el){
        el.addEventListener("click", function(){
          var e = document.getElementById(el.getAttribute("data-tid"));
          if (e.style.display === "none"){ e.style.display = "block"; }
          else { e.style.display = "none"; }
        });
      })(heads[j]);
    }
  }).catch(function(e){
    box.innerHTML = '<div class="warn">⚠ 无法连接本地服务器（'+(e && e.message ? e.message : e)+'）。请确认 start_server.bat 正在运行。</div>';
  });
}
render();
loadLogs();
</script>
</body>
</html>
"""

STATS_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Cache-Control" content="no-store">
<meta http-equiv="Pragma" content="no-cache">
<title>运行分析</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
<style>
  html, body { height: 100%; }
  body { margin: 0; padding: 10px 14px; box-sizing: border-box;
         font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
         background: #0f1115; color: #e6e6e6; }
  h1 { font-size: 18px; font-weight: 500; margin: 0; }
  .head { display: flex; align-items: center; justify-content: space-between;
          gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
  .titlebar { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
  .datatime { font-size: 11px; color: #6f7480; margin-left: 8px; }
  #navSel { width: auto; background: transparent; color: #e6e6e6; border: 1px solid transparent;
            border-radius: 6px; padding: 2px 8px; font-size: 22px; font-weight: 600;
            cursor: pointer; font-family: inherit; }
  #navSel:hover { border-color: #333a45; background: #22262e; }
  #navSel:focus { outline: none; border-color: #333a45; }
  .metrics { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .metric { flex: 1 1 0; min-width: 104px; background: #181b21; border: 1px solid #262a33;
            border-radius: 8px; padding: 8px 12px; text-align: center; }
  .metric .k { font-size: 11px; color: #8b8f98; }
  .metric .v { font-size: 20px; font-weight: 500; line-height: 1.3; }
  .metric .s { font-size: 10px; color: #6f7480; margin-top: 2px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .panel { background: #181b21; border: 1px solid #262a33; border-radius: 10px; padding: 10px 14px; }
  .panel.full { grid-column: 1 / -1; }
  .panel h2 { font-size: 14px; font-weight: 500; margin: 0 0 8px; color: #c9cdd4; }
  .cbox { width: 100%; height: 280px; }
  .cbox.tall { height: 300px; }
  .toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
  .btn { background: #22262e; color: #e6e6e6; border: 1px solid #333a45; border-radius: 6px;
         padding: 4px 12px; font-size: 12px; cursor: pointer; }
  .btn:hover { background: #2b3038; }
  .auto-update-label { font-size: 13px; color: #8b8f98; }
  #chkAuto { width: 14px; height: 14px; accent-color: #378ADD; cursor: pointer; vertical-align: -2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #262a33; }
  th { color: #8b8f98; font-weight: 500; position: sticky; top: 0; background: #181b21; z-index: 1; }
  tbody tr:hover { background: #1f232b; }
  .scroll { max-height: 320px; overflow: auto; }
  .warn { color: #E24B4A; font-size: 11px; margin-left: 8px; }
  @media (max-width: 900px){ .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<!-- __LOCK_START__ -->
<div id="lock" style="position:fixed;inset:0;background:#0f1115;z-index:9999;display:flex;align-items:center;justify-content:center;">
  <div style="text-align:center;width:300px;">
    <div style="font-size:20px;font-weight:500;margin-bottom:4px;color:#e6e6e6;">运行分析</div>
    <div style="color:#8b8f98;font-size:12px;margin-bottom:18px;">请输入访问密码</div>
    <input id="pwd" type="password" placeholder="访问密码" autocomplete="off"
      style="width:100%;box-sizing:border-box;padding:9px 12px;font-size:14px;border-radius:6px;border:1px solid #333a45;background:#22262e;color:#e6e6e6;">
    <button id="unlock" style="width:100%;margin-top:12px;padding:9px 0;background:#378ADD;border:none;border-radius:6px;color:#fff;font-size:14px;cursor:pointer;">进入</button>
    <div id="err" style="color:#E24B4A;font-size:12px;margin-top:10px;display:none;">密码错误，请重试</div>
  </div>
</div>
<!-- __LOCK_END__ -->
<div class="head">
  <div class="titlebar">
    <select id="navSel">
      <option value="schedule.html">触发器日程</option>
      <option value="timeline.html">运行记录</option>
      <option value="analysis.html" selected>运行分析</option>
    </select>
    <div class="datatime" id="dataTime">数据获取：__GEN__</div>
    <div class="datatime warn" id="refreshWarn" style="display:none;">刷新失败，登录态可能已过期，请检查 output/update_log.txt</div>
  </div>
  <div class="toolbar">
    <span class="auto-update-label">自动更新：</span><input type="checkbox" id="chkAuto">
  </div>
</div>
<div class="metrics" id="metrics"></div>
<div class="grid">
  <div class="panel"><h2>触发方式分布</h2><div id="pie" class="cbox"></div></div>
  <div class="panel"><h2>状态分布</h2><div id="statusPie" class="cbox"></div></div>
  <div class="panel full"><h2>运行量热力图（星期 × 小时）</h2><div id="heat" class="cbox tall"></div></div>
  <div class="panel"><h2>各机器人平均排队时长（资源争抢）</h2><div id="waitBar" class="cbox"></div></div>
  <div class="panel"><h2>机器人负载榜</h2><div class="scroll"><table id="robotTbl"></table></div></div>
</div>
<div class="panel full">
  <div class="toolbar"><h2 style="margin:0;">失败记录看板</h2>
    <button class="btn" id="btnExport">导出失败记录 CSV</button>
    <span id="failCount" class="datatime"></span>
  </div>
  <div class="scroll"><table id="failTbl"></table></div>
</div>
<script>
var SEED = __SEED__;
var STATUS_CN = { Waiting:"排队中", Executing:"运行中", Finished:"已完成", Failed:"失败", Stopped:"已停止" };
var STATUS_COLOR = { Finished:"#1D9E75", Executing:"#EF9F27", Waiting:"#378ADD", Failed:"#E24B4A", Stopped:"#5F5E5A" };
var WAY_CN = { Manual:"手动", TimingTrigger:"定时触发器", Webhook:"Webhook" };
function wayOf(w){ return WAY_CN[w] || w || "-"; }
function pad(n){ return String(n).padStart(2, "0"); }
function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function fmtTime(ms){ if(ms == null) return "-"; var d = new Date(ms); return (d.getMonth()+1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
function fmtDur(ms){ if(ms == null || isNaN(ms)) return "-"; var m = ms/60000; if(m < 1) return Math.round(ms/1000) + " 秒"; if(m < 60) return m.toFixed(1) + " 分钟"; var h = Math.floor(m/60), mm = Math.round(m%60); return h + " 时" + (mm ? (" " + mm + " 分") : ""); }

var charts = {};
function initCharts(){
  charts.pie = echarts.init(document.getElementById('pie'));
  charts.statusPie = echarts.init(document.getElementById('statusPie'));
  charts.waitBar = echarts.init(document.getElementById('waitBar'));
  charts.heat = echarts.init(document.getElementById('heat'));
  window.addEventListener('resize', function(){ for(var k in charts) charts[k].resize(); });
}

function renderAll(recs){
  var now = Date.now();
  var total = 0, finished = 0, failed = 0, running = 0, stopped = 0, waiting = 0;
  var waitSum = 0, waitN = 0, runSum = 0, runN = 0, maxRun = 0;
  var events = [];
  var byRobot = {}, byWay = {}, statusCount = {};
  var heat = []; for(var w = 0; w < 7; w++){ heat.push(new Array(24).fill(0)); }
  recs.forEach(function(r){
    var st = r.start, en = (r.end == null) ? now : r.end;
    var s = r.status;
    total++;
    statusCount[s] = (statusCount[s] || 0) + 1;
    if(s === 'Finished') finished++; else if(s === 'Failed') failed++;
    else if(s === 'Executing') running++; else if(s === 'Stopped') stopped++;
    else if(s === 'Waiting') waiting++;
    if(r.execStart && r.execStart > st){ waitSum += r.execStart - st; waitN++; }
    if(r.execStart && r.end != null && r.end > r.execStart){ var rd = r.end - r.execStart; runSum += rd; runN++; if(rd > maxRun) maxRun = rd; }
    else if(r.end != null && r.end > st){ var rd2 = r.end - st; if(rd2 > maxRun) maxRun = rd2; }
    events.push([st, 1]); events.push([en, -1]);
    var wd = (new Date(st).getDay() + 6) % 7; var hh = new Date(st).getHours(); heat[wd][hh]++;
    var rk = r.robot; var u = byRobot[rk] || (byRobot[rk] = {robot:rk, count:0, failed:0, waitSum:0, waitN:0, runSum:0, runN:0});
    u.count++; if(s === 'Failed') u.failed++;
    if(r.execStart && r.execStart > st){ u.waitSum += r.execStart - st; u.waitN++; }
    if(r.execStart && r.end != null && r.end > r.execStart){ u.runSum += r.end - r.execStart; u.runN++; }
    var wv = r.way || "-"; byWay[wv] = (byWay[wv] || 0) + 1;
  });
  events.sort(function(a, b){ return (a[0] - b[0]) || (a[1] - b[1]); });
  var peak = 0, cur = 0; events.forEach(function(e){ cur += e[1]; if(cur > peak) peak = cur; });
  var avgWait = waitN ? waitSum / waitN : 0, avgRun = runN ? runSum / runN : 0;
  renderMetrics(total, finished, failed, running, avgWait, avgRun, maxRun, peak, waitN, runN);
  renderPie(byWay);
  renderStatus(statusCount);
  renderWaitBar(byRobot);
  renderHeat(heat);
  renderRobotTbl(byRobot);
  renderFailTbl(recs);
}

function card(k, v, s, color){
  return '<div class="metric"><div class="k">' + k + '</div><div class="v"' + (color ? ' style="color:' + color + '"' : '') + '>' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>';
}
function renderMetrics(total, finished, failed, running, avgWait, avgRun, maxRun, peak, waitN, runN){
  var sr = (finished + failed) ? finished / (finished + failed) : 0;
  var html = '';
  html += card('总运行数', total, '最近 7 天');
  html += card('成功率', (sr*100).toFixed(1) + '%', '成功 ' + finished + ' / 结果 ' + (finished + failed));
  html += card('失败数', failed, '失败率 ' + (total ? (failed/total*100).toFixed(1) : 0) + '%', failed ? '#E24B4A' : '');
  html += card('运行中', running, '');
  html += card('平均排队', fmtDur(avgWait), waitN + ' 条有排队');
  html += card('平均运行', fmtDur(avgRun), runN + ' 条已完成');
  html += card('最长单次', fmtDur(maxRun), '');
  html += card('并发峰值', peak, '同时运行最多');
  document.getElementById('metrics').innerHTML = html;
}
function renderPie(byWay){
  var data = Object.keys(byWay).map(function(k){ return {name: wayOf(k), value: byWay[k]}; });
  charts.pie.setOption({
    tooltip:{trigger:'item', confine:true, formatter:'{b}: {c} ({d}%)'},
    legend:{bottom:0, textStyle:{color:'#8b8f98'}},
    series:[{type:'pie', radius:['42%','68%'], center:['50%','46%'], label:{color:'#e6e6e6', formatter:'{b}\\n{d}%'}, data:data}]
  });
}
function renderStatus(sc){
  var data = Object.keys(sc).map(function(k){ return {name: STATUS_CN[k] || k, value: sc[k], itemStyle:{color: STATUS_COLOR[k] || '#888'}}; });
  data.sort(function(a, b){ return b.value - a.value; });
  charts.statusPie.setOption({
    tooltip:{trigger:'item', confine:true, formatter:'{b}: {c} ({d}%)'},
    legend:{bottom:0, textStyle:{color:'#8b8f98'}},
    series:[{type:'pie', radius:['42%','68%'], center:['50%','46%'], label:{color:'#e6e6e6', formatter:'{b}\\n{d}%'}, data:data}]
  });
}
function renderWaitBar(byRobot){
  var arr = Object.keys(byRobot).map(function(k){ var u = byRobot[k]; return {robot:u.robot, avg: u.waitN ? u.waitSum / u.waitN : 0}; }).sort(function(a, b){ return b.avg - a.avg; });
  charts.waitBar.setOption({
    grid:{left:130, right:40, top:10, bottom:24},
    tooltip:{trigger:'axis', confine:true, formatter:function(p){ return p[0].name + '：' + fmtDur(p[0].value); }},
    xAxis:{type:'value', axisLabel:{color:'#8b8f98', formatter:function(v){ return (v/60000).toFixed(0) + '分'; }}, splitLine:{lineStyle:{color:'#20242c'}}},
    yAxis:{type:'category', data:arr.map(function(d){ return d.robot; }), axisLabel:{color:'#c9cdd4'}, inverse:true},
    series:[{type:'bar', data:arr.map(function(d){ return d.avg; }), itemStyle:{color:'#378ADD'}, barWidth:'55%'}]
  });
}
function renderHeat(heat){
  var days = ['一','二','三','四','五','六','日'];
  var data = [], maxV = 0;
  for(var w = 0; w < 7; w++) for(var h = 0; h < 24; h++){ var v = heat[w][h]; if(v > maxV) maxV = v; data.push([h, w, v]); }
  charts.heat.setOption({
    tooltip:{position:'top', confine:true, formatter:function(p){ return '周' + days[p.value[1]] + ' ' + pad(p.value[0]) + '时：' + p.value[2] + ' 次'; }},
    grid:{left:46, right:20, top:10, bottom:54},
    xAxis:{type:'category', data:Array.from({length:24}, function(_, i){ return i; }), axisLabel:{color:'#8b8f98'}, splitArea:{show:true}},
    yAxis:{type:'category', data:days.map(function(d){ return '周' + d; }), axisLabel:{color:'#c9cdd4'}},
    visualMap:{min:0, max:(maxV || 1), calculable:true, orient:'horizontal', left:'center', bottom:0, textStyle:{color:'#8b8f98'}, inRange:{color:['#181b21','#378ADD','#EF9F27','#E24B4A']}},
    series:[{type:'heatmap', data:data, label:{show:false}, emphasis:{itemStyle:{borderColor:'#fff', borderWidth:1}}}]
  });
}
function renderRobotTbl(byRobot){
  var rows = Object.keys(byRobot).map(function(k){ return byRobot[k]; }).sort(function(a, b){ return b.count - a.count; });
  var html = '<thead><tr><th>机器人</th><th>记录数</th><th>失败</th><th>失败率</th><th>平均排队</th><th>平均运行</th></tr></thead><tbody>';
  rows.forEach(function(u){
    var fr = u.count ? u.failed / u.count * 100 : 0;
    html += '<tr><td>' + esc(u.robot) + '</td><td>' + u.count + '</td><td>' + u.failed + '</td>' +
      '<td' + (fr >= 20 ? ' style="color:#E24B4A"' : '') + '>' + fr.toFixed(0) + '%</td>' +
      '<td>' + fmtDur(u.waitN ? u.waitSum / u.waitN : 0) + '</td>' +
      '<td>' + fmtDur(u.runN ? u.runSum / u.runN : 0) + '</td></tr>';
  });
  html += '</tbody>';
  document.getElementById('robotTbl').innerHTML = html;
}
function renderFailTbl(recs){
  var fails = recs.filter(function(r){ return r.status === 'Failed'; });
  var html = '<thead><tr><th>开始时间</th><th>机器人</th><th>应用</th><th>触发方式</th><th>流程编号</th></tr></thead><tbody>';
  fails.forEach(function(r){
    html += '<tr><td>' + fmtTime(r.start) + '</td><td>' + esc(r.robot) + '</td><td>' + esc(r.name || r.app) + '</td><td>' + wayOf(r.way) + '</td><td>' + esc(r.id || '') + '</td></tr>';
  });
  html += '</tbody>';
  document.getElementById('failTbl').innerHTML = html;
  document.getElementById('failCount').textContent = '共 ' + fails.length + ' 条失败';
  window.__fails = fails;
}

document.getElementById('btnExport').onclick = function(){
  var fails = window.__fails || [];
  if(!fails.length){ alert('没有失败记录'); return; }
  var head = ['开始时间','机器人','应用','触发方式','流程编号','状态'];
  var lines = [head.join(',')];
  fails.forEach(function(r){
    var row = [fmtTime(r.start), r.robot, r.name || r.app, wayOf(r.way), r.id || '', '失败'];
    lines.push(row.map(function(x){ return '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"'; }).join(','));
  });
  var blob = new Blob(['﻿' + lines.join('\\n')], {type:'text/csv;charset=utf-8'});
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = '失败运行记录_' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
};

function refreshData(){
  fetch('/api/refresh', {method:'POST'}).then(function(r){ return r.json(); }).then(function(d){
    var warn = document.getElementById('refreshWarn');
    if(d && d.ok && Array.isArray(d.records)){
      if(warn) warn.style.display = 'none';
      SEED = d.records; renderAll(SEED);
      if(d.time) document.getElementById('dataTime').textContent = '数据获取：' + d.time;
    } else if(warn){
      warn.style.display = 'block';
      if(d && d.time) document.getElementById('dataTime').textContent = '数据获取：' + d.time + '（刷新失败）';
    }
  }).catch(function(){});
}
var autoTimer = null;
document.getElementById('chkAuto').onchange = function(){
  if(this.checked){ refreshData(); if(!autoTimer) autoTimer = setInterval(refreshData, 60000); }
  else { if(autoTimer){ clearInterval(autoTimer); autoTimer = null; } }
};
document.getElementById('navSel').onchange = function(){ location.href = this.value; };
initCharts(); renderAll(SEED);
</script>
<script>
function sha256(a){function r(n,t){return(n>>>t)|(n<<(32-t))}function ror(n,t){return(n<<t)|(n>>>(32-t))}function s2b(s){var i,b=[],c=0;for(i=0;i<s.length*8;i+=8)c=c<<8|s.charCodeAt(i/8),i%32==24&&(b.push(c),c=0);return b}function b2h(b){var h="",i;for(i=0;i<b.length;i++)h+=((b[i]>>>24)&255).toString(16).padStart(2,"0")+((b[i]>>>16)&255).toString(16).padStart(2,"0")+((b[i]>>>8)&255).toString(16).padStart(2,"0")+(b[i]&255).toString(16).padStart(2,"0");return h}var K=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1915078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];var H=[1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225],l=a.length*8,M=s2b(a),i;M[l>>5]|=128<<24-l%32;for(i=0;i<64;i++)M.push(0);M[(l+64>>9<<4)+15]=l;for(var n=0;n<M.length;n+=16){var W=[],A=H[0],B=H[1],C=H[2],D=H[3],E=H[4],F=H[5],G=H[6],J=H[7],j,t;for(i=0;i<64;i++){if(i<16)W[i]=M[n+i];else{var w1=W[i-15],w2=W[i-2];W[i]=ror(w1,7)^ror(w1,18)^(w1>>>3)^ror(w2,17)^ror(w2,19)^(w2>>>10)}var S1=ror(E,6)^ror(E,11)^ror(E,25),ch=E&F^~E&G,t1=J+S1+ch+K[i]+W[i],S0=ror(A,2)^ror(A,13)^ror(A,22),maj=A&B^A&C^B&C,t2=S0+maj;J=G;G=F;F=E;E=D+t1>>>0;D=C;C=B;B=A;A=t1+t2>>>0}H[0]=H[0]+A>>>0;H[1]=H[1]+B>>>0;H[2]=H[2]+C>>>0;H[3]=H[3]+D>>>0;H[4]=H[4]+E>>>0;H[5]=H[5]+F>>>0;H[6]=H[6]+G>>>0;H[7]=H[7]+J>>>0}return b2h(H)}
(function(){
  var HASH = '__PWD_HASH__';
  var lock = document.getElementById('lock');
  if (!lock) return;  // 未启用密码门（本地使用）
  function tryUnlock(){
    var v = document.getElementById('pwd').value;
    if (sha256(v) === HASH) {
      sessionStorage.setItem('rpa_dash_ok', '1');
      lock.style.display = 'none';
    } else {
      document.getElementById('err').style.display = 'block';
    }
  }
  if (sessionStorage.getItem('rpa_dash_ok') === '1') { lock.style.display = 'none'; }
  else {
    document.getElementById('unlock').onclick = tryUnlock;
    document.getElementById('pwd').onkeydown = function(e){ if (e.key === 'Enter') tryUnlock(); };
    document.getElementById('pwd').focus();
  }
})();
</script>
</body>
</html>"""


def build_runs_gantt(rows, out_dir):
    """生成运行记录时间轴页面。
    数据源优先：output/runs_normalized.csv（爬虫抓取的真实运行记录，手动/定时/Webhook 全部）；
    无该文件时回退：triggers_normalized.csv 中 trigger_type=Webhook 的触发器配置。
    """
    DEFAULT_RUN_MS = 30 * 60 * 1000  # 回退模式下每条种子记录默认持续 30 分钟
    seed = []
    runs_path = os.path.join(out_dir, "runs_normalized.csv")
    if os.path.exists(runs_path):
        with open(runs_path, "r", encoding="utf-8-sig") as f:
            run_rows = list(csv.DictReader(f))
        for r in run_rows:
            start = to_ms(r.get("start_time"))
            if start is None:
                continue
            seed.append({
                "id": file_safe_id(r.get("flow_id"), r.get("process_no")),
                "robot": r.get("bot_name") or "(未指定机器人)",
                "name": r.get("flow_name") or r.get("trigger_name") or "运行记录",
                "app": r.get("flow_name") or "",
                "trigger": r.get("trigger_name") or "",
                "start": start,
                "end": to_ms(r.get("end_time")),  # 为空 = 运行中/排队中，前端延伸到现在
                "status": r.get("status") or "",
                "execStart": to_ms(r.get("execution_start_time")),  # 实际开始运行时间（此前为排队阶段）
                "way": r.get("start_way") or "",
            })
        seed.sort(key=lambda s: s["start"])
        data_desc = f"真实运行记录 {len(seed)} 条"
    else:
        for r in rows:
            if r.get("trigger_type") != "Webhook":
                continue
            start = to_ms(r.get("update_time"))
            if start is None:
                continue
            seed.append({
                "id": r.get("trigger_id") or ("seed_%d" % len(seed)),
                "robot": r.get("robot_name") or "(未指定机器人)",
                "name": r.get("app_name") or r.get("trigger_name") or r.get("trigger_id"),
                "app": r.get("app_name") or "",
                "start": start,
                "end": start + DEFAULT_RUN_MS,
                "status": "Finished" if is_enabled(r.get("enabled")) else "Stopped",
                "execStart": start,
                "way": "Webhook",
            })
        data_desc = f"Webhook 触发器种子 {len(seed)} 条（无 runs_normalized.csv 回退）"
    gen = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    html = (GANTT_HTML
            .replace("__SEED__", json.dumps(seed, ensure_ascii=False))
            .replace("__GEN__", gen))
    out_path = os.path.join(out_dir, "timeline.html")
    finalize_html(html, out_path)
    robots_n = len({s["robot"] for s in seed})
    print(f"[+] 运行记录时间轴已生成: {out_path}")
    print(f"    {data_desc}，{robots_n} 台机器人")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="output/triggers_normalized.csv")
    ap.add_argument("--out", default="output")
    ap.add_argument("--only-gantt", action="store_true",
                    help="仅重新生成运行记录时间轴与分析页（快速刷新用，跳过触发器日程）")
    args = ap.parse_args()

    with open(args.input, "r", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    if args.only_gantt:
        # 快速刷新：只生成运行记录时间轴 + 分析页 + 详情页（同源 runs_normalized.csv）
        build_runs_gantt(rows, args.out)
        build_runs_stats(rows, args.out)
        build_run_detail(args.out)
        print("[OK] 时间轴/分析页/详情页刷新完成")
        return

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
        "robots": len(robot_names),
    }

    def group(points, key):
        out = {}
        for p in points:
            out.setdefault(p[key], []).append({k: v for k, v in p.items() if k != key})
        return out

    week_data = {n: group(rb["week"], "wd") for n, rb in robots.items()}
    month_data = {n: group(rb["month"], "day") for n, rb in robots.items()}

    html = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>触发器日程</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
<style>
  html, body { height: 100%; }
  body { margin: 0; padding: 10px 14px; box-sizing: border-box;
         font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
         background: #0f1115; color: #e6e6e6;
         display: flex; flex-direction: column; overflow: hidden; }
  h1 { font-size: 18px; font-weight: 500; margin: 0; }
  .head { display: flex; align-items: center; justify-content: space-between;
          gap: 12px; margin-bottom: 10px; flex-wrap: wrap; flex: none; }
  .titlebar { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
  .datatime { font-size: 11px; color: #6f7480; margin-left: 8px; }
  #navSel { width: auto; background: transparent; color: #e6e6e6; border: 1px solid transparent;
            border-radius: 6px; padding: 2px 8px; font-size: 22px; font-weight: 600;
            cursor: pointer; font-family: inherit; }
  #navSel:hover { border-color: #333a45; background: #22262e; }
  #navSel:focus { outline: none; border-color: #333a45; }
  .metrics { display: flex; gap: 10px; flex-wrap: wrap; }
  .metric { flex: 1 1 0; min-width: 84px; background: #181b21; border: 1px solid #262a33;
            border-radius: 8px; padding: 6px 14px; text-align: center; }
  .metric .k { font-size: 11px; color: #8b8f98; }
  .metric .v { font-size: 18px; font-weight: 500; line-height: 1.25; }
  .panels { flex: 1; min-height: 0; display: flex; }
  .panel { flex: 1; min-height: 0; display: flex; flex-direction: column;
           background: #181b21; border: 1px solid #262a33; border-radius: 10px; padding: 10px 14px; }
  .panel h2 { font-size: 13px; font-weight: 500; margin: 0 0 8px; color: #c9cdd4; flex: none; }
  .filter-label { font-size: 13px; color: #8b8f98; margin-right: 4px; }
  .panel h2 select + .filter-label { margin-left: 18px; }
  .chart { flex: 1; min-height: 0; width: 100%; }
  .hint { color: #6f7480; font-size: 11px; margin-top: 6px; flex: none; }
  select { width: 118px; box-sizing: border-box; background: #22262e; color: #e6e6e6;
           border: 1px solid #333a45; border-radius: 6px; padding: 3px 6px; font-size: 12px; margin-left: 8px; }
  @media (min-width: 1101px) { body { overflow: hidden; } }
  @media (max-width: 1100px) {
    .panels { flex-direction: column; overflow-y: auto; }
    .panel { flex: none; min-height: 720px; }
    body { overflow: auto; }
  }
</style>
</head>
<body>
<!-- __LOCK_START__ -->
<div id="lock" style="position:fixed;inset:0;background:#0f1115;z-index:9999;display:flex;align-items:center;justify-content:center;">
  <div style="text-align:center;width:300px;">
    <div style="font-size:20px;font-weight:500;margin-bottom:4px;color:#e6e6e6;">触发器日程</div>
    <div style="color:#8b8f98;font-size:12px;margin-bottom:18px;">请输入访问密码</div>
    <input id="pwd" type="password" placeholder="访问密码" autocomplete="off"
      style="width:100%;box-sizing:border-box;padding:9px 12px;font-size:14px;border-radius:6px;border:1px solid #333a45;background:#22262e;color:#e6e6e6;">
    <button id="unlock" style="width:100%;margin-top:12px;padding:9px 0;background:#378ADD;border:none;border-radius:6px;color:#fff;font-size:14px;cursor:pointer;">进入</button>
    <div id="err" style="color:#E24B4A;font-size:12px;margin-top:10px;display:none;">密码错误，请重试</div>
  </div>
</div>
<!-- __LOCK_END__ -->
<div class="head">
  <div class="titlebar">
    <select id="navSel">
      <option value="schedule.html" selected>触发器日程</option>
      <option value="timeline.html">运行记录</option>
      <option value="analysis.html">运行分析</option>
    </select>
    <div class="datatime" id="dataTime">数据获取：__GEN__</div>
  </div>
  <div class="metrics">
    <div class="metric"><div class="k">触发器总数</div><div class="v" style="color:#378ADD">__TOTAL__</div></div>
    <div class="metric"><div class="k">已启用</div><div class="v" style="color:#1D9E75">__ENABLED__</div></div>
    <div class="metric"><div class="k">已停用</div><div class="v" style="color:#888780">__DISABLED__</div></div>
    <div class="metric"><div class="k">Webhook</div><div class="v" style="color:#D85A30">__WEBHOOK__</div></div>
  </div>
</div>
<div class="panels">
  <div class="panel">
    <h2><span class="filter-label">视图：</span><select id="selView"></select><span class="filter-label">机器人：</span><select id="selRobot"></select><span class="filter-label">状态：</span><select id="selStatus"></select></h2>
    <div id="c1" class="chart"></div>
    <div class="hint">视图：每周=周一~周日（每天/每周任务），每月=当月有任务的日期（每月任务）；同色=同一应用，格内为应用短名，悬停看明细；红色十字线=当前时刻与今天。</div>
  </div>
</div>
<script>
var ROBOTS = __ROBOTS__;
var WEEK = __WEEK_DATA__;
var MONTH = __MONTH_DATA__;
var MONTH_LABELS = __MONTH_LABELS__;
var WEEK_LABELS = ["周一","周二","周三","周四","周五","周六","周日"];

function timeText(t){
  var hh = Math.floor(t), mm = Math.round((t - hh) * 60);
  return String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0');
}
function matchRobot(r, filter) {
  if (filter === '__ALL__') return true;
  if (filter === '__SUXI__') return r.indexOf('硕晞') >= 0;
  if (filter === '__BAOSHI__') return r.indexOf('宝实') >= 0;
  return r === filter;
}

var el = document.getElementById('c1');
var chart = echarts.init(el);
var lastRowInfo = [];
var lastTimes = [];
var curView = 'week';

function buildPoints(view, robot, status){
  var pts = [];
  var src = view === 'week' ? WEEK : MONTH;
  Object.keys(src).forEach(function(r){
    if (!matchRobot(r, robot)) return;
    Object.keys(src[r]).forEach(function(k){
      var xi = view === 'week' ? +k : MONTH_LABELS.indexOf(k + '日');
      if (xi < 0) return;
      src[r][k].forEach(function(p){
        if (status === 'enabled' && !p.enabled) return;
        if (status === 'disabled' && p.enabled) return;
        pts.push({ x: xi, t: p.t, app: p.app, short: p.short, color: p.color, robot: r, enabled: p.enabled });
      });
    });
  });
  return pts;
}

function timeToY(t, rowInfo, times){
  if (!times.length) return null;
  var n = times.length;
  if (t >= times[0]) return rowInfo[0].center - (t - times[0]);
  if (t <= times[n - 1]) return rowInfo[n - 1].center + (times[n - 1] - t);
  var lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    var mid = (lo + hi) >> 1;
    if (times[mid] > t) lo = mid; else hi = mid;
  }
  var frac = (times[lo] - t) / (times[lo] - times[hi]);
  return rowInfo[lo].center + frac * (rowInfo[hi].center - rowInfo[lo].center);
}

function updateLines(){
  var now = new Date();
  var t = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  var y = timeToY(t, lastRowInfo, lastTimes);
  var xIdx = curView === 'month'
    ? MONTH_LABELS.indexOf(now.getDate() + '日')
    : (now.getDay() + 6) % 7;
  var lineData = [];
  if (y !== null) lineData.push({ yAxis: y, name: 'now' });
  if (xIdx >= 0) lineData.push({ xAxis: xIdx });
  if (!lineData.length) return;
  chart.setOption({
    series: [{ markLine: { silent: true, symbol: 'none',
      lineStyle: { color: '#E24B4A', width: 2 },
      label: { formatter: function(p){ return p.data.name === 'now' ? timeText(t) : ''; },
               color: '#E24B4A', fontSize: 11, position: 'insideEndTop' },
      data: lineData } }]
  });
}
setInterval(updateLines, 10000);

function render(view, filter, status) {
  curView = view;
  var xLabels = view === 'week' ? WEEK_LABELS : MONTH_LABELS;
  var isMonth = view === 'month';
  var pts = buildPoints(view, filter, status);
  var merged = {};
  pts.forEach(function(p){
    var k = p.t + '_' + p.app;
    if (!merged[k]) {
      merged[k] = { t: p.t, app: p.app, short: p.short, color: p.color, xs: [], items: [], hasEnabled: p.enabled };
    } else if (p.enabled && !merged[k].hasEnabled) {
      merged[k].color = p.color;
      merged[k].hasEnabled = true;
    }
    merged[k].xs.push(p.x);
    merged[k].items.push({ x: p.x, robot: p.robot, enabled: p.enabled });
  });
  var times = [];
  Object.keys(merged).forEach(function(k){ if (times.indexOf(merged[k].t) < 0) times.push(merged[k].t); });
  times.sort(function(a,b){ return b - a; });
  var idx = {};
  times.forEach(function(t,i){ idx[t] = i; });
  var groups = {};
  Object.keys(merged).forEach(function(k){
    var m = merged[k];
    m.x0 = Math.min.apply(null, m.xs);
    m.x1 = Math.max.apply(null, m.xs);
    (groups[m.t] = groups[m.t] || []).push(m);
  });
  var rowInfo = [];
  var acc = 0;
  times.forEach(function(t, i){
    var n = groups[t].length;
    var h = Math.max(1, n);
    rowInfo.push({ t: t, center: acc + h / 2, h: h });
    acc += h;
  });
  var yMax = acc;
  lastRowInfo = rowInfo;
  lastTimes = times;
  var data = [];
  Object.keys(groups).forEach(function(t){
    var arr = groups[t], n = arr.length;
    arr.forEach(function(m, i){
      data.push({
        value: [m.x0, m.x1, idx[m.t], i, n, m.color, m.short],
        app: m.app, t: m.t, items: m.items,
        tooltip: { formatter: function(){
          var labels = curView === 'month' ? MONTH_LABELS : WEEK_LABELS;
          var range = m.x0 === m.x1 ? labels[m.x0] : (labels[m.x0] + ' - ' + labels[m.x1]);
          var robots = [];
          m.items.forEach(function(it){
            var label = it.enabled ? it.robot : it.robot + '（停用）';
            if (robots.indexOf(label) < 0) robots.push(label);
          });
          return '<b>' + m.app + '</b><br/>' + range + ' ' + timeText(m.t) + '<br/>' + robots.join('、');
        } }
      });
    });
  });
  chart.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item', confine: true, backgroundColor: '#1c2027', borderColor: '#333a45',
               textStyle: { color: '#e6e6e6', fontSize: 12 } },
    grid: { left: 44, right: 16, top: 10, bottom: isMonth ? 46 : 34 },
    xAxis: { type: 'category', data: xLabels,
             axisLabel: { color: '#8b8f98', interval: 0, rotate: isMonth ? 40 : 0, fontSize: 11 },
             axisLine: { lineStyle: { color: '#333' } } },
    yAxis: { type: 'value', min: 0, max: yMax, interval: 1,
             axisLabel: { color: '#8b8f98', fontSize: 11,
                          formatter: function(v){
                            var best = null, bd = 1e9;
                            rowInfo.forEach(function(r){
                              var d = Math.abs(r.center - v);
                              if (d < bd) { bd = d; best = r.t; }
                            });
                            return best !== null ? timeText(best) : '';
                          } },
             splitLine: { show: false },
             axisLine: { lineStyle: { color: '#333' } } },
    series: [{
      type: 'custom', data: data,
      renderItem: function(params, api){
        var colW = api.size([1, 0])[0];
        var unitPx = api.size([0, 1])[1];
        var bh = Math.max(12, unitPx * 0.9);
        var ri = rowInfo[api.value(2)];
        var x0 = api.coord([api.value(0), ri.center])[0] - colW / 2;
        var x1 = api.coord([api.value(1), ri.center])[0] + colW / 2;
        var yBase = api.coord([api.value(0), ri.center])[1];
        var off = (api.value(3) - (api.value(4) - 1) / 2) * unitPx;
        var bw = Math.max(5, x1 - x0);
        return { type: 'rect', shape: { x: x0, y: yBase + off - bh / 2, width: bw, height: bh },
                 style: { fill: api.value(5), stroke: 'rgba(255,255,255,.35)', lineWidth: 1,
                          text: api.value(6), textPosition: 'inside',
                          textFill: '#0f1115', fontSize: 20, fontWeight: 500,
                          overflow: 'truncate', fontFamily: 'inherit' } };
      },
      emphasis: { focus: 'none' }
    }]
  }, true);
  updateLines();
}

function fillSelect(id, options, onChange) {
  var sel = document.getElementById(id);
  options.forEach(function(o){
    var op = document.createElement('option');
    op.value = o[0]; op.textContent = o[1];
    sel.appendChild(op);
  });
  sel.addEventListener('change', function(){ onChange(sel.value); });
}

var curFilter = '__ALL__';
var curStatus = 'enabled';
fillSelect('selView', [['week', '每周'], ['month', '每月']], function(v){ render(v, curFilter, curStatus); });
fillSelect('selRobot',
  [['__ALL__', '全部机器人'], ['__SUXI__', '所有硕晞'], ['__BAOSHI__', '所有宝实']]
    .concat(ROBOTS.slice().sort().map(function(r){ return [r, r]; })),
  function(v){ curFilter = v; render(curView, v, curStatus); });
fillSelect('selStatus', [['enabled', '已启用'], ['disabled', '已停用'], ['__ALL__', '全部状态']],
  function(v){ curStatus = v; render(curView, curFilter, v); });

window.addEventListener('resize', function(){ chart.resize(); });
setTimeout(function(){ chart.resize(); }, 60);
if (window.ResizeObserver) {
  new ResizeObserver(function(){ chart.resize(); }).observe(el);
}
// 标题下拉切换页面
document.getElementById('navSel').onchange = function(){ location.href = this.value; };
render('week', '__ALL__', 'enabled');
</script>
<script>
function sha256(a){function r(n,t){return(n>>>t)|(n<<(32-t))}function ror(n,t){return(n<<t)|(n>>>(32-t))}function s2b(s){var i,b=[],c=0;for(i=0;i<s.length*8;i+=8)c=c<<8|s.charCodeAt(i/8),i%32==24&&(b.push(c),c=0);return b}function b2h(b){var h="",i;for(i=0;i<b.length;i++)h+=((b[i]>>>24)&255).toString(16).padStart(2,"0")+((b[i]>>>16)&255).toString(16).padStart(2,"0")+((b[i]>>>8)&255).toString(16).padStart(2,"0")+(b[i]&255).toString(16).padStart(2,"0");return h}var K=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1915078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];var H=[1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225],l=a.length*8,M=s2b(a),i;M[l>>5]|=128<<24-l%32;for(i=0;i<64;i++)M.push(0);M[(l+64>>9<<4)+15]=l;for(var n=0;n<M.length;n+=16){var W=[],A=H[0],B=H[1],C=H[2],D=H[3],E=H[4],F=H[5],G=H[6],J=H[7],j,t;for(i=0;i<64;i++){if(i<16)W[i]=M[n+i];else{var w1=W[i-15],w2=W[i-2];W[i]=ror(w1,7)^ror(w1,18)^(w1>>>3)^ror(w2,17)^ror(w2,19)^(w2>>>10)}var S1=ror(E,6)^ror(E,11)^ror(E,25),ch=E&F^~E&G,t1=J+S1+ch+K[i]+W[i],S0=ror(A,2)^ror(A,13)^ror(A,22),maj=A&B^A&C^B&C,t2=S0+maj;J=G;G=F;F=E;E=D+t1>>>0;D=C;C=B;B=A;A=t1+t2>>>0}H[0]=H[0]+A>>>0;H[1]=H[1]+B>>>0;H[2]=H[2]+C>>>0;H[3]=H[3]+D>>>0;H[4]=H[4]+E>>>0;H[5]=H[5]+F>>>0;H[6]=H[6]+G>>>0;H[7]=H[7]+J>>>0}return b2h(H)}
(function(){
  var HASH = '__PWD_HASH__';
  var lock = document.getElementById('lock');
  if (!lock) return;  // 未启用密码门（本地使用）
  function tryUnlock(){
    var v = document.getElementById('pwd').value;
    if (sha256(v) === HASH) {
      sessionStorage.setItem('rpa_dash_ok', '1');
      lock.style.display = 'none';
    } else {
      document.getElementById('err').style.display = 'block';
    }
  }
  if (sessionStorage.getItem('rpa_dash_ok') === '1') { lock.style.display = 'none'; }
  else {
    document.getElementById('unlock').onclick = tryUnlock;
    document.getElementById('pwd').onkeydown = function(e){ if (e.key === 'Enter') tryUnlock(); };
    document.getElementById('pwd').focus();
  }
})();
</script>
<!-- __LOCK_END__ -->
</body>
</html>"""

    gen = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    html = (html
            .replace("__GEN__", gen)
            .replace("__TOTAL__", str(stats["total"]))
            .replace("__ENABLED__", str(stats["enabled"]))
            .replace("__DISABLED__", str(stats["total"] - stats["enabled"]))
            .replace("__WEBHOOK__", str(stats["webhook"]))
            .replace("__ROBOTS__", json.dumps(robot_names, ensure_ascii=False))
            .replace("__WEEK_DATA__", json.dumps(week_data, ensure_ascii=False))
            .replace("__MONTH_DATA__", json.dumps(month_data, ensure_ascii=False))
            .replace("__MONTH_LABELS__", json.dumps(month_labels, ensure_ascii=False)))

    # 统一收尾：密码门 + ECharts 内联 + 写出
    out_path = os.path.join(args.out, "schedule.html")
    finalize_html(html, out_path)
    week_pts = sum(len(p) for rb in robots.values() for p in [rb["week"]])
    month_pts = sum(len(p) for rb in robots.values() for p in [rb["month"]])
    print(f"[+] 触发器日程已生成: {out_path}")
    print(f"    月视图({year}年{month}月): 有任务日期 {len(month_labels)} 天")
    print(f"    周视图任务点: {week_pts} 个 / 月视图任务点: {month_pts} 个")

    # 运行记录时间轴页面（数据源优先 runs_normalized.csv 真实运行记录）
    build_runs_gantt(rows, args.out)
    build_runs_stats(rows, args.out)
    build_run_detail(args.out)


def build_runs_stats(rows, out_dir):
    """生成运行记录统计分析页面（A 组）。
    总览卡 + 触发方式/状态饼图 + 星期×小时热力图 + 各机器人平均排队条形图 +
    机器人负载榜 + 失败记录看板（含 CSV 导出）。数据源同时间轴：runs_normalized.csv。"""
    seed = []
    runs_path = os.path.join(out_dir, "runs_normalized.csv")
    if os.path.exists(runs_path):
        with open(runs_path, "r", encoding="utf-8-sig") as f:
            run_rows = list(csv.DictReader(f))
        for r in run_rows:
            start = to_ms(r.get("start_time"))
            if start is None:
                continue
            seed.append({
                "id": file_safe_id(r.get("flow_id"), r.get("process_no")),
                "robot": r.get("bot_name") or "(未指定机器人)",
                "name": r.get("flow_name") or r.get("trigger_name") or "运行记录",
                "app": r.get("flow_name") or "",
                "trigger": r.get("trigger_name") or "",
                "start": start,
                "end": to_ms(r.get("end_time")),
                "status": r.get("status") or "",
                "execStart": to_ms(r.get("execution_start_time")),
                "way": r.get("start_way") or "",
            })
        seed.sort(key=lambda s: s["start"])
        data_desc = f"真实运行记录 {len(seed)} 条"
    else:
        data_desc = "无 runs_normalized.csv（未抓取运行记录）"
    gen = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    html = (STATS_HTML
            .replace("__SEED__", json.dumps(seed, ensure_ascii=False))
            .replace("__GEN__", gen))
    out_path = os.path.join(out_dir, "analysis.html")
    finalize_html(html, out_path)
    print(f"[+] 运行记录分析页已生成: {out_path}")
    print(f"    {data_desc}")


def js_json(obj):
    """JSON 转 JS 字面量并防止 </script> 提前闭合脚本标签。"""
    return json.dumps(obj, ensure_ascii=False).replace("</", r"<\/")


def build_run_detail(out_dir):
    """为每条运行记录生成独立详情页 detail_<id>.html。日志内容不再构建期内嵌，由详情页打开时通过本地服务器 /api/log 实时读取（避免 HTML 膨胀与内容过期）。"""
    # 先读取机器人→日志目录映射（缺失则用空对象，详情页会提示未配置）
    logmap = {}
    log_cfg = os.path.join(os.path.dirname(os.path.abspath(__file__)), "robot_logs.json")
    if os.path.exists(log_cfg):
        try:
            with open(log_cfg, "r", encoding="utf-8") as f:
                raw = json.load(f)
            for k, v in raw.items():
                if k.startswith("_"):
                    continue
                logmap[k] = v
        except Exception as e:
            print("[!] robot_logs.json 解析失败，日志目录映射为空：", e)

    # 旧版单文件详情页已废弃，清理避免误导
    old = os.path.join(out_dir, "detail.html")
    if os.path.exists(old):
        try:
            os.remove(old)
        except Exception:
            pass

    runs_path = os.path.join(out_dir, "runs_normalized.csv")
    if not os.path.exists(runs_path):
        print("[!] 未找到 runs_normalized.csv，跳过详情页生成")
        return
    with open(runs_path, "r", encoding="utf-8-sig") as f:
        run_rows = list(csv.DictReader(f))

    gen = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    illegals = set(chr(92) + '/:*?"<>|')
    total = 0
    for r in run_rows:
        start = to_ms(r.get("start_time"))
        if start is None:
            continue
        fid = r.get("flow_id") or ""
        pno = r.get("process_no") or ""
        robot = r.get("bot_name") or "(未指定机器人)"
        sid = file_safe_id(fid, pno)

        # 精确日志目录：共享根 + 北京日期(YYYYMMDD) + {HHMMSS}-{流程名}-{process_no}
        # 注意：runs_normalized.csv 的 start_time 为 UTC，日志目录以北京时间为准（差 8 小时）
        log_path, log_ok = "", None
        root = logmap.get(robot)
        st = r.get("start_time")
        if root and pno and st:
            try:
                bj = datetime.fromisoformat(str(st).replace("Z", "+00:00")).astimezone(BJT)
            except Exception:
                bj = None
            if bj is not None:
                date_folder = bj.strftime("%Y%m%d")
                hhmmss = bj.strftime("%H%M%S")
                flow = r.get("flow_name") or ""
                cand_names = ["%s-%s-%s" % (hhmmss, flow, pno),
                              "%s-%s-%s" % (hhmmss, "".join("_" if c in illegals else c for c in (flow or "")), pno)]
                for cn in cand_names:
                    p = os.path.join(root, date_folder, cn)
                    try:
                        if os.path.isdir(p):
                            log_path, log_ok = p, True
                            break
                    except Exception:
                        pass
                if not log_path:
                    log_path = os.path.join(root, date_folder, cand_names[0])
                    log_ok = False


        rec = {
            "id": sid,
            "fid": fid,
            "pno": pno,
            "robot": robot,
            "name": r.get("flow_name") or r.get("trigger_name") or "运行记录",
            "trigger": r.get("trigger_name") or "",
            "start": start,
            "end": to_ms(r.get("end_time")),
            "status": r.get("status") or "",
            "execStart": to_ms(r.get("execution_start_time")),
            "way": r.get("start_way") or "",
            "log": log_path,
            "logOk": log_ok,
        }
        html = (DETAIL_HTML
                .replace("__REC__", js_json(rec))
                .replace("__GEN__", gen))
        out_path = os.path.join(out_dir, "detail_%s.html" % sid)
        finalize_html(html, out_path)
        total += 1

    print(f"[+] 运行记录详情页已生成: {total} 个文件（detail_<id>.html），日志内容改为打开时由本地服务器实时读取")

if __name__ == "__main__":
    main()
