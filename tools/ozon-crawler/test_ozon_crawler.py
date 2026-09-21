import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import ozon_crawler


class EmptyFetcher:
    def get(self, *_args, **_kwargs):
        return ""


class StaticFetcher:
    def __init__(self, html):
        self.html = html

    def get(self, *_args, **_kwargs):
        return self.html


class JobFetcher:
    def get(self, url, **_kwargs):
        return url


class OzonCrawlerJobTests(unittest.TestCase):
    def test_parse_detail_extracts_json_ld_images(self):
        detail = ozon_crawler.parse_detail("""
        <html><head>
        <script type="application/ld+json">
        {
          "@type": "Product",
          "name": "Поло мужское",
          "sku": "123",
          "description": "Поло на каждый день",
          "image": ["https://cdn.test/polo-1.jpg", "https://cdn.test/polo-2.webp"],
          "aggregateRating": {"ratingValue": "4.9", "reviewCount": "100"},
          "offers": {"price": "1499", "priceCurrency": "RUB"}
        }
        </script>
        </head><body></body></html>
        """)

        self.assertEqual("Поло мужское", detail["name"])
        self.assertEqual(["https://cdn.test/polo-1.jpg", "https://cdn.test/polo-2.webp"], detail["image_urls"])
        self.assertEqual("1499", detail["price"])

    def test_category_fallback_does_not_crash(self):
        path, warning = ozon_crawler.resolve_category_url(
            EmptyFetcher(),
            {"gender": "Женский", "productType": "Платье"},
        )

        self.assertEqual("/category/zhenskaya-odezhda-7501/", path)
        self.assertIn("使用大类页", warning)

    def test_job_rejects_wrong_type_and_backfills(self):
        cards = [
            {
                "product_id": "100",
                "url": "/product/wrong-100/",
                "title": "Мужское поло с ошибочным типом",
                "price": "1000",
                "rating": "4.9",
                "reviews": "20000",
                "labels": [],
            },
            {
                "product_id": "200",
                "url": "/product/right-200/",
                "title": "Мужское поло",
                "price": "1100",
                "rating": "4.8",
                "reviews": "15000",
                "labels": [],
            },
        ]

        def detail(page):
            product_type = "Футболка" if "/100/" in page else "Поло"
            return {
                "title_full": page,
                "attributes": {"Тип": product_type, "Пол": "Мужской"},
            }

        job = {
            "requestId": "test",
            "topN": 1,
            "scanPages": 1,
            "categories": [
                {
                    "categoryKey": "200000933:93194",
                    "categoryNameRu": "Поло",
                    "productType": "Поло",
                    "gender": "Мужской",
                }
            ],
        }
        args = SimpleNamespace(interval=0)

        with (
            mock.patch.object(ozon_crawler, "resolve_category_url", return_value=("/category/polo/", None)),
            mock.patch.object(ozon_crawler, "parse_cards", return_value=cards),
            mock.patch.object(ozon_crawler, "parse_detail", side_effect=detail),
            mock.patch.object(ozon_crawler, "extract_sh", return_value=None),
        ):
            result = ozon_crawler.run_job(JobFetcher(), job, args)

        category = result["categories"][0]
        self.assertEqual(["200"], [item["sku"] for item in category["competitors"]])
        self.assertEqual(1, category["filteredMismatchedCount"])
        self.assertFalse(category["competitors"][0]["hotBadge"])
        self.assertTrue(category["competitors"][0]["popularityProxy"])

    def test_job_prioritizes_matching_card_titles_before_fetching_details(self):
        cards = [
            {
                "product_id": "100",
                "url": "/product/tshirt-100/",
                "title": "Мужская футболка",
                "price": "1000",
                "rating": "4.9",
                "reviews": "20000",
                "labels": [],
            },
            {
                "product_id": "200",
                "url": "/product/polo-200/",
                "title": "Мужское поло",
                "price": "1100",
                "rating": "4.8",
                "reviews": "15000",
                "labels": [],
            },
        ]
        job = {
            "requestId": "test",
            "topN": 1,
            "scanPages": 1,
            "categories": [{"categoryKey": "1:2", "productType": "Поло"}],
        }
        args = SimpleNamespace(interval=0)

        with (
            mock.patch.object(ozon_crawler, "resolve_category_url", return_value=("/category/polo/", None)),
            mock.patch.object(ozon_crawler, "parse_cards", return_value=cards),
            mock.patch.object(
                ozon_crawler,
                "parse_detail",
                return_value={"attributes": {"Тип": "Поло"}},
            ) as parse_detail,
            mock.patch.object(ozon_crawler, "extract_sh", return_value=None),
        ):
            result = ozon_crawler.run_job(JobFetcher(), job, args)

        category = result["categories"][0]
        self.assertEqual(["200"], [item["sku"] for item in category["competitors"]])
        self.assertEqual(1, parse_detail.call_count)
        self.assertEqual(0, category["filteredMismatchedCount"])

    def test_job_fetches_detail_before_rejecting_product_type_mismatch(self):
        cards = [
            {
                "product_id": "100",
                "url": "/product/tshirt-100/",
                "title": "Футболка Top-Fun Семья 1 шт",
                "price": "1000",
                "rating": "5.0",
                "reviews": "11165",
                "labels": [],
            }
        ]
        job = {
            "requestId": "test",
            "topN": 1,
            "scanPages": 1,
            "categories": [{"categoryKey": "1:2", "productType": "Поло"}],
        }
        args = SimpleNamespace(interval=0)

        with (
            mock.patch.object(ozon_crawler, "resolve_category_url", return_value=("/category/polo/", None)),
            mock.patch.object(ozon_crawler, "parse_cards", return_value=cards),
            mock.patch.object(
                ozon_crawler,
                "parse_detail",
                return_value={"attributes": {"Тип": "Футболка", "Пол": "Мужской"}},
            ) as parse_detail,
            mock.patch.object(ozon_crawler, "extract_sh", return_value=None),
        ):
            result = ozon_crawler.run_job(JobFetcher(), job, args)

        category = result["categories"][0]
        self.assertEqual([], category["competitors"])
        self.assertEqual(1, category["filteredMismatchedCount"])
        self.assertEqual(1, parse_detail.call_count)

    def test_job_rejects_gender_mismatch_and_deduplicates_variants(self):
        cards = [
            {
                "product_id": "50",
                "url": "/product/unknown-50/",
                "title": "Лонгслив без пола",
                "price": "900",
                "rating": "5.0",
                "reviews": "40000",
                "labels": [],
            },
            {
                "product_id": "100",
                "url": "/product/female-100/",
                "title": "Лонгслив",
                "price": "1000",
                "rating": "5.0",
                "reviews": "30000",
                "labels": [],
            },
            {
                "product_id": "200",
                "url": "/product/male-200/",
                "title": "Лонгслив VARO",
                "price": "1100",
                "rating": "4.9",
                "reviews": "20000",
                "labels": [],
            },
            {
                "product_id": "201",
                "url": "/product/male-variant-201/",
                "title": "Лонгслив VARO",
                "price": "1150",
                "rating": "4.9",
                "reviews": "20000",
                "labels": [],
            },
            {
                "product_id": "202",
                "url": "/product/male-other-seller-202/",
                "title": "Лонгслив VARO",
                "price": "1175",
                "rating": "4.9",
                "reviews": "20000",
                "labels": [],
            },
            {
                "product_id": "300",
                "url": "/product/male-300/",
                "title": "Лонгслив ТВОЕ",
                "price": "1200",
                "rating": "4.8",
                "reviews": "10000",
                "labels": [],
            },
        ]

        def detail(page):
            if "/50/" in page:
                return {"attributes": {"Тип": "Лонгслив"}}
            gender = "Женский" if "/100/" in page else "Мужской"
            seller = "VARO" if "/200/" in page or "/201/" in page else "Other"
            return {
                "seller": seller,
                "attributes": {"Тип": "Лонгслив", "Пол": gender},
            }

        job = {
            "requestId": "test",
            "topN": 3,
            "scanPages": 1,
            "categories": [{
                "categoryKey": "1:2",
                "productType": "Лонгслив",
                "gender": "Мужской",
                "ageGroup": "Взрослые",
            }],
        }
        args = SimpleNamespace(interval=0)

        with (
            mock.patch.object(ozon_crawler, "resolve_category_url", return_value=("/search/?text=x", None)),
            mock.patch.object(ozon_crawler, "parse_cards", return_value=cards),
            mock.patch.object(ozon_crawler, "parse_detail", side_effect=detail),
            mock.patch.object(ozon_crawler, "extract_sh", return_value=None),
        ):
            result = ozon_crawler.run_job(JobFetcher(), job, args)

        category = result["categories"][0]
        self.assertEqual(["200", "202", "300"], [item["sku"] for item in category["competitors"]])
        self.assertEqual(1, category["filteredDemographicCount"])
        self.assertEqual(1, category["missingDemographicCount"], category)
        self.assertEqual(1, category["deduplicatedVariantCount"])

    def test_query_entry_uses_exact_search_flags(self):
        path, warning = ozon_crawler.resolve_category_url(
            EmptyFetcher(),
            {"ozonQuery": "Поло мужские"},
        )

        self.assertIsNone(warning)
        self.assertIn("deny_category_prediction=true", path)
        self.assertIn("force_spell=true", path)
        self.assertIn("text=%D0%9F%D0%BE%D0%BB%D0%BE%20%D0%BC%D1%83%D0%B6%D1%81%D0%BA%D0%B8%D0%B5", path)

    def test_known_mens_polo_uses_precise_category_before_search(self):
        path, warning = ozon_crawler.resolve_category_url(
            EmptyFetcher(),
            {
                "productType": "Поло",
                "gender": "Мужской",
                "ozonQuery": "Поло мужские",
            },
        )

        self.assertIsNone(warning)
        self.assertEqual(
            "/category/futbolki-i-polo-muzhskie-7558/?sorting=rating&text=%D0%9F%D0%BE%D0%BB%D0%BE%20%D0%BC%D1%83%D0%B6%D1%81%D0%BA%D0%B8%D0%B5",
            path,
        )

    def test_discovers_precise_category_from_search_page(self):
        html = """
        <a href="/category/longslivy-zhenskie-1234/">bad</a>
        <a href="/category/longslivy-muzhskie-5678/">good</a>
        <a href="/category/muzhskaya-odezhda-7542/">parent</a>
        """

        path, warning = ozon_crawler.resolve_category_url(
            StaticFetcher(html),
            {
                "productType": "Лонгслив",
                "gender": "Мужской",
                "ageGroup": "Взрослые",
                "ozonQuery": "Лонгслив мужские",
            },
        )

        self.assertEqual("/category/longslivy-muzhskie-5678/?sorting=rating", path)
        self.assertIsNone(warning)

    def test_discovers_generic_category_by_transliterated_slug(self):
        html = """
        <a href="/category/lyustry-100/">bad</a>
        <a href="/category/nastolnye-lampy-200/">good</a>
        """

        path, warning = ozon_crawler.resolve_category_url(
            StaticFetcher(html),
            {
                "productType": "Настольная лампа",
                "categoryNameRu": "Настольная лампа",
                "ozonQuery": "Настольная лампа",
            },
        )

        self.assertEqual("/category/nastolnye-lampy-200/?sorting=rating", path)
        self.assertIsNone(warning)

    def test_job_skips_obvious_child_and_womens_cards_for_menswear(self):
        cards = [
            {
                "product_id": "100",
                "url": "/product/girl-100/",
                "title": "Поло Девочки MINAKU",
                "price": "1000",
                "rating": "5.0",
                "reviews": "40000",
                "labels": [],
            },
            {
                "product_id": "200",
                "url": "/product/woman-200/",
                "title": "Поло женское базовое",
                "price": "1100",
                "rating": "5.0",
                "reviews": "30000",
                "labels": [],
            },
            {
                "product_id": "300",
                "url": "/product/male-300/",
                "title": "Поло мужское базовое",
                "price": "1200",
                "rating": "4.9",
                "reviews": "10000",
                "labels": [],
            },
        ]
        job = {
            "requestId": "test",
            "topN": 1,
            "scanPages": 1,
            "categories": [{
                "categoryKey": "1:2",
                "productType": "Поло",
                "gender": "Мужской",
                "ageGroup": "Взрослые",
            }],
        }
        args = SimpleNamespace(interval=0)

        with (
            mock.patch.object(ozon_crawler, "resolve_category_url", return_value=("/category/polo/", None)),
            mock.patch.object(ozon_crawler, "parse_cards", return_value=cards),
            mock.patch.object(
                ozon_crawler,
                "parse_detail",
                side_effect=[
                    {"attributes": {"Тип": "Поло", "Пол": "Девочки"}},
                    {"attributes": {"Тип": "Поло", "Пол": "Женский"}},
                    {"attributes": {"Тип": "Поло", "Пол": "Мужской"}},
                ],
            ) as parse_detail,
            mock.patch.object(ozon_crawler, "extract_sh", return_value=None),
        ):
            result = ozon_crawler.run_job(JobFetcher(), job, args)

        category = result["categories"][0]
        self.assertEqual(["300"], [item["sku"] for item in category["competitors"]])
        self.assertEqual(2, category["filteredDemographicCount"])
        self.assertEqual(3, parse_detail.call_count)

    def test_job_skips_child_detail_title_for_menswear(self):
        cards = [
            {
                "product_id": "100",
                "url": "/product/rubashka-100/",
                "title": "Рубашка белая",
                "price": "1000",
                "rating": "5.0",
                "reviews": "40000",
                "labels": [],
            },
            {
                "product_id": "200",
                "url": "/product/rubashka-200/",
                "title": "Рубашка мужская",
                "price": "1100",
                "rating": "4.9",
                "reviews": "10000",
                "labels": [],
            },
        ]

        def detail(page):
            if "/100/" in page:
                return {
                    "title_full": "Рубашка Gloria Jeans для мальчиков подростков",
                    "attributes": {"Тип": "Рубашка", "Пол": "Мужской"},
                }
            return {
                "title_full": "Рубашка мужская хлопковая",
                "attributes": {"Тип": "Рубашка", "Пол": "Мужской"},
            }

        job = {
            "requestId": "test",
            "topN": 1,
            "scanPages": 1,
            "categories": [{
                "categoryKey": "1:2",
                "productType": "Рубашка",
                "gender": "Мужской",
                "ageGroup": "Взрослые",
            }],
        }
        args = SimpleNamespace(interval=0)

        with (
            mock.patch.object(ozon_crawler, "resolve_category_url", return_value=("/category/rubashki/", None)),
            mock.patch.object(ozon_crawler, "parse_cards", return_value=cards),
            mock.patch.object(ozon_crawler, "parse_detail", side_effect=detail),
            mock.patch.object(ozon_crawler, "extract_sh", return_value=None),
        ):
            result = ozon_crawler.run_job(JobFetcher(), job, args)

        category = result["categories"][0]
        self.assertEqual(["200"], [item["sku"] for item in category["competitors"]])
        self.assertEqual(1, category["filteredDemographicCount"])

    def test_job_keeps_unisex_products_for_menswear_after_detail_fetch(self):
        cards = [
            {
                "product_id": "100",
                "url": "/product/unisex-polo-100/",
                "title": "Поло для мужчин и женщин",
                "price": "1200",
                "rating": "5.0",
                "reviews": "20000",
                "labels": [],
            },
        ]
        job = {
            "requestId": "test",
            "topN": 1,
            "scanPages": 1,
            "categories": [{
                "categoryKey": "1:2",
                "productType": "Поло",
                "gender": "Мужской",
                "ageGroup": "Взрослые",
            }],
        }
        args = SimpleNamespace(interval=0)

        with (
            mock.patch.object(ozon_crawler, "resolve_category_url", return_value=("/category/polo/", None)),
            mock.patch.object(ozon_crawler, "parse_cards", return_value=cards),
            mock.patch.object(
                ozon_crawler,
                "parse_detail",
                return_value={
                    "title_full": "Поло для мужчин и женщин",
                    "description": "Универсальное поло для взрослых.",
                    "attributes": {"Тип": "Поло", "Пол": "Мужчины и женщины"},
                },
            ),
            mock.patch.object(ozon_crawler, "extract_sh", return_value=None),
        ):
            result = ozon_crawler.run_job(JobFetcher(), job, args)

        category = result["categories"][0]
        self.assertEqual(["100"], [item["sku"] for item in category["competitors"]])
        self.assertEqual(0, category["filteredDemographicCount"])

    def test_job_skips_ozon_error_page_details(self):
        cards = [
            {
                "product_id": "100",
                "url": "/product/hudi-100/",
                "title": "Худи мужское",
                "price": "1000",
                "rating": "5.0",
                "reviews": "40000",
                "labels": [],
            },
            {
                "product_id": "200",
                "url": "/product/hudi-200/",
                "title": "Худи мужское",
                "price": "1100",
                "rating": "4.9",
                "reviews": "10000",
                "labels": [],
            },
        ]

        def detail(page):
            if "/100/" in page:
                return {
                    "title_full": "warning Похоже",
                    "attributes": {"Image 1": "нет соединения\nВыключите VPN\nИнцидент: test"},
                }
            return {
                "title_full": "Худи мужское хлопковое",
                "description": "Мужское худи на каждый день.",
                "attributes": {"Тип": "Худи", "Пол": "Мужской"},
            }

        job = {
            "requestId": "test",
            "topN": 1,
            "scanPages": 1,
            "categories": [{
                "categoryKey": "1:2",
                "productType": "Худи",
                "gender": "Мужской",
                "ageGroup": "Взрослые",
            }],
        }
        args = SimpleNamespace(interval=0)

        with (
            mock.patch.object(ozon_crawler, "resolve_category_url", return_value=("/category/hudi/", None)),
            mock.patch.object(ozon_crawler, "parse_cards", return_value=cards),
            mock.patch.object(ozon_crawler, "parse_detail", side_effect=detail),
            mock.patch.object(ozon_crawler, "extract_sh", return_value=None),
        ):
            result = ozon_crawler.run_job(JobFetcher(), job, args)

        category = result["categories"][0]
        self.assertEqual(["200"], [item["sku"] for item in category["competitors"]])
        self.assertEqual(1, category["filteredInvalidEvidenceCount"])

    def test_job_skips_characteristics_index_pages(self):
        cards = [
            {
                "product_id": "100",
                "url": "/product/polo-100/",
                "title": "Мужское поло",
                "price": "1200",
                "rating": "5.0",
                "reviews": "20000",
                "labels": [],
            },
            {
                "product_id": "200",
                "url": "/product/polo-200/",
                "title": "Мужское поло",
                "price": "1100",
                "rating": "4.9",
                "reviews": "10000",
                "labels": [],
            },
        ]

        def detail(page):
            if "/100/" in page:
                return {
                    "title_full": "Характеристики Поло Polo Ralph Lauren одежда мужская 1 шт",
                    "attributes": {"Тип": "Поло", "Пол": "Мужской"},
                }
            return {
                "title_full": "Поло мужское хлопковое",
                "description": "Мужское поло на каждый день.",
                "image_urls": ["https://cdn.test/polo.jpg"],
                "attributes": {"Тип": "Поло", "Пол": "Мужской"},
            }

        job = {
            "requestId": "test",
            "topN": 1,
            "scanPages": 1,
            "categories": [{
                "categoryKey": "1:2",
                "productType": "Поло",
                "gender": "Мужской",
                "ageGroup": "Взрослые",
            }],
        }
        args = SimpleNamespace(interval=0)

        with (
            mock.patch.object(ozon_crawler, "resolve_category_url", return_value=("/category/polo/", None)),
            mock.patch.object(ozon_crawler, "parse_cards", return_value=cards),
            mock.patch.object(ozon_crawler, "parse_detail", side_effect=detail),
            mock.patch.object(ozon_crawler, "extract_sh", return_value=None),
        ):
            result = ozon_crawler.run_job(JobFetcher(), job, args)

        category = result["categories"][0]
        self.assertEqual(["200"], [item["sku"] for item in category["competitors"]])
        self.assertEqual(["https://cdn.test/polo.jpg"], category["competitors"][0]["imageUrls"])
        self.assertEqual(1, category["filteredInvalidEvidenceCount"])

    def test_job_cli_writes_only_json_to_stdout(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            job_path = root / "job.json"
            out_path = root / "out.json"
            jar_path = root / "cookies.txt"
            job_path.write_text('{"requestId":"test","categories":[]}', encoding="utf-8")
            jar_path.write_text("# Netscape HTTP Cookie File\n", encoding="utf-8")
            stdout = io.StringIO()
            stderr = io.StringIO()

            with (
                mock.patch.object(
                    sys,
                    "argv",
                    [
                        "ozon_crawler.py",
                        "--job",
                        str(job_path),
                        "--out",
                        str(out_path),
                        "--jar",
                        str(jar_path),
                    ],
                ),
                mock.patch.object(ozon_crawler, "Fetcher"),
                mock.patch.object(ozon_crawler, "run_job", return_value={"requestId": "test"}),
                contextlib.redirect_stdout(stdout),
                contextlib.redirect_stderr(stderr),
            ):
                ozon_crawler.main()

        self.assertEqual({"requestId": "test"}, json.loads(stdout.getvalue()))
        self.assertIn("[info]", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
