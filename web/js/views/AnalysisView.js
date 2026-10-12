/* ============================================================================
 * AnalysisView.js —— 运行数据分析
 *
 * 四张图（触发方式分布 / 状态分布 / 运行量热力图 / 各机器人平均排队时长）
 * + 两张表（机器人负载榜 / 失败记录看板）+ 失败记录 CSV 导出。
 * 指标卡写在标题栏（store.headMetrics）。
 * ========================================================================= */
import { defineComponent, ref, computed, onMounted, onBeforeUnmount, watch } from '../vendor.js';
import { store, setHeadMetrics } from '../store.js';
import { useChart } from '../chart.js';
import * as U from '../util.js';

export default defineComponent({
  name: 'AnalysisView',
  setup() {
    const pieEl = ref(null);
    const statusEl = ref(null);
    const waitEl = ref(null);
    const heatEl = ref(null);
    const pie = useChart(pieEl);
    const statusPie = useChart(statusEl);
    const waitBar = useChart(waitEl);
    const heat = useChart(heatEl);

    /* ---------------- 统计（一次遍历出全部口径） ---------------- */
    const stats = computed(() => {
      const now = Date.now();
      const recs = store.records;
      let total = 0, finished = 0, failed = 0, running = 0, stopped = 0, waiting = 0;
      let waitSum = 0, waitN = 0, runSum = 0, runN = 0, maxRun = 0;
      const events = [];
      const byRobot = {}, byWay = {}, statusCount = {};
      const heatMap = [];
      for (let w = 0; w < 7; w++) heatMap.push(new Array(24).fill(0));
      recs.forEach((r) => {
        const st = r.start, en = (r.end == null) ? now : r.end;
        const s = r.status;
        total++;
        statusCount[s] = (statusCount[s] || 0) + 1;
        if (s === 'Finished') finished++;
        else if (s === 'Failed') failed++;
        else if (s === 'Executing') running++;
        else if (s === 'Stopped') stopped++;
        else if (s === 'Waiting') waiting++;
        if (r.execStart && r.execStart > st) { waitSum += r.execStart - st; waitN++; }
        if (r.execStart && r.end != null && r.end > r.execStart) {
          const rd = r.end - r.execStart; runSum += rd; runN++; if (rd > maxRun) maxRun = rd;
        } else if (r.end != null && r.end > st) {
          const rd2 = r.end - st; if (rd2 > maxRun) maxRun = rd2;
        }
        events.push([st, 1]); events.push([en, -1]);
        const wd = (new Date(st).getDay() + 6) % 7;
        const hh = new Date(st).getHours();
        heatMap[wd][hh]++;
        const rk = r.robot;
        const u = byRobot[rk] || (byRobot[rk] = {
          robot: rk, count: 0, failed: 0, waitSum: 0, waitN: 0, runSum: 0, runN: 0
        });
        u.count++;
        if (s === 'Failed') u.failed++;
        if (r.execStart && r.execStart > st) { u.waitSum += r.execStart - st; u.waitN++; }
        if (r.execStart && r.end != null && r.end > r.execStart) {
          u.runSum += r.end - r.execStart; u.runN++;
        }
        const wv = r.way || '-';
        byWay[wv] = (byWay[wv] || 0) + 1;
      });
      events.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
      let peak = 0, cur = 0;
      events.forEach((e) => { cur += e[1]; if (cur > peak) peak = cur; });
      return {
        total, finished, failed, running, stopped, waiting, peak, maxRun,
        avgWait: waitN ? waitSum / waitN : 0,
        avgRun: runN ? runSum / runN : 0,
        byRobot, byWay, statusCount, heat: heatMap,
        fails: recs.filter((r) => r.status === 'Failed')
      };
    });

    const robotRows = computed(() => Object.keys(stats.value.byRobot)
      .map((k) => stats.value.byRobot[k])
      .sort((a, b) => b.count - a.count));

    /* ---------------- 渲染 ---------------- */
    function renderMetrics() {
      const s = stats.value;
      setHeadMetrics([
        { k: '总运行数', v: s.total, color: '#378ADD' },
        { k: '运行中', v: s.running, color: '#EF9F27' },
        { k: '平均排队', v: U.fmtDurM(s.avgWait), color: '#7F77DD' },
        { k: '平均运行', v: U.fmtDurM(s.avgRun), color: '#1D9E75' }
      ]);
    }

    function renderPie() {
      const data = Object.keys(stats.value.byWay).map((k) => {
        const c = U.WAYHUE[U.wayCN(k)] || [55, 138, 221];
        return {
          name: U.wayCN(k), value: stats.value.byWay[k],
          itemStyle: { color: U.shadeGrad('rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',1)', 'v', .1, .12) }
        };
      });
      pie.setOption({
        tooltip: U.tipOpt({ trigger: 'item', formatter: '{b}: {c} ({d}%)' }),
        legend: U.pieLegend(data),
        series: U.pieSeries(data)
      });
    }

    function renderStatus() {
      const data = Object.keys(stats.value.statusCount).map((k) => ({
        name: U.STATUS_CN[k] || k,
        value: stats.value.statusCount[k],
        itemStyle: { color: U.statusPieFill(k) }
      }));
      data.sort((a, b) => b.value - a.value);
      statusPie.setOption({
        tooltip: U.tipOpt({ trigger: 'item', formatter: '{b}: {c} ({d}%)' }),
        legend: U.pieLegend(data),
        series: U.pieSeries(data)
      });
    }

    function renderWait() {
      const arr = Object.keys(stats.value.byRobot).map((k) => {
        const u = stats.value.byRobot[k];
        return { robot: u.robot, avg: u.waitN ? u.waitSum / u.waitN : 0 };
      }).sort((a, b) => b.avg - a.avg);
      /* y 轴标签按实际机器人名测宽：名字短就少留空，名字长才让位 */
      let labelW = 0;
      arr.forEach((d) => { const w = U.measureW(d.robot, 11); if (w > labelW) labelW = w; });
      const leftPad = Math.max(44, Math.min(132, Math.ceil(labelW) + 12));
      waitBar.setOption({
        grid: { left: leftPad, right: 20, top: 8, bottom: 28 },
        tooltip: U.tipOpt({
          trigger: 'axis',
          formatter: (p) => p[0].name + '：' + U.fmtDurM(p[0].value)
        }),
        xAxis: {
          type: 'value',
          axisLabel: {
            color: '#8b8f98', fontSize: 11,
            formatter: (v) => (v / 60000).toFixed(0) + '分'
          },
          splitLine: { lineStyle: { color: '#20242c' } }
        },
        yAxis: {
          type: 'category', data: arr.map((d) => d.robot), inverse: true,
          axisLabel: { color: '#c9cdd4', fontSize: 11, width: leftPad - 8, overflow: 'truncate' }
        },
        series: [{
          type: 'bar', data: arr.map((d) => d.avg), barWidth: '58%',
          itemStyle: { color: U.gradFill('#7abaf6', '#275f9e', 'h'), borderRadius: [3, 7, 7, 3] },
          showBackground: true,
          backgroundStyle: { color: 'rgba(255,255,255,.035)', borderRadius: [3, 7, 7, 3] },
          emphasis: { itemStyle: { color: U.gradFill('#a3d1ff', '#3579c0', 'h') } }
        }]
      });
    }

    function renderHeat() {
      const days = ['一', '二', '三', '四', '五', '六', '日'];
      const data = [];
      let maxV = 0;
      for (let w = 0; w < 7; w++) {
        for (let h = 0; h < 24; h++) {
          const v = stats.value.heat[w][h];
          if (v > maxV) maxV = v;
          data.push([h, w, v]);
        }
      }
      heat.setOption({
        tooltip: U.tipOpt({
          position: 'top',
          formatter: (p) => '周' + days[p.value[1]] + ' ' + U.pad(p.value[0]) + '时：' + p.value[2] + ' 次'
        }),
        grid: { left: 42, right: 16, top: 8, bottom: 78 },
        xAxis: {
          type: 'category',
          data: Array.from({ length: 24 }, (_, i) => i),
          axisLabel: { color: '#8b8f98', fontSize: 11 },
          splitArea: { show: false }
        },
        yAxis: {
          type: 'category', data: days.map((d) => '周' + d),
          axisLabel: { color: '#c9cdd4', fontSize: 11 }
        },
        visualMap: {
          min: 0, max: (maxV || 1), calculable: true, orient: 'horizontal',
          left: 'center', bottom: 4, itemWidth: 10, itemHeight: 92, itemGap: 5,
          textStyle: { color: '#8b8f98', fontSize: 10 },
          inRange: { color: ['#151b24', '#1e4e7d', '#378ADD', '#e0a13c', '#e05c52'] }
        },
        series: [{
          type: 'heatmap', data, label: { show: false },
          itemStyle: { borderColor: 'rgba(10,13,18,.85)', borderWidth: 2, borderRadius: 5 },
          emphasis: {
            itemStyle: { borderColor: '#fff', borderWidth: 1.5, shadowBlur: 12, shadowColor: 'rgba(0,0,0,.6)' }
          }
        }]
      });
    }

    function renderAll() {
      renderMetrics();
      renderPie();
      renderStatus();
      renderWait();
      renderHeat();
    }

    /* 失败记录导出：与页面同口径（当前内存里的全部失败记录） */
    function exportFails() {
      const fails = stats.value.fails;
      if (!fails.length) { U.exportCsv([], [], ''); return; }
      U.exportCsv(
        ['开始时间', '机器人', '应用', '触发方式', '流程编号', '状态'],
        fails.map((r) => [U.fmtTime(r.start), r.robot, r.name || r.app, U.wayCN(r.way), r.id || '', '失败']),
        '失败运行记录_' + new Date().toISOString().slice(0, 10) + '.csv'
      );
    }

    /* 窗口/断点变化：图表要按新尺寸重算。用 ResizeObserver 已能覆盖容器变化，
       这里只补「容器尺寸没变但需要重画」的场合（切回本视图）。 */
    function onResize() { renderAll(); }
    onMounted(() => {
      renderAll();
      window.addEventListener('rpa:resize', onResize);
    });
    onBeforeUnmount(() => {
      window.removeEventListener('rpa:resize', onResize);
      /* 关键：本视图卸载后不能再往标题栏写指标卡。
         每个视图进入时都会重设 headMetrics，但残留的监听器会在之后被触发，
         把别的视图的指标覆盖成本视图的（原实现靠切容器显隐，不存在这个问题）。 */
      setHeadMetrics([]);
    });
    watch(() => store.records, renderAll);

    return {
      store, stats, robotRows, pieEl, statusEl, waitEl, heatEl, exportFails,
      U, failed: computed(() => stats.value.fails)
    };
  },
  template: `
<div class="rpa-view rpa-view-scroll">
  <div class="an-grid">
    <div class="rpa-card">
      <div class="rpa-card-head"><h2 class="rpa-card-title">触发方式分布</h2></div>
      <div ref="pieEl" class="an-chart"></div>
    </div>
    <div class="rpa-card">
      <div class="rpa-card-head"><h2 class="rpa-card-title">状态分布</h2></div>
      <div ref="statusEl" class="an-chart"></div>
    </div>

    <div class="rpa-card span2">
      <div class="rpa-card-head"><h2 class="rpa-card-title">运行量热力图（星期 × 小时）</h2></div>
      <div ref="heatEl" class="an-chart"></div>
    </div>

    <div class="rpa-card">
      <div class="rpa-card-head"><h2 class="rpa-card-title">各机器人平均排队时长（资源争抢）</h2></div>
      <div ref="waitEl" class="an-chart"></div>
    </div>
    <div class="rpa-card">
      <div class="rpa-card-head"><h2 class="rpa-card-title">机器人负载榜</h2></div>
      <div class="rpa-scroll">
        <el-table :data="robotRows" size="small" height="100%" empty-text="暂无数据">
          <el-table-column prop="robot" label="机器人" min-width="120" show-overflow-tooltip />
          <el-table-column prop="count" label="记录数" width="76" align="right" />
          <el-table-column prop="failed" label="失败" width="64" align="right" />
          <el-table-column label="失败率" width="80" align="right">
            <template #default="{ row }">
              <span :style="{ color: (row.count && row.failed / row.count >= .2) ? '#E24B4A' : '' }">
                {{ Math.round(row.count ? row.failed / row.count * 100 : 0) }}%
              </span>
            </template>
          </el-table-column>
          <el-table-column label="平均排队" width="96" align="right">
            <template #default="{ row }">{{ U.fmtDurM(row.waitN ? row.waitSum / row.waitN : 0) }}</template>
          </el-table-column>
          <el-table-column label="平均运行" width="96" align="right">
            <template #default="{ row }">{{ U.fmtDurM(row.runN ? row.runSum / row.runN : 0) }}</template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </div>

  <div class="rpa-card" style="height:320px;">
    <div class="rpa-card-head">
      <h2 class="rpa-card-title">失败记录看板</h2>
      <el-button size="small" :disabled="!failed.length" @click="exportFails">导出失败记录 CSV</el-button>
      <span class="rpa-spacer"></span>
      <span style="font-size:11.5px;color:var(--rpa-dim);">共 {{ failed.length }} 条失败</span>
    </div>
    <div class="rpa-scroll">
      <el-table :data="failed" size="small" height="100%" empty-text="没有失败记录">
        <el-table-column label="开始时间" width="128" class-name="num">
          <template #default="{ row }">{{ U.fmtTime(row.start) }}</template>
        </el-table-column>
        <el-table-column prop="robot" label="机器人" min-width="120" show-overflow-tooltip />
        <el-table-column label="应用" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.name || row.app }}</template>
        </el-table-column>
        <el-table-column label="触发方式" width="110">
          <template #default="{ row }">{{ U.wayCN(row.way) }}</template>
        </el-table-column>
        <el-table-column prop="id" label="流程编号" min-width="150" show-overflow-tooltip />
      </el-table>
    </div>
  </div>
</div>
`
});
