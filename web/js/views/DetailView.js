/* ============================================================================
 * DetailView.js —— 运行记录详情（基础信息 + Monaco 只读日志查看器）
 *
 * 日志查看器整体迁移自原 app.js，功能一条不减：
 *   - 自定义 log 语法高亮 + rpa-dark 主题（对齐八爪鱼日志格式）
 *   - 异常行整行底色 / 行首标记 / 概览标尺
 *   - 关键词搜索 + 上一处/下一处导航 + 命中高亮
 *   - 超长行自动折叠（保留约 3 行预览 + 提示条，点行号展开/收起）
 *   - 多文件标签、分页「加载更多」、只重读当前文件的「刷新」
 *   - 复制当前日志文件的完整共享路径（localhost 走 clipboard，局域网 http 回落 execCommand）
 *   - 深链：从日志检索/合规看板跳来时带 ?kw= 与 ?file=，加载完成后自动定位
 * ========================================================================= */
import { defineComponent, ref, computed, onMounted, onBeforeUnmount, nextTick } from '../vendor.js';
import { store, loadRunDetail, go, openRunDialog, refreshData, setHeadMetrics } from '../store.js';
import { shell } from '../shell.js';
import { api } from '../api.js';
import * as U from '../util.js';

const LOG_PAGE = 5000;

/* Monaco 里跟屏幕宽度有关的选项：手机屏只有 300 多 px，
   缩略图（minimap）要吃掉近两成宽度而且根本看不清，概览标尺同理 */
function viewOptions(mobile) {
  return {
    minimap: { enabled: !mobile, renderCharacters: false, maxColumn: 150 },
    overviewRulerLanes: mobile ? 0 : 2,
    scrollbar: {
      verticalScrollbarSize: mobile ? 6 : 10,
      horizontalScrollbarSize: mobile ? 6 : 10, useShadows: false
    }
  };
}

/* ---- 行级别判定（0 普通 / 1 错误 / 2 警告 / 3 成功） ---- */
const LG_RE = /(error|exception|traceback|fail(?:ed)?|fatal|失败|错误|异常|中断|中止)|(warn(?:ing)?|timeout|retry|警告|重试|超时(?![[\[0-9]))|(success(?:ful)?|succeed|done|finish(?:ed)?|成功|完成)/gi;
const LG_EXC = /(已启用异常监控|触发错误处理的|忽略异常并执行)/;
function lineLevel(line) {
  if (!line || line.length > 20000) return 0;
  if (LG_EXC.test(line)) return 0;
  let lv = 0, m;
  LG_RE.lastIndex = 0;
  while ((m = LG_RE.exec(line)) !== null) {
    const c = m[1] ? 1 : (m[2] ? 2 : 3);
    if (c === 1) return 1;
    if (lv === 0 || c < lv) lv = c;
  }
  return lv;
}

/* ---- 超长行折叠 ----
   Monaco 不支持单行折叠，实现方式：截短该行文本（保留约 3 行宽预览）
   + 行下插入提示条（view zone），行号不变（单行替换单行），
   尾部增量追加按行号定位不受影响。 */
const FOLD = { keepRows: 2.5, minRows: 3, maps: [], zoneIds: [], pendingTop: null };

function foldCols(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i) > 0x2e80 ? 2 : 1;
  return n;
}
/* 截断点：保留约 keepCols 列，回退到最近空格让断点自然些 */
function foldCutPos(text, keepCols) {
  let cols = 0, i = 0, w;
  for (; i < text.length; i++) {
    w = text.charCodeAt(i) > 0x2e80 ? 2 : 1;
    if (cols + w > keepCols) break;
    cols += w;
  }
  if (i < text.length) {
    let j = i, back = 0;
    while (j > 0 && back < 80 && text.charAt(j - 1) !== " ") {
      j--; back += text.charCodeAt(j) > 0x2e80 ? 2 : 1;
    }
    if (j > 0 && text.charAt(j - 1) === " ") i = j;
  }
  return Math.max(1, i);
}

export default defineComponent({
  name: 'DetailView',
  setup() {
    const rec = ref(null);
    const notFound = ref(false);
    const files = ref([]);        // [{name,size,total,loaded,content,hasMore,pending}]
    const active = ref(0);
    const kw = ref('');
    const onlyErr = ref(false);
    const logMsg = ref('正在读取日志…');
    const logMsgType = ref('tip');   // tip | warn
    const editorReady = ref(false);
    const stat = ref({ total: 0, err: 0, warn: 0 });
    const navPos = ref('');
    const refreshBusy = ref(false);
    const copied = ref(false);
    const mobile = ref(window.matchMedia('(max-width: 880px)').matches);
    const logbox = ref(null);

    let editor = null;
    let models = [];
    let decos = [];
    let fileMarks = [];
    let matches = [];
    let cur = -1;
    let monacoReady = null;
    let langOK = false;
    let link = null;              // 深链 {kw, file}
    let kwTimer = 0;
    let copyFlash = 0;

    const activeFile = computed(() => files.value[active.value] || null);
    const logDir = computed(() => {
      const d = (rec.value && rec.value.log) ? String(rec.value.log) : '';
      return d.replace(/[\\/]+$/, '');
    });
    const activePath = computed(() => {
      const dir = logDir.value;
      if (!dir) return '';
      const f = activeFile.value;
      if (!f || !f.name) return dir;
      return dir + (dir.charAt(dir.length - 1) === '\\' ? '' : '\\') + f.name;
    });

    /* ---------------- 基础信息字段 ---------------- */
    const infoFields = computed(() => {
      const r = rec.value;
      if (!r) return [];
      const queueMs = (r.execStart && r.execStart > r.start) ? (r.execStart - r.start) : 0;
      const runFrom = (r.execStart && r.execStart > r.start) ? r.execStart : r.start;
      const runMs = (r.end == null) ? null : (r.end - runFrom);
      const out = [
        { k: '机器人', v: r.robot },
        { k: '状态', v: U.statusCN(r.status), tag: U.statusTagType(r.status) },
        { k: '触发方式', v: U.wayCN(r.way) }
      ];
      if (r.way && r.way !== 'Manual' && r.trigger) out.push({ k: '触发器', v: r.trigger });
      out.push({ k: '流程ID (flow_id)', v: r.fid || '—' });
      out.push({ k: '流程编号 (process_no)', v: r.pno || '—' });
      out.push({ k: '开始时间', v: U.fmtFull(r.start) });
      if (r.execStart) out.push({ k: '开始运行', v: U.fmtFull(r.execStart) });
      out.push({ k: '结束时间', v: r.end == null ? '进行中' : U.fmtFull(r.end), warn: r.end == null });
      if (queueMs) out.push({ k: '排队时长', v: U.fmtDur(queueMs) });
      if (runMs != null) out.push({ k: '运行时长', v: U.fmtDur(runMs) });
      return out;
    });

    /* ---------------- Monaco ---------------- */
    function ensureMonaco() {
      if (monacoReady) return monacoReady;
      monacoReady = new Promise((resolve, reject) => {
        if (!window.require) { reject(new Error('loader 未加载')); return; }
        window.require.config({ paths: { vs: '/monaco/vs' } });
        window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
      });
      return monacoReady;
    }

    function setupLanguage(monaco) {
      if (langOK) return;
      langOK = true;
      monaco.languages.register({ id: 'log' });
      monaco.languages.setMonarchTokensProvider('log', {
        ignoreCase: true,
        tokenizer: {
          root: [
            /* 行首级别（八爪鱼日志固定格式："级别 时间戳 【子流程】第N行【指令】：内容"） */
            [/^错误(?=\s)/, "level-error"],
            [/^(?:警告|告警)(?=\s)/, "level-warn"],
            [/^消息(?=\s)/, "level-muted"],
            [/\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?/, "timestamp"],
            [/\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?/, "timestamp"],
            [/【[^】\n]{1,40}】(?=[^】\n]{0,2}第\d+行)/, "flow"],
            [/【[^】\n]{1,40}】/, "step"],
            [/\[(?:fatal|exception|critical|error|失败|错误|异常|中止|中断)\]/, "level-error"],
            [/\[(?:warn(?:ing)?|警告|超时|重试)\]/, "level-warn"],
            [/\[(?:info|debug|trace|成功|完成)\]/, "level-info"],
            [/\[[^\[\]\n'",]{1,48}\]/, "tag"],
            [/已启用异常监控|触发错误处理的|忽略异常并执行|异常监控|异常处理|重试中|已启用异常/, "source"],
            [/\b(?:fatal|exception|critical)\b|\berror\b/, "level-error"],
            [/\bwarn(?:ing)?\b/, "level-warn"],
            [/\b(?:info|debug|trace)\b/, "level-info"],
            [/(?:页面|元素|网页)?加载超时|连接超时|未找到(?:页面)?元素/, "level-error"],
            [/失败|错误|异常|中止|中断/, "level-error"],
            [/警告|重试|超时(?![[\[0-9])/, "level-warn"],
            [/成功|完成/, "level-info"],
            [/'(?:[^'\\\n]|\\.)*'(?=\s*:)/, "dict-key"],
            [/"(?:[^"\\\n]|\\.)*"(?=\s*:)/, "dict-key"],
            [/'(?:[^'\\\n]|\\.)*'/, "string"],
            [/"(?:[^"\\\n]|\\.)*"/, "string"],
            /* Monarch 会把规则编译成 ^(?:…) 在当前位置匹配，后顾断言一律失效，只能靠捕获组 */
            [/(生成变量)(\s+)([^:：\n]{1,60}?)(?=\s*[:：])/, ["", "", "variable"]],
            [/\\\\[^\s"'|*<>?]*?(?=[\s,，。;；)）】]|$)|[A-Za-z]:\\[^\s"'|<>?]*?(?=[\s,，。;；)）】]|$)/, "path"],
            [/\b(?:true|false|null|none)\b/, "keyword"],
            [/[{}]/, "brace"],
            [/[\[\]]/, "bracket"],
            [/https?:\/\/[^\s"']+/, "url"],
            [/\b\d+(?:\.\d+)?\b/, "number"]
          ]
        }
      });
      monaco.editor.defineTheme('rpa-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'level-error', foreground: 'FF6B6D', fontStyle: 'bold' },
          { token: 'level-warn', foreground: 'FFB020' },
          { token: 'level-info', foreground: '4EC98C' },
          { token: 'level-muted', foreground: '6E7681' },
          { token: 'timestamp', foreground: '8A93A6' },
          { token: 'flow', foreground: '6FB3D2' },
          { token: 'step', foreground: '4EC9B0' },
          { token: 'variable', foreground: '9CDCFE' },
          { token: 'tag', foreground: '6FB3D2' },
          { token: 'url', foreground: '4A90D9' },
          { token: 'path', foreground: '7AA6C2' },
          { token: 'dict-key', foreground: '9CDCFE' },
          { token: 'string', foreground: 'CE9178' },
          { token: 'keyword', foreground: '569CD6' },
          { token: 'brace', foreground: '8A93A6' },
          { token: 'bracket', foreground: '8A93A6' },
          { token: 'number', foreground: 'C8D3E0' }
        ],
        colors: {
          'editor.background': '#0b0d11',
          'editor.foreground': '#cdd3da',
          'editorLineNumber.foreground': '#4a5160',
          'editorLineNumber.activeForeground': '#8b93a3',
          'editor.lineHighlightBackground': '#131720',
          'editor.selectionBackground': '#264f78',
          'minimap.background': '#0b0d11'
        }
      });
    }

    function createEditor() {
      if (!logbox.value) return Promise.reject(new Error('logbox 不存在'));
      return ensureMonaco().then((monaco) => {
        if (editor) return monaco;
        setupLanguage(monaco);
        editor = monaco.editor.create(logbox.value, {
          language: 'log',
          theme: 'rpa-dark',
          readOnly: true,
          automaticLayout: true,
          fontFamily: "Consolas, 'Microsoft YaHei', monospace",
          fontSize: 12.5,
          lineHeight: 20,
          minimap: { enabled: true, renderCharacters: false, maxColumn: 150 },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          contextmenu: false,
          folding: false,
          renderLineHighlight: 'line',
          occurrencesHighlight: false,
          selectionHighlight: false,
          lineNumbersMinChars: 4,
          overviewRulerLanes: 2,
          stickyScroll: { enabled: false },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false }
        });
        editor.updateOptions(viewOptions(mobile.value));
        /* 点击最左行号 / 行首箭头：展开或收起超长行（普通行不响应） */
        editor.onMouseDown((e) => {
          const mc = window.monaco, t = e.target;
          if (!mc || !t) return;
          if (t.type !== mc.editor.MouseTargetType.GUTTER_LINE_NUMBERS &&
            t.type !== mc.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
          const line = (t.position && t.position.lineNumber) || (t.range && t.range.startLineNumber);
          if (!line) return;
          foldToggle(active.value, line, FOLD.pendingTop);
        });
        /* 捕获阶段记录按下时的 scrollTop：Monaco 对行号点击会选中整行并 reveal 到行尾，
           超长行会瞬间位移上万 px，必须赶在它处理之前把「用户视线位置」记下来 */
        logbox.value.addEventListener('mousedown', () => {
          FOLD.pendingTop = editor ? editor.getScrollTop() : null;
        }, true);
        editorReady.value = true;
        return monaco;
      });
    }

    /* ---------------- 折叠 ---------------- */
    function foldWrapCol() {
      try {
        const wi = editor.getOption(window.monaco.editor.EditorOption.wrappingInfo);
        if (wi && wi.wrappingColumn > 20) return wi.wrappingColumn;
      } catch (e) { /* 取不到就兜底估算 */ }
      const w = logbox.value ? logbox.value.clientWidth : 0;
      return w > 100 ? Math.floor(w / 7.2) : 160;   // 12.5px 等宽字符宽约 7.2px
    }
    function foldScan(fi) {
      const monaco = window.monaco;
      const m = models[fi];
      if (!monaco || !m || !editor) return;
      const wrapCol = foldWrapCol();
      if (!(wrapCol > 20)) return;
      const map = FOLD.maps[fi] || (FOLD.maps[fi] = {});
      const minCols = wrapCol * FOLD.minRows;
      const keepCols = wrapCol * FOLD.keepRows;
      const edits = [];
      const lc = m.getLineCount();
      for (let i = 1; i <= lc; i++) {
        if (map[i]) continue;                       // 已管理（折叠中或手动展开过）不再处理
        const text = m.getLineContent(i);
        if (text.length * 2 <= minCols) continue;   // 快速排除（即使全 CJK 也达不到阈值）
        if (foldCols(text) <= minCols) continue;
        const rec2 = {
          origText: text,
          previewText: text.slice(0, foldCutPos(text, keepCols)) + ' …',
          estLines: Math.ceil(foldCols(text) / wrapCol),
          folded: true, zoneId: null
        };
        map[i] = rec2;
        edits.push({
          range: new monaco.Range(i, 1, i, text.length + 1),
          text: rec2.previewText, forceMoveMarkers: true
        });
      }
      if (!edits.length) return;
      m.applyEdits(edits);
      if (active.value === fi) foldReattach(fi);
    }
    function foldClearZones(acc) {
      (FOLD.zoneIds || []).forEach((id) => { try { acc.removeZone(id); } catch (e) { /* 已移除 */ } });
      FOLD.zoneIds = [];
      FOLD.maps.forEach((map) => {
        if (map) Object.keys(map).forEach((k) => { map[k].zoneId = null; });
      });
    }
    function foldReattach(fi) {
      const m = models[fi];
      if (!editor || !window.monaco || !m || editor.getModel() !== m) return;
      const map = FOLD.maps[fi] || {};
      editor.changeViewZones((acc) => {
        foldClearZones(acc);
        Object.keys(map).forEach((k) => {
          const r = map[k];
          if (!r.folded) return;
          const line = +k;
          const dom = document.createElement('div');
          dom.className = 'lg-fold-zone';
          dom.textContent = '⋯ 已折叠（约 ' + r.estLines + ' 行）· 点击行号展开';
          dom.addEventListener('click', () => {
            foldSetFolded(fi, line, false, FOLD.pendingTop);
            FOLD.pendingTop = null;
          });
          r.zoneId = acc.addZone({
            afterLineNumber: line, heightInLines: 1, domNode: dom, suppressMouseDown: true
          });
          FOLD.zoneIds.push(r.zoneId);
        });
      });
      foldApplyDecos(fi);
    }
    function foldApplyDecos(fi) {
      const monaco = window.monaco;
      const m = models[fi];
      if (!monaco || !m || !editor || editor.getModel() !== m) return;
      const d = decos[fi] || (decos[fi] = { marks: [], hits: [] });
      const opts = [];
      const map = FOLD.maps[fi] || {};
      Object.keys(map).forEach((k) => {
        const line = +k;
        opts.push({
          range: new monaco.Range(line, 1, line, 1),
          options: map[k].folded
            ? {
              glyphMarginClassName: 'lg-fold-closed',
              glyphMarginHoverMessage: { value: '点击最左行号展开完整内容' }
            }
            : {
              glyphMarginClassName: 'lg-fold-open', className: 'lg-fold-open-bg',
              glyphMarginHoverMessage: { value: '点击最左行号收起该行' }
            }
        });
      });
      d.folds = m.deltaDecorations(d.folds || [], opts);
    }
    function foldSetFolded(fi, line, folded, lockTop) {
      const monaco = window.monaco;
      const m = models[fi];
      const r = FOLD.maps[fi] && FOLD.maps[fi][line];
      if (!monaco || !m || !r || r.folded === folded || !editor) return;
      /* 锚定「点击前」的 scrollTop：折叠行上方内容恒定，锁死 scrollTop 即可让上方行
         与折叠行视觉第一行都不动。Monaco 对行号点击会选中整行并 reveal 到行尾
         （几百显示行的行会瞬间位移上万 px），随后内容高度骤变还可能 clamp，
         单次恢复会被覆盖 —— 因此用点击前记录的值，在 300ms 内逐帧锁回；
         用户一旦滚轮立即放行。 */
      const st = (typeof lockTop === 'number') ? lockTop : editor.getScrollTop();
      m.applyEdits([{
        range: new monaco.Range(line, 1, line, m.getLineMaxColumn(line)),
        text: folded ? r.previewText : r.origText, forceMoveMarkers: true
      }]);
      r.folded = folded;
      if (active.value === fi) foldReattach(fi);
      const until = Date.now() + 300;
      const dom = editor.getDomNode();
      let user = false;
      const onWheel = () => { user = true; };
      if (dom) dom.addEventListener('wheel', onWheel, { once: true, passive: true });
      (function lock() {
        const ed = editor;
        if (user || Date.now() > until || !ed) {
          if (dom) dom.removeEventListener('wheel', onWheel);
          return;
        }
        try {
          if (ed.getScrollTop() !== st) ed.setScrollTop(st, monaco.editor.ScrollType.Immediate);
        } catch (e) {
          if (dom) dom.removeEventListener('wheel', onWheel);
          return;
        }
        requestAnimationFrame(lock);
      })();
    }
    function foldToggle(fi, line, lockTop) {
      const map = FOLD.maps[fi];
      if (!map || !map[line]) { FOLD.pendingTop = null; return; }   // 普通行不响应
      foldSetFolded(fi, line, !map[line].folded, lockTop);
      FOLD.pendingTop = null;
    }

    /* ---------------- 模型同步与装饰 ---------------- */
    function syncModel(fi, offset, delta) {
      const monaco = window.monaco;
      const f = files.value[fi];
      if (!monaco || !f) return;
      let m = models[fi];
      if (!m) {
        m = models[fi] = monaco.editor.createModel(f.content, 'log');
        decos[fi] = { marks: [], hits: [] };
      } else if (offset === 0) {
        m.setValue(f.content);
        FOLD.maps[fi] = {};    // 重载首页：折叠状态清空重扫
      } else if (delta) {
        const last = m.getLineCount();
        const col = m.getLineMaxColumn(last);
        m.applyEdits([{
          range: new monaco.Range(last, col, last, col),
          text: (last > 1 || col > 1 ? '\n' : '') + delta,
          forceMoveMarkers: true
        }]);
      }
      foldScan(fi);
      scanMarks(fi);
      applyMarkDecos(fi);
      if (active.value === fi && editor && editor.getModel() !== m) {
        editor.setModel(m);
        /* 首次 setModel 时 foldScan 已先跑过（当时模型还没挂上编辑器，
           提示条/箭头被跳过），这里补挂 */
        foldReattach(fi);
        applyHits();
      }
    }
    function scanMarks(fi) {
      const m = models[fi];
      if (!m) { fileMarks[fi] = []; return; }
      const map = FOLD.maps[fi] || {};
      const marks = [];
      const lc = m.getLineCount();
      for (let i = 1; i <= lc; i++) {
        /* 折叠行的级别判定用原文（预览文本可能截掉了级别词） */
        const lv = lineLevel(map[i] ? map[i].origText : m.getLineContent(i));
        if (lv === 1 || lv === 2) marks.push({ line: i, lv });
      }
      fileMarks[fi] = marks;
    }
    function applyMarkDecos(fi) {
      const monaco = window.monaco;
      const m = models[fi];
      if (!m || !monaco) return;
      const d = decos[fi] || (decos[fi] = { marks: [], hits: [] });
      const opts = (fileMarks[fi] || []).map((mk) => ({
        range: new monaco.Range(mk.line, 1, mk.line, 1),
        options: {
          isWholeLine: true,
          className: mk.lv === 1 ? 'lg-line-err' : 'lg-line-warn',
          linesDecorationsClassName: mk.lv === 1 ? 'lg-glyph-err' : 'lg-glyph-warn',
          overviewRuler: {
            color: mk.lv === 1 ? '#FF6B6D' : '#FFB020',
            position: monaco.editor.OverviewRulerLane.Right
          }
        }
      }));
      d.marks = m.deltaDecorations(d.marks, opts);
      updateStat();
    }
    function applyHits() {
      const monaco = window.monaco;
      const fi = active.value;
      const m = models[fi];
      matches = [];
      if (!m || !monaco || !editor) { updateStat(); return; }
      /* 含关键词的折叠行先展开，保证搜索不漏 */
      const map = FOLD.maps[fi];
      if (map && kw.value) {
        const k = kw.value.toLowerCase();
        Object.keys(map).forEach((key) => {
          if (map[key].folded && map[key].origText.toLowerCase().indexOf(k) >= 0) {
            foldSetFolded(fi, +key, false);
          }
        });
      }
      const d = decos[fi] || (decos[fi] = { marks: [], hits: [] });
      const opts = [];
      if (kw.value) {
        const found = m.findMatches(kw.value, false, false, false, null, false, 20000);
        found.forEach((hit) => {
          const r = hit.range;
          matches.push({ line: r.startLineNumber, col: r.startColumn, len: r.endColumn - r.startColumn });
          opts.push({ range: r, options: { className: 'lg-hit', stickiness: 1 } });
        });
      }
      d.hits = m.deltaDecorations(d.hits, opts);
      updateStat();
    }

    /* ---------------- 统计与导航 ---------------- */
    function navTargets() {
      if (kw.value) return matches;
      return (fileMarks[active.value] || []).map((mk) => ({ line: mk.line, col: 1, len: 0 }));
    }
    function updateStat() {
      let e = 0, w = 0;
      fileMarks.forEach((arr) => (arr || []).forEach((mk) => { if (mk.lv === 1) e++; else w++; }));
      stat.value = { total: e + w, err: e, warn: w };
      navPos.value = navTargets().length ? ('第 ' + (cur >= 0 ? cur + 1 : 1) + '/' + navTargets().length + ' 处') : '';
    }
    function goTo(idx) {
      const list = navTargets();
      if (!editor || !list.length) return;
      if (idx < 0) idx = list.length - 1;
      if (idx >= list.length) idx = 0;
      cur = idx;
      const t = list[idx];
      editor.revealLineInCenter(t.line);
      editor.setSelection(new window.monaco.Range(t.line, t.col, t.line, t.col + (t.len || 0)));
      navPos.value = '第 ' + (idx + 1) + '/' + list.length + ' 处 · 第 ' + t.line + ' 行';
    }
    const hasNav = computed(() => stat.value.total > 0);

    /* ---------------- 文件标签与分页 ---------------- */
    function setActive(fi) {
      if (!files.value[fi]) return;
      active.value = fi;
      cur = -1;
      const f = files.value[fi];
      if (editor) {
        const m = models[fi];
        if (m) {
          editor.setModel(m);
          foldReattach(fi);    // 折叠提示条/箭头不随模型切换保留，切回时重挂
          applyHits();
        } else if (f.loaded === 0 && !f.pending) {
          loadPage(fi, 0);     // 首次切到该文件：加载首页，模型在返回后创建
        }
      }
      applyLink();
    }
    function loadPage(fi, offset) {
      const f = files.value[fi];
      if (!f || f.pending) return;
      f.pending = true;
      api.logPage(rec.value.log, f.name, offset, LOG_PAGE, false).then((d) => {
        f.pending = false;
        if (!d || !d.ok) return;
        if (offset === 0) f.content = '';
        const delta = d.content || '';
        if (delta) f.content += (f.content ? '\n' : '') + delta;
        f.loaded = offset + (d.lines || 0);
        f.hasMore = !!d.hasMore;
        if (f.loaded > f.total) f.total = f.loaded;
        if (editor) syncModel(fi, offset, delta);
        updateStat();
        applyLink();     // 深链：文件模型就绪后自动定位关键词
      }).catch(() => { f.pending = false; });
    }

    /* 深链定位：切到指定日志文件并把关键词搜索跑起来。
       文件按页异步加载，所以在「一页加载完」与「切换文件」后都要调用；
       模型还没就绪就原样保留 link 等下一次回调。 */
    function applyLink() {
      if (!link) return;
      if (link.file) {
        const idx = files.value.findIndex((f) => f.name === link.file);
        if (idx >= 0 && idx !== active.value) {
          link.file = null;      // 先清掉，避免 setActive 回调里再次进入选文件分支
          setActive(idx);
          return;
        }
        link.file = null;        // 找不到该文件：放弃选文件，只应用关键词
      }
      if (link.kw) {
        if (!models[active.value]) return;   // 目标文件还没加载完，等下一次回调
        kw.value = link.kw;
        applyHits();
        if (matches.length) goTo(0);
      }
      link = null;
    }

    /* ---------------- 日志目录读取 ---------------- */
    function loadLogs() {
      if (!rec.value || !rec.value.log) {
        logMsgType.value = 'tip';
        logMsg.value = '未配置该机器人的日志目录，无法确定日志路径。请在 config.json 的 robot_logs 中补充该机器人的共享日志目录（参考其他机器人配置）。';
        updateStat();
        return;
      }
      logMsgType.value = 'tip';
      logMsg.value = '正在读取日志目录…';
      api.logDir(rec.value.log).then((d) => {
        if (!d || !d.ok) {
          logMsgType.value = 'warn';
          logMsg.value = '⚠ 读取日志失败：' + ((d && d.error) || '未知错误');
          updateStat();
          return;
        }
        if (!d.logs || d.logs.length === 0) {
          logMsgType.value = 'tip';
          logMsg.value = '目录下没有 .log 文件。';
          updateStat();
          return;
        }
        files.value = d.logs.map((it) => ({
          name: it.name, size: it.size, total: it.lines || 0,
          loaded: 0, content: '', hasMore: false, pending: false
        }));
        logMsg.value = '';
        createEditor().then(() => {
          files.value.forEach((_, i) => loadPage(i, 0));
        }).catch((err) => {
          logMsgType.value = 'warn';
          logMsg.value = '⚠ 日志高亮组件加载失败（' + (err && err.message ? err.message : err) +
            '）。请确认 assets/monaco/ 与后端 /monaco/ 路由正常。';
        });
      }).catch((e) => {
        logMsgType.value = 'warn';
        logMsg.value = '⚠ 无法连接本地服务器（' + (e && e.message ? e.message : e) +
          '）。请确认 start_server.bat 正在运行。';
        updateStat();
      });
    }

    /* ---------------- 刷新：只重读当前日志文件 ----------------
       做的是「重读文件」，不是「重建页面」：
       以已加载行数为 offset 请求一页（&refresh=1），服务端额外返回 anchor（第 offset 行原文）
       与 total。anchor 与已加载的最后一行一致 → 文件只是尾部追加，把新行接到模型末尾，
       Monaco 增量追加不会动滚动位置，搜索词/仅看异常/折叠状态全都保留；
       anchor 不一致 → 文件被重写或轮转，退回整段重载。 */
    function lastLoadedLine(f) {
      const s = f.content || '';
      const i = s.lastIndexOf('\n');
      return i < 0 ? s : s.slice(i + 1);
    }
    function refreshFile() {
      if (refreshBusy.value) return;
      const fi = active.value;
      const f = files.value[fi];
      if (!f || !f.name || f.pending) { shell.toast('当前没有可刷新的日志文件', 'error'); return; }
      refreshBusy.value = true;
      const offset = f.loaded || 0;
      api.logPage(rec.value.log, f.name, offset, LOG_PAGE, true).then((d) => {
        refreshBusy.value = false;
        if (!d || !d.ok) { shell.toast('刷新失败：' + ((d && d.error) || '未知错误'), 'error'); return; }
        if (offset > 0 && d.anchor !== lastLoadedLine(f)) {
          reloadFile(fi, '日志文件已被重写，已重新载入');       // 轮转/覆盖：整段重载
          return;
        }
        const delta = d.content || '';
        f.size = d.size || f.size;
        f.total = d.total || f.total;
        if (!delta) {                                            // 没有新行：只同步元数据
          f.hasMore = !!d.hasMore;
          shell.toast('已是最新（共 ' + f.total + ' 行）');
          return;
        }
        f.content += (f.content ? '\n' : '') + delta;
        const hadMore = f.hasMore;   // 刷新前是否还有没载入的行：决定提示说「新增」还是「载入」
        f.loaded = offset + (d.lines || 0);
        f.hasMore = !!d.hasMore;
        syncModel(fi, offset, delta);   // 只往模型尾部追加，滚动位置与搜索状态都不动
        if (kw.value) applyHits();      // 有关键词时重算命中：新增行里的命中也要高亮、可跳转
        shell.toast('已刷新：' + f.name + (hadMore ? ' 载入 ' : ' 新增 ') +
          (d.lines || 0) + ' 行（共 ' + f.total + ' 行）');
      }).catch((e) => {
        refreshBusy.value = false;
        shell.toast('刷新失败：' + (e && e.message ? e.message : e), 'error');
      });
    }
    function reloadFile(fi, tip) {
      const f = files.value[fi];
      if (!f || f.pending) return;
      f.pending = true;
      const top = editor ? editor.getScrollTop() : 0;
      api.logPage(rec.value.log, f.name, 0, LOG_PAGE, true).then((d) => {
        f.pending = false;
        if (!d || !d.ok) { shell.toast('重新载入失败：' + ((d && d.error) || '未知错误'), 'error'); return; }
        f.content = d.content || '';
        f.loaded = d.lines || 0;
        f.total = d.total || f.loaded;
        f.size = d.size || f.size;
        f.hasMore = !!d.hasMore;
        if (editor) syncModel(fi, 0, f.content);
        foldReattach(fi);   // setValue 清空了折叠记录，残留的提示条要摘掉、新扫描的再挂上
        applyHits();        // 内容整体换过：命中列表与高亮重算
        if (editor && editor.getModel() === models[fi]) {
          editor.setScrollTop(top, window.monaco.editor.ScrollType.Immediate);   // 尽量停在原来的视口位置
        }
        if (tip) shell.toast(tip);
      }).catch((e) => {
        f.pending = false;
        shell.toast('重新载入失败：' + (e && e.message ? e.message : e), 'error');
      });
    }

    /* ---------------- 搜索 / 仅看异常 ---------------- */
    function onKwInput() {
      clearTimeout(kwTimer);
      kwTimer = setTimeout(() => {
        cur = -1;
        applyHits();
        if (kw.value && matches.length) goTo(0);
      }, 300);
    }
    function onKwEnter(e) { goTo(cur + (e.shiftKey ? -1 : 1)); }
    function toggleOnlyErr() {
      onlyErr.value = !onlyErr.value;
      if (onlyErr.value && !kw.value && (fileMarks[active.value] || []).length) goTo(0);
    }
    const prevHit = () => goTo(cur - 1);
    const nextHit = () => goTo(cur + 1);

    /* ---------------- 复制路径 ----------------
       排查时经常要把路径发给同事（粘到资源管理器地址栏即可打开），
       路径来自局域网共享（\\SX-01\Logs\…），手抄易错。 */
    function legacyCopy(text) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', 'readonly');
        ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
    function copyPath() {
      const f = activeFile.value;
      const isFile = !!(f && f.name);
      /* 共享目录没连上、文件清单读不出来时，退回复制记录里的日志目录 */
      const text = isFile ? activePath.value : logDir.value;
      if (!text) { shell.toast('该记录没有可复制的日志路径', 'error'); return; }
      const done = () => {
        shell.toast((isFile ? '已复制：' : '已复制日志目录：') + text);
        copied.value = true;
        clearTimeout(copyFlash);
        copyFlash = setTimeout(() => { copied.value = false; }, 1400);
      };
      const fail = () => shell.toast('复制失败，请手动选中路径复制', 'error');
      /* localhost 属安全上下文，走异步 API；局域网 http://IP:8000 不是安全上下文，
         navigator.clipboard 直接不存在，必须回落到 textarea + execCommand */
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done).catch(() => (legacyCopy(text) ? done() : fail()));
        return;
      }
      legacyCopy(text) ? done() : fail();
    }

    /* ---------------- 头部按钮 ---------------- */
    function rerun() {
      if (!rec.value) return;
      openRunDialog({
        endpoint: '/api/rerun',
        flowId: rec.value.fid,
        name: rec.value.name || rec.value.fid,
        /* 新运行要等后端下一轮抓取才会进库；这里先把内存里的数据重画一遍 */
        onDone: () => refreshData(false, 'range')
      });
    }
    function toProjects() {
      if (!rec.value || !rec.value.fid) {
        shell.toast('该记录缺少流程 ID，无法跳转项目配置', 'error');
        return;
      }
      go('projects', { fid: rec.value.fid });
    }
    function back() {
      const curHash = location.hash;
      history.back();
      setTimeout(() => { if (location.hash === curHash) go('timeline'); }, 300);
    }

    /* ---------------- 生命周期 ---------------- */
    function onResize() {
      const mob = window.matchMedia('(max-width: 880px)').matches;
      if (mob !== mobile.value) {
        mobile.value = mob;
        if (editor) editor.updateOptions(viewOptions(mob));
      }
    }
    onMounted(() => {
      const d = store.detail || {};
      link = (d.kw || d.file) ? { kw: d.kw || null, file: d.file || null } : null;
      if (!d.id) { notFound.value = true; setHeadMetrics([]); return; }
      loadRunDetail(d.id).then((r) => {
        rec.value = r;
        notFound.value = !r;
        setHeadMetrics(r ? [
          { k: '状态', v: U.statusCN(r.status), color: U.statusColorSolid(r) },
          { k: '触发方式', v: U.wayCN(r.way), color: '#7F77DD' },
          {
            k: '排队',
            v: (r.execStart && r.execStart > r.start) ? U.fmtDur(r.execStart - r.start) : '—',
            color: '#378ADD'
          },
          {
            k: '运行时长',
            v: r.end == null ? '进行中'
              : U.fmtDur(r.end - ((r.execStart && r.execStart > r.start) ? r.execStart : r.start)),
            color: '#1D9E75'
          }
        ] : []);
        nextTick(loadLogs);
      });
      window.addEventListener('rpa:resize', onResize);
    });
    onBeforeUnmount(() => {
      window.removeEventListener('rpa:resize', onResize);
      setHeadMetrics([]);
      /* 释放 Monaco：模型与实例随详情重建，避免常驻占内存 */
      if (editor) { try { editor.dispose(); } catch (e) { /* 已销毁 */ } editor = null; }
      models.forEach((m) => { if (m) { try { m.dispose(); } catch (e) { /* 已销毁 */ } } });
      models = []; decos = []; fileMarks = []; matches = [];
      FOLD.maps = []; FOLD.zoneIds = []; FOLD.pendingTop = null;
      clearTimeout(kwTimer);
    });

    return {
      store, rec, notFound, infoFields, files, active, activeFile, kw, onlyErr,
      logMsg, logMsgType, editorReady, stat, navPos, refreshBusy, copied, logbox,
      activePath, logDir, hasNav,
      setActive, loadPage, refreshFile, onKwInput, onKwEnter, toggleOnlyErr,
      prevHit, nextHit, copyPath, rerun, toProjects, back, U
    };
  },
  template: `
<div class="rpa-view dt-wrap">
  <div class="rpa-card" v-if="notFound">
    <div class="rpa-empty">未找到该运行记录。</div>
  </div>

  <template v-else-if="rec">
    <div class="rpa-card">
      <div class="rpa-card-head">
        <h2 class="rpa-card-title">{{ rec.name || '运行记录详情' }}</h2>
        <span class="rpa-spacer"></span>
        <el-button size="small" type="primary" @click="rerun"
                   title="选择执行机器人后触发一次运行">↻ 重新运行</el-button>
        <el-button size="small" @click="toProjects"
                   title="跳转到项目控制台并选中该项目">⚙ 项目配置</el-button>
        <el-button size="small" @click="back">← 返回上一页</el-button>
      </div>
      <el-descriptions :column="4" border size="small">
        <el-descriptions-item v-for="f in infoFields" :key="f.k" :label="f.k">
          <el-tag v-if="f.tag" size="small" :type="f.tag" effect="dark">{{ f.v }}</el-tag>
          <span v-else-if="f.warn" style="color:#EF9F27">{{ f.v }}</span>
          <span v-else class="mono">{{ f.v }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </div>

    <div class="rpa-card dt-log">
      <div class="dt-log-head">
        <h2 class="rpa-card-title">日志内容</h2>
        <el-button size="small" :loading="refreshBusy" :disabled="!activeFile"
                   @click="refreshFile"
                   title="只重新读取日志文件内容：新内容增量追加，滚动位置与搜索状态都保留">
          ↻ 刷新
        </el-button>
        <div class="dt-log-tools">
          <span class="dt-log-stat">
            <template v-if="stat.total">
              共 <b>{{ stat.total }}</b> 处 · 错误 <b class="s-err">{{ stat.err }}</b>
              · 警告 <b class="s-warn">{{ stat.warn }}</b>
            </template>
            <template v-else>未发现异常</template>
            <template v-if="navPos"> · {{ navPos }}</template>
          </span>
          <el-input v-model="kw" size="small" style="width:200px" clearable
                    placeholder="搜索关键词" :disabled="!editorReady"
                    @input="onKwInput" @keydown.enter="onKwEnter" />
          <el-button size="small" :disabled="!hasNav" @click="prevHit">上一处</el-button>
          <el-button size="small" :disabled="!hasNav" @click="nextHit">下一处</el-button>
          <el-button size="small" :type="onlyErr ? 'primary' : ''" :disabled="!stat.total"
                     @click="toggleOnlyErr">{{ onlyErr ? '聚焦异常' : '仅看异常' }}</el-button>
          <el-button size="small" :type="copied ? 'success' : ''" :disabled="!activePath"
                     @click="copyPath" title="复制当前日志文件的完整共享路径">复制路径</el-button>
        </div>
      </div>

      <div class="dt-tabs" v-if="files.length">
        <div v-for="(f, i) in files" :key="f.name" class="dt-tab" :class="{ on: i === active }"
             @click="setActive(i)"
             :title="f.name + '（' + U.fmtSize(f.size) + (f.total ? ' · ' + f.total + ' 行' : '') + '）'">
          <span class="nm">📄 {{ f.name }}</span>
          <span class="mt">{{ U.fmtSize(f.size) }}<template v-if="f.total"> · {{ f.total }} 行</template></span>
        </div>
        <el-button v-if="activeFile && activeFile.hasMore" size="small"
                   @click="loadPage(active, activeFile.loaded)">
          加载更多（剩 {{ Math.max(0, activeFile.total - activeFile.loaded) }} 行）
        </el-button>
        <span v-else-if="activeFile && activeFile.loaded"
              style="font-size:11px;color:var(--rpa-dim);align-self:center;">已全部加载</span>
      </div>

      <div ref="logbox" class="dt-logbox" :class="{ 'lg-only': onlyErr }">
        <div v-if="logMsg" :class="logMsgType">{{ logMsg }}</div>
      </div>
    </div>
  </template>
</div>
`
});
