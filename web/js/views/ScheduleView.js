/* ============================================================================
 * ScheduleView.js —— 触发器排期（周视图 / 月视图日历表）
 *
 * 版式：真表格 —— 行 = 执行时刻，列 = 周几（每周视图）/ 当月有任务的日期（每月视图），
 * 格子里直接列出该时刻要跑的应用标签。
 *   - 悬停某个应用标签 → 点亮全表同一应用的全部标签（其余淡出）
 *   - 点击标签 → 项目控制台并打开该项目的「运行记录」tab
 *   - 红色虚线 = 当前时刻（按「时刻」列中心线线性插值定位），红底列 = 今天
 *   - 「导出 Excel」按当前筛选条件请后端生成 xlsx（含排期日历 / 明细 / 触发器汇总三张表）
 *
 * 为什么不用 ECharts 甘特图：行高固定不再互相压、应用名完整可读、标签可点。
 * ========================================================================= */
import { defineComponent, ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from '../vendor.js';
import { store, loadSchedule, go, setHeadMetrics } from '../store.js';
import { shell } from '../shell.js';
import { api, download } from '../api.js';
import * as U from '../util.js';

const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export default defineComponent({
  name: 'ScheduleView',
  setup() {
    const view = ref('week');
    const robot = ref('__ALL__');
    const status = ref('enabled');
    const exporting = ref(false);
    const hotApp = ref(null);
    const wrapEl = ref(null);
    const nowLine = ref(null);

    const sched = computed(() => store.schedule);
    const monthLabels = computed(() => (sched.value && sched.value.monthLabels) || []);
    const xLabels = computed(() => (view.value === 'month' ? monthLabels.value : WEEK_LABELS));
    const robots = computed(() => ((sched.value && sched.value.robots) || []).slice().sort());

    const robotOptions = computed(() => [
      { value: '__ALL__', label: '全部机器人' },
      { value: '__SUXI__', label: '所有硕晞' },
      { value: '__BAOSHI__', label: '所有宝实' }
    ].concat(robots.value.map((r) => ({ value: r, label: r }))));

    const statusOptions = [
      { value: 'enabled', label: '已启用' },
      { value: 'disabled', label: '已停用' },
      { value: '__ALL__', label: '全部状态' }
    ];

    /* 机器人筛选：支持「所有硕晞 / 所有宝实」这类前缀分组 */
    function matchRobot(r, filter) {
      if (filter === '__ALL__') return true;
      if (filter === '__SUXI__') return r.indexOf('硕晞') >= 0;
      if (filter === '__BAOSHI__') return r.indexOf('宝实') >= 0;
      return r === filter;
    }
    function timeText(t) {
      const hh = Math.floor(t), mm = Math.round((t - hh) * 60);
      return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    }

    /* 当前筛选下的排期点；xi = 列下标（周几，或日期在 monthLabels 里的位置） */
    function buildPoints() {
      const s = sched.value;
      if (!s || !s.ok) return [];
      const pts = [];
      const src = view.value === 'week' ? s.week : s.month;
      Object.keys(src || {}).forEach((r) => {
        if (!matchRobot(r, robot.value)) return;
        Object.keys(src[r]).forEach((k) => {
          const xi = view.value === 'week' ? +k : monthLabels.value.indexOf(k + '日');
          if (xi < 0) return;
          src[r][k].forEach((p) => {
            if (status.value === 'enabled' && !p.enabled) return;
            if (status.value === 'disabled' && p.enabled) return;
            pts.push({
              xi, t: p.t, hm: p.hm || timeText(p.t), app: p.app, short: p.short,
              color: p.color, fid: p.fid || '', enabled: p.enabled, robot: r
            });
          });
        });
      });
      return pts;
    }

    /* 聚合成 rows：时刻 -> { cells: {列下标: [应用标签…]} }；同一格子内同应用只出一个 */
    const table = computed(() => {
      const pts = buildPoints();
      const cellMap = {};
      pts.forEach((p) => {
        const row = cellMap[p.t] || (cellMap[p.t] = {});
        const cell = row[p.xi] || (row[p.xi] = []);
        let hit = null;
        for (let i = 0; i < cell.length; i++) {
          if (cell[i].app === p.app) { hit = cell[i]; break; }
        }
        if (hit) {
          if (hit.robots.indexOf(p.robot) < 0) hit.robots.push(p.robot);
          /* 同一应用既有启用又有停用排期时，按启用那套颜色显示（与原图表口径一致） */
          if (p.enabled && !hit.enabled) { hit.enabled = true; hit.color = p.color; }
          if (!hit.fid && p.fid) hit.fid = p.fid;
        } else {
          cell.push({
            app: p.app, short: p.short, color: p.color, fid: p.fid,
            enabled: p.enabled, robots: [p.robot]
          });
        }
      });
      const times = Object.keys(cellMap).map(Number).sort((a, b) => a - b);
      const rows = times.map((t) => ({
        t, hm: timeText(t),
        cells: xLabels.value.map((_, i) => {
          const cell = cellMap[t][i];
          if (!cell || !cell.length) return [];
          return cell.slice().sort((a, b) => a.app.localeCompare(b.app, 'zh'));
        })
      }));
      return { rows, points: pts.length, times: times.length };
    });

    /* 今天所在列：每周视图取当天周几，每月视图取当天日期在 monthLabels 里的位置 */
    const todayCol = computed(() => {
      if (view.value === 'month') return monthLabels.value.indexOf(new Date().getDate() + '日');
      return (new Date().getDay() + 6) % 7;
    });

    const info = computed(() => {
      const s = sched.value;
      if (!s || !s.ok) return '—';
      return table.value.times + ' 个时刻 · ' + table.value.points + ' 个排期点' +
        (view.value === 'month' ? '（' + monthLabels.value.length + ' 天）' : '');
    });

    function renderMetrics() {
      const s = sched.value;
      if (!s || !s.ok) { setHeadMetrics([]); return; }
      setHeadMetrics([
        { k: '触发器总数', v: s.stats.total, color: '#378ADD' },
        { k: '已启用', v: s.stats.enabled, color: '#1D9E75' },
        { k: '已停用', v: s.stats.disabled, color: '#888780' },
        { k: 'Webhook', v: s.stats.webhook, color: '#D85A30' }
      ]);
    }

    /* ---------------- 当前时刻横线 ----------------
       纵坐标按「时刻」列的中心线做线性插值，落在两行之间时按时间比例取点。 */
    function updateNowLine() {
      const wrap = wrapEl.value;
      const line = nowLine.value;
      if (!wrap || !line) return;
      const marks = [];
      const wrapTop = wrap.getBoundingClientRect().top;
      const tds = wrap.querySelectorAll('td.sc-time');
      tds.forEach((td) => {
        const txt = (td.textContent || '').trim();
        if (!/^\d{2}:\d{2}$/.test(txt)) return;
        const rect = td.getBoundingClientRect();
        marks.push({
          t: parseInt(txt.slice(0, 2), 10) + parseInt(txt.slice(3), 10) / 60,
          top: rect.top - wrapTop, h: rect.height
        });
      });
      const n = marks.length;
      if (!n) { line.style.display = 'none'; return; }
      const now = new Date();
      const nt = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
      let y = null;
      if (nt <= marks[0].t) {
        y = marks[0].top;                                   // 早于首个时刻：贴第一行顶
      } else if (nt >= marks[n - 1].t) {
        y = marks[n - 1].top + marks[n - 1].h;              // 晚于末个时刻：贴最后一行底
      } else {
        for (let i = 0; i < n - 1; i++) {
          if (nt >= marks[i].t && nt <= marks[i + 1].t) {
            const span = marks[i + 1].t - marks[i].t;
            const f = span > 0 ? (nt - marks[i].t) / span : 0;
            const c0 = marks[i].top + marks[i].h / 2;
            const c1 = marks[i + 1].top + marks[i + 1].h / 2;
            y = c0 + f * (c1 - c0);
            break;
          }
        }
      }
      if (y == null) { line.style.display = 'none'; return; }
      line.style.display = '';
      line.style.top = Math.round(y) + 'px';
      const lab = line.firstChild;
      if (lab) lab.textContent = timeText(nt);
    }

    function onTick() { updateNowLine(); }
    function onResize() { updateNowLine(); }

    /* ---------------- 交互 ---------------- */
    function onTagClick(it) {
      if (!it.fid) {
        shell.toast('这条排期没有关联的项目 ID。请点右上角「立刻更新」重新抓取一次数据（新版会带上 flow_id）。', 'error');
        return;
      }
      go('projects', { fid: it.fid, tab: 'runs' });
    }
    const tagTip = (it) => it.app + '　·　' + it.robots.join('、') + (it.enabled ? '' : '（已停用）');

    /* 导出：按当前筛选条件请后端生成 xlsx，前端收 Blob 触发下载（不落盘、不跳页） */
    function exportXlsx() {
      if (exporting.value) return;
      exporting.value = true;
      const url = api.scheduleExportUrl(view.value, robot.value, status.value);
      download(url, '触发器排期.xlsx')
        .catch((e) => shell.toast('导出失败：' + (e && e.message ? e.message : e), 'error'))
        .then(() => { exporting.value = false; });
    }

    /* 数据就绪/变化时：更新指标卡 + 重算横线位置 */
    watch(() => store.schedule, () => {
      renderMetrics();
      nextTick(updateNowLine);
    });
    watch([view, robot, status], () => nextTick(updateNowLine));

    onMounted(() => {
      renderMetrics();
      if (!store.schedule) loadSchedule().then(() => { renderMetrics(); nextTick(updateNowLine); });
      else nextTick(updateNowLine);
      window.addEventListener('rpa:schedule-tick', onTick);
      window.addEventListener('rpa:resize', onResize);
    });
    onBeforeUnmount(() => {
      window.removeEventListener('rpa:schedule-tick', onTick);
      window.removeEventListener('rpa:resize', onResize);
      setHeadMetrics([]);
    });

    return {
      store, sched, view, robot, status, exporting, hotApp, wrapEl, nowLine,
      xLabels, monthLabels, robotOptions, statusOptions, table, todayCol, info,
      onTagClick, tagTip, exportXlsx, U
    };
  },
  template: `
<div class="rpa-view">
  <div class="rpa-card" style="flex:1 1 auto;">
    <div class="rpa-card-head">
      <h2 class="rpa-card-title">触发器排期</h2>
      <span style="font-size:12px;color:var(--rpa-dim);">视图</span>
      <el-select v-model="view" style="width:96px" size="small">
        <el-option label="每周" value="week" />
        <el-option label="每月" value="month" />
      </el-select>
      <span style="font-size:12px;color:var(--rpa-dim);">机器人</span>
      <el-select v-model="robot" style="width:150px" size="small" filterable>
        <el-option v-for="o in robotOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <span style="font-size:12px;color:var(--rpa-dim);">状态</span>
      <el-select v-model="status" style="width:110px" size="small">
        <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-button size="small" :loading="exporting" @click="exportXlsx"
                 title="按当前筛选条件（视图 / 机器人 / 状态）导出 xlsx">导出 Excel</el-button>
      <span class="rpa-spacer"></span>
      <span style="font-size:11.5px;color:var(--rpa-dim);">{{ info }}</span>
    </div>

    <div class="rpa-scroll">
      <div class="sc-wrap" ref="wrapEl">
        <table class="sc-tbl" :class="{ 'sc-has-hot': hotApp }">
          <thead>
            <tr>
              <th class="sc-time-h">时刻</th>
              <th v-for="(l, i) in xLabels" :key="l + i"
                  :class="{ 'sc-today': i === todayCol }">{{ l }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!table.rows.length">
              <td class="sc-empty" :colspan="xLabels.length + 1"
                  style="text-align:center;color:var(--rpa-dim);padding:24px;">
                当前筛选条件下没有排期数据（可把「状态」切到「全部状态」试试）
              </td>
            </tr>
            <tr v-for="row in table.rows" :key="row.t">
              <td class="sc-time">{{ row.hm }}</td>
              <td v-for="(cell, i) in row.cells" :key="i" class="sc-cell"
                  :class="{ 'sc-today': i === todayCol }">
                <template v-if="cell.length">
                  <span v-for="it in cell" :key="it.app" class="sc-tag"
                        :class="{ off: !it.enabled, hot: hotApp === it.app }"
                        :style="{ '--c': it.color }" :title="tagTip(it)"
                        @mouseenter="hotApp = it.app" @mouseleave="hotApp = null"
                        @click="onTagClick(it)">
                    {{ it.short || it.app }}
                    <i v-if="it.robots.length > 1" class="sc-mul">×{{ it.robots.length }}</i>
                  </span>
                </template>
                <span v-else class="sc-dash">·</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="sc-nowline" ref="nowLine" style="display:none"><span class="sc-now-lab"></span></div>
      </div>
    </div>

    <div class="rpa-hint">
      视图：每周=周一~周日（每天/每周任务），每月=当月有任务的日期（每月任务）；行=执行时刻，格子内列出该时刻运行的应用；
      悬停某个应用会点亮同一应用的全部排期，<b>点击标签直达项目控制台该项目的运行记录</b>。
      红色虚线=当前时刻，红色底色列=今天。
      「导出 Excel」按当前筛选生成 xlsx，含「排期日历」（版式同原图，同应用的排期日合并成色块）、「排期明细」与「触发器汇总」三张表。
    </div>
  </div>
</div>
`
});
