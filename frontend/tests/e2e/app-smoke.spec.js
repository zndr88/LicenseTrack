import { expect, test } from "@playwright/test";

const E2E_ORIGIN = "http://127.0.0.1:5177";

const licenses = [
  {
    id: 1,
    publisherName: "Zeta Systems",
    softwareDescription: "Zeta Backup",
    licenseType: "subscription",
    licenseMetric: "per_device",
    quantity: "25",
    unitPrice: "40",
    totalPoPrice: "1000",
    currency: "EUR",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    expirationStatus: "active",
    daysUntilExpiry: 201,
    supplier: "Zeta Direct",
    costCentre: "Infrastructure",
    contractNumber: "ZETA-2026",
    poNumber: "PO-ZETA",
    completenessPct: 100,
    isRetired: false,
    documentCount: 0,
  },
  {
    id: 2,
    publisherName: "Acme Software",
    softwareDescription: "Acme Suite",
    licenseType: "subscription",
    licenseMetric: "per_user",
    quantity: "10",
    unitPrice: "100",
    totalPoPrice: "1000",
    currency: "EUR",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    expirationStatus: "expiring",
    daysUntilExpiry: 20,
    supplier: "Acme Supplier",
    costCentre: "IT",
    contractNumber: "ACME-2026",
    poNumber: "PO-ACME",
    completenessPct: 100,
    isRetired: false,
    documentCount: 0,
  },
  {
    id: 3,
    publisherName: "Contoso Security",
    softwareDescription: "Endpoint Protection",
    licenseType: "perpetual",
    licenseMetric: "per_device",
    quantity: "50",
    unitPrice: "20",
    totalPoPrice: "1000",
    currency: "EUR",
    startDate: "2025-01-01",
    endDate: "",
    expirationStatus: "perpetual",
    supplier: "Contoso Direct",
    costCentre: "Security",
    contractNumber: "CONTOSO-2025",
    poNumber: "PO-CONTOSO",
    completenessPct: 80,
    isRetired: false,
    documentCount: 1,
  },
];

const previewResult = {
  totalRows: 1,
  validRows: 1,
  activeCount: 1,
  legacyExemptCount: 0,
  legacyIncompleteCount: 0,
  errorCount: 0,
  headersMissing: [],
  warningSummary: {
    hasWarnings: false,
    defaultedEnumCount: 0,
    ambiguousDateCount: 0,
    inferredParentCount: 0,
    duplicateWarningCount: 0,
    defaultedCurrencyCount: 0,
  },
  rows: [
    {
      rowNumber: 1,
      publisherName: "Acme Software",
      softwareDescription: "Acme Suite",
      licenseType: "subscription",
      quantity: "10",
      unitPrice: "100",
      totalPoPrice: "1000",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      contractNumber: "ACME-2026",
      poNumber: "PO-ACME",
      supplier: "Acme Supplier",
      costCentre: "IT",
      importStatus: "active",
      validationErrors: [],
      warnings: [],
      duplicateWarnings: [],
    },
  ],
};

async function mockApi(page, { authenticated }) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": E2E_ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  };

  const state = {
    licenseRequests: 0,
    importPreviewRequests: 0,
  };

  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders });
    }

    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === "/api/auth/session") {
      return route.fulfill({
        headers: corsHeaders,
        json: authenticated
          ? {
              authenticated: true,
              user: {
                id: 1,
                username: "admin",
                name: "Admin User",
                avatar: "AD",
                role: "admin",
                must_change_password: false,
                auth_provider: "local",
              },
            }
          : { authenticated: false, user: null },
      });
    }

    if (path === "/api/auth/mode") {
      return route.fulfill({ headers: corsHeaders, json: { oidc_enabled: false, oidc_available: false } });
    }

    if (path === "/api/settings") {
      return route.fulfill({
        headers: corsHeaders,
        json: {
          theme: "gray",
          saved_views: [],
          visible_in_list: {},
          visible_in_detail: {},
          column_order: [],
          number_format_locale: "en-US",
          date_format: "YYYY-MM-DD",
          display_currency: "EUR",
        },
      });
    }

    if (path === "/api/settings/global" || path === "/api/settings/global/public") {
      return route.fulfill({
        headers: corsHeaders,
        json: {
          mandatory_fields: {},
          notification_days: 30,
          notification_send_hour: 7,
          allowed_email_domains: "",
          email_enabled: false,
        },
      });
    }

    if (path === "/api/licenses" || path === "/api/licenses/") {
      state.licenseRequests += 1;
      return route.fulfill({ headers: corsHeaders, json: licenses });
    }

    if (path === "/api/licenses/stats") {
      return route.fulfill({
        headers: corsHeaders,
        json: {
          total_active: 2,
          total_expiring: 1,
          total_expired: 0,
          total_renewed: 0,
          annual_cost_by_currency: { EUR: 3000 },
          excluded_from_totals: 0,
        },
      });
    }

    if (path === "/api/reports/portfolio-stats") {
      return route.fulfill({
        headers: corsHeaders,
        json: {
          total_active: 2,
          total_expiring: 1,
          total_expired: 0,
          total_incomplete: 1,
          annual_cost_by_currency: { EUR: 3000 },
          excluded_from_totals: 0,
          by_license_type: [],
        },
      });
    }

    if (path === "/api/import/preview") {
      state.importPreviewRequests += 1;
      return route.fulfill({ headers: corsHeaders, json: previewResult });
    }

    if (path === "/api/custom-fields/values" || path === "/api/custom-fields/values/") {
      return route.fulfill({ headers: corsHeaders, json: { values: [] } });
    }

    if (path === "/api/notifications" || path === "/api/pending-orders" || path === "/api/sourcing" || path === "/api/sourcing/requests" || path === "/api/custom-fields/") {
      return route.fulfill({ headers: corsHeaders, json: [] });
    }

    if (path.startsWith("/api/licenses/") && path.endsWith("/custom-fields/")) {
      return route.fulfill({ headers: corsHeaders, json: { values: [] } });
    }

    if (path.startsWith("/api/licenses/") && path.endsWith("/documents")) {
      return route.fulfill({ headers: corsHeaders, json: [] });
    }

    return route.fulfill({ headers: corsHeaders, json: [] });
  });

  return state;
}

test("anonymous users see the login screen", async ({ page }) => {
  await mockApi(page, { authenticated: false });

  await page.goto("/");

  await expect(page.getByRole("button", { name: /sign in locally/i })).toBeVisible();
});

test("authenticated users land on the app shell", async ({ page }) => {
  await mockApi(page, { authenticated: true });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: /license overview/i })).toBeVisible();
  await expect(page.getByText("PORTFOLIO CONDITION")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reports" })).toBeVisible();
  await expect(page.getByRole("button", { name: "License Overview" })).toHaveAttribute("aria-current", "page");
});

test("license table supports publisher sorting and search", async ({ page }) => {
  const apiState = await mockApi(page, { authenticated: true });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /license overview/i })).toBeVisible();
  await expect.poll(() => apiState.licenseRequests).toBeGreaterThan(0);

  const rows = page.locator(".license-table tbody tr");
  await expect(rows).toHaveCount(3);

  await page.getByRole("columnheader", { name: /publisher/i }).click();
  await expect(rows.first()).toContainText("Acme Software");

  await page.getByRole("columnheader", { name: /publisher/i }).click();
  await expect(rows.first()).toContainText("Zeta Systems");

  await page.getByRole("textbox", { name: /search licenses/i }).fill("contoso");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Contoso Security");
  await expect(page.getByText("Zeta Systems")).toBeHidden();
});

test("CSV import upload reaches preview without leaving the browser shell", async ({ page }) => {
  const apiState = await mockApi(page, { authenticated: true });

  await page.goto("/");
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("heading", { name: /import licenses/i })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "licenses.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("publisher_name,software_description\nAcme Software,Acme Suite\n"),
  });

  await expect(page.getByText("Rows found")).toBeVisible();
  await expect(page.getByText("1 will import")).toBeVisible();
  await expect(page.getByRole("button", { name: /import 1 license/i })).toBeVisible();
  expect(apiState.importPreviewRequests).toBe(1);
});
