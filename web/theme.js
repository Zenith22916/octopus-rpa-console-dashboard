/* ============================================================================
 * theme.js — 纯装饰层（视觉增强）
 * 只做一件事：跟随鼠标的氛围光晕（样式在 theme.css 的 .cursor-glow）。
 * 不读取/不修改任何业务数据，不干预 app.js 的 DOM 结构，出错静默降级。
 * 维护：删掉 index.html 里的 theme.js 引用即可完全移除。
 * ========================================================================= */
(function () {
  "use strict";
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
