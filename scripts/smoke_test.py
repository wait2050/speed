# 本地主链路冒烟测试（Playwright）
# 用法：先启动 `npm run dev`（5173），再运行 `python3 scripts/smoke_test.py`
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    console_errors = []
    page.on('console', lambda msg: console_errors.append(msg.text) if msg.type == 'error' else None)
    page.goto('http://localhost:5173', wait_until='networkidle')
    page.wait_for_selector('text=节奏按摩引导器')
    print('STEP home: ok')

    page.click('text=生成编排')
    page.wait_for_selector('text=编排概览')
    assert page.locator('text=开始播放').count() > 0
    print('STEP generate/preview: ok')

    page.click('text=开始播放')
    page.wait_for_selector('text=准备播放')
    print('STEP navigate player: ok')

    page.goto('http://localhost:5173/#/settings')
    page.wait_for_selector('text=设置')
    assert page.locator('text=速度档位').count() > 0
    print('STEP settings: ok')

    page.goto('http://localhost:5173/#/history')
    page.wait_for_selector('text=历史')
    print('STEP history: ok')

    page.goto('http://localhost:5173/#/favorites')
    page.wait_for_selector('text=收藏')
    print('STEP favorites: ok')

    if console_errors:
        print('CONSOLE_ERRORS:', console_errors[:10])
    else:
        print('CONSOLE_ERRORS: none')
    browser.close()
    print('SMOKE PASS')