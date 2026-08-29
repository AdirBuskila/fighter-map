// Drives /add the way a person on a phone would: search, pick, tick, submit.
const { chromium } = require("playwright");
(async () => {
  const target = (process.argv[2] || "http://localhost:3000") + "/add";
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errs.push("pageerror " + e.message.slice(0, 160)));

  await page.goto(target, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const box = page.locator('input[role="combobox"]');
  console.log("search box present:", await box.count());
  await box.fill("קסטרו");
  await page.waitForTimeout(3500);

  const options = page.locator('[role="option"]');
  const n = await options.count();
  console.log("suggestions:", n);
  if (n > 0) console.log("first:", (await options.first().innerText()).replace(/\n/g, " | "));

  if (n > 0) {
    await options.first().click();
    await page.waitForTimeout(800);
    console.log("picked. confirmation shown:", await page.locator("text=קסטרו").count() > 0);
  }

  const checks = page.locator('input[type="checkbox"]');
  console.log("benefit checkboxes:", await checks.count());
  await checks.first().check();
  await page.waitForTimeout(300);

  console.log("category select:", await page.locator("select#category").count());
  console.log("selected category:", await page.locator("select#category").inputValue());
  console.log("submit button:", await page.locator('button[type="submit"]').count());
  console.log("turnstile widget:", await page.locator("iframe[src*='challenges.cloudflare']").count());

  await page.screenshot({ path: process.argv[3] || "add.png" });

  // The link fallback: the path the OSM search cannot reach. Worth driving in
  // a real browser because the pin preview is a MapLibre instance, and every
  // map bug this project has had rendered blank with a clean console.
  await page.goto(target, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.locator('input[role="combobox"]').fill("קקקקקקק לא קיים");
  await page.waitForTimeout(4500);

  const linkField = page.locator('input[type="url"]');
  console.log("link field opens on an empty search:", await linkField.count());

  await linkField.fill(
    "https://www.google.com/maps/place/x/@31.8005,35.3105,17z/data=" +
    "!4m6!3m5!1s0x1502b5c0e1f2a3b4:0x5d6e7f8091a2b3c4!8m2!3d31.8006!4d35.3107");
  // Tiles come off the network; a screenshot taken before they land shows an
  // empty box and proves nothing.
  await page.waitForTimeout(9000);

  const canvas = page.locator('[role="img"] canvas');
  console.log("mini map canvas:", await canvas.count());
  const box2 = await canvas.first().boundingBox();
  // Printed rather than merely counted: a pane that exists at zero pixels wide
  // is a bug this project has actually shipped.
  console.log("mini map size:", box2 && Math.round(box2.width) + "x" + Math.round(box2.height));
  console.log("name prefilled:", await page.locator('input[placeholder*="עמנואל"]').count());

  // The pin, measured rather than counted. Without maplibre's stylesheet the
  // marker still exists and still answers a count, but lays out as a full-width
  // block under the map instead of sitting on the point. A marker as wide as
  // its container is the tell.
  const pin = await page.evaluate(() => {
    const m = document.querySelector(".maplibregl-marker");
    if (!m) return null;
    const r = m.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  console.log("marker size:", pin && pin.w + "x" + pin.h,
              pin && pin.w < 60 ? "(positioned)" : "(UNPOSITIONED - stylesheet missing)");
  await page.screenshot({ path: process.argv[4] || "add-link.png" });

  console.log("console errors:", errs.length);
  errs.slice(0, 5).forEach((e) => console.log("   " + e));
  await browser.close();
})();
