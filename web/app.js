/* ==================== 公共工具 ==================== */
var STATUS_CN = {
  Waiting: "排队中", Executing: "运行中", Finished: "已完成",
  Failed: "失败", Stopped: "已停止", Delivered: "已派发"
};
var WAY_CN = { Manual: "手动", TimingTrigger: "定时触发器", Webhook: "Webhook" };
/* 「排队类」状态：都表示「还没真正开始跑，在等机器人」。
   Waiting   = 等待调度（还没派发到机器人）；
   Delivered = 已派发到机器人、但尚未开始执行。
   两者显示名不同（排队中 / 已派发），但**归类**相同：凡是按排队处理的地方
   （配色、时间轴画成等待段、跟随「显示排队」开关、机器人状态算 queued）
   统一用这个集合判断，避免各处各写一份 if 而漏掉某个状态。 */
var QUEUE_STATES = { Waiting: 1, Delivered: 1 };
function wayOf(r) { return WAY_CN[r.way] || r.way || "-"; }
function wayCN(w) { return WAY_CN[w] || w || "—"; }
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function pad(n) { return String(n).padStart(2, "0"); }
function fmtTime(ms) { if (ms == null) return "-"; var d = new Date(ms); return (d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
/* 只到「月-日」的短日期（时间轴窗口左右边界的日期角标、跨天时的刻度用）。
   月与日都补零（08-14）：等宽才好和刻度对齐，月份从 9 跳到 10 时也不会把
   右对齐的角标挤歪。 */
function fmtDateMD(ms) { if (ms == null) return "-"; var d = new Date(ms); return pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
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
/* 只到分钟的 hh:mm（详情页指标卡用）。
   同一天内的起止时刻放在并排的卡片里读，日期是多余的；
   跨天时补一个「月-日」前缀，避免 23:50 → 00:10 这种读反。 */
function fmtHM(ms) {
  if (ms == null) return "—";
  var d = new Date(ms);
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}
/* 英文简写时长：y/M/d/h/m/s 逐级拼（如 2m25s、1h3m、45s）。
   详情页指标卡宽度有限，中文的「2 分 25 秒」会被挤成两行；
   简写还能和「排队/运行」两个并排读数对齐。
   只在最高位与次高位之间取舍：不足 1 秒按秒显示（0s），不显示毫秒。 */
function fmtDurEn(ms) {
  if (ms == null || ms < 0 || isNaN(ms)) return "—";
  var s = Math.round(ms / 1000);
  var y = Math.floor(s / 31536000); s -= y * 31536000;
  var M = Math.floor(s / 2592000); s -= M * 2592000;
  var d = Math.floor(s / 86400); s -= d * 86400;
  var h = Math.floor(s / 3600); s -= h * 3600;
  var m = Math.floor(s / 60); s -= m * 60;
  var parts = [];
  if (y) parts.push(y + "y");
  if (M) parts.push(M + "M");
  if (d) parts.push(d + "d");
  if (h) parts.push(h + "h");
  if (m) parts.push(m + "m");
  if (s || !parts.length) parts.push(s + "s");
  /* 超过两级就截断（1y2M3d4h5m6s 太长，卡片里放不下，前两级已足够读） */
  return parts.slice(0, 2).join("");
}
function fmtSize(b) { if (b == null) return ""; if (b < 1024) return b + " B"; if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB"; return (b / 1024 / 1024).toFixed(2) + " MB"; }
function statusColor(r) {
  if (r.status === "Failed") return "rgba(226,75,74,0.6)";
  if (r.status === "Executing") return "rgba(239,159,39,0.6)";
  if (QUEUE_STATES[r.status]) return "rgba(55,138,221,0.6)";   // Waiting / Delivered = 排队蓝
  if (r.status === "Stopped") return "rgba(95,94,90,0.6)";
  if (r.status === "Finished") return "rgba(29,158,117,0.6)";
  /* 真正的未知状态默认当「运行中」画黄色，不要落成绿色的「已完成」——
     那会把没见过的状态伪装成成功。 */
  return "rgba(239,159,39,0.6)";
}
/* 状态色的实色版：时间轴数据块用 0.6 透明度（半透明便于看重叠），
   但手机端卡片里的「时长」是正文文字，0.6 在深色底上偏灰、读起来费劲 —— 文字用实色。 */
function statusColorSolid(r) {
  if (r.status === "Failed") return "#E24B4A";
  if (r.status === "Executing") return "#EF9F27";
  if (QUEUE_STATES[r.status]) return "#378ADD";   // Waiting / Delivered = 排队蓝
  if (r.status === "Stopped") return "#8b8f98";
  if (r.status === "Finished") return "#1D9E75";
  /* 未知状态兜底 = 运行中的橙黄色（与 statusColor 的口径一致） */
  return "#EF9F27";
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
  Delivered: [55, 138, 221],   // 与 Waiting 同为「排队中」配色
  Stopped: [120, 122, 128],
  Finished: [29, 158, 117]
};
function statusRGB(k, alpha) {
  /* 未知状态兜底用「运行中」的橙黄色（Executing 同色），
     不要落成「已完成」的绿色 —— 那会把失败/新状态伪装成成功。 */
  var c = STATUS_HUE[k] || STATUS_HUE.Executing;
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

/* 排队段的填充色由 tlRender 里的幽灵描边直接给（见 withAlpha 调用），
   原来的 WAIT_FILL 渐变已不再使用，故移除。 */

/* 饼图在小面板里的比例：标签只留百分比（名称+数值交给图例），引导线缩短，
   否则扇区外侧的标签会顶出容器被裁掉 */
var PIE_ITEM = { borderRadius: 6, borderColor: '#171b23', borderWidth: 2 };
var PIE_LABEL = { color: '#dfe5ee', fontSize: 11, formatter: '{d}%' };
var PIE_LINE = { length: 6, length2: 6, lineStyle: { color: 'rgba(255,255,255,.18)' } };

/* 悬停提示窗的统一皮肤：ECharts 默认是白底黑字，跟这套深色界面完全不搭。
   放在这里做单一出处，所有图表（时间轴/分析/排期）都从这里拼，避免漏一个又变回白底。 */
var TIP_SKIN = {
  confine: true, backgroundColor: '#1c2027', borderColor: '#333a45',
  borderWidth: 1, textStyle: { color: '#e6e6e6', fontSize: 12, fontFamily: null }
};
function tipOpt(extra) {
  var o = {}, k;
  for (k in TIP_SKIN) o[k] = TIP_SKIN[k];
  for (k in extra) o[k] = extra[k];
  /* 提示窗字体跟着图表统一字体走（见 chartTextStyle） */
  o.textStyle = o.textStyle || {};
  if (!o.textStyle.fontFamily) o.textStyle.fontFamily = chartFont();
  return o;
}
/* 图表内统一字体：ECharts 的轴标签/图例/提示窗默认走 sans-serif，
   不会继承 body 的 Maple Mono。这里集中一处，所有 setOption 都从它取。 */
function chartFont() {
  try {
    var f = getComputedStyle(document.body).fontFamily;
    return f || 'sans-serif';
  } catch (e) { return 'sans-serif'; }
}
/* 顶层 textStyle：一次设好全局字体，各系列不必逐个再写 fontFamily */
function chartTextStyle(extra) {
  var o = { fontFamily: chartFont() };
  for (var k in (extra || {})) o[k] = extra[k];
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
    /* Delivered 显示名单独叫「已派发」（已下发到机器人、还没开始跑），
       但归类与配色仍算「排队类」（QUEUE_STATES），跟随「显示排队」开关 */
    Delivered: ["已派发", "rgba(55,138,221,0.18)", "#378ADD"],
    Stopped: ["已停止", "rgba(95,94,90,0.18)", "#8b8f98"]
  };
  /* 真正的未知状态徽章默认显示「运行中」+ 橙黄色，与时间轴/颜色兜底口径一致 */
  var m = map[st] || (st === "Finished"
    ? ["已完成", "rgba(29,158,117,0.18)", "#1D9E75"]
    : ["运行中", "rgba(239,159,39,0.18)", "#EF9F27"]);
  return '<span class="badge" style="background:' + m[1] + ';color:' + m[2] + '">' + m[0] + '</span>';
}
function getParam(name) {
  var m = new RegExp("[?&]" + name + "=([^&]*)").exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
}

/* ==================== 全局状态 ==================== */
var RECORDS = [];          // /api/runs 返回的运行记录（时间轴 + 分析 + 机器人状态共用）
var DETAIL_REC = null;     // 当前详情记录
var SCHED = null;          // /api/schedule 数据
var curView = '';          // 当前视图：timeline/analysis/detail/schedule/projects/botstatus
/* 增量游标：服务端返回的快照时间戳，下次请求原样回传，后端只回「比它新」的行。
   用服务端时间戳而不是本机时钟，避免浏览器与服务器时钟差导致漏拉或重复拉。 */
var CURSOR = 0;
var LOAD_DAYS = 7;         // 本地已加载的记录范围（天）；切到更长档位时补拉
var sseSource = null;      // SSE 连接
var sseWatchdog = null;    // 看门狗定时器
var lastSseMsgAt = 0;      // 最后一次收到 SSE 消息（change 或 ping）的时刻

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
/* 首次加载 / 放宽范围：按天数整段拉取（替换式） */
function loadRuns(days) {
  var d = days || LOAD_DAYS;
  return api('/api/runs?days=' + d).then(function (res) {
    if (res && Array.isArray(res.records)) {
      RECORDS = res.records;
      LOAD_DAYS = d;
    }
    if (res && typeof res.cursor === 'number') CURSOR = res.cursor;
    if (res && res.time) document.getElementById('dataTime').textContent = res.time;
    return RECORDS;
  });
}
/* 增量拉取：带上游标，后端只回「最后修改时间 > 游标」的行，按 id 合并进本地。
   被广播唤醒时调用（几行数据，不是整段）。 */
function pullIncremental() {
  var cur = CURSOR;
  return api('/api/runs?cursor=' + cur).then(function (res) {
    if (!(res && res.ok && Array.isArray(res.records))) return false;
    if (typeof res.cursor === 'number') CURSOR = res.cursor;
    if (!res.records.length) return false;      // 没有新变化
    var seen = {};
    for (var i = 0; i < res.records.length; i++) seen[res.records[i].id] = true;
    // 同 id 的新行替换旧行：先滤掉旧的，再并入新的
    var merged = RECORDS.filter(function (r) { return !seen[r.id]; });
    merged = merged.concat(res.records);
    merged.sort(function (a, b) { return (b.start || '') < (a.start || '') ? -1 : 1; });
    RECORDS = merged;
    if (res.time) document.getElementById('dataTime').textContent = res.time;
    return true;
  }).catch(function () { return false; });
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
var VIEW_NAMES = ['timeline', 'analysis', 'detail', 'schedule', 'projects', 'botstatus'];
var NAV_NAMES = ['timeline', 'analysis', 'schedule', 'projects', 'botstatus'];
/* 标题栏指标卡：视图 -> 容器 id。每个视图一组，切视图时只显示对应那组。
   详情页那六张（状态/触发方式/开始时间/排队时长/运行时长/结束时间）也在这里，
   与其他视图统一放顶栏，而不是塞在详情卡片里。 */
var HEAD_METRIC_BOXES = [
  ['timeline', 'tlMetrics'], ['analysis', 'anMetrics'], ['schedule', 'scMetrics'],
  ['projects', 'pjMetrics'], ['botstatus', 'bsMetrics'],
  ['detail', 'dtMetrics']
];

function showView(name) {
  curView = name;
  for (var i = 0; i < VIEW_NAMES.length; i++) {
    var el = document.getElementById('view-' + VIEW_NAMES[i]);
    if (el) el.style.display = (VIEW_NAMES[i] === name) ? 'flex' : 'none';
  }
  // 离开详情页时释放 Monaco 日志编辑器（模型与实例随详情重建，避免常驻占内存）
  if (name !== 'detail' && typeof lgReset === 'function') lgReset();
  /* 顶栏视图名按钮：导航页显示自己的名字；详情页不是导航项（不在 NAV_NAMES 里），
     不处理的话会一直留着上一个导航页的名字（进详情页后还写着「任务时间轴」）。
     这里给详情页一个固定标题。 */
  if (name === 'detail') {
    var dbtn = document.getElementById('navMenuBtn');
    if (dbtn) dbtn.textContent = '运行记录详情';
  } else if (NAV_NAMES.indexOf(name) >= 0) navSet(name);
  // 标题栏指标卡按视图切换：每个视图一组，都放在标题栏的 #headMetrics 里
  for (var vi = 0; vi < HEAD_METRIC_BOXES.length; vi++) {
    var box = document.getElementById(HEAD_METRIC_BOXES[vi][1]);
    if (box) box.style.display = (name === HEAD_METRIC_BOXES[vi][0]) ? 'flex' : 'none';
  }
}
function navSet(name) {
  /* 同步悬停菜单：标题按钮文本 + 当前项高亮 */
  var hash = '#/' + name;
  var btn = document.getElementById('navMenuBtn');
  var items = document.querySelectorAll('.navmenu-list li');
  var label = null;
  for (var i = 0; i < items.length; i++) {
    if (items[i].getAttribute('data-hash') === hash) {
      /* 取 <span> 里的文字而不是 li.textContent：导航项现在带 SVG 图标，
         textContent 会把图标里的空白也算进去，标题按钮会被撑出多余空隙 */
      var sp = items[i].querySelector('span');
      label = sp ? sp.textContent : items[i].textContent;
      items[i].classList.add('cur');
      /* 手机端导航是一行横向滚动的 tab：切页后把当前项滚进视野。
         否则切到靠右的「项目控制台」时，高亮还在屏幕外，看不出当前在哪。
         用 scrollIntoView({inline:'nearest'}) 而不是手动算偏移：
         它只滚动这一个容器（block:'nearest' 不会连带把页面纵向滚走）。 */
      if (IS_MOBILE && items[i].scrollIntoView) {
        try { items[i].scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { }
      }
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
/* 路由：各视图的进入动作。
   数据新鲜度由三件事保证（不再有 per-view 对账逻辑）：
     1) 启动时拉一次 7 天记录；
     2) SSE 收到 change 就增量拉取（onDataChanged 统一处理，无论当前在哪个视图）；
     3) 打开排期页时拉一次排期（排期不随广播自动刷新，用页内「立刻更新」手动抓）。
   所以这里只管「首次进入要初始化什么」，不需要判断欠账。 */
function route() {
  var prevView = curView;   // 记录来源视图（showView 会覆盖 curView）
  var name = parseHash();
  showView(name);
  if (name === 'timeline') {
    if (!tlReady) {
      ensureRecords().then(function () { tlInit(); tlReady = true; });
    } else {
      if (IS_MOBILE) { tlFeedObserve(); tlFeedTick(); }
      else tlResize();
      if (prevView === 'detail') renderRecordsView();   // 从详情页返回：期间可能已增量更新过，重画一次
    }
  } else if (name === 'analysis') {
    if (!anReady) {
      ensureRecords().then(function () { anInit(); anReady = true; });
    } else {
      anResize();
      if (prevView === 'detail') renderRecordsView();
    }
  } else if (name === 'detail') {
    var id = getParam('id');
    /* 深链：从历史链接带 ?kw= 与 ?file= 进来时，日志加载完成后自动定位关键词 */
    var kw = getParam('kw'), fl = getParam('file');
    LG_LINK = (kw || fl) ? { kw: kw || null, file: fl || null } : null;
    if (id) {
      loadRunDetail(id).then(function () { renderDetail(); });
    } else {
      DETAIL_REC = null; renderDetail();
    }
  } else if (name === 'schedule') {
    /* 排期：每次进入都拉一次最新（数据在库里，读很快；排期不随广播自动刷新） */
    if (!scReady) {
      loadSchedule().then(function () { scInit(); scReady = true; });
    } else {
      scResize();
      loadSchedule().then(function () { scReload(); });
    }
  } else if (name === 'projects') {
    pjPendingFid = getParam('fid');   // 带 ?fid= 进入时选中对应项目（无则 null）
    /* 带 ?tab=runs 进入（排期页点应用标签跳过来）：选中项目后直接打开「运行记录」tab */
    pjPendingTab = getParam('tab');
    if (!pjReady) { pjInit(); pjReady = true; }
    else { pjLoad(); }
  } else if (name === 'botstatus') {
    if (!bsReady) { bsBind(); bsReady = true; }
    /* 必须先 bsLoad() 把 RECORDS 算成 BS_DATA 再 bsRender：只 await 记录、
       不调用 bsLoad 的话 BS_DATA 仍是 null，首屏会误报「加载失败」
       （点刷新能好，是因为刷新那条路径调了 bsLoad）。 */
    ensureRecords().then(function () { return bsLoad(); }).then(bsRender);
  }
}
/* 确保本地有记录（首次进入任意依赖记录的视图时用） */
function ensureRecords() {
  if (RECORDS.length) return Promise.resolve(RECORDS);
  return loadRuns(LOAD_DAYS);
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
var DEF_SPAN = 1 * 3600 * 1000;   // 桌面默认时间窗口
if (window.innerWidth < window.innerHeight) {
  DEF_SPAN = 6 * 3600 * 1000;   // 窄高窗口（宽<高）默认拉长时间窗：横向内容更舒展，靠拖动平移浏览
}
var records = [];           // 时间轴工作副本（来自 RECORDS）
var robots = [];
var state = { span: DEF_SPAN, end: Date.now(), offset: 0, focusId: null, total: 24 * 3600 * 1000 };
var DATA_MIN = Infinity, DATA_MAX = -Infinity;
var tlChart = null, chartEl = null;
var tlLastData = null;      // 最近一次渲染的数据项：custom series 取不到附加字段时按 dataIndex 回查
var tlPan = null;           // 图表拖动平移的拖拽状态（null = 没在拖）
var tlPanMoved = false;     // 本次拖拽是否真的移动过：拖完那一下不该被当成点击
var tlScrollTrackEl = null, tlScrollWinEl = null;   // 底部滚动条（只反映窗口，不负责缩放）

/* 时间轴的绘图区边距（tlRender 的 grid 与 1:1 拖动换算共用一处，避免两边对不上）。
   甘特图只在桌面端渲染（手机端整块砍掉，只留记录流），所以这里只有一套桌面值。
   top 比原来多留了一截：横轴（时间）刻度移到上方（见 tlRender 的 position:'top'），
   11px 的刻度文字加上默认间距要占掉 20 多 px，不给够空间会被画布裁掉；
   bottom 相应收小 —— 刻度搬上去之后，下面只剩泳道内容，不需要再给刻度留位。 */
var TL_GRID = { left: 100, right: 20, top: 34, bottom: 18 };
function tlGrid() { return TL_GRID; }
/* 时间轴的网格线颜色：**泳道分隔线（横、实线）与时间刻度竖线（纵、虚线）共用一色**，
   横竖两个方向才是同一张网。原来竖线是 #20242c，在深底上几乎看不出刻度落在哪，
   调成和泳道分隔线一致的 rgba(255,255,255,0.15) 提亮一档。
   方向靠「实 / 虚」区分：横向的分组边界是实体结构（实线），
   纵向的时间刻度是背景参考（虚线）。 */
var TL_GRID_COLOR = 'rgba(255,255,255,0.15)';
/* 横轴（时间）刻度的文字：平时只给 HH:mm —— 日期交给左右两端的日期角标（见 tlRender 的 dateData 系列）；
   走到午夜那一格时把 00:00 换成「MM-dd」——跨天的窗口里刻度全是 HH:mm 会分不清落在哪天，
   而午夜正是天与天的分界，拿它当日期锚点最自然（用户口径：跨天就把那天的 00:00 换成日期）。 */
function tlTickLabel(t) {
  var d = new Date(t);
  if (d.getHours() === 0 && d.getMinutes() === 0) return fmtDateMD(t);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
/* 横轴刻度文字与轴线的间距（px）。抽成常量是因为两端的日期角标要和刻度文字**同一行**
   且底边对齐（用户要求：同一行、不许字体重叠）—— 角标的基线必须按同一个值反推，
   写死两处数字迟早会错开。 */
var TL_TICK_LABEL_MARGIN = 8;
/* 左右两端日期角标与时间刻度文字共用的纵向锚点：**文字底边**。
   刻度文字由 ECharts 摆在上方轴线上方 margin 处（verticalAlign 为 bottom），
   角标要跟它同一行且不叠字，就必须把底边钉在同一个 y 上。 */
function tlTopLabelBottomY() { return tlGrid().top - TL_TICK_LABEL_MARGIN; }
/* 当前窗口左右日期角标各占的横向宽度（px，含与刻度之间的间隙）。
   由 tlRender 每次渲染时写入，供 xAxis.axisLabel.formatter 判定
   「这个刻度的文字会不会压到角标上」——
   formatter 是 ECharts 回调，拿不到 tlRender 的局部变量，只能走这个模块级中转。
   初值给个够大的数：tlRender 之前（理论上不会发生）宁可多挡一个刻度，也不要叠字。 */
var tlDateBox = { l: 46, r: 46 };
/* 日期角标与「保留带」外缘之间的间隙（px）：确保紧挨着的刻度文字不贴着日期。 */
var TL_DATE_GAP_PX = 7;
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
/* 时刻 -> 图表容器的像素横坐标（含 grid 左留白）。
   用于「刻度文字会不会撞上两端日期角标」的判定（见 xAxis.axisLabel.formatter）——
   容器的坐标系与 tlTimeLenPx 同一套（clientWidth，不含 theme.js 的 CSS 缩放），
   两边换算必须同源，否则判定会整体偏掉。
   图表还没建好（chartEl 为空）时返回 null，调用方按「不判定」处理。 */
function tlTimeX(t) {
  if (!chartEl) return null;
  var g = tlGrid();
  var plotW = (chartEl.clientWidth || 0) - g.left - g.right;
  if (!(plotW > 0) || !(state.span > 0)) return null;
  var nowW = Math.min(state.end + state.offset, state.end);
  return g.left + (t - (nowW - state.span)) / state.span * plotW;
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
  /* 总长裁剪：只保留「总长」下拉选定的最近一段数据（默认 1 天），
     更早的记录不进甘特图/滚动条范围（记录列表不受影响，仍看全量） */
  if (isFinite(DATA_MAX) && isFinite(DATA_MIN)) {
    var cutoff = DATA_MAX - (state.total || Infinity);
    if (DATA_MIN < cutoff) DATA_MIN = cutoff;
  }
}
function robotList(segs) {
  var arr = [];
  segs.forEach(function (s) {
    var rb = s.r.robot;
    if (rb && rb !== "(未指定机器人)" && arr.indexOf(rb) < 0) arr.push(rb);
  });
  /* 两端都是横向布局（时间在横轴），机器人是纵向的泳道组，行序与时间流向无关，
     统一按名称排序 —— 行序稳定，不随窗口平移抖动，肌肉记忆才好用。

     排序键 = robotSortKey()：机器人名形如「A🍩硕晞-01 / B💎宝实-02」，
     A/B 是分组字母、中间是 emoji。默认 sort() 按码点比大小：先是分组字母，
     再比 emoji（A 组全部排在 B 组前），最后才轮到中文名 —— 也就是「组内顺序」看运气，
     而且只要 emoji 不同，中文名根本不参与比较。改成显式的三段键：
       ① 分组字母（A 组在前、B 组在后）
       ② 去掉前缀后的中文名（按中文读音排，localeCompare 而非码点）
       ③ 编号数字（同名的 -01 / -02 / -03，按大小而不是字符串）
     这样行序在任何数据下都可预期，同组内就是「宝实-00 → 硕晞-01」这种读音序。 */
  return arr.sort(function (a, b) {
    var ka = robotSortKey(a), kb = robotSortKey(b);
    if (ka.g !== kb.g) return ka.g < kb.g ? -1 : 1;
    if (ka.name !== kb.name) return ka.name.localeCompare(kb.name, 'zh-Hans-CN');
    return ka.no - kb.no;
  });
}
/* 机器人名拆成排序键（见 robotList 的说明）：
   g=分组字母（A/B，非字母开头视为 ''）、name=去前缀中文名、no=末尾编号（没有则为 -1）。 */
function robotSortKey(n) {
  var s = String(n == null ? '' : n);
  var m = /^([A-Za-z])\s*/.exec(s);
  var g = m ? m[1] : '';
  var rest = s.slice(m ? m[0].length : 0).replace(/[^\u4e00-\u9fa5A-Za-z0-9-]/g, '');
  var nm = /^(.*?)[-_]?(\d+)$/.exec(rest);
  return {
    g: g,
    name: nm ? nm[1] : rest,
    no: nm ? parseInt(nm[2], 10) : -1
  };
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
    /* 排队类状态（Waiting / Delivered）整体按「排队等位」处理：画成一个 wait 段
       （蓝色），因而跟随「显示排队」开关 —— 关掉时整条都不显示。
       这里有意不做「有 execStart 就画 run 段」的例外：口径要单一，
       否则关掉排队时这类记录会以运行段的身份留在图上，与「视为排队中」不符。 */
    if (QUEUE_STATES[r.status]) {
      segs.push({ r: r, start: st, end: r.end, kind: 'wait' });
      return;
    }
    var exec = (r.execStart && r.execStart > st) ? r.execStart : null;
    if (exec && exec - st >= 60 * 1000) segs.push({ r: r, start: st, end: exec, kind: 'wait' });
    segs.push({ r: r, start: exec || st, end: r.end, kind: 'run' });
  });
  return segs;
}
/* 把任意合法颜色改成指定透明度（甘特块幽灵底用；解析失败就原样返回） */
function withAlpha(c, a) {
  var p = parseColor(c);
  if (!p) return c;
  return 'rgba(' + p.r + ',' + p.g + ',' + p.b + ',' + a + ')';
}
/* 甘特块 = 幽灵任务条：极淡的同色底 + 实色描边。
   原来是 0.6 半透明实心块，在深底上偏灰、相邻块容易糊成一片；
   描边款边界清楚，也更接近常见甘特图的「任务条」观感。 */
function ghostBar(color, dimA) {
  var solid = withAlpha(color, 1);
  return {
    fill: withAlpha(solid, .16),
    stroke: solid,
    lineWidth: 1.5,
    opacity: dimA
  };
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
/* 甘特图数据块内文字字号（独立于 .title，改这里即可） */
var BAR_FS = 15;
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
/* 单行文字：放得下整串显示；放不下则截断并在末尾加省略后缀。
   默认后缀 "..."，调用方可传 ell 换（甘特任务条用 "~"）。
   只要还剩得下一个字 + 后缀，就至少给一个字 —— 以前 maxW 偏小时
   直接返回空串，块里就一个字都没有了。 */
function truncateLabel(name, maxW, fs, ell) {
  if (!name) return '';
  ell = (ell == null) ? '...' : ell;
  var ellW = measureW(ell, fs);
  if (maxW < ellW + 4) return '';          // 连「一个字 + 后缀」都放不下，才放弃
  if (measureW(name, fs) <= maxW) return name;
  var budget = maxW - ellW;
  if (budget <= 0) return '';
  var cur = '', curW = 0;
  for (var i = 0; i < name.length; i++) {
    var cw = measureW(name[i], fs);
    if (curW + cw > budget) break;
    cur += name[i]; curW += cw;
  }
  if (!cur) return '';                     // 一个字都塞不下
  return cur + ell;
}
function effEnd(s) { return s.end == null ? state.end : s.end; }
/* 泳道分配：同一机器人时间重叠的记录分到不同泳道（横着叠开，互不遮挡）。
   按记录「实际占用的时间段」判定（不是 start~end 大区间）：
   - 显示排队时占用段 = [排队起, 终态]（wait+run 连续占用）；
   - 关闭排队时占用段 = [执行起, 终态]（排队不算占用）。
   这样「A 在执行、B 在排队等 A」的交叉段不算重叠（B 的执行起点在 A 结束
   之后，物理上就是串行衔接），不再凭空多出一条泳道——RPA 单机不并行，
   排队只是等位，视觉上应接在同一条泳道上首尾相接。 */
function layout(segs) {
  var recs = [];
  var recOfSeg = {};
  var byRobot = {};
  segs.forEach(function (s, i) {
    var rid = String(s.r.id);
    if (!(rid in recOfSeg)) {
      recOfSeg[rid] = recs.length;
      var u = { rid: rid, robot: s.r.robot, spans: [], segIdxs: [] };
      recs.push(u);
      (byRobot[s.r.robot] = byRobot[s.r.robot] || []).push(recs.length - 1);
    }
    var u = recs[recOfSeg[rid]];
    u.segIdxs.push(i);
    /* 每个段的实际占用区间：wait 段=start~exec，run 段=exec(或 start)~end */
    u.spans.push([s.start, effEnd(s)]);
  });
  var info = {};
  var yLabels = [];
  var groupLastRows = [];
  var rowCursor = 0;
  robots.forEach(function (rb) {
    /* 排序键改用首段起点（u.start 字段已随 spans 重构移除） */
    var idxs = (byRobot[rb] || []).slice().sort(function (a, b) {
      return recs[a].spans[0][0] - recs[b].spans[0][0];
    });
    var lanes = [];
    var laneOfRec = {};
    /* 泳道分配按「真实时间重叠」算，不按拉伸后的视觉厚度算。
       试过按视觉厚度（max(真实时长, minVisibleMs)）分配：极短记录被撑到 4px 后，
       在 7 天/30 天这种大窗口下 4px 相当于好几个小时，于是同一台机器人的记录几乎
       条条互斥，泳道数从 11 条暴涨到 37/93 条 —— 每条泳道只剩几像素高，反而全糊了。
       真实重叠的判定与窗口大小无关，泳道数始终稳定；短记录怎么画得看得见，
       交给绘制阶段的 stretch（见下），两件事分开管。 */
    idxs.forEach(function (ri) {
      var u = recs[ri], lane = -1;
      /* 与泳道逐段比对：所有占用段都不与该泳道已有占用相交才可入住。
         注意 lanes[l] 是「该泳道已占用区间」的**数组**（每段是 [start, end]），
         不是 {start, end} 单个区间 —— 这里曾写成 lanes[l].start / lanes[l].end，
         数组上取到的是 undefined，两个比较恒为 false，于是永远判定「不冲突」，
         同一台机器人的记录条条都落在第 0 条泳道（表现：开着「显示排队」，
         重叠任务也不再避让，一台机器人永远只有一条泳道）。
         必须逐段与泳道内已占用的每一段两两比。 */
      for (var l = 0; l < lanes.length && lane < 0; l++) {
        var occ = lanes[l];
        var clash = false;
        for (var k = 0; k < u.spans.length && !clash; k++) {
          var st = u.spans[k][0], en = u.spans[k][1];
          for (var q = 0; q < occ.length; q++) {
            /* 半开区间判交：[st,en) 与 [occ.start,occ.end) 有交集才算冲突。
               A 结束 == B 开始（首尾相接的排队等位）不算冲突，仍住同一条泳道。 */
            if (st < occ[q][1] && en > occ[q][0]) { clash = true; break; }
          }
        }
        if (!clash) lane = l;
      }
      if (lane < 0) { lane = lanes.length; lanes.push([]); }
      u.spans.forEach(function (sp) { lanes[lane].push(sp); });
      laneOfRec[ri] = lane;
    });
    if (lanes.length === 0) lanes.push([]);
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
/* 纵轴是否翻转显示。ECharts 的 category 轴默认把 data[0] 放在轴的起点，
   而 y 轴起点在下方 —— 不翻的话 robotList() 排好的顺序在屏幕上整个倒过来。
   抽成常量是因为「泳道分隔线画在分组末行的哪条边」取决于它（见 tlRender 的 sepData），
   两处必须同步翻，否则分隔线会整整错开一行。 */
var Y_INVERSE = true;

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
  /* 总长裁剪：总长之外的旧记录不进泳道布局，也不出现在图里（列表仍显示全量） */
  var totalStart = state.end - state.total;
  segs = segs.filter(function (s) { return effEnd(s) >= totalStart; });
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
         门槛用 minVisibleMs：屏幕上太窄的块连字都排不下，画上去只是糊。
         value(5) 带上 rid：文字是独立的 series（zlevel 2，压在块之上），
         必须自己知道归属才能跟着悬浮联动淡出 —— 否则悬浮某一行时，
         其余块的文字还清清楚楚地浮在半透明的块上（见下方 renderItem 的 dimT）。 */
      textData.push({
        value: [0, li.row, s.r.name, merge.min, merge.max, rid]
      });
    }
  });
  /* 分组之间的分隔虚线。
     lastRows 是每个分组「最后一行」的数组下标；分隔线要画在分组的**外边界**上，
     而「最后一行」的哪条边是外边界取决于纵轴有没有翻转（Y_INVERSE）：
       - 不翻转：数组下标向上增长（row 越大越靠上），末行是该组最上面一行，
                 外边界 = 该行的上边缘；
       - 翻转后：下标向下增长（row 越大越靠下），末行变成该组最下面一行，
                 外边界 = 该行的下边缘。
     取边在 renderItem 里按 Y_INVERSE 算（见那里的说明：不能用 api.coord(row±0.5)）。 */
  var sepData = [];
  lastRows.forEach(function (r) { if (r !== topGroupRow) sepData.push({ value: [r] }); });
  /* 窗口左右两端的日期角标：刻度只读 HH:mm，「这是哪天」交给这两个角标。
     放在绘图区左上 / 右上（与时间刻度同一行——都用 TL_GRID.top - TL_TICK_LABEL_MARGIN
     作为文字底边，两边的基线因此天然对齐）。
     两端都照常画：窗口只有 1 小时（同一天）时左右日期相同也照画，
     位置固定、读的时候不用找（曾考虑「相同就只画一个」，但那样左右哪边显示
     得额外定规则，角标会随窗口跳动）。 */
  var dateL = fmtDateMD(winStart), dateR = fmtDateMD(nowW);
  /* 左右日期角标各自占用的横向宽度（不取 max 对称：月底跨月时左右日期宽度可能不同，
     比如 09-30 与 10-01 —— 取 max 只是让两边看着一样宽，却会白白吃掉一个刻度）。
     文字宽 + 一点间隙。写进模块级的 tlDateBox，给 xAxis.axisLabel.formatter 用
     （它拿不到 tlRender 的局部变量）。 */
  tlDateBox.l = measureW(dateL, 11) + TL_DATE_GAP_PX;
  tlDateBox.r = measureW(dateR, 11) + TL_DATE_GAP_PX;
  var dateData = [
    { value: [winStart, 0, dateL, 'left'] },
    { value: [nowW, 0, dateR, 'right'] }
  ];
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
  /* clip = {l:bool, r:bool}：这一端的真实起止落在时间窗口之外（被视野截断）。
     截断端**不画竖边** —— 那条直上直下的实线看起来像「任务正好在这里开始/结束」，
     而实际只是被窗口切掉了。留个缺口，一眼就能看出「这边还有内容，拖过去看」。
     所以截断时边框不能用 rect 的描边（四边一起画、没法只去掉一边），
     改为用 polyline 画一条「开口的折线」，按 clip 决定两端要不要收口。

     注意这里必须用 polyline，不能用 type:'path'：
     echarts 的 custom series 不渲染 path 图元（它会被塞进显示列表，
     但画布上什么都不画）—— 曾因此出现「被截断的块整个没有边框」。
     实测 polyline / 多条 line / rect 都能正常渲染，polyline 一次成型最省。

     没被截断的块（绝大多数）仍走原来那个单 rect —— 1700 条记录下，
     每块少建一个图形对象，性能与改版前一致。 */
  function barOf(p0, p1, thick, style, clip) {
    var a0 = Math.min(p0[0], p1[0]);
    var a1 = Math.max(p0[0], p1[0]);
    var len = a1 - a0;
    var c = p0[1];                             // 泳道中心
    var y0 = c - thick / 2, y1 = c + thick / 2;
    var clipL = !!(clip && clip.l), clipR = !!(clip && clip.r);
    if (!clipL && !clipR) {
      var r0 = Math.min(3, len / 2, thick / 2);
      return {
        type: 'rect',
        shape: { x: a0, y: y0, width: len, height: thick, r: r0 },
        style: style
      };
    }
    /* 底色：rect 只管填充、不描边；被截断的一端不做圆角（方口才像被切断） */
    var r = Math.min(3, len / 2, thick / 2);
    var rl = clipL ? 0 : r, rr = clipR ? 0 : r;
    var fill = {
      type: 'rect',
      shape: { x: a0, y: y0, width: len, height: thick, r: [rl, rr, rr, rl] },
      style: { fill: style.fill, opacity: style.opacity }
    };

    /* 边框：一条沿四边走一圈的开口折线（起点/终点都落在「开口」那一侧，
       中间不闭合，所以不会自动补出那条被截断的竖边）。
       圆角用折线的圆角处理：这里直接用直角端点 —— 被截断的块本来就贴边，
       再画圆角反而与窗口边界错开 1~2px，看起来像没对齐。 */
    var pts = [];
    if (clipL) {
      /* 左边被截断：从左上角起笔，绕右边一圈回到左下角，左边留空 */
      pts = [[a0, y0], [a1 - rr, y0], [a1, y0 + rr], [a1, y1 - rr],
             [a1 - rr, y1], [a0, y1]];
    } else {
      /* 右边被截断：从右上角起笔，绕左边一圈回到右下角，右边留空 */
      pts = [[a1, y0], [a0 + rl, y0], [a0, y0 + rl], [a0, y1 - rl],
             [a0 + rl, y1], [a1, y1]];
    }
    var border = {
      type: 'polyline',
      shape: { points: pts, smooth: 0 },
      style: {
        fill: 'none', stroke: style.stroke,
        lineWidth: style.lineWidth, opacity: style.opacity,
        lineJoin: 'round'
      }
    };
    return { type: 'group', children: [fill, border] };
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
  /* 截断判定：真实起止落在时间窗口之外 = 这一端被视野切掉了。
     trueStart/trueEnd 用**未裁剪**的真实值（不能拿裁剪后的 r0/r1 比，
     那样永远相等、判不出截断）。
     窗口边界必须由调用方传进来：winA 是 renderItem 里的局部变量
     （= nowW - state.span），这个函数在 tlRender 作用域里取不到它 ——
     曾因此在运行时报 winA is not defined，整个 custom series 画不出来。 */
  function clipOf(trueStart, trueEnd, winA) {
    return { l: trueStart < winA, r: trueEnd > nowW };
  }
  /* 把撑过的条收进绘图区：被截断的那一端精确落在窗口边界上。
     stretch 是以中点为基准向外扩的，若不管它，被截断的短条会往视野外溢出几个像素，
     看起来像「有个东西露在框外」。收进来之后，缺边正好落在边界，语义才干净。 */
  function fitWindow(pair, clip, winX0, winX1) {
    var x0 = Math.min(pair[0][0], pair[1][0]);
    var x1 = Math.max(pair[0][0], pair[1][0]);
    var y = pair[0][1];
    if (clip.l) x0 = winX0;
    if (clip.r) x1 = winX1;
    /* 收进来之后仍要保证最小可见厚度（否则短条一贴边就细到看不见） */
    if (x1 - x0 < MIN_BAR_PX) {
      if (clip.l && !clip.r) x1 = Math.min(winX1, x0 + MIN_BAR_PX);
      else if (clip.r && !clip.l) x0 = Math.max(winX0, x1 - MIN_BAR_PX);
      else if (!clip.l && !clip.r) { var mid = (x0 + x1) / 2; x0 = mid - MIN_BAR_PX / 2; x1 = mid + MIN_BAR_PX / 2; }
    }
    return [[x0, y], [x1, y]];
  }

  tlChart.setOption({
    backgroundColor: 'transparent',
    animation: false,
    textStyle: chartTextStyle(),
    tooltip: tipOpt({
      trigger: 'item',
      formatter: function (p) {
        var d = p.data;
        var stName = STATUS_CN[d.status] || d.status || '运行中';
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
    /* 横轴 = 时间（刻度放上方：先看到时间、再看泳道，和「现在」红线的阅读顺序一致）
       刻度只给 HH:mm（跨天的午夜那格给日期）；窗口两端的日期由下面的
       dateData 系列画成角标（那是 custom series，不是 graphic 组件） */
    xAxis: {
      type: 'time', min: nowW - state.span, max: nowW,
      position: 'top',
      axisLabel: {
        color: '#8b8f98', fontSize: 11, hideOverlap: true,
        margin: TL_TICK_LABEL_MARGIN,
        formatter: function (v) {
          /* 落进左右「日期角标」地带的刻度不给文字：角标与刻度在轴线上方同一行，
             同时画就是叠字。判定用**刻度文字自身占的宽度**（以刻度为中心左右各半），
             只挡日期本身不够 —— 紧挨着的那个刻度会有半截压在角标上。 */
          var px = tlTimeX(v);
          if (px == null) return tlTickLabel(v);
          var half = measureW('00:00', 11) / 2;
          if (px - half < TL_GRID.left + tlDateBox.l) return '';
          var xr = tlTimeX(nowW);
          if (xr != null && px + half > xr - tlDateBox.r) return '';
          return tlTickLabel(v);
        }
      },
      /* 刻度文字朝上对齐轴线，别悬在图与轴线之间 */
      axisTick: { alignWithLabel: true },
      axisLine: { lineStyle: { color: '#333' } },
      /* 时间刻度竖线：与泳道分隔线同色（TL_GRID_COLOR），用**虚线**区分方向 ——
         纵向是背景参考，横向的泳道边界才是实体结构（见底色系列的实线）。
         密度不变（还是 ECharts 按 time 轴自动分的格）。 */
      splitLine: {
        show: true,
        lineStyle: { color: TL_GRID_COLOR, width: 1, type: [5, 5] }
      }
    },
    /* 纵轴 = 机器人泳道 */
    yAxis: {
      type: 'category', data: yLabels,
      /* inverse: ECharts 的 category 轴默认把 data[0] 放在轴的**起点**，
         而 y 轴起点在**下方** —— 于是 robotList() 排好的顺序（A🍩硕晞-01 在前）
         在屏幕上整个翻了过来（B💎宝实-03 跑到最上面）。
         加 inverse 让 data[0] 落在顶部，视觉顺序才与排序键一致。
         注意只翻转「显示顺序」，不改 data：泳道行号仍按数组下标走，
         下面所有 api.coord / renderItem 都不受影响。
         注意二：翻转后「分组末行」在视觉上变成该组最下面一行，
         分隔线的取边要跟着翻（见 sepData 的构造）。 */
      inverse: Y_INVERSE,
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
        /* 窗口边界的屏幕坐标：截断端的收口位置 */
        var winX0 = xy(api, winA, row)[0], winX1 = xy(api, nowW, row)[0];
        if (hasWait && showQueue) {
          var q0 = Math.max(api.value(0), winA), q1 = Math.min(exec, nowW);
          if (q1 > q0) {
            /* 排队段不撑最小厚度：它只是运行块前面的一小截蓝头，
               当前缩放级别看不见就说明「排队时间短到无关紧要」，不必硬挤出来。
               （运行块本身必须可见 —— 那代表「这条记录跑过」，语义不同）
               排队段也走幽灵描边，但底色更实一点，好和运行段区分。 */
            var pq0 = xy(api, q0, row), pq1 = xy(api, q1, row);
            if (lenOf(pq0, pq1) >= 1) {
              children.push(barOf(pq0, pq1, bh, {
                fill: withAlpha('rgba(55,138,221,1)', .26),
                stroke: withAlpha('rgba(55,138,221,1)', .95),
                lineWidth: 1, opacity: dimA
              }, clipOf(api.value(0), exec, winA)));
            }
          }
        }
        var rs = hasWait ? exec : api.value(0);
        var r0 = Math.max(rs, winA), r1 = Math.min(api.value(1), nowW);
        if (r1 > r0) {
          /* 运行段的两端截断判定：左端看真实起点 rs 是否早于窗口，
             右端看真实结束（value(1)，进行中为 0 → 不截断）是否晚于「现在」 */
          var cRun = clipOf(rs, api.value(1), winA);
          var st2 = fitWindow(stretch(xy(api, r0, row), xy(api, r1, row)), cRun, winX0, winX1);
          /* 用 value(5)（数据构造时由 segColor 算好的状态色）派生：
             不要在 renderItem 里读 params.data.status —— custom series
             不保证保留附加字段，取不到就会全部落到兜底色（全变绿）。
             幽灵任务条：极淡同色底 + 实色描边，边界清楚、不糊成一片。 */
          children.push(barOf(st2[0], st2[1], bh, ghostBar(api.value(5), dimA), cRun));
        }
        var pv0 = xy(api, vs, row), pv1 = xy(api, ve, row);
        /* 悬浮高亮框沿用整条记录（含排队）的真实跨度判截断，
           免得金框在窗口边上画出一条「假边界」 */
        var cHot = clipOf(api.value(0), api.value(1), winA);
        var stv = fitWindow(stretch(pv0, pv1), cHot, winX0, winX1);
        if (lenOf(stv[0], stv[1]) >= 1) {
          /* 悬浮中的那条：金色加粗描边 + 外扩 2px，视觉上「鼓」出来。
             任务条本身已经是描边款，这里就不再叠一层白色内描边，
             避免窄块被两层描边吃掉（浅色底会把 1.5px 的边糊掉）。 */
          if (isHot) {
            var e0 = stv[0], e1 = stv[1];
            /* 外扩只在没被截断的那一端做：被截断端本来就该贴住窗口边界，
               再往外扩就露出绘图区了。 */
            var x0 = cHot.l ? e0[0] : e0[0] - 2;
            var x1 = cHot.r ? e1[0] : e1[0] + 2;
            children.push(barOf([x0, e0[1]], [x1, e1[1]], bh + 6, {
              fill: 'rgba(255,209,102,0.14)',
              stroke: '#ffd166', lineWidth: 2
            }, cHot));
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
        /* 显示文字去掉第一个 "_" 及之前的内容（无 "_" 则原样显示） */
        var us = raw.indexOf('_');
        if (us >= 0) raw = raw.slice(us + 1);
        var mStart = api.value(3);
        var mEnd = api.value(4) == null ? nowW : api.value(4);
        var vStart = Math.max(mStart, nowW - state.span);
        var vEnd = Math.min(mEnd, nowW);
        if (vEnd <= vStart) return null;
        var vc = (vStart + vEnd) / 2;
        var pc = xy(api, vc, row);
        var avail = lenOf(xy(api, vStart, row), xy(api, vEnd, row));

        /* 数据块文字：单行、居中、放不下截断。
           后缀用 "~"（比 "..." 省宽度，窄块里能多留一个字）；
           只要放得下「一个字 + ~」就显示，不再要求至少 8 个字 ——
           以前少于 8 字直接不画，短块等于完全没有标签。 */
        var label = truncateLabel(raw, Math.max(2, avail - 4), BAR_FS, '~');
        if (!label) return null;
        /* 悬浮联动：有悬浮行时，非对应块的文字跟着块一起淡出。
            文字压在块之上（zlevel 2），只把块调淡的话，这些字会变成
            「浮在一团灰影上的白字」，反而比不淡出时更显眼。
            按 value(5) 的 rid 判定归属：目标块文字保持原色，
            其余降到 18% 不透明度，与块的 dimA 同源、同步消退。 */
        var dimT = 1;
        if (hot) {
          var own = api.value(5) != null && String(api.value(5)) === String(hot);
          dimT = own ? 1 : 0.18;
        }
        return {
          type: 'text', style: {
            text: label, x: pc[0], y: pc[1], textAlign: 'center',
            /* 任务条改成幽灵款（淡底 + 描边）后，原来的深色字（#10141a）
               在深色底上几乎看不见，改为浅色字；再降一档明度 —— 亮白在密集图里太抢眼，会和状态描边抢注意力，文字只是标签，退到「读得清但不扎眼」的一档。 */
            textVerticalAlign: 'middle', fill: '#a8b4c4', fontSize: BAR_FS,
            fontWeight: 500, fontFamily: FONT_STACK, opacity: dimT
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
        /* 分隔线画在「分组末行朝外的那条边」上：
             不翻转时下标向上增长，末行是该组最上面一行，朝外的边 = 上边缘（center - band/2）；
             翻转后下标向下增长，末行变成该组最下面一行，朝外的边 = 下边缘（center + band/2）。
           注意：这里必须用 band/2 从行中心推算，**不能**写 api.coord(row ± 0.5) ——
           category 轴会把小数行号四舍五入到整数索引（实测 coord(row+0.5) 返回的是
           row+1 那一行的中心），取回来的是相邻行的中心而不是边界，只差半条泳道，
           看起来「像对上了又没对上」，比错一整条更难发现。 */
        var edge = c0[1] + (Y_INVERSE ? band / 2 : -band / 2);
        // 机器人分组之间的分隔线：横轴布局下画横向实线
        return {
          type: 'line', shape: { x1: lo, y1: edge, x2: hi, y2: edge },
          /* 与时间刻度竖线同色（TL_GRID_COLOR），但画**实线**：
             横向的分组边界是"结构"（谁属于哪台机器人），实线才立得住；
             纵向的时间刻度是背景参考，交给虚线。方向靠虚实区分，不靠深浅。
             颜色沿革：原来是最早的亮白虚线（0.65，抢眼到像数据本身），
             后来退到中性灰细虚线；现在与竖线统一到同一档透明度，
             横竖合成一张网格，任务条仍是画面主角。 */
          style: { stroke: TL_GRID_COLOR, lineWidth: 1, type: 'solid' }
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
    }, {
      /* 窗口左右两端的日期角标（zlevel 2 = 压在时间刻度那一行之上，静默不吃事件）。
         刻度只读 HH:mm，「这是哪天」由左右两端各一个日期承担：
         左端贴绘图区左边界、右端贴右边界，与刻度同一行、同一基线。
         必须 clip:false —— 这条文字画在绘图区**上方**（留给刻度的那一条带里），
         默认裁剪会把它整个裁掉（graphic 元素没这个问题，custom series 有）。 */
      type: 'custom', data: dateData, zlevel: 2, silent: true, clip: false,
      renderItem: function (params, api) {
        /* value = [时刻, 0(占位的泳道维度), 日期文本, 左/右]。
           字符串必须放在下标 ≥2：ECharts 把 custom series 的 v(0)/v(1) 当作
           坐标维度强制转成数字，字符串放下标 1 会被读成 NaN（实测：
           [t,"08-14","left"] 读 v(1) 得 NaN，整个角标画不出来）。
           工程里另外两个文字系列（应用名、悬浮气泡）同样是字符串而后置的。 */
        var txt = String(api.value(2) || '');
        if (!txt) return null;
        var side = String(api.value(3) || 'left');
        /* 横坐标走 ECharts 自己的换算（api.coord），与刻度文字用的是同一套变换，
           两端才对得齐；纵坐标用固定像素：与刻度文字底边同一条线。 */
        var x = api.coord([api.value(0), 0])[0];
        return {
          type: 'text',
          style: {
            text: txt, x: x, y: tlTopLabelBottomY(),
            /* 左端左对齐（往右长）、右端右对齐（往左长）：角标永远长在绘图区内侧，
               不会顶出画布，也不会压到左侧的机器人名。 */
            textAlign: side === 'right' ? 'right' : 'left',
            textVerticalAlign: 'bottom',
            fill: '#a8b4c4', fontSize: 11, fontWeight: 600, fontFamily: FONT_STACK
          }
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
  /* 滑块宽度 = 窗口 / 数据范围，严格等比。
     曾经这里有个「6 小时视觉下限」：窗口再小也按 6 小时对应的宽度画，
     理由是「窄到点不中」。但那会让滑块长度与真实比例对不上 ——
     默认 1 天范围 + 1 小时窗口本该是 1/24，却被画成 6/24 = 1/4，
     看起来像「窗口占了四分之一的数据」，和上面甘特图的实际视野完全不符。
     现在改成严格等比，可用性交给 CSS 的隐形热区（见 .tl-scroll-win::before，
     它把可点击范围向左右各扩 6px），视觉比例不再被牺牲。 */
  var w = Math.max(1, Math.min(tW, state.span / total * tW));
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
  document.getElementById('selTotal').onchange = function () {
    state.total = parseInt(this.value, 10) || state.total;
    if (state.span > state.total) { state.span = state.total; syncSpanSelect(); }   // 窗口不能大于总长
    state.offset = 0;
    state.focusId = null;
    recomputeBounds();
    tlUpdateWindow();
    /* 总长变了：本地只加载了 LOAD_DAYS 天，超出就往前补拉更早的数据 */
    var need = Math.ceil(state.total / 86400000);
    if (need > LOAD_DAYS) loadRuns(need).then(renderRecordsView);
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
    else if (QUEUE_STATES[s]) waiting++;   // Waiting / Delivered 都算排队中
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
    textStyle: chartTextStyle(),
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
    textStyle: chartTextStyle(),
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
    textStyle: chartTextStyle(),
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
    textStyle: chartTextStyle(),
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
/* 详情页指标卡：结构与标题栏那套 .metric 一致（小标题 + 大数字），
   直接复用 anCard() —— 它产出的就是 .metric，与其他视图顶栏指标卡同一套皮肤。 */
function dtCard(k, v, color) { return anCard(k, v, color); }
function renderDetail() {
  var app = document.getElementById("app");
  if (typeof lgReset === "function") lgReset();   // 释放上一个详情的 Monaco 编辑器与模型
  var rec = DETAIL_REC;
  if (!rec) {
    app.innerHTML = '<div class="empty">未找到该运行记录。</div>';
    return;
  }
  /* 卡片标题 = 项目名（恢复成标题，不再用「运行记录详情」+ 灰色小字那种写法）：
     顶栏的视图名按钮已经写了「运行记录详情」，卡片里再写一遍是重复的。
     这里直接拿项目名当标题，位置就是原来「日志内容」那一行。 */
  var ttl = document.getElementById("ttl");
  if (ttl) ttl.textContent = rec.name || "运行记录详情";
  var queueMs = (rec.execStart && rec.execStart > rec.start) ? (rec.execStart - rec.start) : 0;
  var runFrom = (rec.execStart && rec.execStart > rec.start) ? rec.execStart : rec.start;
  var runMs = (rec.end == null) ? null : (rec.end - runFrom);
  /* 五张指标卡与其他视图统一填进顶栏（#headMetrics 里的 #dtMetrics）：
     状态 / 开始时间 / 排队时长 / 运行时长 / 结束时间。
     时间一律 hh:mm（fmtHM），时长一律英文简写（fmtDurEn，如 2m25s）。
     配色与其它视图保持一致的口径（见分析页 anMetrics）：
       排队时长用紫、运行时长用绿 —— 和分析页的「平均排队 / 平均运行」同色；
       开始时间用蓝、结束时间用琥珀，两端时刻互相区分；
       状态用状态色（statusColorSolid），失败红 / 运行中橙 / 排队中蓝 / 已完成绿。
     状态卡的值是 statusBadge（自带底色与文字色），所以传空色 ——
     外面再套一层 color 反而会和徽章自身的颜色打架。 */
  var mBox = document.getElementById("dtMetrics");
  if (mBox) {
    mBox.innerHTML =
      dtCard("状态", statusBadge(rec.status), "")
      + dtCard("开始时间", rec.start == null ? "—" : fmtHM(rec.start), "#378ADD")
      + dtCard("排队时长", queueMs ? fmtDurEn(queueMs) : "—", "#7F77DD")
      + dtCard("运行时长", runMs != null ? fmtDurEn(runMs) : "—", "#1D9E75")
      + dtCard("结束时间", rec.end == null
        ? '<span style="color:#EF9F27">进行中</span>' : fmtHM(rec.end), "#EF9F27");
  }
  var logCard = '<div class="log-card">'
    + '<div class="log-tabs" id="logTabs"></div>'
    + '<div class="log-body">'
    + '<div id="logbox" class="tip">正在读取日志…</div>'
    + '</div></div>';
  app.innerHTML = logCard;
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

/* ---- 导航：跳匹配处（关键词来自深链，不再有搜索框） ----
   原先还有「仅看异常」的异常行跳转与上一处/下一处按钮，已按需求整体去掉；
   保留 lgGoTo 是因为深链（日志检索页跳进来带 ?kw=）仍要定位到命中行。 */
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
/* 「共 N 处 · 错误 N · 警告 N」那行统计已按需求去掉，这里只保留
   按钮状态的同步（复制按钮的可用态由 logSyncCopyBtn 管）。 */
function lgStatUpdate() {
  logSyncCopyBtn();   // 日志读取失败/无目录等分支也会走到这里，顺手同步复制按钮
  lgRefreshSyncBtn(); // 同理：没有日志文件时刷新按钮保持不可点
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
    /* 深链关键词：没有搜索框了，关键词只用于高亮并跳到第一处命中 */
    LOGM.kw = LG_LINK.kw;
    logApplyHits();
    if (LOGM.matches.length) lgGoTo(0);
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
  /* 说明：刷新 / 复制路径 / 重新运行 / 项目配置 / 返回 这五个按钮都在
     index.html 的静态结构里，监听在页面加载时绑一次（见文件末尾的绑定区），
     这里不再重复绑 —— 否则每次进详情页都会叠一层监听。
     原先这里还绑过「上一处 / 下一处 / 仅看异常 / 搜索框」，
     那四个控件已按需求整体去掉（搜索与异常跳转不再需要）。 */
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
  /* 两个按钮回到初始态：刷新/复制都先禁用，等日志清单读出来再由
     lgRefreshSyncBtn / logSyncCopyBtn 打开（这两个按钮是静态元素，
     不随详情页重建，所以状态必须在这里显式复位）。 */
  var ids = ["btnLogRefresh", "btnCopyPath"], b, j;
  for (j = 0; j < ids.length; j++) {
    b = document.getElementById(ids[j]);
    if (b) b.disabled = true;
  }
  var rb = lgRefreshBtn();
  if (rb) rb.classList.remove("busy");
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
/* 排期「立刻更新」：请后端立刻抓一次触发器（同步抓完才返回），期间显示转圈弹窗。
   与 12h 后台轮询共用同一把 UPDATE_LOCK，不会并发抓。 */
function scRefreshNow() {
  var btn = document.getElementById('scRefresh');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  var label = btn.textContent;
  btn.textContent = '抓取中…';
  glShow('正在从八爪鱼云端抓取触发器排期…');
  fetch('/api/schedule/refresh', { method: 'POST', credentials: 'same-origin' })
    .then(function (res) {
      if (res.status === 401) { location.href = '/login'; return null; }
      return res.json();
    })
    .then(function (d) {
      glHide();
      if (!d) return;
      if (!d.ok) { alert('抓取失败：' + (d.message || '未知错误')); return; }
      var msg = d.changed ? ('已更新 ' + d.changed + ' 条触发器') : '排期无变化';
      btn.textContent = '✓ ' + msg;
      /* 抓完重载本页（数据在库里，重新拉一次即最新） */
      return loadSchedule().then(function () {
        if (!scReady) { scInit(); scReady = true; } else { scReload(); }
      }).then(function () {
        setTimeout(function () { btn.textContent = label; btn.disabled = false; }, 1800);
      });
    })
    .catch(function (e) {
      glHide();
      alert('抓取失败：' + (e && e.message ? e.message : e));
      btn.textContent = label; btn.disabled = false;
    });
}
document.getElementById('scRefresh').addEventListener('click', scRefreshNow);
/* 当前时刻标记每 6 秒跟随一次（横线位置 + 今天列的底色，跨天时自动切换） */
setInterval(scUpdateNowLine, 6000);

﻿/* ==================== 数据同步（SSE 广播 + 时间戳增量 + 看门狗） ====================
   全站只有一条同步链路，与「当前在哪个页面」无关：

   1. 启动时拉一次 7 天记录（loadRuns），拿到游标 CURSOR；
   2. 订阅后端 SSE（/api/events）；
   3. 收到 change 事件 → 带 CURSOR 增量拉取（后端只回「最后修改时间 > 游标」的行）
      → 按 id 合并进 RECORDS → 重画当前视图（若该视图消费记录）；
   4. 看门狗：后端每 20s 发一个命名心跳（event: ping）。若 60s 内一条消息都没收到，
      说明连接假死（隧道黑洞式断开不会触发 onerror），主动断开重连并补拉增量。

   排期（触发器）不在这条链路上：12h 才变一次，打开排期页时拉一次，
   想立刻更新用页内「立刻更新」按钮（后端同步抓完才返回）。 */

/* 收到变更：合并短时间内的多个事件为一次增量拉取（避免打爆） */
var pullTimer = null;
function onDataChanged() {
  if (pullTimer) return;
  pullTimer = setTimeout(function () {
    pullTimer = null;
    pullIncremental().then(function (changed) {
      if (changed) renderRecordsView();
    });
  }, 200);
}

/* 按当前视图重画 RECORDS（记录变化后调用）。
   只重画「确实消费 RECORDS」的视图；其他视图在进入时自然会拿最新数据。 */
function renderRecordsView() {
  if (curView === 'timeline') {
    records = RECORDS.slice();
    recomputeBounds();
    if (IS_MOBILE) tlFeedSync();
    else tlRender();
  } else if (curView === 'analysis') {
    if (anReady) anRenderAll(RECORDS);
  } else if (curView === 'botstatus') {
    if (bsReady) bsLoad().then(bsRender);
  } else if (curView === 'projects' && pjRunsVisible()) {
    pjRunsLoad();          // 项目页「运行记录」tab 也读 RECORDS
  }
}

/* 项目控制台「运行记录」tab 是否正显示（该 tab 读 RECORDS，配置 tab 不读） */
function pjRunsVisible() {
  var el = document.getElementById('pjPanelRuns');
  return !!(el && el.style.display !== 'none');
}

/* ---- SSE 连接 + 看门狗 ---- */
var SSE_DEAD_MS = 60000;    // 超过这么久没收到任何消息（change/ping）判定连接假死
var sseWdTimer = null;

function sseConnect() {
  if (sseSource) return;
  try { sseSource = new EventSource('/api/events'); } catch (e) { sseSource = null; return; }
  lastSseMsgAt = Date.now();
  /* change：有变更（首帧也发一次，用于首轮对账 / 重连后补拉） */
  sseSource.addEventListener('change', function () {
    lastSseMsgAt = Date.now();
    onDataChanged();
  });
  /* 命名心跳：证明连接活着（注释行不会到达 JS，所以后端特意用命名事件） */
  sseSource.addEventListener('ping', function () { lastSseMsgAt = Date.now(); });
  sseSource.onopen = function () { lastSseMsgAt = Date.now(); };
  sseSource.onerror = function () {
    /* EventSource 自带重连；这里只记时间，重连成功的 change 首帧会补拉增量 */
    lastSseMsgAt = Date.now();
  };
}

function sseWatchdogTick() {
  if (!sseSource) { sseConnect(); return; }
  if (Date.now() - lastSseMsgAt < SSE_DEAD_MS) return;
  /* 假死：强制重建（关闭后重新 new 会立刻连），重连的 change 首帧补拉增量 */
  try { sseSource.close(); } catch (e) { }
  sseSource = null;
  sseConnect();
}

/* 回前台：切后台/锁屏时浏览器冻结定时器并挂起 SSE（连接不断开就不触发 onerror，
   看门狗也被冻结）。回到前台立刻重置基准、检查连接并补一次增量。 */
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState !== 'visible') return;
  lastSseMsgAt = Date.now();          // 重置基准，避免刚回来就被误判假死
  if (!sseSource || sseSource.readyState === 2) {
    try { if (sseSource) sseSource.close(); } catch (e) { }
    sseSource = null;
    sseConnect();
  }
  onDataChanged();                    // 当场补拉离开期间错过的变化
});

/* 启动同步：连 SSE + 起看门狗（每 15s 查一次，只有真假死才动作） */
function startSync() {
  sseConnect();
  if (!sseWdTimer) sseWdTimer = setInterval(sseWatchdogTick, 15000);
}
document.getElementById('btnBack').addEventListener('click', function () {
  // 返回上一页（时间轴/项目控制台等任意入口）；无历史时兜底回时间轴
  var cur = location.hash;
  history.back();
  setTimeout(function () { if (location.hash === cur) location.hash = '#/timeline'; }, 300);
});
/* 详情页两个「日志相关」按钮：现在都在 index.html 的静态结构里，
   监听在这里绑一次即可（原先绑在 lgInit 里，每次进详情页都会重复叠加）。 */
document.getElementById('btnLogRefresh').addEventListener('click', lgRefreshFile);
document.getElementById('btnCopyPath').addEventListener('click', lgCopyPath);
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
      /* 新运行要等后端下一轮抓取（6s 轮询）才会入库，入库后 SSE 会通知；
         这里不主动抓取，等广播即可（通常几秒内）。 */
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
/* 全站自动同步：连 SSE + 起看门狗（无开关，始终开启） */
startSync();

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
/* 局部加载遮罩：只盖住正在加载的那块卡片，页面其余部分照常可用。
   项目控制台 / 触发器合规这类「进页面先拉数据」的视图以前用全屏遮罩，
   结果导航、指标卡、别的面板全都点不动 —— 但实际在等的只是其中一块。
   用法：
     var b = scopedBusy(el, '正在加载项目列表…');   // 开启
     b.done();                                      // 关闭（幂等）
   el 为空时退化成全屏遮罩（保证调用方不用到处判空）。 */
function scopedBusy(el, msg) {
  if (!el) { glShow(msg); return { done: glHide }; }
  el.classList.add('scoped-busy', 'is-busy');
  if (msg) el.setAttribute('data-busy', msg);
  var closed = false;
  return {
    done: function () {
      if (closed) return;
      closed = true;
      el.classList.remove('is-busy');
      el.removeAttribute('data-busy');
    }
  };
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
  /* 局部遮罩只盖住「项目列表」这张卡片（含它的表头）：
     全屏遮罩会把导航、指标卡和右侧详情一起挡住，而那些都不在加载。
     容器用 .pj-side（卡片本身）而不是 .pj-list，遮罩才能盖住表头与刷新按钮。 */
  var busy = scopedBusy(document.querySelector('#view-projects .pj-side') || el, '正在加载项目列表…');
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
  }).then(function (v) { busy.done(); return v; });
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
  if (name === 'runs') {
    /* 打开运行记录 tab：确保有记录后渲染（记录由全局 SSE 链路保持新鲜） */
    ensureRecords().then(pjRunsLoad);
  }
}
function pjRunsLoad() {
  var p = pjCurrent;
  var el = document.getElementById('pjRunsList');
  if (!p || !el) return;
  /* 局部遮罩：只盖运行记录面板 */
  var busy = scopedBusy(document.getElementById('pjPanelRuns'), '正在加载运行记录…');
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
    busy.done();
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
  /* 局部遮罩：只盖「飞书配置」面板 */
  var busy = scopedBusy(document.getElementById('pjPanelCfg'), '正在加载配置…');
  return api('/api/projects/config?group=' + encodeURIComponent(g)).then(function (d) {
    if (!d || !d.ok) {
      tbl.innerHTML = '';
      alert((d && d.error) || '加载配置失败');
    } else {
      pjCfgItems = d.items || [];
      pjCfgRender();
    }
    busy.done();
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
   数据由前端从本地 RECORDS 现算（见下方 bsBuild，口径与后端 dashboard.build_bot_status
   一致）：在途记录 -> 运行中/排队中，无在途 -> 空闲；附当前任务、空闲时长、
   近 24 小时与近 7 天负载。记录本身由全局 SSE 链路保持新鲜。

   呈现为「一个机器人一张卡片」的网格：横屏一行 3 张、竖屏一行 1 张，
   卡片多了在网格容器内往下滚动。列数只由 CSS 的 .bs-grid 决定
   （style.css 里按视口宽高比切换），JS 这边不掺和排布，只负责出卡片。 */
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
  var grid = document.getElementById('bsGrid');
  if (grid) grid.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('.bs-task-link[data-rid]') : null;
    if (a) location.hash = '#/detail?id=' + encodeURIComponent(a.getAttribute('data-rid'));
  });
}
/* 机器人状态：从本地 RECORDS 现算（不再有 /api/botstatus 接口）。
   口径与后端 dashboard.build_bot_status 一致（逐行对照移植）：
     running = 有 end 为空且 status=Executing 的记录；
     queued  = 无运行中但有 end 为空的记录；
     idle    = 没有任何在途记录。
   排序：运行中 → 排队中 → 空闲，同级按近 7 天记录数降序，再按机器人名。 */
var BS_DAY = 86400000;
function bsBuild(records) {
  var nowMs = Date.now();
  var bots = {}, order = [];
  records.forEach(function (r) {
    var rb = r.robot || '(未指定机器人)';
    var u = bots[rb];
    if (!u) {
      u = bots[rb] = { robot: rb, tasks: [], running: 0, queued: 0,
        lastSeen: null, lastEnd: null, lastName: '', logReady: false,
        d1c: 0, d1f: 0, w7c: 0, w7f: 0, w7waitSum: 0, w7waitN: 0, w7runSum: 0, w7runN: 0 };
      order.push(rb);
    }
    var st = r.start || 0, en = r.end, ex = r.execStart;
    if (nowMs - st <= BS_DAY) {
      u.d1c++;
      if (r.status === 'Failed') u.d1f++;
    }
    if (nowMs - st <= 7 * BS_DAY) {
      u.w7c++;
      if (r.status === 'Failed') u.w7f++;
      if (ex && ex > st) { u.w7waitSum += ex - st; u.w7waitN++; }
      var rf = (ex && ex > st) ? ex : st;
      if (en && en > rf) { u.w7runSum += en - rf; u.w7runN++; }
    }
    if (r.logOk) u.logReady = true;
    if (en == null) {
      if (r.status === 'Executing') u.running++; else u.queued++;
      var rf2 = (ex && ex > st) ? ex : st;
      u.tasks.push({ id: r.id, name: r.name || r.app || '', app: r.app || '',
        status: r.status || '', way: r.way || '', start: st, execStart: ex,
        elapsed: Math.max(0, nowMs - rf2),
        waited: (ex && ex > st) ? (ex - st) : 0 });
    } else if (u.lastEnd == null || en > u.lastEnd) {
      u.lastEnd = en;
      u.lastName = r.name || r.app || '';
    }
    var seen = en ? en : st;
    if (u.lastSeen == null || seen > u.lastSeen) u.lastSeen = seen;
  });
  var out = order.map(function (rb) {
    var u = bots[rb];
    var state = u.running ? 'running' : (u.queued ? 'queued' : 'idle');
    var marker = u.lastEnd != null ? u.lastEnd : u.lastSeen;
    var idleMs = marker != null ? Math.max(0, nowMs - marker) : null;
    u.tasks.sort(function (a, b) { return a.start - b.start; });
    return { robot: u.robot, state: state, tasks: u.tasks,
      running: u.running, queued: u.queued,
      lastSeen: u.lastSeen, lastEnd: u.lastEnd,
      idleMs: idleMs, lastName: u.lastName, logReady: u.logReady,
      recent: { count: u.d1c, failed: u.d1f },
      week: { count: u.w7c, failed: u.w7f,
        failRate: u.w7c ? (u.w7f / u.w7c) : 0,
        avgWait: u.w7waitN ? (u.w7waitSum / u.w7waitN) : 0,
        avgRun: u.w7runN ? (u.w7runSum / u.w7runN) : 0 } };
  });
  var ord = { running: 0, queued: 1, idle: 2 };
  out.sort(function (a, b) {
    var d = (ord[a.state] == null ? 3 : ord[a.state]) - (ord[b.state] == null ? 3 : ord[b.state]);
    if (d) return d;
    if (b.week.count !== a.week.count) return b.week.count - a.week.count;
    return a.robot < b.robot ? -1 : (a.robot > b.robot ? 1 : 0);
  });
  return { ok: true, now: nowMs, summary: {
    robots: out.length,
    running: out.filter(function (b) { return b.state === 'running'; }).length,
    queued: out.filter(function (b) { return b.state === 'queued'; }).length,
    idle: out.filter(function (b) { return b.state === 'idle'; }).length,
    tasks: out.reduce(function (n, b) { return n + b.tasks.length; }, 0) }, bots: out };
}
function bsLoad() {
  /* 数据源是本地 RECORDS（由全局 SSE 链路保持新鲜）；不再请求后端。
     返回 Promise 以兼容既有调用点（bsRender 在 then 里执行）。 */
  BS_DATA = RECORDS.length ? bsBuild(RECORDS) : null;
  return Promise.resolve(BS_DATA);
}
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
  var grid = document.getElementById('bsGrid');
  if (grid) grid.innerHTML = '<div class="bs-empty">' + esc(msg) + '</div>';
  var info = document.getElementById('bsInfo');
  if (info) info.textContent = '—';
  var m = document.getElementById('bsMetrics');
  if (m) m.innerHTML = '';
}
function bsRender() {
  var grid = document.getElementById('bsGrid');
  if (!grid) return;
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
  if (!list.length) {
    bsEmpty('没有符合条件的机器人。');
    return;
  }
  grid.innerHTML = list.map(bsCard).join('');
}
/* 一个机器人一张卡片：左侧色条 + 状态点/状态标签表明在跑什么，
   中间两行「任务名 / 进度」可点（跳该条记录日志），底部 6 个近况读数。

   卡片高度必须完全一致，所以内容按「定长结构」拼：头部 1 行 + 任务区 2 行 +
   读数区 3×2 格。任务名一律单行省略号截断（不折行），进度行哪怕没有内容也占位
   （空闲机器填「最近结束 …」）—— 只要有一张卡多折了一行，整行卡片就会被撑高。 */
function bsCard(b) {
  var st = BS_STATE[b.state] || BS_STATE.idle;
  var busy = !!(b.tasks && b.tasks.length);
  var nameHtml, metaHtml;
  if (busy) {
    var t = b.tasks[0];
    nameHtml = '<span class="bs-task-link" data-rid="' + esc(t.id) + '" title="点击查看该任务的日志">'
      + esc(t.name || t.app || '运行记录') + '</span>';
    /* 时长用紧凑写法（fmtDurShort）：一行 3 张时卡片内宽只有 200 出头，
       带空格的「11 分 40 秒」会把进度行挤到省略号 */
    metaHtml = '<span class="bs-task-meta">'
      + esc((QUEUE_STATES[t.status] ? '等待调度' : '已跑 ' + fmtDurShort(t.elapsed))
        + (t.waited ? ' · 排队 ' + fmtDurShort(t.waited) : '')
        + (b.tasks.length > 1 ? ' · 另有 ' + (b.tasks.length - 1) + ' 个在途' : ''))
      + '</span>';
  } else {
    nameHtml = '<span class="bs-dim">'
      + esc(b.lastName || '暂无运行记录') + '</span>';
    metaHtml = '<span class="bs-task-meta">'
      + (b.lastEnd ? '最近结束 ' + esc(fmtTime(b.lastEnd)) : '—') + '</span>';
  }
  var w = b.week || {}, r24 = b.recent || {};
  /* 空闲时长只在真空闲时展示：运行中/排队中的机器显示「距上次结束」会被误读成"它闲着呢" */
  var idle = (b.state === 'idle' && b.idleMs != null) ? fmtDurShort(b.idleMs) : '—';
  /* 有在途任务才是「当前任务」；空闲机器那一行给的是历史记录，标签得跟着换 */
  var taskK = busy ? '当前任务' : '最近任务';
  /* 读数一律用紧凑时长（fmtDurShort），且每格单行省略号 —— 格子宽度固定，
     用 fmtDur 的「7 分 30 秒」会把卡片读数挤成两行，卡片高度就不齐了 */
  var stats = [
    ['空闲', idle, b.state === 'idle' ? '' : 'bs-dim'],
    ['近 24 小时', (r24.count || 0) + (r24.failed ? ' · 失败 ' + r24.failed : ''),
      r24.failed ? 'bs-bad' : ''],
    ['近 7 天', String(w.count || 0), ''],
    ['失败率', Math.round((w.failRate || 0) * 100) + '%', (w.failRate || 0) >= 0.2 ? 'bs-bad' : ''],
    ['平均排队', fmtDurShort(w.avgWait), 'bs-dim'],
    ['平均运行', fmtDurShort(w.avgRun), 'bs-dim']
  ];
  return '<article class="bs-card bs-st-' + esc(b.state || 'idle') + '">'
    + '<div class="bs-card-head">'
    + '<span class="bs-dot" style="background:' + st.color + '"></span>'
    + '<span class="bs-name" title="' + esc(b.robot) + '">' + esc(b.robot) + '</span>'
    + '<span class="bs-state" style="background:' + st.bg + ';color:' + st.color + '">'
    + st.cn + '</span>'
    + '</div>'
    + '<div class="bs-card-task">'
    + '<div class="bs-task-line"><span class="bs-task-k">' + taskK + '</span>'
    + '<span class="bs-task-v" title="' + esc(busy
      ? (b.tasks[0].name || b.tasks[0].app || '运行记录') : (b.lastName || '暂无运行记录')) + '">'
    + nameHtml + '</span></div>'
    + '<div class="bs-task-line bs-task-line2">' + metaHtml + '</div>'
    + '</div>'
    + '<div class="bs-stats">' + stats.map(function (it) {
      return '<div class="bs-stat"><span class="k">' + it[0] + '</span>'
        + '<span class="v ' + it[2] + '" title="' + esc(it[1]) + '">' + esc(it[1]) + '</span></div>';
    }).join('') + '</div>'
    + '</article>';
}

/* ==================== 启动 ==================== */
route();

