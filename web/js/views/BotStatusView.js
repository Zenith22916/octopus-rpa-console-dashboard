/* ============================================================================
 * BotStatusView.js —— 机器人实时状态
 *
 * 数据来自 /api/botstatus（后端按运行记录聚合）：在途记录 -> 运行中/排队中，
 * 无在途 -> 空闲；附当前任务、空闲时长、近 24 小时与近 7 天负载。
 *
 * 呈现为「一个机器人一张卡片」的网格：横屏一行 3 张、竖屏一行 1 张。
 * 卡片高度必须完全一致，所以内容按「定长结构」拼：头部 1 行 + 任务区 2 行 +
 * 读数区 3×2 格；任务名一律单行省略号截断，进度行哪怕没内容也占位。
 * ========================================================================= */
import { defineComponent, ref, computed, onMounted, onBeforeUnmount } from '../vendor.js';
import { store, setHeadMetrics, go } from '../store.js';
import { api } from '../api.js';
import * as U from '../util.js';

export default defineComponent({
  name: 'BotStatusView',
  setup() {
    const data = ref(null);
    const filter = ref('__ALL__');
    const loading = ref(false);
    /* 「进行中」的时长读数每 5 秒走一格（只改文本，不重排卡片） */
    const tick = ref(0);

    const summary = computed(() => (data.value && data.value.summary) || {});
    const allBots = computed(() => (data.value && data.value.bots) || []);
    const bots = computed(() => {
      if (filter.value === '__BUSY__') return allBots.value.filter((b) => b.state !== 'idle');
      if (filter.value === '__IDLE__') return allBots.value.filter((b) => b.state === 'idle');
      return allBots.value;
    });
    const info = computed(() => (data.value && data.value.now ? U.fmtFull(data.value.now) : '—'));

    function renderMetrics() {
      const s = summary.value;
      setHeadMetrics([
        { k: '机器人', v: s.robots || 0, color: '#378ADD' },
        { k: '运行中', v: s.running || 0, color: '#EF9F27' },
        { k: '排队中', v: s.queued || 0, color: '#7F77DD' },
        { k: '空闲', v: s.idle || 0, color: '#888780' },
        { k: '在途任务', v: s.tasks || 0, color: '#1D9E75' }
      ]);
    }

    function load() {
      loading.value = true;
      return api.botstatus().then((d) => {
        data.value = (d && d.ok) ? d : null;
        if (data.value && data.value.time) store.dataTime = data.value.time;
        renderMetrics();
      }).catch(() => {
        data.value = null;
        setHeadMetrics([]);
      }).then(() => { loading.value = false; });
    }

    /* 卡片读数：一律紧凑时长 + 单行省略号（格子宽度固定，长文案会把卡片撑成两行） */
    function cardStats(b) {
      const w = b.week || {}, r24 = b.recent || {};
      const busy = !!(b.tasks && b.tasks.length);
      /* 空闲时长只在真空闲时展示：运行中/排队中的机器显示「距上次结束」会被误读成"它闲着呢" */
      const idle = (b.state === 'idle' && b.idleMs != null) ? U.fmtDurShort(b.idleMs) : '—';
      return [
        { k: '空闲', v: idle, cls: b.state === 'idle' ? '' : 'bs-dim' },
        { k: '近 24 小时', v: (r24.count || 0) + (r24.failed ? ' · 失败 ' + r24.failed : ''), cls: r24.failed ? 'bs-bad' : '' },
        { k: '近 7 天', v: String(w.count || 0), cls: '' },
        { k: '失败率', v: Math.round((w.failRate || 0) * 100) + '%', cls: (w.failRate || 0) >= 0.2 ? 'bs-bad' : '' },
        { k: '平均排队', v: U.fmtDurShort(w.avgWait), cls: 'bs-dim' },
        { k: '平均运行', v: U.fmtDurShort(w.avgRun), cls: 'bs-dim' }
      ].map((it) => Object.assign(it, { busy }));
    }
    function taskName(b) {
      const busy = !!(b.tasks && b.tasks.length);
      return busy ? (b.tasks[0].name || b.tasks[0].app || '运行记录') : (b.lastName || '暂无运行记录');
    }
    function taskMeta(b) {
      const busy = !!(b.tasks && b.tasks.length);
      if (!busy) return b.lastEnd ? '最近结束 ' + U.fmtTime(b.lastEnd) : '—';
      const t = b.tasks[0];
      return (t.status === 'Waiting' ? '等待调度' : '已跑 ' + U.fmtDurShort(t.elapsed))
        + (t.waited ? ' · 排队 ' + U.fmtDurShort(t.waited) : '')
        + (b.tasks.length > 1 ? ' · 另有 ' + (b.tasks.length - 1) + ' 个在途' : '');
    }
    function openTask(b) {
      const t = b.tasks && b.tasks[0];
      if (t) go('detail', { id: t.id });
    }
    function onTick() { tick.value = Date.now(); }
    function onBotTick() { if (store.auto) load(); }

    onMounted(() => {
      load();
      window.addEventListener('rpa:feed-tick', onTick);
      window.addEventListener('rpa:botstatus-tick', onBotTick);
    });
    onBeforeUnmount(() => {
      window.removeEventListener('rpa:feed-tick', onTick);
      window.removeEventListener('rpa:botstatus-tick', onBotTick);
      setHeadMetrics([]);
    });

    return {
      store, data, filter, loading, bots, info, tick, cardStats, taskName, taskMeta,
      openTask, load, U
    };
  },
  template: `
<div class="rpa-view">
  <div class="rpa-card bs-panel" style="flex:1 1 auto;">
    <div class="rpa-card-head">
      <h2 class="rpa-card-title">机器人实时状态</h2>
      <span style="font-size:12px;color:var(--rpa-dim);">筛选</span>
      <el-select v-model="filter" size="small" style="width:190px">
        <el-option label="全部" value="__ALL__" />
        <el-option label="仅忙（运行中/排队中）" value="__BUSY__" />
        <el-option label="仅空闲" value="__IDLE__" />
      </el-select>
      <el-button size="small" :loading="loading" @click="load">刷新</el-button>
      <span class="rpa-spacer"></span>
      <span style="font-size:11.5px;color:var(--rpa-dim);">{{ info }}</span>
    </div>
    <div class="rpa-hint" style="margin:0 0 8px;">
      状态由运行记录推断：有「运行中」记录即在跑，否则看是否有排队记录
    </div>

    <div class="rpa-scroll">
      <div v-if="!data" class="rpa-empty">机器人状态加载失败，请确认后端服务正常。</div>
      <div v-else-if="!bots.length" class="rpa-empty">没有符合条件的机器人。</div>
      <div v-else class="bs-grid">
        <article v-for="b in bots" :key="b.robot" class="bs-card" :class="'bs-st-' + (b.state || 'idle')">
          <div class="bs-head">
            <span class="bs-dot" :style="{ background: (U.BS_STATE[b.state] || U.BS_STATE.idle).color }"></span>
            <span class="bs-name" :title="b.robot">{{ b.robot }}</span>
            <span class="bs-state"
                  :style="{ '--c': (U.BS_STATE[b.state] || U.BS_STATE.idle).color }">
              {{ (U.BS_STATE[b.state] || U.BS_STATE.idle).cn }}
            </span>
          </div>

          <div class="bs-task">
            <div class="bs-task-line">
              <span class="bs-task-k">{{ b.tasks && b.tasks.length ? '当前任务' : '最近任务' }}</span>
              <span class="bs-task-v" :title="taskName(b)">
                <a v-if="b.tasks && b.tasks.length" @click="openTask(b)"
                   title="点击查看该任务的日志">{{ taskName(b) }}</a>
                <span v-else class="bs-dim">{{ taskName(b) }}</span>
              </span>
            </div>
            <div class="bs-task-line">
              <span class="bs-task-meta bs-dim" :title="taskMeta(b)">{{ taskMeta(b) }}</span>
            </div>
          </div>

          <div class="bs-stats">
            <div v-for="s in cardStats(b)" :key="s.k" class="bs-stat">
              <span class="k">{{ s.k }}</span>
              <span class="v" :class="s.cls" :title="s.v">{{ s.v }}</span>
            </div>
          </div>
        </article>
      </div>
    </div>
  </div>
</div>
`
});
