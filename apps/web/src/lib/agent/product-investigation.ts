import type { OzonAnalyticsProduct, OzonAnalyticsSummary } from "@saas/ozon";

type DiagnosticField = "status" | "visible" | "stock" | "priceRub";

export type DiagnosisEvidence = {
  id: string;
  offerId: string;
  productId: string | null;
  field: DiagnosticField;
  state: "AVAILABLE" | "MISSING" | "READ_FAILED";
  value: unknown;
  source: "ozon_product_info" | "ozon_product_stocks";
  capturedAt: string;
};

export type DiagnosisFinding = {
  id: string;
  offerId: string | null;
  status: "CONFIRMED" | "NEEDS_VERIFICATION" | "INSUFFICIENT_DATA" | "RULED_OUT";
  summary: string;
  evidenceIds: string[];
  neededEvidence: string[];
};

function sample(product: OzonAnalyticsProduct) {
  return {
    offerId: product.offerId,
    productId: product.productId,
    name: product.name,
    status: product.status,
    platformStatus: product.platformStatus ?? null,
    visible: product.visible,
    stock: product.stock,
    reservedStock: product.reservedStock,
    priceRub: product.priceRub,
    imageUrl: product.imageUrl,
    imageSemantics: "not_evaluated" as const,
  };
}

function fieldReadFailed(field: DiagnosticField, warnings: string[]) {
  const pattern = field === "stock" ? /库存同步失败/ : /商品详情同步失败/;
  return warnings.some((warning) => pattern.test(warning));
}

export function buildProductInvestigationEvidence(
  summary: OzonAnalyticsSummary,
  capturedAt = new Date().toISOString(),
) {
  const products = summary.products.filter((product) => !product.archived);
  const warnings = summary.warnings ?? [];
  const fields: DiagnosticField[] = ["status", "visible", "stock", "priceRub"];
  const missingByField = new Map(
    fields.map((field) => [
      field,
      products.filter((product) => product[field] === null).length,
    ]),
  );
  const dataGaps = fields.flatMap((field) => {
    const affectedProductCount = missingByField.get(field) ?? 0;
    if (!affectedProductCount) return [];
    return [{
      field,
      affectedProductCount,
      reason: fieldReadFailed(field, warnings) ? "read_failed" as const : "not_returned" as const,
    }];
  });

  const statusGroups = [...new Set(
    products.map((product) => product.status).filter((status): status is string => Boolean(status)),
  )].map((status) => {
    const matching = products.filter((product) => product.status === status);
    return {
      status,
      count: matching.length,
      samples: matching.slice(0, 5).map(sample),
    };
  });

  const signals = products.flatMap((product) => {
    if (product.stock !== null && product.stock > 0 && product.visible === false) {
      return [{
        kind: "stock_present_but_not_visible" as const,
        certainty: "confirmed_observation" as const,
        offerId: product.offerId,
        productId: product.productId,
        facts: { stock: product.stock, visible: product.visible, status: product.status },
        capturedAt,
      }];
    }
    return [];
  });
  const evidence: DiagnosisEvidence[] = products.flatMap((product) => fields.map((field) => {
    const value = product[field];
    const failed = value === null && fieldReadFailed(field, warnings);
    return {
      id: `ozon:${encodeURIComponent(product.offerId)}:${field}:${capturedAt}`,
      offerId: product.offerId,
      productId: product.productId,
      field,
      state: value !== null ? "AVAILABLE" as const : failed ? "READ_FAILED" as const : "MISSING" as const,
      value,
      source: field === "stock" ? "ozon_product_stocks" as const : "ozon_product_info" as const,
      capturedAt,
    };
  }));

  return {
    schemaVersion: 1 as const,
    capturedAt,
    dataHandling: "untrusted_external_data" as const,
    scope: {
      reportedProductCount: summary.productCount,
      scannedProductCount: summary.products.length,
      activeProductCount: products.length,
      complete: summary.products.length >= summary.productCount,
    },
    fieldCoverage: Object.fromEntries(fields.map((field) => {
      const missing = missingByField.get(field) ?? 0;
      return [field, {
        knownProductCount: products.length - missing,
        missingProductCount: missing,
        state: missing === 0 ? "complete" : missing === products.length ? "unavailable" : "partial",
      }];
    })),
    statusGroups,
    signals,
    dataGaps,
    evidence,
    excludedCauses: [] as Array<{ cause: string; evidence: string }>,
    pendingCauses: [] as Array<{ cause: string; neededEvidence: string }>,
  };
}

export function validateDiagnosisFindings(
  findings: DiagnosisFinding[],
  evidence: DiagnosisEvidence[],
) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  return findings.map((finding) => {
    const cited = finding.evidenceIds.map((id) => {
      const item = evidenceById.get(id);
      if (!item) throw new Error(`unknown_diagnosis_evidence:${id}`);
      if (finding.offerId && item.offerId !== finding.offerId) {
        throw new Error(`diagnosis_evidence_scope_mismatch:${id}`);
      }
      return item;
    });
    if (["CONFIRMED", "RULED_OUT"].includes(finding.status) &&
        !cited.some((item) => item.state === "AVAILABLE")) {
      throw new Error(`diagnosis_finding_requires_available_evidence:${finding.id}`);
    }
    if (finding.status === "NEEDS_VERIFICATION" && !finding.neededEvidence.length) {
      throw new Error(`diagnosis_finding_requires_next_check:${finding.id}`);
    }
    return {
      ...finding,
      evidence: cited,
    };
  });
}

export function evidenceFromProductRead(product: {
  offerId: string;
  productId: string | null;
  status: string | null;
  visible: boolean | null;
  stock: number | null;
  priceRub: number | null;
  capturedAt: string;
  readErrors?: Partial<Record<"details" | "stock", string>>;
}) {
  const values: Record<DiagnosticField, unknown> = {
    status: product.status,
    visible: product.visible,
    stock: product.stock,
    priceRub: product.priceRub,
  };
  return (Object.keys(values) as DiagnosticField[]).map((field): DiagnosisEvidence => {
    const source = field === "stock" ? "ozon_product_stocks" as const : "ozon_product_info" as const;
    const failed = field === "stock" ? product.readErrors?.stock : product.readErrors?.details;
    return {
      id: `ozon:${encodeURIComponent(product.offerId)}:${field}:${product.capturedAt}`,
      offerId: product.offerId,
      productId: product.productId,
      field,
      state: values[field] !== null ? "AVAILABLE" : failed ? "READ_FAILED" : "MISSING",
      value: values[field],
      source,
      capturedAt: product.capturedAt,
    };
  });
}
