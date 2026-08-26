/**
 * Browser smoke test.
 *
 * The unit and API suites never open a browser, and the two worst bugs this
 * project has had were both invisible to them:
 *
 *   1. the map pane was a plain flex sibling of the list, so it grew to the
 *      height of all 417 rows (60,719px), WebGL clamped the canvas to 4096 and
 *      exactly one tile ever loaded
 *   2. maplibre-gl v6 is ESM-only with a separate worker module that Next's
 *      bundler could not resolve, so the worker started, requested no tiles,
 *      and reported no error at all
 *
 * Both render a blank map with a clean console. Hence a test that asserts on
 * what the map actually did, not on what it said.
 *
 *   node tools/smoke.js [url] [screenshot.png]
 */

const { chromium } = require("playwright");

const CHECKS = [];
function check(label, actual, expected) {
  const ok = typeof expected === "function" ? expected(actual) : actual === expected;
  CHECKS.push({ label, ok, actual });
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(44)} ${JSON.stringify(actual)}`);
}

(async () => {
  const target = process.argv[2] || "http://localhost:3000";
  const shot = process.argv[3];
  // A phone is the primary target: someone outside a shop deciding whether to
  // walk in. Pass "mobile" to check that case.
  const mobile = process.argv[4] === "mobile";
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 820 };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });

  // Context level, so requests from MapLibre's worker are counted too.
  let tilesOk = 0;
  let tilesBad = 0;
  ctx.on("response", (r) => { if (r.url().includes(".pbf")) (r.status() < 400 ? tilesOk++ : tilesBad++); });
  ctx.on("requestfailed", (r) => { if (r.url().includes(".pbf")) tilesBad++; });

  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));

  console.log("smoke test against %s\n", target);
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(11000);

  const dom = await page.evaluate(() => {
    const canvas = document.querySelector(".maplibregl-canvas");
    const box = document.querySelector(".maplibregl-map");
    return {
      hasCanvas: Boolean(canvas),
      boxHeight: box ? box.clientHeight : 0,
      boxWidth: box ? box.clientWidth : 0,
      rows: document.querySelectorAll("li").length,
      footer: document.body.innerText.includes("אתר קהילתי לא רשמי"),
      contact: document.body.innerText.includes("adirbu98@gmail.com"),
    };
  });

  console.log("map");
  check("canvas exists", dom.hasCanvas, true);
  check("pane has a sane height", dom.boxHeight, (h) => h > 200 && h < 2000);
  check("pane has a sane width", dom.boxWidth, (w) => w > 200 && w < 3000);
  check("map fits the viewport", dom.boxHeight, (h) => h <= viewport.height);
  check("vector tiles actually loaded", tilesOk, (n) => n >= 4);
  check("no tile failures", tilesBad, 0);

  const live = await page.evaluate(() => {
    const m = window.__map;
    if (!m) return null;
    const ids = m.getStyle().layers.map((l) => l.id);
    return {
      styleLoaded: m.isStyleLoaded(),
      sourceLoaded: m.isSourceLoaded("openmaptiles"),
      hasOurLayers: ["clusters", "pins", "pin-selected"].every((i) => ids.includes(i)),
      water: m.querySourceFeatures("openmaptiles", { sourceLayer: "water" }).length,
      places: m.querySourceFeatures("openmaptiles", { sourceLayer: "place" }).length,
      pins: m.queryRenderedFeatures({ layers: ["clusters", "pins"] }).length,
      // A place published on one person's word draws hollow. The name is
      // built by concatenation in two separate places (iconFor adds "-new",
      // the selected layer adds "-on"), so a missing image is a silent miss:
      // MapLibre drops the symbol and the pin simply is not there.
      icons: ["fighter", "fighter-new", "fighter-new-on",
              "voucher-new", "both-new", "dead"].filter((n) => m.hasImage(n)).length,
    };
  });

  if (live) {
    check("style finished loading", live.styleLoaded, true);
    check("tile source finished loading", live.sourceLoaded, true);
    check("our marker layers are installed", live.hasOurLayers, true);
    check("basemap has water geometry", live.water, (n) => n > 0);
    check("basemap has place labels", live.places, (n) => n > 0);
    check("our own pins are on screen", live.pins, (n) => n > 0);
    check("every pin image is registered", live.icons, 6);
  } else {
    console.log("  note  window.__map is absent, so this is a production build");
  }

  console.log("\npage");
  check("the list rendered rows", dom.rows, (n) => n > 10);
  check("the legal footer is present", dom.footer, true);
  check("the contact line is present", dom.contact, true);

  // The masthead carried `sticky top-0 z-40` and still scrolled away, because
  // an unlayered `.masthead { position: relative }` (added to anchor the
  // keyline) outranked the utility. Nothing in the markup looked wrong, so
  // assert on where the element actually is after a scroll.
  const header = await page.evaluate(() => {
    window.scrollTo(0, 1200);
    const el = document.querySelector("header.masthead");
    if (!el) return null;
    return { top: Math.round(el.getBoundingClientRect().top),
             scrolled: Math.round(window.scrollY) };
  });
  await page.waitForTimeout(300);
  check("the page actually scrolled", header && header.scrolled, (n) => n > 200);
  check("the masthead stayed pinned", header && header.top, 0);

  // Both bars are sticky, and the filter bar used to stick at 0 because the
  // masthead was not sticking at all. Assert they are stacked, not piled.
  const bars = await page.evaluate(() => {
    const head = document.querySelector("header.masthead");
    const search = document.querySelector("#place-search");
    if (!head || !search) return null;
    const h = head.getBoundingClientRect();
    const s = search.getBoundingClientRect();
    return { clear: s.top >= h.bottom, onScreen: s.top >= 0 && s.bottom <= window.innerHeight };
  });
  check("the search box exists", Boolean(bars), true);
  check("the filter bar clears the masthead", bars && bars.clear, true);
  check("and stays reachable while scrolled", bars && bars.onScreen, true);

  // Search narrows both the list and the map, so a broken filter shows up as
  // a row count that does not move.
  await page.evaluate(() => window.scrollTo(0, 0));
  const rowsNow = () => page.evaluate(() => document.querySelectorAll("li").length);
  await page.fill("#place-search", "תל אביב");
  await page.waitForTimeout(400);
  const narrowed = await rowsNow();
  await page.fill("#place-search", "");
  await page.waitForTimeout(400);
  const restored = await rowsNow();
  check("search narrows the list", narrowed, (n) => n > 0 && n < dom.rows);
  check("and clearing it restores the list", restored, dom.rows);
  check("no console errors", errors.length, 0);
  errors.slice(0, 5).forEach((e) => console.log("      " + e));

  if (shot) {
    await page.screenshot({ path: shot });
    console.log("\nscreenshot -> %s", shot);
  }
  await browser.close();

  const failed = CHECKS.filter((c) => !c.ok);
  console.log("\n%d passed, %d failed", CHECKS.length - failed.length, failed.length);
  process.exit(failed.length ? 1 : 0);
})();
