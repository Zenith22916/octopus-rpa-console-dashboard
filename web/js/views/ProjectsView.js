/* ============================================================================
 * ProjectsView.js —— 项目控制台
 *
 * 左侧项目列表（头像色块 + 名称 + 配置组标签 + 更新时间），右侧详情两页签：
 *   「飞书配置」：配置组映射保存 / 加载配置项 / 新增或编辑配置（弹窗）
 *   「运行记录」：该应用的全部运行记录，点某条进日志详情
 * 顶部「▶ 运行该应用」走共用的机器人选择弹窗。
 *
 * 原实现里弹窗是手写 DOM + 一堆 getElementById，这里换成 el-dialog + el-form，
 * 校验（key 必填 / JSON 格式 / 类型约束）由表单规则承担。
 * ========================================================================= */
import { defineComponent, ref, reactive, computed, onMounted, watch } from '../vendor.js';
import { store, loadRuns, openRunDialog, setHeadMetrics, go } from '../store.js';
import { shell } from '../shell.js';
import { api } from '../api.js';
import * as U from '../util.js';

export default defineComponent({
  name: 'ProjectsView',
  setup() {
    const items = ref([]);          // 项目列表缓存
    const current = ref(null);      // 当前选中项目
    const cfgItems = ref([]);       // 当前配置项
    const sortBy = ref('time');
    const tab = ref('cfg');
    const loading = ref(false);
    const cfgLoading = ref(false);
    const group = ref('');          // 配置组输入框
    const cfgHint = ref('配置组用于关联该项目的飞书多维表格配置（group 列）。先保存映射，再加载配置；点「编辑」或「＋ 新增配置」在弹窗中修改。');
    const runsInfo = ref('该应用的全部运行记录，点击某条可查看日志详情。');

    /* ---------------- 项目列表 ---------------- */
    const sorted = computed(() => {
      const arr = items.value.slice();
      if (sortBy.value === 'name') {
        arr.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'zh'));
      } else {
        arr.sort((a, b) => (b.update_time || '').localeCompare(a.update_time || ''));
      }
      return arr;
    });

    function renderMetrics() {
      if (!items.value.length) { setHeadMetrics([]); return; }
      let mapped = 0;
      const groups = {};
      items.value.forEach((it) => {
        if (it.group) { mapped++; groups[it.group] = 1; }
      });
      setHeadMetrics([
        { k: '项目总数', v: items.value.length, color: '#378ADD' },
        { k: '已配映射', v: mapped, color: '#1D9E75' },
        { k: '未配映射', v: items.value.length - mapped, color: '#888780' },
        { k: '配置组数', v: Object.keys(groups).length, color: '#7F77DD' }
      ]);
    }

    function fmtTimeStr(s) {
      if (!s) return '—';
      const ms = Date.parse(s);
      return isNaN(ms) ? s : U.fmtFull(ms);
    }

    function load() {
      loading.value = true;
      shell.loading('正在加载项目列表…');
      return api.projects().then((d) => {
        if (d && Array.isArray(d.items)) {
          const keep = current.value ? current.value.flow_id : null;
          items.value = d.items;
          if (keep) {
            const hit = items.value.find((it) => it.flow_id === keep);
            if (hit) current.value = hit;
          }
          renderMetrics();
          /* 带 ?fid= 进入（详情页「项目配置」/ 排期页点标签）：选中对应项目 */
          if (store.pendingFid) {
            const fid = store.pendingFid;
            const has = items.value.some((it) => it.flow_id === fid);
            store.pendingFid = null;
            if (has) select(fid);
            else shell.toast('未在云端项目列表中找到该项目（flowId: ' + fid + '），可能已被删除或改名。', 'error');
          }
          if (current.value) group.value = current.value.group || '';
        } else {
          shell.toast('加载失败：' + ((d && d.error) || '未知错误'), 'error');
          setHeadMetrics([]);
        }
      }).catch((e) => {
        shell.toast('加载失败：' + (e && e.message ? e.message : e), 'error');
        setHeadMetrics([]);
      }).then(() => {
        loading.value = false;
        shell.hide();
      });
    }

    function select(fid) {
      current.value = items.value.find((it) => it.flow_id === fid) || null;
      if (!current.value) return;
      group.value = current.value.group || '';
      cfgItems.value = [];
      /* 带 ?tab=runs 进入（排期页点标签跳转）：直接落在「运行记录」tab 上 */
      tab.value = store.pendingTab === 'runs' ? 'runs' : 'cfg';
      store.pendingTab = null;
      if (tab.value === 'cfg' && current.value.group) loadCfg();
      if (tab.value === 'runs') loadRunsFor();
    }

    /* ---------------- 运行记录 ---------------- */
    const runs = ref([]);
    function loadRunsFor() {
      const p = current.value;
      if (!p) return;
      shell.loading('正在加载运行记录…');
      (store.records.length ? Promise.resolve(store.records) : loadRuns()).then(() => {
        runs.value = store.records
          .filter((r) => r.fid === p.flow_id)
          .sort((a, b) => (b.start || 0) - (a.start || 0));
        runsInfo.value = runs.value.length
          ? '共 ' + runs.value.length + ' 条运行记录（全量），展示最近 ' +
            Math.min(runs.value.length, 20) + ' 条；点击某条查看日志详情。'
          : '暂无运行记录（可点击标题右侧「运行该应用」触发一次）。';
        shell.hide();
      });
    }
    const runRows = computed(() => runs.value.slice(0, 20));
    const runDur = (r) => U.fmtDurM((r.end || Date.now()) - (r.execStart || r.start));
    const openRun = (r) => go('detail', { id: r.id });

    /* ---------------- 配置项 ---------------- */
    function loadCfg() {
      const g = (group.value || '').trim();
      if (!g) { shell.toast('请先填写配置组名', 'error'); return; }
      cfgLoading.value = true;
      shell.loading('正在加载配置…');
      return api.projectConfig(g).then((d) => {
        if (!d || !d.ok) {
          cfgItems.value = [];
          shell.toast((d && d.error) || '加载配置失败', 'error');
        } else {
          cfgItems.value = d.items || [];
          cfgHint.value = '配置组「' + g + '」共 ' + cfgItems.value.length +
            ' 个配置项；点「编辑」修改，或「＋ 新增配置」添加。';
        }
      }).then(() => {
        cfgLoading.value = false;
        shell.hide();
      });
    }
    function saveGroupMap() {
      const p = current.value;
      if (!p) return;
      const g = (group.value || '').trim();
      cfgPost({ group: 'project', key: 'p.' + p.flow_id, value: g, type: 'string' }, () => {
        p.group = g;
        renderMetrics();
        cfgHint.value = '映射已保存：项目 ↔ 配置组「' + (g || '（未关联）') + '」。';
        shell.toast('映射已保存');
      });
    }
    function cfgPost(body, onOk) {
      return api.projectConfigSave(body).then((j) => {
        if (j && j.ok) { if (onOk) onOk(j); }
        else shell.toast('保存失败：' + ((j && (j.error || j.msg)) || '未知错误'), 'error');
        return j;
      }).catch((e) => {
        shell.toast('请求失败：' + (e && e.message ? e.message : e), 'error');
        return { ok: false, error: String(e) };
      });
    }
    /* 展示用文本：json 自动解析排版换行 */
    function displayVal(it) {
      if (it.type === 'json') {
        try { return JSON.stringify(JSON.parse(it.value), null, 2); } catch (e) { return it.value; }
      }
      return it.value;
    }

    /* ---------------- 配置编辑弹窗 ---------------- */
    const dlg = reactive({
      open: false, isNew: true, key: '', type: 'string',
      value: '', desc: '', err: '', saving: false
    });
    /* value 的三种控件：bool 开关 / json 多行 / 其它单行 */
    const boolVal = ref(false);
    function openEditor(item, isNew) {
      dlg.open = true;
      dlg.isNew = !!isNew;
      dlg.key = item ? item.key : '';
      dlg.type = item ? item.type : 'string';
      dlg.desc = item ? (item.desc || '') : '';
      dlg.err = '';
      dlg.saving = false;
      const raw = item ? item.value : '';
      boolVal.value = (String(raw).trim().toLowerCase() === 'true' || String(raw) === '1');
      if (dlg.type === 'json') {
        try { dlg.value = JSON.stringify(JSON.parse(raw || '{}'), null, 2); }
        catch (e) { dlg.value = raw; }
      } else {
        dlg.value = raw;
      }
    }
    /* 切换类型：旧值按新类型重新排版（json 尝试格式化，失败保留原文） */
    function onTypeChange(type) {
      if (type === 'json') {
        try { dlg.value = JSON.stringify(JSON.parse(dlg.value || '{}'), null, 2); } catch (e) { /* 保留原文 */ }
      } else if (type === 'bool') {
        boolVal.value = (String(dlg.value).trim().toLowerCase() === 'true' || String(dlg.value) === '1');
      }
    }
    function saveCfg() {
      const g = (group.value || '').trim();
      if (!g) { dlg.err = '缺少配置组（请先在上方填写并保存映射）'; return; }
      if (!dlg.key.trim()) { dlg.err = '请填写 key'; return; }
      let value;
      if (dlg.type === 'bool') {
        value = boolVal.value ? 'true' : 'false';
      } else if (dlg.type === 'json') {
        try { JSON.parse(dlg.value); }
        catch (e) { dlg.err = 'JSON 格式错误：' + e.message; return; }
        value = dlg.value;
      } else {
        value = dlg.value;
      }
      dlg.err = '';
      dlg.saving = true;
      shell.loading('保存中…');
      cfgPost({
        group: g, key: dlg.key.trim(), value, type: dlg.type, desc: dlg.desc
      }, () => {
        dlg.open = false;      // 成功：关弹窗，由 loadCfg 接管「加载配置」遮罩
        loadCfg();
      }).then((j) => { if (!j || !j.ok) shell.hide(); dlg.saving = false; });
    }

    /* ---------------- 运行该应用 ---------------- */
    function runApp() {
      const p = current.value;
      if (!p) return;
      openRunDialog({
        endpoint: '/api/projects/run',
        flowId: p.flow_id,
        name: p.name || p.flow_id,
        onDone: () => setTimeout(() => { loadRuns().then(loadRunsFor); }, 3000)
      });
    }

    onMounted(() => {
      /* 进入时把待跳转参数先取出来（load() 里会消费 pendingFid） */
      load();
    });
    watch(() => store.records, () => { if (tab.value === 'runs' && current.value) loadRunsFor(); });

    return {
      store, items, sorted, current, cfgItems, sortBy, tab, loading, cfgLoading,
      group, cfgHint, runsInfo, runRows, runDur, dlg, boolVal,
      select, load, loadCfg, saveGroupMap, displayVal, openEditor, onTypeChange,
      saveCfg, runApp, loadRunsFor, fmtTimeStr, openRun, U,
      pjColor: U.pjColor,
      closeEditor: () => { dlg.open = false; }
    };
  },
  template: `
<div class="rpa-view">
  <div class="pj-layout">
    <!-- ==================== 左侧：项目列表 ==================== -->
    <div class="rpa-card pj-side">
      <div class="rpa-card-head">
        <h2 class="rpa-card-title">项目列表</h2>
        <el-select v-model="sortBy" size="small" style="width:112px">
          <el-option label="按修改时间" value="time" />
          <el-option label="按名称" value="name" />
        </el-select>
        <el-button size="small" :loading="loading" @click="load">刷新</el-button>
      </div>
      <div class="pj-list">
        <div v-for="it in sorted" :key="it.flow_id" class="pj-item"
             :class="{ sel: current && current.flow_id === it.flow_id }"
             @click="select(it.flow_id)">
          <div class="pj-item-top">
            <span class="pj-avatar" :style="{ background: pjColor(it.name) }">
              {{ it.name ? it.name.charAt(0) : '?' }}
            </span>
            <span class="pj-item-name">{{ it.name }}</span>
            <el-tag v-if="it.group" size="small" type="info">{{ it.group }}</el-tag>
          </div>
          <div class="pj-item-meta">
            {{ it.update_time ? it.update_time.slice(0, 16).replace('T', ' ') : '—' }}
            <template v-if="it.owner"> · {{ it.owner }}</template>
          </div>
        </div>
        <div v-if="!items.length && !loading" class="rpa-empty">暂无项目数据</div>
      </div>
      <div class="pj-foot">共 {{ items.length }} 个项目</div>
    </div>

    <!-- ==================== 右侧：项目详情 ==================== -->
    <div class="rpa-card pj-main">
      <div v-if="!current" class="rpa-empty">← 从左侧选择一个项目</div>

      <div v-else class="pj-detail">
        <div class="rpa-card-head">
          <h2 class="rpa-card-title">{{ current.name }}</h2>
          <el-radio-group v-model="tab" size="small">
            <el-radio-button value="cfg">飞书配置</el-radio-button>
            <el-radio-button value="runs">运行记录</el-radio-button>
          </el-radio-group>
          <el-button type="primary" size="small" @click="runApp"
                     title="选择执行机器人后立即触发一次执行">▶ 运行该应用</el-button>
        </div>
        <div style="font-size:11.5px;color:var(--rpa-dim);margin:-4px 0 8px;">
          flowId: {{ current.flow_id }} · 更新: {{ fmtTimeStr(current.update_time) }}
          <template v-if="current.owner"> · 负责人: {{ current.owner }}</template>
        </div>

        <!-- ---- 飞书配置 ---- -->
        <div v-show="tab === 'cfg'" class="pj-panel">
          <div class="pj-toolbar">
            <span style="font-size:12px;color:var(--rpa-dim);">配置组</span>
            <el-input v-model="group" size="small" style="width:150px" placeholder="如 qcc" />
            <el-button size="small" @click="saveGroupMap">保存映射</el-button>
            <el-button size="small" :loading="cfgLoading" @click="loadCfg">加载配置</el-button>
            <el-button size="small" type="primary" @click="openEditor(null, true)">＋ 新增配置</el-button>
          </div>
          <div class="rpa-scroll">
            <el-table :data="cfgItems" size="small" height="100%"
                      empty-text="该配置组暂无配置项，点右上「＋ 新增配置」添加。">
              <el-table-column prop="key" label="key" width="180" show-overflow-tooltip />
              <el-table-column label="value" min-width="260">
                <template #default="{ row }">
                  <pre class="mono" style="margin:0;white-space:pre-wrap;font-size:11.5px;max-height:90px;overflow:auto;">{{ displayVal(row) }}</pre>
                </template>
              </el-table-column>
              <el-table-column prop="type" label="type" width="86" />
              <el-table-column prop="desc" label="desc" min-width="180" show-overflow-tooltip />
              <el-table-column label="" width="80">
                <template #default="{ row }">
                  <el-button size="small" @click="openEditor(row, false)">编辑</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
          <div class="rpa-hint">{{ cfgHint }}</div>
        </div>

        <!-- ---- 运行记录 ---- -->
        <div v-show="tab === 'runs'" class="pj-panel">
          <div class="pj-toolbar">
            <el-button size="small" @click="loadRuns().then(loadRunsFor)">刷新</el-button>
            <span class="rpa-spacer"></span>
            <span style="font-size:11.5px;color:var(--rpa-dim);">{{ runsInfo }}</span>
          </div>
          <div class="rpa-scroll">
            <el-table :data="runRows" size="small" height="100%" empty-text="暂无运行记录"
                      @row-click="(r) => openRun(r)">
              <el-table-column label="状态" width="92">
                <template #default="{ row }">
                  <el-tag size="small" :type="U.statusTagType(row.status)" effect="dark">
                    {{ U.statusCN(row.status) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="robot" label="机器人" min-width="130" show-overflow-tooltip />
              <el-table-column label="触发方式" width="110">
                <template #default="{ row }">{{ U.wayCN(row.way) }}</template>
              </el-table-column>
              <el-table-column label="开始时间" width="128" class-name="num">
                <template #default="{ row }">{{ U.fmtTime(row.start) }}</template>
              </el-table-column>
              <el-table-column label="结束时间" width="128" class-name="num">
                <template #default="{ row }">{{ row.end == null ? '（进行中）' : U.fmtTime(row.end) }}</template>
              </el-table-column>
              <el-table-column label="时长" width="100" class-name="num">
                <template #default="{ row }">{{ runDur(row) }}</template>
              </el-table-column>
            </el-table>
          </div>
          <div class="rpa-hint">该应用的全部运行记录，点击某条可查看日志详情。</div>
        </div>
      </div>
    </div>
  </div>

  <!-- ==================== 配置编辑弹窗 ==================== -->
  <el-dialog v-model="dlg.open" :title="dlg.isNew ? '新增配置' : '编辑配置'" width="560px" append-to-body>
    <el-form label-width="72px" size="small">
      <el-form-item label="key">
        <el-input v-model="dlg.key" :disabled="!dlg.isNew" placeholder="组内短名，如 chunk_size" />
        <span v-if="!dlg.isNew" style="font-size:11px;color:var(--rpa-dim);">（不可修改）</span>
      </el-form-item>
      <el-form-item label="type">
        <el-select v-model="dlg.type" style="width:140px" @change="onTypeChange">
          <el-option label="string" value="string" />
          <el-option label="number" value="number" />
          <el-option label="bool" value="bool" />
          <el-option label="json" value="json" />
        </el-select>
      </el-form-item>
      <el-form-item label="value">
        <el-switch v-if="dlg.type === 'bool'" v-model="boolVal" />
        <el-input v-else-if="dlg.type === 'json'" v-model="dlg.value" type="textarea" :rows="7"
                  spellcheck="false" placeholder="JSON 对象/数组" />
        <el-input v-else v-model="dlg.value" />
      </el-form-item>
      <el-form-item label="desc">
        <el-input v-model="dlg.desc" type="textarea" :rows="3"
                  placeholder="说明（保存时自动去除换行）" />
      </el-form-item>
      <div style="color:#E24B4A;font-size:12px;min-height:16px;padding-left:72px;">{{ dlg.err }}</div>
    </el-form>
    <template #footer>
      <el-button @click="closeEditor">取消</el-button>
      <el-button type="primary" :loading="dlg.saving" @click="saveCfg">保存</el-button>
    </template>
  </el-dialog>
</div>
`
});
