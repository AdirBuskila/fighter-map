const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  let tiles = 0, tileFail = 0;
  ctx.on("response", (r) => { if (r.url().includes(".pbf")) tiles++; });
  ctx.on("requestfailed", (r) => { if (r.url().includes(".pbf")) tileFail++; });
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errs.push("pageerror " + e.message.slice(0, 200)));
  await page.goto("http://localhost:3000/maptest.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(10000);
  const info = await page.evaluate(() => ({
    styleLoaded: window.__m.isStyleLoaded(),
    water: window.__m.querySourceFeatures("openmaptiles", { sourceLayer: "water" }).length,
  }));
  console.log("plain page, bundled maplibre:", JSON.stringify(info), "tiles:", tiles, "failed:", tileFail);
  errs.slice(0, 6).forEach((e) => console.log("  err:", e));
  await page.screenshot({ path: process.argv[2] });
  await browser.close();
})();
