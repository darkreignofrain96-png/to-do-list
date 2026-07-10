const STORAGE_KEY = "ux-todo-list-tool-v1";
const GAS_CONFIG_KEY = "ux-todo-list-tool-gas-v1";
const UI_CONFIG_KEY = "ux-todo-list-tool-ui-v1";
const XLSX_DATE_OFFSET = 25569;
const VERCEL_GAS_ENDPOINT = "/api/gas";

const quadrantMeta = {
  q1: {
    label: "第1象限",
    text: "緊急・重要",
    hint: "今日処理する",
    important: true,
    urgent: true,
  },
  q2: {
    label: "第2象限",
    text: "重要・緊急ではない",
    hint: "先に予定化する",
    important: true,
    urgent: false,
  },
  q3: {
    label: "第3象限",
    text: "緊急・重要ではない",
    hint: "任せる・まとめる",
    important: false,
    urgent: true,
  },
  q4: {
    label: "第4象限",
    text: "緊急でも重要でもない",
    hint: "減らす・やめる",
    important: false,
    urgent: false,
  },
};

let state = loadState();
let hasStoredGasConfig = false;
let gasConfig = loadGasConfig();
let uiConfig = loadUiConfig();
let activeView = "today";
let saveTimer = null;
let gasSaveTimer = null;
let preferredProjectId = "";
let gasProxyAvailable = false;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

init();

function init() {
  bindEvents();
  render();
  detectVercelGasProxyConfig();
}

function bindEvents() {
  $("#selectedDate").addEventListener("change", (event) => {
    state.selectedDate = event.target.value || todayISO();
    saveAndRender();
  });

  $$("[data-view-button]").forEach((button) => {
    button.addEventListener("click", () => {
      activeView = button.dataset.viewButton;
      render();
    });
  });

  $("#quickTaskForm").addEventListener("submit", handleQuickTask);
  $("#todayTaskPickerForm").addEventListener("submit", handleTodayTaskPick);
  $("#todayQuadrantPicker").addEventListener("change", renderTodayTaskPicker);
  $("#routineForm").addEventListener("submit", handleRoutineSubmit);
  $("#projectForm").addEventListener("submit", handleProjectSubmit);
  $("#taskDialogForm").addEventListener("submit", handleTaskDialogSubmit);
  $("#gasForm").addEventListener("submit", handleGasSettingsSubmit);
  $("#spreadsheetInput").addEventListener("change", handleSpreadsheetImport);
  $("#showDone").addEventListener("change", renderQuadrants);
  $("#projectFilter").addEventListener("change", renderGantt);

  $("#taskDialogForm").elements.progress.addEventListener("input", (event) => {
    $("#taskDialogForm").elements.progressOutput.value = `${event.target.value}%`;
  });
  $("#taskDialogForm").elements.quadrant.addEventListener("change", syncDialogBooleansFromQuadrant);
  $("#taskDialogForm").elements.important.addEventListener("change", syncDialogQuadrantFromBooleans);
  $("#taskDialogForm").elements.urgent.addEventListener("change", syncDialogQuadrantFromBooleans);

  ["mainGoal", "reviewDone", "reviewGap", "reviewNext"].forEach((id) => {
    $(`#${id}`).addEventListener("input", (event) => {
      const review = getReview(state.selectedDate);
      review[id] = event.target.value;
      scheduleSave();
    });
  });

  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("change", handleDocumentChange);
  document.addEventListener("dragstart", handleDragStart);
  document.addEventListener("dragend", handleDragEnd);
  document.addEventListener("dragover", handleDragOver);
  document.addEventListener("dragleave", handleDragLeave);
  document.addEventListener("drop", handleDrop);
}

function handleDocumentClick(event) {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;

  const action = actionButton.dataset.action;
  const id = actionButton.dataset.id;

  if (action === "today") {
    state.selectedDate = todayISO();
    saveAndRender();
  }

  if (action === "export") exportSpreadsheet();
  if (action === "import") $("#spreadsheetInput").click();
  if (action === "toggle-settings-panel") toggleSettingsPanel();
  if (action === "gas-settings") openGasDialog();
  if (action === "close-gas-dialog") closeGasDialog();
  if (action === "gas-save") gasSave();
  if (action === "gas-load") gasLoad();
  if (action === "gas-test") gasTest();

  if (action === "toggle-routine-form") {
    $("#routineForm").classList.toggle("is-collapsed");
    $("#routineForm input[name='title']").focus();
  }

  if (action === "new-task") openTaskDialog("", { projectId: currentProjectIdForNewTask() });
  if (action === "new-task-for-project") openTaskDialog("", { projectId: id });
  if (action === "edit-task") openTaskDialog(id);
  if (action === "remove-from-today") removeTaskFromToday(id);
  if (action === "close-dialog") closeTaskDialog();

  if (action === "delete-task") {
    const taskId = $("#taskDialogForm").elements.id.value;
    if (taskId && confirm("このタスクを削除しますか？")) {
      state.tasks = state.tasks.filter((task) => task.id !== taskId);
      closeTaskDialog();
      saveAndRender();
    }
  }

  if (action === "delete-routine") {
    if (confirm("この日課を削除しますか？")) {
      state.routines = state.routines.filter((routine) => routine.id !== id);
      Object.values(state.routineLog).forEach((dayLog) => delete dayLog[id]);
      saveAndRender();
    }
  }

  if (action === "new-project") {
    $("#projectForm").classList.toggle("is-collapsed");
    $("#projectForm input[name='name']").focus();
  }
}

function handleDocumentChange(event) {
  const routineToggle = event.target.closest("[data-routine-toggle]");
  if (routineToggle) {
    const dateLog = getRoutineLog(state.selectedDate);
    if (routineToggle.checked) {
      dateLog[routineToggle.dataset.routineToggle] = "完了";
    } else {
      delete dateLog[routineToggle.dataset.routineToggle];
    }
    saveAndRender();
  }

  const taskToggle = event.target.closest("[data-task-toggle]");
  if (taskToggle) {
    const task = findTask(taskToggle.dataset.taskToggle);
    if (!task) return;
    task.status = taskToggle.checked ? "完了" : "未着手";
    task.progress = taskToggle.checked ? 1 : Math.min(task.progress || 0, 0.95);
    task.completedAt = taskToggle.checked ? state.selectedDate : "";
    saveAndRender();
  }

  const progress = event.target.closest("[data-task-progress]");
  if (progress) {
    const task = findTask(progress.dataset.taskProgress);
    if (!task) return;
    task.progress = Number(progress.value) / 100;
    if (task.progress >= 1) {
      task.status = "完了";
      task.completedAt = state.selectedDate;
    } else if (task.status === "完了") {
      task.status = "進行中";
      task.completedAt = "";
    }
    saveAndRender();
  }
}

function handleDragStart(event) {
  const card = event.target.closest("[data-task-id]");
  if (!card) return;
  event.dataTransfer.setData("text/plain", card.dataset.taskId);
  event.dataTransfer.effectAllowed = "move";
  card.classList.add("dragging");
}

function handleDragEnd(event) {
  const card = event.target.closest("[data-task-id]");
  if (card) card.classList.remove("dragging");
  $$(".quadrant-column").forEach((column) => column.classList.remove("is-over"));
}

function handleDragOver(event) {
  const column = event.target.closest("[data-quadrant]");
  if (!column) return;
  event.preventDefault();
  column.classList.add("is-over");
}

function handleDragLeave(event) {
  const column = event.target.closest("[data-quadrant]");
  if (!column || column.contains(event.relatedTarget)) return;
  column.classList.remove("is-over");
}

function handleDrop(event) {
  const column = event.target.closest("[data-quadrant]");
  if (!column) return;
  event.preventDefault();
  const task = findTask(event.dataTransfer.getData("text/plain"));
  if (!task) return;
  const meta = quadrantMeta[column.dataset.quadrant];
  task.quadrant = column.dataset.quadrant;
  task.important = meta.important;
  task.urgent = meta.urgent;
  saveAndRender();
}

function handleQuickTask(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const important = Boolean(data.get("important"));
  const urgent = Boolean(data.get("urgent"));
  state.tasks.unshift({
    id: uid("task"),
    title: String(data.get("title")).trim(),
    projectId: String(data.get("projectId") || ""),
    quadrant: quadrantFromBooleans(important, urgent),
    important,
    urgent,
    status: "未着手",
    priority: String(data.get("priority") || "A"),
    startDate: state.selectedDate,
    dueDate: String(data.get("dueDate") || state.selectedDate),
    estimateMinutes: 30,
    progress: 0,
    notes: "",
    createdAt: todayISO(),
    completedAt: "",
    focusDates: [],
  });
  form.reset();
  form.elements.important.checked = true;
  form.elements.dueDate.value = state.selectedDate;
  saveAndRender();
}

function handleTodayTaskPick(event) {
  event.preventDefault();
  const taskId = event.currentTarget.elements.taskId.value;
  const task = findTask(taskId);
  if (!task) return;

  task.focusDates = uniqueDates([...(task.focusDates || []), state.selectedDate]);
  if (!task.startDate) task.startDate = state.selectedDate;
  if (!task.dueDate && task.priority === "A") task.dueDate = state.selectedDate;
  saveAndRender("今日へ追加済み");
}

function handleRoutineSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  state.routines.push({
    id: uid("routine"),
    title: String(data.get("title")).trim(),
    area: String(data.get("area") || ""),
    estimateMinutes: Number(data.get("minutes") || 0),
    createdAt: todayISO(),
  });
  form.reset();
  $("#routineForm").classList.add("is-collapsed");
  saveAndRender();
}

function handleProjectSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const name = String(data.get("name") || "").trim();
  if (!name) return;

  const project = {
    id: uid("project"),
    name,
    purpose: String(data.get("purpose") || ""),
    color: String(data.get("color") || "#2563eb"),
    startDate: String(data.get("startDate") || state.selectedDate),
    endDate: String(data.get("endDate") || addDays(state.selectedDate, 60)),
    status: "進行中",
    notes: "",
  };

  state.projects.push(project);
  preferredProjectId = project.id;
  form.reset();
  form.elements.color.value = "#2563eb";
  $("#projectForm").classList.add("is-collapsed");
  saveAndRender();
}

function handleTaskDialogSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const quadrant = String(data.get("quadrant") || quadrantFromBooleans(form.elements.important.checked, form.elements.urgent.checked));
  const quadrantInfo = quadrantMeta[quadrant] || quadrantMeta.q2;
  const important = quadrantInfo.important;
  const urgent = quadrantInfo.urgent;
  const existing = findTask(String(data.get("id") || ""));
  const next = {
    id: existing?.id || uid("task"),
    title: String(data.get("title")).trim(),
    projectId: String(data.get("projectId") || ""),
    quadrant,
    important,
    urgent,
    status: String(data.get("status") || "未着手"),
    priority: String(data.get("priority") || "B"),
    startDate: String(data.get("startDate") || state.selectedDate),
    dueDate: String(data.get("dueDate") || state.selectedDate),
    estimateMinutes: Number(data.get("estimateMinutes") || 0),
    progress: Number(data.get("progress") || 0) / 100,
    notes: String(data.get("notes") || ""),
    createdAt: existing?.createdAt || todayISO(),
    completedAt: "",
    focusDates: existing?.focusDates || [],
  };
  if (next.status === "完了" || next.progress >= 1) {
    next.status = "完了";
    next.progress = 1;
    next.completedAt = existing?.completedAt || state.selectedDate;
  }

  if (existing) {
    Object.assign(existing, next);
  } else {
    state.tasks.unshift(next);
  }

  closeTaskDialog();
  saveAndRender();
}

async function handleSpreadsheetImport(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  try {
    const imported = await readSpreadsheet(file);
    if (!imported.tasks.length && !imported.routines.length && !imported.projects.length) {
      throw new Error("読み込めるデータが見つかりませんでした。");
    }
    if (!confirm("現在のデータを読み込んだ表の内容に置き換えますか？")) return;
    state = imported;
    state.selectedDate = state.selectedDate || todayISO();
    saveAndRender("読込済み");
  } catch (error) {
    alert(error.message || "読み込みに失敗しました。");
  }
}

function handleGasSettingsSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const nextUrl = String(form.elements.url.value || "").trim();
  if (nextUrl && !isValidGasUrl(nextUrl)) {
    alert("GASのWebアプリURLを確認してください。");
    return;
  }

  gasConfig = {
    ...gasConfig,
    url: nextUrl,
    autoSync: form.elements.autoSync.checked,
  };
  saveGasConfig();
  closeGasDialog();
  $("#saveStatus").textContent = getGasConnectionMode() === "vercel" ? "Vercel GAS設定を使用" : gasConfig.url ? "GAS設定済み" : "GAS未設定";
}

function openGasDialog() {
  const form = $("#gasForm");
  form.elements.url.value = gasConfig.url || "";
  form.elements.autoSync.checked = Boolean(gasConfig.autoSync);

  const dialog = $("#gasDialog");
  if (dialog.showModal) dialog.showModal();
  else dialog.setAttribute("open", "");
  form.elements.url.focus();
  refreshIcons();
}

function closeGasDialog() {
  const dialog = $("#gasDialog");
  if (dialog.close) dialog.close();
  else dialog.removeAttribute("open");
}

async function gasSave({ silent = false } = {}) {
  if (!ensureGasReady()) return;
  if (!silent) $("#saveStatus").textContent = "GAS保存中";

  const payload = {
    action: "save",
    app: "ux-todo-list-tool",
    version: 1,
    savedAt: new Date().toISOString(),
    state,
    sheets: buildSheetData(),
  };

  try {
    if (getGasConnectionMode() === "vercel") {
      await gasProxyRequest("save", { method: "POST", payload });
    } else {
      if (!silent) await gasJsonp("ping", {}, 12000);
      await fetch(gasConfig.url, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
    }
    gasConfig.lastSyncAt = new Date().toISOString();
    saveGasConfig();
    $("#saveStatus").textContent = silent ? "自動GAS保存済み" : "GASへ送信済み";
  } catch (error) {
    $("#saveStatus").textContent = "GAS保存失敗";
    if (!silent) alert(error.message || "GASへの保存に失敗しました。");
  }
}

async function gasLoad() {
  if (!ensureGasReady()) return;
  $("#saveStatus").textContent = "GAS読込中";

  try {
    const result = getGasConnectionMode() === "vercel" ? await gasProxyRequest("load") : await gasJsonp("load");
    if (!result?.ok) throw new Error(result?.error || "GASからデータを読み込めませんでした。");
    const loaded = normalizeGasState(result);
    if (!loaded.tasks.length && !loaded.routines.length && !loaded.projects.length) {
      throw new Error("GAS側に読み込めるデータがありません。");
    }
    if (!confirm("現在の画面のデータを、GASのスプレッドシートの内容に置き換えますか？")) {
      $("#saveStatus").textContent = "読込キャンセル";
      return;
    }
    state = loaded;
    saveAndRender("GAS読込済み");
  } catch (error) {
    $("#saveStatus").textContent = "GAS読込失敗";
    alert(error.message || "GASからの読み込みに失敗しました。");
  }
}

async function gasTest() {
  if (!ensureGasReady({ openSettings: false })) return;
  $("#saveStatus").textContent = "GAS確認中";

  try {
    const result = getGasConnectionMode() === "vercel" ? await gasProxyRequest("ping", { timeoutMs: 12000 }) : await gasJsonp("ping", {}, 12000);
    if (!result?.ok) throw new Error(result?.error || "接続確認に失敗しました。");
    $("#saveStatus").textContent = "GAS接続OK";
    alert(`GASに接続できました。\n保存先: ${result.spreadsheetName || "スプレッドシート"}`);
  } catch (error) {
    $("#saveStatus").textContent = "GAS接続失敗";
    alert(error.message || "GASに接続できませんでした。");
  }
}

function scheduleGasAutoSave() {
  if (!gasConfig.autoSync || !getGasConnectionMode()) return;
  clearTimeout(gasSaveTimer);
  gasSaveTimer = setTimeout(() => gasSave({ silent: true }), 1800);
}

function ensureGasReady({ openSettings = true } = {}) {
  if (getGasConnectionMode()) return true;
  $("#saveStatus").textContent = "GAS未設定";
  if (openSettings) openGasDialog();
  else alert("Vercelの環境変数、またはGASのWebアプリURLを設定してください。");
  return false;
}

function getGasConnectionMode() {
  if (gasConfig.url && isValidGasUrl(gasConfig.url)) return "direct";
  if (gasProxyAvailable || isVercelHost()) return "vercel";
  return "";
}

function canUseVercelGasProxy() {
  if (!window.location || !window.location.origin.startsWith("http")) return false;
  const hostname = window.location.hostname;
  return !["", "localhost", "127.0.0.1", "0.0.0.0"].includes(hostname);
}

function isVercelHost() {
  const hostname = window.location?.hostname || "";
  return hostname.endsWith(".vercel.app") || hostname.endsWith(".vercel.sh");
}

async function detectVercelGasProxyConfig() {
  if (!canUseVercelGasProxy() || gasConfig.url) return;

  try {
    const result = await gasProxyRequest("config", { timeoutMs: 4000 });
    if (!result.configured) return;
    gasProxyAvailable = true;
    if (hasStoredGasConfig) return;
    gasConfig.autoSync = true;
    saveGasConfig();
    $("#saveStatus").textContent = "Vercel GAS設定を使用";
  } catch {
    // APIがない公開先では、従来通り手動URL設定を使います。
  }
}

async function gasProxyRequest(action, { method = "GET", payload = null, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = new URL(VERCEL_GAS_ENDPOINT, window.location.origin);
  url.searchParams.set("action", action);

  try {
    const response = await fetch(url.toString(), {
      method,
      headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify(payload) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    const result = text ? JSON.parse(text) : {};
    if (!response.ok || !result.ok) {
      throw new Error(result.error || `Vercel APIでGAS連携に失敗しました。(${response.status})`);
    }
    return result;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Vercel APIからの応答がありませんでした。GAS設定を確認してください。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function gasJsonp(action, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const callbackName = `gasCallback_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("GASからの応答がありませんでした。WebアプリURLと公開設定を確認してください。"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      script.remove();
      delete window[callbackName];
    }

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    const url = new URL(gasConfig.url);
    url.searchParams.set("action", action);
    url.searchParams.set("callback", callbackName);
    url.searchParams.set("_", String(Date.now()));
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

    script.onerror = () => {
      cleanup();
      reject(new Error("GASのURLを読み込めませんでした。"));
    };
    script.src = url.toString();
    document.body.append(script);
  });
}

function normalizeGasState(result) {
  if (result.state) return normalizeState(result.state);
  if (result.sheets) return stateFromWorkbookRows(result.sheets);
  return normalizeState({});
}

function loadGasConfig() {
  try {
    const raw = localStorage.getItem(GAS_CONFIG_KEY);
    if (raw) {
      hasStoredGasConfig = true;
      const parsed = JSON.parse(raw);
      return {
        url: String(parsed.url || ""),
        autoSync: Boolean(parsed.autoSync),
        lastSyncAt: String(parsed.lastSyncAt || ""),
      };
    }
  } catch {
    localStorage.removeItem(GAS_CONFIG_KEY);
  }
  return { url: "", autoSync: false, lastSyncAt: "" };
}

function saveGasConfig() {
  localStorage.setItem(GAS_CONFIG_KEY, JSON.stringify(gasConfig));
}

function loadUiConfig() {
  try {
    const raw = localStorage.getItem(UI_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { settingsOpen: Boolean(parsed.settingsOpen) };
    }
  } catch {
    localStorage.removeItem(UI_CONFIG_KEY);
  }
  return { settingsOpen: false };
}

function saveUiConfig() {
  localStorage.setItem(UI_CONFIG_KEY, JSON.stringify(uiConfig));
}

function isValidGasUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /script\.google\.com$/.test(url.hostname) && url.pathname.includes("/macros/");
  } catch {
    return false;
  }
}

function render() {
  renderShell();
  renderProjectOptions();
  renderDaily();
  renderMetrics();
  renderRoutines();
  renderTodayTaskPicker();
  renderFocusTasks();
  renderQuadrants();
  renderGantt();
  refreshIcons();
}

function renderShell() {
  $("#selectedDate").value = state.selectedDate;
  $$("[data-view-button]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewButton === activeView);
  });
  $$(".view").forEach((view) => view.classList.remove("is-active"));
  $(`#${activeView}View`).classList.add("is-active");
  renderSettingsPanel();
}

function renderSettingsPanel() {
  const panel = $("#settingsActions");
  const toggle = $("#settingsToggle");
  if (!panel || !toggle) return;

  panel.classList.toggle("is-collapsed", !uiConfig.settingsOpen);
  toggle.setAttribute("aria-expanded", String(uiConfig.settingsOpen));
  toggle.classList.toggle("is-active", uiConfig.settingsOpen);
  toggle.title = uiConfig.settingsOpen ? "連携と保存の操作を隠す" : "連携と保存の操作を表示";
}

function toggleSettingsPanel() {
  uiConfig.settingsOpen = !uiConfig.settingsOpen;
  saveUiConfig();
  renderSettingsPanel();
}

function renderProjectOptions() {
  const quickProject = $("#quickTaskForm").elements.projectId;
  const dialogProject = $("#taskDialogForm").elements.projectId;
  const filter = $("#projectFilter");
  const previousQuick = quickProject.value;
  const previousDialog = dialogProject.value;
  const previousFilter = filter.value || "all";
  const validProjectIds = new Set(state.projects.map((project) => project.id));
  const projectOptions = state.projects
    .map((project) => `<option value="${escapeAttr(project.id)}">${escapeHtml(project.name)}</option>`)
    .join("");

  quickProject.innerHTML = `<option value="">目的なし</option>${projectOptions}`;
  dialogProject.innerHTML = `<option value="">目的なし</option>${projectOptions}`;
  filter.innerHTML = `<option value="all">すべて</option>${projectOptions}`;

  const quickTarget = preferredProjectId || previousQuick || state.projects[0]?.id || "";
  const filterTarget = preferredProjectId || previousFilter;
  quickProject.value = validProjectIds.has(quickTarget) ? quickTarget : "";
  dialogProject.value = validProjectIds.has(previousDialog) ? previousDialog : "";
  filter.value = filterTarget === "all" || validProjectIds.has(filterTarget) ? filterTarget : "all";
  preferredProjectId = "";
  $("#quickTaskForm").elements.dueDate.value ||= state.selectedDate;
}

function renderDaily() {
  const review = getReview(state.selectedDate);
  setValueIfNotFocused("#mainGoal", review.mainGoal || "");
  setValueIfNotFocused("#reviewDone", review.reviewDone || "");
  setValueIfNotFocused("#reviewGap", review.reviewGap || "");
  setValueIfNotFocused("#reviewNext", review.reviewNext || "");
}

function renderMetrics() {
  const openTasks = state.tasks.filter((task) => task.status !== "完了");
  const dueTasks = openTasks.filter((task) => task.dueDate && task.dueDate <= state.selectedDate);
  const q2Tasks = openTasks.filter((task) => task.quadrant === "q2");
  const routineDone = state.routines.filter((routine) => isRoutineDone(routine.id, state.selectedDate)).length;
  const routinePct = state.routines.length ? Math.round((routineDone / state.routines.length) * 100) : 0;
  const focusTasks = getFocusTasks();
  const focusDone = focusTasks.filter((task) => task.status === "完了").length;

  $("#metricOpen").textContent = String(openTasks.length);
  $("#metricDue").textContent = String(dueTasks.length);
  $("#metricQ2").textContent = String(q2Tasks.length);
  $("#metricRoutine").textContent = `${routinePct}%`;
  $("#todaySummary").textContent = `${focusDone} / ${focusTasks.length}`;
}

function renderRoutines() {
  const root = $("#routineList");
  if (!state.routines.length) {
    root.innerHTML = `<div class="empty">日課はまだありません</div>`;
    return;
  }

  root.innerHTML = state.routines
    .map((routine) => {
      const done = isRoutineDone(routine.id, state.selectedDate);
      const streak = computeStreak(routine.id, state.selectedDate);
      return `
        <article class="routine-item">
          <input type="checkbox" data-routine-toggle="${escapeAttr(routine.id)}" ${done ? "checked" : ""} aria-label="${escapeAttr(routine.title)}" />
          <div>
            <div class="routine-title">${escapeHtml(routine.title)}</div>
            <div class="routine-meta">
              ${routine.area ? `<span>${escapeHtml(routine.area)}</span>` : ""}
              ${routine.estimateMinutes ? `<span>${routine.estimateMinutes}分</span>` : ""}
              <span>${streak}日連続</span>
            </div>
          </div>
          <div class="routine-actions">
            <button type="button" data-action="delete-routine" data-id="${escapeAttr(routine.id)}" title="削除">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTodayTaskPicker() {
  {
    const picker = $("#todayTaskPicker");
    const quadrantPicker = $("#todayQuadrantPicker");
    if (!picker || !quadrantPicker) return;

    const quadrants = [
      { id: "q1", label: "第1象限 緊急・重要" },
      { id: "q2", label: "第2象限 重要・緊急ではない" },
      { id: "q3", label: "第3象限 緊急・重要ではない" },
      { id: "q4", label: "第4象限 緊急でも重要でもない" },
    ];
    const allCandidates = state.tasks
      .filter((task) => task.status !== "完了" && isQuadrantTask(task) && !isFocusTask(task, state.selectedDate))
      .sort(sortTasks);
    const counts = allCandidates.reduce((map, task) => {
      map[task.quadrant] = (map[task.quadrant] || 0) + 1;
      return map;
    }, {});
    const currentQuadrant = quadrants.some((item) => item.id === quadrantPicker.value)
      ? quadrantPicker.value
      : allCandidates[0]?.quadrant || "q2";

    quadrantPicker.innerHTML = quadrants
      .map((item) => `<option value="${item.id}" ${item.id === currentQuadrant ? "selected" : ""}>${item.label}（${counts[item.id] || 0}）</option>`)
      .join("");

    const candidates = allCandidates.filter((task) => task.quadrant === currentQuadrant);
    picker.innerHTML = candidates.length
      ? `<option value="">この象限のTo doから選ぶ</option>${candidates
          .map((task) => {
            const project = state.projects.find((item) => item.id === task.projectId);
            const label = `${project ? `${project.name} / ` : ""}${task.title}`;
            return `<option value="${escapeAttr(task.id)}">${escapeHtml(label)}</option>`;
          })
          .join("")}`
      : `<option value="">この象限で今日へ追加できるTo doはありません</option>`;

    picker.disabled = !candidates.length;
    $("#todayTaskPickerForm button[type='submit']").disabled = !candidates.length;
    return;
  }
}

function renderFocusTasks() {
  const root = $("#focusTaskList");
  const tasks = getFocusTasks();
  root.innerHTML = tasks.length
    ? tasks.map((task) => renderTaskCard(task, true)).join("")
    : `<div class="empty">今日扱うタスクはありません</div>`;
}

function renderQuadrants() {
  const root = $("#quadrantBoard");
  const showDone = $("#showDone").checked;
  root.innerHTML = Object.entries(quadrantMeta)
    .map(([key, meta]) => {
      const tasks = state.tasks
        .filter((task) => task.quadrant === key && (showDone || task.status !== "完了"))
        .sort(sortTasks);
      return `
        <section class="quadrant-column quadrant-${key}" data-quadrant="${key}">
          <div class="quadrant-head">
            <div>
              <h3>${meta.label} ${meta.text}</h3>
              <p>${meta.hint}</p>
            </div>
            <span class="pill">${tasks.length}</span>
          </div>
          <div class="task-stack">
            ${tasks.length ? tasks.map((task) => renderTaskCard(task)).join("") : `<div class="empty">空です</div>`}
          </div>
        </section>
      `;
    })
    .join("");
  refreshIcons();
}

function renderGantt() {
  const root = $("#ganttChart");
  const filter = $("#projectFilter").value || "all";
  const projectsToShow = filter === "all"
    ? state.projects
    : state.projects.filter((project) => project.id === filter);
  const visibleTasks = state.tasks.filter((task) => {
    const hasDate = task.startDate || task.dueDate;
    return hasDate && (filter === "all" || task.projectId === filter);
  });

  if (!projectsToShow.length && !visibleTasks.length) {
    root.innerHTML = `<div class="empty">目的を追加すると、ここに時系列で表示されます</div>`;
    return;
  }

  const rangeSource = visibleTasks.length
    ? visibleTasks
    : projectsToShow.map((project) => ({
        startDate: project.startDate || state.selectedDate,
        dueDate: project.endDate || project.startDate || addDays(state.selectedDate, 28),
      }));
  const range = buildGanttRange(rangeSource);
  const weeks = buildWeeks(range.start, range.end);
  const weekTemplate = `repeat(${weeks.length}, minmax(74px, 1fr))`;
  const totalDays = Math.max(1, daysBetween(range.start, addDays(weeks.at(-1), 7)));
  const grouped = groupTasksByProject(visibleTasks, projectsToShow, filter);

  const header = `
    <div class="gantt-header">
      <div class="gantt-left-head">目的 / タスク</div>
      <div class="gantt-scale" style="grid-template-columns:${weekTemplate}">
        ${weeks.map((week) => `<span>${formatMonthDay(week)}</span>`).join("")}
      </div>
    </div>
  `;

  const rows = grouped
    .map(({ project, tasks }) => {
      const projectName = project?.name || "目的なし";
      const projectColor = project?.color || "#2563eb";
      const projectId = project?.id || "";
      return `
        <div class="gantt-project-row">
          <div class="gantt-project-name" style="border-left: 6px solid ${escapeAttr(projectColor)}">
            <div class="gantt-project-main">
              <div>
                ${escapeHtml(projectName)}
                ${project?.purpose ? `<div class="gantt-project-purpose">${escapeHtml(project.purpose)}</div>` : ""}
              </div>
              ${project ? `
                <button class="mini-btn" type="button" data-action="new-task-for-project" data-id="${escapeAttr(projectId)}">
                  <i data-lucide="plus"></i>
                  <span>タスク</span>
                </button>
              ` : ""}
            </div>
          </div>
          <div></div>
        </div>
        ${tasks.length
          ? tasks
          .sort(sortTasks)
          .map((task) => {
            const start = parseDate(task.startDate || task.dueDate || state.selectedDate);
            const due = parseDate(task.dueDate || task.startDate || state.selectedDate);
            const safeEnd = due < start ? start : due;
            const left = Math.max(0, (daysBetween(range.start, start) / totalDays) * 100);
            const width = Math.max(2.5, ((daysBetween(start, addDays(safeEnd, 1)) || 1) / totalDays) * 100);
            return `
              <div class="gantt-row">
                <div class="gantt-left">
                  <div class="gantt-task-title">${escapeHtml(task.title)}</div>
                  <div class="gantt-task-meta">
                    <span>${escapeHtml(task.priority || "B")}</span>
                    <span>${escapeHtml(task.status || "未着手")}</span>
                    <span>${formatMonthDay(task.dueDate)}</span>
                  </div>
                </div>
                <div class="gantt-lane" style="background-size: calc(100% / ${weeks.length}) 100%;">
                  <div class="gantt-bar" title="${escapeAttr(task.title)}" style="left:${left}%; width:${Math.min(width, 100 - left)}%; background:${escapeAttr(projectColor)}22; border-color:${escapeAttr(projectColor)}66">
                    <span style="width:${progressPct(task)}%; background:${escapeAttr(projectColor)}"></span>
                  </div>
                </div>
              </div>
            `;
          })
          .join("")
          : `
            <div class="gantt-row gantt-empty-row">
              <div class="gantt-left">
                <div class="gantt-task-title">まだタスクがありません</div>
                <div class="gantt-task-meta">
                  <span>この目的に紐づくタスクを作ると、今日のタスクと四象限にも出ます</span>
                </div>
              </div>
              <div class="gantt-empty-lane">
                ${project ? `
                  <button class="ghost-btn compact" type="button" data-action="new-task-for-project" data-id="${escapeAttr(projectId)}">
                    <i data-lucide="plus"></i>
                    <span>タスクを追加</span>
                  </button>
                ` : ""}
              </div>
            </div>
          `}
      `;
    })
    .join("");

  root.innerHTML = `<div class="gantt-grid">${header}${rows}</div>`;
}

function renderTaskCard(task, isFocusContext = false) {
  const project = state.projects.find((item) => item.id === task.projectId);
  const done = task.status === "完了";
  const dueText = task.dueDate ? formatMonthDay(task.dueDate) : "期限なし";
  const canRemoveFromToday = isFocusContext && Array.isArray(task.focusDates) && task.focusDates.includes(state.selectedDate);
  return `
    <article class="task-card ${done ? "is-done" : ""}" draggable="true" data-task-id="${escapeAttr(task.id)}">
      <div class="task-top">
        <input class="task-check" type="checkbox" data-task-toggle="${escapeAttr(task.id)}" ${done ? "checked" : ""} aria-label="完了" />
        <div>
          <div class="task-title">${escapeHtml(task.title)}</div>
          <div class="task-meta">
            <span class="badge priority-${escapeAttr((task.priority || "B").toLowerCase())}">${escapeHtml(task.priority || "B")}</span>
            <span class="badge status">${escapeHtml(task.status || "未着手")}</span>
            ${project ? `<span class="badge project" style="border-left-color:${escapeAttr(project.color)}">${escapeHtml(project.name)}</span>` : ""}
            <span>${dueText}</span>
            ${task.estimateMinutes ? `<span>${task.estimateMinutes}分</span>` : ""}
          </div>
        </div>
        <div class="task-actions">
          ${canRemoveFromToday ? `
            <button type="button" data-action="remove-from-today" data-id="${escapeAttr(task.id)}" title="今日から外す">
              <i data-lucide="calendar-x"></i>
            </button>
          ` : ""}
          <button type="button" data-action="edit-task" data-id="${escapeAttr(task.id)}" title="編集">
            <i data-lucide="pencil"></i>
          </button>
        </div>
      </div>
      <div class="progress-line" aria-label="進捗 ${progressPct(task)}%">
        <span style="width:${progressPct(task)}%"></span>
      </div>
    </article>
  `;
}

function removeTaskFromToday(taskId) {
  const task = findTask(taskId);
  if (!task || !Array.isArray(task.focusDates)) return;
  task.focusDates = task.focusDates.filter((date) => date !== state.selectedDate);
  saveAndRender("今日から外しました");
}

function openTaskDialog(taskId = "", defaults = {}) {
  const form = $("#taskDialogForm");
  const task = findTask(taskId) || {
    id: "",
    title: "",
    projectId: defaults.projectId || state.projects[0]?.id || "",
    quadrant: defaults.quadrant || "q2",
    important: quadrantMeta[defaults.quadrant || "q2"].important,
    urgent: quadrantMeta[defaults.quadrant || "q2"].urgent,
    status: "未着手",
    priority: "A",
    startDate: state.selectedDate,
    dueDate: state.selectedDate,
    estimateMinutes: 30,
    progress: 0,
    notes: "",
  };

  $("#dialogTitle").textContent = task.id ? "タスク編集" : "タスク追加";
  const quadrant = task.quadrant || quadrantFromBooleans(task.important, task.urgent);
  form.elements.id.value = task.id;
  form.elements.title.value = task.title;
  form.elements.projectId.value = task.projectId || "";
  form.elements.quadrant.value = quadrant;
  form.elements.priority.value = task.priority || "B";
  form.elements.status.value = task.status || "未着手";
  form.elements.estimateMinutes.value = task.estimateMinutes || "";
  form.elements.startDate.value = task.startDate || state.selectedDate;
  form.elements.dueDate.value = task.dueDate || state.selectedDate;
  form.elements.important.checked = quadrantMeta[quadrant]?.important ?? Boolean(task.important);
  form.elements.urgent.checked = quadrantMeta[quadrant]?.urgent ?? Boolean(task.urgent);
  form.elements.progress.value = progressPct(task);
  form.elements.progressOutput.value = `${progressPct(task)}%`;
  form.elements.notes.value = task.notes || "";
  $("[data-action='delete-task']", form).style.visibility = task.id ? "visible" : "hidden";

  const dialog = $("#taskDialog");
  if (dialog.showModal) dialog.showModal();
  else dialog.setAttribute("open", "");
  form.elements.title.focus();
  refreshIcons();
}

function closeTaskDialog() {
  const dialog = $("#taskDialog");
  if (dialog.close) dialog.close();
  else dialog.removeAttribute("open");
}

function syncDialogBooleansFromQuadrant() {
  const form = $("#taskDialogForm");
  const quadrant = form.elements.quadrant.value || "q2";
  const meta = quadrantMeta[quadrant] || quadrantMeta.q2;
  form.elements.important.checked = meta.important;
  form.elements.urgent.checked = meta.urgent;
}

function syncDialogQuadrantFromBooleans() {
  const form = $("#taskDialogForm");
  form.elements.quadrant.value = quadrantFromBooleans(form.elements.important.checked, form.elements.urgent.checked);
}

function getFocusTasks() {
  return state.tasks
    .filter((task) => isFocusTask(task, state.selectedDate))
    .sort(sortTasks);
}

function isFocusTask(task, date) {
  if (task.status === "完了") return false;
  const pickedForToday = Array.isArray(task.focusDates) && task.focusDates.includes(date);
  return isQuadrantTask(task) && pickedForToday;
}

function isQuadrantTask(task) {
  return Object.prototype.hasOwnProperty.call(quadrantMeta, task.quadrant);
}

function sortTasks(a, b) {
  const priority = { A: 0, B: 1, C: 2 };
  return (
    (priority[a.priority] ?? 3) - (priority[b.priority] ?? 3) ||
    String(a.dueDate || "9999-12-31").localeCompare(String(b.dueDate || "9999-12-31")) ||
    String(a.title).localeCompare(String(b.title), "ja")
  );
}

function groupTasksByProject(tasks, projectsToShow = state.projects, filter = "all") {
  const byProject = new Map();
  projectsToShow.forEach((project) => byProject.set(project.id, []));
  tasks.forEach((task) => {
    const key = task.projectId || "";
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(task);
  });
  return Array.from(byProject.entries())
    .filter(([projectId, items]) => filter === "all" || projectId === filter || items.length)
    .map(([projectId, items]) => ({
      project: state.projects.find((project) => project.id === projectId),
      tasks: items,
    }));
}

function currentProjectIdForNewTask() {
  const filter = $("#projectFilter")?.value;
  if (activeView === "gantt" && filter && filter !== "all") return filter;
  return $("#quickTaskForm")?.elements.projectId.value || state.projects[0]?.id || "";
}

function getReview(date) {
  state.dailyReviews[date] ||= {
    mainGoal: "",
    reviewDone: "",
    reviewGap: "",
    reviewNext: "",
  };
  return state.dailyReviews[date];
}

function getRoutineLog(date) {
  state.routineLog[date] ||= {};
  return state.routineLog[date];
}

function isRoutineDone(routineId, date) {
  return state.routineLog[date]?.[routineId] === "完了";
}

function computeStreak(routineId, fromDate) {
  let cursor = fromDate;
  let count = 0;
  while (isRoutineDone(routineId, cursor)) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

function findTask(id) {
  return state.tasks.find((task) => task.id === id);
}

function quadrantFromBooleans(important, urgent) {
  if (important && urgent) return "q1";
  if (important && !urgent) return "q2";
  if (!important && urgent) return "q3";
  return "q4";
}

function quadrantLabel(key) {
  const meta = quadrantMeta[key] || quadrantMeta.q2;
  return `${meta.label} ${meta.text}`;
}

function quadrantFromLabel(label, important, urgent) {
  const value = String(label || "");
  if (value.includes("第1")) return "q1";
  if (value.includes("第2")) return "q2";
  if (value.includes("第3")) return "q3";
  if (value.includes("第4")) return "q4";
  return quadrantFromBooleans(important, urgent);
}

function progressPct(task) {
  return Math.max(0, Math.min(100, Math.round(Number(task.progress || 0) * 100)));
}

function saveAndRender(status = "保存済み") {
  saveState(status);
  render();
}

function scheduleSave() {
  $("#saveStatus").textContent = "保存中";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState("保存済み"), 280);
}

function saveState(status = "保存済み") {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  $("#saveStatus").textContent = status;
  scheduleGasAutoSave();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeState(JSON.parse(raw));
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return defaultState();
}

function defaultState() {
  const today = todayISO();
  const projects = [
    {
      id: "proj-life",
      name: "自己実現基盤",
      purpose: "理想の1日を安定して回す",
      color: "#0f766e",
      startDate: addDays(today, -6),
      endDate: addDays(today, 84),
      status: "進行中",
      notes: "",
    },
    {
      id: "proj-business",
      name: "事業づくり",
      purpose: "価値提供の仕組みを形にする",
      color: "#2563eb",
      startDate: today,
      endDate: addDays(today, 146),
      status: "進行中",
      notes: "",
    },
    {
      id: "proj-health",
      name: "健康・体力",
      purpose: "集中できる身体を整える",
      color: "#16a34a",
      startDate: addDays(today, -6),
      endDate: addDays(today, 56),
      status: "進行中",
      notes: "",
    },
  ];

  return {
    selectedDate: today,
    projects,
    tasks: [
      makeTask("今日の最重要目標を決める", "proj-life", true, false, "A", today, today, 20, 0.35, "朝に今日の勝ち筋を1つ決める"),
      makeTask("見込み客リストを整える", "proj-business", true, true, "A", today, addDays(today, 1), 90, 0.1, "候補を30件に絞る"),
      makeTask("週次レビューの時間を確保する", "proj-life", true, false, "A", addDays(today, 2), addDays(today, 5), 45, 0, "日曜夜に固定"),
      makeTask("不要な通知を整理する", "proj-life", false, true, "B", today, addDays(today, 3), 30, 0, "集中を乱す通知だけ止める"),
      makeTask("SNS閲覧の制限ルールを決める", "proj-life", false, false, "C", today, addDays(today, 7), 15, 0, "やめる/短時間で終える候補"),
      makeTask("健康習慣メニューを作る", "proj-health", true, false, "A", addDays(today, 1), addDays(today, 11), 60, 0.25, "運動・睡眠・食事の最小セット"),
      makeTask("商品アイデアを1枚にまとめる", "proj-business", true, false, "A", addDays(today, 7), addDays(today, 17), 120, 0, "誰のどんな進歩に効くかを書く"),
      makeTask("初回ヒアリングの質問を作る", "proj-business", true, true, "A", addDays(today, 1), addDays(today, 8), 75, 0, "目的・現状・制約・理想状態"),
    ],
    routines: [
      makeRoutine("起床後の水分補給", "健康・体力", 3),
      makeRoutine("朝の自己宣言を読む", "自己実現基盤", 5),
      makeRoutine("30分運動", "健康・体力", 30),
      makeRoutine("15分振り返り", "自己実現基盤", 15),
      makeRoutine("就寝前スマホオフ", "健康・体力", 10),
    ],
    routineLog: {},
    dailyReviews: {
      [today]: {
        mainGoal: "",
        reviewDone: "",
        reviewGap: "",
        reviewNext: "",
      },
    },
  };
}

function makeTask(title, projectId, important, urgent, priority, startDate, dueDate, estimateMinutes, progress, notes) {
  return {
    id: uid("task"),
    title,
    projectId,
    quadrant: quadrantFromBooleans(important, urgent),
    important,
    urgent,
    status: progress > 0 ? "進行中" : "未着手",
    priority,
    startDate,
    dueDate,
    estimateMinutes,
    progress,
    notes,
    createdAt: todayISO(),
    completedAt: "",
    focusDates: [],
  };
}

function makeRoutine(title, area, estimateMinutes) {
  return {
    id: uid("routine"),
    title,
    area,
    estimateMinutes,
    createdAt: todayISO(),
  };
}

function normalizeState(input) {
  const fallback = defaultState();
  return {
    selectedDate: normalizeDate(input.selectedDate) || todayISO(),
    projects: Array.isArray(input.projects) ? input.projects.map(normalizeProject).filter(Boolean) : fallback.projects,
    tasks: Array.isArray(input.tasks) ? input.tasks.map(normalizeTask).filter(Boolean) : fallback.tasks,
    routines: Array.isArray(input.routines) ? input.routines.map(normalizeRoutine).filter(Boolean) : fallback.routines,
    routineLog: input.routineLog && typeof input.routineLog === "object" ? input.routineLog : {},
    dailyReviews: input.dailyReviews && typeof input.dailyReviews === "object" ? input.dailyReviews : {},
  };
}

function normalizeProject(project) {
  if (!project?.name) return null;
  return {
    id: String(project.id || uid("project")),
    name: String(project.name),
    purpose: String(project.purpose || ""),
    color: String(project.color || "#2563eb"),
    startDate: normalizeDate(project.startDate) || "",
    endDate: normalizeDate(project.endDate) || "",
    status: String(project.status || "進行中"),
    notes: String(project.notes || ""),
  };
}

function normalizeTask(task) {
  if (!task?.title) return null;
  const important = parseBoolean(task.important);
  const urgent = parseBoolean(task.urgent);
  const quadrant = task.quadrant || quadrantFromBooleans(important, urgent);
  return {
    id: String(task.id || uid("task")),
    title: String(task.title),
    projectId: String(task.projectId || ""),
    quadrant,
    important: quadrantMeta[quadrant]?.important ?? important,
    urgent: quadrantMeta[quadrant]?.urgent ?? urgent,
    status: String(task.status || "未着手"),
    priority: String(task.priority || "B"),
    startDate: normalizeDate(task.startDate) || "",
    dueDate: normalizeDate(task.dueDate) || "",
    estimateMinutes: Number(task.estimateMinutes || 0),
    progress: parseProgress(task.progress),
    notes: String(task.notes || ""),
    createdAt: normalizeDate(task.createdAt) || todayISO(),
    completedAt: normalizeDate(task.completedAt) || "",
    focusDates: normalizeDateList(task.focusDates),
  };
}

function normalizeRoutine(routine) {
  if (!routine?.title) return null;
  return {
    id: String(routine.id || uid("routine")),
    title: String(routine.title),
    area: String(routine.area || ""),
    estimateMinutes: Number(routine.estimateMinutes || 0),
    createdAt: normalizeDate(routine.createdAt) || todayISO(),
  };
}

function exportSpreadsheet() {
  const sheets = buildSheetData();
  const fileBase = `todo-list-${state.selectedDate}`;
  if (window.XLSX) {
    const workbook = XLSX.utils.book_new();
    Object.entries(sheets).forEach(([name, rows]) => {
      const sheet = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    });
    XLSX.writeFile(workbook, `${fileBase}.xlsx`, { compression: true });
  } else {
    downloadExcelXml(sheets, `${fileBase}.xls`);
  }
  $("#saveStatus").textContent = "表に保存済み";
}

function buildSheetData() {
  return {
    Tasks: [
      ["Task ID", "タスク", "Project ID", "目的 / プロジェクト", "四象限", "重要", "緊急", "ステータス", "優先度", "開始日", "期限", "見積分", "進捗", "今日扱う日", "メモ", "作成日", "完了日"],
      ...state.tasks.map((task) => {
        const project = state.projects.find((item) => item.id === task.projectId);
        return [
          task.id,
          task.title,
          task.projectId,
          project?.name || "",
          quadrantLabel(task.quadrant),
          task.important,
          task.urgent,
          task.status,
          task.priority,
          task.startDate,
          task.dueDate,
          task.estimateMinutes,
          task.progress,
          (task.focusDates || []).join(";"),
          task.notes,
          task.createdAt,
          task.completedAt,
        ];
      }),
    ],
    Routines: [
      ["Routine ID", "日課", "領域", "見積分", "作成日"],
      ...state.routines.map((routine) => [routine.id, routine.title, routine.area, routine.estimateMinutes, routine.createdAt]),
    ],
    RoutineLog: [
      ["日付", "Routine ID", "ステータス"],
      ...Object.entries(state.routineLog).flatMap(([date, log]) =>
        Object.entries(log).map(([routineId, status]) => [date, routineId, status]),
      ),
    ],
    Projects: [
      ["Project ID", "目的 / プロジェクト", "目的", "色", "開始日", "終了日", "ステータス", "メモ"],
      ...state.projects.map((project) => [
        project.id,
        project.name,
        project.purpose,
        project.color,
        project.startDate,
        project.endDate,
        project.status,
        project.notes,
      ]),
    ],
    DailyReview: [
      ["日付", "今日の最重要目標", "できたこと", "計画との差", "明日への改善"],
      ...Object.entries(state.dailyReviews).map(([date, review]) => [
        date,
        review.mainGoal || "",
        review.reviewDone || "",
        review.reviewGap || "",
        review.reviewNext || "",
      ]),
    ],
  };
}

async function readSpreadsheet(file) {
  if (file.name.toLowerCase().endsWith(".json")) {
    return normalizeState(JSON.parse(await file.text()));
  }

  let workbookRows;
  if (window.XLSX && !file.name.toLowerCase().endsWith(".xml")) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    workbookRows = Object.fromEntries(
      workbook.SheetNames.map((name) => [name, XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "" })]),
    );
  } else {
    workbookRows = parseExcelXml(await file.text());
  }
  return stateFromWorkbookRows(workbookRows);
}

function stateFromWorkbookRows(workbookRows) {
  const projectRows = rowsByName(workbookRows, ["Projects", "プロジェクト"]);
  const taskRows = rowsByName(workbookRows, ["Tasks", "タスク"]);
  const routineRows = rowsByName(workbookRows, ["Routines", "日課"]);
  const routineLogRows = rowsByName(workbookRows, ["RoutineLog", "日課ログ"]);
  const reviewRows = rowsByName(workbookRows, ["DailyReview", "日次レビュー"]);

  const projects = objectsFromRows(projectRows)
    .map((row) =>
      normalizeProject({
        id: row["Project ID"],
        name: row["目的 / プロジェクト"],
        purpose: row["目的"],
        color: row["色"],
        startDate: row["開始日"],
        endDate: row["終了日"],
        status: row["ステータス"],
        notes: row["メモ"],
      }),
    )
    .filter(Boolean);

  const projectIdByName = new Map(projects.map((project) => [project.name, project.id]));

  const tasks = objectsFromRows(taskRows)
    .map((row) => {
      const important = parseBoolean(row["重要"]);
      const urgent = parseBoolean(row["緊急"]);
      const quadrant = quadrantFromLabel(row["四象限"], important, urgent);
      return normalizeTask({
        id: row["Task ID"],
        title: row["タスク"],
        projectId: row["Project ID"] || projectIdByName.get(row["目的 / プロジェクト"]) || "",
        quadrant,
        important: quadrantMeta[quadrant].important,
        urgent: quadrantMeta[quadrant].urgent,
        status: row["ステータス"],
        priority: row["優先度"],
        startDate: row["開始日"],
        dueDate: row["期限"],
        estimateMinutes: row["見積分"],
        progress: row["進捗"],
        focusDates: row["今日扱う日"],
        notes: row["メモ"],
        createdAt: row["作成日"],
        completedAt: row["完了日"],
      });
    })
    .filter(Boolean);

  const routines = objectsFromRows(routineRows)
    .map((row) =>
      normalizeRoutine({
        id: row["Routine ID"],
        title: row["日課"],
        area: row["領域"],
        estimateMinutes: row["見積分"],
        createdAt: row["作成日"],
      }),
    )
    .filter(Boolean);

  const routineLog = {};
  objectsFromRows(routineLogRows).forEach((row) => {
    const date = normalizeDate(row["日付"]);
    if (!date || !row["Routine ID"]) return;
    routineLog[date] ||= {};
    routineLog[date][String(row["Routine ID"])] = String(row["ステータス"] || "完了");
  });

  const dailyReviews = {};
  objectsFromRows(reviewRows).forEach((row) => {
    const date = normalizeDate(row["日付"]);
    if (!date) return;
    dailyReviews[date] = {
      mainGoal: String(row["今日の最重要目標"] || ""),
      reviewDone: String(row["できたこと"] || ""),
      reviewGap: String(row["計画との差"] || ""),
      reviewNext: String(row["明日への改善"] || ""),
    };
  });

  return normalizeState({
    selectedDate: state.selectedDate,
    projects,
    tasks,
    routines,
    routineLog,
    dailyReviews,
  });
}

function objectsFromRows(rows) {
  if (!rows?.length) return [];
  const headers = rows[0].map((cell) => String(cell || "").trim());
  return rows.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index]])),
  );
}

function rowsByName(workbookRows, names) {
  const found = Object.entries(workbookRows).find(([name]) => names.includes(name));
  return found?.[1] || [];
}

function downloadExcelXml(sheets, filename) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  ${Object.entries(sheets)
    .map(([name, rows]) => `
    <Worksheet ss:Name="${xmlEscape(name)}">
      <Table>
        ${rows
          .map((row) => `
          <Row>${row.map((cell) => xmlCell(cell)).join("")}</Row>`)
          .join("")}
      </Table>
    </Worksheet>`)
    .join("")}
</Workbook>`;
  downloadBlob(new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8" }), filename);
}

function xmlCell(value) {
  if (value === null || value === undefined) {
    return `<Cell><Data ss:Type="String"></Data></Cell>`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  if (typeof value === "boolean") {
    return `<Cell><Data ss:Type="Boolean">${value ? 1 : 0}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${xmlEscape(String(value))}</Data></Cell>`;
}

function parseExcelXml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const worksheets = Array.from(doc.getElementsByTagNameNS("*", "Worksheet"));
  return Object.fromEntries(
    worksheets.map((worksheet) => {
      const name = worksheet.getAttribute("ss:Name") || worksheet.getAttribute("Name") || "Sheet";
      const rows = Array.from(worksheet.getElementsByTagNameNS("*", "Row")).map((row) =>
        Array.from(row.getElementsByTagNameNS("*", "Cell")).map((cell) => {
          const data = cell.getElementsByTagNameNS("*", "Data")[0];
          return data?.textContent || "";
        }),
      );
      return [name, rows];
    }),
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildGanttRange(tasks) {
  const dates = tasks.flatMap((task) => [task.startDate, task.dueDate]).map(parseDate).filter(Boolean);
  const min = new Date(Math.min(...dates.map((date) => date.getTime())));
  const max = new Date(Math.max(...dates.map((date) => date.getTime())));
  return {
    start: startOfWeek(addDays(toISO(min), -3)),
    end: addDays(toISO(max), 21),
  };
}

function buildWeeks(startDate, endDate) {
  const weeks = [];
  let cursor = startOfWeek(startDate);
  while (cursor <= endDate) {
    weeks.push(cursor);
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

function startOfWeek(isoDate) {
  const date = parseDate(isoDate);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(toISO(date), diff);
}

function daysBetween(start, end) {
  return Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / 86400000);
}

function parseDate(value) {
  const normalized = normalizeDate(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function normalizeDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return toISO(value);
  if (typeof value === "number") {
    return toISO(new Date((value - XLSX_DATE_OFFSET) * 86400000));
  }
  const text = String(value).trim();
  if (!text) return "";
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    const [, year, month, day] = iso;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : toISO(parsed);
}

function todayISO() {
  return toISO(new Date());
}

function toISO(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const date = parseDate(isoDate);
  date.setDate(date.getDate() + days);
  return toISO(date);
}

function formatMonthDay(value) {
  const date = parseDate(value);
  if (!date) return "";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  const text = String(value || "").toLowerCase();
  return ["true", "1", "yes", "y", "はい", "重要", "緊急"].includes(text);
}

function parseProgress(value) {
  if (typeof value === "string" && value.includes("%")) {
    return Math.max(0, Math.min(1, Number(value.replace("%", "")) / 100 || 0));
  }
  const number = Number(value || 0);
  if (number > 1) return Math.max(0, Math.min(1, number / 100));
  return Math.max(0, Math.min(1, number));
}

function normalizeDateList(value) {
  if (Array.isArray(value)) return uniqueDates(value.map(normalizeDate).filter(Boolean));
  if (typeof value === "string") {
    return uniqueDates(value.split(/[,\n;、\s]+/).map(normalizeDate).filter(Boolean));
  }
  return [];
}

function uniqueDates(values) {
  return Array.from(new Set(values.map(normalizeDate).filter(Boolean))).sort();
}

function setValueIfNotFocused(selector, value) {
  const element = $(selector);
  if (document.activeElement !== element) element.value = value;
}

function uid(prefix) {
  const random = crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(16).slice(2, 10);
  return `${prefix}-${random}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function xmlEscape(value) {
  return escapeHtml(value);
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
    return;
  }

  const fallback = {
    "calendar-days": "D",
    "calendar-plus": "+",
    "calendar-x": "x",
    "cloud-download": "↓",
    "cloud-upload": "↑",
    "download-cloud": "↓",
    "folder-plus": "+",
    "gantt-chart-square": "G",
    "layout-grid": "▦",
    "list-checks": "✓",
    pencil: "✎",
    plus: "+",
    save: "S",
    settings: "⚙",
    "sliders-horizontal": "≡",
    sun: "○",
    "trash-2": "×",
    "upload-cloud": "↑",
    wifi: "W",
    x: "×",
  };

  $$("i[data-lucide]").forEach((icon) => {
    icon.classList.add("fallback-icon");
    icon.textContent = fallback[icon.dataset.lucide] || "•";
  });
}
