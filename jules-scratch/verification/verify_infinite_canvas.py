from playwright.sync_api import sync_playwright, expect
import os

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    # Get the absolute path to the HTML file
    file_path = os.path.abspath("geolocator.html")

    # Navigate to the local HTML file
    page.goto(f"file://{file_path}")

    # The file input is hidden, so we set the files for the input element directly.
    # We upload the same image twice to create two layers.
    image_path = os.path.abspath("protractor.png")
    page.locator("#imageUpload").set_input_files([image_path, image_path])

    # Wait for the layers to appear in the list
    expect(page.locator(".layer-item")).to_have_count(2)

    # Wait for the canvas to redraw after images are loaded and positioned
    page.wait_for_timeout(1000)

    # Get the canvas and its bounding box to calculate click coordinates
    canvas = page.locator("#imageCanvas")
    canvas_box = canvas.bounding_box()

    # The second image is on top. We will drag it.
    # We click in the middle of the canvas to select the top image and then drag it.
    start_x = canvas_box['x'] + canvas_box['width'] / 2
    start_y = canvas_box['y'] + canvas_box['height'] / 2

    # Simulate dragging the top image to the right and down
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(start_x + 300, start_y + 200, steps=5)
    page.mouse.up()

    # Wait for the canvas to redraw
    page.wait_for_timeout(500)

    # Take a screenshot to verify the result
    page.screenshot(path="jules-scratch/verification/infinite_canvas_drag.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)