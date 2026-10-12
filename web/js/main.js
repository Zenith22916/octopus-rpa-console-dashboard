/* ============================================================================
 * main.js —— 应用入口：注册 Element Plus、挂载根组件、启动全局定时器
 * ========================================================================= */
import { createApp, installElement } from './vendor.js';
import { store, refreshData, parseHash } from './store.js';
import Root from './views/Root.js';
import { installShell } from './shell.js';

/* 等比缩放：桌面端把界面按窗口高度缩放（逻辑高度锁定 900 设计基准），
   任何分辨率下都刚好铺满一屏、不出现原生滚动条；手机端归 1
   （改用整页滚动布局，见 app.css 第 4 节）。 */
const BASE_H = 900;
function fitScale() {
  const mobile = window.matchMedia('(max-width: 880px)').matches;
  const s = mobile ? 1 : Math.min(1, window.innerHeight / BASE_H);
  document.documentElement.style.setProperty('--s', s.toFixed(4));
  document.documentElement.setAttribute('data-layout', mobile ? 'mobile' : 'desktop');
  return mobile;
}

/* 挂载前先把 store.view 对齐当前 hash：Root 的 route() 在 onMounted 里跑，
   若这里不预设，首帧会先渲染默认视图（分析页）再切走 —— 那一帧里
   分析页的图表会初始化、指标卡会被它写一遍，白白闪一下。 */
store.view = parseHash().name;

const app = createApp(Root);
installElement(app);
installShell(app);      // 全局轻提示 / 全局遮罩：供各视图组件以编程方式调用
app.mount('#app');

fitScale();
let fitRaf = 0;
window.addEventListener('resize', () => {
  if (fitRaf) return;
  fitRaf = requestAnimationFrame(() => {
    fitRaf = 0;
    fitScale();
    window.dispatchEvent(new CustomEvent('rpa:resize'));
  });
});
window.addEventListener('orientationchange', () => window.dispatchEvent(new CustomEvent('rpa:resize')));

/* ---------------- 自动更新 ----------------
   6s 轻量刷（最新 6 条增量合并，不触发后端抓取）+ 每 5min 按「数据范围」补拉一次兜底；
   抓取本身由后端常驻线程完成，这里只读库。 */
const AUTO_FULL_MS = 5 * 60 * 1000;
let lastFullTick = 0;
let autoTimer = null;

function autoTick() {
  if (store.view !== 'timeline' && store.view !== 'analysis') return;
  if (Date.now() - lastFullTick >= AUTO_FULL_MS) {
    lastFullTick = Date.now();
    refreshData(false, 'range');
  } else {
    refreshData(false, 'lite');
  }
}
function syncAutoTimer() {
  if (store.auto && !autoTimer) {
    autoTick();
    autoTimer = setInterval(autoTick, 6000);
  } else if (!store.auto && autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
}
window.addEventListener('rpa:auto-changed', syncAutoTimer);
syncAutoTimer();

/* 机器人状态页快刷：后端每 6s 轮询桌面 API underway，这里同步 6s 拉一次状态 */
setInterval(() => {
  if (store.view === 'botstatus' && store.auto) {
    window.dispatchEvent(new CustomEvent('rpa:botstatus-tick'));
  }
}, 6000);

/* 时间轴「现在」分界线推进（桌面端甘特图用；手机端无图表，自行按 5s 刷新在跑时长） */
setInterval(() => {
  if (store.view === 'timeline' && !window.matchMedia('(max-width: 880px)').matches) {
    window.dispatchEvent(new CustomEvent('rpa:timeline-tick'));
  }
}, 200);
setInterval(() => {
  if (store.view === 'timeline' && window.matchMedia('(max-width: 880px)').matches) {
    window.dispatchEvent(new CustomEvent('rpa:feed-tick'));
  }
}, 5000);

/* 排期页「当前时刻」横线每 6s 跟随一次（跨天时今天列底色自动切换） */
setInterval(() => {
  if (store.view === 'schedule') window.dispatchEvent(new CustomEvent('rpa:schedule-tick'));
}, 6000);

/* 首屏数据：先拉一次运行记录，再按 hash 进入视图 */
store.ready = false;
refreshData(false).then(() => { store.ready = true; });
