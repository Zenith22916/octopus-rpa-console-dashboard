/* ============================================================================
 * Root.js —— 应用根组件（壳层）
 *
 * 职责：
 *   1. 左侧导航（el-menu）+ 标题栏（指标卡插槽 / 立刻更新 / 自动更新开关）
 *   2. hash 路由：解析 #/view?params，驱动视图切换与指标卡切换
 *   3. 详情页深链参数、项目控制台待跳转参数的分发
 *   4. 两个全局弹窗（运行机器人选择 / 全局轻提示与遮罩）
 *
 * 各视图只负责自己那块内容；标题栏指标卡由各视图调用 setHeadMetrics([...]) 写入
 * store.headMetrics，这里统一渲染（不再需要预先摆好一堆空容器 + 切显隐）。
 * ========================================================================= */
import {
  defineComponent, ref, computed, onMounted, onBeforeUnmount, nextTick
} from '../vendor.js';
import {
  store, NAV_GROUPS, AUTO_VIEWS, VIEW_TITLES, parseHash, go,
  loadRuns, loadSchedule, refreshData
} from '../store.js';
import RunDialog from '../components/RunDialog.js';

/* 视图组件（各自默认导出） */
import TimelineView from './TimelineView.js';
import AnalysisView from './AnalysisView.js';
import DetailView from './DetailView.js';
import ScheduleView from './ScheduleView.js';
import ProjectsView from './ProjectsView.js';
import BotStatusView from './BotStatusView.js';
import LogSearchView from './LogSearchView.js';
import ComplianceView from './ComplianceView.js';

const VIEW_COMPONENTS = {
  timeline: TimelineView, analysis: AnalysisView, detail: DetailView,
  schedule: ScheduleView, projects: ProjectsView, botstatus: BotStatusView,
  logsearch: LogSearchView, compliance: ComplianceView
};

export default defineComponent({
  name: 'Root',
  components: Object.assign({ RunDialog }, VIEW_COMPONENTS),
  setup() {
    const autoViews = AUTO_VIEWS;
    const activeNav = computed(() => store.view);
    const title = computed(() => VIEW_TITLES[store.view] || '运行仪表盘');
    const showAuto = computed(() => autoViews.indexOf(store.view) >= 0);
    /* 每个视图一个 key：切走再切回时重建组件（与原实现「切视图重跑初始化」一致），
       但同一视图内部的状态（筛选条件）由各视图自己持有，不会被 store 覆盖。 */
    const viewComp = computed(() => VIEW_COMPONENTS[store.view] || AnalysisView);

    /* ---- hash 路由 ----
       注意：route() 必须在 setup 阶段同步跑一次，不能只放在 onMounted ——
       子组件的 onMounted 比父组件先执行，若等到父组件挂载才解析 hash，
       详情页会带着空的 store.detail 挂载（表现为「未找到该运行记录」）。 */
    let entered = {};
    function route() {
      const { name, params } = parseHash();
      const prev = store.view;
      store.view = name;

      if (name === 'detail') {
        store.detail = { id: params.id || null, kw: params.kw || null, file: params.file || null };
      } else if (name === 'projects') {
        store.pendingFid = params.fid || null;
        store.pendingTab = params.tab || null;
      }
      /* 各视图首次进入时的数据准备（与原 route() 的分支一致） */
      if (!entered[name]) {
        entered[name] = true;
        if (name === 'timeline' || name === 'analysis') loadRuns();
        else if (name === 'schedule') loadSchedule();
        else if (name === 'logsearch' && !store.records.length) loadRuns();
      } else if (name === 'timeline' && prev === 'detail') {
        /* 从日志详情页返回：自动更新在详情页停更了，按「数据范围」补拉一次 */
        refreshData(false, 'range');
      } else if (name === 'schedule') {
        loadSchedule();   // 数据可能在别处被刷新过：进入时同步最新
      }
      nextTick(() => window.dispatchEvent(new CustomEvent('rpa:view-changed', { detail: { name } })));
    }
    route();
    onMounted(() => window.addEventListener('hashchange', route));
    onBeforeUnmount(() => window.removeEventListener('hashchange', route));

    /* ---- 导航点击 ---- */
    function onNavSelect(name) { go(name); }

    /* ---- 立刻更新 ---- */
    const refreshLabel = ref('立刻更新');
    function onRefreshNow() {
      if (store.refreshing) return;
      refreshLabel.value = '更新中…';
      refreshData(true).then((ok) => {
        refreshLabel.value = ok ? '✓ 已更新' : '✗ 失败';
        /* 排期页在「立刻更新」（全量抓，含触发器）后重载 */
        if (ok && store.view === 'schedule') loadSchedule();
        setTimeout(() => { refreshLabel.value = '立刻更新'; }, 2000);
      });
    }

    /* ---- 自动更新开关 ---- */
    function onAutoChange(v) {
      store.auto = v;
      window.dispatchEvent(new CustomEvent('rpa:auto-changed'));
    }

    return {
      store, activeNav, title, showAuto, viewComp,
      onNavSelect, onRefreshNow, onAutoChange, refreshLabel,
      NAV_GROUPS
    };
  },
  template: `
<div class="rpa-shell">
  <!-- ==================== 左侧导航 ==================== -->
  <aside class="rpa-side">
    <div class="rpa-brand">
      <span class="rpa-logo" aria-hidden="true"></span>
      <span class="rpa-brand-txt">
        <span class="rpa-brand-name">RPA 控制台</span>
        <span class="rpa-brand-sub">OCTOPUS RPA</span>
      </span>
    </div>

    <nav class="rpa-nav">
      <template v-for="g in NAV_GROUPS" :key="g.title">
        <div class="rpa-nav-group">{{ g.title }}</div>
        <el-menu :default-active="activeNav" @select="onNavSelect">
          <el-menu-item v-for="it in g.items" :key="it.name" :index="it.name">
            <el-icon><component :is="it.icon" /></el-icon>
            <span>{{ it.label }}</span>
          </el-menu-item>
        </el-menu>
      </template>
    </nav>

    <div class="rpa-side-foot">
      <div class="k">数据获取时间</div>
      <div class="v">{{ store.dataTime }}</div>
    </div>
  </aside>

  <!-- ==================== 主内容区 ==================== -->
  <main class="rpa-main">
    <header class="rpa-topbar">
      <span class="rpa-view-title">{{ title }}</span>
      <!-- 各视图把自己的指标卡写进 store.headMetrics，这里统一渲染 -->
      <div class="rpa-metrics">
        <div class="rpa-metric" v-for="m in store.headMetrics" :key="m.k">
          <div class="k">{{ m.k }}</div>
          <div class="v" :style="{ color: m.color }">{{ m.v }}</div>
        </div>
      </div>
      <div class="rpa-topbar-right">
        <el-button type="primary" :loading="store.refreshing" @click="onRefreshNow"
                   title="立即全量抓取：运行记录 + 触发器排期（不用等后端每分钟的那轮自动抓取）">
          {{ refreshLabel }}
        </el-button>
        <span v-if="showAuto" style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:12px;color:var(--rpa-dim);">自动更新</span>
          <el-switch :model-value="store.auto" @change="onAutoChange" />
        </span>
      </div>
    </header>

    <div class="rpa-warn" v-if="store.refreshWarn">
      刷新失败，登录态可能已过期，请检查 output/update_log.txt
    </div>

    <div class="rpa-body">
      <component :is="viewComp" :key="store.view" />
    </div>
  </main>
</div>

<!-- 全局：运行机器人选择弹窗 + 轻提示 + 加载遮罩 -->
<RunDialog />
<ShellToast />
<ShellLoading />
`
});
