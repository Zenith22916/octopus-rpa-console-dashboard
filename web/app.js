/* ==================== 公共工具 ==================== */
var STATUS_CN = {
  Waiting: "排队中", Executing: "运行中", Finished: "已完成",
  Failed: "失败", Stopped: "已停止"
};
var WAY_CN = { Manual: "手动", TimingTrigger: "定时触发器", Webhook: "Webhook" };
function wayOf(r) { return WAY_CN[r.way] || r.way || "-"; }
function wayCN(w) { return WAY_CN[w] || w || "—"; }
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function pad(n) { return String(n).padStart(2, "0"); }
function fmtTime(ms) { if (ms == null) return "-"; var d = new Date(ms); return (d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
/* 时长口语化：用于时间窗口大小提示 */
function fmtSpanLabel(ms) {
  var m = ms / 60000;
  if (m < 90) return (m < 10 ? m.toFixed(1) : Math.round(m)) + ' 分钟';
  var h = ms / 3600000;
  if (h < 48) return (h < 10 ? h.toFixed(1) : Math.round(h)) + ' 小时';
  return (ms / 86400000).toFixed(1) + ' 天';
}
function fmtFull(ms) {
  if (ms == null) return "—"; var d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
    pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}
function fmtDur(ms) {
  if (ms == null || ms < 0) return "—"; var s = Math.round(ms / 1000); if (s < 60) return s + " 秒";
  var m = Math.floor(s / 60), sec = s % 60; if (m < 60) return m + " 分" + (sec ? " " + sec + " 秒" : "");
  var h = Math.floor(m / 60), mm = m % 60; return h + " 小时" + (mm ? " " + mm + " 分" : "");
}
function fmtDurM(ms) {
  if (ms == null || isNaN(ms)) return "-";
  var m = ms / 60000;
  if (m < 1) return Math.round(ms / 1000) + " s";
  if (m < 60) return m.toFixed(1) + " min";
  var h = Math.floor(m / 60), mm = Math.round(m % 60);
  return h + " h" + (mm ? (" " + mm + " min") : "");
}
function fmtSize(b) { if (b == null) return ""; if (b < 1024) return b + " B"; if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB"; return (b / 1024 / 1024).toFixed(2) + " MB"; }
function statusColor(r) {
  if (r.status === "Failed") return "rgba(226,75,74,0.6)";
  if (r.status === "Executing") return "rgba(239,159,39,0.6)";
  if (r.status === "Waiting") return "rgba(55,138,221,0.6)";
  if (r.status === "Stopped") return "rgba(95,94,90,0.6)";
  return "rgba(29,158,117,0.6)";
}
/* ==================== 图表视觉：渐变填充与圆角 ====================
   纯样式层：只影响图形怎么画，不参与任何数据计算与交互逻辑。 */
function gradFill(a, b, dir) {
  var horizontal = dir === 'h';
  try {
    return new echarts.graphic.LinearGradient(0, 0, horizontal ? 1 : 0, horizontal ? 0 : 1,
      [{ offset: 0, color: a }, { offset: 1, color: b }]);
  } catch (e) {
    return a;   // echarts 未就绪时降级为纯色，保证图形仍能画出来
  }
}
/* 任意合法颜色（#hex / rgb / rgba）-> 分量，解析不了返回 null */
function parseColor(c) {
  var s = String(c == null ? '' : c).trim();
  var m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
  if (/^#[0-9a-f]{6}$/i.test(s)) {
    return { r: parseInt(s.slice(1, 3), 16), g: parseInt(s.slice(3, 5), 16), b: parseInt(s.slice(5, 7), 16), a: 1 };
  }
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return {
      r: parseInt(s.charAt(1) + s.charAt(1), 16),
      g: parseInt(s.charAt(2) + s.charAt(2), 16),
      b: parseInt(s.charAt(3) + s.charAt(3), 16), a: 1
    };
  }
  return null;
}
/* 单一底色 -> 派生「上亮下暗」渐变；解析不了就原样返回纯色（安全降级） */
function shadeGrad(color, dir, lift, drop) {
  var c = parseColor(color);
  if (!c) return color;
  var k1 = lift == null ? .26 : lift;
  var k2 = drop == null ? .24 : drop;
  return gradFill(
    'rgba(' + Math.round(c.r + (255 - c.r) * k1) + ',' +
    Math.round(c.g + (255 - c.g) * k1) + ',' +
    Math.round(c.b + (255 - c.b) * k1) + ',' + c.a + ')',
    'rgba(' + Math.round(c.r * (1 - k2)) + ',' +
    Math.round(c.g * (1 - k2)) + ',' +
    Math.round(c.b * (1 - k2)) + ',' + c.a + ')',
    dir);
}
/* 状态色相：沿用原来的状态语义色，只做轻微「上亮下暗」。
   时间轴数据块走半透明（重叠可辨、长时间看不刺眼），饼图扇区用实色。 */
var STATUS_HUE = {
  Failed: [226, 75, 74],
  Executing: [239, 159, 39],
  Waiting: [55, 138, 221],
  Stopped: [120, 122, 128],
  Finished: [29, 158, 117]
};
function statusRGB(k, alpha) {
  /* 未知状态兜底用中性灰，不要落成「已完成」的绿色 —— 那会把失败/新状态伪装成成功 */
  var c = STATUS_HUE[k] || STATUS_HUE.Stopped;
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';
}
/* 注意：时间轴数据块不走这里 —— 它的颜色在数据构造时由 segColor() 算好存进 value(5)，
   renderItem 直接读 value(5)，原因见 tlRender 里那段注释 */
function statusPieFill(k) {     // 饼图扇区
  return shadeGrad(statusRGB(k, 1), 'v', .1, .12);
}
/* 排期配色：直接用后端 PALETTE 给的颜色（v1 逻辑，恢复原状），
   应用之间的辨识交给「悬停点亮同应用全部块」。 */
/* 悬停高亮：鼠标所在的块 -> 找到同应用的全部块 -> dispatchAction 批量点亮。
   dataIndex 回查走 scLastData（custom series 不保证保留附加字段，教训同时间轴） */
var scHotApp = null;
var scLastData = null;
function scHighlight(app) {
  if (!scChart || !scLastData) return;
  if (app === scHotApp) return;
  scHotApp = app;
  var idxs = [];
  scLastData.forEach(function (it, i) { if (it && it.app === app) idxs.push(i); });
  scChart.dispatchAction({ type: 'downplay', seriesIndex: 0 });
  if (idxs.length) scChart.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: idxs });
}
function scUnhighlight() {
  if (!scChart || scHotApp == null) return;
  scHotApp = null;
  scChart.dispatchAction({ type: 'downplay', seriesIndex: 0 });
}

var WAIT_FILL = shadeGrad(statusRGB('Waiting', .72), 'v', .12, .14);

/* 饼图在小面板里的比例：标签只留百分比（名称+数值交给图例），引导线缩短，
   否则扇区外侧的标签会顶出容器被裁掉 */
var PIE_ITEM = { borderRadius: 6, borderColor: '#171b23', borderWidth: 2 };
var PIE_LABEL = { color: '#dfe5ee', fontSize: 11, formatter: '{d}%' };
var PIE_LINE = { length: 6, length2: 6, lineStyle: { color: 'rgba(255,255,255,.18)' } };

/* 悬停提示窗的统一皮肤：ECharts 默认是白底黑字，跟这套深色界面完全不搭。
   放在这里做单一出处，所有图表（时间轴/分析/排期）都从这里拼，避免漏一个又变回白底。 */
var TIP_SKIN = {
  confine: true, backgroundColor: '#1c2027', borderColor: '#333a45',
  borderWidth: 1, textStyle: { color: '#e6e6e6', fontSize: 12 }
};
function tipOpt(extra) {
  var o = {}, k;
  for (k in TIP_SKIN) o[k] = TIP_SKIN[k];
  for (k in extra) o[k] = extra[k];
  return o;
}
function pieLegend(data) {
  return {
    bottom: 0, itemWidth: 8, itemHeight: 8, itemGap: 12,
    textStyle: { color: '#8b8f98', fontSize: 11 },
    formatter: function (name) {
      var hit = null;
      data.forEach(function (d) { if (d.name === name) hit = d; });
      return hit ? (name + ' ' + hit.value) : name;
    }
  };
}
function pieSeries(data) {
  return [{
    type: 'pie', radius: ['42%', '64%'], center: ['50%', '44%'],
    itemStyle: PIE_ITEM, label: PIE_LABEL, labelLine: PIE_LINE,
    emphasis: { scale: true, scaleSize: 4 },
    data: data
  }];
}
function statusBadge(st) {
  var map = {
    Failed: ["失败", "rgba(226,75,74,0.18)", "#E24B4A"],
    Executing: ["运行中", "rgba(239,159,39,0.18)", "#EF9F27"],
    Waiting: ["排队中", "rgba(55,138,221,0.18)", "#378ADD"],
    Stopped: ["已停止", "rgba(95,94,90,0.18)", "#8b8f98"]
  };
  var m = map[st] || ["已完成", "rgba(29,158,117,0.18)", "#1D9E75"];
  return '<span class="badge" style="background:' + m[1] + ';color:' + m[2] + '">' + m[0] + '</span>';
}
function getParam(name) {
  var m = new RegExp("[?&]" + name + "=([^&]*)").exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
}

/* ==================== 全局状态 ==================== */
var RECORDS = [];          // /api/runs 返回的运行记录（时间轴 + 分析共用）
var DETAIL_REC = null;     // 当前详情记录
var SCHED = null;          // /api/schedule 数据
var curView = '';          // 当前视图：timeline/analysis/detail/schedule
var autoTimer = null;

if (location.protocol === "file:") {
  document.body.innerHTML = '<div class="tip" style="padding:40px;text-align:center;">⚠ 当前以 file:// 方式打开，浏览器禁止调用后端接口。请改用本地服务器：运行 start_server.bat，再打开 <a href="http://localhost:8000/">http://localhost:8000/</a></div>';
  throw new Error("file:// unsupported");
}

/* ==================== 数据加载 ==================== */
function api(url) {
  return fetch(url, { credentials: 'same-origin' }).then(function (r) {
    if (r.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
    return r.json();
  });
}
function loadRuns() {
  return api('/api/runs').then(function (d) {
    if (d && Array.isArray(d.records)) { RECORDS = d.records; }
    if (d && d.time) document.getElementById('dataTime').textContent = d.time;
    return RECORDS;
  });
}
function loadRunDetail(id) {
  return api('/api/run?id=' + encodeURIComponent(id)).then(function (d) {
    DETAIL_REC = (d && d.ok && d.rec) ? d.rec : null;
    return DETAIL_REC;
  });
}
function loadSchedule() {
  return api('/api/schedule').then(function (d) {
    if (d && d.ok) SCHED = d;
    return SCHED;
  });
}

/* ==================== 视图切换与路由 ==================== */
/* 全部视图 / 侧栏导航可见的视图（detail 无导航项，只能由链接进入） */
var VIEW_NAMES = ['timeline', 'analysis', 'detail', 'schedule', 'projects',
  'botstatus', 'logsearch', 'compliance'];
var NAV_NAMES = ['timeline', 'analysis', 'schedule', 'projects',
  'botstatus', 'logsearch', 'compliance'];

function showView(name) {
  curView = name;
  for (var i = 0; i < VIEW_NAMES.length; i++) {
    var el = document.getElementById('view-' + VIEW_NAMES[i]);
    if (el) el.style.display = (VIEW_NAMES[i] === name) ? 'flex' : 'none';
  }
  // 离开详情页时释放 Monaco 日志编辑器（模型与实例随详情重建，避免常驻占内存）
  if (name !== 'detail' && typeof lgReset === 'function') lgReset();
  if (NAV_NAMES.indexOf(name) >= 0) navSet(name);
  // 标题栏指标卡按视图切换（时间轴 / 日程；分析页在页面内有自己的指标卡）
  var tlM = document.getElementById('tlMetrics'), scM = document.getElementById('scMetrics');
  if (tlM) tlM.style.display = (name === 'timeline') ? 'flex' : 'none';
  if (scM) scM.style.display = (name === 'schedule') ? 'flex' : 'none';
  var anM = document.getElementById('anMetrics');
  if (anM) anM.style.display = (name === 'analysis') ? 'flex' : 'none';
  // 自动更新开关：只在「数据靠自动刷新保持新鲜」的视图显示
  // （排期/项目/合规页的数据要走「立刻更新」全量抓，自动更新只抓运行记录）
  var autoCtl = document.getElementById('autoCtl');
  if (autoCtl) autoCtl.style.display =
    (name === 'timeline' || name === 'analysis' || name === 'botstatus') ? 'flex' : 'none';
}
function navSet(name) {
  /* 同步悬停菜单：标题按钮文本 + 当前项高亮 */
  var hash = '#/' + name;
  var btn = document.getElementById('navMenuBtn');
  var items = document.querySelectorAll('.navmenu-list li');
  var label = null;
  for (var i = 0; i < items.length; i++) {
    if (items[i].getAttribute('data-hash') === hash) {
      label = items[i].textContent;
      items[i].classList.add('cur');
    } else {
      items[i].classList.remove('cur');
    }
  }
  if (btn && label) btn.textContent = label;
}
function parseHash() {
  var h = location.hash || '#/analysis';
  var m = h.match(/^#\/([a-z]+)(?:\?(.*))?$/i);
  var name = m ? m[1].toLowerCase() : 'analysis';
  if (VIEW_NAMES.indexOf(name) < 0) name = 'analysis';
  return name;
}
var tlReady = false, anReady = false, scReady = false;
function route() {
  var prevView = curView;   // 记录来源视图（showView 会覆盖 curView）
  var name = parseHash();
  showView(name);
  if (name === 'timeline') {
    if (!tlReady) {
      loadRuns().then(function () { tlInit(); tlReady = true; });
    } else {
      tlResize();
      if (prevView === 'detail') refreshData();   // 从日志详情页返回：自动更新在详情页停更了，补一次非强制刷新（只抓运行记录，不碰视口状态）
    }
  } else if (name === 'analysis') {
    if (!anReady) {
      loadRuns().then(function () { anInit(); anReady = true; });
    } else {
      anResize();
    }
  } else if (name === 'detail') {
    var id = getParam('id');
    /* 深链：从日志检索/合规看板跳过来时带 ?kw= 与 ?file=，日志加载完成后自动定位关键词 */
    var kw = getParam('kw'), fl = getParam('file');
    LG_LINK = (kw || fl) ? { kw: kw || null, file: fl || null } : null;
    if (id) {
      loadRunDetail(id).then(function () { renderDetail(); });
    } else {
      DETAIL_REC = null; renderDetail();
    }
  } else if (name === 'schedule') {
    if (!scReady) {
      loadSchedule().then(function () { scInit(); scReady = true; });
    } else {
      scResize();
      loadSchedule().then(function () { scReload(); });   // 数据可能在别处被刷新过：进入时同步最新
    }
  } else if (name === 'projects') {
    pjPendingFid = getParam('fid');   // 带 ?fid= 进入时选中对应项目（无则 null）
    if (!pjReady) { pjInit(); pjReady = true; }
    else { pjLoad(); }
  } else if (name === 'botstatus') {
    if (!bsReady) { bsBind(); bsReady = true; }
    bsLoad().then(bsRender);
  } else if (name === 'logsearch') {
    if (!lsReady) { lsBind(); lsReady = true; }
    (RECORDS.length ? Promise.resolve(RECORDS) : loadRuns()).then(lsFillRobots);
  } else if (name === 'compliance') {
    if (!cpReady) { cpBind(); cpReady = true; }
    cpLoad();
  }
}
window.addEventListener('hashchange', route);
window.addEventListener('resize', function () {
  /* 桌面 <-> 手机布局互切：图表的内边距/刻度字号是按布局算出来的，
     断点变了必须整块重画，只 resize() 会保留旧布局量出来的边距 */
  var mob = !!(window.matchMedia && window.matchMedia(MOBILE_Q).matches);
  if (mob !== IS_MOBILE) {
    IS_MOBILE = mob;
    if (typeof LOGM !== 'undefined' && LOGM.editor) LOGM.editor.updateOptions(lgViewOptions());
    if (curView === 'timeline' && tlReady) tlRender();
    if (curView === 'analysis' && anReady) anRenderAll(RECORDS);
    if (curView === 'schedule' && scReady && RECORDS.length) scReload();
  }
  if (curView === 'timeline' && tlReady) tlChartResize();
  if (curView === 'analysis' && anReady) anResize();
  if (curView === 'schedule' && scReady) scResize();
});

/* ==================== 时间轴视图 ==================== */
var DEF_SPAN = 2 * 3600 * 1000;
if (window.innerWidth < window.innerHeight) {
  DEF_SPAN = 6 * 3600 * 1000;   // 窄高窗口（宽<高）默认拉长时间窗：横向内容更舒展，靠拖动平移浏览
}
var records = [];           // 时间轴工作副本（来自 RECORDS）
var robots = [];
var state = { span: DEF_SPAN, end: Date.now(), offset: 0, focusId: null };
var DATA_MIN = Infinity, DATA_MAX = -Infinity;
var tlChart = null, chartEl = null;
var tlLastData = null;      // 最近一次渲染的数据项：custom series 取不到附加字段时按 dataIndex 回查
var tlPan = null;           // 图表拖动平移的拖拽状态（null = 没在拖）
var tlPanMoved = false;     // 本次拖拽是否真的移动过：拖完那一下不该被当成点击
var tlScrollTrackEl = null, tlScrollWinEl = null;   // 底部滚动条（只反映窗口，不负责缩放）
function recomputeBounds() {
  DATA_MIN = Infinity; DATA_MAX = -Infinity;
  var nowT = Date.now();
  records.forEach(function (r) {
    if (r.start < DATA_MIN) DATA_MIN = r.start;
    var e = r.end == null ? nowT : r.end;
    if (e > DATA_MAX) DATA_MAX = e;
  });
}
function robotList(segs) {
  var arr = [];
  segs.forEach(function (s) {
    var rb = s.r.robot;
    if (rb && rb !== "(未指定机器人)" && arr.indexOf(rb) < 0) arr.push(rb);
  });
  return arr.sort();
}
function buildSegs() {
  var segs = [];
  records.forEach(function (r) {
    var st = r.start;
    var exec = (r.execStart && r.execStart > st) ? r.execStart : null;
    if (exec && exec - st >= 60 * 1000) segs.push({ r: r, start: st, end: exec, kind: 'wait' });
    segs.push({ r: r, start: exec || st, end: r.end, kind: 'run' });
  });
  return segs;
}
function segColor(s) { if (s.kind === 'wait') return 'rgba(55,138,221,0.6)'; return statusColor(s.r); }
var FONT_STACK = (function () {
  try { return getComputedStyle(document.body).fontFamily || 'sans-serif'; }
  catch (e) { return 'sans-serif'; }
})();
var _mc = (function () {
  try { var c = document.createElement('canvas').getContext('2d'); c.font = '500 20px ' + FONT_STACK; return c; }
  catch (e) { return null; }
})();
function measureW(s, fs) { if (!_mc) return s.length * 10; _mc.font = '500 ' + (fs || 20) + 'px ' + FONT_STACK; return _mc.measureText(s).width; }
// 大标题字号：与时间轴数据块文字保持一致（读取 .title 的 20px，CSS 改了这里也跟着变）
var TITLE_FS = (function () {
  try { var el = document.querySelector('.title'); if (el) return parseFloat(getComputedStyle(el).fontSize) || 20; } catch (e) { }
  return 20;
})();
/* 手机端断点：与 web/mobile.css、web/theme.js 里的 880px 保持一致。
   CSS 管不到 ECharts 画布内部，图表的内边距与刻度字号只能在这里分流：
   桌面那套 left:100px 的左留白是给宽图表配的，原样搬到手机上会把绘图区压没。 */
var MOBILE_Q = "(max-width: 880px)";
var IS_MOBILE = !!(window.matchMedia && window.matchMedia(MOBILE_Q).matches);

/* Monaco 里跟屏幕宽度有关的选项：手机屏只有 300 多 px，缩略图（minimap）要吃掉
   近两成宽度而且根本看不清，概览标尺同理 —— 手机端关掉，把宽度全让给日志正文。
   单独抽成函数是为了断点切换时能 updateOptions 热更新。 */
function lgViewOptions() {
  return {
    minimap: { enabled: !IS_MOBILE, renderCharacters: false, maxColumn: 150 },
    overviewRulerLanes: IS_MOBILE ? 0 : 2,
    scrollbar: {
      verticalScrollbarSize: IS_MOBILE ? 6 : 10,
      horizontalScrollbarSize: IS_MOBILE ? 6 : 10, useShadows: false
    }
  };
}
// 单行文字：放得下整串显示；放不下则截断并在末尾加 "..."
function truncateLabel(name, maxW, fs) {
  if (!name) return '';
  if (maxW < 6) return '';                 // 太窄，连省略号都放不下
  if (measureW(name, fs) <= maxW) return name;
  var ell = '...', ellW = measureW(ell, fs), budget = maxW - ellW;
  if (budget <= 0) return '';
  var cur = '', curW = 0;
  for (var i = 0; i < name.length; i++) {
    var cw = measureW(name[i], fs);
    if (curW + cw > budget) break;
    cur += name[i]; curW += cw;
  }
  return cur + ell;
}
function effEnd(s) { return s.end == null ? state.end : s.end; }
function layout(segs, minVisibleMs) {
  minVisibleMs = minVisibleMs || 0;   // 屏幕上不足该时长的条视为看不见，不参与独立泳道分配
  var recs = [];
  var recOfSeg = {};
  var byRobot = {};
  segs.forEach(function (s, i) {
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
  robots.forEach(function (rb) {
    var idxs = (byRobot[rb] || []).slice().sort(function (a, b) { return recs[a].start - recs[b].start; });
    var lanes = [];
    var laneOfRec = {};
    // 先排“正常可见”的记录；太细（屏幕上不足约 2px）的条最后统一塞进第一条泳道，
    // 避免它单独占一条泳道却因渲染不出而变成“空泳道”。（窗口越大阈值越大，缩放到足够大时它仍会正常占道）
    var normals = [], tinies = [];
    idxs.forEach(function (ri) {
      var u = recs[ri];
      (u.end - u.start < minVisibleMs ? tinies : normals).push(ri);
    });
    normals.forEach(function (ri) {
      var u = recs[ri], st = u.start, en = u.end, lane = -1;
      for (var l = 0; l < lanes.length; l++) {
        if (st >= lanes[l].end || en <= lanes[l].start) { lane = l; break; }
      }
      if (lane < 0) { lane = lanes.length; lanes.push({ start: st, end: en }); }
      else { if (st < lanes[lane].start) lanes[lane].start = st; if (en > lanes[lane].end) lanes[lane].end = en; }
      laneOfRec[ri] = lane;
    });
    if (tinies.length) {
      if (lanes.length === 0) lanes.push({ start: state.end, end: state.end });
      tinies.forEach(function (ri) { laneOfRec[ri] = 0; });
    }
    if (lanes.length === 0) lanes.push({ start: state.end, end: state.end });
    var base = rowCursor;
    rowCursor += lanes.length;
    idxs.forEach(function (ri) {
      var u = recs[ri];
      u.segIdxs.forEach(function (si) { info[si] = { row: base + laneOfRec[ri] }; });
    });
    for (var r = base; r < rowCursor; r++) yLabels.push(r === base ? rb : '');
    groupLastRows.push(base + lanes.length - 1);
  });
  layout.totalRows = rowCursor;
  layout.yLabels = yLabels;
  layout.groupLastRows = groupLastRows;
  return info;
}
function tlRender() {
  if (!tlChart) return;
  var nowW = Math.min(state.end + state.offset, state.end);
  var winStart = nowW - state.span;
  var segs = buildSegs();
  var waySel = document.getElementById('selWay').value;
  if (waySel !== '__ALL__') segs = segs.filter(function (s) { return s.r.way === waySel; });
  var qEl = document.getElementById('chkQueue');
  var showQueue = qEl ? qEl.checked : true;
  if (!showQueue) segs = segs.filter(function (s) { return s.kind !== 'wait'; });   // 关闭排队：去掉排队段，布局/泳道按运行段计算
  var lgQueue = document.getElementById('lgQueue');
  if (lgQueue) lgQueue.style.display = showQueue ? '' : 'none';
  robots = robotList(segs);
  var visible = segs.filter(function (s) { return effEnd(s) >= winStart && s.start <= nowW; });
  /* 手机端（窄屏）把时间轴转置：时间沿竖直方向展开、机器人横向排开，块内文字逐字竖排。
     下面所有绘制都按「时间方向 / 泳道方向」两个方向来算，两种布局共用一套代码。 */
  var T = IS_MOBILE;
  // 可见下限：屏幕上不足约 2px 的条视为看不见（窗口越大阈值越大），用于抑制“细到不渲染却仍占泳道”的空泳道。
  var cw = tlChart.getWidth ? tlChart.getWidth() : 0;
  var ch = tlChart.getHeight ? tlChart.getHeight() : 0;
  var gLeftPx = T ? 46 : 100, gRightPx = T ? 10 : 20;
  var gTopPx = T ? 14 : 20, gBotPx = T ? 58 : 30;
  /* 时间方向上的可用像素长度：桌面取横向宽度，转置后取纵向高度 */
  var plotLen = Math.max(50, (T ? ch - gTopPx - gBotPx : cw - gLeftPx - gRightPx) || 900);
  var minVisibleMs = state.span * (2 / plotLen);
  var info = layout(visible, minVisibleMs);
  var yLabels = layout.yLabels;
  var lastRows = layout.groupLastRows || [];
  var topGroupRow = lastRows.length ? Math.max.apply(null, lastRows) : -1;
  var recMerge = {};
  visible.forEach(function (s) {
    var rid = String(s.r.id);
    var m = recMerge[rid] || (recMerge[rid] = { min: Infinity, max: -Infinity });
    if (s.start < m.min) m.min = s.start;
    var en = effEnd(s);
    if (en > m.max) m.max = en;
  });
  var data = [];
  var textData = [];
  visible.forEach(function (s, i) {
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
    if (s.kind === 'run' && s.r.name && (merge.max - merge.min) >= minVisibleMs) {
      textData.push({ value: [(merge.min + merge.max) / 2, li.row, s.r.name, merge.min, merge.max] });
    }
  });
  var sepData = [];
  lastRows.forEach(function (r) { if (r !== topGroupRow) sepData.push({ value: [r] }); });
  var recIds = {};
  visible.forEach(function (s) { recIds[s.r.id] = 1; });
  var recCount = Object.keys(recIds).length;
  tlLastData = data;

  /* ---- 两种布局共用的坐标工具（T = 转置时 x 轴是泳道、y 轴是时间） ---- */
  // 时间 t + 泳道 row -> 屏幕坐标 [x, y]
  function xy(api, t, row) { return api.coord(T ? [row, t] : [t, row]); }
  // 两点在「时间方向」上的像素长度：桌面看横向、转置后看纵向
  function lenOf(p0, p1) { return T ? Math.abs(p1[1] - p0[1]) : Math.abs(p1[0] - p0[0]); }
  // 泳道方向的厚度（一条泳道有多厚）
  function bandOf(api) { return T ? api.size([1, 0])[0] : api.size([0, 1])[1]; }
  // 画一段块：p0/p1 为两端屏幕坐标，thick 为泳道方向厚度
  function barOf(p0, p1, thick, style) {
    var a0 = T ? Math.min(p0[1], p1[1]) : Math.min(p0[0], p1[0]);
    var a1 = T ? Math.max(p0[1], p1[1]) : Math.max(p0[0], p1[0]);
    var len = a1 - a0;
    var c = T ? p0[0] : p0[1];                 // 泳道中心
    var r = Math.min(3, len / 2, thick / 2);
    return {
      type: 'rect',
      shape: T ? { x: c - thick / 2, y: a0, width: thick, height: len, r: r }
        : { x: a0, y: c - thick / 2, width: len, height: thick, r: r },
      style: style
    };
  }

  tlChart.setOption({
    backgroundColor: 'transparent',
    animation: false,
    tooltip: tipOpt({
      trigger: 'item',
      formatter: function (p) {
        var d = p.data;
        var stName = STATUS_CN[d.status] || d.status || '已完成';
        var stColor = statusColor({ status: d.status, app: d.app });
        var s = '<b>' + esc(d.name) + '</b>'
          + '<br/>机器人：' + esc(d.robot)
          + (d.way && d.way !== "Manual" && d.trigger ? '<br/>触发器：' + esc(d.trigger) : '')
          + '<br/>触发方式：' + esc(wayOf({ way: d.way }))
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
      }
    }),
    grid: { left: gLeftPx, right: gRightPx, top: gTopPx, bottom: gBotPx },
    /* 转置后 x 轴 = 机器人泳道（横向排开，标签斜排免得互相压），y 轴 = 时间（纵向） */
    xAxis: T ? {
      type: 'category', data: yLabels,
      axisLabel: {
        color: '#c9cdd4', fontSize: 10, rotate: 45, interval: 0,
        width: 62, overflow: 'truncate'      // 斜排：旋转后横向投影约 44px，窄屏也不互相压
      },
      axisLine: { lineStyle: { color: '#333' } },
      splitLine: { show: true, lineStyle: { color: '#20242c' } }
    } : {
      type: 'time', min: nowW - state.span, max: nowW,
      axisLabel: {
        color: '#8b8f98', fontSize: 11, hideOverlap: true,
        formatter: function (v) { return fmtTime(v); }
      },
      axisLine: { lineStyle: { color: '#333' } },
      splitLine: { show: true, lineStyle: { color: '#20242c' } }
    },
    yAxis: T ? {
      /* inverse：默认 y 轴是「值大在上」，那时间就成了「现在在上、过去在下」，
         与桌面从左到右的时间流向相反。反过来排，过去在上、现在在下，顺着看。 */
      type: 'time', min: nowW - state.span, max: nowW, inverse: true,
      axisLabel: {
        color: '#8b8f98', fontSize: 10, hideOverlap: true,
        formatter: function (v) { return fmtTime(v); }
      },
      axisLine: { lineStyle: { color: '#333' } },
      splitLine: { show: true, lineStyle: { color: '#20242c' } }
    } : {
      type: 'category', data: yLabels,
      axisLabel: {
        color: '#c9cdd4', fontSize: 12,
        width: 95, overflow: 'truncate'
      },
      axisLine: { lineStyle: { color: '#333' } },
      splitLine: { show: true, lineStyle: { color: '#20242c' } }
    },
    series: [{
      type: 'custom', data: data, zlevel: 1,
      renderItem: function (params, api) {
        var row = api.value(2);
        var winA = nowW - state.span;
        var vs = Math.max(api.value(0), winA);
        var ve = Math.min(api.value(1), nowW);
        if (ve <= vs) return null;
        var band = bandOf(api);
        var children = [];
        var bh = Math.max(10, band - 4);
        var exec = api.value(6);
        var hasWait = exec && exec > api.value(0);
        if (hasWait && showQueue) {
          var q0 = Math.max(api.value(0), winA), q1 = Math.min(exec, nowW);
          if (q1 > q0) {
            var pq0 = xy(api, q0, row), pq1 = xy(api, q1, row);
            if (lenOf(pq0, pq1) >= 2) {
              children.push(barOf(pq0, pq1, bh, { fill: WAIT_FILL }));
            }
          }
        }
        var rs = hasWait ? exec : api.value(0);
        var r0 = Math.max(rs, winA), r1 = Math.min(api.value(1), nowW);
        if (r1 > r0) {
          var pr0 = xy(api, r0, row), pr1 = xy(api, r1, row);
          if (lenOf(pr0, pr1) >= 2) {
            /* 用 value(5)（数据构造时由 segColor 算好的状态色）派生渐变：
               不要在 renderItem 里读 params.data.status —— custom series
               不保证保留附加字段，取不到就会全部落到兜底色（全变绿）。
               渐变方向跟着块的长边：桌面横条用竖向，转置后的竖条用横向 */
            children.push(barOf(pr0, pr1, bh, { fill: shadeGrad(api.value(5), T ? 'h' : 'v', .07, .09) }));
          }
        }
        var pv0 = xy(api, vs, row), pv1 = xy(api, ve, row);
        if (lenOf(pv0, pv1) >= 2) {
          children.push(barOf(pv0, pv1, bh,
            { fill: 'rgba(0,0,0,0)', stroke: 'rgba(255, 255, 255, 0.5)', lineWidth: 1.5, cursor: 'pointer' }));
        }
        if (!children.length) return null;
        return children.length === 1 ? children[0] : { type: 'group', children: children };
      },
      markLine: {
        silent: true, symbol: 'none', lineStyle: { color: '#E24B4A', width: 2 },
        label: { show: true, formatter: '现在', color: '#E24B4A', fontSize: 10, position: 'insideEndTop' },
        // 「现在」分界线：桌面为竖线，转置后时间在纵轴上，改用横线
        data: [T ? { yAxis: state.end } : { xAxis: state.end }]
      }
    }, {
      type: 'custom', data: textData, zlevel: 2, silent: true,
      renderItem: function (params, api) {
        var row = api.value(1);
        var raw = String(api.value(2) || '');
        if (!raw) return null;
        var mStart = api.value(3);
        var mEnd = api.value(4) == null ? nowW : api.value(4);
        var vStart = Math.max(mStart, nowW - state.span);
        var vEnd = Math.min(mEnd, nowW);
        if (vEnd <= vStart) return null;
        var vc = (vStart + vEnd) / 2;
        var pc = xy(api, vc, row);
        var avail = lenOf(xy(api, vStart, row), xy(api, vEnd, row));

        if (T) {
          /* 转置后块是竖长条：文字逐字竖排（每字一行、字正立，不是整体旋转 90°），
             放不下按「能排几个字」截断 */
          var per = 13;                                   // 每字占的高度
          var maxChars = Math.floor(Math.max(6, avail - 4) / per);
          if (maxChars < 2) return null;
          var txt = raw.length > maxChars ? raw.slice(0, maxChars - 1) + '…' : raw;
          return {
            type: 'text', style: {
              text: txt.split('').join('\n'), x: pc[0], y: pc[1],
              textAlign: 'center', textVerticalAlign: 'middle', fill: '#10141a',
              fontSize: 12, fontWeight: 500, fontFamily: FONT_STACK, lineHeight: per
            }
          };
        }
        // 桌面：数据块文字单行、字号与大标题一致、居中、放不下截断加 "..."、少于 8 字不显示
        var label = truncateLabel(raw, Math.max(2, avail - 4), TITLE_FS);
        if (!label || label.length < 8) return null;
        return {
          type: 'text', style: {
            text: label, x: pc[0], y: pc[1], textAlign: 'center',
            textVerticalAlign: 'middle', fill: '#10141a', fontSize: TITLE_FS,
            fontWeight: 500, fontFamily: FONT_STACK
          }
        };
      }
    }, {
      type: 'custom', data: sepData, zlevel: 1, silent: true,
      renderItem: function (params, api) {
        var row = api.value(0);
        var band = bandOf(api);
        var c0 = xy(api, nowW - state.span, row);
        var c1 = xy(api, nowW, row);
        var lo = T ? Math.min(c0[1], c1[1]) : Math.min(c0[0], c1[0]);
        var hi = T ? Math.max(c0[1], c1[1]) : Math.max(c0[0], c1[0]);
        // 机器人分组之间的白色虚线：桌面画横线（每组的底边），转置后画竖线（每组的右边）
        return T
          ? {
            type: 'line', shape: { x1: c0[0] + band / 2, y1: lo, x2: c0[0] + band / 2, y2: hi },
            style: { stroke: 'rgba(255,255,255,0.65)', lineWidth: 1.5, lineDash: [6, 4] }
          }
          : {
            type: 'line', shape: { x1: lo, y1: c0[1] - band / 2, x2: hi, y2: c0[1] - band / 2 },
            style: { stroke: 'rgba(255,255,255,0.65)', lineWidth: 1.5, lineDash: [6, 4] }
          };
      }
    }]
  }, { lazyUpdate: true });
  // 窗口内可见记录按触发方式计数（同一记录排队+运行两段去重）
  var wayRecs = { Manual: 0, TimingTrigger: 0, Webhook: 0 };
  var seenW = {};
  visible.forEach(function (s) {
    var wk = s.r.id + '_' + s.r.way;
    if (!seenW[wk] && wayRecs[s.r.way] != null) { seenW[wk] = 1; wayRecs[s.r.way]++; }
  });
  document.getElementById('mTotal').textContent = wayRecs.Webhook;
  document.getElementById('mManual').textContent = wayRecs.Manual;
  document.getElementById('mTiming').textContent = wayRecs.TimingTrigger;
  document.getElementById('mRobots').textContent = robots.length;
  tlSpanInfoUpdate();
  tlScrollSync();
  tlListRender(false);
}
/* ==================== 运行记录列表（时间轴卡片下方） ====================
   展示当前时间窗口内的记录；点某行 -> 甘特图右边缘对齐该记录的结束时间，
   记录还没结束（end 为空）则对齐到最右，也就是当前时刻。 */
var tlListLast = 0;
function tlListRender(force) {
  var tbl = document.getElementById('tlListTbl');
  if (!tbl) return;
  var now = Date.now();
  if (!force && now - tlListLast < 600) return;   // 窗口一直在实时推进，重绘做节流
  tlListLast = now;

  var nowW = Math.min(state.end + state.offset, state.end);
  var winStart = nowW - state.span;
  var rows = records.filter(function (r) {
    var en = r.end == null ? state.end : r.end;
    return en >= winStart && r.start <= nowW;
  });
  rows.sort(function (a, b) { return b.start - a.start; });

  var info = document.getElementById('tlListInfo');
  if (info) info.textContent = '窗口内 ' + rows.length + ' 条 · 共 ' + records.length + ' 条';

  if (!rows.length) {
    tbl.innerHTML = '<tbody><tr><td class="pj-empty-sm" style="border:none;">当前时间窗口内没有记录</td></tr></tbody>';
    return;
  }
  var html = '<thead><tr><th>机器人</th><th>应用</th><th>状态</th><th>开始</th><th>结束</th><th>用时</th></tr></thead><tbody>';
  rows.slice(0, 120).forEach(function (r) {
    var live = (r.end == null);
    var endMs = live ? state.end : r.end;
    html += '<tr data-rid="' + esc(String(r.id)) + '"' +
      (String(r.id) === String(state.focusId) ? ' class="on"' : '') + '>' +
      '<td>' + esc(r.robot) + '</td>' +
      '<td>' + esc(r.name || r.app || '—') + '</td>' +
      '<td>' + statusBadge(r.status) + '</td>' +
      '<td class="num">' + fmtTime(r.start) + '</td>' +
      '<td class="num">' + (live ? '进行中' : fmtTime(r.end)) + '</td>' +
      '<td class="num">' + fmtDur(endMs - r.start) + '</td>' +
      '</tr>';
  });
  tbl.innerHTML = html + '</tbody>';
}
function tlGotoRec(rid) {
  var rec = null;
  for (var i = 0; i < records.length; i++) {
    if (String(records[i].id) === String(rid)) { rec = records[i]; break; }
  }
  if (!rec) return;
  state.end = Date.now();
  /* 未结束（end 为空）-> 对齐到最右（现在）；已结束 -> 窗口右边缘对齐结束时间 */
  state.offset = (rec.end == null)
    ? 0
    : Math.max(DATA_MIN - state.end, Math.min(0, rec.end - state.end));
  state.focusId = String(rid);
  tlUpdateWindow();
  tlListRender(true);
  if (tlChart) tlChart.resize();     // 按当前容器尺寸重算，避免数据块与横轴错位
}
function tlListBind() {
  var box = document.getElementById('tlList');
  if (!box || box._tlBound) return;
  box._tlBound = 1;
  box.addEventListener('click', function (e) {
    var tr = (e.target && e.target.closest) ? e.target.closest('tr[data-rid]') : null;
    if (tr) tlGotoRec(tr.getAttribute('data-rid'));
  });
}
/* 窗口信息（当前窗口长度 + 起止时刻） */
function tlSpanInfoUpdate() {
  var info = document.getElementById('tlSpanInfo');
  if (!info) return;
  var nowW = Math.min(state.end + state.offset, state.end);
  info.textContent = '窗口 ' + fmtSpanLabel(state.span) + '：' +
    fmtTime(nowW - state.span) + ' ~ ' + fmtTime(nowW);
}
/* 底部滚动条：只反映当前窗口在全部数据里的位置与占比（窗口越长滑块越宽）。
   窗口长度只能靠「窗口」下拉或 Ctrl+滚轮改，这里不提供缩放把手。 */
function tlScrollSync() {
  if (!tlScrollTrackEl || !tlScrollWinEl) return;
  var total = state.end - DATA_MIN;
  if (!(total > 0)) { tlScrollWinEl.style.display = 'none'; return; }
  tlScrollWinEl.style.display = 'block';
  var tW = tlScrollTrackEl.clientWidth || 1;
  var nowW = Math.min(state.end + state.offset, state.end);
  /* 视觉下限：窗口再小也按 6 小时对应的宽度画，否则窄到点不中；
     真实窗口大小不受影响，位置换算始终按 msPerPx 走，与这个宽度无关 */
  var minW = 6 * 3600 * 1000 / total * tW;
  var w = Math.max(minW, Math.min(tW, state.span / total * tW));
  var frac = (nowW - DATA_MIN) / total;
  var left = Math.max(0, Math.min(tW - w, frac * tW - w));
  tlScrollWinEl.style.width = w + 'px';
  tlScrollWinEl.style.left = left + 'px';
}
/* 滑块改了窗口大小后同步下拉：值不在预设里就让下拉留空（表示自定义窗口） */
function syncSpanSelect() {
  var sel = document.getElementById('selSpan');
  if (!sel) return;
  var hit = -1;
  for (var i = 0; i < sel.options.length; i++) {
    if (+sel.options[i].value === Math.round(state.span)) { hit = i; break; }
  }
  sel.selectedIndex = hit;
}
function tlUpdateWindow() { if (curView === 'timeline') tlRender(); }
function tlResize() { if (tlChart) tlChart.resize(); }
function tlChartResize() { if (tlChart) tlChart.resize(); }
function tlInit() {
  records = RECORDS.slice();
  recomputeBounds();
  chartEl = document.getElementById('chart');
  if (!chartEl) return;
  if (tlChart) { try { tlChart.dispose(); } catch (e) { } }
  tlChart = echarts.init(chartEl);
  var MIN_SPAN = 10 * 60 * 1000;                 // 窗口下限 10 分钟
  var MAX_SPAN = 30 * 24 * 3600 * 1000;          // 窗口上限 30 天
  /* 滚轮：默认平移（下=向未来、上=向过去）；按住 Ctrl/⌘ 变成以鼠标处为锚点缩放窗口 */
  chartEl.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) return zoomAt(e);
    var nowW = Math.min(state.end + state.offset, state.end);
    panTo(nowW - state.span + e.deltaY * (state.span / 600));
  }, { passive: false });
  document.getElementById('selSpan').onchange = function () {
    state.span = parseInt(this.value, 10);
    state.offset = 0;
    state.focusId = null;
    tlUpdateWindow();
  };
  document.getElementById('selWay').onchange = function () {
    state.offset = 0;
    state.focusId = null;
    tlUpdateWindow();
  };
  var chkQueue = document.getElementById('chkQueue');
  if (chkQueue) chkQueue.onchange = function () { tlUpdateWindow(); };
  chartEl.addEventListener('dblclick', function () {
    state.offset = 0;
    /* 下拉留空（自定义窗口）时保持当前 span，不能把 NaN 写进去 */
    var v = parseInt(document.getElementById('selSpan').value, 10);
    if (v > 0) state.span = v;
    state.focusId = null;                    // 恢复实时视图时一并取消高亮
    tlUpdateWindow();
  });
  tlListBind();                              // 列表点行 -> 甘特图对齐该记录的结束时间
  syncSpanSelect();                          // 下拉与当前窗口大小对齐（窄高窗口默认 6 小时）

  /* 图表区直接拖动平移（1:1 跟手）：整幅宽度正好对应整个时间窗口，所以拖动 N 像素
     就平移 N 像素所代表的时间，内容贴着鼠标走；窗口长度由上方「窗口」下拉决定。
     越界约束：不能拖到「现在」之后，也不能拖出最早数据之外。 */
  /* 拖动只改窗口位置（窗口长度由上方下拉决定）：把窗口左边界放到 left，
     并夹在「最早数据」与「右边缘贴住现在」之间——拖过头就在边界停住，不会弹回另一头。 */
  function clampOffset(o) {
    return Math.max(DATA_MIN - state.end, Math.min(0, o));
  }
  function panTo(left) {
    var hi = state.end - state.span;               // 右边缘贴「现在」时左边界的位置
    if (hi < DATA_MIN) hi = DATA_MIN;              // 窗口比数据跨度还长：贴着最早数据
    left = Math.max(DATA_MIN, Math.min(hi, left));
    state.offset = clampOffset(left + state.span - state.end);
    state.focusId = null;
    tlUpdateWindow();
  }
  /* Ctrl+滚轮缩放：以鼠标所指的时刻为锚点（缩放前后它尽量停在原地），
     向上滚放大（窗口变短、看更细），向下滚缩小。 */
  function zoomAt(e) {
    var rect = chartEl.getBoundingClientRect();
    var frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
    var nowW = Math.min(state.end + state.offset, state.end);
    var anchor = nowW - state.span + frac * state.span;
    var span = state.span * (e.deltaY > 0 ? 1.15 : 1 / 1.15);
    state.span = Math.max(MIN_SPAN, Math.min(MAX_SPAN, span));
    syncSpanSelect();                        // 落到预设档位就对上下拉，否则留空
    panTo(anchor - frac * state.span);
  }

  var panRaf = 0;              // 一帧最多重算一次：拖动手感更稳，也不给渲染压力
  function panApply() {
    panRaf = 0;
    if (!tlPan) return;
    var dMs = (tlPan.last - tlPan.x) * (state.span / (chartEl.clientWidth || 1));
    panTo(tlPan.left - dMs);
  }
  /* 拖动事件挂在 window 上：不做指针捕获（捕获会把鼠标事件从 canvas 上截走，
     ECharts 内部的 hover / click 判定会乱），移出图表范围也能继续拖、抬手即止 */
  chartEl.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;                     // 只响应左键 / 单指
    var nowW = Math.min(state.end + state.offset, state.end);
    tlPan = { x: e.clientX, last: e.clientX, left: nowW - state.span };
    tlPanMoved = false;
    chartEl.classList.add('tl-pan');
  });
  function panMove(e) {
    if (!tlPan) return;
    tlPan.last = e.clientX;
    if (Math.abs(e.clientX - tlPan.x) > 3) tlPanMoved = true;
    if (panRaf) return;
    panRaf = requestAnimationFrame(panApply);
  }
  function endPan() {
    if (!tlPan) return;
    tlPan = null;
    chartEl.classList.remove('tl-pan');
  }
  window.addEventListener('pointermove', panMove);
  window.addEventListener('pointerup', endPan);
  window.addEventListener('pointercancel', endPan);

  /* 底部滚动条：拖滑块平移窗口，点轨道空白把窗口移过去。
     滑块宽度只由 tlScrollSync 按当前窗口长度计算，不能拖两端改大小。 */
  tlScrollTrackEl = document.getElementById('tlScrollTrack');
  tlScrollWinEl = document.getElementById('tlScrollWin');
  if (tlScrollTrackEl && tlScrollWinEl) {
    var slider = null;
    function sliderMsPerPx() {
      return (state.end - DATA_MIN) / (tlScrollTrackEl.clientWidth || 1);
    }
    tlScrollWinEl.addEventListener('pointerdown', function (e) {
      var nowW = Math.min(state.end + state.offset, state.end);
      slider = { x: e.clientX, left: nowW - state.span };
      e.preventDefault();
      e.stopPropagation();
    });
    window.addEventListener('pointermove', function (e) {
      if (!slider) return;
      panTo(slider.left + (e.clientX - slider.x) * sliderMsPerPx());
    });
    window.addEventListener('pointerup', function () { slider = null; });
    window.addEventListener('pointercancel', function () { slider = null; });
    tlScrollTrackEl.addEventListener('pointerdown', function (e) {
      if (e.target !== tlScrollTrackEl) return;
      var rect = tlScrollTrackEl.getBoundingClientRect();
      var frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
      var center = DATA_MIN + frac * (state.end - DATA_MIN);
      panTo(center - state.span / 2);
    });
  }

  tlChart.on('click', function (params) {
    /* 刚拖完这一下不算点击（否则平移结束会误跳详情） */
    if (tlPanMoved) { tlPanMoved = false; return; }
    /* 优先用 params.data.rid；custom series 不保证保留附加字段，
       取不到就按 dataIndex 回查 tlLastData（同一份数据，双保险） */
    if (!params || params.seriesIndex !== 0) return;
    var rid = (params.data && params.data.rid) || null;
    if (!rid && tlLastData && typeof params.dataIndex === 'number') {
      var it = tlLastData[params.dataIndex];
      if (it) rid = it.rid;
    }
    if (rid) location.hash = '#/detail?id=' + encodeURIComponent(rid);
  });
  tlRender();
}
setInterval(function () { if (curView === 'timeline') { state.end = Date.now(); tlRender(); } }, 200);

/* ==================== 分析视图 ==================== */
var anCharts = {};
function anInit() {
  if (!RECORDS.length) return;
  anCharts.pie = echarts.init(document.getElementById('pie'));
  anCharts.statusPie = echarts.init(document.getElementById('statusPie'));
  anCharts.waitBar = echarts.init(document.getElementById('waitBar'));
  anCharts.heat = echarts.init(document.getElementById('heat'));
  anRenderAll(RECORDS);
  document.getElementById('btnExport').onclick = anExport;
}
function anResize() { for (var k in anCharts) if (anCharts[k]) anCharts[k].resize(); }
function anRenderAll(recs) {
  var now = Date.now();
  var total = 0, finished = 0, failed = 0, running = 0, stopped = 0, waiting = 0;
  var waitSum = 0, waitN = 0, runSum = 0, runN = 0, maxRun = 0;
  var events = [];
  var byRobot = {}, byWay = {}, statusCount = {};
  var heat = []; for (var w = 0; w < 7; w++) { heat.push(new Array(24).fill(0)); }
  recs.forEach(function (r) {
    var st = r.start, en = (r.end == null) ? now : r.end;
    var s = r.status;
    total++;
    statusCount[s] = (statusCount[s] || 0) + 1;
    if (s === 'Finished') finished++; else if (s === 'Failed') failed++;
    else if (s === 'Executing') running++; else if (s === 'Stopped') stopped++;
    else if (s === 'Waiting') waiting++;
    if (r.execStart && r.execStart > st) { waitSum += r.execStart - st; waitN++; }
    if (r.execStart && r.end != null && r.end > r.execStart) { var rd = r.end - r.execStart; runSum += rd; runN++; if (rd > maxRun) maxRun = rd; }
    else if (r.end != null && r.end > st) { var rd2 = r.end - st; if (rd2 > maxRun) maxRun = rd2; }
    events.push([st, 1]); events.push([en, -1]);
    var wd = (new Date(st).getDay() + 6) % 7; var hh = new Date(st).getHours(); heat[wd][hh]++;
    var rk = r.robot; var u = byRobot[rk] || (byRobot[rk] = { robot: rk, count: 0, failed: 0, waitSum: 0, waitN: 0, runSum: 0, runN: 0 });
    u.count++; if (s === 'Failed') u.failed++;
    if (r.execStart && r.execStart > st) { u.waitSum += r.execStart - st; u.waitN++; }
    if (r.execStart && r.end != null && r.end > r.execStart) { u.runSum += r.end - r.execStart; u.runN++; }
    var wv = r.way || "-"; byWay[wv] = (byWay[wv] || 0) + 1;
  });
  events.sort(function (a, b) { return (a[0] - b[0]) || (a[1] - b[1]); });
  var peak = 0, cur = 0; events.forEach(function (e) { cur += e[1]; if (cur > peak) peak = cur; });
  var avgWait = waitN ? waitSum / waitN : 0, avgRun = runN ? runSum / runN : 0;
  anMetrics(total, finished, failed, running, avgWait, avgRun, maxRun, peak, waitN, runN);
  anPie(byWay);
  anStatus(statusCount);
  anWaitBar(byRobot);
  anHeat(heat);
  anRobotTbl(byRobot);
  anFailTbl(recs);
}
/* 指标卡：只有标题 + 大数字两行，数字带语义色 */
function anCard(k, v, color) {
  return '<div class="metric"><div class="k">' + k + '</div>' +
    '<div class="v"' + (color ? ' style="color:' + color + '"' : '') + '>' + v + '</div></div>';
}
function anMetrics(total, finished, failed, running, avgWait, avgRun, maxRun, peak, waitN, runN) {
  /* 只保留 4 张核心卡，渲染到顶部工具栏的 #anMetrics（原先在分析页内、共 8 张） */
  var html = '';
  html += anCard('总运行数', total, '#378ADD');
  html += anCard('运行中', running, '#EF9F27');
  html += anCard('平均排队', fmtDurM(avgWait), '#7F77DD');
  html += anCard('平均运行', fmtDurM(avgRun), '#1D9E75');
  var box = document.getElementById('anMetrics');
  if (box) box.innerHTML = html;
}
function anPie(byWay) {
  var WAYHUE = { '手动': [29, 158, 117], '定时触发器': [127, 119, 221], 'Webhook': [216, 118, 63] };
  var data = Object.keys(byWay).map(function (k) {
    var c = WAYHUE[wayCN(k)] || [55, 138, 221];
    return {
      name: wayCN(k), value: byWay[k],
      itemStyle: { color: shadeGrad('rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',1)', 'v', .1, .12) }
    };
  });
  anCharts.pie.setOption({
    tooltip: tipOpt({ trigger: 'item', formatter: '{b}: {c} ({d}%)' }),
    legend: pieLegend(data),
    series: pieSeries(data)
  });
}
function anStatus(sc) {
  var data = Object.keys(sc).map(function (k) {
    return { name: STATUS_CN[k] || k, value: sc[k], itemStyle: { color: statusPieFill(k) } };
  });
  data.sort(function (a, b) { return b.value - a.value; });
  anCharts.statusPie.setOption({
    tooltip: tipOpt({ trigger: 'item', formatter: '{b}: {c} ({d}%)' }),
    legend: pieLegend(data),
    series: pieSeries(data)
  });
}
function anWaitBar(byRobot) {
  var arr = Object.keys(byRobot).map(function (k) { var u = byRobot[k]; return { robot: u.robot, avg: u.waitN ? u.waitSum / u.waitN : 0 }; }).sort(function (a, b) { return b.avg - a.avg; });
  /* y 轴标签按实际机器人名测宽：名字短就少留空，名字长才让位（原来写死 112px，两头不讨好） */
  var labelW = 0;
  arr.forEach(function (d) { var w = measureW(d.robot, 11); if (w > labelW) labelW = w; });
  var leftPad = IS_MOBILE ? Math.max(40, Math.min(86, Math.ceil(labelW) + 8))
    : Math.max(44, Math.min(132, Math.ceil(labelW) + 12));
  anCharts.waitBar.setOption({
    grid: { left: leftPad, right: 20, top: 8, bottom: 28 },
    tooltip: tipOpt({ trigger: 'axis', formatter: function (p) { return p[0].name + '：' + fmtDurM(p[0].value); } }),
    xAxis: { type: 'value', axisLabel: { color: '#8b8f98', fontSize: 11, formatter: function (v) { return (v / 60000).toFixed(0) + '分'; } }, splitLine: { lineStyle: { color: '#20242c' } } },
    yAxis: {
      type: 'category', data: arr.map(function (d) { return d.robot; }), inverse: true,
      axisLabel: { color: '#c9cdd4', fontSize: 11, width: leftPad - 8, overflow: 'truncate' }
    },
    series: [{
      type: 'bar', data: arr.map(function (d) { return d.avg; }), barWidth: '58%',
      itemStyle: { color: gradFill('#7abaf6', '#275f9e', 'h'), borderRadius: [3, 7, 7, 3] },
      showBackground: true,
      backgroundStyle: { color: 'rgba(255,255,255,.035)', borderRadius: [3, 7, 7, 3] },
      emphasis: { itemStyle: { color: gradFill('#a3d1ff', '#3579c0', 'h') } }
    }]
  });
}
function anHeat(heat) {
  var days = ['一', '二', '三', '四', '五', '六', '日'];
  var data = [], maxV = 0;
  for (var w = 0; w < 7; w++) for (var h = 0; h < 24; h++) { var v = heat[w][h]; if (v > maxV) maxV = v; data.push([h, w, v]); }
  anCharts.heat.setOption({
    tooltip: tipOpt({ position: 'top', formatter: function (p) { return '周' + days[p.value[1]] + ' ' + pad(p.value[0]) + '时：' + p.value[2] + ' 次'; } }),
    /* 手机上绘图区只有 300px 左右，24 个小时刻度必须缩号，否则标签互相叠字 */
    grid: { left: IS_MOBILE ? 36 : 42, right: 16, top: 8, bottom: 78 },
    xAxis: { type: 'category', data: Array.from({ length: 24 }, function (_, i) { return i; }), axisLabel: { color: '#8b8f98', fontSize: IS_MOBILE ? 9 : 11 }, splitArea: { show: false } },
    yAxis: { type: 'category', data: days.map(function (d) { return '周' + d; }), axisLabel: { color: '#c9cdd4', fontSize: 11 } },
    visualMap: {
      min: 0, max: (maxV || 1), calculable: true, orient: 'horizontal', left: 'center', bottom: 4,
      itemWidth: 10, itemHeight: 92, itemGap: 5,
      textStyle: { color: '#8b8f98', fontSize: 10 },
      inRange: { color: ['#151b24', '#1e4e7d', '#378ADD', '#e0a13c', '#e05c52'] }
    },
    series: [{
      type: 'heatmap', data: data, label: { show: false },
      itemStyle: { borderColor: 'rgba(10,13,18,.85)', borderWidth: 2, borderRadius: 5 },
      emphasis: {
        itemStyle: {
          borderColor: '#fff', borderWidth: 1.5,
          shadowBlur: 12, shadowColor: 'rgba(0,0,0,.6)'
        }
      }
    }]
  });
}
function anRobotTbl(byRobot) {
  var rows = Object.keys(byRobot).map(function (k) { return byRobot[k]; }).sort(function (a, b) { return b.count - a.count; });
  var html = '<thead><tr><th>机器人</th><th>记录数</th><th>失败</th><th>失败率</th><th>平均排队</th><th>平均运行</th></tr></thead><tbody>';
  rows.forEach(function (u) {
    var fr = u.count ? u.failed / u.count * 100 : 0;
    html += '<tr><td>' + esc(u.robot) + '</td><td>' + u.count + '</td><td>' + u.failed + '</td>' +
      '<td' + (fr >= 20 ? ' style="color:#E24B4A"' : '') + '>' + fr.toFixed(0) + '%</td>' +
      '<td>' + fmtDurM(u.waitN ? u.waitSum / u.waitN : 0) + '</td>' +
      '<td>' + fmtDurM(u.runN ? u.runSum / u.runN : 0) + '</td></tr>';
  });
  html += '</tbody>';
  document.getElementById('robotTbl').innerHTML = html;
}
function anFailTbl(recs) {
  var fails = recs.filter(function (r) { return r.status === 'Failed'; });
  var html = '<thead><tr><th>开始时间</th><th>机器人</th><th>应用</th><th>触发方式</th><th>流程编号</th></tr></thead><tbody>';
  fails.forEach(function (r) {
    html += '<tr><td>' + fmtTime(r.start) + '</td><td>' + esc(r.robot) + '</td><td>' + esc(r.name || r.app) + '</td><td>' + wayCN(r.way) + '</td><td>' + esc(r.id || '') + '</td></tr>';
  });
  html += '</tbody>';
  document.getElementById('failTbl').innerHTML = html;
  document.getElementById('failCount').textContent = '共 ' + fails.length + ' 条失败';
  window.__fails = fails;
}
function anExport() {
  var fails = window.__fails || [];
  if (!fails.length) { alert('没有失败记录'); return; }
  var head = ['开始时间', '机器人', '应用', '触发方式', '流程编号', '状态'];
  var lines = [head.join(',')];
  fails.forEach(function (r) {
    var row = [fmtTime(r.start), r.robot, r.name || r.app, wayCN(r.way), r.id || '', '失败'];
    lines.push(row.map(function (x) { return '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"'; }).join(','));
  });
  var blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = '失败运行记录_' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
}

/* ==================== 详情视图 ==================== */
function fld(k, v) { return '<div class="field"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'; }
function renderDetail() {
  var app = document.getElementById("app");
  if (typeof lgReset === "function") lgReset();   // 释放上一个详情的 Monaco 编辑器与模型
  var rec = DETAIL_REC;
  if (!rec) {
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
    + (runMs != null ? fld("运行时长", fmtDur(runMs)) : "")
    + '</div></div>';
  var logCard = '<div class="card log-card">'
    + '<div class="log-head"><h3>日志内容</h3>'
    + '<div class="log-tools">'
    + '<span class="stat" id="logStat">—</span>'
    + '<input class="find" id="logFind" type="search" placeholder="搜索关键词" disabled>'
    + '<button class="chip" id="btnPrev" disabled>上一处</button>'
    + '<button class="chip" id="btnNext" disabled>下一处</button>'
    + '<button class="chip" id="btnOnlyErr" disabled>仅看异常</button>'
    + '</div>'
    + '</div>'
    + '<div class="log-tabs" id="logTabs"></div>'
    + '<div class="log-body">'
    + '<div id="logbox" class="tip">正在读取日志…</div>'
    + '</div></div>';
  app.innerHTML = '<div class="detail-wrap">' + info + logCard + '</div>';
  lgInit();
  loadLogs();
}
/* ==================== 日志查看（Monaco 只读编辑器，VSCode 同款高亮） ==================== */
var LOG_PAGE = 5000;
var LOG_FILES = [];   // [{name,size,total,loaded,content,hasMore,pending}]
/* 详情页深链：从日志检索/合规看板跳来时带 {kw, file}，日志加载完成后自动切文件 + 定位关键词 */
var LG_LINK = null;
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

function ensureMonaco() {
  if (LOGM.ready) return LOGM.ready;
  LOGM.ready = new Promise(function (resolve, reject) {
    if (!window.require) { reject(new Error("loader 未加载")); return; }
    require.config({ paths: { vs: "/monaco/vs" } });
    require(["vs/editor/editor.main"], function () {
      resolve(window.monaco);
    }, function (err) { reject(err); });
  });
  return LOGM.ready;
}

function logSetupLanguage(monaco) {
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

function logEditorCreate() {
  var host = document.getElementById("logbox");
  if (!host) return Promise.reject(new Error("logbox 不存在"));
  return ensureMonaco().then(function (monaco) {
    if (!LOGM.editor) {
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
      LOGM.editor.updateOptions(lgViewOptions());   // 与屏幕宽度相关的选项按桌面/手机分流
      // 点击最左行号 / 行首箭头：展开或收起超长行（普通行不响应）
      LOGM.editor.onMouseDown(function (e) {
        var mc = window.monaco, t = e.target;
        if (!mc || !t) return;
        if (t.type !== mc.editor.MouseTargetType.GUTTER_LINE_NUMBERS &&
          t.type !== mc.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
        var line = (t.position && t.position.lineNumber) || (t.range && t.range.startLineNumber);
        if (!line) return;
        lgFoldToggle(LOGM.active, line, LOG_FOLD.pendingTop);
      });
      // 捕获阶段记录按下时的 scrollTop：Monaco 对行号点击会选中整行并 reveal 到行尾，
      // 超长行会瞬间位移上万 px，必须赶在它处理之前把"用户视线位置"记下来
      host.addEventListener("mousedown", function () {
        LOG_FOLD.pendingTop = LOGM.editor ? LOGM.editor.getScrollTop() : null;
      }, true);
    }
    return monaco;
  });
}

/* ---- 行级别判定（沿用手写规则：0 普通 / 1 错误 / 2 警告 / 3 成功） ---- */
var LG_RE = /(error|exception|traceback|fail(?:ed)?|fatal|失败|错误|异常|中断|中止)|(warn(?:ing)?|timeout|retry|警告|重试|超时(?![[\[0-9]))|(success(?:ful)?|succeed|done|finish(?:ed)?|成功|完成)/gi;
var LG_EXC = /(已启用异常监控|触发错误处理的|忽略异常并执行)/;
function lgLineLevel(line) {
  if (!line || line.length > 20000) return 0;
  if (LG_EXC.test(line)) return 0;
  var lv = 0, m;
  LG_RE.lastIndex = 0;
  while ((m = LG_RE.exec(line)) !== null) {
    var c = m[1] ? 1 : (m[2] ? 2 : 3);
    if (c === 1) return 1;
    if (lv === 0 || c < lv) lv = c;
  }
  return lv;
}

/* ---- 超长行折叠：wrap 后超过 3 个显示行的行默认收起，点击最左行号展开/收起 ----
   Monaco 不支持单行折叠，实现方式：截短该行文本（保留约 3 行宽预览）+ 行下插入提示条（view zone），
   行号不变（单行替换单行），尾部增量追加按行号定位不受影响。 */
var LOG_FOLD = {
  keepRows: 2.5,   // 折叠时保留的显示行宽度（预留断词提前量，实际显示约 3 行）
  minRows: 3,      // 估算超过 3 个显示行才折叠
  maps: [],        // per-file: { [行号]: {origText, previewText, estLines, folded, zoneId} }
  pendingTop: null // 最近一次按下鼠标时的 scrollTop（Monaco 行号点击会 reveal 到行尾，需提前记录）
};

function lgFoldWrapCol() {        // 当前 wrap 生效的每行列数
  try {
    var wi = LOGM.editor.getOption(window.monaco.editor.EditorOption.wrappingInfo);
    if (wi && wi.wrappingColumn > 20) return wi.wrappingColumn;
  } catch (e) { }
  var host = document.getElementById("logbox");
  var w = host ? host.clientWidth : 0;
  return w > 100 ? Math.floor(w / 7.2) : 160;   // 兜底：12.5px 等宽字符宽约 7.2px
}

function lgFoldCols(s) {          // 估算显示列宽（CJK/全角 ≈ 2 列）
  var n = 0;
  for (var i = 0; i < s.length; i++) n += s.charCodeAt(i) > 0x2e80 ? 2 : 1;
  return n;
}

function lgFoldScan(fi) {         // 扫描未管理的超长行并折叠（增量安全，可重复调用）
  var monaco = window.monaco;
  var m = LOGM.models[fi];
  if (!monaco || !m || !LOGM.editor) return;
  var wrapCol = lgFoldWrapCol();
  if (!(wrapCol > 20)) return;
  var map = LOG_FOLD.maps[fi] || (LOG_FOLD.maps[fi] = {});
  var minCols = wrapCol * LOG_FOLD.minRows;
  var keepCols = wrapCol * LOG_FOLD.keepRows;
  var edits = [], lc = m.getLineCount(), i, text;
  for (i = 1; i <= lc; i++) {
    if (map[i]) continue;                       // 已管理（折叠中或手动展开过）不再处理
    text = m.getLineContent(i);
    if (text.length * 2 <= minCols) continue;   // 快速排除（即使全 CJK 也达不到阈值）
    if (lgFoldCols(text) <= minCols) continue;
    var rec = {
      origText: text,
      previewText: text.slice(0, lgFoldCutPos(text, keepCols)) + " …",
      estLines: Math.ceil(lgFoldCols(text) / wrapCol),
      folded: true, zoneId: null
    };
    map[i] = rec;
    edits.push({ range: new monaco.Range(i, 1, i, text.length + 1), text: rec.previewText, forceMoveMarkers: true });
  }
  if (!edits.length) return;
  m.applyEdits(edits);
  if (LOGM.active === fi) lgFoldReattach(fi);
}

function lgFoldCutPos(text, keepCols) {   // 截断点：保留约 keepCols 列，回退到最近空格让断点自然些
  var cols = 0, i = 0, w;
  for (; i < text.length; i++) {
    w = text.charCodeAt(i) > 0x2e80 ? 2 : 1;
    if (cols + w > keepCols) break;
    cols += w;
  }
  if (i < text.length) {
    var j = i, back = 0;
    while (j > 0 && back < 80 && text.charAt(j - 1) !== " ") { j--; back += text.charCodeAt(j) > 0x2e80 ? 2 : 1; }
    if (j > 0 && text.charAt(j - 1) === " ") i = j;
  }
  return Math.max(1, i);
}

function lgFoldToggle(fi, line, lockTop) {
  var map = LOG_FOLD.maps[fi];
  if (!map || !map[line]) { LOG_FOLD.pendingTop = null; return; }   // 普通行不响应
  lgFoldSetFolded(fi, line, !map[line].folded, lockTop);
  LOG_FOLD.pendingTop = null;
}

function lgFoldSetFolded(fi, line, folded, lockTop) {
  var monaco = window.monaco;
  var m = LOGM.models[fi];
  var rec = LOG_FOLD.maps[fi] && LOG_FOLD.maps[fi][line];
  if (!monaco || !m || !rec || rec.folded === folded) return;
  var ed = LOGM.editor;
  if (!ed) return;
  // 锚定"点击前"的 scrollTop：折叠行上方内容恒定（点击时行顶/提示条总在视口内），
  // 锁死 scrollTop 即可让上方行与折叠行视觉第一行都不动。
  // 注意：Monaco 对行号点击会选中整行并 reveal 到行尾（几百显示行的行会瞬间位移上万 px），
  // 随后内容高度骤变还可能 clamp/再调整，单次恢复会被覆盖——因此用点击前记录的值，
  // 在 300ms 内逐帧锁回；用户一旦滚轮立即放行。
  var st = (typeof lockTop === "number") ? lockTop : ed.getScrollTop();
  m.applyEdits([{
    range: new monaco.Range(line, 1, line, m.getLineMaxColumn(line)),
    text: folded ? rec.previewText : rec.origText, forceMoveMarkers: true
  }]);
  rec.folded = folded;
  if (LOGM.active === fi) lgFoldReattach(fi);
  var until = Date.now() + 300;
  var dom = ed.getDomNode();
  var user = false;
  var onWheel = function () { user = true; };
  if (dom) dom.addEventListener("wheel", onWheel, { once: true, passive: true });
  (function lock() {
    var cur = LOGM.editor;
    if (user || Date.now() > until || !cur) {
      if (dom) dom.removeEventListener("wheel", onWheel);
      return;
    }
    try {
      if (cur.getScrollTop() !== st) {
        cur.setScrollTop(st, monaco.editor.ScrollType.Immediate);
      }
    } catch (e2) {          // editor 已销毁等异常：终止锁
      if (dom) dom.removeEventListener("wheel", onWheel);
      return;
    }
    requestAnimationFrame(lock);
  })();
}

function lgFoldReattach(fi) {     // 重挂当前文件的折叠提示条 + 行首箭头（切换文件/状态变化时调用）
  var ed = LOGM.editor, monaco = window.monaco;
  var m = LOGM.models[fi];
  if (!ed || !monaco || !m || ed.getModel() !== m) return;
  var map = LOG_FOLD.maps[fi] || {};
  ed.changeViewZones(function (acc) {
    for (var k in map) {
      var rec = map[k];
      if (rec.zoneId) { try { acc.removeZone(rec.zoneId); } catch (e) { } rec.zoneId = null; }
      if (!rec.folded) continue;
      (function (line, rec2) {
        var dom = document.createElement("div");
        dom.className = "lg-fold-zone";
        dom.textContent = "⋯ 已折叠（约 " + rec2.estLines + " 行）· 点击行号展开";
        dom.addEventListener("click", function () {
          lgFoldSetFolded(fi, line, false, LOG_FOLD.pendingTop);
          LOG_FOLD.pendingTop = null;
        });
        rec2.zoneId = acc.addZone({ afterLineNumber: line, heightInLines: 1, domNode: dom, suppressMouseDown: true });
      })(+k, rec);
    }
  });
  lgFoldApplyDecos(fi);
}

function lgFoldApplyDecos(fi) {   // 行首箭头：▸ 已折叠 / ▾ 展开中，展开行加淡背景
  var monaco = window.monaco;
  var m = LOGM.models[fi];
  if (!monaco || !m || !LOGM.editor || LOGM.editor.getModel() !== m) return;
  var d = LOGM.decos[fi] || (LOGM.decos[fi] = { marks: [], hits: [] });
  d.folds = d.folds || [];
  var opts = [], map = LOG_FOLD.maps[fi] || {};
  for (var k in map) {
    var line = +k;
    opts.push({
      range: new monaco.Range(line, 1, line, 1), options: map[k].folded
        ? { glyphMarginClassName: "lg-fold-closed", glyphMarginHoverMessage: { value: "点击最左行号展开完整内容" } }
        : {
          glyphMarginClassName: "lg-fold-open", className: "lg-fold-open-bg",
          glyphMarginHoverMessage: { value: "点击最左行号收起该行" }
        }
    });
  }
  d.folds = m.deltaDecorations(d.folds, opts);
}

function lgFoldExpandHits(fi) {   // 搜索前：含关键词的折叠行自动展开，避免折叠内容漏搜
  var map = LOG_FOLD.maps[fi];
  if (!map || !LOGM.kw) return;
  var kw = LOGM.kw.toLowerCase();
  for (var k in map) {
    var rec = map[k];
    if (rec.folded && rec.origText.toLowerCase().indexOf(kw) >= 0) lgFoldSetFolded(fi, +k, false);
  }
}

/* ---- 模型同步：首页 setValue，后续增量 append（不重置滚动位置） ---- */
function logSyncModel(fi, offset, delta) {
  var monaco = window.monaco;
  var f = LOG_FILES[fi];
  if (!monaco || !f) return;
  var m = LOGM.models[fi];
  if (!m) {
    m = LOGM.models[fi] = monaco.editor.createModel(f.content, "log");
    LOGM.decos[fi] = { marks: [], hits: [] };
  } else if (offset === 0) {
    m.setValue(f.content);
    LOG_FOLD.maps[fi] = {};   // 重载首页：折叠状态清空重扫
  } else if (delta) {
    var last = m.getLineCount();
    var col = m.getLineMaxColumn(last);
    m.applyEdits([{
      range: new monaco.Range(last, col, last, col),
      text: (last > 1 || col > 1 ? "\n" : "") + delta,
      forceMoveMarkers: true
    }]);
  }
  lgFoldScan(fi);        // 超长行检测折叠（新进内容，已管理行自动跳过）
  lgScanMarks(fi);
  lgApplyMarkDecos(fi);
  if (LOGM.active === fi && LOGM.editor && LOGM.editor.getModel() !== m) {
    LOGM.editor.setModel(m);
    lgFoldReattach(fi);   // 首次 setModel 时 lgFoldScan 已先跑过（当时模型还没挂上编辑器，提示条/箭头被跳过），这里补挂
    logApplyHits();
  }
}

function lgScanMarks(fi) {
  var m = LOGM.models[fi];
  if (!m) { LOGM.fileMarks[fi] = []; return; }
  var map = LOG_FOLD.maps[fi] || {};
  var marks = [], lc = m.getLineCount();
  for (var i = 1; i <= lc; i++) {
    // 折叠行的级别判定用原文（预览文本可能截掉了级别词）
    var lv = lgLineLevel(map[i] ? map[i].origText : m.getLineContent(i));
    if (lv === 1 || lv === 2) marks.push({ line: i, lv: lv });
  }
  LOGM.fileMarks[fi] = marks;
}

function lgApplyMarkDecos(fi) {
  var monaco = window.monaco;
  var m = LOGM.models[fi];
  if (!m || !monaco) return;
  var d = LOGM.decos[fi] || (LOGM.decos[fi] = { marks: [], hits: [] });
  var opts = [], marks = LOGM.fileMarks[fi] || [];
  for (var i = 0; i < marks.length; i++) {
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
function logApplyHits() {
  var monaco = window.monaco;
  var fi = LOGM.active;
  var m = LOGM.models[fi];
  LOGM.matches = [];
  if (!m || !monaco || !LOGM.editor) return;
  lgFoldExpandHits(fi);   // 含关键词的折叠行先展开，保证搜索不漏
  var d = LOGM.decos[fi] || (LOGM.decos[fi] = { marks: [], hits: [] });
  var opts = [];
  if (LOGM.kw) {
    var found = m.findMatches(LOGM.kw, false, false, false, null, false, 20000);
    for (var i = 0; i < found.length; i++) {
      var r = found[i].range;
      LOGM.matches.push({ line: r.startLineNumber, col: r.startColumn, len: r.endColumn - r.startColumn });
      opts.push({ range: r, options: { className: "lg-hit", stickiness: 1 } });
    }
  }
  d.hits = m.deltaDecorations(d.hits, opts);
}

/* ---- 导航：有关键词时跳匹配处，否则跳异常行 ---- */
function lgNavTargets() {
  if (LOGM.kw) return LOGM.matches;
  return (LOGM.fileMarks[LOGM.active] || []).map(function (mk) {
    return { line: mk.line, col: 1, len: 0 };
  });
}
function lgGoTo(idx) {
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
function lgMarksTotal() {
  var e = 0, w = 0;
  for (var fi = 0; fi < LOGM.fileMarks.length; fi++) {
    var arr = LOGM.fileMarks[fi] || [];
    for (var i = 0; i < arr.length; i++) { if (arr[i].lv === 1) e++; else w++; }
  }
  return { total: e + w, err: e, warn: w };
}
function lgStatUpdate() {
  var el = document.getElementById("logStat");
  var t = lgMarksTotal();
  if (el) el.innerHTML = t.total
    ? ('共 <b>' + t.total + '</b> 处 · 错误 <b class="s-err">' + t.err + '</b> · 警告 <b class="s-warn">' + t.warn + '</b>')
    : '未发现异常';
  lgStatButtons();
}
function lgStatButtons() {
  var nav = LOGM.kw ? LOGM.matches.length : (LOGM.fileMarks[LOGM.active] || []).length;
  var b;
  b = document.getElementById("btnPrev"); if (b) b.disabled = nav === 0;
  b = document.getElementById("btnNext"); if (b) b.disabled = nav === 0;
  b = document.getElementById("btnOnlyErr"); if (b) b.disabled = lgMarksTotal().total === 0;
  b = document.getElementById("logFind"); if (b) b.disabled = false;
}

/* ---- 文件标签栏 + 加载更多按钮 ---- */
function logRenderTabs() {
  var bar = document.getElementById("logTabs");
  if (!bar) return;
  var h = '<div class="logtabs-list">';
  for (var i = 0; i < LOG_FILES.length; i++) {
    var f = LOG_FILES[i];
    var moreTxt = f.total ? (' · ' + f.total + ' 行') : '';
    h += '<button type="button" class="logtab' + (i === LOGM.active ? ' on' : '') + '" data-fi="' + i
      + '" title="' + esc(f.name) + '（' + fmtSize(f.size) + moreTxt + '）">'
      + '<span class="lt-name">📄 ' + esc(f.name) + '</span>'
      + '<span class="lt-meta">' + fmtSize(f.size) + moreTxt + '</span></button>';
  }
  h += '</div>';
  var fa = LOG_FILES[LOGM.active];
  if (fa) {
    if (fa.hasMore) {
      h += '<button type="button" class="btn-more" id="btnMore">加载更多（剩 ' + Math.max(0, fa.total - fa.loaded) + ' 行）</button>';
    } else if (fa.loaded) {
      h += '<span class="btn-more is-done">已全部加载</span>';
    }
  }
  bar.innerHTML = h;
  var tabs = bar.querySelectorAll(".logtab");
  for (var t = 0; t < tabs.length; t++) {
    (function (el) {
      el.addEventListener("click", function () {
        logSetActive(parseInt(el.getAttribute("data-fi"), 10));
      });
    })(tabs[t]);
  }
  var bm = document.getElementById("btnMore");
  if (bm) {
    bm.addEventListener("click", function () {
      loadLogPage(LOGM.active, LOG_FILES[LOGM.active].loaded);
    });
  }
}

function logSetActive(fi) {
  if (!LOG_FILES[fi]) return;
  LOGM.active = fi;
  LOGM.cur = -1;
  var f = LOG_FILES[fi];
  if (LOGM.editor) {
    var m = LOGM.models[fi];
    if (m) {
      LOGM.editor.setModel(m);
      lgFoldReattach(fi);   // 折叠提示条/箭头不随模型切换保留，切回时重挂
      logApplyHits();
    } else if (f.loaded === 0 && !f.pending) {
      loadLogPage(fi, 0);   // 首次切到该文件：加载首页，模型在返回后创建
    }
  }
  logRenderTabs();
  lgStatButtons();
  lgApplyLink();
}

/* ---- 深链定位：切到指定日志文件并把关键词搜索跑起来 ----
   时机：文件按页异步加载，所以这里在每次「一页加载完」与「切换文件」后被调用，
   模型还没就绪就原样保留 LG_LINK 等下一次回调，避免对着空模型做搜索。 */
function lgApplyLink() {
  if (!LG_LINK) return;
  if (LG_LINK.file) {
    var idx = -1, i;
    for (i = 0; i < LOG_FILES.length; i++) {
      if (LOG_FILES[i].name === LG_LINK.file) { idx = i; break; }
    }
    if (idx >= 0 && idx !== LOGM.active) {
      LG_LINK.file = null;              // 先清掉，避免 logSetActive 回调里再次进入选文件分支
      logSetActive(idx);
      return;                           // 关键词等目标文件模型就绪后由回调继续
    }
    LG_LINK.file = null;                // 找不到该文件：放弃选文件，只应用关键词
  }
  if (LG_LINK.kw) {
    if (!LOGM.models[LOGM.active]) return;   // 目标文件还没加载完，等下一次回调
    var inp = document.getElementById("logFind");
    if (inp) inp.value = LG_LINK.kw;
    LOGM.kw = LG_LINK.kw;
    logApplyHits();
    if (LOGM.matches.length) lgGoTo(0);
    lgStatButtons();
  }
  LG_LINK = null;
}

/* ---- 数据加载 ---- */
function loadLogs() {
  var box = document.getElementById("logbox");
  if (!box) return;
  if (!DETAIL_REC.log) {
    box.innerHTML = '<div class="tip">未配置该机器人的日志目录，无法确定日志路径。请在 robot_logs.json 中补充该机器人的共享日志目录（参考其他机器人配置）。</div>';
    lgStatUpdate();
    return;
  }
  var url = "/api/log?dir=" + encodeURIComponent(DETAIL_REC.log);
  box.innerHTML = '<div class="tip">正在读取日志目录…</div>';
  fetch(url, { credentials: 'same-origin' }).then(function (r) {
    if (r.status === 401) { location.href = '/login'; return; }
    return r.json();
  }).then(function (d) {
    if (!d || !d.ok) {
      box.innerHTML = '<div class="warn">⚠ 读取日志失败：' + esc((d && d.error) || "未知错误") + '</div>';
      lgStatUpdate();
      return;
    }
    if (!d.logs || d.logs.length === 0) {
      box.innerHTML = '<div class="tip">目录下没有 .log 文件。</div>';
      lgStatUpdate();
      return;
    }
    LOG_FILES = [];
    for (var i = 0; i < d.logs.length; i++) {
      LOG_FILES.push({
        name: d.logs[i].name, size: d.logs[i].size,
        total: d.logs[i].lines || 0, loaded: 0, content: "",
        hasMore: false, pending: false
      });
    }
    box.innerHTML = "";
    box.classList.remove("tip");
    logRenderTabs();
    logEditorCreate().then(function () {
      logRenderTabs();
      for (var i2 = 0; i2 < LOG_FILES.length; i2++) loadLogPage(i2, 0);
    }).catch(function (err) {
      box.innerHTML = '<div class="warn">⚠ 日志高亮组件加载失败（' + esc(String(err && err.message || err)) + '）。请确认 assets/monaco/ 与后端 /monaco/ 路由正常。</div>';
    });
  }).catch(function (e) {
    box.innerHTML = '<div class="warn">⚠ 无法连接本地服务器（' + esc(e && e.message ? e.message : e) + '）。请确认 start_server.bat 正在运行。</div>';
    lgStatUpdate();
  });
}

function loadLogPage(fi, offset) {
  var f = LOG_FILES[fi];
  if (!f || f.pending) return;
  f.pending = true;
  var btn = document.getElementById("btnMore");
  if (btn && LOGM.active === fi) { btn.disabled = true; btn.textContent = "加载中…"; }
  var url = "/api/log?dir=" + encodeURIComponent(DETAIL_REC.log)
    + "&file=" + encodeURIComponent(f.name)
    + "&offset=" + offset + "&limit=" + LOG_PAGE;
  fetch(url, { credentials: 'same-origin' }).then(function (r) {
    if (r.status === 401) { location.href = '/login'; return; }
    return r.json();
  }).then(function (d) {
    f.pending = false;
    if (!d || !d.ok) {
      var b0 = document.getElementById("btnMore");
      if (b0 && b0.tagName === "BUTTON") { b0.disabled = false; b0.textContent = "加载失败，点击重试"; }
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
    lgApplyLink();       // 深链：文件模型就绪后自动定位关键词
  }).catch(function () {
    f.pending = false;
    var b = document.getElementById("btnMore");
    if (b && b.tagName === "BUTTON") { b.disabled = false; b.textContent = "加载失败，点击重试"; }
  });
}

/* ---- 工具栏事件绑定（每次详情渲染调用） ---- */
function lgInit() {
  var b, f;
  b = document.getElementById("btnNext");
  if (b) b.addEventListener("click", function () { lgGoTo(LOGM.cur + 1); });
  b = document.getElementById("btnPrev");
  if (b) b.addEventListener("click", function () { lgGoTo(LOGM.cur - 1); });
  b = document.getElementById("btnOnlyErr");
  if (b) b.addEventListener("click", function () {
    LOGM.only = !LOGM.only;
    this.className = LOGM.only ? "chip on" : "chip";
    this.textContent = LOGM.only ? "聚焦异常" : "仅看异常";
    var box = document.getElementById("logbox");
    if (box) box.classList.toggle("lg-only", LOGM.only);
    if (LOGM.only && !LOGM.kw && (LOGM.fileMarks[LOGM.active] || []).length) lgGoTo(0);
  });
  f = document.getElementById("logFind");
  if (f) {
    var timer = 0;
    f.addEventListener("input", function () {
      var v = this.value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        LOGM.kw = v.trim();
        LOGM.cur = -1;
        logApplyHits();
        if (LOGM.kw && LOGM.matches.length) lgGoTo(0);
        lgStatButtons();
      }, 300);
    });
    f.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { lgGoTo(LOGM.cur + (e.shiftKey ? -1 : 1)); e.preventDefault(); }
    });
  }
}

/* ---- 释放（详情重建 / 离开详情页时调用） ---- */
function lgReset() {
  if (LOGM.editor) { try { LOGM.editor.dispose(); } catch (e) { } LOGM.editor = null; }
  for (var i = 0; i < LOGM.models.length; i++) {
    if (LOGM.models[i]) { try { LOGM.models[i].dispose(); } catch (e) { } }
  }
  LOGM.models = []; LOGM.decos = []; LOGM.fileMarks = []; LOGM.matches = [];
  LOG_FOLD.maps = [];
  LOGM.cur = -1; LOGM.kw = ""; LOGM.only = false; LOGM.active = 0;
  LOG_FILES = [];
  var el = document.getElementById("logStat");
  if (el) { el.textContent = "—"; el.removeAttribute("title"); }
  var ids = ["btnPrev", "btnNext", "btnOnlyErr", "logFind"], b, j;
  for (j = 0; j < ids.length; j++) {
    b = document.getElementById(ids[j]);
    if (b) { b.disabled = true; if (ids[j] === "btnOnlyErr") { b.className = "chip"; b.textContent = "仅看异常"; } }
  }
  var f = document.getElementById("logFind");
  if (f) f.value = "";
  var box = document.getElementById("logbox");
  if (box) box.classList.remove("lg-only");
}

/* ==================== 日程视图 ==================== */
var WEEK_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
var scChart = null, scEl = null;
var lastRowInfo = [], lastTimes = [], scView = 'week', scFilter = '__ALL__', scStatus = 'enabled';
function scTimeText(t) {
  var hh = Math.floor(t), mm = Math.round((t - hh) * 60);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}
function scMatchRobot(r, filter) {
  if (filter === '__ALL__') return true;
  if (filter === '__SUXI__') return r.indexOf('硕晞') >= 0;
  if (filter === '__BAOSHI__') return r.indexOf('宝实') >= 0;
  return r === filter;
}
function scBuildPoints(view, robot, status) {
  var pts = [];
  var src = view === 'week' ? SCHED.week : SCHED.month;
  Object.keys(src).forEach(function (r) {
    if (!scMatchRobot(r, robot)) return;
    Object.keys(src[r]).forEach(function (k) {
      var xi = view === 'week' ? +k : SCHED.monthLabels.indexOf(k + '日');
      if (xi < 0) return;
      src[r][k].forEach(function (p) {
        if (status === 'enabled' && !p.enabled) return;
        if (status === 'disabled' && p.enabled) return;
        pts.push({ x: xi, t: p.t, app: p.app, short: p.short, color: p.color, robot: r, enabled: p.enabled });
      });
    });
  });
  return pts;
}
function scTimeToY(t, rowInfo, times) {
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
function scUpdateLines() {
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
    series: [{
      markLine: {
        silent: true, symbol: 'none',
        lineStyle: { color: '#E24B4A', width: 2 },
        label: {
          formatter: function (p) { return p.data.name === 'now' ? scTimeText(t) : ''; },
          color: '#E24B4A', fontSize: 11, position: 'insideEndTop'
        },
        data: lineData
      }
    }]
  });
}
function scRender(view, filter, status) {
  scView = view;
  var xLabels = view === 'week' ? WEEK_LABELS : SCHED.monthLabels;
  var isMonth = view === 'month';
  var pts = scBuildPoints(view, filter, status);
  var merged = {};
  pts.forEach(function (p) {
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
  Object.keys(merged).forEach(function (k) { if (times.indexOf(merged[k].t) < 0) times.push(merged[k].t); });
  times.sort(function (a, b) { return b - a; });
  var idx = {};
  times.forEach(function (t, i) { idx[t] = i; });
  var groups = {};
  Object.keys(merged).forEach(function (k) {
    var m = merged[k];
    m.x0 = Math.min.apply(null, m.xs);
    m.x1 = Math.max.apply(null, m.xs);
    (groups[m.t] = groups[m.t] || []).push(m);
  });
  var rowInfo = [];
  var rowInfo = [];
  var acc = 0;
  times.forEach(function (t, i) {
    var n = groups[t].length;
    var h = Math.max(1, n);
    rowInfo.push({ t: t, center: acc + h / 2, h: h });
    acc += h;
  });
  var yMax = acc;
  lastRowInfo = rowInfo;
  lastTimes = times;
  var data = [];
  Object.keys(groups).forEach(function (t) {
    var arr = groups[t], n = arr.length;
    arr.forEach(function (m, i) {
      data.push({
        value: [m.x0, m.x1, idx[m.t], i, n, m.color, m.short],
        app: m.app, t: m.t, items: m.items,
        tooltip: {
          formatter: function () {
            var labels = scView === 'month' ? SCHED.monthLabels : WEEK_LABELS;
            var range = m.x0 === m.x1 ? labels[m.x0] : (labels[m.x0] + ' - ' + labels[m.x1]);
            var robots = [];
            m.items.forEach(function (it) {
              var label = it.enabled ? it.robot : it.robot + '（停用）';
              if (robots.indexOf(label) < 0) robots.push(label);
            });
            return '<b>' + m.app + '</b><br/>' + range + ' ' + scTimeText(m.t) + '<br/>' + robots.join('、');
          }
        }
      });
    });
  });
  scLastData = data;
  scChart.setOption({
    backgroundColor: 'transparent',
    tooltip: tipOpt({ trigger: 'item' }),
    grid: { left: IS_MOBILE ? 38 : 44, right: 16, top: 10, bottom: isMonth ? 46 : 34 },
    xAxis: {
      type: 'category', data: xLabels,
      axisLabel: { color: '#8b8f98', interval: 0, rotate: isMonth ? 40 : 0, fontSize: IS_MOBILE ? 10 : 11 },
      axisLine: { lineStyle: { color: '#333' } }
    },
    yAxis: {
      type: 'value', min: 0, max: yMax, interval: 1,
      axisLabel: {
        color: '#8b8f98', fontSize: 11,
        formatter: function (v) {
          var best = null, bd = 1e9;
          rowInfo.forEach(function (r) {
            var d = Math.abs(r.center - v);
            if (d < bd) { bd = d; best = r.t; }
          });
          return best !== null ? scTimeText(best) : '';
        }
      },
      splitLine: { show: false },
      axisLine: { lineStyle: { color: '#333' } }
    },
    series: [{
      type: 'custom', data: data,
      renderItem: function (params, api) {
        var colW = api.size([1, 0])[0];
        var unitPx = api.size([0, 1])[1];
        var bh = Math.max(12, unitPx * 0.9);
        var ri = rowInfo[api.value(2)];
        var x0 = api.coord([api.value(0), ri.center])[0] - colW / 2;
        var x1 = api.coord([api.value(1), ri.center])[0] + colW / 2;
        var yBase = api.coord([api.value(0), ri.center])[1];
        var off = (api.value(3) - (api.value(4) - 1) / 2) * unitPx;
        var bw = Math.max(5, x1 - x0);
        return {
          type: 'rect',
          shape: {
            x: x0, y: yBase + off - bh / 2, width: bw, height: bh,
            r: Math.min(5, bw / 2, bh / 2)
          },
          style: {
            fill: api.value(5), stroke: 'rgba(255,255,255,.22)', lineWidth: 1,
            text: api.value(6), textPosition: 'inside',
            textFill: '#0b0e13', fontSize: IS_MOBILE ? 11 : 20, fontWeight: 500,
            overflow: 'truncate', fontFamily: 'inherit'
          }
        };
      },
      /* 灰阶格子用描边 + 投影表达「高亮」；同项目的其余块由 mouseover 里的
         dispatchAction 批量点亮（见 scInit 绑定），不在 renderItem 里做判断 */
      emphasis: {
        focus: 'none',
        itemStyle: {
          fill: 'rgba(230,240,250,.95)', stroke: '#ffffff', lineWidth: 2,
          shadowBlur: 20, shadowColor: 'rgba(0,0,0,.75)'
        }
      }
    }]
  }, true);
  scUpdateLines();
}
function scFillSelect(id, options, onChange) {
  var sel = document.getElementById(id);
  sel.innerHTML = '';
  options.forEach(function (o) {
    var op = document.createElement('option');
    op.value = o[0]; op.textContent = o[1];
    sel.appendChild(op);
  });
  sel.addEventListener('change', function () { onChange(sel.value); });
}
function scResize() { if (scChart) scChart.resize(); }
function scInit() {
  if (!SCHED || !SCHED.ok) return;
  document.getElementById('sTotal').textContent = SCHED.stats.total;
  document.getElementById('sEnabled').textContent = SCHED.stats.enabled;
  document.getElementById('sDisabled').textContent = SCHED.stats.disabled;
  document.getElementById('sWebhook').textContent = SCHED.stats.webhook;
  scEl = document.getElementById('c1');
  if (scChart) { try { scChart.dispose(); } catch (e) { } }
  scChart = echarts.init(scEl);
  scChart.on('mouseover', function (params) {
    if (!params || params.seriesIndex !== 0 || typeof params.dataIndex !== 'number') return;
    var it = scLastData && scLastData[params.dataIndex];
    if (it && it.app) scHighlight(it.app);
  });
  scChart.on('mouseout', scUnhighlight);
  scChart.on('globalout', scUnhighlight);
  scFillSelect('selView', [['week', '每周'], ['month', '每月']], function (v) { scRender(v, scFilter, scStatus); });
  scFillSelect('selRobot',
    [['__ALL__', '全部机器人'], ['__SUXI__', '所有硕晞'], ['__BAOSHI__', '所有宝实']]
      .concat(SCHED.robots.slice().sort().map(function (r) { return [r, r]; })),
    function (v) { scFilter = v; scRender(scView, v, scStatus); });
  scFillSelect('selStatus', [['enabled', '已启用'], ['disabled', '已停用'], ['__ALL__', '全部状态']],
    function (v) { scStatus = v; scRender(scView, scFilter, v); });
  scRender('week', '__ALL__', 'enabled');
}
/* 排期数据更新后重载：刷新统计卡 + 按当前筛选状态重绘（不重建选择器，保留用户选择） */
function scReload() {
  if (!SCHED || !SCHED.ok || !scChart) return;
  document.getElementById('sTotal').textContent = SCHED.stats.total;
  document.getElementById('sEnabled').textContent = SCHED.stats.enabled;
  document.getElementById('sDisabled').textContent = SCHED.stats.disabled;
  document.getElementById('sWebhook').textContent = SCHED.stats.webhook;
  scRender(scView, scFilter, scStatus);
}
/* 排期导出：按当前筛选条件请后端生成 xlsx，前端收 Blob 触发下载（不落盘、不跳页） */
function scExport() {
  var btn = document.getElementById('scExport');
  if (!btn || btn.disabled) return;
  var label = btn.textContent;
  btn.disabled = true; btn.textContent = '导出中…';
  var done = function () { btn.disabled = false; btn.textContent = label; };
  var url = '/api/schedule/export?view=' + encodeURIComponent(scView)
    + '&robot=' + encodeURIComponent(scFilter) + '&status=' + encodeURIComponent(scStatus);
  fetch(url, { credentials: 'same-origin' }).then(function (res) {
    if (res.status === 401) { location.href = '/login'; return null; }
    var ct = res.headers.get('Content-Type') || '';
    if (ct.indexOf('json') >= 0) {
      // 筛选条件无数据 / 生成失败：后端返回 JSON 说明，这里转成提示
      return res.json().then(function (d) { throw new Error((d && d.error) || '导出失败'); });
    }
    var name = '触发器排期.xlsx';
    var m = /filename\*=UTF-8''([^;]+)/i.exec(res.headers.get('Content-Disposition') || '');
    if (m) { try { name = decodeURIComponent(m[1]); } catch (e) { } }
    return res.blob().then(function (b) { return { blob: b, name: name }; });
  }).then(function (o) {
    if (!o) return;
    var href = URL.createObjectURL(o.blob);
    var a = document.createElement('a');
    a.href = href; a.download = o.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(href); }, 5000);
  }).catch(function (e) {
    alert('导出失败：' + (e && e.message ? e.message : e));
  }).then(done);
}
document.getElementById('scExport').addEventListener('click', scExport);
setInterval(scUpdateLines, 10000);

/* ==================== 自动更新 ==================== */
/* 自动更新进行中：在开关圆钮里转圈（纯视觉反馈，不动开关的勾选状态） */
function swBusy(on) {
  var sw = document.querySelector('#autoCtl .switch');
  if (sw) sw.classList.toggle('busy', !!on);
}
function refreshData(force, done) {
  // 只有自动更新（非 force）才转圈；「立刻更新」按钮自带「更新中…」文案，不重复提示
  if (!force) swBusy(true);
  var finish = function (ok) { if (!force) swBusy(false); if (done) done(ok); };
  fetch((force ? '/api/refresh?force=1' : '/api/refresh'), { method: 'POST', credentials: 'same-origin' }).then(function (r) {
    if (r.status === 401) { location.href = '/login'; return; }
    return r.json();
  }).then(function (d) {
    var warnEl = document.getElementById('refreshWarn');
    var okFlag = false;
    if (d && d.ok && Array.isArray(d.records)) {
      okFlag = true;
      if (warnEl) warnEl.style.display = 'none';
      RECORDS = d.records;
      if (curView === 'timeline') { records = RECORDS.slice(); recomputeBounds(); tlRender(); }
      else if (curView === 'analysis' && anReady) anRenderAll(RECORDS);
      else if (curView === 'botstatus') bsLoad().then(bsRender);
      else if (curView === 'compliance') cpLoad();
      else if (curView === 'schedule' && force) {
        // 排期页仅在「立刻更新」（全量抓，含触发器）后重载；自动更新只抓运行记录，不影响排期
        loadSchedule().then(function () { scReload(); });
      }
      if (d.time) document.getElementById('dataTime').textContent = d.time;
    } else if (warnEl) {
      warnEl.style.display = 'block';
      if (d && d.time) document.getElementById('dataTime').textContent = d.time + '（刷新失败）';
    }
    finish(okFlag);
  }).catch(function () { finish(false); });
}
document.getElementById('btnRefreshNow').addEventListener('click', function () {
  var btn = this;
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = '更新中…';
  refreshData(true, function (ok) {
    btn.textContent = ok ? '✓ 已更新' : '✗ 失败';
    setTimeout(function () { btn.textContent = '立刻更新'; btn.disabled = false; }, 2000);
  });
});
/* 自动更新：每 60s 拉一次运行记录（--only-runs，不含触发器排期），仅在依赖实跑数据的视图生效 */
function autoTick() {
  if (curView === 'timeline' || curView === 'analysis' || curView === 'botstatus') refreshData();
}
document.getElementById('chkAuto').addEventListener('change', function () {
  if (this.checked) {
    autoTick();
    if (!autoTimer) autoTimer = setInterval(autoTick, 60000);
  } else {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  }
});
document.getElementById('btnBack').addEventListener('click', function () {
  // 返回上一页（时间轴/项目控制台等任意入口）；无历史时兜底回时间轴
  var cur = location.hash;
  history.back();
  setTimeout(function () { if (location.hash === cur) location.hash = '#/timeline'; }, 300);
});
/* ==================== 运行机器人选择弹窗 ==================== */
/* 触发运行前先让用户明确选择在哪台机器人上跑（而不是盲目由平台分配）。
   详情页「重新运行」与项目控制台「运行该应用」共用本弹窗。 */
var RUN_CTX = null;        // {endpoint, flowId, name, onDone}
var RUN_OFF_SHOWN = false; // 「离线/停用机器人」是否展开

function runOpenDialog(ctx) {
  if (!ctx.flowId) { alert('该记录缺少流程 ID，无法触发运行'); return; }
  RUN_CTX = ctx;
  RUN_OFF_SHOWN = false;
  document.getElementById('runModalTitle').textContent = '选择执行机器人';
  document.getElementById('runModalSub').innerHTML =
    '将立即触发一次执行：「<b>' + esc(ctx.name) + '</b>」';
  document.getElementById('runModalErr').textContent = '';
  document.getElementById('runBotList').innerHTML =
    '<div class="run-bot-empty">正在读取机器人列表…</div>';
  document.getElementById('runModal').style.display = 'flex';
  api('/api/bots?flow_id=' + encodeURIComponent(ctx.flowId)).then(function (d) {
    if (!RUN_CTX || RUN_CTX.flowId !== ctx.flowId) return;   // 期间已关闭/切换
    runRenderBots(d);
  }).catch(function (e) {
    document.getElementById('runBotList').innerHTML =
      '<div class="run-bot-empty">机器人列表读取失败：' + esc(String(e)) +
      '<br/>可直接「确认运行」，交由平台按历史记录分配。</div>';
  });
}

function runBotMeta(b) {
  var m = [];
  if (b.machine) m.push('机器 ' + esc(b.machine));
  m.push(b.connected === false ? '<span class="run-bot-bad">离线</span>' : '在线');
  if (b.enabled === false) m.push('<span class="run-bot-bad">已停用</span>');
  if (b.busy) m.push('<span class="run-bot-bad">有任务在跑</span>');
  if (b.runs) {
    var t = Date.parse(b.last_time);
    m.push('本流程跑过 ' + b.runs + ' 次' + (isNaN(t) ? '' : ' · 最近 ' + fmtTime(t))
      + (b.last_status ? '（' + (STATUS_CN[b.last_status] || b.last_status) + '）' : ''));
  }
  return m.join(' · ');
}

function runRenderBots(d) {
  var items = (d && d.items) || [];
  var auto = null;
  var groups = [
    { title: '本流程运行过的机器人', rows: [] },
    { title: '在线可用的其他机器人', rows: [] },
    { title: '离线 / 已停用机器人', rows: [] }
  ];
  items.forEach(function (b) {
    if (b.recommended && !auto) auto = b;
    groups[b.runs ? 0 : ((b.connected && b.enabled !== false) ? 1 : 2)].rows.push(b);
  });
  var pick = d && d.recommended ? d.recommended : '';
  var html = '<label class="run-bot-item auto">'
    + '<input type="radio" name="runBot" value=""' + (pick ? '' : ' checked') + '>'
    + '<span class="run-bot-body"><span class="run-bot-name">不指定，由平台分配</span>'
    + '<span class="run-bot-meta">' + (auto ? '将复用本流程最近运行的「' + esc(auto.name) + '」'
      : '该流程无历史运行记录，可能分配到无权限的机器人') + '</span></span></label>';
  groups.forEach(function (g, gi) {
    if (!g.rows.length) return;
    if (gi === 2) {   // 离线/停用机器人默认收起，避免刷屏
      html += '<button type="button" class="run-bot-toggle" id="runBotToggle">'
        + '显示 ' + g.rows.length + ' 台离线 / 已停用机器人 ▾</button>';
      html += '<div class="run-bot-group-box" id="runBotOffBox" style="display:none;">';
    }
    html += '<div class="run-bot-group">' + g.title + '</div>';
    g.rows.forEach(function (b) {
      var off = (b.connected === false || b.enabled === false);
      html += '<label class="run-bot-item' + (off ? ' off' : '') + '">'
        + '<input type="radio" name="runBot" value="' + esc(b.bot_id) + '"'
        + (b.bot_id === pick ? ' checked' : '') + '>'
        + '<span class="run-bot-body"><span class="run-bot-name">' + esc(b.name || b.bot_id)
        + (b.recommended ? '<i class="run-bot-tag">推荐</i>' : '') + '</span>'
        + '<span class="run-bot-meta">' + runBotMeta(b) + '</span></span></label>';
    });
    if (gi === 2) html += '</div>';
  });
  var box = document.getElementById('runBotList');
  box.innerHTML = html;
  var tg = document.getElementById('runBotToggle');
  if (tg) tg.addEventListener('click', function () {
    RUN_OFF_SHOWN = !RUN_OFF_SHOWN;
    document.getElementById('runBotOffBox').style.display = RUN_OFF_SHOWN ? '' : 'none';
    tg.textContent = (RUN_OFF_SHOWN ? '收起这 ' + groups[2].rows.length + ' 台'
      : '显示 ' + groups[2].rows.length + ' 台') + '离线 / 已停用机器人 '
      + (RUN_OFF_SHOWN ? '▴' : '▾');
  });
}

function runClose() {
  RUN_CTX = null;
  document.getElementById('runModal').style.display = 'none';
}

function runConfirm() {
  if (!RUN_CTX) return;
  var sel = document.querySelector('#runBotList input[name="runBot"]:checked');
  var botId = sel ? sel.value : '';
  var label = '不指定（平台分配）';
  if (botId) {
    var nm = sel.parentNode.querySelector('.run-bot-name');
    label = (nm ? nm.textContent.replace('推荐', '') : botId);
  }
  var ctx = RUN_CTX;
  document.getElementById('runModalErr').textContent = '';
  glShow('正在触发运行…');
  var body = { flow_id: ctx.flowId };
  if (botId) body.bot_id = botId;
  fetch(ctx.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      glHide();
      if (j && j.ok) {
        runClose();
        alert('已触发运行，批次号：' + (j.flowProcessNo || '—')
          + '\n执行机器人：' + (j.botName || label)
          + '\n任务已进入队列，可返回列表查看实时状态。');
        if (typeof ctx.onDone === 'function') ctx.onDone(j);
      } else {
        document.getElementById('runModalErr').textContent =
          '运行失败：' + ((j && (j.message || j.error)) || '未知错误');
      }
    })
    .catch(function (e) {
      glHide();
      document.getElementById('runModalErr').textContent = '请求失败：' + e;
    });
}

document.getElementById('runCancel').addEventListener('click', runClose);
document.getElementById('runConfirm').addEventListener('click', runConfirm);
document.getElementById('runModal').addEventListener('click', function (e) {
  if (e.target === this) runClose();   // 点遮罩空白处关闭
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && RUN_CTX) runClose();
});

document.getElementById('btnRerun').addEventListener('click', function () {
  var rec = DETAIL_REC;
  if (!rec) return;
  runOpenDialog({
    endpoint: '/api/rerun', flowId: rec.fid, name: rec.name || rec.fid,
    onDone: function () { if (typeof refreshData === 'function') refreshData(); }
  });
});
document.getElementById('btnToProjects').addEventListener('click', function () {
  var rec = DETAIL_REC;
  if (!rec || !rec.fid) { alert('该记录缺少流程 ID，无法跳转项目配置'); return; }
  pjPendingFid = rec.fid;
  location.hash = '#/projects?fid=' + encodeURIComponent(rec.fid);
});
/* 导航点击：绑在导航容器上（不是某一个 <ul>）——侧栏按「视图 / 运维」分成两组 <ul>，
   绑单个列表会让后加的那组点不动。用 closest 取最近的可跳转项，后续再加分组也不用改这里。 */
document.getElementById('navMenu').addEventListener('click', function (e) {
  var li = e.target.closest('li[data-hash]');
  if (li) { location.hash = li.getAttribute('data-hash'); this.classList.remove('open'); }
});
// 触屏设备没有 hover：点标题切换展开，点别处收起
document.getElementById('navMenuBtn').addEventListener('click', function (e) {
  document.getElementById('navMenu').classList.toggle('open');
  e.stopPropagation();
});
document.addEventListener('click', function () {
  document.getElementById('navMenu').classList.remove('open');
});
if (document.getElementById('chkAuto').checked) {
  autoTick();
  if (!autoTimer) autoTimer = setInterval(autoTick, 60000);
}

/* ==================== 项目控制台视图 ==================== */
function glShow(msg) {
  var m = document.getElementById('glMsg');
  if (m) m.textContent = msg || '加载中…';
  var o = document.getElementById('globalLoading');
  if (o) o.style.display = 'flex';
}
function glHide() {
  var o = document.getElementById('globalLoading');
  if (o) o.style.display = 'none';
}
var pjItems = [];          // 项目列表缓存
var pjCurrent = null;      // 当前选中项目
var pjCfgItems = [];       // 当前配置项
var pjPendingFid = null;   // 待跳转选中的 flow_id（从详情页「项目配置」带 ?fid= 进入）
var pjReady = false;

function pjFmtTime(s) {
  if (!s) return "—";
  var ms = Date.parse(s);
  return isNaN(ms) ? s : fmtFull(ms);
}
function pjLoad(force) {
  var el = document.getElementById('pjList');
  glShow('正在加载项目列表…');
  return api('/api/projects').then(function (d) {
    if (d && Array.isArray(d.items)) {
      var keep = pjCurrent ? pjCurrent.flow_id : null;
      pjItems = d.items;
      if (keep) pjItems.forEach(function (it) { if (it.flow_id === keep) pjCurrent = it; });
      pjRenderList();
      if (pjPendingFid) {
        var hasTarget = false;
        for (var i = 0; i < pjItems.length; i++) { if (pjItems[i].flow_id === pjPendingFid) hasTarget = true; }
        if (hasTarget) { pjSelect(pjPendingFid); }
        pjPendingFid = null;
      }
      if (pjCurrent) document.getElementById('pjGroup').value = pjCurrent.group || '';
    } else if (el) {
      el.innerHTML = '<div class="pj-loading">加载失败：' + esc((d && d.error) || '未知错误') + '</div>';
    }
    return pjItems;
  }).catch(function (e) {
    if (el) el.innerHTML = '<div class="pj-loading">加载失败：' + esc(e) + '</div>';
  }).then(function (v) { glHide(); return v; });
}
function pjSortFn() {
  var v = document.getElementById('pjSort').value;
  return function (a, b) {
    if (v === 'name') return (a.name || '').localeCompare(b.name || '', 'zh');
    return (b.update_time || '').localeCompare(a.update_time || '');
  };
}
var PJ_NAME_COLORS = {
  '宝': '#378ADD', '硕': '#1D9E75', '国': '#D85A30',
  '泇': '#7F77DD', '财': '#EF9F27', 'X': '#8b8f98', 'x': '#8b8f98'
};
var PJ_COLORS = ['#378ADD', '#1D9E75', '#D85A30', '#7F77DD', '#EF9F27', '#E24B4A', '#2BA6A0'];  // 非灰
function pjColor(name) {
  if (!name) return PJ_COLORS[0];
  var c = name.charAt(0);
  if (PJ_NAME_COLORS[c]) return PJ_NAME_COLORS[c];
  return PJ_COLORS[name.charCodeAt(0) % PJ_COLORS.length];
}
function pjRenderList() {
  var el = document.getElementById('pjList');
  if (!el) return;
  var arr = pjItems.slice().sort(pjSortFn());
  var foot = document.getElementById('pjFoot');
  if (foot) foot.textContent = '共 ' + pjItems.length + ' 个项目';
  el.innerHTML = arr.map(function (it) {
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
function pjSelect(fid) {
  pjCurrent = null;
  pjItems.forEach(function (it) { if (it.flow_id === fid) pjCurrent = it; });
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
  if (pjCurrent.group) { pjCfgLoad(); }
}
function pjSwitchTab(name) {
  var tabs = document.querySelectorAll('.pj-tab');
  for (var i = 0; i < tabs.length; i++) {
    var on = tabs[i].getAttribute('data-tab') === name;
    if (on) tabs[i].classList.add('active'); else tabs[i].classList.remove('active');
  }
  document.getElementById('pjPanelCfg').style.display = (name === 'cfg') ? 'flex' : 'none';
  document.getElementById('pjPanelRuns').style.display = (name === 'runs') ? 'flex' : 'none';
  if (name === 'runs') pjRunsLoad();
}
function pjRunsLoad() {
  var p = pjCurrent;
  var el = document.getElementById('pjRunsList');
  if (!p || !el) return;
  glShow('正在加载运行记录…');
  (RECORDS.length ? Promise.resolve(RECORDS) : loadRuns()).then(function () {
    var mine = RECORDS.filter(function (r) { return r.fid === p.flow_id; })
      .sort(function (a, b) { return (b.start || 0) - (a.start || 0); });
    document.getElementById('pjRunsInfo').textContent = mine.length
      ? '最近 7 天共 ' + mine.length + ' 条运行记录，展示最近 ' + Math.min(mine.length, 20) + ' 条；点击某条查看日志详情。'
      : '暂无运行记录（可点击标题右侧「运行该应用」触发一次）。';
    if (!mine.length) {
      el.innerHTML = '<div class="pj-empty-sm">暂无运行记录</div>';
    } else {
      el.innerHTML = '<table class="pj-runs-tbl"><thead><tr>'
        + '<th>状态</th><th>机器人</th><th>触发方式</th><th>开始时间</th><th>结束时间</th><th>时长</th>'
        + '</tr></thead><tbody>'
        + mine.slice(0, 20).map(function (r) {
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
function pjCfgDisplayVal(it) {
  /* 展示用文本：json 自动解析排版换行 */
  if (it.type === 'json') {
    try { return JSON.stringify(JSON.parse(it.value), null, 2); }
    catch (e) { return it.value; }
  }
  return it.value;
}
function pjCfgRender() {
  var tbl = document.getElementById('pjCfgTbl');
  var rows = pjCfgItems.map(function (it) {
    return '<tr>'
      + '<td class="k">' + esc(it.key) + '</td>'
      + '<td class="v" title="' + esc(it.value) + '">' + esc(pjCfgDisplayVal(it)) + '</td>'
      + '<td class="t">' + esc(it.type) + '</td>'
      + '<td class="d">' + esc(it.desc) + '</td>'
      + '<td><button class="btn pj-cfg-edit" data-key="' + esc(it.key) + '">编辑</button></td>'
      + '</tr>';
  }).join('');
  if (!pjCfgItems.length) {
    rows = '<tr><td colspan="5" class="pj-empty-sm" style="border:none;">该配置组暂无配置项，点右上「＋ 新增配置」添加。</td></tr>';
  }
  tbl.innerHTML = '<thead><tr><th>key</th><th>value</th><th>type</th><th>desc</th><th></th></tr></thead>'
    + '<tbody>' + rows + '</tbody>';
}
function pjCfgLoad() {
  var g = document.getElementById('pjGroup').value.trim();
  if (!g) { alert('请先填写配置组名'); return; }
  var tbl = document.getElementById('pjCfgTbl');
  glShow('正在加载配置…');
  return api('/api/projects/config?group=' + encodeURIComponent(g)).then(function (d) {
    if (!d || !d.ok) {
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
function pjCfgPost(body, onOk) {
  return fetch('/api/projects/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (j.ok) { if (onOk) onOk(j); }
      else alert('保存失败：' + (j.error || j.msg || '未知错误'));
      return j;
    }).catch(function (e) { alert('请求失败：' + e); return { ok: false, error: String(e) }; });
}

/* ---- 配置编辑弹窗 ---- */
var pjModalMode = 'edit';     // edit | new
var pjEditKey = null;         // 编辑模式原 key（不可改）
function pjModalValueHtml(type, raw) {
  /* value 控件：json -> textarea(格式化排版) / bool -> 开关 / 其它 -> 输入框 */
  if (type === 'bool') {
    var on = (String(raw).trim().toLowerCase() === 'true' || String(raw) === '1');
    return '<label class="switch"><input type="checkbox" id="mBool"' + (on ? ' checked' : '') + '><span class="slider"></span></label>'
      + '<span class="m-bool-tip">' + (on ? 'true' : 'false') + '</span>';
  }
  if (type === 'json') {
    var pretty;
    try { pretty = JSON.stringify(JSON.parse(raw || '{}'), null, 2); }
    catch (e) { pretty = raw; }
    return '<textarea id="mValJson" rows="7" spellcheck="false" placeholder="JSON 对象/数组">' + esc(pretty) + '</textarea>';
  }
  return '<input type="text" id="mValText" value="' + esc(raw) + '">';
}
function pjModalSyncBoolTip() {
  var el = document.getElementById('mBool');
  var tip = document.querySelector('.m-bool-tip');
  if (el && tip) tip.textContent = el.checked ? 'true' : 'false';
}
function pjModalOpen(item, isNew) {
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
function pjModalClose() {
  document.getElementById('pjModal').style.display = 'none';
}
function pjModalSave() {
  var g = document.getElementById('pjGroup').value.trim();
  var key = document.getElementById('mKey').value.trim();
  var type = document.getElementById('mType').value;
  if (!g) { document.getElementById('mErr').textContent = '缺少配置组（请先在上方填写并保存映射）'; return; }
  if (!key) { document.getElementById('mErr').textContent = '请填写 key'; return; }
  var value;
  if (type === 'bool') {
    var b = document.getElementById('mBool');
    value = (b && b.checked) ? 'true' : 'false';
  } else if (type === 'json') {
    var tv = document.getElementById('mValJson').value;
    try { JSON.parse(tv); }
    catch (e) { document.getElementById('mErr').textContent = 'JSON 格式错误：' + e.message; return; }
    value = tv;
  } else {
    var tx = document.getElementById('mValText');
    value = tx ? tx.value : '';
  }
  var desc = document.getElementById('mDesc').value;
  glShow('保存中…');
  pjCfgPost({ group: g, key: key, value: value, type: type, desc: desc }, function () {
    pjModalClose();        // 成功：关弹窗，由 pjCfgLoad 接管「加载配置」遮罩
    pjCfgLoad();
  }).then(function (j) { if (!j || !j.ok) glHide(); });   // 失败：收起遮罩
}
function pjInit() {
  var listEl = document.getElementById('pjList');
  if (!listEl) return;
  document.getElementById('pjSort').addEventListener('change', pjRenderList);
  document.getElementById('pjReload').addEventListener('click', function () { pjLoad(true); });
  listEl.addEventListener('click', function (e) {
    var item = e.target.closest('.pj-item');
    if (item) pjSelect(item.getAttribute('data-fid'));
  });
  document.getElementById('pjRun').addEventListener('click', function () {
    var p = pjCurrent;
    if (!p) return;
    runOpenDialog({
      endpoint: '/api/projects/run', flowId: p.flow_id, name: p.name || p.flow_id,
      onDone: function () { setTimeout(pjRunsLoad, 3000); }
    });
  });
  document.getElementById('pjGroupSave').addEventListener('click', function () {
    var p = pjCurrent;
    if (!p) return;
    var g = document.getElementById('pjGroup').value.trim();
    pjCfgPost({ group: 'project', key: 'p.' + p.flow_id, value: g, type: 'string' }, function () {
      p.group = g;
      pjRenderList();
      document.getElementById('pjCfgHint').textContent = '映射已保存：项目 ↔ 配置组「' + (g || '（未关联）') + '」。';
    });
  });
  document.getElementById('pjCfgLoad').addEventListener('click', pjCfgLoad);
  document.getElementById('pjRunsReload').addEventListener('click', function () {
    loadRuns().then(pjRunsLoad);
  });
  var tabs = document.querySelectorAll('.pj-tab');
  for (var i = 0; i < tabs.length; i++) {
    (function (btn) {
      btn.addEventListener('click', function () { pjSwitchTab(btn.getAttribute('data-tab')); });
    })(tabs[i]);
  }
  document.getElementById('pjRunsList').addEventListener('click', function (e) {
    var row = e.target.closest('tr[data-rid]');
    if (row) location.hash = '#/detail?id=' + encodeURIComponent(row.getAttribute('data-rid'));
  });
  document.getElementById('pjCfgTbl').addEventListener('click', function (e) {
    var btn = e.target.closest('.pj-cfg-edit');
    if (!btn) return;
    var key = btn.getAttribute('data-key');
    for (var i = 0; i < pjCfgItems.length; i++) {
      if (pjCfgItems[i].key === key) { pjModalOpen(pjCfgItems[i], false); break; }
    }
  });
  document.getElementById('pjCfgAdd').addEventListener('click', function () { pjModalOpen(null, true); });
  document.getElementById('mCancel').addEventListener('click', pjModalClose);
  document.getElementById('mSave').addEventListener('click', pjModalSave);
  document.getElementById('pjModal').addEventListener('click', function (e) {
    if (e.target === this) pjModalClose();
  });
  document.getElementById('mValWrap').addEventListener('change', function (e) {
    if (e.target && e.target.id === 'mBool') pjModalSyncBoolTip();
  });
  document.getElementById('mType').addEventListener('change', function () {
    var raw = pjModalReadValue();   // change 触发时旧控件仍在，读到的还是旧类型的值
    var type = this.value;          // 新类型
    if (type === 'json') {
      try { raw = JSON.stringify(JSON.parse(raw || '{}'), null, 2); } catch (e) { /* 保留原文 */ }
    }
    document.getElementById('mValWrap').innerHTML = pjModalValueHtml(type, raw);
    pjModalSyncBoolTip();
  });
  pjLoad();
}
/* ---- 弹窗辅助 ---- */
function pjModalReadValue() {
  /* 按「当前存在哪个 value 控件」读取（不依赖 type 判断） */
  var b = document.getElementById('mBool');
  if (b) return b.checked ? 'true' : 'false';
  var tv = document.getElementById('mValJson');
  if (tv) return tv.value;
  var tx = document.getElementById('mValText');
  return tx ? tx.value : '';
}

/* ==================== 机器人实时状态视图 ====================
   数据来自 /api/botstatus（后端按运行记录聚合）：在途记录 -> 运行中/排队中，
   无在途 -> 空闲；附当前任务、空闲时长、近 24 小时与近 7 天负载。 */
var BS_DATA = null;
var bsReady = false, bsFilter = '__ALL__';
var BS_STATE = {
  running: { cn: '运行中', color: '#EF9F27', bg: 'rgba(239,159,39,0.18)' },
  queued: { cn: '排队中', color: '#378ADD', bg: 'rgba(55,138,221,0.18)' },
  idle: { cn: '空闲', color: '#8b8f98', bg: 'rgba(139,143,152,0.16)' }
};

function bsBind() {
  var sel = document.getElementById('bsFilter');
  if (sel) sel.addEventListener('change', function () { bsFilter = this.value; bsRender(); });
  var rb = document.getElementById('bsReload');
  if (rb) rb.addEventListener('click', function () { bsLoad().then(bsRender); });
  var tbl = document.getElementById('bsTbl');
  if (tbl) tbl.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('.bs-task-link[data-rid]') : null;
    if (a) location.hash = '#/detail?id=' + encodeURIComponent(a.getAttribute('data-rid'));
  });
}
function bsLoad() {
  return api('/api/botstatus').then(function (d) {
    BS_DATA = (d && d.ok) ? d : null;
    return BS_DATA;
  }).catch(function () { BS_DATA = null; return null; });
}
var BS_COLS = 9;
function bsEmpty(msg) {
  var tbl = document.getElementById('bsTbl');
  if (tbl) tbl.innerHTML = '<tbody><tr><td colspan="' + BS_COLS + '" class="bs-empty">'
    + esc(msg) + '</td></tr></tbody>';
}
function bsRender() {
  var tbl = document.getElementById('bsTbl');
  if (!tbl) return;
  if (!BS_DATA) {
    bsEmpty('机器人状态加载失败，请确认后端服务正常。');
    return;
  }
  var s = BS_DATA.summary || {};
  if (BS_DATA.time) {
    var dt = document.getElementById('dataTime');
    if (dt) dt.textContent = BS_DATA.time;
  }
  var info = document.getElementById('bsInfo');
  if (info) info.textContent = '共 ' + (s.robots || 0) + ' 台 · 运行中 ' + (s.running || 0)
    + ' / 排队中 ' + (s.queued || 0) + ' / 空闲 ' + (s.idle || 0)
    + ' · 在途任务 ' + (s.tasks || 0) + ' 个 · ' + fmtFull(BS_DATA.now);
  var list = BS_DATA.bots || [];
  if (bsFilter === '__BUSY__') list = list.filter(function (b) { return b.state !== 'idle'; });
  else if (bsFilter === '__IDLE__') list = list.filter(function (b) { return b.state === 'idle'; });
  var head = '<thead><tr><th>机器人</th><th>状态</th><th>当前任务</th><th>空闲</th>'
    + '<th>近24h</th><th>近7天</th><th>失败率</th><th>平均排队</th><th>平均运行</th></tr></thead>';
  if (!list.length) {
    tbl.innerHTML = head + '<tbody><tr><td colspan="' + BS_COLS + '" class="bs-empty">没有符合条件的机器人。</td></tr></tbody>';
    return;
  }
  tbl.innerHTML = head + '<tbody>' + list.map(bsRow).join('') + '</tbody>';
}
/* 一个机器人一行：当前任务可点（跳该条记录日志），无在途任务则显示最近一次跑的应用 */
function bsRow(b) {
  var st = BS_STATE[b.state] || BS_STATE.idle;
  var cell;
  if (b.tasks && b.tasks.length) {
    var t = b.tasks[0];
    var meta = (t.status === 'Waiting' ? '等待调度' : '已跑 ' + fmtDur(t.elapsed))
      + (t.waited ? ' · 排队 ' + fmtDur(t.waited) : '');
    cell = '<span class="bs-task-link" data-rid="' + esc(t.id) + '" title="点击查看该任务的日志">'
      + esc(t.name || t.app || '运行记录') + '</span>'
      + '<span class="bs-task-meta">' + esc(meta) + '</span>'
      + (b.tasks.length > 1 ? '<span class="bs-task-meta">另有 ' + (b.tasks.length - 1) + ' 个在途</span>' : '');
  } else {
    cell = '<span class="bs-dim">' + (b.lastName ? '最近：' + esc(b.lastName) : '暂无运行记录') + '</span>';
  }
  var w = b.week || {}, r24 = b.recent || {};
  /* 空闲时长只在真空闲时展示：运行中/排队中的机器显示「距上次结束」会被误读成"它闲着呢" */
  var idle = (b.state === 'idle' && b.idleMs != null) ? fmtDur(b.idleMs) : '—';
  return '<tr>'
    + '<td class="bs-robot"><span class="bs-dot" style="background:' + st.color + '"></span>'
    + esc(b.robot) + '</td>'
    + '<td><span class="bs-state" style="background:' + st.bg + ';color:' + st.color + '">'
    + st.cn + '</span></td>'
    + '<td class="bs-task">' + cell + '</td>'
    + '<td class="bs-dim">' + esc(idle) + '</td>'
    + '<td>' + (r24.count || 0)
    + (r24.failed ? ' <span class="bs-bad">(' + r24.failed + ')</span>' : '') + '</td>'
    + '<td>' + (w.count || 0) + '</td>'
    + '<td' + ((w.failRate || 0) >= 0.2 ? ' class="bs-bad"' : '') + '>'
    + Math.round((w.failRate || 0) * 100) + '%</td>'
    + '<td class="bs-dim">' + fmtDur(w.avgWait) + '</td>'
    + '<td class="bs-dim">' + fmtDur(w.avgRun) + '</td>'
    + '</tr>';
}

/* ==================== 全局日志检索视图 ====================
   后端在「日志目录可访问」的运行记录里扫关键词，返回命中行 + 记录 id + 文件名；
   点命中行跳详情页（带 ?kw= 与 ?file=），由 lgApplyLink 自动定位到那一处。 */
var LS_BUSY = false, LS_DONE = null;
var lsReady = false;
var LS_LVL_CN = { all: '全部行', warn: '异常 + 警告', err: '仅错误' };

function lsRegEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function lsFillRobots() {
  var sel = document.getElementById('lsRobot');
  if (!sel) return;
  var cur = sel.value, names = [];
  RECORDS.forEach(function (r) { if (r.robot && names.indexOf(r.robot) < 0) names.push(r.robot); });
  names.sort();
  sel.innerHTML = '<option value="__ALL__">全部机器人</option>'
    + names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
  if (cur && names.indexOf(cur) >= 0) sel.value = cur;
}
function lsBind() {
  var go = document.getElementById('lsGo');
  if (go) go.addEventListener('click', lsSearch);
  var kw = document.getElementById('lsKw');
  if (kw) kw.addEventListener('keydown', function (e) { if (e.key === 'Enter') lsSearch(); });
  var box = document.getElementById('lsResult');
  if (box) box.addEventListener('click', function (e) {
    var row = e.target.closest ? e.target.closest('[data-rid][data-file]') : null;
    if (!row) return;
    var q = (LS_DONE && LS_DONE.q) || '';
    location.hash = '#/detail?id=' + encodeURIComponent(row.getAttribute('data-rid'))
      + '&kw=' + encodeURIComponent(q)
      + '&file=' + encodeURIComponent(row.getAttribute('data-file') || '');
  });
  ['lsRobot', 'lsDays', 'lsLvl'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', function () { if (LS_DONE) lsSearch(); });
  });
}
function lsSearch() {
  var kwEl = document.getElementById('lsKw');
  var box = document.getElementById('lsResult');
  if (!box) return;
  var kw = ((kwEl && kwEl.value) || '').trim();
  if (kw.length < 2) {
    box.innerHTML = '<div class="ls-empty">请输入至少 2 个字符的关键词。</div>';
    return;
  }
  if (LS_BUSY) return;
  LS_BUSY = true;
  var btn = document.getElementById('lsGo');
  if (btn) { btn.disabled = true; btn.textContent = '检索中…'; }
  box.innerHTML = '<div class="ls-empty">正在检索日志，记录较多时需要几秒…</div>';
  var robot = document.getElementById('lsRobot').value;
  var days = document.getElementById('lsDays').value;
  var lvl = document.getElementById('lsLvl').value;
  api('/api/logsearch?q=' + encodeURIComponent(kw)
    + '&robot=' + encodeURIComponent(robot) + '&days=' + encodeURIComponent(days)
    + '&lvl=' + encodeURIComponent(lvl))
    .then(function (d) { LS_DONE = d; lsRender(); })
    .catch(function (e) {
      box.innerHTML = '<div class="ls-empty">检索失败：' + esc(e && e.message ? e.message : e) + '</div>';
    })
    .then(function () {
      LS_BUSY = false;
      if (btn) { btn.disabled = false; btn.textContent = '检索'; }
    });
}
function lsRender() {
  var box = document.getElementById('lsResult');
  var d = LS_DONE;
  if (!box || !d) return;
  if (!d.ok) {
    box.innerHTML = '<div class="ls-empty">' + esc(d.error || '检索失败') + '</div>';
    return;
  }
  var sc = d.scanned || {};
  var kw = d.q || '';
  /* 同一文件一组：组内共享同一条运行记录（rid）与文件名，点组头或任一行都跳该条记录日志 */
  var groups = [], byKey = {};
  d.hits.forEach(function (h) {
    var key = h.rid + '\u0000' + h.file;
    var g = byKey[key];
    if (!g) {
      g = byKey[key] = {
        rid: h.rid, file: h.file, robot: h.robot, name: h.name,
        start: h.start, hits: []
      };
      groups.push(g);
    }
    g.hits.push(h);
  });
  var info = document.getElementById('lsInfo');
  if (info) info.textContent = '命中 ' + d.hits.length + ' 处 · 分布在 ' + groups.length
    + ' 个日志文件 · 扫描 ' + (sc.records || 0) + ' 条记录 / '
    + (sc.files || 0) + ' 个文件 / ' + (sc.lines || 0) + ' 行';
  var hint = document.getElementById('lsHint');
  if (hint) hint.textContent = '候选 ' + (d.candidates || 0) + ' 条记录（最近 ' + d.days
    + ' 天内且本机日志目录可访问），级别筛选「' + (LS_LVL_CN[d.lvl] || '全部行') + '」。'
    + (d.truncated ? '已扫满上限（扫描 ' + (sc.records || 0) + '/' + (d.candidates || 0)
      + ' 条记录）：请缩小机器人范围或时间窗，或改用「异常 + 警告」。' : '')
    + ' 点组头或任一行直达该条运行记录的日志，自动带上关键词与文件定位。';
  if (!d.hits.length) {
    box.innerHTML = '<div class="ls-empty">最近 ' + d.days + ' 天内没有匹配「' + esc(kw) + '」的日志行。</div>';
    return;
  }
  box.innerHTML = groups.map(function (g) { return lsGroupHtml(g, kw); }).join('');
}
function lsLvTag(lvl) {
  if (lvl === 1) return ['错误', 'rgba(226,75,74,0.18)', '#E24B4A'];
  if (lvl === 2) return ['警告', 'rgba(239,159,39,0.18)', '#EF9F27'];
  return null;
}
function lsGroupHtml(g, kw) {
  var rows = g.hits.map(function (h) {
    var lv = lsLvTag(h.lvl);
    var text = esc(h.text);
    if (kw) text = text.replace(new RegExp(lsRegEsc(esc(kw)), 'gi'), function (m) { return '<mark>' + m + '</mark>'; });
    return '<div class="ls-hitrow" data-rid="' + esc(g.rid) + '" data-file="' + esc(g.file)
      + '" title="点击查看该条记录的完整日志">'
      + '<span class="ls-lineno">第 ' + h.line + ' 行</span>'
      + (lv ? '<span class="ls-lv" style="background:' + lv[1] + ';color:' + lv[2] + '">' + lv[0] + '</span>' : '')
      + '<span class="ls-hit-text">' + text + '</span>'
      + '</div>';
  }).join('');
  return '<div class="ls-group">'
    + '<div class="ls-group-head" data-rid="' + esc(g.rid) + '" data-file="' + esc(g.file)
    + '" title="点击查看该条记录的完整日志">'
    + '<span class="ls-g-robot">' + esc(g.robot) + '</span>'
    + '<span class="ls-g-file">' + esc(g.file) + '</span>'
    + '<span class="ls-g-count">命中 ' + g.hits.length + ' 处</span>'
    + (g.start ? '<span class="ls-g-time">' + fmtFull(g.start) + '</span>' : '')
    + '<span class="ls-g-go">打开日志 →</span>'
    + '</div>'
    + '<div class="ls-group-body">' + rows + '</div>'
    + '</div>';
}

/* ==================== 触发器合规视图 ====================
   数据来自 /api/compliance（后端把排期点与实跑记录做比对）：命中 / 延迟 / 应用不符 / 漏跑 / 待定。 */
var CP_DATA = null;
var cpReady = false, cpOnly = 'problem', cpRobot = '__ALL__';
var CP_STATE = {
  hit: { cn: '按时', color: '#1D9E75', bg: 'rgba(29,158,117,0.18)' },
  late: { cn: '延迟', color: '#EF9F27', bg: 'rgba(239,159,39,0.18)' },
  mismatch: { cn: '应用不符', color: '#D85A30', bg: 'rgba(216,90,48,0.18)' },
  missed: { cn: '漏跑', color: '#E24B4A', bg: 'rgba(226,75,74,0.18)' },
  pending: { cn: '待定', color: '#8b8f98', bg: 'rgba(139,143,152,0.16)' }
};
function cpBadge(st) {
  var m = CP_STATE[st] || CP_STATE.pending;
  return '<span class="cp-badge" style="background:' + m.bg + ';color:' + m.color + '">' + m.cn + '</span>';
}
function cpBind() {
  var rb = document.getElementById('cpReload');
  if (rb) rb.addEventListener('click', cpLoad);
  var d = document.getElementById('cpDays');
  if (d) d.addEventListener('change', cpLoad);
  var o = document.getElementById('cpOnly');
  if (o) o.addEventListener('change', function () { cpOnly = this.value; cpRender(); });
  var r = document.getElementById('cpRobot');
  if (r) r.addEventListener('change', function () { cpRobot = this.value; cpRender(); });
  var tbl = document.getElementById('cpTbl');
  if (tbl) tbl.addEventListener('click', function (e) {
    var row = e.target.closest ? e.target.closest('tr[data-rid]') : null;
    if (row) location.hash = '#/detail?id=' + encodeURIComponent(row.getAttribute('data-rid'));
  });
}
function cpLoad() {
  var el = document.getElementById('cpDays');
  var days = el ? el.value : 7;
  glShow('正在比对排期与实际运行…');
  return api('/api/compliance?days=' + encodeURIComponent(days)).then(function (d) {
    CP_DATA = (d && d.ok) ? d : null;
    if (!CP_DATA) cpEmpty((d && d.error) || '加载失败');
    else { cpFillRobots(); cpRender(); }
    glHide();
  }).catch(function (e) { CP_DATA = null; cpEmpty(String(e)); glHide(); });
}
function cpEmpty(msg) {
  var m = document.getElementById('cpMetrics');
  if (m) m.innerHTML = '';
  var rt = document.getElementById('cpRobotTbl');
  if (rt) rt.innerHTML = '';
  var t = document.getElementById('cpTbl');
  if (t) t.innerHTML = '<tbody><tr><td class="pj-empty-sm" style="border:none;">' + esc(msg) + '</td></tr></tbody>';
}
function cpFillRobots() {
  var sel = document.getElementById('cpRobot');
  if (!sel) return;
  var list = CP_DATA.perRobot || [];
  var cur = cpRobot;
  sel.innerHTML = '<option value="__ALL__">全部机器人</option>'
    + list.map(function (b) { return '<option value="' + esc(b.robot) + '">' + esc(b.robot) + '</option>'; }).join('');
  var ok = cur === '__ALL__' || list.some(function (b) { return b.robot === cur; });
  sel.value = ok ? cur : '__ALL__';
  cpRobot = sel.value;
}
function cpRender() {
  if (!CP_DATA) return;
  var s = CP_DATA.stats || {};
  var m = document.getElementById('cpMetrics');
  if (m) {
    m.innerHTML = anCard('应跑次数', s.scheduled, '#378ADD')
      + anCard('按时', s.hit, '#1D9E75')
      + anCard('应用不符', s.mismatch || 0, '#D85A30')
      + anCard('漏跑', s.missed, '#E24B4A')
      + anCard('命中率', Math.round((s.rate || 0) * 100) + '%',
        (s.rate || 0) >= 0.95 ? '#1D9E75' : '#EF9F27');
  }
  var info = document.getElementById('cpInfo');
  if (info) info.textContent = '可判定 ' + (s.evaluated || 0) + ' 次 · 延迟 ' + (s.late || 0)
    + ' · 待定 ' + (s.pending || 0) + ' · 超出数据范围 ' + (s.unknown || 0);
  var hint = document.getElementById('cpHint');
  if (hint) hint.textContent = '口径：计划时刻起（含前后 2 分钟容差）'
    + CP_DATA.window + ' 分钟内、同机器人 + 同应用有运行记录即算命中；'
    + '「应用不符」= 触发到了但跑的是别的应用。早于运行记录最早时刻（'
    + (CP_DATA.coverageFrom ? fmtFull(CP_DATA.coverageFrom) : '—') + '）的排期点无法判定，已排除。';

  /* 各机器人命中率（始终展示全量总览，不随机器人筛选收窄） */
  var rt = document.getElementById('cpRobotTbl');
  if (rt) {
    var rows = CP_DATA.perRobot || [];
    rt.innerHTML = '<thead><tr><th>机器人</th><th>应跑</th><th>按时</th>'
      + '<th>漏跑</th><th>命中率</th></tr></thead><tbody>'
      + (rows.length ? rows.map(function (b) {
        return '<tr><td>' + esc(b.robot) + '</td>'
          + '<td>' + b.scheduled + '</td>'
          + '<td>' + b.hit + '</td>'
          + '<td class="' + (b.missed ? 'cp-missed' : '') + '">' + b.missed + '</td>'
          + '<td class="' + (b.rate < 0.95 ? 'cp-rate-bad' : '') + '">'
          + Math.round(b.rate * 100) + '%</td></tr>';
      }).join('')
        : '<tr><td colspan="5" class="pj-empty-sm" style="border:none;">无数据</td></tr>')
      + '</tbody>';
  }

  /* 排期明细 */
  var items = (CP_DATA.items || []).filter(function (it) {
    if (cpRobot !== '__ALL__' && it.robot !== cpRobot) return false;
    if (cpOnly === '__ALL__') return true;
    if (cpOnly === 'missed') return it.status === 'missed';
    return it.status === 'missed' || it.status === 'mismatch' || it.status === 'late';
  });
  var tbl = document.getElementById('cpTbl');
  if (!tbl) return;
  tbl.className = 'cp-tbl';
  var body = items.length ? items.map(function (it) {
    var extra = (it.status === 'late' && it.lateMs) ? ' 晚 ' + fmtDur(it.lateMs)
      : (it.status === 'mismatch' && it.runApp) ? ' 实跑：' + esc(it.runApp) : '';
    return '<tr' + (it.runId ? ' data-rid="' + esc(it.runId) + '" title="点击查看该次运行的日志"' : '')
      + '>'
      + '<td>' + fmtFull(it.sched) + '</td>'
      + '<td>' + esc(it.robot) + '</td>'
      + '<td class="cp-app" title="' + esc(it.app) + '">' + esc(it.app) + '</td>'
      + '<td>' + cpBadge(it.status) + '</td>'
      + '<td>' + (it.runStart ? fmtFull(it.runStart) : '—')
      + '<span class="hint">' + extra + '</span></td>'
      + '</tr>';
  }).join('')
    : '<tr><td colspan="5" class="pj-empty-sm" style="border:none;">该筛选条件下没有条目</td></tr>';
  tbl.innerHTML = '<thead><tr><th>计划时间</th><th>机器人</th><th>应用</th>'
    + '<th>状态</th><th>实际运行</th></tr></thead><tbody>' + body + '</tbody>';
}

/* ==================== 启动 ==================== */
route();

