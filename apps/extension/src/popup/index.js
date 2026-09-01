const apiBaseInput = document.getElementById("apiBase");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("login");
const limitInput = document.getElementById("limit");
const captureButton = document.getElementById("capture");
const statusEl = document.getElementById("status");

let authToken = "";

chrome.storage.sync.get(
  {
    apiBase: "http://localhost:3000",
    email: "admin@example.com",
    limit: "50",
    authToken: "",
  },
  ({ apiBase, email, limit, authToken: savedToken }) => {
    apiBaseInput.value = apiBase;
    emailInput.value = email;
    limitInput.value = limit;
    authToken = savedToken || "";
    statusEl.textContent = authToken ? "后台已登录，可以采集。" : "请先登录后台。";
  },
);

function normalizeApiBase(value) {
  return String(value || "http://localhost:3000").replace(/\/$/, "");
}

function clampLimit(value) {
  const n = Number(value || 50);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

function saveSettings() {
  chrome.storage.sync.set({
    apiBase: normalizeApiBase(apiBaseInput.value),
    email: emailInput.value.trim(),
    limit: String(clampLimit(limitInput.value)),
  });
}

apiBaseInput.addEventListener("change", saveSettings);
emailInput.addEventListener("change", saveSettings);
limitInput.addEventListener("change", saveSettings);

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

loginButton.addEventListener("click", async () => {
  statusEl.textContent = "正在登录后台...";
  loginButton.disabled = true;

  try {
    const apiBase = normalizeApiBase(apiBaseInput.value);
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    if (!email || !password) throw new Error("请输入后台邮箱和密码");

    const res = await fetch(`${apiBase}/api/v1/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.data?.sessionToken) {
      throw new Error(json.error?.message || `登录失败：HTTP ${res.status}`);
    }

    authToken = json.data.sessionToken;
    chrome.storage.sync.set({ apiBase, email, authToken });
    statusEl.textContent = "后台已登录，可以采集。";
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    loginButton.disabled = false;
  }
});

captureButton.addEventListener("click", async () => {
  statusEl.textContent = "正在采集店铺商品...";
  captureButton.disabled = true;

  try {
    const tab = await activeTab();
    if (!tab?.id) throw new Error("未找到当前标签页");
    if (!/\.1688\.com\//.test(tab.url || "")) {
      throw new Error("请先打开 1688 店铺商品页");
    }

    const apiBase = normalizeApiBase(apiBaseInput.value);
    const limit = clampLimit(limitInput.value);
    saveSettings();

    const response = await chrome.runtime.sendMessage({
      type: "CAPTURE_SHOP_TO_POOL",
      tabId: tab.id,
      apiBase,
      authToken,
      limit,
    });

    if (!response?.ok) {
      if (response?.status === 401) authToken = "";
      throw new Error(
        response?.error ||
          response?.json?.error?.message ||
          `导入失败：HTTP ${response?.status || 0}`,
      );
    }

    const data = response.json?.data || {};
    const captureFailed = response.captureFailures?.length || 0;
    statusEl.textContent = `完成：采集 ${response.collected || 0} 个，新增 ${data.created || 0} 个，更新 ${data.updated || 0} 个，失败 ${data.failed || captureFailed} 个。`;
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    captureButton.disabled = false;
  }
});
