/* ============================================================================
 * RunDialog.js —— 运行机器人选择弹窗
 *
 * 详情页「重新运行」与项目控制台「运行该应用」共用（原 runOpenDialog/runConfirm）。
 * 三组机器人：本流程运行过的 / 在线可用的其他 / 离线或已停用（默认收起）；
 * 另有「不指定，由平台分配」项。默认选中后端推荐的机器人。
 * ========================================================================= */
import { defineComponent, ref, computed, watch } from '../vendor.js';
import { store, closeRunDialog, confirmRun } from '../store.js';
import { STATUS_CN, fmtTime, fmtDur } from '../util.js';

export default defineComponent({
  name: 'RunDialog',
  setup() {
    const picked = ref('');
    const showOffline = ref(false);

    const groups = computed(() => {
      const items = store.runDialog.items || [];
      const g = [
        { title: '本流程运行过的机器人', rows: [] },
        { title: '在线可用的其他机器人', rows: [] },
        { title: '离线 / 已停用机器人', rows: [] }
      ];
      items.forEach((b) => {
        g[b.runs ? 0 : ((b.connected && b.enabled !== false) ? 1 : 2)].rows.push(b);
      });
      return g;
    });
    /* 「不指定」的说明文字：有推荐机器人就提示会复用它 */
    const autoHint = computed(() => {
      const items = store.runDialog.items || [];
      const rec = items.find((b) => b.recommended);
      return rec ? '将复用本流程最近运行的「' + rec.name + '」'
        : '该流程无历史运行记录，可能分配到无权限的机器人';
    });
    const pickedName = computed(() => {
      if (!picked.value) return '不指定（平台分配）';
      const hit = (store.runDialog.items || []).find((b) => b.bot_id === picked.value);
      return hit ? (hit.name || hit.bot_id) : picked.value;
    });

    /* 每次打开弹窗重置选择：默认选中后端推荐的机器人，没有则「不指定」 */
    watch(() => [store.runDialog.open, store.runDialog.items], () => {
      if (!store.runDialog.open) return;
      showOffline.value = false;
      picked.value = store.runDialog.recommended || '';
    });

    function meta(b) {
      const m = [];
      if (b.machine) m.push('机器 ' + b.machine);
      m.push(b.connected === false ? '离线' : '在线');
      if (b.enabled === false) m.push('已停用');
      if (b.busy) m.push('有任务在跑');
      if (b.runs) {
        const t = Date.parse(b.last_time);
        m.push('本流程跑过 ' + b.runs + ' 次' + (isNaN(t) ? '' : ' · 最近 ' + fmtTime(t))
          + (b.last_status ? '（' + (STATUS_CN[b.last_status] || b.last_status) + '）' : ''));
      }
      return m;
    }
    const isOff = (b) => (b.connected === false || b.enabled === false);

    return {
      store, picked, showOffline, groups, autoHint, pickedName, meta, isOff,
      closeRunDialog, fmtDur,
      submit() { confirmRun(picked.value); }
    };
  },
  template: `
<el-dialog :model-value="store.runDialog.open" title="选择执行机器人" width="620px"
           :close-on-click-modal="true" append-to-body
           @update:model-value="closeRunDialog">
  <div class="run-sub">
    将立即触发一次执行：「<b>{{ store.runDialog.name }}</b>」
  </div>

  <div class="run-bot-list">
    <div v-if="store.runDialog.items === null" class="run-bot-empty">正在读取机器人列表…</div>
    <template v-else>
      <label class="run-bot-item auto">
        <el-radio v-model="picked" value="" />
        <span class="run-bot-body">
          <span class="run-bot-name">不指定，由平台分配</span>
          <span class="run-bot-meta">{{ autoHint }}</span>
        </span>
      </label>

      <template v-for="(g, gi) in groups" :key="g.title">
        <template v-if="g.rows.length">
          <el-button v-if="gi === 2" link type="primary" @click="showOffline = !showOffline"
                     style="align-self:flex-start;">
            {{ showOffline ? '收起这 ' + g.rows.length + ' 台' : '显示 ' + g.rows.length + ' 台' }}离线 / 已停用机器人
            <el-icon><component :is="showOffline ? 'ArrowUp' : 'ArrowDown'" /></el-icon>
          </el-button>
          <div v-show="gi !== 2 || showOffline">
            <div class="run-bot-group">{{ g.title }}</div>
            <label v-for="b in g.rows" :key="b.bot_id"
                   class="run-bot-item" :class="{ off: isOff(b) }">
              <el-radio v-model="picked" :value="b.bot_id" />
              <span class="run-bot-body">
                <span class="run-bot-name">
                  {{ b.name || b.bot_id }}
                  <i v-if="b.recommended" class="run-bot-tag">推荐</i>
                </span>
                <span class="run-bot-meta">
                  <template v-for="(m, i) in meta(b)" :key="i">
                    <span :class="{ 'run-bot-bad': /离线|已停用|有任务在跑/.test(m) }">{{ m }}</span>
                    <span v-if="i < meta(b).length - 1"> · </span>
                  </template>
                </span>
              </span>
            </label>
          </div>
        </template>
      </template>
    </template>
  </div>

  <div class="run-err">{{ store.runDialog.err }}</div>

  <template #footer>
    <el-button @click="closeRunDialog">取消</el-button>
    <el-button type="primary" :loading="store.runDialog.busy" @click="submit">
      ▶ 确认运行
    </el-button>
  </template>
</el-dialog>
`
});
