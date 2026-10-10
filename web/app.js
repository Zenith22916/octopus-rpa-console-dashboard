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
/* 紧凑时长：手机端时间轴块内文字、运行记录卡片的右侧读数用。
   比 fmtDur 短（「5秒 / 27分11秒 / 1小时2分」），窄容器里也放得下。 */
function fmtDurShort(ms) {
  if (ms == null || ms < 0) return "—";
  var s = Math.round(ms / 1000);
  if (s < 60) return s + "秒";
  var m = Math.floor(s / 60), sec = s % 60;
  if (m < 60) return sec ? (m + "分" + sec + "秒") : (m + "分");
  var h = Math.floor(m / 60), mm = m % 60;
  return mm ? (h + "小时" + mm + "分") : (h + "小时");
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
/* 状态色的实色版：时间轴数据块用 0.6 透明度（半透明便于看重叠），
   但手机端卡片里的「时长」是正文文字，0.6 在深色底上偏灰、读起来费劲 —— 文字用实色。 */
function statusColorSolid(r) {
  if (r.status === "Failed") return "#E24B4A";
  if (r.status === "Executing") return "#EF9F27";
  if (r.status === "Waiting") return "#378ADD";
  if (r.status === "Stopped") return "#8b8f98";
  return "#1D9E75";
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
/* 排期配色：直接用后端 PALETTE 给的颜色，应用之间的辨识交给「悬停点亮同应用全部标签」。 */
/* 悬停高亮：鼠标所在的应用标签 -> 点亮全表同一应用的标签。
   排期页已由 ECharts 甘特图改为真表格，这里用纯 DOM 类切换，不再走 dispatchAction。 */
var scHotApp = null;
function scHighlight(app) {
  if (app === scHotApp) return;
  scHotApp = app;
  var tbl = document.getElementById('scTbl');
  if (!tbl) return;
  tbl.classList.add('sc-has-hot');
  var tags = tbl.querySelectorAll('.sc-tag');
  for (var i = 0; i < tags.length; i++) {
    if (tags[i].getAttribute('data-app') === app) tags[i].classList.add('hot');
    else tags[i].classList.remove('hot');
  }
}
function scUnhighlight() {
  if (scHotApp == null) return;
  scHotApp = null;
  var tbl = document.getElementById('scTbl');
  if (!tbl) return;
  tbl.classList.remove('sc-has-hot');
  var tags = tbl.querySelectorAll('.sc-tag.hot');
  for (var i = 0; i < tags.length; i++) tags[i].classList.remove('hot');
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
/* 标题栏指标卡：视图 -> 容器 id。每个视图一组，切视图时只显示对应那组 */
var HEAD_METRIC_BOXES = [
  ['timeline', 'tlMetrics'], ['analysis', 'anMetrics'], ['schedule', 'scMetrics'],
  ['projects', 'pjMetrics'], ['botstatus', 'bsMetrics'],
  ['logsearch', 'lsMetrics'], ['compliance', 'cpMetrics']
];

function showView(name) {
  curView = name;
  for (var i = 0; i < VIEW_NAMES.length; i++) {
    var el = document.getElementById('view-' + VIEW_NAMES[i]);
    if (el) el.style.display = (VIEW_NAMES[i] === name) ? 'flex' : 'none';
  }
  // 离开详情页时释放 Monaco 日志编辑器（模型与实例随详情重建，避免常驻占内存）
  if (name !== 'detail' && typeof lgReset === 'function') lgReset();
  if (NAV_NAMES.indexOf(name) >= 0) navSet(name);
  // 标题栏指标卡按视图切换：每个视图一组，都放在标题栏的 #headMetrics 里
  for (var vi = 0; vi < HEAD_METRIC_BOXES.length; vi++) {
    var box = document.getElementById(HEAD_METRIC_BOXES[vi][1]);
    if (box) box.style.display = (name === HEAD_METRIC_BOXES[vi][0]) ? 'flex' : 'none';
  }
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
      if (IS_MOBILE) { tlFeedObserve(); tlFeedTick(); }
      else tlResize();
      if (prevView === 'detail') refreshData();   // 从日志详情页返回：自动更新在详情页停更了，补拉一次后端内存里的最新数据
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
    /* 带 ?tab=runs 进入（排期页点应用标签跳过来）：选中项目后直接打开「运行记录」tab */
    pjPendingTab = getParam('tab');
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
/* 断点切换（横竖屏翻转 / 拖动窗口）时重排时间轴视图。
   手机端与桌面端在这里不只是「重画」—— 手机端根本没有甘特图实例，
   所以要整块换布局：手机 -> 桌面要补建 ECharts，桌面 -> 手机要把它拆掉。 */
function applyTimelineLayout() {
  if (curView !== 'timeline' || !tlReady) return;
  if (IS_MOBILE) {
    if (tlChart) { try { tlChart.dispose(); } catch (e) { } tlChart = null; }
    chartEl = null;
    FEED.n = FEED_PAGE;
    FEED.sig = '';
    tlFeedHidePill();
    tlListRender(true);      // 统一切显隐 + 渲染记录流
    tlFeedObserve();
  } else {
    if (tlFeedObserve._io) { tlFeedObserve._io.disconnect(); tlFeedObserve._io = null; }
    if (!tlChart) tlInit();          // 从手机切回桌面：补建图表（tlInit 内部会 tlRender）
    else { tlRender(); }
    tlListRender(true);
  }
}
window.addEventListener('resize', function () {
  /* 桌面 <-> 手机布局互切：图表的内边距/刻度字号是按布局算出来的，
     断点变了必须整块重画，只 resize() 会保留旧布局量出来的边距 */
  var mob = !!(window.matchMedia && window.matchMedia(MOBILE_Q).matches);
  if (mob !== IS_MOBILE) {
    IS_MOBILE = mob;
    if (typeof LOGM !== 'undefined' && LOGM.editor) LOGM.editor.updateOptions(lgViewOptions());
    applyTimelineLayout();
    if (curView === 'analysis' && anReady) anRenderAll(RECORDS);
    if (curView === 'schedule' && scReady && RECORDS.length) scReload();
  }
  if (curView === 'timeline' && tlReady && !IS_MOBILE) tlChartResize();
  if (curView === 'analysis' && anReady) anResize();
  if (curView === 'schedule' && scReady) scResize();
});

/* ==================== 时间轴视图 ====================
   桌面端：甘特图（含筛选栏）+ 运行记录表格；
   手机端（≤880px）：只有运行记录流 —— 整个图表卡片（筛选栏 + 甘特图 + 图例）
   一起隐藏（见 mobile.css 的 #tlChartCard 与 tlInit 的 IS_MOBILE 分支）。 */
var DEF_SPAN = 2 * 3600 * 1000;   // 桌面默认时间窗口
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

/* 时间轴的绘图区边距（tlRender 的 grid 与 1:1 拖动换算共用一处，避免两边对不上）。
   甘特图只在桌面端渲染（手机端整块砍掉，只留记录流），所以这里只有一套桌面值。 */
var TL_GRID = { left: 100, right: 20, top: 20, bottom: 30 };
function tlGrid() { return TL_GRID; }
/* 数据块的最小可见厚度（px）：6 秒的记录在 6 小时窗口里只有 0.1px，不撑一下就等于没画，
   「这台机器人跑过一次」这件事就看不见了。 */
var MIN_BAR_PX = 4;
/* 时间方向的绘图区像素长度（拖 100px 就走 100px 的时间）。
   1:1 拖动与「可见下限」都以它为准 */
function tlTimeLenPx() {
  var g = tlGrid();
  var len = (chartEl ? chartEl.clientWidth || 0 : 0) - g.left - g.right;
  return Math.max(50, len || 900);
}
/* 指针在「时间方向」上的位置：横向布局取横坐标 */
function tlPointerPos(e) { return e.clientX; }
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
  /* 两端都是横向布局（时间在横轴），机器人是纵向的泳道组，行序与时间流向无关，
     统一按名称排序 —— 行序稳定，不随窗口平移抖动，肌肉记忆才好用。 */
  return arr.sort();
}
/* 手机端纵轴/记录流用的机器人短名：8 字全名（「A🍩硕晞-01」）在手机上太长，
   去掉组前缀（A/B）与 emoji，只留「硕晞-01」；完整名在提示窗与详情页里都有。 */
function robotShortName(n) {
  var s = String(n == null ? '' : n);
  s = s.replace(/^[A-Za-z]\s*/, '');            // 去掉开头的 A/B 分组字母
  s = s.replace(/[^\u4e00-\u9fa5A-Za-z0-9-]/g, '');   // 去掉 emoji 等符号
  s = s.replace(/^-+/, '');
  return s || String(n == null ? '' : n);
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
/* 泳道分配：同一机器人时间重叠的记录分到不同泳道（横着叠开，互不遮挡）。
   只按真实时间重叠判定 —— 与窗口大小无关，泳道数在任何缩放下都稳定。 */
function layout(segs) {
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
    /* 泳道分配按「真实时间重叠」算，不按拉伸后的视觉厚度算。
       试过按视觉厚度（max(真实时长, minVisibleMs)）分配：极短记录被撑到 4px 后，
       在 7 天/30 天这种大窗口下 4px 相当于好几个小时，于是同一台机器人的记录几乎
       条条互斥，泳道数从 11 条暴涨到 37/93 条 —— 每条泳道只剩几像素高，反而全糊了。
       真实重叠的判定与窗口大小无关，泳道数始终稳定；短记录怎么画得看得见，
       交给绘制阶段的 stretch（见下），两件事分开管。 */
    idxs.forEach(function (ri) {
      var u = recs[ri], st = u.start, en = u.end, lane = -1;
      for (var l = 0; l < lanes.length; l++) {
        if (st >= lanes[l].end || en <= lanes[l].start) { lane = l; break; }
      }
      if (lane < 0) { lane = lanes.length; lanes.push({ start: st, end: en }); }
      else {
        if (st < lanes[lane].start) lanes[lane].start = st;
        if (en > lanes[lane].end) lanes[lane].end = en;
      }
      laneOfRec[ri] = lane;
    });
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
  /* 文字下限：屏幕上不足 MIN_BAR_PX 的记录仍会画（撑到最小可见厚度，见 renderItem 的 stretch），
     但不值得再往上写应用名 —— 挤出来的几个像素只够表达「这里跑过一次」。
     泳道分配不受这个值影响，只按真实时间重叠算（见 layout）。 */
  var minVisibleMs = state.span * (MIN_BAR_PX / tlTimeLenPx());
  var info = layout(visible);
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
      /* value(2) 应用名：两端都用（手机端只放得下缩写版，见 renderItem 里按 IS_MOBILE 分流）。
         门槛用 minVisibleMs：屏幕上太窄的块连字都排不下，画上去只是糊。 */
      textData.push({
        value: [0, li.row, s.r.name, merge.min, merge.max]
      });
    }
  });
  var sepData = [];
  lastRows.forEach(function (r) { if (r !== topGroupRow) sepData.push({ value: [r] }); });
  var recIds = {};
  visible.forEach(function (s) { recIds[s.r.id] = 1; });
  var recCount = Object.keys(recIds).length;
  tlLastData = data;

  /* 悬浮联动：当前有悬浮行时，只有它对应的块是「主角」，其余一律淡出。
     注意 hot 只对「窗口内可见」的记录有效 —— 悬浮的行可能因为时间窗口没包含它
     而不在图上，这时 hot 什么也匹配不到，图上维持原样（不会误淡出整幅）。
     必须在构造 hoverData 之前算好（曾因写在后面，var 提升让 hoverData 拿到
     undefined，引导线与气泡整个不画）。 */
  var hot = tlHover.rid;
  if (hot) {
    var hotOnChart = false;
    for (var hi = 0; hi < data.length; hi++) {
      if (data[hi].rid === hot) { hotOnChart = true; break; }
    }
    if (!hotOnChart) hot = null;     // 该记录不在当前窗口内：不做淡出，保持图正常
  }

  /* 悬浮引导：一条贯穿整幅的竖线 + 贴着目标块的气泡（应用名 · 时长），
     标出「悬浮那条」落在哪个时刻。块太窄时它自己也读不到文字，
     这个气泡就是唯一的时长来源，所以值得单独画。没悬浮时为空数组 = 不画。 */
  var hoverData = [];
  if (hot) {
    for (var hj = 0; hj < data.length; hj++) {
      if (data[hj].rid === hot) {
        hoverData.push({
          value: [(data[hj].value[0] + data[hj].value[1]) / 2, data[hj].value[2],
          data[hj].name, data[hj].value[1] - data[hj].value[0]]
        });
        break;
      }
    }
  }

  /* ---- 坐标工具（横向布局：时间在横轴、泳道在纵轴） ---- */
  // 时间 t + 泳道 row -> 屏幕坐标 [x, y]
  function xy(api, t, row) { return api.coord([t, row]); }
  // 两点在「时间方向」上的像素长度 = 横向长度
  function lenOf(p0, p1) { return Math.abs(p1[0] - p0[0]); }
  // 泳道方向的厚度（一条泳道有多厚）= 纵向高度
  function bandOf(api) { return api.size([0, 1])[1]; }
  // 画一段块：p0/p1 为两端屏幕坐标，thick 为泳道方向厚度
  function barOf(p0, p1, thick, style) {
    var a0 = Math.min(p0[0], p1[0]);
    var a1 = Math.max(p0[0], p1[0]);
    var len = a1 - a0;
    var c = p0[1];                             // 泳道中心
    var r = Math.min(3, len / 2, thick / 2);
    return {
      type: 'rect',
      shape: { x: a0, y: c - thick / 2, width: len, height: thick, r: r },
      style: style
    };
  }
  /* 极短记录的最小可见厚度：6 秒的记录在 6 小时窗口里只有 0.1px，
     原来直接被「不足 2px 就不画」的规则吞掉 —— 记录凭空消失。
     这里把太短的条以「真实位置为中心」撑到 MIN_BAR_PX，保证「跑过一次」这件事看得见；
     它只影响画出来的宽度，不影响任何时间换算（时长读数、拖动、点击跳转都按真实值走）。 */
  function stretch(p0, p1) {
    var px = lenOf(p0, p1);
    if (px >= MIN_BAR_PX) return [p0, p1];
    var mid = (p0[0] + p1[0]) / 2;
    var half = MIN_BAR_PX / 2;
    return [[mid - half, p0[1]], [mid + half, p1[1]]];
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
    grid: tlGrid(),
    /* 横轴 = 时间 */
    xAxis: {
      type: 'time', min: nowW - state.span, max: nowW,
      axisLabel: {
        color: '#8b8f98', fontSize: 11, hideOverlap: true,
        formatter: function (v) { return fmtTime(v); }
      },
      axisLine: { lineStyle: { color: '#333' } },
      splitLine: { show: true, lineStyle: { color: '#20242c' } }
    },
    /* 纵轴 = 机器人泳道 */
    yAxis: {
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
        /* 本块是不是被悬浮行点中的那条：是则原样（并加金色描边），
           否则在「有悬浮」时淡出到 18%。用 dataIndex 回查而不是读附加字段 ——
           custom series 不保证保留 rid（踩过这个坑）。 */
        var isHot = false;
        if (hot) {
          var di = (typeof params.dataIndex === 'number') ? tlLastData[params.dataIndex] : null;
          isHot = !!(di && di.rid === hot);
        }
        var dim = !!hot && !isHot;
        var dimA = dim ? 0.18 : 1;
        if (hasWait && showQueue) {
          var q0 = Math.max(api.value(0), winA), q1 = Math.min(exec, nowW);
          if (q1 > q0) {
            /* 排队段不撑最小厚度：它只是运行块前面的一小截蓝头，
               当前缩放级别看不见就说明「排队时间短到无关紧要」，不必硬挤出来。
               （运行块本身必须可见 —— 那代表「这条记录跑过」，语义不同） */
            var pq0 = xy(api, q0, row), pq1 = xy(api, q1, row);
            if (lenOf(pq0, pq1) >= 1) {
              children.push(barOf(pq0, pq1, bh, { fill: WAIT_FILL, opacity: dimA }));
            }
          }
        }
        var rs = hasWait ? exec : api.value(0);
        var r0 = Math.max(rs, winA), r1 = Math.min(api.value(1), nowW);
        if (r1 > r0) {
          var st2 = stretch(xy(api, r0, row), xy(api, r1, row));
          /* 用 value(5)（数据构造时由 segColor 算好的状态色）派生渐变：
             不要在 renderItem 里读 params.data.status —— custom series
             不保证保留附加字段，取不到就会全部落到兜底色（全变绿）。
             横条一律「上亮下暗」竖向渐变。 */
          children.push(barOf(st2[0], st2[1], bh, {
            fill: shadeGrad(api.value(5), 'v', .07, .09), opacity: dimA
          }));
        }
        var pv0 = xy(api, vs, row), pv1 = xy(api, ve, row);
        var stv = stretch(pv0, pv1);
        if (lenOf(stv[0], stv[1]) >= 1) {
          /* 悬浮中的那条：白描边换成金色加粗描边 + 外扩 2px，视觉上「鼓」出来；
             其余保持原来的白细边（淡出时描边也一起淡）。 */
          if (isHot) {
            var e0 = stv[0], e1 = stv[1];
            children.push(barOf([e0[0] - 2, e0[1]], [e1[0] + 2, e1[1]], bh + 6, {
              fill: 'rgba(255,209,102,0.14)',
              stroke: '#ffd166', lineWidth: 2
            }));
          } else {
            children.push(barOf(stv[0], stv[1], bh,
              { fill: 'rgba(0,0,0,0)', stroke: 'rgba(255, 255, 255, 0.5)', lineWidth: 1.5, cursor: 'pointer', opacity: dimA }));
          }
        }
        if (!children.length) return null;
        return children.length === 1 ? children[0] : { type: 'group', children: children };
      },
      markLine: {
        silent: true, symbol: 'none', lineStyle: { color: '#E24B4A', width: 2 },
        label: { show: true, formatter: '现在', color: '#E24B4A', fontSize: 10, position: 'insideEndTop' },
        // 「现在」分界线：横轴布局下永远是竖线
        data: [{ xAxis: state.end }]
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

        // 数据块文字：单行、字号与大标题一致、居中、放不下截断加 "..."、少于 8 字不显示
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
        var lo = Math.min(c0[0], c1[0]);
        var hi = Math.max(c0[0], c1[0]);
        // 机器人分组之间的白色虚线：横轴布局下画横线（每组的底边）
        return {
          type: 'line', shape: { x1: lo, y1: c0[1] - band / 2, x2: hi, y2: c0[1] - band / 2 },
          style: { stroke: 'rgba(255,255,255,0.65)', lineWidth: 1.5, lineDash: [6, 4] }
        };
      }
    }, {
      /* 悬浮气泡（zlevel 3 = 盖在数据块与文字之上）：贴着目标块浮一行「应用名 · 时长」。
         块窄到没文字时（几秒的记录），这里是唯一的时长读数，所以值得单独画。
         曾经还画过一条贯穿上下的金色竖虚线，已去掉：它的下端依赖 layout.totalRows，
         在闭包里取到 NaN、被 api.coord 当成 0，结果线只覆盖第 0 条泳道（实测高度仅 53px），
         数据块在别的泳道时线就跑到无关的位置 —— 高亮环 + 其余淡出已足够定位，不必留它。 */
      type: 'custom', data: hoverData, zlevel: 3, silent: true,
      renderItem: function (params, api) {
        var t = api.value(0);
        var row = api.value(1);
        var nm = String(api.value(2) || '');
        var durMs = api.value(3);
        /* 目标块的中心：必须用 row 这个真实泳道，不能写死 0。
           （曾写成 xy(api, t, 0)：气泡会固定贴在第 0 行，与目标块能差 200px 以上，
           看起来像「气泡跟块没关系」。实测 row=4 时气泡在 y=247、块在 y=69。） */
        var center = xy(api, t, row);
        var band = bandOf(api);
        var g = tlGrid();
        var canvasH = chartEl ? (chartEl.clientHeight || 0) : 0;
        /* 气泡文字：应用名 + 时长（超宽就只留时长，别把气泡拉出屏幕） */
        var durTxt = fmtDurShort(durMs);
        var fs = 11;
        var padX = 7, bh2 = 19;
        var label = nm ? truncateLabel(nm, 150, fs) : '';
        var text = label ? (label + ' · ' + durTxt) : durTxt;
        var w = measureW(text, fs) + padX * 2;
        if (w > 260) { text = durTxt; w = measureW(text, fs) + padX * 2; }
        /* 气泡贴着「悬浮那条」的块上沿浮，而不是贴在画布顶端：
           ① 一眼看清是哪一块（画布顶部离块可能很远，尤其泳道多时）；
           ② 贴顶会被画布裁掉（原先气泡中心放在 y=6、高 19px，上沿落到 -3.5px 被裁）。
           块上方放不下就翻到块下方，最后再整体夹进画布内，保证永远完整可见。 */
        var blockTop = center[1] - band / 2;
        var cy = blockTop - bh2 / 2 - 6;                 // 默认：块上方
        if (cy - bh2 / 2 < 1) cy = center[1] + band / 2 + bh2 / 2 + 6;   // 上方不够 -> 块下方
        cy = Math.max(bh2 / 2 + 1, Math.min(canvasH - bh2 / 2 - 1, cy));
        var cx = Math.max(g.left + w / 2,
          Math.min((chartEl ? chartEl.clientWidth : 900) - g.right - w / 2, center[0]));
        var out = [{
          type: 'rect',
          shape: { x: cx - w / 2, y: cy - bh2 / 2, width: w, height: bh2, r: bh2 / 2 },
          style: { fill: 'rgba(255,209,102,0.95)', stroke: 'rgba(255,255,255,0.35)', lineWidth: 1 }
        }, {
          type: 'text',
          style: {
            text: text, x: cx, y: cy, textAlign: 'center', textVerticalAlign: 'middle',
            fill: '#1a1206', fontSize: fs, fontWeight: 600, fontFamily: FONT_STACK
          }
        }];
        return { type: 'group', children: out };
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
  tlMetricsSet(wayRecs, robots.length);
  tlSpanInfoUpdate();
  tlScrollSync();
  tlListRender(false);
}
/* 标题栏指标卡（Webhook / 手动 / 定时 / 机器人）。
   抽成独立函数：手机端没有甘特图、不跑 tlRender，但这四张卡还得有数
   —— 由记录流自己按全量数据算一份（口径：全部已抓取记录，不是某个时间窗口）。 */
function tlMetricsSet(wayRecs, robotCount) {
  var el;
  if ((el = document.getElementById('mTotal'))) el.textContent = wayRecs.Webhook || 0;
  if ((el = document.getElementById('mManual'))) el.textContent = wayRecs.Manual || 0;
  if ((el = document.getElementById('mTiming'))) el.textContent = wayRecs.TimingTrigger || 0;
  if ((el = document.getElementById('mRobots'))) el.textContent = robotCount || 0;
}
/* 手机端指标：按全部记录统计（没有时间窗口这个概念） */
function tlMetricsFromAll() {
  var wayRecs = { Manual: 0, TimingTrigger: 0, Webhook: 0 };
  var rb = {};
  records.forEach(function (r) {
    if (wayRecs[r.way] != null) wayRecs[r.way]++;
    if (r.robot && r.robot !== '(未指定机器人)') rb[r.robot] = 1;
  });
  tlMetricsSet(wayRecs, Object.keys(rb).length);
}
/* ==================== 运行记录列表（时间轴卡片下方） ====================
   展示当前时间窗口内的记录；点某行 -> 甘特图右边缘对齐该记录的结束时间，
   记录还没结束（end 为空）则对齐到最右，也就是当前时刻。 */
var tlListLast = 0;
/* 手机端记录流的分页状态（桌面端不用）。
   FEED_PAGE 是「一屏大概放几条」，滚到底自动续一批 —— 数据有 1700+ 条，
   一次性渲染既慢又没意义，用户也不可能一次看完。 */
var FEED_PAGE = 20;
var FEED = { n: FEED_PAGE, pending: 0, sig: '' };

/* 记录排序：结束时间倒序（最新跑完的在最上面），还没结束的（在跑）永远置顶。
   end 为空的记录用「现在」当结束时间，所以它天然最大；这里再显式排一次，
   保证多台机器人同时在跑时它们稳定聚在最前面。 */
function tlSortByEndDesc(a, b) {
  var ae = (a.end == null) ? Infinity : a.end;
  var be = (b.end == null) ? Infinity : b.end;
  if (ae !== be) return be - ae;
  return b.start - a.start;          // 结束时间相同：后开始的在前
}

/* ==================== 记录行 <-> 甘特图数据块 联动高亮 ====================
   鼠标悬浮运行记录某一行时，把甘特图里对应的数据块「点亮」，其余整幅淡出。
   这样一眼就能把「表格里这条」和「图上那块」对上，不用自己按时间去数。

   表现设计（三层，都是为了让目标块在密集的时间轴里跳出来）：
   1. 其余所有块淡出到 18% 不透明度 —— 背景退成灰，目标块是唯一的高饱和色；
   2. 目标块本身加一圈金色描边 + 微微外扩（视觉上「鼓」出来一点）；
   3. 目标块上方浮一个时长标签（块太窄、平时不显示文字时也能读到「这条跑了多久」），
      并画一条贯穿整个泳道的竖向高亮带，方便看清它落在哪个时刻。

   实现上不给每条记录单独建 series（1700 条会拖慢渲染）：
   只把「当前悬浮的 rid」存进 tlHover.rid，重绘时按它决定每个块的样式。
   重绘走 echarts 的 lazyUpdate，一帧内多次调用会被合并，悬浮移动不卡。 */
var tlHover = { rid: null, timer: 0 };

function tlSetHover(rid) {
  var v = rid ? String(rid) : null;
  if (v === tlHover.rid) return;          // 值没变就不重绘（行内单元格间移动会高频触发）
  tlHover.rid = v;
  if (tlHover.timer) { clearTimeout(tlHover.timer); tlHover.timer = 0; }
  /* 悬浮切换用一帧节流：快速划过整列行时不必每行都重画一次图 */
  tlHover.timer = setTimeout(function () {
    tlHover.timer = 0;
    if (curView === 'timeline' && !IS_MOBILE) tlRender();
  }, 16);
}
/* 同步表格行的 .hot 类（图表那边由 tlRender 读 tlHover.rid 决定样式） */
function tlHoverRowSync(rid) {
  var tbl = document.getElementById('tlListTbl');
  if (!tbl) return;
  var rows = tbl.querySelectorAll('tr[data-rid]');
  for (var i = 0; i < rows.length; i++) {
    var hit = rid && String(rows[i].getAttribute('data-rid')) === String(rid);
    rows[i].classList.toggle('hot', !!hit);
  }
}

function tlListRender(force) {
  var tbl = document.getElementById('tlListTbl');
  var cards = document.getElementById('tlCards');
  if (!tbl || !cards) return;
  var now = Date.now();
  if (!force && now - tlListLast < 600) return;   // 窗口一直在实时推进，重绘做节流
  tlListLast = now;

  /* 两个容器共存，按断点切显隐：桌面看表格、手机看记录流。
     注意不能互相写 innerHTML —— 那会把对方的元素整个抹掉。 */
  tbl.style.display = IS_MOBILE ? 'none' : '';
  cards.style.display = IS_MOBILE ? 'flex' : 'none';

  /* ---- 手机端：纯记录流（没有甘特图、没有时间窗口概念）----
     列表按「结束时间倒序」列全部记录，滚到底自动续批。
     不再按时间窗口过滤：窗口是甘特图的概念，手机上既然没有图，就没必要让用户
     先选个窗口才能看到记录。 */
  if (IS_MOBILE) {
    tbl.innerHTML = '';
    tlMetricsFromAll();
    tlFeedRender(force);
    return;
  }

  var nowW = Math.min(state.end + state.offset, state.end);
  var winStart = nowW - state.span;
  var rows = records.filter(function (r) {
    var en = r.end == null ? state.end : r.end;
    return en >= winStart && r.start <= nowW;
  });
  rows.sort(function (a, b) { return b.start - a.start; });

  var info = document.getElementById('tlListInfo');
  if (info) info.textContent = '窗口内 ' + rows.length + ' 条 · 共 ' + records.length + ' 条';
  var tipEl = document.getElementById('tlListTip');
  if (tipEl) tipEl.textContent = '点击某行进入该条记录的日志详情 · 悬浮可高亮图中对应数据块';

  if (!rows.length) {
    cards.innerHTML = '';
    tbl.innerHTML = '<tbody><tr><td class="pj-empty-sm" style="border:none;">当前时间窗口内没有记录</td></tr></tbody>';
    return;
  }
  cards.innerHTML = '';
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
  /* 重排后把 .hot 补回去：自动更新每 60s 会重建表格，悬浮中的那一行不能因此丢高亮 */
  tlHoverRowSync(tlHover.rid);
}

/* ---- 手机端记录流 ---- */
/* 一次渲染 n 条（默认首屏 FEED_PAGE 条），滚动到底自动续下一批。
   列表按「结束时间倒序」，新记录从顶部进来 —— 所以「无感」的关键是：
   新数据到达时，如果用户已经滚下去了，绝不重排 DOM（那会把视线顶掉），
   只在顶部浮一个「N 条新记录」的小药丸，点它才回到顶部看新的。 */
function tlFeedList() { return records.slice().sort(tlSortByEndDesc); }

function tlFeedCard(r, i, maxDur) {
  var live = (r.end == null);
  var endMs = live ? Date.now() : r.end;
  var dur = endMs - r.start;
  var q = (r.execStart && r.execStart > r.start) ? (r.execStart - r.start) : 0;
  var pct = Math.max(2, Math.round(dur / maxDur * 100));
  var col = statusColorSolid(r);      // 卡片里是正文文字，用实色（半透明在深底上发灰、读不清）
  function hms(ms) {
    var d = new Date(ms);
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  return '<div class="tl-card-item' + (live ? ' live' : '') +
    (String(r.id) === String(state.focusId) ? ' on' : '') +
    '" data-rid="' + esc(String(r.id)) + '">' +
    '<div class="tl-ci-top">' +
    '<span class="tl-ci-idx">' + (i + 1) + '</span>' +
    '<span class="tl-ci-name">' + esc(r.name || r.app || '—') + '</span>' +
    '<span class="tl-ci-dur" data-live-dur="' + (live ? esc(String(r.id)) : '') + '"' +
    ' data-start="' + r.start + '" style="color:' + col + '">' + fmtDurShort(dur) + '</span>' +
    '</div>' +
    '<div class="tl-ci-mid">' +
    '<span class="tl-ci-robot">' + esc(robotShortName(r.robot)) + '</span>' +
    statusBadge(r.status) +
    '<span class="tl-ci-time">' + hms(r.start) + (live ? ' ~ 进行中' : ' ~ ' + hms(r.end)) +
    (q > 1000 ? ' · 排队 ' + fmtDurShort(q) : '') + '</span>' +
    '</div>' +
    '<div class="tl-ci-bar"><i style="width:' + pct + '%;background:' + col + '"></i></div>' +
    '</div>';
}
function tlFeedRender(force) {
  var box = document.getElementById('tlCards');
  if (!box) return;
  var all = tlFeedList();
  var shown = all.slice(0, FEED.n);

  /* 已经渲染过、且条数与顺序都没变 -> 只刷新「进行中」那几条的时长文字，
     整块 DOM 不动（这是自动更新时最常走的分支，必须零重排）。 */
  var sig = shown.length + '|' + shown.map(function (r) { return r.id; }).join(',');
  if (sig === FEED.sig && !force) {
    tlFeedTick();
    tlFeedInfo(all.length);
    return;
  }
  FEED.sig = sig;

  var maxDur = 1;
  shown.forEach(function (r) {
    var d = (r.end == null ? Date.now() : r.end) - r.start;
    if (d > maxDur) maxDur = d;
  });
  var html = '';
  var lastDay = null;
  shown.forEach(function (r, i) {
    /* 日期分隔条：跨天时插一条「10-10」，长列表里定位「哪天」靠它 */
    var d = new Date(r.start);
    var dayKey = (d.getMonth() + 1) + '-' + pad(d.getDate());
    if (dayKey !== lastDay) {
      lastDay = dayKey;
      html += '<div class="tl-feed-day">' + dayKey + '</div>';
    }
    html += tlFeedCard(r, i, maxDur);
  });
  html += '<div class="tl-feed-end" id="tlFeedEnd">' +
    (shown.length < all.length ? '向下滚动加载更多…' : '已到底 · 共 ' + all.length + ' 条') +
    '</div>';
  box.innerHTML = html;
  tlFeedInfo(all.length);
  tlFeedHidePill();
}
/* 只更新「进行中」记录的时长文字（每 5 秒一跳），不碰其他 DOM */
function tlFeedTick() {
  var els = document.querySelectorAll('.tl-ci-dur[data-live-dur]');
  var nowT = Date.now();
  for (var i = 0; i < els.length; i++) {
    var rid = els[i].getAttribute('data-live-dur');
    if (!rid) continue;
    var st = +els[i].getAttribute('data-start');
    if (st) els[i].textContent = fmtDurShort(nowT - st);
  }
}
function tlFeedInfo(total) {
  var info = document.getElementById('tlListInfo');
  if (info) info.textContent = '已显示 ' + Math.min(FEED.n, total) + ' / ' + total + ' 条';
  var tipEl = document.getElementById('tlListTip');
  if (tipEl) tipEl.textContent = '按结束时间排序 · 下拉加载更多';
}
/* 顶部「N 条新记录」小药丸：用户滚下去了才显示，点一下回到顶部并刷新列表 */
function tlFeedPill(n) {
  var el = document.getElementById('tlFeedPill');
  if (!el) return;
  if (!n) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.textContent = '↑ ' + n + ' 条新记录';
}
function tlFeedHidePill() {
  FEED.pending = 0;
  tlFeedPill(0);
}
/* 药丸点击：回到顶部并重排列表（此时用户明确表示要看新的） */
function tlFeedPillBind() {
  var el = document.getElementById('tlFeedPill');
  if (!el || el._bound) return;
  el._bound = 1;
  el.addEventListener('click', function () {
    FEED.sig = '';
    tlFeedRender(true);
    tlFeedObserve();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}
/* 数据刷新后调用：判断要不要重排列表，还是只提示「有新记录」 */
function tlFeedSync() {
  var all = tlFeedList();
  var sig = Math.min(FEED.n, all.length) + '|' +
    all.slice(0, FEED.n).map(function (r) { return r.id; }).join(',');
  if (sig === FEED.sig) { tlFeedTick(); tlFeedInfo(all.length); return; }
  /* 用户在顶部（或列表还没满一屏）-> 直接换掉，他看得见新内容，不存在「被顶掉」 */
  var atTop = (window.scrollY || document.documentElement.scrollTop || 0) < 80;
  if (atTop) { tlFeedRender(true); return; }
  /* 已经滚下去了：只记数、浮药丸，DOM 一律不动 */
  var shownIds = FEED.sig.split('|')[1] ? FEED.sig.split('|')[1].split(',') : [];
  var newTop = all.slice(0, FEED.n).map(function (r) { return String(r.id); });
  var added = 0;
  for (var i = 0; i < newTop.length; i++) {
    if (shownIds.indexOf(newTop[i]) < 0) added++; else break;
  }
  FEED.pending = added || 1;
  tlFeedPill(FEED.pending);
  tlFeedTick();
}
/* 滚到底自动续批：哨兵元素进入视口就 +1 页。
   用 IntersectionObserver 而不是 scroll 事件 —— 后者要自己算阈值、还得防抖，
   这里只要「底部哨兵露头就加载」，交给浏览器判定更稳。 */
function tlFeedObserve() {
  var sentinel = document.getElementById('tlFeedEnd');
  if (!sentinel || !window.IntersectionObserver) return;
  if (tlFeedObserve._io) tlFeedObserve._io.disconnect();
  tlFeedObserve._io = new IntersectionObserver(function (ents) {
    for (var i = 0; i < ents.length; i++) {
      if (ents[i].isIntersecting && FEED.n < records.length) {
        FEED.n += FEED_PAGE;
        tlFeedRender(true);
        tlFeedObserve();          // 哨兵被换掉了，重新观察新的
        break;
      }
    }
  }, { root: null, rootMargin: '300px' });
  tlFeedObserve._io.observe(sentinel);
}
/* 打开某条记录的详情页（桌面表格行 / 手机卡片都走这里）。
   顺带记住点过哪条：从详情页返回时该行仍高亮，便于接着往下看。 */
function tlOpenRec(rid) {
  if (!rid) return;
  state.focusId = String(rid);
  location.hash = '#/detail?id=' + encodeURIComponent(rid);
}
/* 运行记录列表的交互：
   - 点击 -> 进该条记录的日志详情（两端一致，不再要求「先对齐甘特图再点」两步）
   - 桌面端鼠标悬浮 -> 甘特图里对应的数据块高亮（见 tlSetHover / tlRender 的 hot 分支） */
function tlListBind() {
  var box = document.getElementById('tlList');
  if (!box || box._tlBound) return;
  box._tlBound = 1;
  box.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    var el = e.target.closest('.tl-card-item[data-rid], tr[data-rid]');
    if (el) tlOpenRec(el.getAttribute('data-rid'));
  });
  /* 悬浮联动：只在桌面端做（触屏没有 hover 语义，硬做反而会在点按时闪一下）。
     用 mouseover 事件委托 + 每次都比较当前值（tlSetHover 内部提前返回），
     行内单元格之间移动不会产生多余的图表重绘。 */
  box.addEventListener('mouseover', function (e) {
    if (IS_MOBILE) return;
    var tr = (e.target && e.target.closest) ? e.target.closest('tr[data-rid]') : null;
    tlSetHover(tr ? tr.getAttribute('data-rid') : null);
  });
  box.addEventListener('mouseleave', function () { tlSetHover(null); });
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
function tlUpdateWindow() { if (curView === 'timeline' && !IS_MOBILE) tlRender(); }
function tlResize() { if (tlChart) tlChart.resize(); }
function tlChartResize() { if (tlChart) tlChart.resize(); }
function tlInit() {
  records = RECORDS.slice();
  recomputeBounds();
  /* 手机端没有甘特图（整块砍掉，只留记录流），所以不建 ECharts 实例、
     也不绑滚轮/拖动/缩放那一套 —— 少一个 canvas、少一堆手势冲突。
     桌面端照旧。断点切换时由 applyLayout 补建/销毁。 */
  if (IS_MOBILE) {
    FEED.n = FEED_PAGE;
    FEED.sig = '';
    tlFeedPillBind();
    /* 点击进详情的事件委托必须在这里绑：tlInit 手机端会提前 return，
       绑在函数末尾的话手机端永远执行不到 —— 这正是「手机点卡片进不去详情页」的原因。 */
    tlListBind();
    tlListRender(true);      // 由它统一切「表格 / 记录流」的显隐，避免两处各写一遍
    tlFeedObserve();
    return;
  }
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
    var g = tlGrid();
    /* 锚点比例按「绘图区内」算（减掉左右留白），不然边距会让锚点偏掉。
       两端都是横向布局，一律取横坐标。 */
    var frac = (e.clientX - rect.left - g.left) / Math.max(1, rect.width - g.left - g.right);
    frac = Math.max(0, Math.min(1, frac));
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
    /* 1:1 跟手：整幅「时间长度」对应整个窗口宽度，拖 N 像素就走 N 像素的时间。
       两端都是横向拖动（横向手势归平移，纵向留给滚页面）。 */
    var dMs = (tlPan.last - tlPan.start) * (state.span / tlTimeLenPx());
    panTo(tlPan.left - dMs);
  }
  /* 拖动事件挂在 window 上：不做指针捕获（捕获会把鼠标事件从 canvas 上截走，
     ECharts 内部的 hover / click 判定会乱），移出图表范围也能继续拖、抬手即止 */
  chartEl.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;                     // 只响应左键 / 单指
    var nowW = Math.min(state.end + state.offset, state.end);
    var pos = tlPointerPos(e);                      // 按布局取向：桌面 clientX、手机 clientY
    tlPan = { start: pos, last: pos, left: nowW - state.span };
    tlPanMoved = false;
    chartEl.classList.add('tl-pan');
  });
  function panMove(e) {
    if (!tlPan) return;
    var pos = tlPointerPos(e);
    tlPan.last = pos;
    if (Math.abs(pos - tlPan.start) > 3) tlPanMoved = true;
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
/* 甘特图实时推进（「现在」分界线 + 数据块随时间左移）：只在桌面端跑。
   手机端没有图，这里直接不做事；「进行中」的时长由下面 5 秒那支定时器单独刷新。 */
setInterval(function () {
  if (curView !== 'timeline' || IS_MOBILE) return;
  state.end = Date.now();
  tlRender();
}, 200);
/* 手机端记录流里「进行中」的时长每 5 秒走一格（只改那几行的文本，不重排 DOM） */
setInterval(function () {
  if (curView === 'timeline' && IS_MOBILE) tlFeedTick();
}, 5000);

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
    + '<div class="log-head"><div class="log-title"><h3>日志内容</h3>'
    + '<button class="chip log-refresh" id="btnLogRefresh" disabled title="只重新读取日志文件内容：新内容增量追加，滚动位置与搜索状态都保留">'
    + '<span class="lg-spin">↻</span> 刷新</button>'
    + '</div>'
    + '<div class="log-tools">'
    + '<span class="stat" id="logStat">—</span>'
    + '<input class="find" id="logFind" type="search" placeholder="搜索关键词" disabled>'
    + '<button class="chip" id="btnPrev" disabled>上一处</button>'
    + '<button class="chip" id="btnNext" disabled>下一处</button>'
    + '<button class="chip" id="btnOnlyErr" disabled>仅看异常</button>'
    + '<button class="chip" id="btnCopyPath" disabled title="复制当前日志文件的完整共享路径">复制路径</button>'
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
  zoneIds: [],     // 已挂到编辑器上的 view zone 句柄（整段重载时按此清理残留提示条）
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
    lgFoldClearZones(acc);                 // 先清掉编辑器上残留的提示条（含整段重载后 maps 已丢句柄的）
    for (var k in map) {
      var rec = map[k];
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
        LOG_FOLD.zoneIds.push(rec2.zoneId);
      })(+k, rec);
    }
  });
  lgFoldApplyDecos(fi);
}

/* 清空编辑器上的折叠提示条。整段重载会重建 maps（旧 zoneId 句柄随之丢失），
   残留的提示条只能靠这里统一登记的 zoneIds 才能摘掉。 */
function lgFoldClearZones(acc) {
  var ids = LOG_FOLD.zoneIds || [];
  for (var i = 0; i < ids.length; i++) {
    try { acc.removeZone(ids[i]); } catch (e) { }
  }
  LOG_FOLD.zoneIds = [];
  var maps = LOG_FOLD.maps || [];
  for (var fi = 0; fi < maps.length; fi++) {
    var map = maps[fi];
    for (var k in map) map[k].zoneId = null;
  }
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
  logSyncCopyBtn();   // 日志读取失败/无目录等分支也会走到这里，顺手同步复制按钮
  lgRefreshSyncBtn(); // 同理：没有日志文件时刷新按钮保持不可点
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
  logSyncCopyBtn();    // 切文件：复制目标跟着变，同步按钮可用态与悬停提示
  lgRefreshSyncBtn();  // 刷新按钮同样只作用于当前选中的日志文件
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

/* ---- 复制路径：把当前日志文件的完整共享路径（UNC）写进剪贴板 ----
   排查时经常要把路径发给同事（对方粘贴到资源管理器地址栏即可打开），
   路径来自局域网共享（\\SX-01\Logs\…），手抄易错，所以给个按钮。
   目标跟随当前选中的日志文件标签，切文件即变。 */
var LG_COPY = { timer: 0, flash: 0 };
function lgDirPath() {
  var d = (DETAIL_REC && DETAIL_REC.log) ? String(DETAIL_REC.log) : "";
  return d.replace(/[\\/]+$/, "");
}
function lgActiveFilePath() {
  var dir = lgDirPath();
  if (!dir) return "";
  var f = LOG_FILES[LOGM.active];
  if (!f || !f.name) return dir;
  return dir + (dir.charAt(dir.length - 1) === "\\" ? "" : "\\") + f.name;
}
/* 剪贴板：localhost 属安全上下文，走异步 API；局域网 http://IP:8000 不是安全上下文，
   navigator.clipboard 直接不存在，必须回落到 textarea + execCommand。 */
function lgLegacyCopy(text) {
  try {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "readonly");
    ta.style.cssText = "position:fixed;top:-1000px;left:0;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    var ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}
function lgCopyPath() {
  /* 正常情况下复制当前选中日志文件的完整路径；共享目录没连上、文件清单读不出来时，
     退回复制记录里的日志目录（粘到资源管理器同样能打开），并在提示里说明。 */
  var f = LOG_FILES[LOGM.active];
  var isFile = !!(f && f.name);
  var text = isFile ? lgActiveFilePath() : lgDirPath();
  if (!text) { lgToast("该记录没有可复制的日志路径", false); return; }
  var btn = document.getElementById("btnCopyPath");
  /* 反馈只改颜色不改文案：按钮尺寸保持不变，工具条不会因为「已复制」三个字抖一下 */
  var done = function () {
    lgToast((isFile ? "已复制：" : "已复制日志目录：") + text);
    if (!btn) return;
    btn.classList.add("ok");
    if (LG_COPY.flash) clearTimeout(LG_COPY.flash);
    LG_COPY.flash = setTimeout(function () { btn.classList.remove("ok"); }, 1400);
  };
  var fail = function () { lgToast("复制失败，请手动选中路径复制", false); };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(function () {
      lgLegacyCopy(text) ? done() : fail();
    });
    return;
  }
  lgLegacyCopy(text) ? done() : fail();
}
/* 轻提示：index.html 里的 #toast 在时间轴视图内，详情页看不见，单独建一个 */
function lgToast(msg, ok) {
  var el = document.getElementById("lgToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "lgToast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = "show" + (ok === false ? " err" : "");
  if (LG_COPY.timer) clearTimeout(LG_COPY.timer);
  LG_COPY.timer = setTimeout(function () { el.className = ""; }, 2200);
}
/* 复制按钮可用态与悬停提示：只要记录里有日志目录就能点（目录没连上/文件没读完时退回复制目录） */
function logSyncCopyBtn() {
  var btn = document.getElementById("btnCopyPath");
  if (!btn) return;
  var f = LOG_FILES[LOGM.active];
  var isFile = !!(f && f.name);
  var path = isFile ? lgActiveFilePath() : lgDirPath();
  var noShare = DETAIL_REC && DETAIL_REC.logOk === false;
  btn.disabled = !path;
  btn.title = !path ? "该记录没有可复制的日志路径"
    : (isFile ? "复制当前日志文件的完整共享路径：\n" + path
      : "复制该记录的日志目录（当前日志文件清单未读取到）：\n" + path)
    + (noShare ? "\n（提示：该共享目录当前不可访问，可能未同步或未连接）" : "");
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
    logSyncCopyBtn();    // 文件清单就绪：复制按钮拿到当前文件的完整共享路径
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
    logSyncCopyBtn();    // 文件加载状态变化后同步复制按钮
    lgRefreshSyncBtn();  // 文件就绪后刷新按钮才可点（只在文件页返回时生效）
    lgApplyLink();       // 深链：文件模型就绪后自动定位关键词
  }).catch(function () {
    f.pending = false;
    var b = document.getElementById("btnMore");
    if (b && b.tagName === "BUTTON") { b.disabled = false; b.textContent = "加载失败，点击重试"; }
  });
}

/* ---- 刷新：只重读当前日志文件的内容 ----
   看实时日志时不用退出重进详情页。做的是「重读文件」，不是「重建页面」：
   - 以已加载行数为 offset 请求一页（&refresh=1），服务端额外返回 anchor（第 offset 行原文）
     与 total（当前总行数）；
   - anchor 与已加载的最后一行一致 → 文件只是尾部追加，把新行接到模型末尾，
     Monaco 增量追加不会动滚动位置，搜索词/仅看异常/折叠状态全都保留；
   - anchor 不一致 → 文件被重写或轮转，退回整段重载（避免新旧内容错接），并尽量还原视口位置。
   注意：比对只覆盖第 offset 行，文件在已加载区间中间被改写是检测不到的（八爪鱼日志只会追加）。 */
var LG_REFRESH = { busy: false };
function lgRefreshBtn() { return document.getElementById("btnLogRefresh"); }
function lgRefreshTarget() {
  var f = LOG_FILES[LOGM.active];
  return (f && f.name && !f.pending) ? f : null;
}
function lgRefreshSyncBtn() {
  var b = lgRefreshBtn();
  if (!b) return;
  var f = lgRefreshTarget();
  b.disabled = LG_REFRESH.busy || !f;
  b.title = f
    ? "只重新读取当前日志文件内容（" + f.name + "）：新内容增量追加，滚动位置与搜索状态都保留"
    : "只重新读取当前日志文件内容";
}
/* 已加载内容的最后一行原文（取自 f.content，不受超长行折叠影响） */
function lgLastLoadedLine(f) {
  var s = f.content || "";
  var i = s.lastIndexOf("\n");
  return i < 0 ? s : s.slice(i + 1);
}

function lgRefreshFile() {
  if (LG_REFRESH.busy) return;
  var fi = LOGM.active;
  var f = lgRefreshTarget();
  if (!f) { lgToast("当前没有可刷新的日志文件", false); return; }
  LG_REFRESH.busy = true;
  lgRefreshSyncBtn();
  var b = lgRefreshBtn();
  if (b) b.classList.add("busy");
  var offset = f.loaded || 0;
  var url = "/api/log?dir=" + encodeURIComponent(DETAIL_REC.log)
    + "&file=" + encodeURIComponent(f.name)
    + "&offset=" + offset + "&limit=" + LOG_PAGE + "&refresh=1";
  fetch(url, { credentials: 'same-origin' }).then(function (r) {
    if (r.status === 401) { location.href = '/login'; return null; }
    return r.json();
  }).then(function (d) {
    LG_REFRESH.busy = false;
    if (b) b.classList.remove("busy");
    if (d === null) return;                                  // 401 已跳登录页
    if (!d || !d.ok) {
      lgRefreshSyncBtn();
      lgToast("刷新失败：" + ((d && d.error) || "未知错误"), false);
      return;
    }
    if (offset > 0 && d.anchor !== lgLastLoadedLine(f)) {
      lgReloadFile(fi, "日志文件已被重写，已重新载入");       // 轮转/覆盖：整段重载
      return;
    }
    var delta = d.content || "";
    f.size = d.size || f.size;
    f.total = d.total || f.total;
    if (!delta) {                                            // 没有新行：只同步元数据
      f.hasMore = !!d.hasMore;
      lgRefreshSyncBtn(); logRenderTabs();
      lgToast("已是最新（共 " + f.total + " 行）");
      return;
    }
    f.content += (f.content ? "\n" : "") + delta;
    var hadMore = f.hasMore;           // 刷新前是否还有没载入的行：决定提示说「新增」还是「载入」
    f.loaded = offset + (d.lines || 0);
    f.hasMore = !!d.hasMore;
    logSyncModel(fi, offset, delta);   // 只往模型尾部追加，滚动位置与搜索状态都不动
    if (LOGM.kw) logApplyHits();       // 有关键词时重算命中：新增行里的命中也要高亮、可跳转
    lgStatUpdate();
    logRenderTabs();
    lgRefreshSyncBtn();
    lgToast("已刷新：" + f.name + (hadMore ? " 载入 " : " 新增 ") + (d.lines || 0) + " 行（共 " + f.total + " 行）");
  }).catch(function (e) {
    LG_REFRESH.busy = false;
    if (b) b.classList.remove("busy");
    lgRefreshSyncBtn();
    lgToast("刷新失败：" + (e && e.message ? e.message : e), false);
  });
}

/* 整段重载当前文件（刷新时发现文件被重写/轮转，或加载失败重试） */
function lgReloadFile(fi, tip) {
  var f = LOG_FILES[fi];
  if (!f || f.pending) return;
  f.pending = true;
  var ed = LOGM.editor;
  var top = ed ? ed.getScrollTop() : 0;
  var url = "/api/log?dir=" + encodeURIComponent(DETAIL_REC.log)
    + "&file=" + encodeURIComponent(f.name) + "&offset=0&limit=" + LOG_PAGE + "&refresh=1";
  fetch(url, { credentials: 'same-origin' }).then(function (r) {
    if (r.status === 401) { location.href = '/login'; return null; }
    return r.json();
  }).then(function (d) {
    f.pending = false;
    if (d === null) return;
    if (!d || !d.ok) {
      lgRefreshSyncBtn();
      lgToast("重新载入失败：" + ((d && d.error) || "未知错误"), false);
      return;
    }
    f.content = d.content || "";
    f.loaded = d.lines || 0;
    f.total = d.total || f.loaded;
    f.size = d.size || f.size;
    f.hasMore = !!d.hasMore;
    if (LOGM.editor) logSyncModel(fi, 0, f.content);
    lgFoldReattach(fi);                // setValue 清空了折叠记录，残留的提示条要摘掉、新扫描的再挂上
    logApplyHits();                    // 内容整体换过：命中列表与高亮重算
    lgStatUpdate();
    logRenderTabs();
    lgRefreshSyncBtn();
    if (ed && LOGM.editor && ed.getModel() === LOGM.models[fi]) {
      ed.setScrollTop(top, window.monaco.editor.ScrollType.Immediate);   // 尽量停在原来的视口位置
    }
    if (tip) lgToast(tip);
  }).catch(function (e) {
    f.pending = false;
    lgRefreshSyncBtn();
    lgToast("重新载入失败：" + (e && e.message ? e.message : e), false);
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
  /* 复制路径：把当前日志文件的完整共享路径写进剪贴板 */
  b = document.getElementById("btnCopyPath");
  if (b) b.addEventListener("click", lgCopyPath);
  /* 刷新：只重读当前日志文件内容（看实时日志不用退出重进详情页） */
  b = lgRefreshBtn();
  if (b) b.addEventListener("click", lgRefreshFile);
  lgRefreshSyncBtn();
}

/* ---- 释放（详情重建 / 离开详情页时调用） ---- */
function lgReset() {
  if (LOGM.editor) { try { LOGM.editor.dispose(); } catch (e) { } LOGM.editor = null; }
  for (var i = 0; i < LOGM.models.length; i++) {
    if (LOGM.models[i]) { try { LOGM.models[i].dispose(); } catch (e) { } }
  }
  LOGM.models = []; LOGM.decos = []; LOGM.fileMarks = []; LOGM.matches = [];
  LOG_FOLD.maps = []; LOG_FOLD.zoneIds = []; LOG_FOLD.pendingTop = null;
  LOGM.cur = -1; LOGM.kw = ""; LOGM.only = false; LOGM.active = 0;
  LOG_FILES = [];
  LG_REFRESH.busy = false;
  var el = document.getElementById("logStat");
  if (el) { el.textContent = "—"; el.removeAttribute("title"); }
  var ids = ["btnPrev", "btnNext", "btnOnlyErr", "logFind", "btnCopyPath", "btnLogRefresh"], b, j;
  for (j = 0; j < ids.length; j++) {
    b = document.getElementById(ids[j]);
    if (b) { b.disabled = true; if (ids[j] === "btnOnlyErr") { b.className = "chip"; b.textContent = "仅看异常"; } }
  }
  var rb = lgRefreshBtn();
  if (rb) rb.classList.remove("busy");
  var f = document.getElementById("logFind");
  if (f) f.value = "";
  /* 复制按钮：清掉上一次的「已复制」高亮（LOG_FILES 已清空，可用态由 logSyncCopyBtn 接管） */
  if (LG_COPY.flash) { clearTimeout(LG_COPY.flash); LG_COPY.flash = 0; }
  var cp = document.getElementById("btnCopyPath");
  if (cp) cp.classList.remove("ok");
  var box = document.getElementById("logbox");
  if (box) box.classList.remove("lg-only");
}

/* ==================== 日程视图 ==================== */
/* 版式：真表格 —— 行 = 执行时刻，列 = 周几（每周视图）/ 当月有任务的日期（每月视图），
   格子里直接列出该时刻要跑的应用标签。
   取代原来的 ECharts 甘特图：行高固定不再互相压、应用名完整可读、
   悬停点亮同应用全部标签、点击标签直达项目控制台该项目的运行记录。
   筛选条件（视图 / 机器人 / 状态）与选项保持原样。 */
var WEEK_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
var scView = 'week', scFilter = '__ALL__', scStatus = 'enabled';
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
/* 当前筛选下的排期点；xi = 列下标（周几，或日期在 monthLabels 里的位置） */
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
        pts.push({ xi: xi, t: p.t, hm: p.hm || scTimeText(p.t), app: p.app, short: p.short,
                   color: p.color, fid: p.fid || '', enabled: p.enabled, robot: r });
      });
    });
  });
  return pts;
}
/* 标签：同一格子内同应用只出一个，多机器人时在悬停提示里列出全部机器人 */
function scTagHtml(it) {
  var tip = it.app + '　·　' + it.robots.join('、') + (it.enabled ? '' : '（已停用）');
  return '<span class="sc-tag' + (it.enabled ? '' : ' off') + '"'
    + ' data-app="' + esc(it.app) + '"'
    + (it.fid ? ' data-fid="' + esc(it.fid) + '"' : '')
    + ' style="--c:' + it.color + '" title="' + esc(tip) + '">'
    + esc(it.short || it.app)
    + (it.robots.length > 1 ? '<i class="sc-mul">×' + it.robots.length + '</i>' : '')
    + '</span>';
}
function scRender(view, filter, status) {
  scView = view;
  var isMonth = view === 'month';
  var xLabels = isMonth ? (SCHED.monthLabels || []) : WEEK_LABELS;
  var pts = scBuildPoints(view, filter, status);

  /* 聚合成 cellMap[时刻][列] = [应用标签…] */
  var cellMap = {};
  pts.forEach(function (p) {
    var row = cellMap[p.t] || (cellMap[p.t] = {});
    var cell = row[p.xi] || (row[p.xi] = []);
    var hit = null;
    for (var i = 0; i < cell.length; i++) { if (cell[i].app === p.app) { hit = cell[i]; break; } }
    if (hit) {
      if (hit.robots.indexOf(p.robot) < 0) hit.robots.push(p.robot);
      /* 同一应用既有启用又有停用排期时，按启用那套颜色显示（与原图表口径一致） */
      if (p.enabled && !hit.enabled) { hit.enabled = true; hit.color = p.color; }
      if (!hit.fid && p.fid) hit.fid = p.fid;
    } else {
      cell.push({ app: p.app, short: p.short, color: p.color, fid: p.fid,
                  enabled: p.enabled, robots: [p.robot] });
    }
  });
  var times = Object.keys(cellMap).map(Number).sort(function (a, b) { return a - b; });

  var html = '<thead><tr><th class="sc-time-h">时刻</th>';
  xLabels.forEach(function (l) { html += '<th>' + esc(l) + '</th>'; });
  html += '</tr></thead><tbody>';
  if (!times.length) {
    html += '<tr><td class="sc-empty" colspan="' + (xLabels.length + 1) + '">'
      + '当前筛选条件下没有排期数据（可把「状态」切到「全部状态」试试）</td></tr>';
  }
  times.forEach(function (t) {
    html += '<tr><td class="sc-time">' + scTimeText(t) + '</td>';
    for (var i = 0; i < xLabels.length; i++) {
      var cell = cellMap[t][i];
      html += '<td class="sc-cell">';
      if (cell && cell.length) {
        cell.sort(function (a, b) { return a.app.localeCompare(b.app, 'zh'); });
        cell.forEach(function (it) { html += scTagHtml(it); });
      } else {
        html += '<span class="sc-dash">·</span>';
      }
      html += '</td>';
    }
    html += '</tr>';
  });
  html += '</tbody>';

  var tbl = document.getElementById('scTbl');
  if (tbl) { tbl.innerHTML = html; tbl.classList.remove('sc-has-hot'); }
  scHotApp = null;
  scTodayCol = -1;          // 表格重建过，今天列的底色要重新标一次
  scUpdateNowLine();
  var info = document.getElementById('scInfo');
  if (info) {
    info.textContent = times.length + ' 个时刻 · ' + pts.length + ' 个排期点'
      + (isMonth ? '（' + xLabels.length + ' 天）' : '');
  }
}
/* ---- 当前时刻标记：今天那一列加底色 + 一条当前时刻的红色虚线横线 ----
   两者都在应用标签「下面」：列底色是 td 自己的 background（天然在内容之下）；
   横线是覆盖层，z-index 低于 .sc-tag（见 style.css），所以不会压住标签文字。 */
var scTodayCol = -1;        // 今天所在列下标（-1 = 当前视图里没有今天）
/* 今天那一列加底色：每周视图取当天周几，每月视图取当天日期在 monthLabels 里的位置 */
function scMarkToday() {
  var tbl = document.getElementById('scTbl');
  if (!tbl) return;
  var idx = scView === 'month'
    ? (SCHED.monthLabels || []).indexOf(new Date().getDate() + '日')
    : (new Date().getDay() + 6) % 7;
  if (idx === scTodayCol) return;      // 没变就不动 DOM
  scTodayCol = idx;
  var old = tbl.querySelectorAll('.sc-today');
  for (var i = 0; i < old.length; i++) old[i].classList.remove('sc-today');
  if (idx < 0) return;                 // 月视图里当月没有今天的排期列
  var rows = tbl.rows;
  for (var r = 0; r < rows.length; r++) {
    var c = rows[r].cells[idx + 1];    // 第 0 列是「时刻」，列下标整体右移一格
    if (c) c.classList.add('sc-today');
  }
}
/* 横线的纵坐标：按「时刻」列的中心线做线性插值，落在两行之间时按时间比例取点 */
function scUpdateNowLine() {
  if (curView !== 'schedule') return;
  var tbl = document.getElementById('scTbl');
  var wrap = document.getElementById('scWrap');
  var line = document.getElementById('scNowLine');
  if (!tbl || !wrap || !line) return;
  scMarkToday();

  /* 收集各时刻行相对 wrap 的纵向位置（表头与「无数据」行不算） */
  var marks = [], rows = tbl.rows;
  var wrapTop = wrap.getBoundingClientRect().top;
  for (var r = 1; r < rows.length; r++) {
    var td = rows[r].cells[0];
    if (!td || !td.classList.contains('sc-time')) continue;
    var txt = (td.textContent || '').trim();
    if (!/^\d{2}:\d{2}$/.test(txt)) continue;
    var rect = td.getBoundingClientRect();
    marks.push({
      t: parseInt(txt.slice(0, 2), 10) + parseInt(txt.slice(3), 10) / 60,
      top: rect.top - wrapTop, h: rect.height
    });
  }
  var n = marks.length;
  if (!n) { line.style.display = 'none'; return; }

  var now = new Date();
  var nt = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  var y;
  if (nt <= marks[0].t) {
    y = marks[0].top;                                   // 早于首个时刻：贴第一行顶
  } else if (nt >= marks[n - 1].t) {
    y = marks[n - 1].top + marks[n - 1].h;              // 晚于末个时刻：贴最后一行底
  } else {
    for (var i = 0; i < n - 1; i++) {
      if (nt >= marks[i].t && nt <= marks[i + 1].t) {
        var span = marks[i + 1].t - marks[i].t;
        var f = span > 0 ? (nt - marks[i].t) / span : 0;
        var c0 = marks[i].top + marks[i].h / 2;
        var c1 = marks[i + 1].top + marks[i + 1].h / 2;
        y = c0 + f * (c1 - c0);
        break;
      }
    }
  }
  if (y == null) { line.style.display = 'none'; return; }
  line.style.display = '';
  line.style.top = Math.round(y) + 'px';
  var lab = line.firstChild;
  if (lab) lab.textContent = scTimeText(nt);
}
/* 标签点击 -> 项目控制台并打开该项目的「运行记录」tab；悬停 -> 点亮同应用全部标签。
   表格元素常驻（只换 innerHTML），所以事件只绑一次。 */
function scBind() {
  var tbl = document.getElementById('scTbl');
  if (!tbl) return;
  tbl.addEventListener('click', function (e) {
    var tag = e.target.closest ? e.target.closest('.sc-tag') : null;
    if (!tag) return;
    var fid = tag.getAttribute('data-fid');
    if (!fid) {
      alert('这条排期没有关联的项目 ID。\n请点右上角「立刻更新」重新抓取一次数据（新版会带上 flow_id）。');
      return;
    }
    location.hash = '#/projects?fid=' + encodeURIComponent(fid) + '&tab=runs';
  });
  tbl.addEventListener('mouseover', function (e) {
    var tag = e.target.closest ? e.target.closest('.sc-tag') : null;
    if (tag) scHighlight(tag.getAttribute('data-app'));
  });
  tbl.addEventListener('mouseout', function (e) {
    var tag = e.target.closest ? e.target.closest('.sc-tag') : null;
    if (tag) scUnhighlight();
  });
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
/* 窗口尺寸变化 / 横向滚动后，横线的像素位置要按新布局重算 */
function scResize() { scUpdateNowLine(); }
function scInit() {
  if (!SCHED || !SCHED.ok) return;
  document.getElementById('sTotal').textContent = SCHED.stats.total;
  document.getElementById('sEnabled').textContent = SCHED.stats.enabled;
  document.getElementById('sDisabled').textContent = SCHED.stats.disabled;
  document.getElementById('sWebhook').textContent = SCHED.stats.webhook;
  scBind();
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
  if (!SCHED || !SCHED.ok) return;
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
/* 当前时刻标记每 10 秒跟随一次（横线位置 + 今天列的底色，跨天时自动切换） */
setInterval(scUpdateNowLine, 10000);

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
  /* 自动更新（!force）只读后端内存里的数据：GET /api/runs，不触发任何抓取。
     抓取由后端常驻线程每分钟自己做，登录失效也会自动重登后重试；
     所以这里不判断后端抓取状态，读到什么就显示什么（陈旧数据由标题栏
     「数据获取时间」如实反映）。「立刻更新」（force=1）才走 POST 触发全量抓取。 */
  var req = force
    ? fetch('/api/refresh?force=1', { method: 'POST', credentials: 'same-origin' }).then(function (r) {
        if (r.status === 401) { location.href = '/login'; return null; }
        return r.json();
      })
    : api('/api/runs');
  return req.then(function (d) {
    var warnEl = document.getElementById('refreshWarn');
    var okFlag = false;
    if (d && d.ok && Array.isArray(d.records)) {
      okFlag = true;
      // 只有「立刻更新」会失败；自动更新读的是后端内存，失败时才提示
      if (warnEl && force) warnEl.style.display = 'none';
      RECORDS = d.records;
      if (curView === 'timeline') {
        records = RECORDS.slice();
        recomputeBounds();
        /* 手机端走记录流：有变化才重排，用户滚下去了就只浮「N 条新记录」提示，不顶掉视线 */
        if (IS_MOBILE) tlFeedSync();
        else tlRender();
      }
      else if (curView === 'analysis' && anReady) anRenderAll(RECORDS);
      else if (curView === 'botstatus') bsLoad().then(bsRender);
      else if (curView === 'compliance') cpLoad();
      else if (curView === 'schedule' && force) {
        // 排期页仅在「立刻更新」（全量抓，含触发器）后重载；自动更新只读运行记录，不影响排期
        loadSchedule().then(function () { scReload(); });
      }
      if (d.time) document.getElementById('dataTime').textContent = d.time;
    } else if (warnEl && force) {
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
/* 自动更新：每 60s 拉一次后端内存里的运行记录（GET /api/runs，不触发抓取），
   仅在依赖实跑数据的视图生效。抓取由后端常驻线程每分钟自行完成。 */
function autoTick() {
  if (curView === 'timeline' || curView === 'analysis') refreshData();
}
/* 机器人状态页快刷：后端每 ~8s 轮询桌面 API underway（运行中记录，与
   OctopusRPA 桌面客户端同机制），这里 10s 直接拉 /api/botstatus，
   不经过 60s 的 refreshData 链路。勾选「自动更新」时生效。 */
setInterval(function () {
  if (curView === 'botstatus' && document.getElementById('chkAuto').checked) {
    bsLoad().then(bsRender);
  }
}, 10000);
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
    onDone: function () {
      /* 新运行要等后端下一轮抓取（约 1 分钟内）才会进内存；这里先把内存里的
         数据重画一遍，不额外触发后端抓取。 */
      if (typeof refreshData === 'function') refreshData();
    }
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
var pjPendingTab = null;   // 待打开的 tab（排期页点应用标签带 ?tab=runs 进入）
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
        else if (el) {
          el.insertAdjacentHTML('afterbegin',
            '<div class="pj-loading">未在云端项目列表中找到该项目（flowId: '
            + esc(pjPendingFid) + '），可能已被删除或改名。</div>');
        }
        pjPendingFid = null;
      }
      if (pjCurrent) document.getElementById('pjGroup').value = pjCurrent.group || '';
    } else if (el) {
      el.innerHTML = '<div class="pj-loading">加载失败：' + esc((d && d.error) || '未知错误') + '</div>';
      pjMetrics(null);
    }
    return pjItems;
  }).catch(function (e) {
    if (el) el.innerHTML = '<div class="pj-loading">加载失败：' + esc(e) + '</div>';
    pjMetrics(null);
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
function pjMetrics(items) {
  /* 项目控制台：标题栏指标卡（项目总数 + 飞书配置组映射情况）；items 为空则清空 */
  var m = document.getElementById('pjMetrics');
  if (!m) return;
  if (!items || !items.length) { m.innerHTML = ''; return; }
  var mapped = 0, groups = {};
  items.forEach(function (it) {
    if (it.group) { mapped++; groups[it.group] = 1; }
  });
  m.innerHTML = anCard('项目总数', items.length, '#378ADD')
    + anCard('已配映射', mapped, '#1D9E75')
    + anCard('未配映射', items.length - mapped, '#888780')
    + anCard('配置组数', Object.keys(groups).length, '#7F77DD');
}
function pjRenderList() {
  var el = document.getElementById('pjList');
  if (!el) return;
  pjMetrics(pjItems);
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
  /* 带 ?tab=runs 进入（排期页点标签跳转）：直接落在「运行记录」tab 上 */
  var wantTab = pjPendingTab === 'runs' ? 'runs' : 'cfg';
  pjPendingTab = null;
  pjSwitchTab(wantTab);
  if (wantTab === 'cfg' && pjCurrent.group) { pjCfgLoad(); }
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
      ? '共 ' + mine.length + ' 条运行记录（全量），展示最近 ' + Math.min(mine.length, 20) + ' 条；点击某条查看日志详情。'
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
function bsMetrics(s) {
  /* 机器人状态：标题栏指标卡（原来是工具条里的一句长文字，扫一眼不如数字） */
  var m = document.getElementById('bsMetrics');
  if (!m) return;
  m.innerHTML = anCard('机器人', s.robots || 0, '#378ADD')
    + anCard('运行中', s.running || 0, '#EF9F27')
    + anCard('排队中', s.queued || 0, '#7F77DD')
    + anCard('空闲', s.idle || 0, '#888780')
    + anCard('在途任务', s.tasks || 0, '#1D9E75');
}
function bsEmpty(msg) {
  var tbl = document.getElementById('bsTbl');
  if (tbl) tbl.innerHTML = '<tbody><tr><td colspan="' + BS_COLS + '" class="bs-empty">'
    + esc(msg) + '</td></tr></tbody>';
  var info = document.getElementById('bsInfo');
  if (info) info.textContent = '—';
  var m = document.getElementById('bsMetrics');
  if (m) m.innerHTML = '';
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
  /* 原本这句统计文字上移成标题栏指标卡（数一眼就能扫），这里只留数据时刻 */
  var info = document.getElementById('bsInfo');
  if (info) info.textContent = fmtFull(BS_DATA.now);
  bsMetrics(s);
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
function lsMetrics(d, groups, sc) {
  /* 日志检索：标题栏指标卡（命中量、覆盖面、扫描规模）；工具条只留扫描明细 */
  var m = document.getElementById('lsMetrics');
  if (!m) return;
  m.innerHTML = anCard('命中行', (d.hits || []).length, '#D85A30')
    + anCard('命中日志文件', groups.length, '#378ADD')
    + anCard('候选记录', d.candidates || 0, '#7F77DD')
    + anCard('扫描行数', (sc && sc.lines) || 0, '#888780');
}
function lsRender() {
  var box = document.getElementById('lsResult');
  var d = LS_DONE;
  if (!box || !d) return;
  if (!d.ok) {
    box.innerHTML = '<div class="ls-empty">' + esc(d.error || '检索失败') + '</div>';
    var em = document.getElementById('lsMetrics');
    if (em) em.innerHTML = '';
    var ei = document.getElementById('lsInfo');
    if (ei) ei.textContent = '—';
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
  lsMetrics(d, groups, sc);
  var info = document.getElementById('lsInfo');
  if (info) info.textContent = '扫描 ' + (sc.records || 0) + ' 条记录 / '
    + (sc.files || 0) + ' 个文件 · 最近 ' + d.days + ' 天';
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
function cpMetrics(s) {
  /* 触发器合规：标题栏指标卡（原先在页面内，现与其余视图统一放标题栏） */
  var m = document.getElementById('cpMetrics');
  if (!m) return;
  m.innerHTML = anCard('应跑次数', s.scheduled, '#378ADD')
    + anCard('按时', s.hit, '#1D9E75')
    + anCard('应用不符', s.mismatch || 0, '#D85A30')
    + anCard('漏跑', s.missed, '#E24B4A')
    + anCard('命中率', Math.round((s.rate || 0) * 100) + '%',
      (s.rate || 0) >= 0.95 ? '#1D9E75' : '#EF9F27');
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
  cpMetrics(s);
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

