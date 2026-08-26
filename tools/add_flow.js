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
  console.log("console errors:", errs.length);
  errs.slice(0, 5).forEach((e) => console.log("   " + e));
  await browser.close();
})();
