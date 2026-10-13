/* ============================================================================
 * LogSearchView.js —— 全局日志检索
 *
 * 后端在「日志目录可访问」的运行记录里扫关键词，返回命中行 + 记录 id + 文件名；
 * 前端按「记录 + 文件」分组展示，点组头或任一行跳详情页（带 ?kw= 与 ?file=），
 * 由详情页的日志查看器自动定位到那一处。
 *
 * 分组标题/命中行里都高亮关键词；行首给「第 N 行」与级别标签（错误/警告）。
 * ========================================================================= */
import { defineComponent, ref, computed, onMounted, onBeforeUnmount, watch } from '../vendor.js';
import { store, loadRuns, setHeadMetrics, go } from '../store.js';
import { api } from '../api.js';
import * as U from '../util.js';

const LVL_CN = { all: '全部行', warn: '异常 + 警告', err: '仅错误' };

export default defineComponent({
  name: 'LogSearchView',
  setup() {
    const kw = ref('');
    const robot = ref('__ALL__');
    const days = ref('7');
    const lvl = ref('all');
    const busy = ref(false);
    const done = ref(null);       // 最近一次检索结果
    const robots = ref([]);

    /* 机器人下拉来自已加载的运行记录 */
    function fillRobots() {
      const names = [];
      store.records.forEach((r) => {
        if (r.robot && names.indexOf(r.robot) < 0) names.push(r.robot);
      });
      names.sort();
      robots.value = names;
      if (robot.value !== '__ALL__' && names.indexOf(robot.value) < 0) robot.value = '__ALL__';
    }

    /* 同一文件一组：组内共享同一条运行记录（rid）与文件名，点组头或任一行都跳该条记录日志 */
    const groups = computed(() => {
      const d = done.value;
      if (!d || !d.ok) return [];
      const out = [];
      const byKey = {};
      (d.hits || []).forEach((h) => {
        const key = h.rid + '\u0000' + h.file;
        let g = byKey[key];
        if (!g) {
          g = byKey[key] = {
            rid: h.rid, file: h.file, robot: h.robot, name: h.name,
            start: h.start, hits: []
          };
          out.push(g);
        }
        g.hits.push(h);
      });
      return out;
    });
    const scanned = computed(() => (done.value && done.value.scanned) || {});
    const info = computed(() => {
      const d = done.value;
      if (!d || !d.ok) return '—';
      return '扫描 ' + (scanned.value.records || 0) + ' 条记录 / ' +
        (scanned.value.files || 0) + ' 个文件 · 最近 ' + d.days + ' 天';
    });
    const hint = computed(() => {
      const d = done.value;
      if (!d || !d.ok) return '在机器人本机共享日志目录里检索关键词（只扫本机可访问的目录）。';
      return '候选 ' + (d.candidates || 0) + ' 条记录（最近 ' + d.days +
        ' 天内且本机日志目录可访问），级别筛选「' + (LVL_CN[d.lvl] || '全部行') + '」。' +
        (d.truncated ? '已扫满上限（扫描 ' + (scanned.value.records || 0) + '/' + (d.candidates || 0) +
          ' 条记录）：请缩小机器人范围或时间窗，或改用「异常 + 警告」。' : '') +
        ' 点组头或任一行直达该条运行记录的日志，自动带上关键词与文件定位。';
    });

    function renderMetrics() {
      const d = done.value;
      if (!d || !d.ok) { setHeadMetrics([]); return; }
      setHeadMetrics([
        { k: '命中行', v: (d.hits || []).length, color: '#D85A30' },
        { k: '命中日志文件', v: groups.value.length, color: '#378ADD' },
        { k: '候选记录', v: d.candidates || 0, color: '#7F77DD' },
        { k: '扫描行数', v: scanned.value.lines || 0, color: '#888780' }
      ]);
    }

    function search() {
      const q = (kw.value || '').trim();
      if (q.length < 2) { done.value = { ok: false, error: '请输入至少 2 个字符的关键词。' }; renderMetrics(); return; }
      if (busy.value) return;
      busy.value = true;
      api.logsearch({ q, robot: robot.value, days: days.value, lvl: lvl.value })
        .then((d) => { done.value = d; renderMetrics(); })
        .catch((e) => {
          done.value = { ok: false, error: '检索失败：' + (e && e.message ? e.message : e) };
          renderMetrics();
        })
        .then(() => { busy.value = false; });
    }

    function openHit(g) {
      const q = (done.value && done.value.q) || '';
      go('detail', { id: g.rid, kw: q, file: g.file || '' });
    }

    /* 关键词高亮：先转义 HTML，再对转义后的关键词做替换，避免 XSS 与错位 */
    function highlight(text) {
      const raw = String(text == null ? '' : text);
      const q = (done.value && done.value.q) || '';
      if (!q) return raw;
      const i = raw.toLowerCase().indexOf(q.toLowerCase());
      if (i < 0) return raw;
      return [
        { t: raw.slice(0, i), hit: false },
        { t: raw.slice(i, i + q.length), hit: true },
        { t: raw.slice(i + q.length), hit: false }
      ];
    }
    function lvTag(l) {
      if (l === 1) return { cn: '错误', bg: 'rgba(226,75,74,0.18)', color: '#E24B4A' };
      if (l === 2) return { cn: '警告', bg: 'rgba(239,159,39,0.18)', color: '#EF9F27' };
      return null;
    }

    /* 筛选变化时若已有结果，自动重检（与原实现一致） */
    function refilter() { if (done.value && done.value.ok) search(); }

    watch(() => store.records, fillRobots);
    onMounted(() => {
      (store.records.length ? Promise.resolve() : loadRuns()).then(fillRobots);
    });
    onBeforeUnmount(() => setHeadMetrics([]));

    return {
      store, kw, robot, days, lvl, busy, done, robots, groups, scanned, info, hint,
      search, openHit, highlight, lvTag, refilter, U, LVL_CN
    };
  },
  template: `
<div class="rpa-view">
  <div class="rpa-card" style="flex:1 1 auto;">
    <div class="rpa-card-head">
      <h2 class="rpa-card-title">全局日志检索</h2>
      <span style="font-size:12px;color:var(--rpa-dim);">关键词</span>
      <el-input v-model="kw" size="small" style="width:240px" clearable
                placeholder="如 超时 / Timeout / 异常 / 未找到元素"
                @keydown.enter="search" />
      <span style="font-size:12px;color:var(--rpa-dim);">机器人</span>
      <el-select v-model="robot" size="small" style="width:150px" filterable @change="refilter">
        <el-option label="全部机器人" value="__ALL__" />
        <el-option v-for="r in robots" :key="r" :label="r" :value="r" />
      </el-select>
      <span style="font-size:12px;color:var(--rpa-dim);">范围</span>
      <el-select v-model="days" size="small" style="width:110px" @change="refilter">
        <el-option label="最近 1 天" value="1" />
        <el-option label="最近 3 天" value="3" />
        <el-option label="最近 7 天" value="7" />
      </el-select>
      <span style="font-size:12px;color:var(--rpa-dim);">级别</span>
      <el-select v-model="lvl" size="small" style="width:130px" @change="refilter"
                 title="「超时」这类词会命中大量等待进度行，只看异常可直接过滤掉噪声">
        <el-option label="全部行" value="all" />
        <el-option label="异常 + 警告" value="warn" />
        <el-option label="仅错误" value="err" />
      </el-select>
      <el-button type="primary" size="small" :loading="busy" @click="search">检索</el-button>
      <span class="rpa-spacer"></span>
      <span style="font-size:11.5px;color:var(--rpa-dim);">{{ info }}</span>
    </div>

    <div class="rpa-scroll">
      <div v-if="!done" class="rpa-empty">输入关键词后点「检索」，或直接回车。</div>
      <div v-else-if="!done.ok" class="rpa-empty">{{ done.error }}</div>
      <div v-else-if="!groups.length" class="rpa-empty">
        最近 {{ done.days }} 天内没有匹配「{{ done.q }}」的日志行。
      </div>
      <template v-else>
        <div v-for="g in groups" :key="g.rid + g.file" class="ls-group">
          <div class="ls-group-head" @click="openHit(g)" title="点击查看该条记录的完整日志">
            <span class="ls-g-robot">{{ g.robot }}</span>
            <span class="ls-g-file">{{ g.file }}</span>
            <span class="ls-g-count">命中 {{ g.hits.length }} 处</span>
            <span class="ls-g-time" v-if="g.start">{{ U.fmtFull(g.start) }}</span>
            <span class="ls-g-go">打开日志 →</span>
          </div>
          <div class="ls-group-body">
            <div v-for="(h, i) in g.hits" :key="i" class="ls-hitrow"
                 @click="openHit(g)" title="点击查看该条记录的完整日志">
              <span class="ls-lineno">第 {{ h.line }} 行</span>
              <span v-if="lvTag(h.lvl)" class="ls-lv"
                    :style="{ '--c': lvTag(h.lvl).color }">
                {{ lvTag(h.lvl).cn }}
              </span>
              <span class="ls-hit-text">
                <template v-for="(seg, j) in highlight(h.text)" :key="j">
                  <mark v-if="seg.hit">{{ seg.t }}</mark><template v-else>{{ seg.t }}</template>
                </template>
              </span>
            </div>
          </div>
        </div>
      </template>
    </div>

    <div class="rpa-hint">{{ hint }}</div>
  </div>
</div>
`
});
