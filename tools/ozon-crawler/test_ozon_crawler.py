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


class JobFetcher:
    def get(self, url, **_kwargs):
        return url


class OzonCrawlerJobTests(unittest.TestCase):
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
