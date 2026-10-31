/*! BMDC QuizVerse — wheel drawing and rotation helpers (DOM only; the maths lives in game.js). */
(function (root) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const CX = 200;
  const CY = 200;
  const R = 188;

  // Segment colours (fill + readable text colour). Order = wheel order.
  const SEGMENT_STYLES = [
    { fill: "#7c3aed", text: "#ffffff" },
    { fill: "#22d3ee", text: "#06122e" },
    { fill: "#fb923c", text: "#241200" },
    { fill: "#2dd4bf", text: "#03201c" },
    { fill: "#fde047", text: "#2a2200" },
    { fill: "#4f46e5", text: "#ffffff" },
    { fill: "#db2777", text: "#ffffff" },
    { fill: "#14b8a6", text: "#03201c" },
  ];
  const ICONS = {
    mcq: "🎯",
    fill_blank: "✍️",
    true_false: "⚖️",
    identify_image: "🖼️",
    match_pairs: "🧩",
    rapid_fire: "⚡",
    terminology: "📚",
    brain_teaser: "🧠",
  };

  function svg(tag, attrs, text) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function polar(r, deg) {
    const rad = (deg * Math.PI) / 180;
    return [CX + r * Math.sin(rad), CY - r * Math.cos(rad)];
  }

  /**
   * Builds the wheel SVG.
   * options.types      ordered challenge type keys (segment i = types[i])
   * options.labelLines function(type) -> array of 1-2 short label lines (omit for an icon-only mini wheel)
   */
  function buildSvg(options) {
    const types = options.types;
    const step = 360 / types.length;
    const s = svg("svg", { viewBox: "0 0 400 400", focusable: "false", "aria-hidden": "true", class: "wheel-svg" });

    s.append(svg("circle", { cx: CX, cy: CY, r: R + 8, fill: "#0b1030", stroke: "#ffffff", "stroke-width": 4 }));

    types.forEach((type, i) => {
      const a0 = i * step;
      const a1 = (i + 1) * step;
      const mid = a0 + step / 2;
      const [x0, y0] = polar(R, a0);
      const [x1, y1] = polar(R, a1);
      const style = SEGMENT_STYLES[i % SEGMENT_STYLES.length];
      s.append(
        svg("path", {
          d: `M${CX},${CY} L${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`,
          fill: style.fill,
          stroke: "#0b1030",
          "stroke-width": 3,
          "data-segment": i,
        })
      );

      // Label group: rotate so text runs along the radius and stays upright.
      const leftHalf = mid > 180;
      const rot = leftHalf ? mid + 90 : mid - 90;
      const g = svg("g", { transform: `rotate(${rot.toFixed(2)} ${CX} ${CY})`, fill: style.text, "font-weight": 800 });
      const iconX = leftHalf ? 142 : 258;
      g.append(svg("text", { x: iconX, y: CY, "text-anchor": "middle", "dominant-baseline": "central", "font-size": options.labelLines ? 24 : 30 }, ICONS[type]));
      if (options.labelLines) {
        const lines = options.labelLines(type);
        const textX = leftHalf ? 20 : 380;
        const anchor = leftHalf ? "start" : "end";
        const t = svg("text", { x: textX, y: CY, "text-anchor": anchor, "font-size": 15 });
        lines.forEach((line, li) => {
          const dy = lines.length === 1 ? 0 : li === 0 ? -9 : 17;
          t.append(svg("tspan", { x: textX, dy: li === 0 ? dy : 17, "dominant-baseline": "central" }, line));
        });
        g.append(t);
      }
      s.append(g);
    });

    // Rim pegs
    types.forEach((_, i) => {
      const [px, py] = polar(R + 1, i * step);
      s.append(svg("circle", { cx: px.toFixed(2), cy: py.toFixed(2), r: 5, fill: "#fde047", stroke: "#0b1030", "stroke-width": 2 }));
    });
    // Hub
    s.append(svg("circle", { cx: CX, cy: CY, r: 34, fill: "#0b1030", stroke: "#ffffff", "stroke-width": 4 }));
    s.append(svg("text", { x: CX, y: CY, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 15, "font-weight": 900, fill: "#fde047" }, "BMDC"));
    return s;
  }

  function readAngle(el) {
    const m = getComputedStyle(el).transform;
    if (!m || m === "none") return 0;
    const match = m.match(/matrix\(([^)]+)\)/);
    if (!match) return 0;
    const v = match[1].split(",").map(Number);
    return (((Math.atan2(v[1], v[0]) * 180) / Math.PI) + 360) % 360;
  }

  /** Rotate `el` to `deg`. Resolves when the motion has finished (immediately when durationMs is 0). */
  function rotateTo(el, deg, opts) {
    const duration = (opts && opts.durationMs) || 0;
    return new Promise((resolve) => {
      if (duration <= 0) {
        el.style.transition = "none";
        el.style.transform = `rotate(${deg}deg)`;
        void el.offsetWidth; // flush styles so readAngle() sees the final position
        resolve();
        return;
      }
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        el.removeEventListener("transitionend", onEnd);
        resolve();
      };
      const onEnd = (e) => {
        if (e.target === el && e.propertyName === "transform") done();
      };
      el.addEventListener("transitionend", onEnd);
      el.style.transition = `transform ${duration}ms cubic-bezier(0.17, 0.67, 0.12, 0.99)`;
      el.style.transform = `rotate(${deg}deg)`;
      setTimeout(done, duration + 500); // safety net if transitionend never fires
    });
  }

  root.QuizWheel = { buildSvg, readAngle, rotateTo, ICONS, SEGMENT_STYLES };
})(window);
