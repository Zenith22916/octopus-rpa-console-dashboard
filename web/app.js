/* ==================== 公共工具 ==================== */
var STATUS_CN = { Waiting: "排队中", Executing: "运行中", Finished: "已完成",
                  Failed: "失败", Stopped: "已停止" };
var WAY_CN = { Manual: "手动", TimingTrigger: "定时触发器", Webhook: "Webhook" };
function wayOf(r){ return WAY_CN[r.way] || r.way || "-"; }
function wayCN(w){ return WAY_CN[w] || w || "—"; }
function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function pad(n){ return String(n).padStart(2, "0"); }
function fmtTime(ms){ if(ms == null) return "-"; var d = new Date(ms); return (d.getMonth()+1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
function fmtFull(ms){ if (ms == null) return "—"; var d = new Date(ms); return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+" "+
                      pad(d.getHours())+":"+pad(d.getMinutes())+":"+pad(d.getSeconds()); }
function fmtDur(ms){ if (ms == null || ms < 0) return "—"; var s = Math.round(ms/1000); if (s < 60) return s + " 秒";
  var m = Math.floor(s/60), sec = s%60; if (m < 60) return m + " 分" + (sec? " "+sec+" 秒":"");
  var h = Math.floor(m/60), mm = m%60; return h + " 小时" + (mm? " "+mm+" 分":""); }
function fmtDurM(ms){ if (ms == null || isNaN(ms)) return "-"; var m = ms/60000; if(m < 1) return Math.round(ms/1000) + " 秒";
  if(m < 60) return m.toFixed(1) + " 分钟"; var h = Math.floor(m/60), mm = Math.round(m%60); return h + " 时" + (mm ? (" " + mm + " 分") : ""); }
function fmtSize(b){ if (b == null) return ""; if (b < 1024) return b + " B"; if (b < 1024*1024) return (b/1024).toFixed(1) + " KB"; return (b/1024/1024).toFixed(2) + " MB"; }
function statusColor(r){
  if (r.status === "Failed") return "rgba(226,75,74,0.6)";
  if (r.status === "Executing") return "rgba(239,159,39,0.6)";
  if (r.status === "Waiting") return "rgba(55,138,221,0.6)";
  if (r.status === "Stopped") return "rgba(95,94,90,0.6)";
  return "rgba(29,158,117,0.6)";
}
function statusBadge(st){
  var map = { Failed:["失败","rgba(226,75,74,0.18)","#E24B4A"],
             Executing:["运行中","rgba(239,159,39,0.18)","#EF9F27"],
             Waiting:["排队中","rgba(55,138,221,0.18)","#378ADD"],
             Stopped:["已停止","rgba(95,94,90,0.18)","#8b8f98"] };
  var m = map[st] || ["已完成","rgba(29,158,117,0.18)","#1D9E75"];
  return '<span class="badge" style="background:'+m[1]+';color:'+m[2]+'">'+m[0]+'</span>';
}
function getParam(name){
  var m = new RegExp("[?&]" + name + "=([^&]*)").exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
}

/* ==================== 全局状态 ==================== */
var RECORDS = [];          // /api/runs 返回的运行记录（时间轴 + 分析共用）
var DETAIL_REC = null;     // 当前详情记录
var SCHED = null;          // /api/schedule 数据
var curView = '';          // 当前视图：timeline/analysis/detail/schedule
var autoTimer = null;

if (location.protocol === "file:"){
  document.body.innerHTML = '<div class="tip" style="padding:40px;text-align:center;">⚠ 当前以 file:// 方式打开，浏览器禁止调用后端接口。请改用本地服务器：运行 start_server.bat，再打开 <a href="http://localhost:8000/">http://localhost:8000/</a></div>';
  throw new Error("file:// unsupported");
}

/* ==================== 数据加载 ==================== */
function api(url){
  return fetch(url, { credentials: 'same-origin' }).then(function(r){
    if (r.status === 401){ location.href = '/login'; throw new Error('unauthorized'); }
    return r.json();
  });
}
function loadRuns(){
  return api('/api/runs').then(function(d){
    if (d && Array.isArray(d.records)){ RECORDS = d.records; }
    if (d && d.time) document.getElementById('dataTime').textContent = '数据获取：' + d.time;
    return RECORDS;
  });
}
function loadRunDetail(id){
  return api('/api/run?id=' + encodeURIComponent(id)).then(function(d){
    DETAIL_REC = (d && d.ok && d.rec) ? d.rec : null;
    return DETAIL_REC;
  });
}
function loadSchedule(){
  return api('/api/schedule').then(function(d){
    if (d && d.ok) SCHED = d;
    return SCHED;
  });
}

/* ==================== 视图切换与路由 ==================== */
function showView(name){
  curView = name;
  var views = ['timeline', 'analysis', 'detail', 'schedule'];
  for (var i = 0; i < views.length; i++){
    var el = document.getElementById('view-' + views[i]);
    if (el) el.style.display = (views[i] === name) ? 'flex' : 'none';
  }
  var sel = document.getElementById('navSel');
  if (sel && ['timeline', 'analysis', 'schedule'].indexOf(name) >= 0){
    sel.value = '#/' + name;
  }
  // 标题栏指标卡按视图切换（时间轴 / 日程；分析页在页面内有自己的指标卡）
  var tlM = document.getElementById('tlMetrics'), scM = document.getElementById('scMetrics');
  if (tlM) tlM.style.display = (name === 'timeline') ? 'flex' : 'none';
  if (scM) scM.style.display = (name === 'schedule') ? 'flex' : 'none';
}
function parseHash(){
  var h = location.hash || '#/analysis';
  var m = h.match(/^#\/([a-z]+)(?:\?(.*))?$/i);
  var name = m ? m[1].toLowerCase() : 'analysis';
  if (['timeline', 'analysis', 'detail', 'schedule'].indexOf(name) < 0) name = 'analysis';
  return name;
}
var tlReady = false, anReady = false, scReady = false;
function route(){
  var name = parseHash();
  showView(name);
  if (name === 'timeline'){
    if (!tlReady){
      loadRuns().then(function(){ tlInit(); tlReady = true; });
    } else {
      tlResize();
    }
  } else if (name === 'analysis'){
    if (!anReady){
      loadRuns().then(function(){ anInit(); anReady = true; });
    } else {
      anResize();
    }
  } else if (name === 'detail'){
    var id = getParam('id');
    if (id){
      loadRunDetail(id).then(function(){ renderDetail(); });
    } else {
      DETAIL_REC = null; renderDetail();
    }
  } else if (name === 'schedule'){
    if (!scReady){
      loadSchedule().then(function(){ scInit(); scReady = true; });
    } else {
      scResize();
    }
  }
}
window.addEventListener('hashchange', route);
window.addEventListener('resize', function(){
  if (curView === 'timeline' && tlReady) tlChartResize();
  if (curView === 'analysis' && anReady) anResize();
  if (curView === 'schedule' && scReady) scResize();
});

/* ==================== 时间轴视图 ==================== */
var DEF_SPAN = 2 * 3600 * 1000;
var records = [];           // 时间轴工作副本（来自 RECORDS）
var robots = [];
var state = { span: DEF_SPAN, end: Date.now(), offset: 0 };
var DATA_MIN = Infinity, DATA_MAX = -Infinity;
var tlChart = null, chartEl = null;
var tlScrollTrackEl = null, tlScrollThumbEl = null;
function recomputeBounds(){
  DATA_MIN = Infinity; DATA_MAX = -Infinity;
  var nowT = Date.now();
  records.forEach(function(r){
    if (r.start < DATA_MIN) DATA_MIN = r.start;
    var e = r.end == null ? nowT : r.end;
    if (e > DATA_MAX) DATA_MAX = e;
  });
}
function robotList(segs){
  var arr = [];
  segs.forEach(function(s){
    var rb = s.r.robot;
    if (rb && rb !== "(未指定机器人)" && arr.indexOf(rb) < 0) arr.push(rb);
  });
  return arr.sort();
}
function buildSegs(){
  var segs = [];
  records.forEach(function(r){
    var st = r.start;
    var exec = (r.execStart && r.execStart > st) ? r.execStart : null;
    if (exec && exec - st >= 60*1000) segs.push({ r: r, start: st, end: exec, kind: 'wait' });
    segs.push({ r: r, start: exec || st, end: r.end, kind: 'run' });
  });
  return segs;
}
function segColor(s){ if (s.kind === 'wait') return 'rgba(55,138,221,0.6)'; return statusColor(s.r); }
var FONT_STACK = (function(){
  try { return getComputedStyle(document.body).fontFamily || 'sans-serif'; }
  catch(e){ return 'sans-serif'; }
})();
var _mc = (function(){
  try { var c = document.createElement('canvas').getContext('2d'); c.font = '500 20px ' + FONT_STACK; return c; }
  catch(e){ return null; }
})();
function measureW(s, fs){ if (!_mc) return s.length * 10; _mc.font = '500 ' + (fs || 20) + 'px ' + FONT_STACK; return _mc.measureText(s).width; }
// 大标题字号：与时间轴数据块文字保持一致（读取 .title 的 20px，CSS 改了这里也跟着变）
var TITLE_FS = (function(){
  try { var el = document.querySelector('.title'); if (el) return parseFloat(getComputedStyle(el).fontSize) || 20; } catch(e){}
  return 20;
})();
// 单行文字：放得下整串显示；放不下则截断并在末尾加 "..."
function truncateLabel(name, maxW, fs){
  if (!name) return '';
  if (maxW < 6) return '';                 // 太窄，连省略号都放不下
  if (measureW(name, fs) <= maxW) return name;
  var ell = '...', ellW = measureW(ell, fs), budget = maxW - ellW;
  if (budget <= 0) return '';
  var cur = '', curW = 0;
  for (var i = 0; i < name.length; i++){
    var cw = measureW(name[i], fs);
    if (curW + cw > budget) break;
    cur += name[i]; curW += cw;
  }
  return cur + ell;
}
function effEnd(s){ return s.end == null ? state.end : s.end; }
function layout(segs){
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
      else { if (st < lanes[lane].start) lanes[lane].start = st; if (en > lanes[lane].end) lanes[lane].end = en; }
      laneOfRec[ri] = lane;
    });
    if (lanes.length === 0) lanes.push({ start: state.end, end: state.end });
    var base = rowCursor;
    rowCursor += lanes.length;
    idxs.forEach(function(ri){
      var u = recs[ri];
      u.segIdxs.forEach(function(si){ info[si] = { row: base + laneOfRec[ri] }; });
    });
    for (var r = base; r < rowCursor; r++) yLabels.push(r === base ? rb : '');
    groupLastRows.push(base + lanes.length - 1);
  });
  layout.totalRows = rowCursor;
  layout.yLabels = yLabels;
  layout.groupLastRows = groupLastRows;
  return info;
}
function tlRender(){
  if (!tlChart) return;
  var nowW = Math.min(state.end + state.offset, state.end);
  var winStart = nowW - state.span;
  var segs = buildSegs();
  var waySel = document.getElementById('selWay').value;
  if (waySel !== '__ALL__') segs = segs.filter(function(s){ return s.r.way === waySel; });
  robots = robotList(segs);
  var visible = segs.filter(function(s){ return effEnd(s) >= winStart && s.start <= nowW; });
  var info = layout(visible);
  var yLabels = layout.yLabels;
  var lastRows = layout.groupLastRows || [];
  var topGroupRow = lastRows.length ? Math.max.apply(null, lastRows) : -1;
  var recMerge = {};
  visible.forEach(function(s){
    var rid = String(s.r.id);
    var m = recMerge[rid] || (recMerge[rid] = { min: Infinity, max: -Infinity });
    if (s.start < m.min) m.min = s.start;
    var en = effEnd(s);
    if (en > m.max) m.max = en;
  });
  var data = [];
  var textData = [];
  visible.forEach(function(s, i){
    var li = info[i];
    var rid = String(s.r.id);
    var merge = recMerge[rid];
    if (s.kind === 'run') {
      data.push({
        value: [merge.min, merge.max, li.row, 0, 1, segColor(s), s.r.execStart || 0, s.end == null ? 0 : s.end],
        rid: rid, name: s.r.name, app: s.r.app, robot: s.r.robot,
        status: s.r.status, kind: 'run', way: s.r.way,
        start: merge.min, end: merge.max,
        endRaw: s.end, execStart: s.r.execStart
      });
    }
    if (s.kind === 'run' && s.r.name) {
      textData.push({ value: [(merge.min + merge.max) / 2, li.row, s.r.name, merge.min, merge.max] });
    }
  });
  var sepData = [];
  lastRows.forEach(function(r){ if (r !== topGroupRow) sepData.push({ value: [r] }); });
  var recIds = {};
  visible.forEach(function(s){ recIds[s.r.id] = 1; });
  var recCount = Object.keys(recIds).length;
  tlChart.setOption({
    backgroundColor: 'transparent',
    animation: false,
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
        var gLeft = api.coord([nowW - state.span, row])[0];
        var gRight = api.coord([nowW, row])[0];
        var x = Math.max(x0, gLeft);
        var xEnd = Math.min(x1, gRight);
        var w = xEnd - x;
        var band = api.size([0, 1])[1];
        var children = [];
        if (w >= 2) {
          var bh = Math.max(10, band - 4);
          var exec = api.value(6);
          var hasWait = exec && exec > api.value(0);
          if (hasWait) {
            var wxs = Math.max(api.coord([api.value(0), row])[0], gLeft);
            var wxe = Math.min(api.coord([exec, row])[0], gRight);
            var qw = wxe - wxs;
            if (qw >= 2) {
              children.push({ type: 'rect', shape: { x: wxs, y: y - bh / 2, width: qw, height: bh },
                              style: { fill: 'rgba(55,138,221,0.6)' } });
            }
          }
          var rs = hasWait ? exec : api.value(0);
          var rxs = Math.max(api.coord([rs, row])[0], gLeft);
          var rxe = Math.min(api.coord([api.value(1), row])[0], gRight);
          var rw = rxe - rxs;
          if (rw >= 2) {
            children.push({ type: 'rect', shape: { x: rxs, y: y - bh / 2, width: rw, height: bh },
                            style: { fill: api.value(5) } });
          }
          children.push({ type: 'rect', shape: { x: x, y: y - bh / 2, width: w, height: bh },
                          style: { fill: 'rgba(0,0,0,0)', stroke: 'rgba(255, 255, 255, 0.5)', lineWidth: 1.5, cursor: 'pointer' } });
        }
        if (!children.length) return null;
        return children.length === 1 ? children[0] : { type: 'group', children: children };
      },
      markLine: { silent: true, symbol: 'none', lineStyle: { color: '#E24B4A', width: 2 },
        label: { show: true, formatter: '现在', color: '#E24B4A', fontSize: 10, position: 'insideEndTop' },
        data: [{ xAxis: state.end }] }
    }, {
      type: 'custom', data: textData, zlevel: 2, silent: true,
      renderItem: function(params, api){
        var row = api.value(1);
        var mStart = api.value(3);
        var mEnd = api.value(4) == null ? nowW : api.value(4);
        var vStart = Math.max(mStart, nowW - state.span);
        var vEnd = Math.min(mEnd, nowW);
        if (vEnd <= vStart) return null;
        var vc = (vStart + vEnd) / 2;
        var cx = api.coord([vc, row])[0];
        var y = api.coord([vc, row])[1];
        var wTotal = Math.abs(api.coord([vEnd, row])[0] - api.coord([vStart, row])[0]);
        // 数据块文字：单行、字号与大标题一致、居中、放不下截断加 "..."、少于 8 字不显示
        var fs = TITLE_FS;
        var label = truncateLabel(api.value(2), Math.max(2, wTotal - 4), fs);
        if (!label || label.length < 8) return null;
        return { type: 'text', style: { text: label, x: cx, y: y, textAlign: 'center',
                 textVerticalAlign: 'middle', fill: '#10141a', fontSize: fs,
                 fontWeight: 500, fontFamily: FONT_STACK } };
      }
    }, {
      type: 'custom', data: sepData, zlevel: 1, silent: true,
      renderItem: function(params, api){
        var row = api.value(0);
        var c0 = api.coord([nowW - state.span, row]);
        var yc = c0[1];
        var band = api.size([0, 1])[1];
        var gLeft = api.coord([nowW - state.span, row])[0];
        var gRight = api.coord([nowW, row])[0];
        var ly = yc - band / 2;
        return { type: 'line', shape: { x1: gLeft, y1: ly, x2: gRight, y2: ly },
                 style: { stroke: 'rgba(255,255,255,0.65)', lineWidth: 1.5, lineDash: [6, 4] } };
      }
    }]
  }, { lazyUpdate: true });
  // 窗口内可见记录按触发方式计数（同一记录排队+运行两段去重）
  var wayRecs = { Manual: 0, TimingTrigger: 0, Webhook: 0 };
  var seenW = {};
  visible.forEach(function(s){
    var wk = s.r.id + '_' + s.r.way;
    if (!seenW[wk] && wayRecs[s.r.way] != null){ seenW[wk] = 1; wayRecs[s.r.way]++; }
  });
  document.getElementById('mTotal').textContent = wayRecs.Webhook;
  document.getElementById('mManual').textContent = wayRecs.Manual;
  document.getElementById('mTiming').textContent = wayRecs.TimingTrigger;
  document.getElementById('mRobots').textContent = robots.length;
  tlScrollSync();
}
function tlScrollSync(){
  if (!tlScrollTrackEl || !tlScrollThumbEl) return;
  var total = state.end - DATA_MIN;
  if (!(total > 0)) { tlScrollThumbEl.style.display = 'none'; return; }
  tlScrollThumbEl.style.display = 'block';
  var tW = tlScrollTrackEl.clientWidth || 1;
  var nowW = Math.min(state.end + state.offset, state.end);
  var w = Math.max(36, Math.min(tW, state.span / total * tW));
  var frac = (nowW - DATA_MIN) / total;
  var left = Math.max(0, Math.min(tW - w, frac * tW - w));
  tlScrollThumbEl.style.width = w + 'px';
  tlScrollThumbEl.style.left = left + 'px';
}
function tlUpdateWindow(){ if (curView === 'timeline') tlRender(); }
function tlResize(){ if (tlChart) tlChart.resize(); }
function tlChartResize(){ if (tlChart) tlChart.resize(); }
function tlInit(){
  records = RECORDS.slice();
  recomputeBounds();
  chartEl = document.getElementById('chart');
  if (!chartEl) return;
  if (tlChart) { try { tlChart.dispose(); } catch(e){} }
  tlChart = echarts.init(chartEl);
  chartEl.addEventListener('wheel', function(e){
    e.preventDefault();
    state.offset += e.deltaY * (state.span / 600);
    var nowT = Date.now();
    var offMin = DATA_MIN - nowT;
    var offMax = 0;
    state.offset = Math.min(offMax, Math.max(offMin, state.offset));
    tlUpdateWindow();
  }, { passive: false });
  document.getElementById('selSpan').onchange = function(){
    state.span = parseInt(this.value, 10);
    state.offset = 0;
    tlUpdateWindow();
  };
  document.getElementById('selWay').onchange = function(){
    state.offset = 0;
    tlUpdateWindow();
  };
  chartEl.addEventListener('dblclick', function(){
    state.offset = 0;
    state.span = parseInt(document.getElementById('selSpan').value, 10);
    tlUpdateWindow();
  });
  // 横向滚动条：拖动（触屏/鼠标）浏览时间轴，映射到 state.offset，与滚轮/双击一致
  tlScrollTrackEl = document.getElementById('tlScrollTrack');
  tlScrollThumbEl = document.getElementById('tlScrollThumb');
  if (tlScrollTrackEl && tlScrollThumbEl) {
    var dragging = false, startX = 0, startOffset = 0;
    function pxPerMs(){
      var total = (state.end - DATA_MIN) || 1;
      var tW = tlScrollTrackEl.clientWidth || 1;
      return tW / total;
    }
    function clampOffset(o){
      var nowT = Date.now();
      return Math.max(DATA_MIN - nowT, Math.min(0, o));
    }
    tlScrollThumbEl.addEventListener('pointerdown', function(e){
      dragging = true;
      startX = e.clientX;
      startOffset = state.offset;
      try { tlScrollThumbEl.setPointerCapture(e.pointerId); } catch(err){}
      e.preventDefault();
    });
    tlScrollThumbEl.addEventListener('pointermove', function(e){
      if (!dragging) return;
      var dMs = (e.clientX - startX) / pxPerMs();
      state.offset = clampOffset(startOffset + dMs);
      tlUpdateWindow();
    });
    function stopDrag(){ dragging = false; }
    tlScrollThumbEl.addEventListener('pointerup', stopDrag);
    tlScrollThumbEl.addEventListener('pointercancel', stopDrag);
    tlScrollTrackEl.addEventListener('click', function(e){
      if (e.target === tlScrollThumbEl) return;
      var rect = tlScrollTrackEl.getBoundingClientRect();
      var frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
      var nowT = Date.now();
      var targetEnd = DATA_MIN + frac * (state.end - DATA_MIN);
      state.offset = clampOffset(targetEnd - nowT);
      tlUpdateWindow();
    });
  }
  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  function showToast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove('show'); }, 2200);
  }
  tlChart.on('click', function(params){
    if (params && params.data && params.data.rid) {
      if (params.data.status === 'Executing') {
        showToast('任务「' + (params.data.name || '运行中') + '」正在运行中，暂不可查看明细');
        return;
      }
      location.hash = '#/detail?id=' + encodeURIComponent(params.data.rid);
    }
  });
  tlRender();
}
setInterval(function(){ if (curView === 'timeline'){ state.end = Date.now(); tlRender(); } }, 200);

/* ==================== 分析视图 ==================== */
var anCharts = {};
function anInit(){
  if (!RECORDS.length) return;
  anCharts.pie = echarts.init(document.getElementById('pie'));
  anCharts.statusPie = echarts.init(document.getElementById('statusPie'));
  anCharts.waitBar = echarts.init(document.getElementById('waitBar'));
  anCharts.heat = echarts.init(document.getElementById('heat'));
  anRenderAll(RECORDS);
  document.getElementById('btnExport').onclick = anExport;
}
function anResize(){ for (var k in anCharts) if (anCharts[k]) anCharts[k].resize(); }
function anRenderAll(recs){
  var now = Date.now();
  var total = 0, finished = 0, failed = 0, running = 0, stopped = 0, waiting = 0;
  var waitSum = 0, waitN = 0, runSum = 0, runN = 0, maxRun = 0;
  var events = [];
  var byRobot = {}, byWay = {}, statusCount = {};
  var heat = []; for (var w = 0; w < 7; w++){ heat.push(new Array(24).fill(0)); }
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
  anMetrics(total, finished, failed, running, avgWait, avgRun, maxRun, peak, waitN, runN);
  anPie(byWay);
  anStatus(statusCount);
  anWaitBar(byRobot);
  anHeat(heat);
  anRobotTbl(byRobot);
  anFailTbl(recs);
}
function anCard(k, v, s, color){
  return '<div class="metric"><div class="k">' + k + '</div><div class="v"' + (color ? ' style="color:' + color + '"' : '') + '>' + v + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>';
}
function anMetrics(total, finished, failed, running, avgWait, avgRun, maxRun, peak, waitN, runN){
  var sr = (finished + failed) ? finished / (finished + failed) : 0;
  var html = '';
  html += anCard('总运行数', total, '最近 7 天');
  html += anCard('成功率', (sr*100).toFixed(1) + '%', '成功 ' + finished + ' / 结果 ' + (finished + failed));
  html += anCard('失败数', failed, '失败率 ' + (total ? (failed/total*100).toFixed(1) : 0) + '%', failed ? '#E24B4A' : '');
  html += anCard('运行中', running, '');
  html += anCard('平均排队', fmtDurM(avgWait), waitN + ' 条有排队');
  html += anCard('平均运行', fmtDurM(avgRun), runN + ' 条已完成');
  html += anCard('最长单次', fmtDurM(maxRun), '');
  html += anCard('并发峰值', peak, '同时运行最多');
  document.getElementById('metrics').innerHTML = html;
}
function anPie(byWay){
  var data = Object.keys(byWay).map(function(k){ return {name: wayCN(k), value: byWay[k]}; });
  anCharts.pie.setOption({
    tooltip:{trigger:'item', confine:true, formatter:'{b}: {c} ({d}%)'},
    legend:{bottom:0, textStyle:{color:'#8b8f98'}},
    series:[{type:'pie', radius:['42%','68%'], center:['50%','46%'], label:{color:'#e6e6e6', formatter:'{b}\n{d}%'}, data:data}]
  });
}
function anStatus(sc){
  var SC = { Waiting: 'rgba(55,138,221,0.9)', Executing: 'rgba(239,159,39,0.9)', Finished: 'rgba(29,158,117,0.9)', Failed: 'rgba(226,75,74,0.9)', Stopped: 'rgba(95,94,90,0.9)' };
  var data = Object.keys(sc).map(function(k){ return {name: STATUS_CN[k] || k, value: sc[k], itemStyle:{color: SC[k] || '#888'}}; });
  data.sort(function(a, b){ return b.value - a.value; });
  anCharts.statusPie.setOption({
    tooltip:{trigger:'item', confine:true, formatter:'{b}: {c} ({d}%)'},
    legend:{bottom:0, textStyle:{color:'#8b8f98'}},
    series:[{type:'pie', radius:['42%','68%'], center:['50%','46%'], label:{color:'#e6e6e6', formatter:'{b}\n{d}%'}, data:data}]
  });
}
function anWaitBar(byRobot){
  var arr = Object.keys(byRobot).map(function(k){ var u = byRobot[k]; return {robot:u.robot, avg: u.waitN ? u.waitSum / u.waitN : 0}; }).sort(function(a, b){ return b.avg - a.avg; });
  anCharts.waitBar.setOption({
    grid:{left:130, right:40, top:10, bottom:24},
    tooltip:{trigger:'axis', confine:true, formatter:function(p){ return p[0].name + '：' + fmtDurM(p[0].value); }},
    xAxis:{type:'value', axisLabel:{color:'#8b8f98', formatter:function(v){ return (v/60000).toFixed(0) + '分'; }}, splitLine:{lineStyle:{color:'#20242c'}}},
    yAxis:{type:'category', data:arr.map(function(d){ return d.robot; }), axisLabel:{color:'#c9cdd4'}, inverse:true},
    series:[{type:'bar', data:arr.map(function(d){ return d.avg; }), itemStyle:{color:'#378ADD'}, barWidth:'55%'}]
  });
}
function anHeat(heat){
  var days = ['一','二','三','四','五','六','日'];
  var data = [], maxV = 0;
  for(var w = 0; w < 7; w++) for(var h = 0; h < 24; h++){ var v = heat[w][h]; if(v > maxV) maxV = v; data.push([h, w, v]); }
  anCharts.heat.setOption({
    tooltip:{position:'top', confine:true, formatter:function(p){ return '周' + days[p.value[1]] + ' ' + pad(p.value[0]) + '时：' + p.value[2] + ' 次'; }},
    grid:{left:46, right:20, top:10, bottom:54},
    xAxis:{type:'category', data:Array.from({length:24}, function(_, i){ return i; }), axisLabel:{color:'#8b8f98'}, splitArea:{show:true}},
    yAxis:{type:'category', data:days.map(function(d){ return '周' + d; }), axisLabel:{color:'#c9cdd4'}},
    visualMap:{min:0, max:(maxV || 1), calculable:true, orient:'horizontal', left:'center', bottom:0, textStyle:{color:'#8b8f98'}, inRange:{color:['#181b21','#378ADD','#EF9F27','#E24B4A']}},
    series:[{type:'heatmap', data:data, label:{show:false}, emphasis:{itemStyle:{borderColor:'#fff', borderWidth:1}}}]
  });
}
function anRobotTbl(byRobot){
  var rows = Object.keys(byRobot).map(function(k){ return byRobot[k]; }).sort(function(a, b){ return b.count - a.count; });
  var html = '<thead><tr><th>机器人</th><th>记录数</th><th>失败</th><th>失败率</th><th>平均排队</th><th>平均运行</th></tr></thead><tbody>';
  rows.forEach(function(u){
    var fr = u.count ? u.failed / u.count * 100 : 0;
    html += '<tr><td>' + esc(u.robot) + '</td><td>' + u.count + '</td><td>' + u.failed + '</td>' +
      '<td' + (fr >= 20 ? ' style="color:#E24B4A"' : '') + '>' + fr.toFixed(0) + '%</td>' +
      '<td>' + fmtDurM(u.waitN ? u.waitSum / u.waitN : 0) + '</td>' +
      '<td>' + fmtDurM(u.runN ? u.runSum / u.runN : 0) + '</td></tr>';
  });
  html += '</tbody>';
  document.getElementById('robotTbl').innerHTML = html;
}
function anFailTbl(recs){
  var fails = recs.filter(function(r){ return r.status === 'Failed'; });
  var html = '<thead><tr><th>开始时间</th><th>机器人</th><th>应用</th><th>触发方式</th><th>流程编号</th></tr></thead><tbody>';
  fails.forEach(function(r){
    html += '<tr><td>' + fmtTime(r.start) + '</td><td>' + esc(r.robot) + '</td><td>' + esc(r.name || r.app) + '</td><td>' + wayCN(r.way) + '</td><td>' + esc(r.id || '') + '</td></tr>';
  });
  html += '</tbody>';
  document.getElementById('failTbl').innerHTML = html;
  document.getElementById('failCount').textContent = '共 ' + fails.length + ' 条失败';
  window.__fails = fails;
}
function anExport(){
  var fails = window.__fails || [];
  if(!fails.length){ alert('没有失败记录'); return; }
  var head = ['开始时间','机器人','应用','触发方式','流程编号','状态'];
  var lines = [head.join(',')];
  fails.forEach(function(r){
    var row = [fmtTime(r.start), r.robot, r.name || r.app, wayCN(r.way), r.id || '', '失败'];
    lines.push(row.map(function(x){ return '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"'; }).join(','));
  });
  var blob = new Blob(['\ufeff' + lines.join('\n')], {type:'text/csv;charset=utf-8'});
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = '失败运行记录_' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
}

/* ==================== 详情视图 ==================== */
function fld(k, v){ return '<div class="field"><div class="k">'+k+'</div><div class="v">'+v+'</div></div>'; }
function renderDetail(){
  var app = document.getElementById("app");
  var rec = DETAIL_REC;
  if (!rec){
    app.innerHTML = '<div class="empty">未找到该运行记录。</div>';
    return;
  }
  document.getElementById("ttl").textContent = rec.name || "运行记录";
  var queueMs = (rec.execStart && rec.execStart > rec.start) ? (rec.execStart - rec.start) : 0;
  var runFrom = (rec.execStart && rec.execStart > rec.start) ? rec.execStart : rec.start;
  var runMs = (rec.end == null) ? null : (rec.end - runFrom);
  var info = '<div class="card info-card"><h3>基础信息</h3><div class="grid-detail">'
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
  var logCard = '<div class="card log-card">'
    + '<div class="log-head"><h3>日志内容</h3>'
    +   '<div class="log-tools">'
    +     '<span class="stat" id="logStat">—</span>'
    +     '<input class="find" id="logFind" type="search" placeholder="搜索关键词" disabled>'
    +     '<button class="chip" id="btnPrev" disabled>上一处</button>'
    +     '<button class="chip" id="btnNext" disabled>下一处</button>'
    +     '<button class="chip" id="btnOnlyErr" disabled>仅看异常</button>'
    +   '</div>'
    + '</div>'
    + '<div class="log-body">'
    +   '<div id="logbox" class="tip">正在读取日志…</div>'
    +   '<div class="minimap" id="minimap" hidden title="拖动可快速定位日志">'
    +     '<canvas id="mmcanvas"></canvas><div class="mm-viewport" id="mmviewport"></div>'
    +   '</div>'
    + '</div></div>';
  app.innerHTML = '<div class="detail-wrap">' + info + logCard + '</div>';
  mmInit();
  lgInit();
  loadLogs();
}
/* 日志缩略图（仿 VSCode minimap） */
var MM = { box:null, mm:null, cv:null, vp:null, drag:false, grab:0, raf:0, vraf:0, sig:"", h:0, stop:false, ticks:[], mctx:null };
var MM_COLORS = ["#4d5666", "#FF4D4F", "#FFB020", "#2A7F62"];
var MM_RE = /(error|exception|traceback|fail(?:ed)?|fatal|失败|错误|异常|中断|中止)|(warn(?:ing)?|timeout|retry|警告|超时|重试)|(success(?:ful)?|succeed|done|finish(?:ed)?|成功|完成)/gi;
var MM_EXC = /(已启用异常监控|触发错误处理的|忽略异常并执行)/;
var MM_TICK_W = 11;
var MM_WA = null, MM_WO = null;
var MM_CAT = null;
function mmCharW(ctx, code){
  var w;
  if (code < 128){
    if (!MM_WA){ MM_WA = new Float32Array(128); }
    w = MM_WA[code];
    if (!w){ w = MM_WA[code] = ctx.measureText(String.fromCharCode(code)).width || 6; }
    return w;
  }
  if (!MM_WO) MM_WO = {};
  w = MM_WO[code];
  if (w === undefined || !w){ w = MM_WO[code] = ctx.measureText(String.fromCharCode(code)).width || 12; }
  return w;
}
function mmFillCats(line){
  var n = line.length, i, m, ch;
  if (!MM_CAT || MM_CAT.length < n) MM_CAT = new Int8Array(Math.max(2048, n + 256));
  var buf = MM_CAT;
  for (i = 0; i < n; i++){
    ch = line.charAt(i);
    buf[i] = (ch === " " || ch === "\t" || ch === "\r") ? -1 : 0;
  }
  if (n > 20000) return buf;
  if (MM_EXC.test(line)) return buf;
  MM_RE.lastIndex = 0;
  while ((m = MM_RE.exec(line)) !== null){
    var c = m[1] ? 1 : (m[2] ? 2 : 3);
    var e0 = m.index + m[0].length;
    for (i = m.index; i < e0; i++){ if (buf[i] >= 0) buf[i] = c; }
  }
  return buf;
}
function mmCtx(){
  if (!MM.mctx){ MM.mctx = document.createElement("canvas").getContext("2d"); }
  return MM.mctx;
}
function mmLineLevel(line){
  if (!line || line.length > 20000) return 0;
  if (MM_EXC.test(line)) return 0;
  var lv = 0, m;
  MM_RE.lastIndex = 0;
  while ((m = MM_RE.exec(line)) !== null){
    var c = m[1] ? 1 : (m[2] ? 2 : 3);
    if (c === 1) return 1;
    if (lv === 0 || c < lv) lv = c;
  }
  return lv;
}
function mmEachLine(pre, ctx, cb){
  var tn = pre.firstChild;
  if (!tn || tn.nodeType !== 3) return 0;
  var text = tn.nodeValue || "";
  if (!text) return 0;
  var cs = window.getComputedStyle(pre);
  var padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
  var contentW = pre.clientWidth - padL - padR;
  if (contentW <= 0) return 0;
  var fs = parseFloat(cs.fontSize) || 12.5;
  var lh = parseFloat(cs.lineHeight);
  if (!lh || lh < 1) lh = fs * 1.6;
  ctx.font = (cs.fontStyle || "normal") + " " + (cs.fontWeight || "400") + " " + fs + "px " + (cs.fontFamily || "monospace");
  var y = 0, n = text.length, i = 0, lineNo = 0;
  while (i < n){
    var nl = text.indexOf("\n", i);
    var end = (nl === -1) ? n : nl;
    var line = text.slice(i, end);
    var j = 0, segStart = 0, acc = 0, L = line.length;
    while (j <= L){
      if (j === L || (acc > 0 && acc + mmCharW(ctx, line.charCodeAt(j)) > contentW)){
        if (cb(line, segStart, j, y, lh, lineNo, j === L) === false) return y;
        y += lh;
        if (j === L) break;
        segStart = j; acc = 0;
      }
      acc += mmCharW(ctx, line.charCodeAt(j));
      j++;
    }
    i = end + 1; lineNo++;
    if (nl === -1) break;
  }
  return y;
}
function mmDrawPre(ctx, pre, contentTop, scale, W, drawn){
  if (MM.stop || !pre.offsetParent) return drawn;
  var cs = window.getComputedStyle(pre);
  var padT = parseFloat(cs.paddingTop) || 0;
  var base = (pre.getBoundingClientRect().top + padT) - contentTop;
  var H = MM.h, tickW = MM_TICK_W;
  var lrows = pre.querySelectorAll(".lrow");
  if (lrows.length){
    for (var r0 = 0; r0 < lrows.length; r0++){
      var r = lrows[r0];
      var h = Math.max(1, r.offsetHeight * scale);
      var yDoc = base + r.offsetTop;
      var yy = yDoc * scale;
      if (yy > H + h){ MM.stop = true; return drawn; }
      var lv = parseInt(r.getAttribute("data-level") || "0", 10);
      if (yy + h > 0 && lv > 0 && lv < MM_COLORS.length){
        ctx.fillStyle = MM_COLORS[lv];
        ctx.fillRect(0, yy, W - tickW, h);
      }
      if (lv === 1 || lv === 2) MM.ticks.push({ y: yDoc, h: r.offsetHeight, lv: lv });
      drawn++;
    }
    return drawn;
  }
  mmEachLine(pre, ctx, function(line, s, e, y, lh){
    var rowH = Math.max(1, lh * scale);
    var yDoc = base + y;
    var yy = yDoc * scale;
    if (yy > H + rowH){ MM.stop = true; return false; }
    var cats = mmFillCats(line.slice(s, e));
    var kx = W / (pre.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0));
    var tiny = rowH < 2;
    var x = 0, runCat = -2, runX0 = 0, best = -1, minX = 1e9, maxX = 0, k, c, w;
    for (k = s; k < e; k++){
      c = (k - s) < cats.length ? cats[k - s] : 0;
      w = mmCharW(ctx, line.charCodeAt(k));
      if (c >= 0){
        if (best < 0 || (c > 0 && c < best)) best = c;
        if (x < minX) minX = x;
        if (x + w > maxX) maxX = x + w;
      }
      if (!tiny && c !== runCat){
        if (runCat >= 0 && x > runX0){
          ctx.fillStyle = MM_COLORS[runCat];
          ctx.fillRect(runX0 * kx, yy, Math.max((x - runX0) * kx, 0.7), rowH);
        }
        runCat = c; runX0 = x;
      }
      x += w;
    }
    if (yy + rowH > 0){
      if (best === 1 || best === 2){
        ctx.fillStyle = MM_COLORS[best];
        ctx.fillRect(0, yy, W - tickW, Math.max(rowH, 2));
      } else if (!tiny && runCat >= 0 && x > runX0){
        ctx.fillStyle = MM_COLORS[runCat];
        ctx.fillRect(runX0 * kx, yy, Math.max((x - runX0) * kx, 0.7), rowH);
      } else if (tiny && best >= 0 && maxX > minX && minX * kx < W - tickW){
        ctx.fillStyle = MM_COLORS[best];
        ctx.fillRect(minX * kx, yy, Math.min(Math.max((maxX - minX) * kx, 0.8), W - tickW - minX * kx), rowH);
      }
    }
    if (best === 1 || best === 2) MM.ticks.push({ y: yDoc, h: lh, lv: best });
    drawn++;
    return true;
  });
  return drawn;
}
function mmDrawTicks(ctx, W, H, scale){
  var tw = MM_TICK_W;
  ctx.fillStyle = "#0a0c10";
  ctx.fillRect(W - tw, 0, tw, H);
  ctx.fillStyle = "#232830";
  ctx.fillRect(W - tw, 0, 0.5, H);
  for (var i = 0; i < MM.ticks.length; i++){
    var t = MM.ticks[i], y = t.y * scale;
    if (y > H || y + t.h * scale < 0) continue;
    ctx.fillStyle = t.lv === 1 ? "#FF4D4F" : "#FFB020";
    ctx.fillRect(W - tw + 1.5, y, tw - 3, Math.max(2.5, t.h * scale));
  }
}
function mmBuild(){
  var box = MM.box, mm = MM.mm, cv = MM.cv;
  if (!box || !mm || !cv) return;
  var sig = box.clientWidth + "x" + box.clientHeight + "x" + box.scrollHeight + "|" + (mm.hidden ? 1 : 0);
  if (sig === MM.sig) return;
  MM.sig = sig;
  var docH = box.scrollHeight, viewH = box.clientHeight;
  if (!docH || docH <= viewH + 4){ if (!mm.hidden) { mm.hidden = true; MM.sig = ""; } return; }
  mm.hidden = false;
  var W = mm.clientWidth, H = mm.clientHeight;
  if (W <= 0 || H <= 0) return;
  MM.h = H;
  var dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.style.width = W + "px"; cv.style.height = H + "px";
  var ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  var scale = H / docH;
  var boxRect = box.getBoundingClientRect();
  var contentTop = boxRect.top - box.scrollTop;
  var pres = box.querySelectorAll("pre"), drawn = 0;
  MM.stop = false; MM.ticks = [];
  for (var i = 0; i < pres.length; i++) drawn = mmDrawPre(ctx, pres[i], contentTop, scale, W, drawn);
  mmDrawTicks(ctx, W, H, scale);
  mmSync();
}
function mmSync(){
  var box = MM.box, mm = MM.mm, vp = MM.vp;
  if (!box || !mm || !vp || mm.hidden) return;
  var docH = box.scrollHeight, viewH = box.clientHeight, H = mm.clientHeight;
  if (!docH || !H) return;
  var scale = H / docH;
  var h = Math.max(6, Math.min(H, viewH * scale));
  var top = box.scrollTop * scale;
  if (top + h > H) top = Math.max(0, H - h);
  vp.style.top = top + "px";
  vp.style.height = h + "px";
}
function mmSchedule(force){ if (force) MM.sig = ""; if (MM.raf) return; MM.raf = requestAnimationFrame(function(){ MM.raf = 0; mmBuild(); }); }
function mmGo(clientY){
  var box = MM.box, mm = MM.mm;
  if (!box || !mm || mm.hidden) return;
  var r = mm.getBoundingClientRect(), H = mm.clientHeight || 1;
  var docH = box.scrollHeight, viewH = box.clientHeight, scale = docH / H;
  var y = Math.max(0, Math.min(H, clientY - r.top));
  box.scrollTop = Math.max(0, Math.min(docH - viewH, y * scale - MM.grab));
}
function mmDown(e){
  if (!MM.box || !MM.mm || MM.mm.hidden) return;
  var r = MM.mm.getBoundingClientRect(), H = MM.mm.clientHeight || 1;
  var docH = MM.box.scrollHeight, viewH = MM.box.clientHeight, scale = docH / H;
  var docY = (e.clientY - r.top) * scale;
  MM.grab = (docY >= MM.box.scrollTop && docY <= MM.box.scrollTop + viewH) ? (docY - MM.box.scrollTop) : viewH / 2;
  MM.drag = true;
  MM.mm.classList.add("mm-drag");
  if (e.pointerId != null && MM.mm.setPointerCapture) { try { MM.mm.setPointerCapture(e.pointerId); } catch(err){} }
  mmGo(e.clientY);
  e.preventDefault();
}
function mmMove(e){ if (MM.drag) mmGo(e.clientY); }
function mmUp(){
  if (!MM.drag) return;
  MM.drag = false;
  if (MM.mm) MM.mm.classList.remove("mm-drag");
}
function mmInit(){
  MM.box = document.getElementById("logbox");
  MM.mm  = document.getElementById("minimap");
  MM.cv  = document.getElementById("mmcanvas");
  MM.vp  = document.getElementById("mmviewport");
  if (!MM.box || !MM.mm) return;
  MM.box.addEventListener("scroll", function(){
    if (MM.vraf) return;
    MM.vraf = requestAnimationFrame(function(){ MM.vraf = 0; mmSync(); });
  }, { passive: true });
  MM.mm.addEventListener("pointerdown", mmDown);
  window.addEventListener("pointermove", mmMove);
  window.addEventListener("pointerup", mmUp);
  window.addEventListener("pointercancel", mmUp);
  window.addEventListener("resize", function(){ MM.sig = ""; mmSchedule(); });
  if (window.ResizeObserver){
    new ResizeObserver(function(){ MM.sig = ""; mmSchedule(); }).observe(MM.box);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ MM.sig = ""; mmSchedule(); });
  mmSchedule();
}
/* 日志排查辅助 */
var LG = { files: [], marks: [], cur: -1, only: false, kw: "" };
function lgPadTop(pre){ return parseFloat(window.getComputedStyle(pre).paddingTop) || 0; }
function lgAnalyze(){
  var box = MM.box;
  if (!box) return;
  var pres = box.querySelectorAll("pre"), ctx = mmCtx();
  LG.marks = [];
  for (var i = 0; i < pres.length; i++){
    var pre = pres[i];
    if (!pre.offsetParent) continue;
    var lrows = pre.querySelectorAll(".lrow");
    if (lrows.length){
      for (var j = 0; j < lrows.length; j++){
        var r = lrows[j];
        var lv = parseInt(r.getAttribute("data-level") || "0", 10);
        if (lv === 1 || lv === 2){
          var noEl = r.querySelector(".lno");
          LG.marks.push({ pre: pre, y: r.offsetTop, h: r.offsetHeight, lv: lv, no: noEl ? parseInt(noEl.textContent, 10) : 0, text: r.textContent.slice(0, 200) });
        }
      }
      continue;
    }
    (function(el){
      var startY = 0, lv = 0, no = 0, open = false;
      mmEachLine(el, ctx, function(line, s, e, y, lh, lineNo, last){
        if (s === 0){ startY = y; lv = mmLineLevel(line); no = lineNo; open = (lv === 1 || lv === 2); }
        if (open && last) LG.marks.push({ pre: el, y: startY + lgPadTop(el), h: (y + lh) - startY, lv: lv, no: no + 1, text: line.slice(0, 200) });
        return true;
      });
    })(pre);
  }
  lgRenderMarks();
  lgStat();
}
function lgRenderMarks(){
  var box = MM.box;
  if (!box) return;
  var pres = box.querySelectorAll("pre"), i, old;
  for (i = 0; i < pres.length; i++){
    old = pres[i].querySelector(".lnmarks");
    if (old) old.parentNode.removeChild(old);
  }
  for (i = 0; i < LG.marks.length; i++){
    var m = LG.marks[i];
    var layer = m.pre.querySelector(".lnmarks");
    if (!layer){ layer = document.createElement("div"); layer.className = "lnmarks"; m.pre.appendChild(layer); }
    var d = document.createElement("div");
    d.className = "lm " + (m.lv === 1 ? "lm-err" : "lm-warn");
    d.title = "第 " + m.no + " 行：" + m.text;
    d.style.top = m.y + "px";
    d.style.height = m.h + "px";
    d.setAttribute("data-mi", String(i));
    layer.appendChild(d);
  }
  LG.cur = -1;
}
function lgReset(){
  LG.files = []; LG.marks = []; LG.cur = -1; LG.only = false; LG.kw = "";
  var el = document.getElementById("logStat");
  if (el){ el.textContent = "—"; el.removeAttribute("title"); }
  var ids = ["btnPrev", "btnNext", "btnOnlyErr", "logFind"], b, i;
  for (i = 0; i < ids.length; i++){
    b = document.getElementById(ids[i]);
    if (b){ b.disabled = true; if (ids[i] === "btnOnlyErr"){ b.className = "chip"; b.textContent = "仅看异常"; } }
  }
  var f = document.getElementById("logFind");
  if (f) f.value = "";
}
function lgStat(){
  var el = document.getElementById("logStat"), i, e = 0, w = 0;
  for (i = 0; i < LG.marks.length; i++){ if (LG.marks[i].lv === 1) e++; else w++; }
  if (el) el.innerHTML = LG.marks.length
    ? ('共 <b>' + LG.marks.length + '</b> 处 · 错误 <b class="s-err">' + e + '</b> · 警告 <b class="s-warn">' + w + '</b>')
    : '未发现异常';
  var has = LG.marks.length > 0;
  var b;
  b = document.getElementById("btnPrev"); if (b) b.disabled = !has;
  b = document.getElementById("btnNext"); if (b) b.disabled = !has;
  b = document.getElementById("btnOnlyErr"); if (b) b.disabled = !has;
  b = document.getElementById("logFind"); if (b) b.disabled = false;
}
function lgGoTo(idx){
  var box = MM.box;
  if (!box || !LG.marks.length) return;
  if (idx < 0) idx = LG.marks.length - 1;
  if (idx >= LG.marks.length) idx = 0;
  LG.cur = idx;
  var m = LG.marks[idx];
  var boxRect = box.getBoundingClientRect(), preRect = m.pre.getBoundingClientRect();
  var top = (preRect.top - boxRect.top) + box.scrollTop + lgPadTop(m.pre) + m.y - box.clientHeight / 2;
  box.scrollTop = Math.max(0, top);
  var all = box.querySelectorAll(".lnmarks .lm"), i;
  for (i = 0; i < all.length; i++) all[i].className = all[i].className.replace(" lm-cur", "");
  var layer = m.pre.querySelector(".lnmarks");
  if (layer){
    var d = layer.querySelector('[data-mi="' + idx + '"]');
    if (d) d.className += " lm-cur";
  }
  var stat = document.getElementById("logStat");
  if (stat) stat.setAttribute("title", "第 " + (idx + 1) + "/" + LG.marks.length + " 处 · 第 " + m.no + " 行");
}
function lgHL(s, kw){
  if (!kw) return s;
  var k = esc(kw), out = "", p = 0, idx;
  if (!k) return s;
  while ((idx = s.indexOf(k, p)) !== -1){
    out += s.slice(p, idx) + "<mark>" + k + "</mark>";
    p = idx + k.length;
  }
  return out + s.slice(p);
}
function lgFilterHTML(text, kw, only){
  var lines = text.split("\n");
  var hit = {}, keep = {}, i, j, n = 0;
  for (i = 0; i < lines.length; i++){
    var lv = mmLineLevel(lines[i]);
    var isHit = (only && (lv === 1 || lv === 2)) || (!!kw && lines[i].indexOf(kw) !== -1);
    if (isHit){
      hit[i] = (lv === 1 || lv === 2) ? lv : 0;
      n++;
      if (n > 3000) break;
    }
  }
  if (!n) return '<span class="lrow" style="color:#8b8f98">没有匹配的行</span>';
  for (var key in hit){
    var k0 = Number(key);
    for (j = Math.max(0, k0 - 2); j <= Math.min(lines.length - 1, k0 + 2); j++) keep[j] = 1;
  }
  var keys = [], h = "", last = -1;
  for (var k2 in keep) keys.push(Number(k2));
  keys.sort(function(a, b){ return a - b; });
  for (i = 0; i < keys.length; i++){
    var k = keys[i];
    if (last >= 0 && k > last + 1) h += '<span class="lrow" style="color:#5a5f6a">    …</span>';
    var isH = Object.prototype.hasOwnProperty.call(hit, k);
    var lv = isH ? (hit[k] || 0) : 0;
    var cls = "lrow" + (isH ? (" " + (hit[k] ? "hit" : "hitkw")) : "");
    h += '<span class="' + cls + '" data-level="' + lv + '"><span class="lno">' + (k + 1) + '</span>' + lgHL(esc(lines[k]), kw) + '</span>';
    last = k;
  }
  return h;
}
function lgApply(){
  var box = MM.box;
  if (!box) return;
  var pres = box.querySelectorAll("pre");
  for (var i = 0; i < pres.length; i++){
    var orig = (LG.files[i] && LG.files[i].content != null) ? LG.files[i].content : pres[i].textContent;
    if (!LG.only && !LG.kw) pres[i].textContent = orig;
    else pres[i].innerHTML = lgFilterHTML(orig, LG.kw, LG.only);
  }
  LG.cur = -1;
  mmSchedule(true);
  lgAnalyze();
}
function lgInit(){
  var b, f;
  b = document.getElementById("btnNext");
  if (b) b.addEventListener("click", function(){ lgGoTo(LG.cur + 1); });
  b = document.getElementById("btnPrev");
  if (b) b.addEventListener("click", function(){ lgGoTo(LG.cur - 1); });
  b = document.getElementById("btnOnlyErr");
  if (b) b.addEventListener("click", function(){
    LG.only = !LG.only;
    this.className = LG.only ? "chip on" : "chip";
    this.textContent = LG.only ? "显示全部" : "仅看异常";
    lgApply();
  });
  f = document.getElementById("logFind");
  if (f){
    var timer = 0;
    f.addEventListener("input", function(){
      var v = this.value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function(){ LG.kw = v.trim(); lgApply(); }, 300);
    });
    f.addEventListener("keydown", function(e){
      if (e.key === "Enter"){ lgGoTo(LG.cur + (e.shiftKey ? -1 : 1)); e.preventDefault(); }
    });
  }
}
var LOG_PAGE = 2000;
var LOG_FILES = [];
function loadLogs(){
  var box = document.getElementById("logbox");
  if (!box) return;
  if (!DETAIL_REC.log){
    box.innerHTML = '<div class="tip">未配置该机器人的日志目录，无法确定日志路径。请在 robot_logs.json 中补充该机器人的共享日志目录（参考其他机器人配置）。</div>';
    mmSchedule(true); lgReset();
    return;
  }
  var url = "/api/log?dir=" + encodeURIComponent(DETAIL_REC.log);
  box.innerHTML = '<div class="tip">正在读取日志目录…</div>';
  fetch(url, { credentials: 'same-origin' }).then(function(r){ if (r.status === 401){ location.href = '/login'; return; } return r.json(); }).then(function(d){
    if (!d.ok){
      box.innerHTML = '<div class="warn">⚠ 读取日志失败：'+esc(d.error || "未知错误")+'</div>';
      mmSchedule(true); lgReset();
      return;
    }
    if (!d.logs || d.logs.length === 0){
      box.innerHTML = '<div class="tip">目录下没有 .log 文件。</div>';
      mmSchedule(true); lgReset();
      return;
    }
    LOG_FILES = [];
    var h = "";
    for (var i=0;i<d.logs.length;i++){
      var lf = d.logs[i];
      LOG_FILES.push({ name: lf.name, size: lf.size, total: lf.lines || 0, loaded: 0, content: "", open: true });
      var moreTxt = lf.lines ? (' · 共 '+lf.lines+' 行') : '';
      h += '<div class="logfile" data-fi="'+i+'">'
        + '<div class="lf-head">'
        + '<span class="lf-name">📄 '+esc(lf.name)+'</span>'
        + '<span class="lf-meta">'+fmtSize(lf.size)+moreTxt+'</span>'
        + '</div>'
        + '<div class="lf-body">'
        + '<pre id="lf'+i+'"></pre>'
        + '<div class="lf-more" data-fi="'+i+'" style="display:none"><button class="btn-more" type="button">加载更多</button></div>'
        + '</div>'
        + '</div>';
    }
    box.innerHTML = h;
    LG.files = [];
    for (var k=0;k<LOG_FILES.length;k++) LG.files.push({ content: "" });
    var mores = box.querySelectorAll(".lf-more");
    for (var m=0;m<mores.length;m++){
      (function(el){
        el.addEventListener("click", function(e){
          e.stopPropagation();
          var fi = parseInt(el.getAttribute("data-fi"), 10);
          loadLogPage(fi, LOG_FILES[fi].loaded);
        });
      })(mores[m]);
    }
    mmSchedule(true);
    for (var i2=0;i2<LOG_FILES.length;i2++){
      loadLogPage(i2, 0);
    }
  }).catch(function(e){
    box.innerHTML = '<div class="warn">⚠ 无法连接本地服务器（'+(e && e.message ? e.message : e)+'）。请确认 start_server.bat 正在运行。</div>';
    mmSchedule(true); lgReset();
  });
}
function loadLogPage(fi, offset){
  var f = LOG_FILES[fi];
  if (!f) return;
  var moreEl = document.querySelector('.logfile[data-fi="'+fi+'"] .lf-more');
  var btn = moreEl ? moreEl.querySelector(".btn-more") : null;
  if (btn){ btn.disabled = true; btn.textContent = "加载中…"; }
  var url = "/api/log?dir=" + encodeURIComponent(DETAIL_REC.log)
          + "&file=" + encodeURIComponent(f.name)
          + "&offset=" + offset + "&limit=" + LOG_PAGE;
  fetch(url, { credentials: 'same-origin' }).then(function(r){ if (r.status === 401){ location.href = '/login'; return; } return r.json(); }).then(function(d){
    if (!d.ok){
      if (btn){ btn.disabled = false; btn.textContent = "加载失败，点击重试"; }
      return;
    }
    if (offset === 0) f.content = "";
    if (d.content) f.content += (f.content ? "\n" : "") + d.content;
    f.loaded = offset + (d.lines || 0);
    LG.files[fi].content = f.content;
    if (moreEl) moreEl.style.display = (d.hasMore && f.open) ? "block" : "none";
    if (btn){
      btn.disabled = false;
      btn.textContent = d.hasMore ? ("加载更多（剩 " + Math.max(0, f.total - f.loaded) + " 行）") : "已全部加载";
    }
    lgApply();
  }).catch(function(){
    if (btn){ btn.disabled = false; btn.textContent = "加载失败，点击重试"; }
  });
}

/* ==================== 日程视图 ==================== */
var WEEK_LABELS = ["周一","周二","周三","周四","周五","周六","周日"];
var scChart = null, scEl = null;
var lastRowInfo = [], lastTimes = [], scView = 'week', scFilter = '__ALL__', scStatus = 'enabled';
function scTimeText(t){
  var hh = Math.floor(t), mm = Math.round((t - hh) * 60);
  return String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0');
}
function scMatchRobot(r, filter) {
  if (filter === '__ALL__') return true;
  if (filter === '__SUXI__') return r.indexOf('硕晞') >= 0;
  if (filter === '__BAOSHI__') return r.indexOf('宝实') >= 0;
  return r === filter;
}
function scBuildPoints(view, robot, status){
  var pts = [];
  var src = view === 'week' ? SCHED.week : SCHED.month;
  Object.keys(src).forEach(function(r){
    if (!scMatchRobot(r, robot)) return;
    Object.keys(src[r]).forEach(function(k){
      var xi = view === 'week' ? +k : SCHED.monthLabels.indexOf(k + '日');
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
function scTimeToY(t, rowInfo, times){
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
function scUpdateLines(){
  if (curView !== 'schedule' || !scChart) return;
  var now = new Date();
  var t = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  var y = scTimeToY(t, lastRowInfo, lastTimes);
  var xIdx = scView === 'month'
    ? SCHED.monthLabels.indexOf(now.getDate() + '日')
    : (now.getDay() + 6) % 7;
  var lineData = [];
  if (y !== null) lineData.push({ yAxis: y, name: 'now' });
  if (xIdx >= 0) lineData.push({ xAxis: xIdx });
  if (!lineData.length) return;
  scChart.setOption({
    series: [{ markLine: { silent: true, symbol: 'none',
      lineStyle: { color: '#E24B4A', width: 2 },
      label: { formatter: function(p){ return p.data.name === 'now' ? scTimeText(t) : ''; },
               color: '#E24B4A', fontSize: 11, position: 'insideEndTop' },
      data: lineData } }]
  });
}
function scRender(view, filter, status) {
  scView = view;
  var xLabels = view === 'week' ? WEEK_LABELS : SCHED.monthLabels;
  var isMonth = view === 'month';
  var pts = scBuildPoints(view, filter, status);
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
          var labels = scView === 'month' ? SCHED.monthLabels : WEEK_LABELS;
          var range = m.x0 === m.x1 ? labels[m.x0] : (labels[m.x0] + ' - ' + labels[m.x1]);
          var robots = [];
          m.items.forEach(function(it){
            var label = it.enabled ? it.robot : it.robot + '（停用）';
            if (robots.indexOf(label) < 0) robots.push(label);
          });
          return '<b>' + m.app + '</b><br/>' + range + ' ' + scTimeText(m.t) + '<br/>' + robots.join('、');
        } }
      });
    });
  });
  scChart.setOption({
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
                            return best !== null ? scTimeText(best) : '';
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
  scUpdateLines();
}
function scFillSelect(id, options, onChange) {
  var sel = document.getElementById(id);
  sel.innerHTML = '';
  options.forEach(function(o){
    var op = document.createElement('option');
    op.value = o[0]; op.textContent = o[1];
    sel.appendChild(op);
  });
  sel.addEventListener('change', function(){ onChange(sel.value); });
}
function scResize(){ if (scChart) scChart.resize(); }
function scInit(){
  if (!SCHED || !SCHED.ok) return;
  document.getElementById('sTotal').textContent = SCHED.stats.total;
  document.getElementById('sEnabled').textContent = SCHED.stats.enabled;
  document.getElementById('sDisabled').textContent = SCHED.stats.disabled;
  document.getElementById('sWebhook').textContent = SCHED.stats.webhook;
  scEl = document.getElementById('c1');
  if (scChart) { try { scChart.dispose(); } catch(e){} }
  scChart = echarts.init(scEl);
  scFillSelect('selView', [['week', '每周'], ['month', '每月']], function(v){ scRender(v, scFilter, scStatus); });
  scFillSelect('selRobot',
    [['__ALL__', '全部机器人'], ['__SUXI__', '所有硕晞'], ['__BAOSHI__', '所有宝实']]
      .concat(SCHED.robots.slice().sort().map(function(r){ return [r, r]; })),
    function(v){ scFilter = v; scRender(scView, v, scStatus); });
  scFillSelect('selStatus', [['enabled', '已启用'], ['disabled', '已停用'], ['__ALL__', '全部状态']],
    function(v){ scStatus = v; scRender(scView, scFilter, v); });
  scRender('week', '__ALL__', 'enabled');
}
setInterval(scUpdateLines, 10000);

/* ==================== 自动更新 ==================== */
function refreshData(force, done){
  fetch((force ? '/api/refresh?force=1' : '/api/refresh'), { method: 'POST', credentials: 'same-origin' }).then(function(r){
    if (r.status === 401){ location.href = '/login'; return; }
    return r.json();
  }).then(function(d){
    var warnEl = document.getElementById('refreshWarn');
    var okFlag = false;
    if (d && d.ok && Array.isArray(d.records)) {
      okFlag = true;
      if (warnEl) warnEl.style.display = 'none';
      RECORDS = d.records;
      if (curView === 'timeline'){ records = RECORDS.slice(); recomputeBounds(); tlRender(); }
      else if (curView === 'analysis' && anReady) anRenderAll(RECORDS);
      if (d.time) document.getElementById('dataTime').textContent = '数据获取：' + d.time;
    } else if (warnEl) {
      warnEl.style.display = 'block';
      if (d && d.time) document.getElementById('dataTime').textContent = '数据获取：' + d.time + '（刷新失败）';
    }
    if (done) done(okFlag);
  }).catch(function(){ if (done) done(false); });
}
document.getElementById('btnRefreshNow').addEventListener('click', function(){
  var btn = this;
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = '更新中…';
  refreshData(true, function(ok){
    btn.textContent = ok ? '✓ 已更新' : '✗ 失败';
    setTimeout(function(){ btn.textContent = '立刻更新'; btn.disabled = false; }, 2000);
  });
});
document.getElementById('chkAuto').addEventListener('change', function(){
  if (this.checked) {
    refreshData();
    if (!autoTimer) autoTimer = setInterval(refreshData, 60000);
  } else {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  }
});
document.getElementById('btnBack').addEventListener('click', function(){ location.hash = '#/timeline'; });
document.getElementById('btnRerun').addEventListener('click', function(){
  var rec = DETAIL_REC;
  if (!rec || !rec.fid) { alert('该记录缺少流程 ID，无法重新运行'); return; }
  var name = rec.name || rec.fid;
  if (!confirm('确认重新运行应用「' + name + '」？\n将立即触发一次执行。')) return;
  fetch('/api/rerun', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flow_id: rec.fid })
  })
  .then(function(r){ return r.json(); })
  .then(function(j){
    if (j.ok) {
      var msg = '已触发重新运行，批次号：' + (j.flowProcessNo || '—');
      if (j.botId) msg += '\n执行机器人：' + j.botId.replace(/^.*_/, '');
      msg += '\n任务已进入队列，可返回时间轴查看实时状态。';
      alert(msg);
      if (typeof refreshData === 'function') refreshData();
    } else {
      alert('重新运行失败：' + (j.message || j.error || '未知错误'));
    }
  })
  .catch(function(e){ alert('请求失败：' + e); });
});
document.getElementById('navSel').addEventListener('change', function(){ location.hash = this.value; });
if (document.getElementById('chkAuto').checked) {
  refreshData();
  if (!autoTimer) autoTimer = setInterval(refreshData, 60000);
}

/* ==================== 启动 ==================== */
route();

