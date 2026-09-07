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
  var views = ['timeline', 'analysis', 'detail', 'schedule', 'projects'];
  for (var i = 0; i < views.length; i++){
    var el = document.getElementById('view-' + views[i]);
    if (el) el.style.display = (views[i] === name) ? 'flex' : 'none';
  }
  // 离开详情页时释放 Monaco 日志编辑器（模型与实例随详情重建，避免常驻占内存）
  if (name !== 'detail' && typeof lgReset === 'function') lgReset();
  if (['timeline', 'analysis', 'schedule', 'projects'].indexOf(name) >= 0) navSet(name);
  // 标题栏指标卡按视图切换（时间轴 / 日程；分析页在页面内有自己的指标卡）
  var tlM = document.getElementById('tlMetrics'), scM = document.getElementById('scMetrics');
  if (tlM) tlM.style.display = (name === 'timeline') ? 'flex' : 'none';
  if (scM) scM.style.display = (name === 'schedule') ? 'flex' : 'none';
  // 自动更新开关只在时间轴/分析页显示（自动更新仅抓运行记录，排期页走「立刻更新」全量抓）
  var autoCtl = document.getElementById('autoCtl');
  if (autoCtl) autoCtl.style.display = (name === 'timeline' || name === 'analysis') ? 'flex' : 'none';
}
function navSet(name){
  /* 同步悬停菜单：标题按钮文本 + 当前项高亮 */
  var hash = '#/' + name;
  var btn = document.getElementById('navMenuBtn');
  var items = document.querySelectorAll('.navmenu-list li');
  var label = null;
  for (var i = 0; i < items.length; i++){
    if (items[i].getAttribute('data-hash') === hash){
      label = items[i].textContent;
      items[i].classList.add('cur');
    } else {
      items[i].classList.remove('cur');
    }
  }
  if (btn && label) btn.textContent = label;
}
function parseHash(){
  var h = location.hash || '#/analysis';
  var m = h.match(/^#\/([a-z]+)(?:\?(.*))?$/i);
  var name = m ? m[1].toLowerCase() : 'analysis';
  if (['timeline', 'analysis', 'detail', 'schedule', 'projects'].indexOf(name) < 0) name = 'analysis';
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
      loadSchedule().then(function(){ scReload(); });   // 数据可能在别处被刷新过：进入时同步最新
    }
  } else if (name === 'projects'){
    pjPendingFid = getParam('fid');   // 带 ?fid= 进入时选中对应项目（无则 null）
    if (!pjReady){ pjInit(); pjReady = true; }
    else { pjLoad(); }
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
if (window.innerWidth < window.innerHeight){
  DEF_SPAN = 6 * 3600 * 1000;   // 窄高窗口（宽<高）默认拉长时间窗：横向内容更舒展，配合底部滚动条浏览
}
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
  var qEl = document.getElementById('chkQueue');
  var showQueue = qEl ? qEl.checked : true;
  if (!showQueue) segs = segs.filter(function(s){ return s.kind !== 'wait'; });   // 关闭排队：去掉排队段，布局/泳道按运行段计算
  var lgQueue = document.getElementById('lgQueue');
  if (lgQueue) lgQueue.style.display = showQueue ? '' : 'none';
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
          if (hasWait && showQueue) {
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
  var chkQueue = document.getElementById('chkQueue');
  if (chkQueue) chkQueue.onchange = function(){ tlUpdateWindow(); };
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
  tlChart.on('click', function(params){
    if (params && params.data && params.data.rid) {
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
  if (typeof lgReset === "function") lgReset();   // 释放上一个详情的 Monaco 编辑器与模型
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
    + '<div class="log-tabs" id="logTabs"></div>'
    + '<div class="log-body">'
    +   '<div id="logbox" class="tip">正在读取日志…</div>'
    + '</div></div>';
  app.innerHTML = '<div class="detail-wrap">' + info + logCard + '</div>';
  lgInit();
  loadLogs();
}
/* ==================== 日志查看（Monaco 只读编辑器，VSCode 同款高亮） ==================== */
var LOG_PAGE = 5000;
var LOG_FILES = [];   // [{name,size,total,loaded,content,hasMore,pending}]
var LOGM = {
  ready: null,          // Monaco 加载 Promise（脚本只加载一次，跨详情复用）
  langOK: false,        // 自定义 log 语言/主题已注册
  editor: null,         // Monaco 编辑器实例（每次详情重建）
  models: [],           // 每个 .log 文件一个 model
  decos: [],            // 每个 model 的装饰句柄 {marks:[],hits:[]}
  fileMarks: [],        // 每个 model 的异常行 [{line,lv}]
  matches: [],          // 当前文件的关键词匹配结果
  cur: -1, kw: "", only: false, active: 0
};

function ensureMonaco(){
  if (LOGM.ready) return LOGM.ready;
  LOGM.ready = new Promise(function(resolve, reject){
    if (!window.require){ reject(new Error("loader 未加载")); return; }
    require.config({ paths: { vs: "/monaco/vs" } });
    require(["vs/editor/editor.main"], function(){
      resolve(window.monaco);
    }, function(err){ reject(err); });
  });
  return LOGM.ready;
}

function logSetupLanguage(monaco){
  if (LOGM.langOK) return;
  LOGM.langOK = true;
  monaco.languages.register({ id: "log" });
  monaco.languages.setMonarchTokensProvider("log", {
    ignoreCase: true,
    tokenizer: {
      root: [
        // 行首级别（八爪鱼日志固定格式："级别 时间戳 【子流程】第N行【指令】：内容"）
        [/^错误(?=\s)/, "level-error"],
        [/^(?:警告|告警)(?=\s)/, "level-warn"],
        [/^消息(?=\s)/, "level-muted"],
        // 时间戳：2026-09-03 15:31:11 / 2026-09-03T15:31:11.123 / 15:31:11 / 2026-08-14 09:29:14,033
        [/\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?/, "timestamp"],
        [/\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?/, "timestamp"],
        // 子流程名 / 指令类型：八爪鱼用中文方括号，靠后文「第N行」区分（容许「中第6行」这类插入字）
        [/【[^】\n]{1,40}】(?=[^】\n]{0,2}第\d+行)/, "flow"],
        [/【[^】\n]{1,40}】/, "step"],
        // 方括号内的级别词：[ERROR] [WARN] [INFO]...
        [/\[(?:fatal|exception|critical|error|失败|错误|异常|中止|中断)\]/, "level-error"],
        [/\[(?:warn(?:ing)?|警告|超时|重试)\]/, "level-warn"],
        [/\[(?:info|debug|trace|成功|完成)\]/, "level-info"],
        // 其余方括号标签（排除含引号/逗号的列表，让列表元素各自着色）
        [/\[[^\[\]\n'",]{1,48}\]/, "tag"],
        // 无害短语：含级别词但不是异常，先吃掉，避免误标红/黄（与行级别判定的排除表一致）
        [/已启用异常监控|触发错误处理的|忽略异常并执行|异常监控|异常处理|重试中|已启用异常/, "source"],
        // 裸级别词
        [/\b(?:fatal|exception|critical)\b|\berror\b/, "level-error"],
        [/\bwarn(?:ing)?\b/, "level-warn"],
        [/\b(?:info|debug|trace)\b/, "level-info"],
        // 超时细分：加载/连接超时算错误，其余算警告
        [/(?:页面|元素|网页)?加载超时|连接超时|未找到(?:页面)?元素/, "level-error"],
        [/失败|错误|异常|中止|中断/, "level-error"],
        [/警告|重试|超时(?![[\[0-9])/, "level-warn"],
        [/成功|完成/, "level-info"],
        // 字典键名：'key': / "key":（对齐 VSCode JSON 的浅蓝键名）
        [/'(?:[^'\\\n]|\\.)*'(?=\s*:)/, "dict-key"],
        [/"(?:[^"\\\n]|\\.)*"(?=\s*:)/, "dict-key"],
        // 字符串值（含字典值、列表元素）
        [/'(?:[^'\\\n]|\\.)*'/, "string"],
        [/"(?:[^"\\\n]|\\.)*"/, "string"],
        // 变量名：「生成变量 XXX : …」中的 XXX
        // 注意 Monarch 会把规则编译成 ^(?:…) 在当前位置匹配，后顾断言 (?<=…) 一律失效，只能靠捕获组
        [/(生成变量)(\s+)([^:：\n]{1,60}?)(?=\s*[:：])/, ["", "", "variable"]],
        // 文件路径：UNC（\\SX-01\Logs\…）或盘符（E:\硕晞发货计划\…）；惰性匹配到空白/标点前，避免吞掉句尾标点
        [/\\\\[^\s"'|*<>?]*?(?=[\s,，。;；)）】]|$)|[A-Za-z]:\\[^\s"'|<>?]*?(?=[\s,，。;；)）】]|$)/, "path"],
        // 布尔/空值关键字（JSON/Python 字典常见）
        [/\b(?:true|false|null|none)\b/, "keyword"],
        // 花括号/方括号：短列表、字典边界；超出标签规则长度的长列表也落到这里
        [/[{}]/, "brace"],
        [/[\[\]]/, "bracket"],
        [/https?:\/\/[^\s"']+/, "url"],
        [/\b\d+(?:\.\d+)?\b/, "number"]
      ]
    }
  });
  monaco.editor.defineTheme("rpa-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "level-error", foreground: "FF6B6D", fontStyle: "bold" },
      { token: "level-warn", foreground: "FFB020" },
      { token: "level-info", foreground: "4EC98C" },
      { token: "level-muted", foreground: "6E7681" },
      { token: "timestamp", foreground: "8A93A6" },
      { token: "flow", foreground: "6FB3D2" },
      { token: "step", foreground: "4EC9B0" },
      { token: "variable", foreground: "9CDCFE" },
      { token: "tag", foreground: "6FB3D2" },
      { token: "url", foreground: "4A90D9" },
      { token: "path", foreground: "7AA6C2" },
      { token: "dict-key", foreground: "9CDCFE" },
      { token: "string", foreground: "CE9178" },
      { token: "keyword", foreground: "569CD6" },
      { token: "brace", foreground: "8A93A6" },
      { token: "bracket", foreground: "8A93A6" },
      { token: "number", foreground: "C8D3E0" }
    ],
    colors: {
      "editor.background": "#0b0d11",
      "editor.foreground": "#cdd3da",
      "editorLineNumber.foreground": "#4a5160",
      "editorLineNumber.activeForeground": "#8b93a3",
      "editor.lineHighlightBackground": "#131720",
      "editor.selectionBackground": "#264f78",
      "minimap.background": "#0b0d11"
    }
  });
}

function logEditorCreate(){
  var host = document.getElementById("logbox");
  if (!host) return Promise.reject(new Error("logbox 不存在"));
  return ensureMonaco().then(function(monaco){
    if (!LOGM.editor){
      logSetupLanguage(monaco);
      LOGM.editor = monaco.editor.create(host, {
        language: "log",
        theme: "rpa-dark",
        readOnly: true,
        automaticLayout: true,
        fontFamily: "Consolas, 'Microsoft YaHei', monospace",
        fontSize: 12.5,
        lineHeight: 20,
        minimap: { enabled: true, renderCharacters: false, maxColumn: 150 },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        contextmenu: false,
        folding: false,
        renderLineHighlight: "line",
        occurrencesHighlight: false,
        selectionHighlight: false,
        lineNumbersMinChars: 4,
        overviewRulerLanes: 2,
        stickyScroll: { enabled: false },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false }
      });
    }
    return monaco;
  });
}

/* ---- 行级别判定（沿用手写规则：0 普通 / 1 错误 / 2 警告 / 3 成功） ---- */
var LG_RE = /(error|exception|traceback|fail(?:ed)?|fatal|失败|错误|异常|中断|中止)|(warn(?:ing)?|timeout|retry|警告|重试|超时(?![[\[0-9]))|(success(?:ful)?|succeed|done|finish(?:ed)?|成功|完成)/gi;
var LG_EXC = /(已启用异常监控|触发错误处理的|忽略异常并执行)/;
function lgLineLevel(line){
  if (!line || line.length > 20000) return 0;
  if (LG_EXC.test(line)) return 0;
  var lv = 0, m;
  LG_RE.lastIndex = 0;
  while ((m = LG_RE.exec(line)) !== null){
    var c = m[1] ? 1 : (m[2] ? 2 : 3);
    if (c === 1) return 1;
    if (lv === 0 || c < lv) lv = c;
  }
  return lv;
}

/* ---- 模型同步：首页 setValue，后续增量 append（不重置滚动位置） ---- */
function logSyncModel(fi, offset, delta){
  var monaco = window.monaco;
  var f = LOG_FILES[fi];
  if (!monaco || !f) return;
  var m = LOGM.models[fi];
  if (!m){
    m = LOGM.models[fi] = monaco.editor.createModel(f.content, "log");
    LOGM.decos[fi] = { marks: [], hits: [] };
  } else if (offset === 0){
    m.setValue(f.content);
  } else if (delta){
    var last = m.getLineCount();
    var col = m.getLineMaxColumn(last);
    m.applyEdits([{
      range: new monaco.Range(last, col, last, col),
      text: (last > 1 || col > 1 ? "\n" : "") + delta,
      forceMoveMarkers: true
    }]);
  }
  lgScanMarks(fi);
  lgApplyMarkDecos(fi);
  if (LOGM.active === fi && LOGM.editor && LOGM.editor.getModel() !== m){
    LOGM.editor.setModel(m);
    logApplyHits();
  }
}

function lgScanMarks(fi){
  var m = LOGM.models[fi];
  if (!m){ LOGM.fileMarks[fi] = []; return; }
  var marks = [], lc = m.getLineCount();
  for (var i = 1; i <= lc; i++){
    var lv = lgLineLevel(m.getLineContent(i));
    if (lv === 1 || lv === 2) marks.push({ line: i, lv: lv });
  }
  LOGM.fileMarks[fi] = marks;
}

function lgApplyMarkDecos(fi){
  var monaco = window.monaco;
  var m = LOGM.models[fi];
  if (!m || !monaco) return;
  var d = LOGM.decos[fi] || (LOGM.decos[fi] = { marks: [], hits: [] });
  var opts = [], marks = LOGM.fileMarks[fi] || [];
  for (var i = 0; i < marks.length; i++){
    var mk = marks[i];
    opts.push({
      range: new monaco.Range(mk.line, 1, mk.line, 1),
      options: {
        isWholeLine: true,
        className: mk.lv === 1 ? "lg-line-err" : "lg-line-warn",
        linesDecorationsClassName: mk.lv === 1 ? "lg-glyph-err" : "lg-glyph-warn",
        overviewRuler: { color: mk.lv === 1 ? "#FF6B6D" : "#FFB020", position: monaco.editor.OverviewRulerLane.Right }
      }
    });
  }
  d.marks = m.deltaDecorations(d.marks, opts);
}

/* ---- 关键词匹配（当前文件）：装饰 + 导航列表 ---- */
function logApplyHits(){
  var monaco = window.monaco;
  var fi = LOGM.active;
  var m = LOGM.models[fi];
  LOGM.matches = [];
  if (!m || !monaco || !LOGM.editor) return;
  var d = LOGM.decos[fi] || (LOGM.decos[fi] = { marks: [], hits: [] });
  var opts = [];
  if (LOGM.kw){
    var found = m.findMatches(LOGM.kw, false, false, false, null, false, 20000);
    for (var i = 0; i < found.length; i++){
      var r = found[i].range;
      LOGM.matches.push({ line: r.startLineNumber, col: r.startColumn, len: r.endColumn - r.startColumn });
      opts.push({ range: r, options: { className: "lg-hit", stickiness: 1 } });
    }
  }
  d.hits = m.deltaDecorations(d.hits, opts);
}

/* ---- 导航：有关键词时跳匹配处，否则跳异常行 ---- */
function lgNavTargets(){
  if (LOGM.kw) return LOGM.matches;
  return (LOGM.fileMarks[LOGM.active] || []).map(function(mk){
    return { line: mk.line, col: 1, len: 0 };
  });
}
function lgGoTo(idx){
  var list = lgNavTargets();
  if (!LOGM.editor || !list.length) return;
  if (idx < 0) idx = list.length - 1;
  if (idx >= list.length) idx = 0;
  LOGM.cur = idx;
  var t = list[idx];
  var monaco = window.monaco;
  LOGM.editor.revealLineInCenter(t.line);
  LOGM.editor.setSelection(new monaco.Range(t.line, t.col, t.line, t.col + (t.len || 0)));
  var stat = document.getElementById("logStat");
  if (stat) stat.setAttribute("title", "第 " + (idx + 1) + "/" + list.length + " 处 · 第 " + t.line + " 行");
}

/* ---- 统计与按钮状态 ---- */
function lgMarksTotal(){
  var e = 0, w = 0;
  for (var fi = 0; fi < LOGM.fileMarks.length; fi++){
    var arr = LOGM.fileMarks[fi] || [];
    for (var i = 0; i < arr.length; i++){ if (arr[i].lv === 1) e++; else w++; }
  }
  return { total: e + w, err: e, warn: w };
}
function lgStatUpdate(){
  var el = document.getElementById("logStat");
  var t = lgMarksTotal();
  if (el) el.innerHTML = t.total
    ? ('共 <b>' + t.total + '</b> 处 · 错误 <b class="s-err">' + t.err + '</b> · 警告 <b class="s-warn">' + t.warn + '</b>')
    : '未发现异常';
  lgStatButtons();
}
function lgStatButtons(){
  var nav = LOGM.kw ? LOGM.matches.length : (LOGM.fileMarks[LOGM.active] || []).length;
  var b;
  b = document.getElementById("btnPrev"); if (b) b.disabled = nav === 0;
  b = document.getElementById("btnNext"); if (b) b.disabled = nav === 0;
  b = document.getElementById("btnOnlyErr"); if (b) b.disabled = lgMarksTotal().total === 0;
  b = document.getElementById("logFind"); if (b) b.disabled = false;
}

/* ---- 文件标签栏 + 加载更多按钮 ---- */
function logRenderTabs(){
  var bar = document.getElementById("logTabs");
  if (!bar) return;
  var h = '<div class="logtabs-list">';
  for (var i = 0; i < LOG_FILES.length; i++){
    var f = LOG_FILES[i];
    var moreTxt = f.total ? (' · ' + f.total + ' 行') : '';
    h += '<button type="button" class="logtab' + (i === LOGM.active ? ' on' : '') + '" data-fi="' + i
      + '" title="' + esc(f.name) + '（' + fmtSize(f.size) + moreTxt + '）">'
      + '<span class="lt-name">📄 ' + esc(f.name) + '</span>'
      + '<span class="lt-meta">' + fmtSize(f.size) + moreTxt + '</span></button>';
  }
  h += '</div>';
  var fa = LOG_FILES[LOGM.active];
  if (fa){
    if (fa.hasMore){
      h += '<button type="button" class="btn-more" id="btnMore">加载更多（剩 ' + Math.max(0, fa.total - fa.loaded) + ' 行）</button>';
    } else if (fa.loaded){
      h += '<span class="btn-more is-done">已全部加载</span>';
    }
  }
  bar.innerHTML = h;
  var tabs = bar.querySelectorAll(".logtab");
  for (var t = 0; t < tabs.length; t++){
    (function(el){
      el.addEventListener("click", function(){
        logSetActive(parseInt(el.getAttribute("data-fi"), 10));
      });
    })(tabs[t]);
  }
  var bm = document.getElementById("btnMore");
  if (bm){
    bm.addEventListener("click", function(){
      loadLogPage(LOGM.active, LOG_FILES[LOGM.active].loaded);
    });
  }
}

function logSetActive(fi){
  if (!LOG_FILES[fi]) return;
  LOGM.active = fi;
  LOGM.cur = -1;
  var f = LOG_FILES[fi];
  if (LOGM.editor){
    var m = LOGM.models[fi];
    if (m){
      LOGM.editor.setModel(m);
      logApplyHits();
    } else if (f.loaded === 0 && !f.pending){
      loadLogPage(fi, 0);   // 首次切到该文件：加载首页，模型在返回后创建
    }
  }
  logRenderTabs();
  lgStatButtons();
}

/* ---- 数据加载 ---- */
function loadLogs(){
  var box = document.getElementById("logbox");
  if (!box) return;
  if (!DETAIL_REC.log){
    box.innerHTML = '<div class="tip">未配置该机器人的日志目录，无法确定日志路径。请在 robot_logs.json 中补充该机器人的共享日志目录（参考其他机器人配置）。</div>';
    lgStatUpdate();
    return;
  }
  var url = "/api/log?dir=" + encodeURIComponent(DETAIL_REC.log);
  box.innerHTML = '<div class="tip">正在读取日志目录…</div>';
  fetch(url, { credentials: 'same-origin' }).then(function(r){
    if (r.status === 401){ location.href = '/login'; return; }
    return r.json();
  }).then(function(d){
    if (!d || !d.ok){
      box.innerHTML = '<div class="warn">⚠ 读取日志失败：' + esc((d && d.error) || "未知错误") + '</div>';
      lgStatUpdate();
      return;
    }
    if (!d.logs || d.logs.length === 0){
      box.innerHTML = '<div class="tip">目录下没有 .log 文件。</div>';
      lgStatUpdate();
      return;
    }
    LOG_FILES = [];
    for (var i = 0; i < d.logs.length; i++){
      LOG_FILES.push({ name: d.logs[i].name, size: d.logs[i].size,
                       total: d.logs[i].lines || 0, loaded: 0, content: "",
                       hasMore: false, pending: false });
    }
    box.innerHTML = "";
    box.classList.remove("tip");
    logRenderTabs();
    logEditorCreate().then(function(){
      logRenderTabs();
      for (var i2 = 0; i2 < LOG_FILES.length; i2++) loadLogPage(i2, 0);
    }).catch(function(err){
      box.innerHTML = '<div class="warn">⚠ 日志高亮组件加载失败（' + esc(String(err && err.message || err)) + '）。请确认 assets/monaco/ 与后端 /monaco/ 路由正常。</div>';
    });
  }).catch(function(e){
    box.innerHTML = '<div class="warn">⚠ 无法连接本地服务器（' + esc(e && e.message ? e.message : e) + '）。请确认 start_server.bat 正在运行。</div>';
    lgStatUpdate();
  });
}

function loadLogPage(fi, offset){
  var f = LOG_FILES[fi];
  if (!f || f.pending) return;
  f.pending = true;
  var btn = document.getElementById("btnMore");
  if (btn && LOGM.active === fi){ btn.disabled = true; btn.textContent = "加载中…"; }
  var url = "/api/log?dir=" + encodeURIComponent(DETAIL_REC.log)
          + "&file=" + encodeURIComponent(f.name)
          + "&offset=" + offset + "&limit=" + LOG_PAGE;
  fetch(url, { credentials: 'same-origin' }).then(function(r){
    if (r.status === 401){ location.href = '/login'; return; }
    return r.json();
  }).then(function(d){
    f.pending = false;
    if (!d || !d.ok){
      var b0 = document.getElementById("btnMore");
      if (b0 && b0.tagName === "BUTTON"){ b0.disabled = false; b0.textContent = "加载失败，点击重试"; }
      return;
    }
    if (offset === 0) f.content = "";
    var delta = d.content || "";
    if (delta) f.content += (f.content ? "\n" : "") + delta;
    f.loaded = offset + (d.lines || 0);
    f.hasMore = !!d.hasMore;
    if (f.loaded > f.total) f.total = f.loaded;
    if (LOGM.editor) logSyncModel(fi, offset, delta);
    lgStatUpdate();
    logRenderTabs();
  }).catch(function(){
    f.pending = false;
    var b = document.getElementById("btnMore");
    if (b && b.tagName === "BUTTON"){ b.disabled = false; b.textContent = "加载失败，点击重试"; }
  });
}

/* ---- 工具栏事件绑定（每次详情渲染调用） ---- */
function lgInit(){
  var b, f;
  b = document.getElementById("btnNext");
  if (b) b.addEventListener("click", function(){ lgGoTo(LOGM.cur + 1); });
  b = document.getElementById("btnPrev");
  if (b) b.addEventListener("click", function(){ lgGoTo(LOGM.cur - 1); });
  b = document.getElementById("btnOnlyErr");
  if (b) b.addEventListener("click", function(){
    LOGM.only = !LOGM.only;
    this.className = LOGM.only ? "chip on" : "chip";
    this.textContent = LOGM.only ? "聚焦异常" : "仅看异常";
    var box = document.getElementById("logbox");
    if (box) box.classList.toggle("lg-only", LOGM.only);
    if (LOGM.only && !LOGM.kw && (LOGM.fileMarks[LOGM.active] || []).length) lgGoTo(0);
  });
  f = document.getElementById("logFind");
  if (f){
    var timer = 0;
    f.addEventListener("input", function(){
      var v = this.value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function(){
        LOGM.kw = v.trim();
        LOGM.cur = -1;
        logApplyHits();
        if (LOGM.kw && LOGM.matches.length) lgGoTo(0);
        lgStatButtons();
      }, 300);
    });
    f.addEventListener("keydown", function(e){
      if (e.key === "Enter"){ lgGoTo(LOGM.cur + (e.shiftKey ? -1 : 1)); e.preventDefault(); }
    });
  }
}

/* ---- 释放（详情重建 / 离开详情页时调用） ---- */
function lgReset(){
  if (LOGM.editor){ try { LOGM.editor.dispose(); } catch(e){} LOGM.editor = null; }
  for (var i = 0; i < LOGM.models.length; i++){
    if (LOGM.models[i]){ try { LOGM.models[i].dispose(); } catch(e){} }
  }
  LOGM.models = []; LOGM.decos = []; LOGM.fileMarks = []; LOGM.matches = [];
  LOGM.cur = -1; LOGM.kw = ""; LOGM.only = false; LOGM.active = 0;
  LOG_FILES = [];
  var el = document.getElementById("logStat");
  if (el){ el.textContent = "—"; el.removeAttribute("title"); }
  var ids = ["btnPrev", "btnNext", "btnOnlyErr", "logFind"], b, j;
  for (j = 0; j < ids.length; j++){
    b = document.getElementById(ids[j]);
    if (b){ b.disabled = true; if (ids[j] === "btnOnlyErr"){ b.className = "chip"; b.textContent = "仅看异常"; } }
  }
  var f = document.getElementById("logFind");
  if (f) f.value = "";
  var box = document.getElementById("logbox");
  if (box) box.classList.remove("lg-only");
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
/* 排期数据更新后重载：刷新统计卡 + 按当前筛选状态重绘（不重建选择器，保留用户选择） */
function scReload(){
  if (!SCHED || !SCHED.ok || !scChart) return;
  document.getElementById('sTotal').textContent = SCHED.stats.total;
  document.getElementById('sEnabled').textContent = SCHED.stats.enabled;
  document.getElementById('sDisabled').textContent = SCHED.stats.disabled;
  document.getElementById('sWebhook').textContent = SCHED.stats.webhook;
  scRender(scView, scFilter, scStatus);
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
      else if (curView === 'schedule' && force){
        // 排期页仅在「立刻更新」（全量抓，含触发器）后重载；自动更新只抓运行记录，不影响排期
        loadSchedule().then(function(){ scReload(); });
      }
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
/* 自动更新：每 60s 拉一次运行记录（--only-runs，不含触发器排期），仅在时间轴/分析页生效 */
function autoTick(){
  if (curView === 'timeline' || curView === 'analysis') refreshData();
}
document.getElementById('chkAuto').addEventListener('change', function(){
  if (this.checked) {
    autoTick();
    if (!autoTimer) autoTimer = setInterval(autoTick, 60000);
  } else {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  }
});
document.getElementById('btnBack').addEventListener('click', function(){
  // 返回上一页（时间轴/项目控制台等任意入口）；无历史时兜底回时间轴
  var cur = location.hash;
  history.back();
  setTimeout(function(){ if (location.hash === cur) location.hash = '#/timeline'; }, 300);
});
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
document.getElementById('btnToProjects').addEventListener('click', function(){
  var rec = DETAIL_REC;
  if (!rec || !rec.fid) { alert('该记录缺少流程 ID，无法跳转项目配置'); return; }
  pjPendingFid = rec.fid;
  location.hash = '#/projects?fid=' + encodeURIComponent(rec.fid);
});
document.getElementById('navMenuList').addEventListener('click', function(e){
  var li = e.target.closest('li[data-hash]');
  if (li){ location.hash = li.getAttribute('data-hash'); document.getElementById('navMenu').classList.remove('open'); }
});
// 触屏设备没有 hover：点标题切换展开，点别处收起
document.getElementById('navMenuBtn').addEventListener('click', function(e){
  document.getElementById('navMenu').classList.toggle('open');
  e.stopPropagation();
});
document.addEventListener('click', function(){
  document.getElementById('navMenu').classList.remove('open');
});
if (document.getElementById('chkAuto').checked) {
  autoTick();
  if (!autoTimer) autoTimer = setInterval(autoTick, 60000);
}

/* ==================== 项目控制台视图 ==================== */
function glShow(msg){
  var m = document.getElementById('glMsg');
  if (m) m.textContent = msg || '加载中…';
  var o = document.getElementById('globalLoading');
  if (o) o.style.display = 'flex';
}
function glHide(){
  var o = document.getElementById('globalLoading');
  if (o) o.style.display = 'none';
}
var pjItems = [];          // 项目列表缓存
var pjCurrent = null;      // 当前选中项目
var pjCfgItems = [];       // 当前配置项
var pjPendingFid = null;   // 待跳转选中的 flow_id（从详情页「项目配置」带 ?fid= 进入）
var pjReady = false;

function pjFmtTime(s){
  if (!s) return "—";
  var ms = Date.parse(s);
  return isNaN(ms) ? s : fmtFull(ms);
}
function pjLoad(force){
  var el = document.getElementById('pjList');
  glShow('正在加载项目列表…');
  return api('/api/projects').then(function(d){
    if (d && Array.isArray(d.items)){
      var keep = pjCurrent ? pjCurrent.flow_id : null;
      pjItems = d.items;
      if (keep) pjItems.forEach(function(it){ if (it.flow_id === keep) pjCurrent = it; });
      pjRenderList();
      if (pjPendingFid){
        var hasTarget = false;
        for (var i = 0; i < pjItems.length; i++){ if (pjItems[i].flow_id === pjPendingFid) hasTarget = true; }
        if (hasTarget){ pjSelect(pjPendingFid); }
        pjPendingFid = null;
      }
      if (pjCurrent) document.getElementById('pjGroup').value = pjCurrent.group || '';
    } else if (el){
      el.innerHTML = '<div class="pj-loading">加载失败：' + esc((d && d.error) || '未知错误') + '</div>';
    }
    return pjItems;
  }).catch(function(e){
    if (el) el.innerHTML = '<div class="pj-loading">加载失败：' + esc(e) + '</div>';
  }).then(function(v){ glHide(); return v; });
}
function pjSortFn(){
  var v = document.getElementById('pjSort').value;
  return function(a, b){
    if (v === 'name') return (a.name || '').localeCompare(b.name || '', 'zh');
    return (b.update_time || '').localeCompare(a.update_time || '');
  };
}
var PJ_NAME_COLORS = { '宝': '#378ADD', '硕': '#1D9E75', '国': '#D85A30',
                       '泇': '#7F77DD', '财': '#EF9F27', 'X': '#8b8f98', 'x': '#8b8f98' };
var PJ_COLORS = ['#378ADD', '#1D9E75', '#D85A30', '#7F77DD', '#EF9F27', '#E24B4A', '#2BA6A0'];  // 非灰
function pjColor(name){
  if (!name) return PJ_COLORS[0];
  var c = name.charAt(0);
  if (PJ_NAME_COLORS[c]) return PJ_NAME_COLORS[c];
  return PJ_COLORS[name.charCodeAt(0) % PJ_COLORS.length];
}
function pjRenderList(){
  var el = document.getElementById('pjList');
  if (!el) return;
  var arr = pjItems.slice().sort(pjSortFn());
  var foot = document.getElementById('pjFoot');
  if (foot) foot.textContent = '共 ' + pjItems.length + ' 个项目';
  el.innerHTML = arr.map(function(it){
    var sel = pjCurrent && pjCurrent.flow_id === it.flow_id;
    return '<div class="pj-item' + (sel ? ' sel' : '') + '" data-fid="' + esc(it.flow_id) + '">'
      + '<div class="pj-item-top">'
      + '<span class="pj-avatar" style="background:' + pjColor(it.name) + '">' + esc(it.name ? it.name.charAt(0) : '?') + '</span>'
      + '<span class="pj-item-name">' + esc(it.name) + '</span>'
      + (it.group ? '<span class="pj-group-tag">' + esc(it.group) + '</span>' : '')
      + '</div>'
      + '<div class="pj-item-meta">' + esc(it.update_time ? it.update_time.slice(0, 16).replace('T', ' ') : '—')
      + (it.owner ? ' · ' + esc(it.owner) : '') + '</div>'
      + '</div>';
  }).join('');
}
function pjSelect(fid){
  pjCurrent = null;
  pjItems.forEach(function(it){ if (it.flow_id === fid) pjCurrent = it; });
  if (!pjCurrent) return;
  pjRenderList();
  document.getElementById('pjEmpty').style.display = 'none';
  var d = document.getElementById('pjDetail');
  d.style.display = 'flex';   // 保持 CSS 的 flex 纵向布局（不能用 block，否则卡片高度塌缩）
  document.getElementById('pjName').textContent = pjCurrent.name;
  document.getElementById('pjMeta').textContent = 'flowId: ' + pjCurrent.flow_id
    + ' · 更新: ' + pjFmtTime(pjCurrent.update_time)
    + (pjCurrent.owner ? ' · 负责人: ' + pjCurrent.owner : '');
  document.getElementById('pjGroup').value = pjCurrent.group || '';
  document.getElementById('pjCfgHint').textContent = '配置组用于关联该项目的飞书多维表格配置（group 列）。先保存映射，再加载配置。';
  document.getElementById('pjCfgTbl').innerHTML = '';
  pjCfgItems = [];
  pjSwitchTab('cfg');
  if (pjCurrent.group){ pjCfgLoad(); }
}
function pjSwitchTab(name){
  var tabs = document.querySelectorAll('.pj-tab');
  for (var i = 0; i < tabs.length; i++){
    var on = tabs[i].getAttribute('data-tab') === name;
    if (on) tabs[i].classList.add('active'); else tabs[i].classList.remove('active');
  }
  document.getElementById('pjPanelCfg').style.display = (name === 'cfg') ? 'flex' : 'none';
  document.getElementById('pjPanelRuns').style.display = (name === 'runs') ? 'flex' : 'none';
  if (name === 'runs') pjRunsLoad();
}
function pjRunsLoad(){
  var p = pjCurrent;
  var el = document.getElementById('pjRunsList');
  if (!p || !el) return;
  glShow('正在加载运行记录…');
  (RECORDS.length ? Promise.resolve(RECORDS) : loadRuns()).then(function(){
    var mine = RECORDS.filter(function(r){ return r.fid === p.flow_id; })
      .sort(function(a, b){ return (b.start || 0) - (a.start || 0); });
    document.getElementById('pjRunsInfo').textContent = mine.length
      ? '最近 7 天共 ' + mine.length + ' 条运行记录，展示最近 ' + Math.min(mine.length, 20) + ' 条；点击某条查看日志详情。'
      : '暂无运行记录（可点击标题右侧「运行该应用」触发一次）。';
    if (!mine.length){
      el.innerHTML = '<div class="pj-empty-sm">暂无运行记录</div>';
    } else {
      el.innerHTML = '<table class="pj-runs-tbl"><thead><tr>'
        + '<th>状态</th><th>机器人</th><th>触发方式</th><th>开始时间</th><th>结束时间</th><th>时长</th>'
        + '</tr></thead><tbody>'
        + mine.slice(0, 20).map(function(r){
          return '<tr data-rid="' + esc(r.id) + '" title="点击查看日志详情">'
            + '<td>' + statusBadge(r.status || '') + '</td>'
            + '<td>' + esc(r.robot || '—') + '</td>'
            + '<td>' + esc(wayCN(r.way)) + '</td>'
            + '<td>' + fmtTime(r.start) + '</td>'
            + '<td>' + (r.end == null ? '（进行中）' : fmtTime(r.end)) + '</td>'
            + '<td>' + fmtDurM((r.end || Date.now()) - (r.execStart || r.start)) + '</td>'
            + '</tr>';
        }).join('') + '</tbody></table>';
    }
    glHide();
  });
}
function pjCfgDisplayVal(it){
  /* 展示用文本：json 自动解析排版换行 */
  if (it.type === 'json'){
    try { return JSON.stringify(JSON.parse(it.value), null, 2); }
    catch (e) { return it.value; }
  }
  return it.value;
}
function pjCfgRender(){
  var tbl = document.getElementById('pjCfgTbl');
  var rows = pjCfgItems.map(function(it){
    return '<tr>'
      + '<td class="k">' + esc(it.key) + '</td>'
      + '<td class="v" title="' + esc(it.value) + '">' + esc(pjCfgDisplayVal(it)) + '</td>'
      + '<td class="t">' + esc(it.type) + '</td>'
      + '<td class="d">' + esc(it.desc) + '</td>'
      + '<td><button class="btn pj-cfg-edit" data-key="' + esc(it.key) + '">编辑</button></td>'
      + '</tr>';
  }).join('');
  if (!pjCfgItems.length){
    rows = '<tr><td colspan="5" class="pj-empty-sm" style="border:none;">该配置组暂无配置项，点右上「＋ 新增配置」添加。</td></tr>';
  }
  tbl.innerHTML = '<thead><tr><th>key</th><th>value</th><th>type</th><th>desc</th><th></th></tr></thead>'
    + '<tbody>' + rows + '</tbody>';
}
function pjCfgLoad(){
  var g = document.getElementById('pjGroup').value.trim();
  if (!g){ alert('请先填写配置组名'); return; }
  var tbl = document.getElementById('pjCfgTbl');
  glShow('正在加载配置…');
  return api('/api/projects/config?group=' + encodeURIComponent(g)).then(function(d){
    if (!d || !d.ok){
      tbl.innerHTML = '';
      alert((d && d.error) || '加载配置失败');
    } else {
      pjCfgItems = d.items || [];
      document.getElementById('pjCfgHint').textContent = '配置组「' + g + '」共 ' + pjCfgItems.length + ' 个配置项；点「编辑」修改，或「＋ 新增配置」添加。';
      pjCfgRender();
    }
    glHide();
  });
}
function pjCfgPost(body, onOk){
  return fetch('/api/projects/config', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body) })
    .then(function(r){ return r.json(); })
    .then(function(j){
      if (j.ok){ if (onOk) onOk(j); }
      else alert('保存失败：' + (j.error || j.msg || '未知错误'));
      return j;
    }).catch(function(e){ alert('请求失败：' + e); return { ok: false, error: String(e) }; });
}

/* ---- 配置编辑弹窗 ---- */
var pjModalMode = 'edit';     // edit | new
var pjEditKey = null;         // 编辑模式原 key（不可改）
function pjModalValueHtml(type, raw){
  /* value 控件：json -> textarea(格式化排版) / bool -> 开关 / 其它 -> 输入框 */
  if (type === 'bool'){
    var on = (String(raw).trim().toLowerCase() === 'true' || String(raw) === '1');
    return '<label class="switch"><input type="checkbox" id="mBool"' + (on ? ' checked' : '') + '><span class="slider"></span></label>'
      + '<span class="m-bool-tip">' + (on ? 'true' : 'false') + '</span>';
  }
  if (type === 'json'){
    var pretty;
    try { pretty = JSON.stringify(JSON.parse(raw || '{}'), null, 2); }
    catch (e) { pretty = raw; }
    return '<textarea id="mValJson" rows="7" spellcheck="false" placeholder="JSON 对象/数组">' + esc(pretty) + '</textarea>';
  }
  return '<input type="text" id="mValText" value="' + esc(raw) + '">';
}
function pjModalSyncBoolTip(){
  var el = document.getElementById('mBool');
  var tip = document.querySelector('.m-bool-tip');
  if (el && tip) tip.textContent = el.checked ? 'true' : 'false';
}
function pjModalOpen(item, isNew){
  pjModalMode = isNew ? 'new' : 'edit';
  pjEditKey = item ? item.key : null;
  document.getElementById('pjModalTitle').textContent = isNew ? '新增配置' : '编辑配置';
  document.getElementById('mKey').value = item ? item.key : '';
  document.getElementById('mKey').disabled = !isNew;
  document.getElementById('mKeyLock').style.display = isNew ? 'none' : 'inline';
  document.getElementById('mType').value = item ? item.type : 'string';
  document.getElementById('mValWrap').innerHTML = pjModalValueHtml(document.getElementById('mType').value,
                                                                    item ? item.value : '');
  document.getElementById('mDesc').value = item ? (item.desc || '') : '';
  document.getElementById('mErr').textContent = '';
  document.getElementById('pjModal').style.display = 'flex';
  pjModalSyncBoolTip();
}
function pjModalClose(){
  document.getElementById('pjModal').style.display = 'none';
}
function pjModalSave(){
  var g = document.getElementById('pjGroup').value.trim();
  var key = document.getElementById('mKey').value.trim();
  var type = document.getElementById('mType').value;
  if (!g){ document.getElementById('mErr').textContent = '缺少配置组（请先在上方填写并保存映射）'; return; }
  if (!key){ document.getElementById('mErr').textContent = '请填写 key'; return; }
  var value;
  if (type === 'bool'){
    var b = document.getElementById('mBool');
    value = (b && b.checked) ? 'true' : 'false';
  } else if (type === 'json'){
    var tv = document.getElementById('mValJson').value;
    try { JSON.parse(tv); }
    catch (e){ document.getElementById('mErr').textContent = 'JSON 格式错误：' + e.message; return; }
    value = tv;
  } else {
    var tx = document.getElementById('mValText');
    value = tx ? tx.value : '';
  }
  var desc = document.getElementById('mDesc').value;
  glShow('保存中…');
  pjCfgPost({ group: g, key: key, value: value, type: type, desc: desc }, function(){
    pjModalClose();        // 成功：关弹窗，由 pjCfgLoad 接管「加载配置」遮罩
    pjCfgLoad();
  }).then(function(j){ if (!j || !j.ok) glHide(); });   // 失败：收起遮罩
}
function pjInit(){
  var listEl = document.getElementById('pjList');
  if (!listEl) return;
  document.getElementById('pjSort').addEventListener('change', pjRenderList);
  document.getElementById('pjReload').addEventListener('click', function(){ pjLoad(true); });
  listEl.addEventListener('click', function(e){
    var item = e.target.closest('.pj-item');
    if (item) pjSelect(item.getAttribute('data-fid'));
  });
  document.getElementById('pjRun').addEventListener('click', function(){
    var p = pjCurrent;
    if (!p) return;
    if (!confirm('确认运行应用「' + p.name + '」？\n将立即触发一次执行。')) return;
    fetch('/api/projects/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flow_id: p.flow_id }) })
      .then(function(r){ return r.json(); })
      .then(function(j){
        if (j.ok){
          alert('已触发运行，批次号：' + (j.flowProcessNo || '—')
            + (j.botId ? '\n执行机器人：' + j.botId.replace(/^.*_/, '') : '')
            + '\n任务已进入队列，运行记录卡片将自动刷新。');
          setTimeout(pjRunsLoad, 3000);
        } else {
          alert('运行失败：' + (j.message || j.error || '未知错误'));
        }
      }).catch(function(e){ alert('请求失败：' + e); });
  });
  document.getElementById('pjGroupSave').addEventListener('click', function(){
    var p = pjCurrent;
    if (!p) return;
    var g = document.getElementById('pjGroup').value.trim();
    pjCfgPost({ group: 'project', key: 'p.' + p.flow_id, value: g, type: 'string' }, function(){
      p.group = g;
      pjRenderList();
      document.getElementById('pjCfgHint').textContent = '映射已保存：项目 ↔ 配置组「' + (g || '（未关联）') + '」。';
    });
  });
  document.getElementById('pjCfgLoad').addEventListener('click', pjCfgLoad);
  document.getElementById('pjRunsReload').addEventListener('click', function(){
    loadRuns().then(pjRunsLoad);
  });
  var tabs = document.querySelectorAll('.pj-tab');
  for (var i = 0; i < tabs.length; i++){
    (function(btn){
      btn.addEventListener('click', function(){ pjSwitchTab(btn.getAttribute('data-tab')); });
    })(tabs[i]);
  }
  document.getElementById('pjRunsList').addEventListener('click', function(e){
    var row = e.target.closest('tr[data-rid]');
    if (row) location.hash = '#/detail?id=' + encodeURIComponent(row.getAttribute('data-rid'));
  });
  document.getElementById('pjCfgTbl').addEventListener('click', function(e){
    var btn = e.target.closest('.pj-cfg-edit');
    if (!btn) return;
    var key = btn.getAttribute('data-key');
    for (var i = 0; i < pjCfgItems.length; i++){
      if (pjCfgItems[i].key === key){ pjModalOpen(pjCfgItems[i], false); break; }
    }
  });
  document.getElementById('pjCfgAdd').addEventListener('click', function(){ pjModalOpen(null, true); });
  document.getElementById('mCancel').addEventListener('click', pjModalClose);
  document.getElementById('mSave').addEventListener('click', pjModalSave);
  document.getElementById('pjModal').addEventListener('click', function(e){
    if (e.target === this) pjModalClose();
  });
  document.getElementById('mValWrap').addEventListener('change', function(e){
    if (e.target && e.target.id === 'mBool') pjModalSyncBoolTip();
  });
  document.getElementById('mType').addEventListener('change', function(){
    var raw = pjModalReadValue();   // change 触发时旧控件仍在，读到的还是旧类型的值
    var type = this.value;          // 新类型
    if (type === 'json'){
      try { raw = JSON.stringify(JSON.parse(raw || '{}'), null, 2); } catch (e) { /* 保留原文 */ }
    }
    document.getElementById('mValWrap').innerHTML = pjModalValueHtml(type, raw);
    pjModalSyncBoolTip();
  });
  pjLoad();
}
/* ---- 弹窗辅助 ---- */
function pjModalReadValue(){
  /* 按「当前存在哪个 value 控件」读取（不依赖 type 判断） */
  var b = document.getElementById('mBool');
  if (b) return b.checked ? 'true' : 'false';
  var tv = document.getElementById('mValJson');
  if (tv) return tv.value;
  var tx = document.getElementById('mValText');
  return tx ? tx.value : '';
}

/* ==================== 启动 ==================== */
route();

