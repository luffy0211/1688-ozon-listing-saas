# Run via browser-harness stdin against the isolated UI preview, never production.
import json
import os
import time

new_tab("http://127.0.0.1:5179/")
cdp("Emulation.setDeviceMetricsOverride", width=1440, height=1000, deviceScaleFactor=1, mobile=False)
wait_for_load()
assert wait_for_element("select", timeout=15)

def point(selector):
    js(f"document.querySelector({json.dumps(selector)}).scrollIntoView({{block:'center',inline:'nearest'}})")
    capture_screenshot()
    rect = js(f"(()=>{{const r=document.querySelector({json.dumps(selector)}).getBoundingClientRect();return {{x:r.x+r.width/2,y:r.y+r.height/2}}}})()")
    click_at_xy(rect["x"], rect["y"])

def check(condition, label):
    for _ in range(40):
        if js(condition):
            break
        time.sleep(0.05)
    assert js(condition), label
    print("PASS " + label)

comparison = 'section[aria-label="\u540c\u7c7b\u7ade\u54c1\u5bf9\u6bd4"]'
drafts = 'section[aria-label="\u5546\u54c1\u4fee\u6539\u8349\u6848"]'
point("button[aria-pressed]:nth-child(2)")
check("document.querySelector('[aria-pressed=true]').textContent.includes('1-2')", "competitor selection updates actual product")
point('button[aria-label="\u653e\u5927\u7ade\u54c1\u4e3b\u56fe"]')
check("!!document.querySelector('dialog[open]')", "image zoom opens a modal")
press_key("Escape")
check("!document.querySelector('dialog[open]') && document.activeElement.getAttribute('aria-label')==='\u653e\u5927\u7ade\u54c1\u4e3b\u56fe'", "Escape closes zoom and restores focus")

point("select")
press_key("ArrowDown")
press_key("Enter")
check("document.querySelectorAll('select')[1].textContent.includes('DEMO-1')", "category selection changes own product")
check("document.querySelector('[aria-pressed=true]').textContent.includes('2-1')", "category selection resets competitor")
point("button[aria-pressed]:nth-child(8)")
check("document.body.innerText.includes('\u4ec5\u6709\u6458\u8981')", "legacy description clearly labelled summary")
check("document.body.innerText.includes('\u56fe\u7247\u6682\u672a\u83b7\u53d6')", "missing image stays explicit")
point("button[aria-pressed]:nth-child(1)")
point(comparison + " details summary")
check("!!document.querySelector('section details[open]')", "full description expands")

js("Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('\u67e5\u770b\u5e76\u7f16\u8f91')).setAttribute('data-qa-draft-link','true')")
point("[data-qa-draft-link]")
check("document.querySelector('textarea').id==='draft-preview-draft-1-title'", "draft link selects exact offer action")
check("document.activeElement.getAttribute('aria-label')==='\u5546\u54c1\u4fee\u6539\u8349\u6848'", "draft editor receives keyboard focus")
fill_input("textarea", "Edited Russian title for preview")
check("document.querySelector('textarea').value==='Edited Russian title for preview'", "linked draft is editable")
point("select")
press_key("ArrowDown")
press_key("Enter")
check("!document.querySelector('[data-qa-draft-link]')", "product without a draft has no execution shortcut")
check("document.querySelector('textarea').value==='Edited Russian title for preview'", "comparison selection does not erase draft edits")

for width, height in [(1440, 1000), (768, 1024), (390, 844), (320, 780)]:
    cdp("Emulation.setDeviceMetricsOverride", width=width, height=height, deviceScaleFactor=1, mobile=False)
    js("window.scrollTo(0,0)")
    check("document.documentElement.scrollWidth<=innerWidth", f"no horizontal page overflow at {width}px")
    capture_screenshot(os.path.abspath(f"test-results/competitor-{width}.png"))
check("Array.from(document.images).filter(i=>i.alt.includes('\u4e3b\u56fe')).every(i=>i.complete&&i.naturalWidth>0)", "visible product images loaded")
print("PASS isolated competitor UI journey; no store or collection API invoked")
