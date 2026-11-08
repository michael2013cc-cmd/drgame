window.GD_Input = (function () {
  var held = false;
  function set(v) { held = v; }
  function create(target) {
    target.addEventListener('pointerdown', function (e) { e.preventDefault(); set(true); });
    window.addEventListener('pointerup', function () { set(false); });
    window.addEventListener('pointercancel', function () { set(false); });
    window.addEventListener('keydown', function (e) {
      if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); set(true); }
    });
    window.addEventListener('keyup', function (e) {
      if (e.code === 'Space' || e.key === ' ') set(false);
    });
    window.addEventListener('blur', function () { set(false); });   // 防止回来时飞船一直上升
    document.addEventListener('touchstart', function (e) { e.preventDefault(); set(true); }, { passive: false });
    document.addEventListener('touchend', function () { set(false); }, { passive: true });
    return { get: function () { return held; } };
  }
  return { create: create };
})();
