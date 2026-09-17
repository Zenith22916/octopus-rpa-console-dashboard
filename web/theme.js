/* ============================================================================
 * theme.js — 装饰与适配层
 * 1) 视口等比缩放：把界面按窗口高度等比缩放（逻辑高度锁定 900 设计基准），
 *    宽度随视口自动放宽。效果：任何分辨率/窗口尺寸下都刚好铺满一屏，
 *    永远不出现浏览器原生滚动条。缩放系数写入 CSS 变量 --s，由 theme.css 消费。
 * 2) 跟随鼠标的氛围光晕（样式在 theme.css 的 .cursor-glow）。
 * 不读取/不修改任何业务数据，不干预 app.js 的渲染，出错静默降级。
 * 维护：删掉 index.html 里的 theme.js 引用即可完全移除。
 * ========================================================================= */
(function () {
  "use strict";

  /* ---------------------------------------------------- 1. 视口等比缩放 */
  try {
    var BASE_H = 900;                      // 设计基准高度：逻辑高度不低于此值
    var MOBILE_Q = "(max-width: 880px)";   // 与 mobile.css 的断点保持一致
    var root = document.documentElement;

    /* 手机端由 mobile.css 整体换一套布局（自然文档流 + 整页滚动），
       与桌面端「等比缩放铺满一屏」是互斥的两套策略：这里必须把 --s 归 1，
       否则 .app 仍会按逻辑尺寸放大再缩回，和 mobile.css 打架。
       判定结果同时写到 html[data-layout]，便于调试与按设备分流样式。 */
    var mqMobile = window.matchMedia ? window.matchMedia(MOBILE_Q) : null;

    var isMobile = function () {
      return !!(mqMobile && mqMobile.matches);
    };

    var fit = function () {
      var mobile = isMobile();
      var s = mobile ? 1 : Math.min(1, window.innerHeight / BASE_H);   // 只缩不放
      root.style.setProperty("--s", s.toFixed(4));
      root.setAttribute("data-layout", mobile ? "mobile" : "desktop");
    };

    fit();

    /* --s 变化会改变容器的逻辑尺寸，需要让 ECharts 按新尺寸重算。
       但 app.js 的 resize 监听比本文件先注册，直接跟着 resize 跑会用旧布局量尺寸，
       所以这里延到下一帧：先改 --s，再补发一次 resize 让图表按新尺寸重算。
       补发的那次标记为 selfEmit，避免自我循环。 */
    var pending = false;
    var selfEmit = false;

    var onResize = function () {
      if (selfEmit) { selfEmit = false; return; }
      if (pending) return;
      pending = true;
      window.requestAnimationFrame(function () {
        pending = false;
        fit();
        selfEmit = true;
        window.dispatchEvent(new Event("resize"));
      });
    };

    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);

    /* 跨断点（拖动窗口 / 手机横竖屏切换）时重新判定：桌面 <-> 移动端布局互切 */
    if (mqMobile) {
      if (mqMobile.addEventListener) mqMobile.addEventListener("change", onResize);
      else if (mqMobile.addListener) mqMobile.addListener(onResize);   // 老浏览器兜底
    }

    /* 切换视图后，图表容器是 display:none -> flex 重新布局的，
       ECharts 还停在旧尺寸（canvas 比容器矮，底部组件会落在画布外看不见）。
       等布局稳定后补发一次 resize，让它按当前容器尺寸重算。 */
    window.addEventListener("hashchange", function () {
      window.setTimeout(function () {
        selfEmit = true;
        window.dispatchEvent(new Event("resize"));
      }, 260);
    });
  } catch (e) {
    /* 缩放失败时退化为 100%，页面仍可正常使用 */
  }

  /* ------------------------------------------------------- 2. 光标光晕 */
  try {
    var mm = window.matchMedia;
    if (!mm) return;
    if (mm("(prefers-reduced-motion: reduce)").matches) return;
    if (!mm("(hover: hover)").matches) return;

    var glow = document.createElement("div");
    glow.className = "cursor-glow";
    document.body.appendChild(glow);

    var tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, shown = false;

    function step() {
      cx += (tx - cx) * 0.13;
      cy += (ty - cy) * 0.13;
      glow.style.transform = "translate3d(" + cx.toFixed(1) + "px," + cy.toFixed(1) + "px,0)";
      raf = (Math.abs(tx - cx) > 0.5 || Math.abs(ty - cy) > 0.5)
        ? window.requestAnimationFrame(step)
        : 0;
    }

    document.addEventListener("mousemove", function (e) {
      tx = e.clientX;
      ty = e.clientY;
      if (!shown) {
        shown = true;
        cx = tx;
        cy = ty;
        glow.classList.add("on");
      }
      if (!raf) raf = window.requestAnimationFrame(step);
    }, { passive: true });

    document.addEventListener("mouseleave", function () {
      glow.classList.remove("on");
    });
  } catch (err) {
    /* 装饰性功能，任何异常都忽略，保证主页面不受影响 */
  }
})();
