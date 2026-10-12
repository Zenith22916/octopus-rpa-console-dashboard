/* ============================================================================
 * shell.js —— 全局轻提示与全局加载遮罩
 *
 * 原实现里这两块是「动态创建 DOM + 手写定时器」（lgToast / glShow），
 * 这里改为「共享响应式状态 + 两个极薄的 Vue 组件」：
 * 任何模块都能直接 import { shell } 调用，不依赖组件树。
 *   shell.toast('已复制');  shell.loading('保存中…');  shell.hide();
 * ========================================================================= */
import { defineComponent, h, reactive } from './vendor.js';

const toastState = reactive({ show: false, msg: '', type: 'success' });
const loadingState = reactive({ show: false, msg: '加载中…' });

let toastTimer = 0;

export const shell = {
  /* 轻提示：2.4s 自动消失；type='error' 时红底 */
  toast(msg, type) {
    toastState.msg = msg;
    toastState.type = type || 'success';
    toastState.show = true;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastState.show = false; }, 2400);
  },
  /* 全屏遮罩：防加载中误操作 */
  loading(msg) {
    loadingState.msg = msg || '加载中…';
    loadingState.show = true;
  },
  hide() { loadingState.show = false; }
};

export const ShellToast = defineComponent({
  name: 'ShellToast',
  setup() {
    return () => {
      if (!toastState.show) return null;
      const isErr = toastState.type === 'error';
      return h('div', {
        style: {
          position: 'fixed', left: '50%', bottom: '48px', transform: 'translateX(-50%)',
          zIndex: 3200, padding: '9px 18px', borderRadius: '10px', fontSize: '12.5px',
          background: isErr ? 'rgba(226,75,74,.94)' : 'rgba(26,31,40,.96)',
          border: '1px solid ' + (isErr ? 'rgba(255,120,120,.6)' : 'rgba(255,255,255,.16)'),
          color: isErr ? '#fff' : '#e8ebf1', boxShadow: '0 12px 32px -14px rgba(0,0,0,.9)',
          maxWidth: '80vw', textAlign: 'center'
        }
      }, toastState.msg);
    };
  }
});

export const ShellLoading = defineComponent({
  name: 'ShellLoading',
  setup() {
    return () => {
      if (!loadingState.show) return null;
      return h('div', { class: 'rpa-loading' }, [
        h('div', { class: 'box' }, [
          h('span', { class: 'el-icon is-loading' }, [
            h('svg', { viewBox: '0 0 1024 1024', width: '16', height: '16' }, [
              h('path', {
                fill: 'currentColor',
                d: 'M512 64a32 32 0 0 1 32 32v192a32 32 0 0 1-64 0V96a32 32 0 0 1 32-32zm0 640a32 32 0 0 1 32 32v192a32 32 0 1 1-64 0V736a32 32 0 0 1 32-32zm448-192a32 32 0 0 1-32 32H736a32 32 0 1 1 0-64h192a32 32 0 0 1 32 32zm-640 0a32 32 0 0 1-32 32H96a32 32 0 0 1 0-64h192a32 32 0 0 1 32 32z'
              })
            ])
          ]),
          h('span', null, loadingState.msg)
        ])
      ]);
    };
  }
});

/* 挂到 app 上：两个组件固定在根层级（不受各视图 display 切换影响），
   同时把命令式接口挂到全局属性，模板里可直接用 this.$shell.toast(...) */
export function installShell(app) {
  app.component('ShellToast', ShellToast);
  app.component('ShellLoading', ShellLoading);
  app.config.globalProperties.$shell = shell;
  return shell;
}
