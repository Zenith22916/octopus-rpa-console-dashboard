/* ============================================================================
 * TimelineView.js —— 任务时间轴
 *
 * 桌面端：ECharts 甘特图（时间在横轴、机器人是泳道组）+ el-table 运行记录表，
 *         悬浮表格行会点亮图中对应的数据块，点击行进入日志详情。
 * 手机端（≤880px）：整个图表卡片不渲染（见 app.css 隐藏 .tl-top），
 *         只有一整屏的「运行记录流」，滚到底自动续批、新记录浮药丸提示。
 *
 * 与原实现的差异只在「承载方式」：DOM 拼装换成模板 + el-table，手写 select/switch
 * 换成 el-select/el-switch；甘特图的泳道分配、1:1 拖动、Ctrl+滚轮缩放、最小可见厚度、
 * 悬浮淡出等算法逐条保留。
 * ========================================================================= */
import {
  defineComponent, ref, computed, onMounted, onBeforeUnmount, nextTick, watch
} from '../vendor.js';
import { store, setHeadMetrics, setTimelineTotal, go, refreshData } from '../store.js';
import { isMobile } from '../store.js';
import { useChart } from '../chart.js';
import * as U from '../util.js';

/* 时间轴绘图区边距（grid 与 1:1 拖动换算共用一处，避免两边对不上） */
const TL_GRID = { left: 100, right: 20, top: 20, bottom: 30 };
/* 数据块的最小可见厚度（px）：6 秒的记录在 6 小时窗口里只有 0.1px，
   不撑一下就等于没画，「这台机器人跑过一次」这件事就看不见了 */
const MIN_BAR_PX = 4;
/* 甘特图数据块内文字字号 */
const BAR_FS = 15;
const MIN_SPAN = 10 * 60 * 1000;            // 窗口下限 10 分钟
const MAX_SPAN = 30 * 24 * 3600 * 1000;     // 窗口上限 30 天
const FEED_PAGE = 20;                        // 手机端每批记录条数

export default defineComponent({
  name: 'TimelineView',
  setup() {
    /* ---------------- 筛选与窗口状态 ---------------- */
    const totalOptions = [
      { value: 86400000, label: '1 天' },
      { value: 259200000, label: '3 天' },
      { value: 604800000, label: '1 周' },
      { value: 1209600000, label: '2 周' },
      { value: 2419200000, label: '4 周' }
    ];
    const spanOptions = [
      { value: 600000, label: '10 分钟' },
      { value: 1800000, label: '30 分钟' },
      { value: 3600000, label: '1 小时' },
      { value: 10800000, label: '3 小时' },
      { value: 21600000, label: '6 小时' },
      { value: 43200000, label: '12 小时' }
    ];
    const wayOptions = [
      { value: '__ALL__', label: '全部' },
      { value: 'Manual', label: '手动' },
      { value: 'TimingTrigger', label: '定时触发器' },
      { value: 'Webhook', label: 'Webhook' }
    ];

    /* 窄高窗口（宽<高）默认拉长时间窗：横向内容更舒展，靠拖动平移浏览 */
    const defSpan = window.innerWidth < window.innerHeight ? 6 * 3600 * 1000 : 3600000;

    const state = ref({
      span: defSpan, end: Date.now(), offset: 0, focusId: null,
      total: 24 * 3600 * 1000
    });
    setTimelineTotal(state.value.total);
    const waySel = ref('__ALL__');
    const showQueue = ref(false);
    const mobile = ref(isMobile());

    /* 数据边界（总长裁剪后） */
    let DATA_MIN = Infinity;
    let DATA_MAX = -Infinity;
    /* 最近一次渲染的数据项：custom series 取不到附加字段时按 dataIndex 回查 */
    let lastData = null;
    /* 当前悬浮的记录 id（表格行 → 甘特图高亮） */
    const hotRid = ref(null);
    let hoverTimer = 0;

    const records = computed(() => store.records);
    /* 当前窗口右边界（不会超过「现在」） */
    const nowW = computed(() => Math.min(state.value.end + state.value.offset, state.value.end));
    const winStart = computed(() => nowW.value - state.value.span);

    /* 数据范围下拉：窗口不能大于总长，选到比窗口小的范围时把窗口一起压下来 */
    const totalModel = computed({
      get: () => state.value.total,
      set: (v) => {
        state.value.total = v || state.value.total;
        setTimelineTotal(state.value.total);
        if (state.value.span > state.value.total) state.value.span = state.value.total;
        state.value.offset = 0;
        state.value.focusId = null;
        recomputeBounds();
        render();
        refreshData(false, 'range');   // 总长变了：补拉一次新范围的数据
      }
    });
    /* 窗口下拉：值不在预设里就留空（表示 Ctrl+滚轮缩出来的自定义窗口） */
    const spanModel = computed({
      get: () => {
        const hit = spanOptions.find((o) => o.value === Math.round(state.value.span));
        return hit ? hit.value : null;
      },
      set: (v) => {
        if (!v) return;
        state.value.span = v;
        state.value.offset = 0;
        state.value.focusId = null;
        render();
      }
    });

    /* ---------------- 图表实例 ---------------- */
    const chartEl = ref(null);
    const { chart, setOption, resize } = useChart(chartEl);

    /* 时间方向的绘图区像素长度（拖 100px 就走 100px 的时间） */
    function timeLenPx() {
      const len = (chartEl.value ? chartEl.value.clientWidth || 0 : 0) - TL_GRID.left - TL_GRID.right;
      return Math.max(50, len || 900);
    }

    function recomputeBounds() {
      DATA_MIN = Infinity; DATA_MAX = -Infinity;
      const nowT = Date.now();
      records.value.forEach((r) => {
        if (r.start < DATA_MIN) DATA_MIN = r.start;
        const e = r.end == null ? nowT : r.end;
        if (e > DATA_MAX) DATA_MAX = e;
      });
      /* 总长裁剪：只保留「数据范围」选定的最近一段数据（默认 1 天），
         更早的记录不进甘特图/滚动条范围（记录列表不受影响，仍看全量） */
      if (isFinite(DATA_MAX) && isFinite(DATA_MIN)) {
        const cutoff = DATA_MAX - (state.value.total || Infinity);
        if (DATA_MIN < cutoff) DATA_MIN = cutoff;
      }
    }

    /* 泳道用的机器人清单：两端都是横向布局，机器人是纵向泳道组，
       行序与时间流向无关，统一按名称排序 —— 行序稳定，鼠标记忆才好用 */
    function robotList(segs) {
      const arr = [];
      segs.forEach((s) => {
        const rb = s.r.robot;
        if (rb && rb !== '(未指定机器人)' && arr.indexOf(rb) < 0) arr.push(rb);
      });
      return arr.sort();
    }

    /* 记录 → 段（排队段 + 运行段） */
    function buildSegs() {
      const segs = [];
      records.value.forEach((r) => {
        const st = r.start;
        const exec = (r.execStart && r.execStart > st) ? r.execStart : null;
        if (exec && exec - st >= 60 * 1000) segs.push({ r, start: st, end: exec, kind: 'wait' });
        segs.push({ r, start: exec || st, end: r.end, kind: 'run' });
      });
      return segs;
    }
    const segColor = (s) => (s.kind === 'wait' ? 'rgba(55,138,221,0.6)' : U.statusColor(s.r));
    const effEnd = (s) => (s.end == null ? state.value.end : s.end);

    /* 泳道分配：同一机器人时间重叠的记录分到不同泳道（横着叠开，互不遮挡）。
       只按真实时间重叠判定 —— 与窗口大小无关，泳道数在任何缩放下都稳定。 */
    function layout(segs, robots) {
      const recs = [];
      const recOfSeg = {};
      const byRobot = {};
      segs.forEach((s, i) => {
        const rid = String(s.r.id);
        if (!(rid in recOfSeg)) {
          recOfSeg[rid] = recs.length;
          const u = { rid, robot: s.r.robot, start: s.start, end: effEnd(s), segIdxs: [] };
          recs.push(u);
          (byRobot[s.r.robot] = byRobot[s.r.robot] || []).push(recs.length - 1);
        }
        const u = recs[recOfSeg[rid]];
        u.segIdxs.push(i);
        if (s.start < u.start) u.start = s.start;
        const en = effEnd(s);
        if (en > u.end) u.end = en;
      });
      const info = {};
      const yLabels = [];
      const groupLastRows = [];
      let rowCursor = 0;
      robots.forEach((rb) => {
        const idxs = (byRobot[rb] || []).slice().sort((a, b) => recs[a].start - recs[b].start);
        const lanes = [];
        const laneOfRec = {};
        idxs.forEach((ri) => {
          const u = recs[ri], st = u.start, en = u.end;
          let lane = -1;
          for (let l = 0; l < lanes.length; l++) {
            if (st >= lanes[l].end || en <= lanes[l].start) { lane = l; break; }
          }
          if (lane < 0) { lane = lanes.length; lanes.push({ start: st, end: en }); }
          else {
            if (st < lanes[lane].start) lanes[lane].start = st;
            if (en > lanes[lane].end) lanes[lane].end = en;
          }
          laneOfRec[ri] = lane;
        });
        if (lanes.length === 0) lanes.push({ start: state.value.end, end: state.value.end });
        const base = rowCursor;
        rowCursor += lanes.length;
        idxs.forEach((ri) => {
          recs[ri].segIdxs.forEach((si) => { info[si] = { row: base + laneOfRec[ri] }; });
        });
        for (let r = base; r < rowCursor; r++) yLabels.push(r === base ? rb : '');
        groupLastRows.push(base + lanes.length - 1);
      });
      return { info, yLabels, groupLastRows, totalRows: rowCursor };
    }

    /* ---------------- 甘特图渲染 ---------------- */
    function render() {
      if (mobile.value || !chartEl.value) return;
      const st = state.value;
      const end = Math.min(st.end + st.offset, st.end);
      const start = end - st.span;

      let segs = buildSegs();
      if (waySel.value !== '__ALL__') segs = segs.filter((s) => s.r.way === waySel.value);
      if (!showQueue.value) segs = segs.filter((s) => s.kind !== 'wait');
      /* 总长裁剪：总长之外的旧记录不进泳道布局，也不出现在图里（列表仍显示全量） */
      const totalStart = st.end - st.total;
      segs = segs.filter((s) => effEnd(s) >= totalStart);

      const robots = robotList(segs);
      const visible = segs.filter((s) => effEnd(s) >= start && s.start <= end);
      /* 文字下限：屏幕上不足 MIN_BAR_PX 的记录仍会画（撑到最小可见厚度），
         但不值得再往上写应用名 —— 挤出来的几个像素只够表达「这里跑过一次」 */
      const minVisibleMs = st.span * (MIN_BAR_PX / timeLenPx());
      const lay = layout(visible, robots);

      /* 同一条记录可能拆成排队段 + 运行段：图上一个块要覆盖两段的总跨度 */
      const recMerge = {};
      visible.forEach((s) => {
        const rid = String(s.r.id);
        const m = recMerge[rid] || (recMerge[rid] = { min: Infinity, max: -Infinity });
        if (s.start < m.min) m.min = s.start;
        const en = effEnd(s);
        if (en > m.max) m.max = en;
      });

      const data = [];
      const textData = [];
      visible.forEach((s, i) => {
        const li = lay.info[i];
        const rid = String(s.r.id);
        const merge = recMerge[rid];
        if (s.kind === 'run') {
          data.push({
            value: [merge.min, merge.max, li.row, 0, 1, segColor(s), s.r.execStart || 0,
              s.end == null ? 0 : s.end],
            rid, name: s.r.name, app: s.r.app, robot: s.r.robot,
            status: s.r.status, kind: 'run', way: s.r.way, trigger: s.r.trigger,
            start: merge.min, end: merge.max, endRaw: s.end, execStart: s.r.execStart
          });
        }
        if (s.kind === 'run' && s.r.name && (merge.max - merge.min) >= minVisibleMs) {
          textData.push({ value: [0, li.row, s.r.name, merge.min, merge.max] });
        }
      });
      lastData = data;

      const sepData = [];
      const topGroupRow = lay.groupLastRows.length ? Math.max.apply(null, lay.groupLastRows) : -1;
      lay.groupLastRows.forEach((r) => { if (r !== topGroupRow) sepData.push({ value: [r] }); });

      /* 悬浮联动：当前有悬浮行时，只有它对应的块是「主角」，其余一律淡出。
         注意 hot 只对「窗口内可见」的记录有效 —— 悬浮的行可能因为时间窗口没包含它
         而不在图上，这时 hot 什么也匹配不到，图上维持原样（不会误淡出整幅）。 */
      let hot = hotRid.value;
      if (hot && !data.some((d) => d.rid === hot)) hot = null;

      /* 悬浮气泡：贴着目标块浮一行「应用名 · 时长」。
         块窄到没文字时（几秒的记录），这里是唯一的时长读数。 */
      const hoverData = [];
      if (hot) {
        const hit = data.find((d) => d.rid === hot);
        if (hit) {
          hoverData.push({
            value: [(hit.value[0] + hit.value[1]) / 2, hit.value[2], hit.name,
              hit.value[1] - hit.value[0]]
          });
        }
      }

      /* ---- 坐标工具（横向布局：时间在横轴、泳道在纵轴） ---- */
      const xy = (api, t, row) => api.coord([t, row]);
      const lenOf = (p0, p1) => Math.abs(p1[0] - p0[0]);
      const bandOf = (api) => api.size([0, 1])[1];
      function barOf(p0, p1, thick, style) {
        const a0 = Math.min(p0[0], p1[0]);
        const a1 = Math.max(p0[0], p1[0]);
        const len = a1 - a0;
        const c = p0[1];
        const r = Math.min(3, len / 2, thick / 2);
        return { type: 'rect', shape: { x: a0, y: c - thick / 2, width: len, height: thick, r }, style };
      }
      /* 极短记录以「真实位置为中心」撑到 MIN_BAR_PX，保证「跑过一次」看得见；
         它只影响画出来的宽度，不影响任何时间换算 */
      function stretch(p0, p1) {
        const px = lenOf(p0, p1);
        if (px >= MIN_BAR_PX) return [p0, p1];
        const mid = (p0[0] + p1[0]) / 2;
        const half = MIN_BAR_PX / 2;
        return [[mid - half, p0[1]], [mid + half, p1[1]]];
      }

      const canvasW = chartEl.value ? chartEl.value.clientWidth : 900;
      const canvasH = chartEl.value ? chartEl.value.clientHeight : 400;

      setOption({
        backgroundColor: 'transparent',
        animation: false,
        tooltip: U.tipOpt({
          trigger: 'item',
          formatter(p) {
            const d = p.data;
            const stName = U.STATUS_CN[d.status] || d.status || '已完成';
            const stColor = U.statusColor({ status: d.status, app: d.app });
            let s = '<b>' + U.esc(d.name) + '</b>'
              + '<br/>机器人：' + U.esc(d.robot)
              + (d.way && d.way !== 'Manual' && d.trigger ? '<br/>触发器：' + U.esc(d.trigger) : '')
              + '<br/>触发方式：' + U.esc(U.wayOf({ way: d.way }))
              + '<br/>状态：<span style="color:' + stColor + '">' + U.esc(stName) + '</span>';
            const runFrom = (d.execStart && d.execStart > d.start) ? d.execStart : d.start;
            if (d.execStart && d.execStart > d.start) {
              s += '<br/>排队：' + U.fmtTime(d.start) + ' ~ ' + U.fmtTime(d.execStart)
                + '（' + U.fmtDur(d.execStart - d.start) + '）';
            }
            s += '<br/>' + U.fmtTime(d.start) + ' ~ ' + (d.endRaw == null ? '（进行中）' : U.fmtTime(d.end));
            if (d.endRaw != null) s += '（运行 ' + U.fmtDur(d.end - runFrom) + '）';
            if (d.execStart && d.execStart > d.start) s += '<br/>开始运行：' + U.fmtTime(d.execStart);
            return s;
          }
        }),
        grid: TL_GRID,
        xAxis: {
          type: 'time', min: end - st.span, max: end,
          axisLabel: {
            color: '#8b8f98', fontSize: 11, hideOverlap: true,
            formatter: (v) => U.fmtTime(v)
          },
          axisLine: { lineStyle: { color: '#333' } },
          splitLine: { show: true, lineStyle: { color: '#20242c' } }
        },
        yAxis: {
          type: 'category', data: lay.yLabels,
          axisLabel: { color: '#c9cdd4', fontSize: 12, width: 95, overflow: 'truncate' },
          axisLine: { lineStyle: { color: '#333' } },
          splitLine: { show: true, lineStyle: { color: '#20242c' } }
        },
        series: [{
          type: 'custom', data, zlevel: 1,
          renderItem(params, api) {
            const row = api.value(2);
            const winA = end - st.span;
            const vs = Math.max(api.value(0), winA);
            const ve = Math.min(api.value(1), end);
            if (ve <= vs) return null;
            const band = bandOf(api);
            const children = [];
            const bh = Math.max(10, band - 4);
            const exec = api.value(6);
            const hasWait = exec && exec > api.value(0);
            /* 本块是不是被悬浮行点中的那条：是则原样（并加金色描边），
               否则在「有悬浮」时淡出到 18%。用 dataIndex 回查而不是读附加字段 ——
               custom series 不保证保留 rid。 */
            let isHot = false;
            if (hot) {
              const di = (typeof params.dataIndex === 'number') ? lastData[params.dataIndex] : null;
              isHot = !!(di && di.rid === hot);
            }
            const dim = !!hot && !isHot;
            const dimA = dim ? 0.18 : 1;
            if (hasWait && showQueue.value) {
              const q0 = Math.max(api.value(0), winA), q1 = Math.min(exec, end);
              if (q1 > q0) {
                /* 排队段不撑最小厚度：它只是运行块前面的一小截蓝头，
                   当前缩放级别看不见就说明「排队时间短到无关紧要」 */
                const pq0 = xy(api, q0, row), pq1 = xy(api, q1, row);
                if (lenOf(pq0, pq1) >= 1) {
                  children.push(barOf(pq0, pq1, bh, { fill: U.WAIT_FILL, opacity: dimA }));
                }
              }
            }
            const rs = hasWait ? exec : api.value(0);
            const r0 = Math.max(rs, winA), r1 = Math.min(api.value(1), end);
            if (r1 > r0) {
              const s2 = stretch(xy(api, r0, row), xy(api, r1, row));
              /* 用 value(5)（构造时由 segColor 算好的状态色）派生渐变：
                 不要在 renderItem 里读 params.data.status —— custom series
                 不保证保留附加字段，取不到就会全落到兜底色（全变绿）。 */
              children.push(barOf(s2[0], s2[1], bh, {
                fill: U.shadeGrad(api.value(5), 'v', .07, .09), opacity: dimA
              }));
            }
            const stv = stretch(xy(api, vs, row), xy(api, ve, row));
            if (lenOf(stv[0], stv[1]) >= 1) {
              if (isHot) {
                const e0 = stv[0], e1 = stv[1];
                children.push(barOf([e0[0] - 2, e0[1]], [e1[0] + 2, e1[1]], bh + 6, {
                  fill: 'rgba(255,209,102,0.14)', stroke: '#ffd166', lineWidth: 2
                }));
              } else {
                children.push(barOf(stv[0], stv[1], bh, {
                  fill: 'rgba(0,0,0,0)', stroke: 'rgba(255, 255, 255, 0.5)',
                  lineWidth: 1.5, cursor: 'pointer', opacity: dimA
                }));
              }
            }
            if (!children.length) return null;
            return children.length === 1 ? children[0] : { type: 'group', children };
          },
          markLine: {
            silent: true, symbol: 'none', lineStyle: { color: '#E24B4A', width: 2 },
            label: {
              show: true, formatter: '现在', color: '#E24B4A', fontSize: 10,
              position: 'insideEndTop'
            },
            data: [{ xAxis: st.end }]
          }
        }, {
          /* 数据块内的应用名：单行、居中、放不下截断加 "..."、少于 8 字不显示 */
          type: 'custom', data: textData, zlevel: 2, silent: true,
          renderItem(params, api) {
            let raw = String(api.value(2) || '');
            if (!raw) return null;
            const us = raw.indexOf('_');
            if (us >= 0) raw = raw.slice(us + 1);
            const mStart = api.value(3);
            const mEnd = api.value(4) == null ? end : api.value(4);
            const vStart = Math.max(mStart, end - st.span);
            const vEnd = Math.min(mEnd, end);
            if (vEnd <= vStart) return null;
            const vc = (vStart + vEnd) / 2;
            const pc = xy(api, vc, api.value(1));
            const avail = lenOf(xy(api, vStart, api.value(1)), xy(api, vEnd, api.value(1)));
            const label = U.truncateLabel(raw, Math.max(2, avail - 4), BAR_FS);
            if (!label || label.length < 8) return null;
            return {
              type: 'text', style: {
                text: label, x: pc[0], y: pc[1], textAlign: 'center',
                textVerticalAlign: 'middle', fill: '#10141a', fontSize: BAR_FS,
                fontWeight: 500, fontFamily: U.FONT_STACK
              }
            };
          }
        }, {
          /* 机器人分组之间的白色虚线（横轴布局下画横线，每组的底边） */
          type: 'custom', data: sepData, zlevel: 1, silent: true,
          renderItem(params, api) {
            const row = api.value(0);
            const band = bandOf(api);
            const c0 = xy(api, end - st.span, row);
            const c1 = xy(api, end, row);
            const lo = Math.min(c0[0], c1[0]);
            const hi = Math.max(c0[0], c1[0]);
            return {
              type: 'line', shape: { x1: lo, y1: c0[1] - band / 2, x2: hi, y2: c0[1] - band / 2 },
              style: { stroke: 'rgba(255,255,255,0.65)', lineWidth: 1.5, lineDash: [6, 4] }
            };
          }
        }, {
          /* 悬浮气泡（zlevel 3 = 盖在数据块与文字之上） */
          type: 'custom', data: hoverData, zlevel: 3, silent: true,
          renderItem(params, api) {
            const t = api.value(0);
            const row = api.value(1);
            const nm = String(api.value(2) || '');
            const durMs = api.value(3);
            /* 目标块的中心：必须用 row 这个真实泳道，不能写死 0 */
            const center = xy(api, t, row);
            const band = bandOf(api);
            const durTxt = U.fmtDurShort(durMs);
            const fs = 11;
            const padX = 7, bh2 = 19;
            const label = nm ? U.truncateLabel(nm, 150, fs) : '';
            let text = label ? (label + ' · ' + durTxt) : durTxt;
            let w = U.measureW(text, fs) + padX * 2;
            if (w > 260) { text = durTxt; w = U.measureW(text, fs) + padX * 2; }
            /* 气泡贴着目标块上沿浮：① 一眼看清是哪一块；② 贴画布顶会被裁掉 */
            const blockTop = center[1] - band / 2;
            let cy = blockTop - bh2 / 2 - 6;
            if (cy - bh2 / 2 < 1) cy = center[1] + band / 2 + bh2 / 2 + 6;
            cy = Math.max(bh2 / 2 + 1, Math.min(canvasH - bh2 / 2 - 1, cy));
            const cx = Math.max(TL_GRID.left + w / 2,
              Math.min(canvasW - TL_GRID.right - w / 2, center[0]));
            return {
              type: 'group', children: [{
                type: 'rect',
                shape: { x: cx - w / 2, y: cy - bh2 / 2, width: w, height: bh2, r: bh2 / 2 },
                style: { fill: 'rgba(255,209,102,0.95)', stroke: 'rgba(255,255,255,0.35)', lineWidth: 1 }
              }, {
                type: 'text',
                style: {
                  text, x: cx, y: cy, textAlign: 'center', textVerticalAlign: 'middle',
                  fill: '#1a1206', fontSize: fs, fontWeight: 600, fontFamily: U.FONT_STACK
                }
              }]
            };
          }
        }]
      });

      /* 指标卡：窗口内可见记录按触发方式计数（同一记录排队+运行两段去重）+ 泳道机器人数 */
      const wayRecs = { Manual: 0, TimingTrigger: 0, Webhook: 0 };
      const seen = {};
      visible.forEach((s) => {
        const wk = s.r.id + '_' + s.r.way;
        if (!seen[wk] && wayRecs[s.r.way] != null) { seen[wk] = 1; wayRecs[s.r.way]++; }
      });
      setHeadMetrics([
        { k: 'Webhook 记录', v: wayRecs.Webhook || 0, color: '#D85A30' },
        { k: '手动记录', v: wayRecs.Manual || 0, color: '#1D9E75' },
        { k: '定时触发记录', v: wayRecs.TimingTrigger || 0, color: '#7F77DD' },
        { k: '机器人', v: robots.length, color: '#378ADD' }
      ]);
      nextTick(syncScroll);
    }

    /* 手机端指标：按全部记录统计（没有时间窗口这个概念） */
    function metricsFromAll() {
      const wayRecs = { Manual: 0, TimingTrigger: 0, Webhook: 0 };
      const rb = {};
      records.value.forEach((r) => {
        if (wayRecs[r.way] != null) wayRecs[r.way]++;
        if (r.robot && r.robot !== '(未指定机器人)') rb[r.robot] = 1;
      });
      setHeadMetrics([
        { k: 'Webhook 记录', v: wayRecs.Webhook || 0, color: '#D85A30' },
        { k: '手动记录', v: wayRecs.Manual || 0, color: '#1D9E75' },
        { k: '定时触发记录', v: wayRecs.TimingTrigger || 0, color: '#7F77DD' },
        { k: '机器人', v: Object.keys(rb).length, color: '#378ADD' }
      ]);
    }

    /* ---------------- 窗口信息 + 底部滚动条 ---------------- */
    const spanInfo = computed(() => {
      const end = nowW.value;
      return '窗口 ' + U.fmtSpanLabel(state.value.span) + '：' +
        U.fmtTime(end - state.value.span) + ' ~ ' + U.fmtTime(end);
    });
    const trackEl = ref(null);
    const winEl = ref(null);
    const winStyle = ref({ display: 'none', width: '0px', left: '0px' });

    function syncScroll() {
      const total = state.value.end - DATA_MIN;
      if (!(total > 0)) { winStyle.value = { display: 'none' }; return; }
      const tW = (trackEl.value ? trackEl.value.clientWidth : 0) || 1;
      /* 视觉下限：窗口再小也按 6 小时对应的宽度画，否则窄到点不中；
         真实窗口大小不受影响，位置换算始终按 msPerPx 走 */
      const minW = 6 * 3600 * 1000 / total * tW;
      const w = Math.max(minW, Math.min(tW, state.value.span / total * tW));
      const frac = (nowW.value - DATA_MIN) / total;
      const left = Math.max(0, Math.min(tW - w, frac * tW - w));
      winStyle.value = { display: 'block', width: w + 'px', left: left + 'px' };
    }

    /* ---------------- 平移与缩放 ---------------- */
    function clampOffset(o) { return Math.max(DATA_MIN - state.value.end, Math.min(0, o)); }
    function panTo(left) {
      const st = state.value;
      let hi = st.end - st.span;               // 右边缘贴「现在」时左边界的位置
      if (hi < DATA_MIN) hi = DATA_MIN;        // 窗口比数据跨度还长：贴着最早数据
      left = Math.max(DATA_MIN, Math.min(hi, left));
      st.offset = clampOffset(left + st.span - st.end);
      st.focusId = null;
      render();
    }
    function zoomAt(clientX, deltaY) {
      const el = chartEl.value;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      /* 锚点比例按「绘图区内」算（减掉左右留白），不然边距会让锚点偏掉 */
      let frac = (clientX - rect.left - TL_GRID.left) / Math.max(1, rect.width - TL_GRID.left - TL_GRID.right);
      frac = Math.max(0, Math.min(1, frac));
      const anchor = nowW.value - state.value.span + frac * state.value.span;
      const span = state.value.span * (deltaY > 0 ? 1.15 : 1 / 1.15);
      state.value.span = Math.max(MIN_SPAN, Math.min(MAX_SPAN, span));
      panTo(anchor - frac * state.value.span);
    }

    /* ---------------- 图表交互绑定 ---------------- */
    let pan = null;
    let panMoved = false;
    let panRaf = 0;
    let slider = null;

    function onWheel(e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { zoomAt(e.clientX, e.deltaY); return; }
      panTo(nowW.value - state.value.span + e.deltaY * (state.value.span / 600));
    }
    function onPointerDown(e) {
      if (e.button !== 0) return;
      pan = { start: e.clientX, last: e.clientX, left: nowW.value - state.value.span };
      panMoved = false;
      if (chartEl.value) chartEl.value.classList.add('tl-pan');
    }
    function applyPan() {
      panRaf = 0;
      if (!pan) return;
      /* 1:1 跟手：整幅「时间长度」对应整个窗口宽度，拖 N 像素就走 N 像素的时间 */
      const dMs = (pan.last - pan.start) * (state.value.span / timeLenPx());
      panTo(pan.left - dMs);
    }
    function onPointerMove(e) {
      if (slider) {
        /* 拖底部滚动条滑块：只平移窗口，不缩放 */
        const msPerPx = (state.value.end - DATA_MIN) / ((trackEl.value ? trackEl.value.clientWidth : 1) || 1);
        panTo(slider.left + (e.clientX - slider.x) * msPerPx);
        return;
      }
      if (!pan) return;
      pan.last = e.clientX;
      if (Math.abs(e.clientX - pan.start) > 3) panMoved = true;
      if (panRaf) return;
      panRaf = requestAnimationFrame(applyPan);
    }
    function onPointerUp() {
      if (pan) { pan = null; if (chartEl.value) chartEl.value.classList.remove('tl-pan'); }
      slider = null;
    }
    function onDblClick() {
      state.value.offset = 0;
      const v = spanModel.value;               // 自定义窗口（下拉留空）时保持当前 span
      if (v > 0) state.value.span = v;
      state.value.focusId = null;
      render();
    }
    function onTrackDown(e) {
      if (e.target !== trackEl.value) return;
      const rect = trackEl.value.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
      const center = DATA_MIN + frac * (state.value.end - DATA_MIN);
      panTo(center - state.value.span / 2);
    }
    function onWinDown(e) {
      slider = { x: e.clientX, left: nowW.value - state.value.span };
      e.preventDefault();
      e.stopPropagation();
    }

    /* ---------------- 记录表（桌面） ---------------- */
    /* 记录排序：结束时间倒序（最新跑完的在最上面），还没结束的（在跑）永远置顶 */
    function sortByEndDesc(a, b) {
      const ae = (a.end == null) ? Infinity : a.end;
      const be = (b.end == null) ? Infinity : b.end;
      if (ae !== be) return be - ae;
      return b.start - a.start;
    }
    const winRows = computed(() => {
      const s = winStart.value, e = nowW.value;
      return records.value.filter((r) => {
        const en = r.end == null ? state.value.end : r.end;
        return en >= s && r.start <= e;
      }).sort((a, b) => b.start - a.start);
    });
    const tableRows = computed(() => winRows.value.slice(0, 120));
    const listInfo = computed(() => '窗口内 ' + winRows.value.length + ' 条 · 共 ' + records.value.length + ' 条');

    function setHover(rid) {
      const v = rid ? String(rid) : null;
      if (v === hotRid.value) return;
      hotRid.value = v;
      clearTimeout(hoverTimer);
      /* 悬浮切换用一帧节流：快速划过整列行时不必每行都重画一次图 */
      hoverTimer = setTimeout(() => { hoverTimer = 0; render(); }, 16);
    }
    function openRec(rid) {
      if (!rid) return;
      state.value.focusId = String(rid);
      go('detail', { id: rid });
    }
    const rowClass = ({ row }) => {
      const cls = [];
      if (String(row.id) === String(state.value.focusId)) cls.push('tl-row-on');
      if (String(row.id) === String(hotRid.value)) cls.push('tl-row-hot');
      return cls.join(' ');
    };
    const durOf = (r) => (r.end == null ? state.value.end : r.end) - r.start;

    /* ---------------- 手机端记录流 ---------------- */
    const feed = ref({ n: FEED_PAGE, pending: 0 });
    const feedAll = computed(() => records.value.slice().sort(sortByEndDesc));
    const feedShown = computed(() => feedAll.value.slice(0, feed.value.n));
    const feedMaxDur = computed(() => {
      let max = 1;
      feedShown.value.forEach((r) => {
        const d = (r.end == null ? Date.now() : r.end) - r.start;
        if (d > max) max = d;
      });
      return max;
    });
    const feedInfo = computed(() => '已显示 ' + Math.min(feed.value.n, feedAll.value.length) +
      ' / ' + feedAll.value.length + ' 条');
    const listTip = computed(() => mobile.value
      ? '按结束时间排序 · 下拉加载更多'
      : '点击某行进入该条记录的日志详情 · 悬浮可高亮图中对应数据块');
    /* 日期分隔条：跨天时插一条「10-10」，长列表里定位「哪天」靠它 */
    const feedItems = computed(() => {
      const out = [];
      let lastDay = null;
      feedShown.value.forEach((r, i) => {
        const d = new Date(r.start);
        const dayKey = (d.getMonth() + 1) + '-' + U.pad(d.getDate());
        if (dayKey !== lastDay) { lastDay = dayKey; out.push({ day: dayKey }); }
        out.push({ rec: r, idx: i + 1, maxDur: feedMaxDur.value });
      });
      return out;
    });
    const feedEnd = ref(null);
    let io = null;
    function observeFeed() {
      if (io) { io.disconnect(); io = null; }
      if (!feedEnd.value || !window.IntersectionObserver) return;
      io = new IntersectionObserver((ents) => {
        for (const ent of ents) {
          if (ent.isIntersecting && feed.value.n < records.value.length) {
            feed.value.n += FEED_PAGE;
            nextTick(observeFeed);     // 哨兵被换掉了，重新观察新的
            break;
          }
        }
      }, { root: null, rootMargin: '300px' });
      io.observe(feedEnd.value);
    }
    /* 数据刷新后：在顶部就直接换，滚下去了只浮药丸、DOM 一律不动 */
    function feedSync() {
      const all = feedAll.value;
      const sig = Math.min(feed.value.n, all.length) + '|' +
        all.slice(0, feed.value.n).map((r) => r.id).join(',');
      if (sig === feedSig) return;
      const atTop = (window.scrollY || document.documentElement.scrollTop || 0) < 80;
      if (atTop || !feedSig) { feedSig = sig; return; }
      const shownIds = feedSig.split('|')[1] ? feedSig.split('|')[1].split(',') : [];
      const newTop = all.slice(0, feed.value.n).map((r) => String(r.id));
      let added = 0;
      for (let i = 0; i < newTop.length; i++) {
        if (shownIds.indexOf(newTop[i]) < 0) added++; else break;
      }
      feed.value.pending = added || 1;
      feedSig = sig;   // 记录新签名：药丸不再重复累加
    }
    let feedSig = '';
    function feedToTop() {
      feed.value.pending = 0;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    /* 「进行中」的时长每 5 秒走一格：只改那几行的文本，不重排 DOM */
    const feedTick = ref(0);
    function onFeedTick() { feedTick.value = Date.now(); }

    /* ---------------- 生命周期 ---------------- */
    function bindChart() {
      const el = chartEl.value;
      if (!el) return;
      el.addEventListener('wheel', onWheel, { passive: false });
      el.addEventListener('pointerdown', onPointerDown);
      el.addEventListener('dblclick', onDblClick);
      /* 图表点击 → 详情。刚拖完这一下不算点击（否则平移结束会误跳详情） */
      chart.value && chart.value.on('click', (params) => {
        if (panMoved) { panMoved = false; return; }
        if (!params || params.seriesIndex !== 0) return;
        let rid = (params.data && params.data.rid) || null;
        if (!rid && lastData && typeof params.dataIndex === 'number') {
          const it = lastData[params.dataIndex];
          if (it) rid = it.rid;
        }
        if (rid) go('detail', { id: rid });
      });
    }

    onMounted(() => {
      records.value.length && recomputeBounds();
      nextTick(() => {
        if (mobile.value) {
          metricsFromAll();
          observeFeed();
        } else {
          bindChart();
          render();
        }
      });
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
      window.addEventListener('rpa:timeline-tick', onTimelineTick);
      window.addEventListener('rpa:feed-tick', onFeedTick);
      window.addEventListener('rpa:resize', onResize);
    });
    onBeforeUnmount(() => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('rpa:timeline-tick', onTimelineTick);
      window.removeEventListener('rpa:feed-tick', onFeedTick);
      window.removeEventListener('rpa:resize', onResize);
      if (io) io.disconnect();
      clearTimeout(hoverTimer);
      setHeadMetrics([]);
    });

    function onTimelineTick() {
      state.value.end = Date.now();
      render();
    }
    /* 断点互切（横竖屏翻转 / 拖窗口）：手机端根本没有图表实例，
       所以整块换布局 —— 手机 → 桌面要补建 ECharts，桌面 → 手机要把它拆掉 */
    function onResize() {
      const mob = isMobile();
      if (mob !== mobile.value) {
        mobile.value = mob;
        feed.value.n = FEED_PAGE;
        feedSig = '';
        nextTick(() => {
          if (mob) { metricsFromAll(); observeFeed(); }
          else { bindChart(); resize(); render(); }
        });
        return;
      }
      if (!mob) resize();
      else nextTick(observeFeed);
    }

    /* 数据变化：桌面重画甘特图；手机端按「有无变化」决定重排还是只浮药丸 */
    watch(() => store.records, () => {
      recomputeBounds();
      if (mobile.value) { feedSync(); metricsFromAll(); }
      else render();
    });
    /* 筛选条件变化（触发方式 / 显示排队）同样要重画甘特图 */
    watch([waySel, showQueue], () => { if (!mobile.value) render(); });

    return {
      store, state, mobile, waySel, showQueue, totalOptions, spanOptions, wayOptions,
      totalModel, spanModel, spanInfo, tableRows, winRows, listInfo, listTip,
      rowClass, openRec, setHover, durOf,
      chartEl, trackEl, winEl, winStyle, syncScroll, onTrackDown, onWinDown,
      feed, feedItems, feedInfo, feedEnd, feedToTop, feedTick, onFeedTick,
      feedShown, feedAll,
      U, isMobile
    };
  },
  template: `
<div class="rpa-view">
  <!-- ==================== 甘特图卡片（手机端整块隐藏：没有图，筛选也就失去对象） ==================== -->
  <div class="rpa-card tl-top">
    <div class="tl-chart-head">
      <span style="font-size:12px;color:var(--rpa-dim);">数据范围</span>
      <el-select v-model="totalModel" style="width:96px" size="small"
                 title="总共显示多久的数据（甘特图泳道与底部滚动条的范围）">
        <el-option v-for="o in totalOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <span style="font-size:12px;color:var(--rpa-dim);">时间窗口</span>
      <el-select v-model="spanModel" style="width:104px" size="small" clearable
                 placeholder="自定义" title="窗口预设；Ctrl+滚轮可调任意大小">
        <el-option v-for="o in spanOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <span style="font-size:12px;color:var(--rpa-dim);">触发方式</span>
      <el-select v-model="waySel" style="width:120px" size="small" @change="() => {}">
        <el-option v-for="o in wayOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <span style="font-size:12px;color:var(--rpa-dim);">显示排队</span>
      <el-switch v-model="showQueue" size="small"
                 title="开启时显示蓝色排队中块，关闭时不显示" />
      <span class="rpa-spacer" style="margin-left:auto;"></span>
      <span class="tl-span-info">{{ spanInfo }}</span>
    </div>

    <!-- 直接在图区拖动平移时间轴（1:1 跟手），Ctrl+滚轮缩放窗口，双击回到实时视图 -->
    <div ref="chartEl" class="tl-chart"></div>

    <!-- 窗口位置指示条：滑块宽度跟随窗口长度，拖滑块（或点轨道）可平移；长度不可拖 -->
    <div class="tl-scroll">
      <div class="tl-scroll-track" ref="trackEl" @pointerdown="onTrackDown">
        <div class="tl-scroll-win" ref="winEl" :style="winStyle"
             title="拖动平移时间轴" @pointerdown="onWinDown"></div>
      </div>
    </div>

    <div class="tl-legend" style="margin-top:8px;">
      <span><i style="background:rgba(29,158,117,0.6)"></i>已完成</span>
      <span><i style="background:rgba(239,159,39,0.6)"></i>运行中</span>
      <span v-show="showQueue"><i style="background:rgba(55,138,221,0.6)"></i>排队中</span>
      <span><i style="background:rgba(226,75,74,0.6)"></i>失败</span>
      <span><i style="background:rgba(95,94,90,0.6)"></i>已停止</span>
    </div>
  </div>

  <!-- ==================== 运行记录 ==================== -->
  <div class="rpa-card tl-bottom">
    <div class="rpa-card-head">
      <h2 class="rpa-card-title">运行记录</h2>
      <span style="font-size:11.5px;color:var(--rpa-dim);">
        {{ mobile ? feedInfo : listInfo }}
      </span>
      <span class="rpa-spacer"></span>
      <span style="font-size:11.5px;color:var(--rpa-dim);">{{ listTip }}</span>
    </div>

    <div class="rpa-scroll">
      <!-- 桌面：六列表格，悬浮行点亮甘特图对应数据块 -->
      <el-table v-if="!mobile" :data="tableRows" height="100%" size="small"
                :row-class-name="rowClass" @row-click="(r) => openRec(r.id)"
                @cell-mouse-enter="(r) => setHover(r.id)"
                @cell-mouse-leave="() => setHover(null)"
                empty-text="当前时间窗口内没有记录">
        <el-table-column prop="robot" label="机器人" min-width="130" show-overflow-tooltip />
        <el-table-column label="应用" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.name || row.app || '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="92">
          <template #default="{ row }">
            <el-tag size="small" :type="U.statusTagType(row.status)" effect="dark">
              {{ U.statusCN(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="开始" width="118" class-name="num">
          <template #default="{ row }">{{ U.fmtTime(row.start) }}</template>
        </el-table-column>
        <el-table-column label="结束" width="118" class-name="num">
          <template #default="{ row }">
            {{ row.end == null ? '进行中' : U.fmtTime(row.end) }}
          </template>
        </el-table-column>
        <el-table-column label="用时" width="104" class-name="num">
          <template #default="{ row }">{{ U.fmtDur(durOf(row)) }}</template>
        </el-table-column>
      </el-table>

      <!-- 手机端：记录流（按结束时间倒序，滚到底自动续批） -->
      <div v-else class="tl-feed">
        <template v-for="(it, i) in feedItems" :key="it.day || it.rec.id">
          <div v-if="it.day" class="tl-feed-day">{{ it.day }}</div>
          <div v-else class="tl-item"
               :class="{ live: it.rec.end == null, on: String(it.rec.id) === String(state.focusId) }"
               @click="openRec(it.rec.id)">
            <div class="tl-item-top">
              <span class="tl-item-idx">{{ it.idx }}</span>
              <span class="tl-item-name">{{ it.rec.name || it.rec.app || '—' }}</span>
              <span class="tl-item-dur" :style="{ color: U.statusColorSolid(it.rec) }">
                {{ U.fmtDurShort((it.rec.end == null ? feedTick || Date.now() : it.rec.end) - it.rec.start) }}
              </span>
            </div>
            <div class="tl-item-mid">
              <span>{{ U.robotShortName(it.rec.robot) }}</span>
              <el-tag size="small" :type="U.statusTagType(it.rec.status)" effect="dark">
                {{ U.statusCN(it.rec.status) }}
              </el-tag>
              <span class="num">
                {{ U.hms(it.rec.start) }} ~ {{ it.rec.end == null ? '进行中' : U.hms(it.rec.end) }}
                <template v-if="it.rec.execStart && it.rec.execStart - it.rec.start > 1000">
                  · 排队 {{ U.fmtDurShort(it.rec.execStart - it.rec.start) }}
                </template>
              </span>
            </div>
            <div class="tl-item-bar">
              <i :style="{
                width: Math.max(2, Math.round(((it.rec.end == null ? Date.now() : it.rec.end) - it.rec.start) / it.maxDur * 100)) + '%',
                background: U.statusColorSolid(it.rec)
              }"></i>
            </div>
          </div>
        </template>
        <div class="tl-feed-end" ref="feedEnd">
          {{ feedShown.length < feedAll.length ? '向下滚动加载更多…' : '已到底 · 共 ' + feedAll.length + ' 条' }}
        </div>
      </div>
    </div>

    <!-- 有更新但用户已经滚下去了，浮这个小药丸提示（不重排列表、不顶掉视线） -->
    <el-button v-if="mobile && feed.pending" type="primary" round size="small"
               style="position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1500;"
               @click="feedToTop">
      ↑ {{ feed.pending }} 条新记录
    </el-button>
  </div>
</div>
`
});
