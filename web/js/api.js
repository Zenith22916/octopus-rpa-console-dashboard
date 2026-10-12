/* ============================================================================
 * api.js —— 后端接口访问层（统一 401 跳登录、统一 JSON 解析）
 * 对应 core/local_server.py 的 /api/* 路由；只做「请求 + 解析」，不做业务加工。
 * ========================================================================= */

/* 统一请求：401 直接跳登录页（与原 app.js 的 api() 行为一致） */
export function request(url, options) {
  const opt = Object.assign({ credentials: 'same-origin' }, options || {});
  return fetch(url, opt).then((r) => {
    if (r.status === 401) {
      location.href = '/login';
      throw new Error('unauthorized');
    }
    return r.json();
  });
}
export const get = (url) => request(url);
export const post = (url, body) => request(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {})
});

const qs = (o) => Object.keys(o)
  .filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== '')
  .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(o[k]))
  .join('&');

export const api = {
  /* 运行记录：limit=最新 N 条；since=与 now-since 有交集的记录 */
  runs: (opts) => get('/api/runs' + (opts ? '?' + qs(opts) : '')),
  run: (id) => get('/api/run?id=' + encodeURIComponent(id)),
  bots: (flowId) => get('/api/bots?flow_id=' + encodeURIComponent(flowId)),
  schedule: () => get('/api/schedule'),
  scheduleExportUrl: (view, robot, status) =>
    '/api/schedule/export?' + qs({ view, robot, status }),
  botstatus: () => get('/api/botstatus'),
  compliance: (days) => get('/api/compliance?' + qs({ days })),
  logsearch: (p) => get('/api/logsearch?' + qs(p)),
  projects: () => get('/api/projects'),
  projectConfig: (group) => get('/api/projects/config?' + qs({ group })),
  projectConfigSave: (payload) => post('/api/projects/config', payload),
  /* 日志目录清单 / 单文件分页内容（refresh=1 时额外返回 anchor 与 total） */
  logDir: (dir) => get('/api/log?' + qs({ dir })),
  logPage: (dir, file, offset, limit, refresh) =>
    get('/api/log?' + qs({ dir, file, offset, limit, refresh: refresh ? 1 : undefined })),
  /* 触发运行：立刻全量抓取 / 重新运行 / 运行该应用 */
  refresh: () => post('/api/refresh?force=1', {}),
  rerun: (payload) => post('/api/rerun', payload),
  projectRun: (payload) => post('/api/projects/run', payload)
};

/* 下载文件（xlsx 等）：读 Content-Disposition 里的中文文件名，失败回落到默认名 */
export function download(url, fallbackName) {
  return fetch(url, { credentials: 'same-origin' }).then((res) => {
    if (res.status === 401) { location.href = '/login'; return null; }
    const ct = res.headers.get('Content-Type') || '';
    if (ct.indexOf('json') >= 0) {
      // 无数据 / 生成失败：后端返回 JSON 说明，转成异常交给调用方提示
      return res.json().then((d) => { throw new Error((d && d.error) || '导出失败'); });
    }
    let name = fallbackName;
    const m = /filename\*=UTF-8''([^;]+)/i.exec(res.headers.get('Content-Disposition') || '');
    if (m) { try { name = decodeURIComponent(m[1]); } catch (e) { /* 用默认名 */ } }
    return res.blob().then((blob) => ({ blob, name }));
  }).then((o) => {
    if (!o) return;
    const href = URL.createObjectURL(o.blob);
    const a = document.createElement('a');
    a.href = href; a.download = o.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 5000);
  });
}
