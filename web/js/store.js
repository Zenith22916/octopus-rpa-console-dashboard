/* ============================================================================
 * store.js —— 全局状态与跨视图共享逻辑
 *
 * 单一 reactive 状态树 + 一组动作函数（替代原 app.js 里散落的全局变量）：
 *   view / records / schedule / 数据获取时间 / 自动更新 / 运行弹窗 / 深链参数。
 * 视图组件只读状态、调用动作，不互相直接引用。
 * ========================================================================= */
import { reactive } from './vendor.js';
import { api } from './api.js';
import { shell } from './shell.js';

/* 视图清单：detail 无侧栏导航项，只能由链接进入 */
export const VIEW_NAMES = ['timeline', 'analysis', 'detail', 'schedule', 'projects',
  'botstatus', 'logsearch', 'compliance'];

export const NAV_GROUPS = [
  {
    title: '运行监控',
    items: [
      { name: 'analysis', label: '运行数据分析', icon: 'DataAnalysis' },
      { name: 'timeline', label: '任务时间轴', icon: 'Histogram' },
      { name: 'botstatus', label: '机器人状态', icon: 'Cpu' }
    ]
  },
  {
    title: '问题排查',
    items: [
      { name: 'logsearch', label: '日志检索', icon: 'Search' },
      { name: 'compliance', label: '触发器合规', icon: 'CircleCheck' }
    ]
  },
  {
    title: '配置管理',
    items: [
      { name: 'schedule', label: '触发器排期', icon: 'Calendar' },
      { name: 'projects', label: '项目控制台', icon: 'Files' }
    ]
  }
];

/* 自动更新开关只在「数据靠自动刷新保持新鲜」的视图显示：
   排期/项目/合规页要走「立刻更新」全量抓，自动更新只抓运行记录 */
export const AUTO_VIEWS = ['timeline', 'analysis', 'botstatus'];

export const VIEW_TITLES = {
  timeline: '任务时间轴', analysis: '运行数据分析', detail: '运行记录详情',
  schedule: '触发器排期', projects: '项目控制台', botstatus: '机器人状态',
  logsearch: '日志检索', compliance: '触发器合规'
};

export const store = reactive({
  view: 'analysis',
  ready: false,              // 首屏数据是否已加载
  records: [],               // /api/runs 运行记录（时间轴 + 分析 + 多处共用）
  schedule: null,            // /api/schedule 排期数据
  dataTime: '—',             // 数据获取时间（后端返回）
  auto: true,                // 自动更新开关
  refreshing: false,         // 「立刻更新」进行中
  refreshWarn: false,        // 刷新失败横幅
  /* 详情页深链参数（日志检索/合规看板跳过来时带） */
  detail: { id: null, kw: null, file: null },
  /* 运行机器人选择弹窗 */
  runDialog: {
    open: false, endpoint: '', flowId: '', name: '',
    items: null, recommended: '', err: '', busy: false, onDone: null
  },
  /* 项目控制台的待跳转参数（详情页「项目配置」/ 排期页点标签带过来） */
  pendingFid: null,
  pendingTab: null,
  /* 标题栏指标卡：当前视图写入，Root 统一渲染。
     原实现是「每个视图一组 #xxMetrics 空容器 + 切视图切显隐」，
     改成数据驱动后，视图只需给出 [{k, v, color}] 即可。 */
  headMetrics: []
});

export function setHeadMetrics(list) { store.headMetrics = list || []; }

export const isMobile = () => window.matchMedia('(max-width: 880px)').matches;

/* ---------------- 运行机器人弹窗 ----------------
   触发运行前先让用户明确选择在哪台机器人上跑（而不是盲目由平台分配）。
   详情页「重新运行」与项目控制台「运行该应用」共用。 */
export function openRunDialog(ctx) {
  if (!ctx.flowId) { shell.toast('该记录缺少流程 ID，无法触发运行', 'error'); return; }
  Object.assign(store.runDialog, {
    open: true, endpoint: ctx.endpoint, flowId: ctx.flowId, name: ctx.name,
    items: null, recommended: '', err: '', busy: false, onDone: ctx.onDone || null
  });
  api.bots(ctx.flowId).then((d) => {
    if (!store.runDialog.open || store.runDialog.flowId !== ctx.flowId) return;   // 期间已关闭/切换
    store.runDialog.items = (d && d.items) || [];
    store.runDialog.recommended = (d && d.recommended) || '';
  }).catch((e) => {
    store.runDialog.items = [];
    store.runDialog.err = '机器人列表读取失败：' + (e && e.message ? e.message : e);
  });
}
export function closeRunDialog() {
  store.runDialog.open = false;
  store.runDialog.onDone = null;
}
export function confirmRun(botId) {
  const d = store.runDialog;
  if (!d.open || d.busy) return;
  d.err = '';
  d.busy = true;
  shell.loading('正在触发运行…');
  const body = { flow_id: d.flowId };
  if (botId) body.bot_id = botId;
  fetch(d.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then((r) => r.json()).then((j) => {
    shell.hide();
    d.busy = false;
    if (j && j.ok) {
      const onDone = d.onDone;
      closeRunDialog();
      shell.toast('已触发运行，批次号：' + (j.flowProcessNo || '—'));
      if (typeof onDone === 'function') onDone(j);
    } else {
      d.err = '运行失败：' + ((j && (j.message || j.error)) || '未知错误');
    }
  }).catch((e) => {
    shell.hide();
    d.busy = false;
    d.err = '请求失败：' + (e && e.message ? e.message : e);
  });
}

/* ---------------- 数据加载与自动更新 ---------------- */
export function loadRuns(opts) {
  return api.runs(opts).then((d) => {
    if (d && Array.isArray(d.records)) store.records = d.records;
    if (d && d.time) store.dataTime = d.time;
    return store.records;
  });
}
export function loadSchedule() {
  return api.schedule().then((d) => {
    if (d && d.ok) store.schedule = d;
    return store.schedule;
  });
}
export const loadRunDetail = (id) => api.run(id).then((d) => ((d && d.ok && d.rec) ? d.rec : null));

/* 增量合并：lite/range 刷新只返回一部分，按 id 去重后并入已有列表 */
function mergeRecords(list) {
  const seen = new Set(list.map((r) => r.id));
  const merged = list.slice();
  store.records.forEach((r) => { if (!seen.has(r.id)) merged.push(r); });
  merged.sort((a, b) => ((b.start || 0) - (a.start || 0)));
  store.records = merged;
}

/* 数据刷新：force=立刻全量抓取；mode=lite（最新 6 条）/range（「数据范围」内的记录）走增量合并 */
export function refreshData(force, mode) {
  const opts = mode === 'lite' ? { limit: 6 }
    : mode === 'range' ? { since: Date.now() - timelineTotal() }
      : null;
  if (force) store.refreshing = true;
  return (force ? api.refresh() : api.runs(opts)).then((d) => {
    let ok = false;
    if (d && d.ok && Array.isArray(d.records)) {
      ok = true;
      if (mode) mergeRecords(d.records);
      else store.records = d.records;
      if (force) store.refreshWarn = false;
      if (d.time) store.dataTime = d.time;
    } else if (force) {
      store.refreshWarn = true;
      if (d && d.time) store.dataTime = d.time + '（刷新失败）';
    }
    return ok;
  }).catch(() => false).then((ok) => {
    if (force) store.refreshing = false;
    return ok;
  });
}

/* 时间轴「数据范围」总长（ms）：refreshData 的 range 模式要用它。
   放在这里（而非视图组件）避免 api 层反向依赖视图。 */
let _timelineTotal = 24 * 3600 * 1000;
export const timelineTotal = () => _timelineTotal;
export const setTimelineTotal = (v) => { _timelineTotal = v; };

/* ---------------- hash 路由 ---------------- */
export function parseHash() {
  const h = location.hash || '#/analysis';
  const m = h.match(/^#\/([a-z]+)(?:\?(.*))?$/i);
  let name = m ? m[1].toLowerCase() : 'analysis';
  if (VIEW_NAMES.indexOf(name) < 0) name = 'analysis';
  const params = {};
  if (m && m[2]) {
    m[2].split('&').forEach((kv) => {
      const i = kv.indexOf('=');
      if (i < 0) return;
      params[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
  }
  return { name, params };
}
export function go(name, params) {
  let hash = '#/' + name;
  if (params) {
    const q = Object.keys(params)
      .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
      .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
      .join('&');
    if (q) hash += '?' + q;
  }
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}
