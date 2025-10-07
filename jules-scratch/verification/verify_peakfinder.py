import asyncio
from playwright.async_api import async_playwright, expect
import pathlib

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Capture and print console messages
        page.on("console", lambda msg: print(f"BROWSER CONSOLE: {msg.text}"))

        # Get the absolute path to the HTML file
        file_path = pathlib.Path("geolocator.html").resolve()

        # Go to the local HTML file
        await page.goto(f"file://{file_path}")

        # 1. Switch to Line of Sight (LOS) mode
        await page.locator("#losMode").click()

        # 2. Select PeakFinder visualization mode
        await page.locator("#peakfinderLOSMode").click()

        # 3. Collapse the sidebar to make the map clickable
        await page.locator("#sidebar .collapse-btn").click()

        # 4. Click two points on the map to activate PeakFinder
        # Click point A
        await page.locator("#map").click(position={"x": 300, "y": 300})
        # Click point B
        await page.locator("#map").click(position={"x": 400, "y": 400})

        # 5. Wait for the PeakFinder container to be active and the progress bar to disappear
        await expect(page.locator("#peakFinderContainer")).to_have_class("active", timeout=15000)
        await expect(page.locator("#pfcanvasprogress")).to_be_hidden(timeout=15000)

        # Add a delay for rendering
        await page.wait_for_timeout(3000)

        # 6. Take a screenshot of the PeakFinder view
        await page.screenshot(path="jules-scratch/verification/verification.png")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())