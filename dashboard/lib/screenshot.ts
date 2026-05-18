// Server-side screenshot helper voor lead-sites.
// Gebruikt Playwright Chromium om de gegenereerde site te fotograferen.
// PNG belandt in public/preview/{placeId}.png, gepushd via autoDeploy zodat
// hij vanaf het Vercel subdomain serveert voor inbedding in e-mails.

import fs from "fs";
import path from "path";

const SITES_DIR = path.resolve(process.cwd(), "public/sites");
const PREVIEW_DIR = path.resolve(process.cwd(), "public/preview");

const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 900;
const DEVICE_SCALE = 2;

export function screenshotFilePath(placeId: string): string {
  return path.join(PREVIEW_DIR, `${placeId}.png`);
}

export function hasScreenshot(placeId: string): boolean {
  return fs.existsSync(screenshotFilePath(placeId));
}

export function deleteScreenshot(placeId: string): void {
  const p = screenshotFilePath(placeId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/**
 * Genereer een PNG-screenshot van de gegenereerde site voor `placeId`.
 * Vereist dat public/sites/{placeId}/index.html bestaat.
 * Retourneert het absolute pad naar de PNG, of null bij fout.
 */
export async function generateScreenshot(placeId: string): Promise<string | null> {
  const sitePath = path.join(SITES_DIR, placeId, "index.html");
  if (!fs.existsSync(sitePath)) return null;

  fs.mkdirSync(PREVIEW_DIR, { recursive: true });

  // Lazy import: playwright is een zware module, alleen laden wanneer nodig
  const { chromium } = await import("playwright");

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      deviceScaleFactor: DEVICE_SCALE,
    });
    const page = await context.newPage();
    await page.goto(`file://${sitePath}`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    // Korte settle-periode voor fonts/animaties
    await page.waitForTimeout(600);

    const outPath = screenshotFilePath(placeId);
    await page.screenshot({ path: outPath, type: "png", fullPage: false });
    return outPath;
  } catch (err) {
    console.error(`Screenshot generation failed for ${placeId}:`, err);
    return null;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * URL waarop de screenshot voor `placeId` publiek bereikbaar is op het
 * subdomain van de lead. Cache-bust via mtime van de PNG zodat Gmail
 * geen oude versie cachet.
 */
export function getScreenshotEmailUrl(placeId: string, slug: string | null): string | null {
  if (!slug) return null;
  const p = screenshotFilePath(placeId);
  if (!fs.existsSync(p)) return null;
  const v = Math.floor(fs.statSync(p).mtimeMs);
  return `https://${slug}.stronadlatwojejfirmy.com.pl/preview/${placeId}.png?v=${v}`;
}

/**
 * Relatieve URL voor lokale preview (in dashboard iframe). Cache-bust idem.
 * Werkt direct na generatie, geen deploy nodig.
 */
export function getScreenshotLocalUrl(placeId: string): string | null {
  const p = screenshotFilePath(placeId);
  if (!fs.existsSync(p)) return null;
  const v = Math.floor(fs.statSync(p).mtimeMs);
  return `/preview/${placeId}.png?v=${v}`;
}

/**
 * Wacht tot een URL HTTP 200 retourneert. Gebruikt voor synchroniseren tussen
 * git push → Vercel build → PNG live → mail versturen.
 */
export async function waitForUrl(url: string, timeoutMs = 90_000, intervalMs = 3_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok) return true;
    } catch {
      // Network error → retry
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
