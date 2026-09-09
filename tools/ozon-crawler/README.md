# Ozon 商品采集器（纯 HTTP，无浏览器自动化）

抓取 [Ozon](https://www.ozon.ru) 搜索结果与商品详情，输出 JSONL。

## 背景（为什么这么实现）

- Ozon 对海外/非浏览器客户端做了多层防护，实测结论：
  - `requests`（Python OpenSSL TLS 指纹）→ 直接 403；
  - `curl_cffi` 模拟 Chrome → 仍 403；
  - Windows 原生 `curl.exe`（schannel TLS）→ 可访问；
  - 但**必须带 `from_global=true`**，否则 Ozon 返回不含数据的空壳页（海外用户只能看 global 版）。
- Ozon 是服务端渲染（SSR）：商品数据直接内嵌在 HTML（搜索页商品卡片 DOM + 详情页 `application/ld+json`），因此无需逆向内部 XHR 接口，**直接解析 HTML** 即可。
- 会话凭证：需要浏览器里有效的 Ozon 登录 cookie（从浏览器导出），用于绕过验证码层。

## 环境要求

- Windows + 自带 `curl.exe`
- Python 3.8+
- 本地可用代理端口（默认 `socks5h://127.0.0.1:10808`，可 `--proxy` 覆盖）
- 有效的 Ozon 会话 cookie（Cookie-Editor 导出表格 或 Netscape jar）

## 准备 cookie

任选其一：

1. `--tsv 文件`：Cookie-Editor 扩展在 `ozon.ru` 页面导出的制表符表格（含域、HttpOnly、Secure 列）；
2. `--jar 文件`：已存在的 Netscape 格式 cookie 文件。

> ⚠️ cookie 等同登录凭证，**不要提交到仓库/分享**。运行目录会忽略临时生成的 jar（默认生成在系统临时目录）。

## 用法

```powershell
# 搜索“女装”，抓 2 页列表，取前 5 个商品详情（含全量特性表），输出到 result.jsonl
python ozon_crawler.py --text 女装 --pages 2 --max-details 5 --full-attrs `
  --out result.jsonl --tsv C:\path\to\cookies.tsv

# 按分类抓取（推荐：热门品类稳定；如智能手机分类）
python ozon_crawler.py --category "https://www.ozon.ru/category/smartfony-15502/" `
  --pages 3 --max-details 10 --out phones.jsonl --tsv C:\path\to\cookies.tsv
# 分类也可用简写：--category smartfony-15502 或纯 id --category 15502

# 只抓列表不下详情（注意：热门词如 iphone 会空壳，示例用普通词）
python ozon_crawler.py --text 连衣裙 --pages 1 --max-details 0 `
  --jar C:\path\to\cookies.jar

# 搜索与分类混用
python ozon_crawler.py --text 女装 --category "https://www.ozon.ru/category/noutbuki-15453/" `
  --pages 1 --max-details 3 --out mix.jsonl --tsv C:\path\to\cookies.tsv
```

### Job 模式（Agent 调用契约）

```powershell
python ozon_crawler.py --job job_input.json --out job_output.json --tsv cookies.tsv
```

`job_input.json` 契约束（示例见 `job_demo_input.json`）：

```json
{
  "requestId": "run-001",
  "storeId": "store-001",
  "topN": 5,
  "scanPages": 10,
  "categories": [{
    "categoryKey": "200000933:93194",
    "descriptionCategoryId": 200000933,
    "typeId": 93194,
    "categoryNameRu": "Поло",
    "gender": "Мужской",
    "ageGroup": "Взрослые",
    "productType": "Поло",
    "referencePriceRub": 1299
  }],
  "excludeSkus": []
}
```

执行流程：每个 category 自动解析为可扫描的网页分类（内置 Поло 等映射 + 按 gender/ageGroup 选父类 + 大类目录自动发现细分；亦可在 category 对象里加内部可选字段 `ozonCategoryUrl`/`ozonQuery` 直接指定入口）→ 扫 `scanPages` 页 → 排除 `excludeSkus` → 按评价数+评分排序取 `topN` → 逐条抓详情（标题/描述/价格/评分/评价数/卖家/品牌/全量属性）→ 输出契约 JSON（`requestId`/`capturedAt`/`rankingType`/`categories[].competitors[]`，见 `job_demo_output.json`），打印到 stdout。

> 说明：`hotBadge` 为“列表页热销/新品徽章 或 评价数≥1万”的近似标记（Ozon 不公开真实销量与类目排名）；个别详情抓取失败会记入 `warnings` 并跳过，不影响其余竞品。

### 参数

| 参数 | 说明 |
|---|---|
| `--text` | 搜索关键词，可多个 |
| `--category` | 分类页，可多个（URL / `slug-id` / 纯 id）。**推荐**：热门品类用分类页最稳定 |
| `--pages` | 每来源抓取页数（每页约 8 个商品），默认 1 |
| `--max-details` | 全局最多抓详情数；0 = 不抓详情（默认 0） |
| `--full-attrs` | **抓全量特性表**（Характеристики 完整项，含颜色/尺码/产地/洗涤等 14~20+ 项）。纯 HTTP，每商品多 2 次内部请求；默认关闭（不加时只抓页面首屏 5 项短特性） |
| `--out` | 输出 JSONL 路径 |
| `--tsv` / `--jar` | cookie 来源（二选一） |
| `--proxy` | 代理，默认 `socks5h://127.0.0.1:10808` |
| `--interval` | 请求间隔秒数，默认 1.5（限速，勿调太低） |

> ⚠️ **已知限制（重要）**：Ozon 对**部分热门搜索词**（如 `iphone`、`ноутбук`、`кроссовки`）
> 在纯 HTTP（无浏览器 JS）请求下会返回"空壳页"（无任何商品数据），此类请求需真实浏览器才能拿数据。
> 规避办法：这些品类改用 **分类页**（`--category`，SSR 稳定返回数据）；或换用能正常返回的长尾/非热门词。
> 另外 URL 不要带显式 `page=1`（会触发同样的空壳页），采集器已自动处理。
> **详情页完整特性表**（Характеристики，10~20+ 项）默认不抓取（页面首屏只给 5 项短特性），加 `--full-attrs`
> 后通过详情页 `pdpPage2column` 分块接口以纯 HTTP 抓全（无需浏览器自动化）。

## 输出格式（JSONL，每行一条详情记录）

```json
{
  "source": "search:女装",
  "page": 1,
  "card": {
    "product_id": "1743192079",
    "url": "/product/komplekt-termobelya-1743192079/?at=...",
    "image": "https://ir.ozone.ru/s3/multimedia-1-h/wc500/...jpg",
    "title": "Комплект термобелья",
    "price": "1 006 ₽",
    "rating": "5.0",
    "reviews": "1 отзыв"
  },
  "detail": {
    "name": "Комплект термобелья",
    "sku": "1743192079",
    "description": "...",
    "brand": "",
    "rating": "5.0",
    "review_count": "1",
    "price": "1059",
    "price_currency": "RUB",
    "availability": "InStock",
    "title_full": "Комплект термобелья Женский, размер 52 ... (1743192079)",
    "seller": "Warm Underwear Shop",
    "attributes": {"Сезон": "Зима", "Материал": "Лавсан", "...": "..."},
    "image": "https://ir.ozone.ru/s3/multimedia-1-h/c600/....jpg",
    "images_all": ["..."]
  },
  "crawled_at": "2026-09-08T14:39:09"
}
```

> 说明：`detail.price` 取自 schema.org `offers.price`（Ozon 的“含银行卡价”），
> 列表页 `card.price` 为页面主展示价，两者含义不同；字段含义以页面实际展示为准。

## 注意事项 / 合规

- 仅用于个人学习与合理规模的数据收集；请遵守 Ozon 服务条款、robots 协议及当地法律。
- 已内置限速（默认 1.5s/请求），不要暴力抓取，避免账号/IP 被封。
- cookie 会过期，失效后请重新导出。
- 本工具依赖 Ozon 页面结构，若 Ozon 改版导致解析失效，需要同步更新 `parse_cards` / `parse_detail`。
