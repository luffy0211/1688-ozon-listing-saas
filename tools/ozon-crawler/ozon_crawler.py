# -*- coding: utf-8 -*-
"""
Ozon 商品采集器（纯 HTTP，无浏览器自动化）
=============================================
链路：curl.exe(Windows schannel TLS) + 用户会话 cookie(Netscape jar)
      + 本地 socks5 代理 + URL 加 from_global=true -> Ozon SSR HTML -> 解析

依赖：Python 3.8+、Windows 自带 curl.exe、可用的本地代理端口
      （cookie 请通过 --tsv 传 Cookie-Editor 导出的表格，或 --jar 传 Netscape 文件）

用法示例：
  python ozon_crawler.py --text 女装 --pages 2 --max-details 5 --out result.jsonl
  python ozon_crawler.py --text "iphone 15" "наушники" --max-details 0 --out search_only.jsonl
"""
import argparse
import datetime
import html as ihtml
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import uuid

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# --------------------------------------------------------------------------
# 配置（可按需改成命令行/配置文件）
# --------------------------------------------------------------------------
DEFAULT_PROXY = "socks5h://127.0.0.1:10808"
DEFAULT_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0")
REQUEST_INTERVAL = 1.5          # 秒，请求间隔（限速，请勿调太小）
HTTP_TIMEOUT = 45
GLOBAL_PARAM = "from_global=true"   # 海外访问必须带，否则 Ozon 返回空壳页

# 详情页“完整特性”懒加载分块（layout_container=pdpPage2column）所需的客户端版本头
APP_VERSION = "release_7-8-2026_1771dc82"
APP_MANIFEST = ("frontend-ozon-ru:1771dc82a6bfe50e7c88d9e6e72b72e7614ba9c5,"
                "sf-render-api:7613b842f83d7af57356f082f046a60c290a4a38,"
                "search-render-api:e7fbade841cead15d7b68aaf0cc3ca000318da5d,"
                "checkout-render-api:61e9dff78931cae1eabf81abc4536636a6e4ced9,"
                "pdp-render-api:3af4302d7516cf0c751a2569359218342584539e,"
                "fav-render-api:7ad5ba7db85180341ee858eea27b4c0467858022,"
                "reviews-render-api:b8cca00f991a1a5d15b24f752d514af18e56d813")
PDP_BLOCK_CONTAINER = "pdpPage2column"   # 详情页第 2 屏分块，内含 webCharacteristics 全量特性


# --------------------------------------------------------------------------
# cookie 加载
# --------------------------------------------------------------------------
def build_jar_from_tsv(tsv_path, jar_path):
    """把 Cookie-Editor 导出的制表符表格转成 Netscape cookie jar（跳过非 .ozon.ru 域）"""
    rows = []
    with open(tsv_path, encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 8:
                continue
            name, value, domain, path, expires = parts[0], parts[1], parts[2], parts[3], parts[4]
            httponly = parts[6].strip() == "✓"
            secure = parts[7].strip() == "✓"
            if domain != ".ozon.ru" or name == "__Secure-refresh-token":
                continue
            if expires == "会话":
                ts = 0
            else:
                try:
                    dt = datetime.datetime.fromisoformat(expires.replace("Z", "+00:00"))
                    ts = int(dt.timestamp())
                except Exception:
                    ts = 0
            d = "#HttpOnly_" + domain if httponly else domain
            sec = "TRUE" if secure else "FALSE"
            rows.append(f"{d}\tTRUE\t{path}\t{sec}\t{ts}\t{name}\t{value}")
    with open(jar_path, "w", encoding="utf-8") as f:
        f.write("# Netscape HTTP Cookie File\n" + "\n".join(rows) + "\n")
    return jar_path


class Fetcher:
    """基于 curl.exe 的页面抓取器。
    注意：cookie 始终使用导出的原始会话（不把服务端 Set-Cookie 回写），
    实测“预热首页 + 回写 cookie”会让 Ozon 后续返回无数据的空壳页。
    """

    def __init__(self, cookie_file, proxy=DEFAULT_PROXY, ua=DEFAULT_UA,
                 workdir=None):
        self.cookie_file = os.path.abspath(cookie_file)
        workdir = workdir or tempfile.gettempdir()
        self.proxy = proxy
        self.ua = ua
        self._cookie_discard = os.path.join(workdir, "ozon_cj_discard.txt")
        if os.path.exists(self._cookie_discard):
            os.remove(self._cookie_discard)

    def get(self, url, referer="https://www.ozon.ru/"):
        return self._raw_get(url, referer)

    def _raw_get(self, url, referer):
        out = os.path.join(tempfile.gettempdir(), "ozon_fetch_out.html")
        cmd = ["curl.exe", "--proxy", self.proxy, "-sS", "--compressed", "-L",
               "--max-redirs", "8", "--max-time", str(HTTP_TIMEOUT),
               "-b", self.cookie_file, "-c", self._cookie_discard,
               "-H", f"User-Agent: {self.ua}",
               "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
               "-H", "Accept-Language: ru-RU,ru;q=0.9,en;q=0.8,zh-CN;q=0.7",
               "-H", "Accept-Encoding: gzip, deflate",
               "-H", f"Referer: {referer}",
               "-w", "\n__OZON_STATUS__:%{http_code}",
               "-o", out, url]
        p = subprocess.run(cmd, capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        m = re.search(r"__OZON_STATUS__:(\d+)", p.stdout or "")
        status = int(m.group(1)) if m else 0
        if status != 200:
            raise RuntimeError(f"HTTP {status} for {url[:120]} err={p.stderr.strip()[:200]}")
        with open(out, encoding="utf-8", errors="replace") as f:
            return f.read()

    def json_api(self, url, extra_headers=None, referer="https://www.ozon.ru/"):
        """调用 entrypoint/composer 的 JSON 接口（带 dweb_client 客户端头），返回响应文本"""
        out = os.path.join(tempfile.gettempdir(), "ozon_json_out.txt")
        cmd = ["curl.exe", "--proxy", self.proxy, "-sS", "--compressed", "-L",
               "--max-redirs", "8", "--max-time", str(HTTP_TIMEOUT),
               "-b", self.cookie_file, "-c", self._cookie_discard,
               "-H", f"User-Agent: {self.ua}",
               "-H", "Accept: application/json",
               "-H", "Content-Type: application/json",
               "-H", "Accept-Language: ru-RU,ru;q=0.9,en;q=0.8,zh-CN;q=0.7",
               "-H", "x-o3-app-name: dweb_client",
               "-H", f"x-o3-app-version: {APP_VERSION}",
               "-H", f"x-o3-manifest-version: {APP_MANIFEST}",
               "-H", "x-page-previous: pdp",
               "-H", f"Referer: {referer}",
               "-w", "\n__OZON_STATUS__:%{http_code}",
               "-o", out, url]
        for h in extra_headers or []:
            cmd += ["-H", h]
        p = subprocess.run(cmd, capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        m = re.search(r"__OZON_STATUS__:(\d+)", p.stdout or "")
        status = int(m.group(1)) if m else 0
        if status != 200:
            raise RuntimeError(f"HTTP {status} for {url[:120]} err={p.stderr.strip()[:200]}")
        with open(out, encoding="utf-8", errors="replace") as f:
            return f.read()


# --------------------------------------------------------------------------
# 解析：搜索结果
# --------------------------------------------------------------------------
def clean(s):
    s = ihtml.unescape(s or "")
    s = s.replace("\ufeff", "").replace("\u200b", "").replace("\u2009", " ")
    return re.sub(r"\s+", " ", s).strip()


def parse_cards(html_text):
    m = re.search(r'<div data-widget="tileGridDesktop">(.*?)(?:<div data-widget="|window\.__NUXT__)', html_text, re.S)
    if not m:
        return []
    grid = m.group(1)
    parts = re.split(r'(?=<div data-index="\d+" class="tile-root)', grid)
    cards = []
    for p in parts:
        im = re.search(r'data-index="(\d+)"', p)
        if not im:
            continue
        um = re.search(r'href="(/product/[^"]*?-(\d+)/[^"]*)"', p)
        if not um:
            continue
        url, pid = um.group(1), um.group(2)
        tm = re.search(r'<span class="tsBody500Medium">(.*?)</span>', p)
        title = clean(tm.group(1)) if tm else None
        price = None
        pm = re.search(r'class="c35_6_0-a1[^"]*"[^>]*>(.*?)</span>', p)
        if pm:
            price = clean(re.sub(r"<[^>]+>", "", pm.group(1)))
        rating = None
        rp = re.search(r'color:var\(--graphicRating\)[^>]*>.*?</svg><span[^>]*>(.*?)</span>', p, re.S)
        if rp:
            rating = clean(re.sub(r"<[^>]+>", "", rp.group(1)))
        reviews = None
        for rv in re.finditer(r'<span[^>]*class="tsBodyControl300XSmall"[^>]*>(.*?)</span>', p):
            txt = clean(re.sub(r"<[^>]+>", "", rv.group(1)))
            if re.search(r"отзыв|оценк", txt, re.I) and txt != rating:
                reviews = txt
        # 营销徽章标签（热销/新品等）
        labels = []
        for kw in ("Хит продаж", "Хит", "Бестселлер", "Новинка", "Суперцена", "Выгодно", "Скидка"):
            if kw.lower() in p.lower():
                labels.append(kw)
        cards.append({"index": int(im.group(1)), "product_id": pid, "url": url,
                      "title": title, "price": price,
                      "rating": rating, "reviews": reviews, "labels": labels})
    return cards


# --------------------------------------------------------------------------
# 解析：商品详情
# --------------------------------------------------------------------------
def parse_detail(html_text):
    d = {}

    # 1) schema.org Product JSON-LD
    b = re.search(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', html_text, re.S)
    if b:
        try:
            ld = json.loads(b.group(1))
            if ld.get("@type") == "Product":
                d["name"] = ld.get("name")
                d["sku"] = ld.get("sku")
                d["description"] = ld.get("description")
                d["brand"] = ld.get("brand")
                ar = ld.get("aggregateRating") or {}
                d["rating"] = ar.get("ratingValue")
                d["review_count"] = ar.get("reviewCount")
                off = ld.get("offers") or {}
                d["price"] = off.get("price")
                d["price_currency"] = off.get("priceCurrency")
                d["availability"] = str(off.get("availability", "")).rsplit("/", 1)[-1]
        except Exception:
            pass

    # 2) <title>（Ozon 详情页标题含完整变体描述）
    t = re.search(r"<title[^>]*>(.*?)</title>", html_text, re.S)
    if t:
        d["title_full"] = clean(t.group(1))

    # 3) 卖家
    s = re.search(r'<a title="([^"]+)" href="https://www\.ozon\.ru/seller/[^"]+"', html_text)
    if s:
        d["seller"] = clean(s.group(1))

    # 4) 商品属性表（О товаре）
    attrs = {}
    for m in re.finditer(
            r'<span class="tsBodyM" style="color:var\(--textSecondary\);">(.*?)</span>'
            r'.*?<div class="pdp_b6o pdp_ob7[^"]*">(.*?)</div>', html_text, re.S):
        name = clean(re.sub(r"<[^>]+>", "", m.group(1)))
        val = clean(re.sub(r"<[^>]+>", "", m.group(2)))
        if name and val and name not in attrs:
            attrs[name] = val
    d["attributes"] = attrs

    # 5) 商品 id（Артикул 及链接兜底）
    ar = re.search(r"Артикул:\s*(\d+)", html_text)
    if ar:
        d.setdefault("sku", ar.group(1))
    return d


# --------------------------------------------------------------------------
# 全量特性（webCharacteristics）：详情页分块 pdpPage2column 懒加载数据
# --------------------------------------------------------------------------
def extract_sh(html_text):
    """详情页 HTML 内嵌的 sh（页面会话 token），用于后续分块接口"""
    m = re.search(r"[?&]sh=([A-Za-z0-9_-]{6,})", html_text)
    return m.group(1) if m else None


def parse_full_characteristics(state_json_text):
    """把 widgetStates['webCharacteristics-*'] 的值（多层 JSON）解析为 {属性名: 值}"""
    val = state_json_text
    for _ in range(6):
        try:
            val = json.loads(val)
        except Exception:
            break
        if not isinstance(val, str):
            break
    if not isinstance(val, dict):
        return {}
    attrs = {}
    for grp in val.get("characteristics", []) or []:
        if isinstance(grp, dict):
            grp = [v for v in grp.values() if isinstance(v, list)]
        if not isinstance(grp, list):
            continue
        for items in grp:
            if not isinstance(items, list):
                continue
            for it in items:
                if not isinstance(it, dict):
                    continue
                name = it.get("name")
                vals = [v.get("text") for v in (it.get("values") or []) if isinstance(v, dict) and v.get("text")]
                if name and vals:
                    attrs[name] = " / ".join(clean(str(x)) for x in vals)
    return attrs


def fetch_full_characteristics(fetcher, product_id, sh):
    """拉取商品详情页 pdpPage2column 分块并解析出全量特性。
    需要 sh（从详情页 HTML 提取）；首屏 page/json/v2 返回 requestID 用作 start_page_id。"""
    from urllib.parse import quote
    base = "https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url="
    rid = None
    # 1) 首屏 page json -> requestID
    try:
        path1 = f"/product/{product_id}/?sh={sh}"
        txt = fetcher.json_api(base + quote(path1, safe=""),
                               referer=f"https://www.ozon.ru/product/{product_id}/")
        d1 = json.loads(txt)
        rid = d1.get("requestID")
    except Exception:
        rid = None
    if not rid:
        return {}
    view = str(uuid.uuid4())
    # 2) pdpPage2column 分块
    path2 = (f"/product/{product_id}/?layout_container={PDP_BLOCK_CONTAINER}"
             f"&layout_page_index=2&sh={sh}&start_page_id={rid}")
    extra = [
        f"x-o3-parent-requestid: {rid}",
        f"x-page-view-id: {view}",
    ]
    txt2 = fetcher.json_api(base + quote(path2, safe=""), extra_headers=extra,
                            referer=f"https://www.ozon.ru/product/{product_id}/?sh={sh}")
    d2 = json.loads(txt2)
    ws = d2.get("widgetStates") or {}
    for key, val in ws.items():
        if key.startswith("webCharacteristics-") and isinstance(val, str):
            return parse_full_characteristics(val)
    return {}


# --------------------------------------------------------------------------
# 入口
# --------------------------------------------------------------------------
def search_url(text, page=1):
    from urllib.parse import quote
    # 注意：Ozon 对显式 page=1 会返回无数据的空壳页，因此第 1 页省略 page 参数
    if page <= 1:
        return f"https://www.ozon.ru/search/?text={quote(text)}&{GLOBAL_PARAM}"
    return (f"https://www.ozon.ru/search/?text={quote(text)}"
            f"&page={page}&{GLOBAL_PARAM}")


def detail_url(pid_or_path):
    if str(pid_or_path).isdigit():
        return f"https://www.ozon.ru/product/{pid_or_path}/?{GLOBAL_PARAM}"
    p = pid_or_path if pid_or_path.startswith("/") else "/" + pid_or_path
    p = re.sub(r"\?.*$", "", p)
    return f"https://www.ozon.ru{p}?{GLOBAL_PARAM}"


def category_url(cat, page=1):
    """分类页。cat 可为 'smartfony-15502'、纯 id '15502'、或完整 /category/... URL"""
    c = str(cat)
    if c.startswith("http"):
        c = re.sub(r"^https?://www\.ozon\.ru", "", c)
    if c.isdigit():
        c = f"/category/{c}/"
    if not c.startswith("/"):
        c = "/category/" + c + "/"
    c = re.sub(r"\?.*$", "", c)
    if page <= 1:
        return f"https://www.ozon.ru{c}?{GLOBAL_PARAM}"
    return f"https://www.ozon.ru{c}?page={page}&{GLOBAL_PARAM}"


def collect(fetcher, fo, src_label, page_url_fn, args, counter):
    """通用抓取循环：page_url_fn(page) -> url；解析卡片 -> 详情。返回 (seen 数量, 详情数增量)"""
    seen_ids = set()
    for page in range(1, args.pages + 1):
        url = page_url_fn(page)
        print(f"[{src_label}] {url}")
        try:
            html_text = fetcher.get(url)
        except Exception as e:
            print(f"[warn] 抓取失败 page={page}: {e}")
            break
        cards = parse_cards(html_text)
        print(f"[{src_label}] page={page} cards={len(cards)}")
        new_cards = [c for c in cards if c["product_id"] not in seen_ids]
        for c in new_cards:
            seen_ids.add(c["product_id"])
        if not cards:
            break
        time.sleep(args.interval)

        take = args.max_details - counter[0] if args.max_details > 0 else 0
        for c in new_cards[:max(take, 0)]:
            if args.max_details > 0 and counter[0] >= args.max_details:
                break
            write_detail(fetcher, fo, c, src_label, page, args, counter)
    return len(seen_ids)


def write_detail(fetcher, fo, card, src_label, page, args, counter):
    """抓取并写入一条商品详情记录（含可选的 --full-attrs 全量特性）"""
    if args.max_details > 0 and counter[0] >= args.max_details:
        return
    try:
        dh = fetcher.get(detail_url(card["product_id"]),
                         referer="https://www.ozon.ru" + card["url"])
    except Exception as e:
        print(f"[warn] 详情失败 id={card['product_id']}: {e}")
        return
    detail = parse_detail(dh)
    if getattr(args, "full_attrs", False):
        try:
            sh = extract_sh(dh)
            if sh:
                full = fetch_full_characteristics(fetcher, card["product_id"], sh)
                if full:
                    detail["attributes"] = full
                    detail["attributes_full"] = True
                    print(f"        [full-attrs] {len(full)} 项")
                time.sleep(args.interval)
        except Exception as e:
            print(f"[warn] 全量特性失败 id={card['product_id']}: {str(e)[:120]}")
    rec = {"source": src_label, "page": page, "card": card, "detail": detail,
           "crawled_at": datetime.datetime.now().isoformat(timespec="seconds")}
    fo.write(json.dumps(rec, ensure_ascii=False) + "\n")
    fo.flush()
    counter[0] += 1
    print(f"[detail] #{counter[0]} id={card['product_id']} "
          f"title={(detail.get('title_full') or detail.get('name'))[:60]!r} "
          f"price={detail.get('price')}")
    time.sleep(args.interval)


def _to_num(text):
    """'4.8'/'268 отзывов'/'1 006 ₽' -> 数值或 None"""
    if not text:
        return None
    m = re.search(r"[\d]+(?:\s[\d]+)*(?:[.,]\d+)?", str(text))
    if not m:
        return None
    raw = m.group(0).replace(" ", "").replace(",", ".")
    try:
        return float(raw)
    except ValueError:
        return None


def run_top(fetcher, fo, sources, args, counter):
    """筛选采集：先扫完所有列表页汇总商品池，按“评价数+评分”排序，取 top 进详情"""
    pool = {}   # product_id -> {card, src, page}
    # Phase 1: 收集所有页的商品卡片
    for label, page_url_fn in sources:
        seen = set()
        for page in range(1, args.pages + 1):
            url = page_url_fn(page)
            print(f"[scan {label}] {url}")
            try:
                html_text = fetcher.get(url)
            except Exception as e:
                print(f"[warn] 扫描失败 page={page}: {e}")
                break
            cards = parse_cards(html_text)
            if not cards:
                break
            for c in cards:
                if c["product_id"] in seen:
                    continue
                seen.add(c["product_id"])
                pool[c["product_id"]] = {"card": c, "src": label, "page": page}
            print(f"[scan {label}] page={page} cards={len(cards)} pool={len(pool)}")
            time.sleep(args.interval)

    # Phase 2: 过滤 + 排序
    def score(item):
        card = item["card"]
        rev = _to_num(card.get("reviews")) or 0.0
        rat = _to_num(card.get("rating")) or 0.0
        return (rev, rat)

    ranked = []
    for item in pool.values():
        rev = _to_num(item["card"].get("reviews")) or 0.0
        rat = _to_num(item["card"].get("rating")) or 0.0
        if args.min_reviews and rev < args.min_reviews:
            continue
        if args.min_rating and rat < args.min_rating:
            continue
        ranked.append((item, rev, rat))
    ranked.sort(key=lambda x: (x[1], x[2]), reverse=True)
    print(f"\n[filter] 池={len(pool)} 过筛={len(ranked)} 取 top={min(args.top, len(ranked))}")
    for i, (item, rev, rat) in enumerate(ranked[:args.top], 1):
        c = item["card"]
        print(f"  top{i}: id={c['product_id']} reviews={rev:.0f} rating={rat} title={(c.get('title') or '')[:50]}")
        write_detail(fetcher, fo, c, item["src"], item["page"], args, counter)


# --------------------------------------------------------------------------
# Job 模式：按契约 JSON 输入 -> JSON 输出（竞品头部榜单）
# --------------------------------------------------------------------------
# 网页分类 id（已探明/固化）与父类目
GENDER_PARENT_CATEGORY = {
    "Мужской": "/category/muzhskaya-odezhda-7542/",
    "Мужская": "/category/muzhskaya-odezhda-7542/",
    "Женский": "/category/zhenskaya-odezhda-7501/",
    "Женская": "/category/zhenskaya-odezhda-7501/",
}
KIDS_CATEGORY = "/category/detskaya-odezhda-7580/"
# 类目名（俄）-> 子分类 slug 关键字（用于在大类目录里自动发现子分类页）
PRODUCT_SLUG_KEYWORDS = {
    "Поло": "polo", "Футболка": "futbolk", "Футболки": "futbolk",
    "Рубашка": "rubashk", "Рубашки": "rubashk",
    "Платье": "plat", "Платья": "plat",
    "Брюки": "bryuki", "Шорты": "short", "Джинсы": "dzhins",
    "Свитшот": "svitshot", "Худи": "hudi", "Куртка": "kurtk",
}


def _discover_subcategory(fetcher, parent_path, product_type):
    """在大类页目录里找 product_type 对应的子分类页（返回 /category/.../ 路径或 None）"""
    kw = None
    for name, slug in PRODUCT_SLUG_KEYWORDS.items():
        if product_type and name.lower() in str(product_type).lower():
            kw = slug
            break
    if not kw:
        return None
    try:
        html_text = fetcher.get("https://www.ozon.ru" + parent_path + "?" + GLOBAL_PARAM)
    except Exception:
        return None
    seen = set()
    for m in re.finditer(r'href="(/category/[^"?#]+)"', html_text):
        u = m.group(1)
        if u in seen:
            continue
        seen.add(u)
        if kw in u.lower() and u != parent_path:
            return u
    return None


def resolve_category_url(fetcher, cat):
    """把契约类目对象解析成可扫描的网页分类路径。返回 (path, warning)"""
    # 1) 调用方可选提供的直链/查询词（内部约定，契约外的可选字段）
    if cat.get("ozonCategoryUrl"):
        u = cat["ozonCategoryUrl"]
        return (u if u.startswith("/") else "/" + u, None)
    if cat.get("ozonQuery"):
        from urllib.parse import quote
        return ("/search/?text=" + quote(cat["ozonQuery"]) + "&" + GLOBAL_PARAM, None)
    # 2) 内置/自动发现
    gender = cat.get("gender") or ""
    age = (cat.get("ageGroup") or "").lower()
    pt = cat.get("productType") or cat.get("categoryNameRu") or ""
    warn = None
    if "дет" in age or "дет" in gender.lower() or "дет" in pt.lower():
        parent = KIDS_CATEGORY
    else:
        parent = GENDER_PARENT_CATEGORY.get(gender) or GENDER_PARENT_CATEGORY.get(
            "Женский" if "жен" in gender.lower() else "Мужской")
        if not parent:
            parent = "/category/muzhskaya-odezhda-7542/"
            warn = "无法识别 gender，回退男装大类"
    child = _discover_subcategory(fetcher, parent, pt)
    if child:
        return (child, warn)
    if warn:
        return (parent, warn + "（未找到子分类，使用大类）")
    return (parent, "未找到细分分类，使用大类页")


def _price_number(detail, card):
    p = detail.get("price")
    if p is None:
        p = card.get("price")
    n = _to_num(p)
    return int(n) if n else None


PRODUCT_TYPE_ALIASES = {
    "платья": "платье",
    "рубашки": "рубашка",
    "футболки": "футболка",
}


def _normalize_product_type(value):
    value = clean(str(value or "")).casefold()
    return PRODUCT_TYPE_ALIASES.get(value, value)


def _observed_product_type(detail):
    for name, value in (detail.get("attributes") or {}).items():
        if clean(str(name)).casefold() in {"тип", "тип товара"}:
            return clean(str(value))
    return None


def _matches_product_type(detail, cat):
    expected = cat.get("productType") or cat.get("categoryNameRu")
    if not expected:
        return True, None
    observed = _observed_product_type(detail)
    if not observed:
        return False, None
    expected = _normalize_product_type(expected)
    observed_types = {
        _normalize_product_type(value)
        for value in re.split(r"\s*[/,;]\s*", observed)
    }
    return expected in observed_types, observed


def run_job(fetcher, job, args):
    """执行一次契约任务，返回结果 dict（与输入 requestId 对应）"""
    if not isinstance(job, dict) or not isinstance(job.get("categories") or [], list):
        raise ValueError("job.categories 必须是数组")
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    exclude = {str(s) for s in (job.get("excludeSkus") or [])}
    top_n = int(job.get("topN") or 5)
    pages = int(job.get("scanPages") or 5)
    if top_n < 1 or pages < 1:
        raise ValueError("topN 和 scanPages 必须大于 0")
    result = {
        "requestId": job.get("requestId", ""),
        "capturedAt": now,
        "rankingType": "public_popularity_proxy",
        "categories": [],
    }
    for cat in job.get("categories") or []:
        path, warn = resolve_category_url(fetcher, cat)
        cat_res = {
            "categoryKey": cat.get("categoryKey", ""),
            "scannedCount": 0,
            "eligibleCount": 0,
            "filteredMismatchedCount": 0,
            "competitors": [],
            "warnings": ([warn] if warn else []),
        }
        # 扫描列表池
        pool = {}
        seen = set()
        for page in range(1, pages + 1):
            url = ("https://www.ozon.ru" + path + "?"
                   + (GLOBAL_PARAM if page <= 1 else f"page={page}&" + GLOBAL_PARAM))
            if path.startswith("/search/"):
                url = ("https://www.ozon.ru" + path) if page <= 1 else (
                    "https://www.ozon.ru" + path + "&page=" + str(page))
            print(f"[job-scan] {url}", file=sys.stderr)
            try:
                html_text = fetcher.get(url)
            except Exception as e:
                cat_res["warnings"].append(f"page{page} 扫描失败: {str(e)[:100]}")
                break
            cards = parse_cards(html_text)
            if not cards:
                break
            for c in cards:
                if c["product_id"] in seen:
                    continue
                seen.add(c["product_id"])
                pool[c["product_id"]] = c
            time.sleep(args.interval)
        cat_res["scannedCount"] = len(pool)
        # 排除自家 SKU
        pool = {k: v for k, v in pool.items() if k not in exclude}
        cat_res["eligibleCount"] = len(pool)

        # 排序（评价数 + 评分）
        ranked = []
        for pid, c in pool.items():
            rev = _to_num(c.get("reviews")) or 0.0
            rat = _to_num(c.get("rating")) or 0.0
            ranked.append((c, rev, rat))
        ranked.sort(key=lambda x: (x[1], x[2]), reverse=True)
        # 抓取详情并组装 competitor
        for c, rev, rat in ranked:
            if len(cat_res["competitors"]) >= top_n:
                break
            detail = {}
            try:
                dh = fetcher.get(detail_url(c["product_id"]),
                                 referer="https://www.ozon.ru" + c["url"])
                detail = parse_detail(dh)
                sh = extract_sh(dh)
                if sh:
                    full = fetch_full_characteristics(fetcher, c["product_id"], sh)
                    if full:
                        detail["attributes"] = full
                time.sleep(args.interval)
            except Exception as e:
                print(f"[warn] 详情失败 id={c['product_id']}: {str(e)[:100]}", file=sys.stderr)
                cat_res["warnings"].append(f"id={c['product_id']} 详情抓取失败")
                continue
            matches, _ = _matches_product_type(detail, cat)
            if not matches:
                cat_res["filteredMismatchedCount"] += 1
                continue
            hot = bool(c.get("labels") and any(
                any(token in label.casefold() for token in ("хит", "бестселлер"))
                for label in c["labels"]
            ))
            review_count = int(_to_num(detail.get("review_count")) or rev)
            comp = {
                "publicRank": len(cat_res["competitors"]) + 1,
                "sku": c["product_id"],
                "url": f"https://www.ozon.ru/product/{c['product_id']}/",
                "title": detail.get("title_full") or c.get("title"),
                "description": detail.get("description"),
                "descriptionCategoryId": cat.get("descriptionCategoryId"),
                "typeId": cat.get("typeId"),
                "gender": cat.get("gender"),
                "ageGroup": cat.get("ageGroup"),
                "productType": cat.get("productType") or cat.get("categoryNameRu"),
                "priceRub": _price_number(detail, c),
                "rating": float(_to_num(detail.get("rating")) or rat),
                "reviewCount": review_count,
                "hotBadge": hot,
                "popularityProxy": hot or review_count >= 10000,
                "sellerName": detail.get("seller"),
                "brand": detail.get("brand") or None,
                "attributes": detail.get("attributes") or {},
            }
            cat_res["competitors"].append(comp)
        result["categories"].append(cat_res)
    return result


def main():
    ap = argparse.ArgumentParser(description="Ozon 商品采集器（纯 HTTP）")
    ap.add_argument("--text", nargs="+", default=None,
                    help="搜索关键词（可多个）。注意：Ozon 对部分热门词在纯 HTTP 下返回空壳页，"
                         "遇到请改用 --category 走分类页。")
    ap.add_argument("--category", nargs="+", default=None,
                    help="分类页，可多个。值可为 URL 或 'smartfony-15502' 或纯 id '15502'")
    ap.add_argument("--pages", type=int, default=1, help="每个来源抓取页数（每页约8个商品）")
    ap.add_argument("--full-attrs", action="store_true",
                    help="额外抓取商品详情页全量特性（Характеристики 完整表，每商品多 2 次请求）")
    ap.add_argument("--max-details", type=int, default=0, help="最多抓取详情数（0=只抓列表）")
    ap.add_argument("--top", type=int, default=0,
                    help="筛选模式：先扫全部列表页，按评价数(降序)+评分排序，只抓评价最高的前 N 个详情")
    ap.add_argument("--min-reviews", type=float, default=0,
                    help="配合 --top：只保留评价数 ≥ 此值的商品")
    ap.add_argument("--min-rating", type=float, default=0,
                    help="配合 --top：只保留评分 ≥ 此值的商品")
    ap.add_argument("--out", default="ozon_result.jsonl", help="输出 JSONL 路径")
    ap.add_argument("--tsv", default=None, help="Cookie-Editor 导出表格路径（与 --jar 二选一）")
    ap.add_argument("--jar", default=None, help="Netscape cookie jar 路径（与 --tsv 二选一）")
    ap.add_argument("--proxy", default=DEFAULT_PROXY, help="代理地址")
    ap.add_argument("--interval", type=float, default=REQUEST_INTERVAL, help="请求间隔秒数")
    ap.add_argument("--job", default=None,
                    help="Job 模式：传入契约 JSON 文件路径（含 requestId/topN/scanPages/categories/excludeSkus），"
                         "输出按契约返回榜单 JSON（打印到 stdout，亦可用 --out 存文件）")
    args = ap.parse_args()

    if not args.text and not args.category and not args.job:
        ap.error("请至少提供 --text / --category / --job 之一")

    if args.tsv:
        jar = os.path.join(tempfile.gettempdir(), "ozon_cookiejar_main.txt")
        build_jar_from_tsv(args.tsv, jar)
    elif args.jar:
        jar = os.path.abspath(args.jar)
    else:
        cand = os.path.join(tempfile.gettempdir(), "ozon_cookiejar_main.txt")
        if not os.path.exists(cand):
            ap.error("请提供 --tsv（导出的 cookie 表格）或 --jar（Netscape cookie 文件）")
        jar = cand

    fetcher = Fetcher(jar, proxy=args.proxy)
    print(f"[info] cookie: {jar}\n[info] proxy: {args.proxy}", file=sys.stderr)

    if args.job:
        with open(args.job, encoding="utf-8") as f:
            job = json.load(f)
        res = run_job(fetcher, job, args)
        out_txt = json.dumps(res, ensure_ascii=False, indent=2)
        if args.out:
            with open(args.out, "w", encoding="utf-8") as fo:
                fo.write(out_txt)
            print(f"[job] 已写入 {args.out}", file=sys.stderr)
        print(out_txt)
        return

    sources = []
    for text in args.text or []:
        sources.append((f"search:{text}", lambda p, t=text: search_url(t, p)))
    for cat in args.category or []:
        sources.append((f"category:{cat}", lambda p, c=cat: category_url(c, p)))

    counter = [0]
    with open(args.out, "w", encoding="utf-8") as fo:
        if args.top > 0:
            run_top(fetcher, fo, sources, args, counter)
        else:
            for label, fn in sources:
                collect(fetcher, fo, label, fn, args, counter)

    print(f"\n[done] 共 {counter[0]} 条详情记录 -> {args.out}")


if __name__ == "__main__":
    main()
