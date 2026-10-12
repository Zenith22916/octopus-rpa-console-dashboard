/* ============================================================================
 * util.js —— 纯函数工具层（无状态、无 DOM 依赖）
 * 由原 web/app.js 顶部的公共工具段迁移而来，行为逐条对齐：
 * 状态中文名 / 时间与时长格式化 / 状态配色 / 渐变与调色 / 图表皮肤 / 画布测宽。
 * ========================================================================= */

/* ---------------- 枚举与中文名 ---------------- */
export const STATUS_CN = {
  Waiting: "排队中", Executing: "运行中", Finished: "已完成",
  Failed: "失败", Stopped: "已停止"
};
export const WAY_CN = { Manual: "手动", TimingTrigger: "定时触发器", Webhook: "Webhook" };

export const statusCN = (s) => STATUS_CN[s] || s || "—";
export const wayCN = (w) => WAY_CN[w] || w || "—";
export const wayOf = (r) => WAY_CN[r.way] || r.way || "-";

/* ---------------- 文本与时间 ---------------- */
export const pad = (n) => String(n).padStart(2, "0");

/* HTML 转义：仅用于 ECharts tooltip 这类「必须拼 HTML 字符串」的地方 */
export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

/* 分钟级时间：MM-DD HH:mm（表格、图例、提示窗通用） */
export function fmtTime(ms) {
  if (ms == null) return "-";
  const d = new Date(ms);
  return (d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}
/* 完整时间：YYYY-MM-DD HH:mm:ss */
export function fmtFull(ms) {
  if (ms == null) return "—";
  const d = new Date(ms);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
    pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
}
/* 时长口语化：用于时间窗口大小提示 */
export function fmtSpanLabel(ms) {
  const m = ms / 60000;
  if (m < 90) return (m < 10 ? m.toFixed(1) : Math.round(m)) + ' 分钟';
  const h = ms / 3600000;
  if (h < 48) return (h < 10 ? h.toFixed(1) : Math.round(h)) + ' 小时';
  return (ms / 86400000).toFixed(1) + ' 天';
}
export function fmtDur(ms) {
  if (ms == null || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return s + " 秒";
  const m = Math.floor(s / 60), sec = s % 60;
  if (m < 60) return m + " 分" + (sec ? " " + sec + " 秒" : "");
  const h = Math.floor(m / 60), mm = m % 60;
  return h + " 小时" + (mm ? " " + mm + " 分" : "");
}
/* 紧凑时长：手机端时间轴块内文字、运行记录卡片、机器人卡片的右侧读数用 */
export function fmtDurShort(ms) {
  if (ms == null || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return s + "秒";
  const m = Math.floor(s / 60), sec = s % 60;
  if (m < 60) return sec ? (m + "分" + sec + "秒") : (m + "分");
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? (h + "小时" + mm + "分") : (h + "小时");
}
/* 图表刻度用的紧凑时长：45 s / 12.5 min / 3 h 20 min */
export function fmtDurM(ms) {
  if (ms == null || isNaN(ms)) return "-";
  const m = ms / 60000;
  if (m < 1) return Math.round(ms / 1000) + " s";
  if (m < 60) return m.toFixed(1) + " min";
  const h = Math.floor(m / 60), mm = Math.round(m % 60);
  return h + " h" + (mm ? (" " + mm + " min") : "");
}
export function fmtSize(b) {
  if (b == null) return "";
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / 1024 / 1024).toFixed(2) + " MB";
}
export function hms(ms) {
  const d = new Date(ms);
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

/* ---------------- 状态配色 ----------------
   时间轴数据块走半透明（重叠可辨、长时间看不刺眼），卡片正文用实色。 */
export const STATUS_HUE = {
  Failed: [226, 75, 74],
  Executing: [239, 159, 39],
  Waiting: [55, 138, 221],
  Stopped: [120, 122, 128],
  Finished: [29, 158, 117]
};
export function statusColor(r) {
  if (r.status === "Failed") return "rgba(226,75,74,0.6)";
  if (r.status === "Executing") return "rgba(239,159,39,0.6)";
  if (r.status === "Waiting") return "rgba(55,138,221,0.6)";
  if (r.status === "Stopped") return "rgba(95,94,90,0.6)";
  return "rgba(29,158,117,0.6)";
}
export function statusColorSolid(r) {
  if (r.status === "Failed") return "#E24B4A";
  if (r.status === "Executing") return "#EF9F27";
  if (r.status === "Waiting") return "#378ADD";
  if (r.status === "Stopped") return "#8b8f98";
  return "#1D9E75";
}
/* 未知状态兜底用中性灰，不要落成「已完成」的绿色 —— 那会把失败/新状态伪装成成功 */
export function statusRGB(k, alpha) {
  const c = STATUS_HUE[k] || STATUS_HUE.Stopped;
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';
}
/* 状态 -> EP 标签类型（el-tag / el-progress 等组件用） */
export const STATUS_TAG_TYPE = {
  Finished: 'success', Executing: 'warning', Waiting: 'primary',
  Failed: 'danger', Stopped: 'info'
};
export const statusTagType = (s) => STATUS_TAG_TYPE[s] || 'info';
export const statusHex = statusColorSolid;
/* 合规状态徽标色（触发器合规视图） */
export const CP_STATE = {
  hit: { cn: '按时', color: '#1D9E75', bg: 'rgba(29,158,117,0.18)' },
  late: { cn: '延迟', color: '#EF9F27', bg: 'rgba(239,159,39,0.18)' },
  mismatch: { cn: '应用不符', color: '#D85A30', bg: 'rgba(216,90,48,0.18)' },
  missed: { cn: '漏跑', color: '#E24B4A', bg: 'rgba(226,75,74,0.18)' },
  pending: { cn: '待定', color: '#8b8f98', bg: 'rgba(139,143,152,0.16)' }
};
/* 机器人实时状态徽标色 */
export const BS_STATE = {
  running: { cn: '运行中', color: '#EF9F27', bg: 'rgba(239,159,39,0.18)' },
  queued: { cn: '排队中', color: '#378ADD', bg: 'rgba(55,138,221,0.18)' },
  idle: { cn: '空闲', color: '#8b8f98', bg: 'rgba(139,143,152,0.16)' }
};
/* 项目控制台配色：按项目名首字固定色，便于一眼分辨 */
export const PJ_NAME_COLORS = {
  '宝': '#378ADD', '硕': '#1D9E75', '国': '#D85A30',
  '泇': '#7F77DD', '财': '#EF9F27', 'X': '#8b8f98', 'x': '#8b8f98'
};
export const PJ_COLORS = ['#378ADD', '#1D9E75', '#D85A30', '#7F77DD', '#EF9F27', '#E24B4A', '#2BA6A0'];
export function pjColor(name) {
  if (!name) return PJ_COLORS[0];
  const c = name.charAt(0);
  if (PJ_NAME_COLORS[c]) return PJ_NAME_COLORS[c];
  return PJ_COLORS[name.charCodeAt(0) % PJ_COLORS.length];
}

/* ---------------- 图表视觉：渐变填充与调色 ---------------- */
export function gradFill(a, b, dir) {
  const horizontal = dir === 'h';
  try {
    return new window.echarts.graphic.LinearGradient(0, 0, horizontal ? 1 : 0, horizontal ? 0 : 1,
      [{ offset: 0, color: a }, { offset: 1, color: b }]);
  } catch (e) {
    return a;   // echarts 未就绪时降级为纯色，保证图形仍能画出来
  }
}
/* 任意合法颜色（#hex / rgb / rgba）-> 分量，解析不了返回 null */
export function parseColor(c) {
  const s = String(c == null ? '' : c).trim();
  const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
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
export function shadeGrad(color, dir, lift, drop) {
  const c = parseColor(color);
  if (!c) return color;
  const k1 = lift == null ? .26 : lift;
  const k2 = drop == null ? .24 : drop;
  return gradFill(
    'rgba(' + Math.round(c.r + (255 - c.r) * k1) + ',' +
    Math.round(c.g + (255 - c.g) * k1) + ',' +
    Math.round(c.b + (255 - c.b) * k1) + ',' + c.a + ')',
    'rgba(' + Math.round(c.r * (1 - k2)) + ',' +
    Math.round(c.g * (1 - k2)) + ',' +
    Math.round(c.b * (1 - k2)) + ',' + c.a + ')',
    dir);
}
export const statusPieFill = (k) => shadeGrad(statusRGB(k, 1), 'v', .1, .12);
/* 等待段填充（时间轴排队块） */
export const WAIT_FILL = shadeGrad(statusRGB('Waiting', .72), 'v', .12, .14);

/* ---------------- 图表通用皮肤 ----------------
   ECharts 默认白底黑字，与深色界面不搭。集中一处，所有图表都从这里拼。 */
export const TIP_SKIN = {
  confine: true, backgroundColor: '#1c2027', borderColor: '#333a45',
  borderWidth: 1, textStyle: { color: '#e6e6e6', fontSize: 12 }
};
export function tipOpt(extra) {
  const o = {};
  Object.keys(TIP_SKIN).forEach((k) => { o[k] = TIP_SKIN[k]; });
  Object.keys(extra || {}).forEach((k) => { o[k] = extra[k]; });
  return o;
}
export const PIE_ITEM = { borderRadius: 6, borderColor: '#171b23', borderWidth: 2 };
export const PIE_LABEL = { color: '#dfe5ee', fontSize: 11, formatter: '{d}%' };
export const PIE_LINE = { length: 6, length2: 6, lineStyle: { color: 'rgba(255,255,255,.18)' } };
export function pieLegend(data) {
  return {
    bottom: 0, itemWidth: 8, itemHeight: 8, itemGap: 12,
    textStyle: { color: '#8b8f98', fontSize: 11 },
    formatter: (name) => {
      let hit = null;
      data.forEach((d) => { if (d.name === name) hit = d; });
      return hit ? (name + ' ' + hit.value) : name;
    }
  };
}
export function pieSeries(data) {
  return [{
    type: 'pie', radius: ['42%', '64%'], center: ['50%', '44%'],
    itemStyle: PIE_ITEM, label: PIE_LABEL, labelLine: PIE_LINE,
    emphasis: { scale: true, scaleSize: 4 },
    data
  }];
}
/* 触发方式色板 */
export const WAYHUE = { '手动': [29, 158, 117], '定时触发器': [127, 119, 221], 'Webhook': [216, 118, 63] };

/* ---------------- 画布测宽（图表内文字截断用） ---------------- */
export const FONT_STACK = (() => {
  try { return getComputedStyle(document.body).fontFamily || 'sans-serif'; }
  catch (e) { return 'sans-serif'; }
})();
const _mc = (() => {
  try { const c = document.createElement('canvas').getContext('2d'); c.font = '500 20px ' + FONT_STACK; return c; }
  catch (e) { return null; }
})();
export function measureW(s, fs) {
  if (!_mc) return String(s == null ? '' : s).length * 10;
  _mc.font = '500 ' + (fs || 20) + 'px ' + FONT_STACK;
  return _mc.measureText(String(s == null ? '' : s)).width;
}
/* 单行文字：放得下整串显示；放不下则截断并在末尾加 "..." */
export function truncateLabel(name, maxW, fs) {
  if (!name) return '';
  if (maxW < 6) return '';
  if (measureW(name, fs) <= maxW) return name;
  const ell = '...', ellW = measureW(ell, fs), budget = maxW - ellW;
  if (budget <= 0) return '';
  let cur = '', curW = 0;
  for (let i = 0; i < name.length; i++) {
    const cw = measureW(name[i], fs);
    if (curW + cw > budget) break;
    cur += name[i]; curW += cw;
  }
  return cur + ell;
}

/* ---------------- 机器人短名 ----------------
   手机端记录流用：8 字全名（「A🍩硕晞-01」）在手机上太长，
   去掉组前缀（A/B）与 emoji，只留「硕晞-01」。 */
export function robotShortName(n) {
  let s = String(n == null ? '' : n);
  s = s.replace(/^[A-Za-z]\s*/, '');
  s = s.replace(/[^\u4e00-\u9fa5A-Za-z0-9-]/g, '');
  s = s.replace(/^-+/, '');
  return s || String(n == null ? '' : n);
}

/* ---------------- 下载 / CSV 导出 ---------------- */
export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export function exportCsv(head, rows, filename) {
  const lines = [head.join(',')];
  rows.forEach((r) => {
    lines.push(r.map((x) => '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"').join(','));
  });
  downloadBlob(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }), filename);
}
