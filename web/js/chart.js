/* ============================================================================
 * chart.js —— ECharts 实例的 Vue 生命周期封装
 *
 * 原实现是「手动 echarts.init + 各视图自己记住实例 + resize 时逐个 resize()」，
 * 这里抽成一个小工具：容器 ref 进入视图时 init，卸载时 dispose，
 * 窗口/断点变化（rpa:resize）与容器自身尺寸变化（ResizeObserver）时自动 resize。
 * ========================================================================= */
import { onMounted, onBeforeUnmount, shallowRef } from './vendor.js';

/* 创建一个与容器绑定的图表句柄。
   setOption(option) 会带上 lazyUpdate，一帧内多次调用会被合并（与原 tlRender 一致）。 */
export function useChart(elRef) {
  const chart = shallowRef(null);
  let ro = null;

  function init() {
    if (chart.value || !elRef.value || !window.echarts) return chart.value;
    chart.value = window.echarts.init(elRef.value);
    /* 容器尺寸变化就跟着重算：视图切换（display:none → flex）、
       面板折叠、断点换布局都会改容器尺寸，只监听 window.resize 会漏 */
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => resize());
      ro.observe(elRef.value);
    }
    return chart.value;
  }
  function setOption(option, opts) {
    if (!chart.value) init();
    if (chart.value) chart.value.setOption(option, Object.assign({ lazyUpdate: true }, opts || {}));
  }
  function resize() {
    if (chart.value) chart.value.resize();
  }
  function dispose() {
    if (ro) { ro.disconnect(); ro = null; }
    if (chart.value) {
      try { chart.value.dispose(); } catch (e) { /* 已销毁 */ }
      chart.value = null;
    }
  }

  onMounted(() => {
    init();
    window.addEventListener('rpa:resize', resize);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('rpa:resize', resize);
    dispose();
  });

  return { chart, init, setOption, resize, dispose };
}
