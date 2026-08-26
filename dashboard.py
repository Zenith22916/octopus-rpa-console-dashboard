# -*- coding: utf-8 -*-
"""
生成 RPA 触发器日程仪表盘（ECharts HTML）
==========================================
读取 crawler 产出的 triggers_normalized.csv，生成 output/dashboard.html：
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
"""
import argparse
import calendar
import csv
import json
import os
import re
from collections import OrderedDict
from datetime import date, datetime

# 深色背景下的 12 色配色（同应用同色，按出现顺序分配）
PALETTE = [
    "#1D9E75", "#378ADD", "#D85A30", "#7F77DD", "#E24B4A", "#EF9F27",
    "#1FB8B8", "#B86FE8", "#97C459", "#F0997B", "#5DCAA5", "#ED93B1",
]


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
        days = list(cal["weeklyData"].get("dayOfWeeks") or [])
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="output/triggers_normalized.csv")
    ap.add_argument("--out", default="output")
    args = ap.parse_args()

    with open(args.input, "r", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

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
        color = PALETTE[list(app_order.keys()).index(r["app_name"]) % len(PALETTE)] if en else "#5F5E5A"
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
<title>RPA 触发器日程仪表盘</title>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
<style>
  html, body { height: 100%; }
  body { margin: 0; padding: 10px 14px; box-sizing: border-box;
         font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
         background: #0f1115; color: #e6e6e6;
         display: flex; flex-direction: column; overflow: hidden; }
  h1 { font-size: 18px; font-weight: 500; margin: 0 0 2px; }
  .sub { color: #8b8f98; font-size: 12px; }
  .head { display: flex; align-items: center; justify-content: space-between;
          gap: 12px; margin-bottom: 10px; flex-wrap: wrap; flex: none; }
  .metrics { display: flex; gap: 10px; flex-wrap: wrap; }
  .metric { flex: 1 1 0; min-width: 84px; background: #181b21; border: 1px solid #262a33;
            border-radius: 8px; padding: 6px 14px; text-align: center; }
  .metric .k { font-size: 11px; color: #8b8f98; }
  .metric .v { font-size: 18px; font-weight: 500; line-height: 1.25; }
  .panels { flex: 1; min-height: 0; display: flex; }
  .panel { flex: 1; min-height: 0; display: flex; flex-direction: column;
           background: #181b21; border: 1px solid #262a33; border-radius: 10px; padding: 10px 14px; }
  .panel h2 { font-size: 13px; font-weight: 500; margin: 0 0 8px; color: #c9cdd4; flex: none; }
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
<div class="head">
  <div>
    <h1>RPA 触发器日程仪表盘</h1>
    <div class="sub">八爪鱼RPA企业控制台 · 仅显示启用触发器 · __GEN__</div>
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
    <h2>日程时间轴 <select id="selView"></select><select id="selRobot"></select><select id="selStatus"></select></h2>
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
                          textFill: '#0f1115', fontSize: 10, fontWeight: 500,
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
render('week', '__ALL__', 'enabled');
</script>
</body>
</html>"""

    gen = datetime.now().strftime("%Y-%m-%d %H:%M")
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

    out_path = os.path.join(args.out, "dashboard.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    week_pts = sum(len(p) for rb in robots.values() for p in [rb["week"]])
    month_pts = sum(len(p) for rb in robots.values() for p in [rb["month"]])
    print(f"[+] 仪表盘已生成: {out_path}")
    print(f"    月视图({year}年{month}月): 有任务日期 {len(month_labels)} 天")
    print(f"    周视图任务点: {week_pts} 个 / 月视图任务点: {month_pts} 个")


if __name__ == "__main__":
    main()
