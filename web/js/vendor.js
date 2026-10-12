/* ============================================================================
 * vendor.js —— 第三方库的统一出口
 *
 * 本项目「免构建」：Vue 3 与 Element Plus 用官方 UMD 产物本地自托管
 * （web/vendor/，完全离线，不走 CDN），由 index.html 用普通 <script> 引入。
 * 页面脚本本身是原生 ES Module，通过这里把全局对象转成模块导出，
 * 这样各视图文件可以正常 `import { ref } from './vendor.js'`。
 *
 * 加载顺序约束（见 index.html 注释）：UMD 必须在本模块之前执行完毕。
 * ========================================================================= */

const V = window.Vue;
if (!V) throw new Error('Vue 未加载：请检查 /vendor/vue.global.prod.js 是否可访问');

export const {
  createApp, defineComponent, ref, reactive, computed, watch, watchEffect,
  onMounted, onBeforeUnmount, onActivated, onDeactivated, nextTick,
  h, toRefs, shallowRef, markRaw, provide, inject, toRaw
} = V;

/* Element Plus：UMD 全局（含全部组件）+ 图标集 + 中文语言包 */
export const EP = window.ElementPlus || {};
export const Icons = window.ElementPlusIconsVue || {};
export const localeZhCn = window.ElementPlusLocaleZhCn || null;

/* 全局注册 Element Plus：组件与图标都按名字注册，模板里可直接用 <el-table> / <el-icon><Refresh/></el-icon> */
export function installElement(app) {
  if (!window.ElementPlus) throw new Error('Element Plus 未加载：请检查 /vendor/element-plus.full.min.js');
  app.use(window.ElementPlus, localeZhCn ? { locale: localeZhCn } : {});
  Object.keys(Icons).forEach((name) => app.component(name, Icons[name]));
}
