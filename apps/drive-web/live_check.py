from playwright.sync_api import sync_playwright
from urllib.parse import quote
PDF="reports/douyin-ecom-ecosystem-report.pdf"
errs=[]
with sync_playwright() as p:
    br=p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox"])
    ctx=br.new_context(viewport={"width":390,"height":844},device_scale_factor=2,is_mobile=True,has_touch=True,user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
    pg=ctx.new_page(); pg.on("pageerror",lambda e:errs.append(str(e))); pg.on("console",lambda m: m.type=="error" and errs.append(m.text))
    pg.goto("https://felixzhu.github.io/qian-drive/?v=2#/"+quote(PDF)); pg.wait_for_timeout(7000)
    print("canvases",pg.locator(".pg canvas").count(),"pages",pg.locator(".pg").count())
    pg.screenshot(path="v2/live_mobile_pdf.png")
    print("errs",errs[:5])
