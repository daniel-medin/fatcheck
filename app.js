const API_BASE = "https://bitstorehome.azurewebsites.net/api/buckets/fat-check";
const KEY_STORAGE = "fat-check.write-key";
const GOAL_STORAGE = "fat-check.daily-goal";
const LEGACY_GOAL_STORAGE = "fat-check.weekly-goal";
const DEFAULT_WRITE_KEY = "6864b11a2a3539fd1f7e4b69c29d9953d638c94b9b2f1cd9";
const GOAL_PREFIX = "g";
const MAX_VALUE_LENGTH = 8;

const state = {
  records: [],
  chart: null,
  writeKey: localStorage.getItem(KEY_STORAGE) || DEFAULT_WRITE_KEY,
  dailyGoal: getStoredDailyGoal()
};

const els = {
  refreshButton: document.querySelector("#refreshButton"),
  goalButton: document.querySelector("#goalButton"),
  settingsButton: document.querySelector("#settingsButton"),
  resetButton: document.querySelector("#resetButton"),
  calorieForm: document.querySelector("#calorieForm"),
  calorieInput: document.querySelector("#calorieInput"),
  keyForm: document.querySelector("#keyForm"),
  writeKeyInput: document.querySelector("#writeKeyInput"),
  clearKeyButton: document.querySelector("#clearKeyButton"),
  weekTotal: document.querySelector("#weekTotal"),
  goalDelta: document.querySelector("#goalDelta"),
  todayTotal: document.querySelector("#todayTotal"),
  weekRange: document.querySelector("#weekRange"),
  recordCount: document.querySelector("#recordCount"),
  recentList: document.querySelector("#recentList"),
  statusMessage: document.querySelector("#statusMessage"),
  chartCanvas: document.querySelector("#weekChart")
};

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) {
    window.lucide.createIcons();
  }

  els.writeKeyInput.value = state.writeKey;
  els.keyForm.hidden = Boolean(state.writeKey);
  bindEvents();
  loadRecords();
});

function bindEvents() {
  els.refreshButton.addEventListener("click", loadRecords);
  els.goalButton.addEventListener("click", setDailyGoal);
  els.resetButton.addEventListener("click", resetAllRecords);
  els.settingsButton.addEventListener("click", () => {
    els.keyForm.hidden = !els.keyForm.hidden;
    if (!els.keyForm.hidden) {
      els.writeKeyInput.focus();
    }
  });

  els.keyForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.writeKey = els.writeKeyInput.value.trim();
    if (state.writeKey) {
      localStorage.setItem(KEY_STORAGE, state.writeKey);
      els.keyForm.hidden = true;
      setStatus("Write key saved on this device.");
    }
  });

  els.clearKeyButton.addEventListener("click", () => {
    state.writeKey = "";
    els.writeKeyInput.value = "";
    localStorage.removeItem(KEY_STORAGE);
    setStatus("Write key removed from this device.");
  });

  els.calorieForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = normalizeCalories(els.calorieInput.value);
    if (!value) {
      setStatus("Enter a calorie amount.", true);
      return;
    }
    await addRecord(value);
  });

  document.querySelectorAll("[data-quick]").forEach((button) => {
    button.addEventListener("click", () => {
      els.calorieInput.value = button.dataset.quick;
      els.calorieInput.focus();
    });
  });

  els.recentList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-id]");
    if (!button) {
      return;
    }
    await deleteRecord(button.dataset.deleteId);
  });
}

async function loadRecords() {
  setStatus("Syncing BitStore...");
  try {
    const data = await bitstoreFetch(`/records?take=200&t=${Date.now()}`);
    const bitstoreRecords = data.records || [];
    const hasRemoteGoal = syncDailyGoalFromRecords(bitstoreRecords);
    if (!hasRemoteGoal && state.dailyGoal) {
      await saveDailyGoalRecord(state.dailyGoal);
    }
    state.records = normalizeRecords(bitstoreRecords);
    render();
    setStatus(`Synced ${state.records.length} ${state.records.length === 1 ? "record" : "records"}.`);
  } catch (error) {
    render();
    setStatus(error.message, true);
  }
}

async function addRecord(value) {
  if (!requireWriteKey()) {
    return;
  }

  setStatus("Saving...");
  try {
    await bitstoreFetch("/records", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BitStore-Key": state.writeKey
      },
      body: JSON.stringify({ value })
    });
    els.calorieInput.value = "";
    await loadRecords();
    setStatus(`Added ${formatNumber(value)} kcal.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function deleteRecord(id) {
  if (!id || !requireWriteKey()) {
    return;
  }

  setStatus("Deleting...");
  try {
    await bitstoreFetch(`/records/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: {
        "X-BitStore-Key": state.writeKey
      }
    });
    await loadRecords();
    setStatus("Entry deleted.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function resetAllRecords() {
  if (!state.records.length) {
    setStatus("Nothing to reset.");
    return;
  }

  if (!requireWriteKey()) {
    return;
  }

  const typed = window.prompt('Type "reset" to delete every calorie entry.');
  if (typed !== "reset") {
    setStatus("Reset cancelled.");
    return;
  }

  setStatus("Resetting...");
  try {
    await Promise.all(
      state.records
        .filter((record) => record.id)
        .map((record) =>
          bitstoreFetch(`/records/${encodeURIComponent(record.id)}`, {
            method: "DELETE",
            headers: {
              "X-BitStore-Key": state.writeKey
            }
          })
        )
    );
    state.records = [];
    render();
    setStatus("All entries reset.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function setDailyGoal() {
  const currentGoal = state.dailyGoal ? String(state.dailyGoal) : "";
  const typed = window.prompt("Daily calorie goal?", currentGoal);
  if (typed === null) {
    setStatus("Goal unchanged.");
    return;
  }

  const goal = Math.round(Number(typed));
  if (!Number.isFinite(goal) || goal < 0 || String(goal).length + GOAL_PREFIX.length > MAX_VALUE_LENGTH) {
    setStatus("Enter a daily goal from 0 to 9,999,999 kcal.", true);
    return;
  }

  if (!requireWriteKey()) {
    return;
  }

  setStatus("Saving daily goal...");
  try {
    await saveDailyGoalRecord(goal);
    state.dailyGoal = goal;
    if (goal > 0) {
      localStorage.setItem(GOAL_STORAGE, String(goal));
      setStatus(`Daily goal set to ${formatNumber(goal)} kcal/day (${formatNumber(getWeeklyGoal())} kcal/week).`);
    } else {
      localStorage.removeItem(GOAL_STORAGE);
      setStatus("Daily goal cleared.");
    }
    render();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function saveDailyGoalRecord(goal) {
  return bitstoreFetch("/records", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BitStore-Key": state.writeKey
    },
    body: JSON.stringify({ value: `${GOAL_PREFIX}${goal}` })
  });
}

async function bitstoreFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    credentials: "omit",
    mode: "cors",
    ...options
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  if (response.status === 204) {
    return {};
  }

  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function getErrorMessage(response) {
  const fallback = `BitStore returned ${response.status}.`;
  try {
    const text = await response.text();
    if (!text) {
      return fallback;
    }
    try {
      const json = JSON.parse(text);
      return json.message || json.error || json.title || text;
    } catch {
      return text;
    }
  } catch {
    return fallback;
  }
}

function requireWriteKey() {
  if (state.writeKey) {
    return true;
  }
  els.keyForm.hidden = false;
  els.writeKeyInput.focus();
  setStatus("Save the BitStore write key first.", true);
  return false;
}

function normalizeCalories(raw) {
  const amount = Math.round(Number(raw));
  if (!Number.isFinite(amount) || amount <= 0) {
    return "";
  }
  const value = String(amount);
  return value.length <= MAX_VALUE_LENGTH ? value : "";
}

function normalizeRecords(records) {
  return records
    .map((record) => {
      const value = Math.round(Number(record.value));
      const createdAt = getRecordDate(record);
      return {
        ...record,
        id: record.id ?? record.recordId ?? record.recordID,
        value,
        createdAt
      };
    })
    .filter((record) => Number.isFinite(record.value) && record.value > 0 && record.createdAt)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function syncDailyGoalFromRecords(records) {
  const goalRecords = records
    .map((record) => ({
      value: parseGoalValue(record.value),
      createdAt: getRecordDate(record)
    }))
    .filter((record) => record.value !== null && record.createdAt)
    .sort((a, b) => b.createdAt - a.createdAt);

  if (!goalRecords.length) {
    return false;
  }

  state.dailyGoal = goalRecords[0].value;
  if (state.dailyGoal > 0) {
    localStorage.setItem(GOAL_STORAGE, String(state.dailyGoal));
  } else {
    localStorage.removeItem(GOAL_STORAGE);
  }
  return true;
}

function parseGoalValue(value) {
  const match = String(value || "").match(/^g(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function getRecordDate(record) {
  const dateValue =
    record.createdUtc ||
    record.createdAt ||
    record.created ||
    record.timestamp ||
    record.date ||
    record.updatedUtc;
  const date = dateValue ? new Date(dateValue) : null;
  return date && !Number.isNaN(date.valueOf()) ? date : null;
}

function render() {
  const week = getCurrentWeek();
  const dailyTotals = week.days.map((day) => totalForDay(day, state.records));
  const weekTotal = dailyTotals.reduce((sum, value) => sum + value, 0);
  const todayTotal = totalForDay(new Date(), state.records);

  els.weekTotal.textContent = formatNumber(weekTotal);
  els.todayTotal.textContent = formatNumber(todayTotal);
  renderGoalDelta(weekTotal);
  els.weekRange.textContent = `Mon-Sun, ${formatShortDate(week.start)} - ${formatShortDate(week.end)}`;
  els.recordCount.textContent = `${state.records.length} ${state.records.length === 1 ? "record" : "records"}`;

  renderChart(week.days, dailyTotals);
  renderRecent();
}

function renderGoalDelta(weekTotal) {
  els.goalDelta.classList.remove("is-under", "is-over");

  const weeklyGoal = getWeeklyGoal();
  if (!weeklyGoal) {
    els.goalDelta.textContent = "Set a daily goal";
    return;
  }

  const difference = weekTotal - weeklyGoal;
  const goalSuffix = `(${formatNumber(state.dailyGoal)}/day, ${formatNumber(weeklyGoal)}/week)`;
  if (difference === 0) {
    els.goalDelta.textContent = `0 kcal left this week ${goalSuffix}`;
    els.goalDelta.classList.add("is-under");
    return;
  }

  if (difference < 0) {
    els.goalDelta.textContent = `${formatNumber(Math.abs(difference))} kcal left this week ${goalSuffix}`;
    els.goalDelta.classList.add("is-under");
    return;
  }

  els.goalDelta.textContent = `${formatNumber(difference)} kcal over this week ${goalSuffix}`;
  els.goalDelta.classList.add("is-over");
}

function renderChart(days, totals) {
  const labels = days.map((date) => date.toLocaleDateString(undefined, { weekday: "short" }));
  const cumulativeTotals = totals.reduce((values, total, index) => {
    values.push((values[index - 1] || 0) + total);
    return values;
  }, []);
  const weeklyGoal = getWeeklyGoal();
  const goalLine = days.map(() => weeklyGoal || null);
  const yMax = Math.max(4000, weeklyGoal || 0, ...cumulativeTotals, ...totals);

  if (!window.Chart) {
    return;
  }

  if (state.chart) {
    state.chart.data.labels = labels;
    state.chart.data.datasets[0].data = totals;
    state.chart.data.datasets[1].data = cumulativeTotals;
    state.chart.data.datasets[2].data = goalLine;
    state.chart.options.scales.y.max = yMax;
    state.chart.update();
    return;
  }

  state.chart = new window.Chart(els.chartCanvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Daily",
          data: totals,
          borderRadius: 8,
          backgroundColor: "rgba(60, 109, 240, 0.62)",
          borderColor: "#3c6df0",
          borderWidth: 1,
          maxBarThickness: 30
        },
        {
          type: "line",
          label: "Week total",
          data: cumulativeTotals,
          borderColor: "#1f9f62",
          backgroundColor: "rgba(31, 159, 98, 0.16)",
          borderWidth: 4,
          pointBackgroundColor: "#1f9f62",
          pointBorderColor: "#ffffff",
          pointBorderWidth: 2,
          pointRadius: 4,
          tension: 0.32,
          fill: true
        },
        {
          type: "line",
          label: "Goal",
          data: goalLine,
          borderColor: "#e53935",
          borderWidth: 3,
          borderDash: [7, 5],
          pointRadius: 0,
          tension: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${formatNumber(item.raw)} kcal`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#69707c", font: { weight: 700 } }
        },
        y: {
          beginAtZero: true,
          min: 0,
          max: yMax,
          grid: { color: "#e7e1d8" },
          ticks: {
            color: "#69707c",
            precision: 0,
            callback: (value) => formatNumber(value)
          }
        }
      }
    }
  });
}

function renderRecent() {
  const recent = state.records.slice(0, 12);
  els.recentList.innerHTML = "";

  if (!recent.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "No calories yet.";
    els.recentList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  recent.forEach((record) => {
    const item = document.createElement("li");
    item.className = "recent-item";

    const main = document.createElement("div");
    main.className = "recent-main";
    const day = document.createElement("strong");
    day.textContent = relativeDay(record.createdAt);
    const time = document.createElement("span");
    time.textContent = record.createdAt.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    main.append(day, time);

    const value = document.createElement("span");
    value.className = "recent-value";
    value.textContent = `${formatNumber(record.value)} kcal`;

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.type = "button";
    deleteButton.title = "Delete";
    deleteButton.setAttribute("aria-label", "Delete entry");
    deleteButton.dataset.deleteId = record.id;
    deleteButton.innerHTML = '<i data-lucide="trash-2"></i>';
    deleteButton.disabled = !record.id;

    item.append(main, value, deleteButton);
    fragment.append(item);
  });

  els.recentList.append(fragment);
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function getCurrentWeek() {
  const now = new Date();
  const start = startOfDay(now);
  const day = start.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + mondayOffset);

  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end, days };
}

function getWeeklyGoal() {
  return state.dailyGoal ? state.dailyGoal * 7 : 0;
}

function getStoredDailyGoal() {
  const storedDailyGoal = Number(localStorage.getItem(GOAL_STORAGE));
  if (Number.isFinite(storedDailyGoal) && storedDailyGoal > 0) {
    return storedDailyGoal;
  }

  const legacyWeeklyGoal = Number(localStorage.getItem(LEGACY_GOAL_STORAGE));
  if (Number.isFinite(legacyWeeklyGoal) && legacyWeeklyGoal > 0) {
    const dailyGoal = Math.round(legacyWeeklyGoal / 7);
    localStorage.setItem(GOAL_STORAGE, String(dailyGoal));
    localStorage.removeItem(LEGACY_GOAL_STORAGE);
    return dailyGoal;
  }

  return 0;
}

function totalForDay(day, records) {
  return records
    .filter((record) => isSameDay(record.createdAt, day))
    .reduce((sum, record) => sum + record.value, 0);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isSameDay(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function relativeDay(date) {
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) {
    return "Today";
  }
  if (diff === -1) {
    return "Yesterday";
  }
  return date.toLocaleDateString(undefined, { weekday: "long" });
}

function formatShortDate(date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function setStatus(message, isError = false) {
  els.statusMessage.textContent = message;
  els.statusMessage.classList.toggle("is-error", isError);
}
