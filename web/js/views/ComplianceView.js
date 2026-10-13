/* ============================================================================
 * ComplianceView.js —— 触发器合规（排期 vs 实跑）
 *
 * 数据来自 /api/compliance（后端把排期点与实跑记录做比对）：
 * 命中 / 延迟 / 应用不符 / 漏跑 / 待定。
 * 判定口径全在后端（dashboard.build_compliance），前端只做展示，避免两处口径漂移。
 *   左侧：各机器人命中率（始终展示全量总览，不随机器人筛选收窄）
 *   右侧：排期明细（可按机器人 / 只看问题筛选），点某行进该次运行的日志
 * ========================================================================= */
import { defineComponent, ref, computed, onMounted, onBeforeUnmount } from '../vendor.js';
import { setHeadMetrics, go } from '../store.js';
import { shell } from '../shell.js';
import { api } from '../api.js';
import * as U from '../util.js';

export default defineComponent({
  name: 'ComplianceView',
  setup() {
    const data = ref(null);
    const days = ref('7');
    const only = ref('problem');
    const robot = ref('__ALL__');
    const loading = ref(false);

    const stats = computed(() => (data.value && data.value.stats) || {});
    const perRobot = computed(() => (data.value && data.value.perRobot) || []);
    const robotOptions = computed(() => [{ robot: '__ALL__' }].concat(perRobot.value));

    const items = computed(() => {
      if (!data.value) return [];
      return (data.value.items || []).filter((it) => {
        if (robot.value !== '__ALL__' && it.robot !== robot.value) return false;
        if (only.value === '__ALL__') return true;
        if (only.value === 'missed') return it.status === 'missed';
        return it.status === 'missed' || it.status === 'mismatch' || it.status === 'late';
      });
    });

    const info = computed(() => {
      const s = stats.value;
      return '可判定 ' + (s.evaluated || 0) + ' 次 · 延迟 ' + (s.late || 0) +
        ' · 待定 ' + (s.pending || 0) + ' · 超出数据范围 ' + (s.unknown || 0);
    });
    const hint = computed(() => {
      if (!data.value) return '—';
      return '口径：计划时刻起（含前后 2 分钟容差）' + data.value.window +
        ' 分钟内、同机器人 + 同应用有运行记录即算命中；' +
        '「应用不符」= 触发到了但跑的是别的应用。早于运行记录最早时刻（' +
        (data.value.coverageFrom ? U.fmtFull(data.value.coverageFrom) : '—') +
        '）的排期点无法判定，已排除。';
    });

    function renderMetrics() {
      const s = stats.value;
      if (!data.value) { setHeadMetrics([]); return; }
      setHeadMetrics([
        { k: '应跑次数', v: s.scheduled, color: '#378ADD' },
        { k: '按时', v: s.hit, color: '#1D9E75' },
        { k: '应用不符', v: s.mismatch || 0, color: '#D85A30' },
        { k: '漏跑', v: s.missed, color: '#E24B4A' },
        { k: '命中率', v: Math.round((s.rate || 0) * 100) + '%', color: (s.rate || 0) >= 0.95 ? '#1D9E75' : '#EF9F27' }
      ]);
    }

    function load() {
      loading.value = true;
      shell.loading('正在比对排期与实际运行…');
      return api.compliance(days.value).then((d) => {
        data.value = (d && d.ok) ? d : null;
        if (!data.value) shell.toast((d && d.error) || '加载失败', 'error');
        else if (robot.value !== '__ALL__' &&
          !perRobot.value.some((b) => b.robot === robot.value)) robot.value = '__ALL__';
        renderMetrics();
      }).catch((e) => {
        data.value = null;
        setHeadMetrics([]);
        shell.toast(String(e && e.message ? e.message : e), 'error');
      }).then(() => {
        loading.value = false;
        shell.hide();
      });
    }

    function badge(st) {
      const m = U.CP_STATE[st] || U.CP_STATE.pending;
      return m;
    }
    /* 「实际运行」列里的补充说明：延迟多久 / 实跑的是哪个应用 */
    function extra(it) {
      if (it.status === 'late' && it.lateMs) return '晚 ' + U.fmtDur(it.lateMs);
      if (it.status === 'mismatch' && it.runApp) return '实跑：' + it.runApp;
      return '';
    }
    function openRow(it) {
      if (it.runId) go('detail', { id: it.runId });
    }

    onMounted(load);
    onBeforeUnmount(() => setHeadMetrics([]));

    return {
      data, days, only, robot, loading, stats, perRobot, robotOptions, items, info, hint,
      load, badge, extra, openRow, U,
      onlyOptions: [
        { value: 'problem', label: '漏跑 + 应用不符 + 延迟' },
        { value: 'missed', label: '只看漏跑' },
        { value: '__ALL__', label: '全部（含按时）' }
      ]
    };
  },
  template: `
<div class="rpa-view">
  <div class="cp-layout">
    <!-- ==================== 左：各机器人命中率 ==================== -->
    <div class="rpa-card cp-side">
      <div class="rpa-card-head"><h2 class="rpa-card-title">各机器人命中率</h2></div>
      <div class="rpa-scroll">
        <el-table :data="perRobot" size="small" height="100%" empty-text="无数据">
          <el-table-column prop="robot" label="机器人" min-width="120" show-overflow-tooltip />
          <el-table-column prop="scheduled" label="应跑" width="66" align="right" />
          <el-table-column prop="hit" label="按时" width="66" align="right" />
          <el-table-column label="漏跑" width="66" align="right">
            <template #default="{ row }">
              <span :class="{ 'cp-missed': row.missed }">{{ row.missed }}</span>
            </template>
          </el-table-column>
          <el-table-column label="命中率" width="80" align="right">
            <template #default="{ row }">
              <span :class="{ 'cp-rate-bad': row.rate < 0.95 }">{{ Math.round(row.rate * 100) }}%</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div class="rpa-hint">
        「应用不符」= 触发到了、但跑的是别的应用（触发器指向与实跑应用不一致）。
      </div>
    </div>

    <!-- ==================== 右：排期明细 ==================== -->
    <div class="rpa-card cp-main">
      <div class="rpa-card-head">
        <h2 class="rpa-card-title">排期明细</h2>
        <span style="font-size:12px;color:var(--rpa-dim);">范围</span>
        <el-select v-model="days" size="small" style="width:110px" @change="load">
          <el-option label="最近 3 天" value="3" />
          <el-option label="最近 7 天" value="7" />
          <el-option label="最近 14 天" value="14" />
        </el-select>
        <span style="font-size:12px;color:var(--rpa-dim);">机器人</span>
        <el-select v-model="robot" size="small" style="width:150px" filterable>
          <el-option v-for="b in robotOptions" :key="b.robot"
                     :label="b.robot === '__ALL__' ? '全部机器人' : b.robot" :value="b.robot" />
        </el-select>
        <span style="font-size:12px;color:var(--rpa-dim);">只看</span>
        <el-select v-model="only" size="small" style="width:190px">
          <el-option v-for="o in onlyOptions" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-button size="small" :loading="loading" @click="load">刷新</el-button>
        <span class="rpa-spacer"></span>
        <span style="font-size:11.5px;color:var(--rpa-dim);">{{ info }}</span>
      </div>

      <div class="rpa-scroll">
        <el-table :data="items" size="small" height="100%"
                  empty-text="该筛选条件下没有条目"
                  :row-class-name="({ row }) => row.runId ? 'cp-clickable' : ''"
                  @row-click="openRow">
          <el-table-column label="计划时间" width="170" class-name="num">
            <template #default="{ row }">{{ U.fmtFull(row.sched) }}</template>
          </el-table-column>
          <el-table-column prop="robot" label="机器人" min-width="130" show-overflow-tooltip />
          <el-table-column prop="app" label="应用" min-width="200" show-overflow-tooltip />
          <el-table-column label="状态" width="98">
            <template #default="{ row }">
              <span class="cp-badge" :style="{ '--c': badge(row.status).color }">
                {{ badge(row.status).cn }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="实际运行" min-width="230">
            <template #default="{ row }">
              <span class="num">{{ row.runStart ? U.fmtFull(row.runStart) : '—' }}</span>
              <span v-if="extra(row)" style="color:var(--rpa-dim);font-size:11.5px;"> {{ extra(row) }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div class="rpa-hint">{{ hint }}</div>
    </div>
  </div>
</div>
`
});
