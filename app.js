const BITSTORE_BASE = "https://bitstore.mrcheng.se";
const BUCKET_STORAGE = "fat-check.bucket-slug";
const KEY_STORAGE = "fat-check.write-key";
const GOAL_STORAGE = "fat-check.daily-goal";
const BURNRATE_STORAGE = "fat-check.burnrate";
const LEGACY_GOAL_STORAGE = "fat-check.weekly-goal";
const GOAL_PREFIX = "g";
const BURNRATE_PREFIX = "b";
const KCAL_PER_KG = 3500;
const MAX_VALUE_LENGTH = 8;
const MAX_DAILY_CALORIES = 9999;
const WEEK_SYNC_RECORD_LIMIT = 35;

const state = {
  records: [],
  chart: null,
  chartDays: [],
  weekOffset: 0,
  syncedWeekKeys: new Set(),
  bucketSlug: localStorage.getItem(BUCKET_STORAGE) || "",
  writeKey: localStorage.getItem(KEY_STORAGE) || "",
  dailyGoal: getStoredDailyGoal(),
  burnrate: getStoredBurnrate()
};

const els = {
  refreshButton: document.querySelector("#refreshButton"),
  previousWeekButton: document.querySelector("#previousWeekButton"),
  nextWeekButton: document.querySelector("#nextWeekButton"),
  goalButton: document.querySelector("#goalButton"),
  burnrateButton: document.querySelector("#burnrateButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsModal: document.querySelector("#settingsModal"),
  settingsBackdrop: document.querySelector("#settingsBackdrop"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  resetButton: document.querySelector("#resetButton"),
  calorieForm: document.querySelector("#calorieForm"),
  calorieInput: document.querySelector("#calorieInput"),
  keyForm: document.querySelector("#keyForm"),
  bucketSlugInput: document.querySelector("#bucketSlugInput"),
  writeKeyInput: document.querySelector("#writeKeyInput"),
  clearKeyButton: document.querySelector("#clearKeyButton"),
  weekTotal: document.querySelector("#weekTotal"),
  goalDelta: document.querySelector("#goalDelta"),
  todayTotal: document.querySelector("#todayTotal"),
  weekRange: document.querySelector("#weekRange"),
  statusMessage: document.querySelector("#statusMessage"),
  chartCanvas: document.querySelector("#weekChart")
};

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) {
    window.lucide.createIcons();
  }

  els.bucketSlugInput.value = state.bucketSlug;
  els.writeKeyInput.value = state.writeKey;
  bindEvents();
  loadRecords();
});

function bindEvents() {
  els.refreshButton.addEventListener("click", () => loadRecords({ force: true }));
  els.previousWeekButton.addEventListener("click", () => changeWeek(-1));
  els.nextWeekButton.addEventListener("click", () => changeWeek(1));
  els.goalButton.addEventListener("click", setDailyGoal);
  els.burnrateButton.addEventListener("click", setBurnrate);
  els.resetButton.addEventListener("click", resetAllRecords);
  els.settingsButton.addEventListener("click", openSettingsModal);
  els.closeSettingsButton.addEventListener("click", closeSettingsModal);
  els.settingsBackdrop.addEventListener("click", closeSettingsModal);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.settingsModal.hidden) {
      closeSettingsModal();
    }
  });

  els.keyForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.bucketSlug = normalizeBucketSlug(els.bucketSlugInput.value);
    state.writeKey = els.writeKeyInput.value.trim();
    if (state.bucketSlug && state.writeKey) {
      localStorage.setItem(BUCKET_STORAGE, state.bucketSlug);
      localStorage.setItem(KEY_STORAGE, state.writeKey);
      state.records = [];
      state.syncedWeekKeys.clear();
      closeSettingsModal();
      setStatus("BitStore setup saved on this device.");
      loadRecords({ force: true });
      return;
    }
    setStatus("Enter both bucket slug and write key.", true);
  });

  els.clearKeyButton.addEventListener("click", () => {
    state.bucketSlug = "";
    state.writeKey = "";
    state.dailyGoal = 0;
    state.burnrate = 0;
    state.records = [];
    state.syncedWeekKeys.clear();
    els.bucketSlugInput.value = "";
    els.writeKeyInput.value = "";
    localStorage.removeItem(BUCKET_STORAGE);
    localStorage.removeItem(KEY_STORAGE);
    localStorage.removeItem(GOAL_STORAGE);
    localStorage.removeItem(BURNRATE_STORAGE);
    render();
    setStatus("BitStore setup removed from this device.");
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
}

function changeWeek(direction) {
  state.weekOffset += direction;
  render();
  loadRecords();
}

async function loadRecords({ force = false, week = getCurrentWeek() } = {}) {
  if (!state.bucketSlug) {
    state.records = [];
    state.syncedWeekKeys.clear();
    render();
    setStatus("Set up your BitStore bucket to sync data.");
    return;
  }

  const weekKey = getWeekKey(week.start);
  if (!force && state.syncedWeekKeys.has(weekKey)) {
    render();
    setStatus("Synced.");
    return;
  }

  setStatus("Syncing...");
  try {
    const data = await bitstoreFetch(`/records?take=${WEEK_SYNC_RECORD_LIMIT}&t=${Date.now()}`);
    const bitstoreRecords = data.records || [];
    const hasRemoteGoal = syncDailyGoalFromRecords(bitstoreRecords);
    const hasRemoteBurnrate = syncBurnrateFromRecords(bitstoreRecords);
    if (!hasRemoteGoal && state.dailyGoal && hasBitStoreSetup()) {
      await saveDailyGoalRecord(state.dailyGoal);
    }
    if (!hasRemoteBurnrate && state.burnrate && hasBitStoreSetup()) {
      await saveBurnrateRecord(state.burnrate);
    }
    mergeRecords(normalizeRecords(bitstoreRecords), week);
    state.syncedWeekKeys.add(weekKey);
    render();
    setStatus("Synced.");
  } catch (error) {
    render();
    setStatus(error.message, true);
  }
}

async function addRecord(value) {
  if (!requireBitStoreSetup()) {
    return;
  }

  const amount = Number(value);
  const today = new Date();
  await ensureWeekForDate(today);
  const todayRecord = findDailyRecordForDate(today);
  const currentTotal = todayRecord ? todayRecord.value : totalForDay(today, getEffectiveCalorieRecords(state.records));
  const nextTotal = currentTotal + amount;
  if (nextTotal > MAX_DAILY_CALORIES) {
    setStatus(`Daily total cannot exceed ${formatNumber(MAX_DAILY_CALORIES)} kcal.`, true);
    return;
  }

  setStatus("Saving...");
  try {
    if (todayRecord?.id) {
      await updateCalorieRecord(todayRecord.id, formatDailyValue(today, nextTotal));
    } else {
      await createCalorieRecord(formatDailyValue(today, nextTotal));
    }
    els.calorieInput.value = "";
    await loadRecords({ force: true, week: getWeekForDate(today) });
    setStatus(`Added ${formatNumber(value)} kcal. Today: ${formatNumber(nextTotal)} kcal.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function editCaloriesForDate(date) {
  if (!requireBitStoreSetup()) {
    return;
  }

  await ensureWeekForDate(date);
  const calorieRecords = getEffectiveCalorieRecords(state.records);
  const currentTotal = totalForDay(date, calorieRecords);
  const typed = window.prompt(
    `Calories for ${date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}?`,
    String(currentTotal)
  );
  if (typed === null) {
    setStatus("Day unchanged.");
    return;
  }

  const nextTotal = Math.round(Number(typed));
  if (!Number.isFinite(nextTotal) || nextTotal < 0 || nextTotal > MAX_DAILY_CALORIES) {
    setStatus(`Enter a daily total from 0 to ${formatNumber(MAX_DAILY_CALORIES)} kcal.`, true);
    return;
  }

  const dailyRecord = findDailyRecordForDate(date);
  setStatus("Saving day...");
  try {
    if (nextTotal === 0) {
      const dayRecords = state.records.filter((record) => isSameDay(record.createdAt, date));
      await Promise.all(
        dayRecords
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
      removeRecordsFromCache(dayRecords);
    } else if (dailyRecord?.id) {
      await updateCalorieRecord(dailyRecord.id, formatDailyValue(date, nextTotal));
    } else {
      await createCalorieRecord(formatDailyValue(date, nextTotal));
    }

    await loadRecords({ force: true, week: getWeekForDate(date) });
    setStatus(`${formatShortDate(date)} set to ${formatNumber(nextTotal)} kcal.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function resetAllRecords() {
  if (!requireBitStoreSetup()) {
    return;
  }

  const typed = window.prompt('Type "reset" to delete every calorie entry.');
  if (typed !== "reset") {
    setStatus("Reset cancelled.");
    return;
  }

  setStatus("Resetting...");
  try {
    await bitstoreFetch("/records", {
      method: "DELETE",
      headers: {
        "X-BitStore-Key": state.writeKey
      }
    });
    state.records = [];
    state.syncedWeekKeys.clear();
    if (state.dailyGoal) {
      await saveDailyGoalRecord(state.dailyGoal);
    }
    if (state.burnrate) {
      await saveBurnrateRecord(state.burnrate);
    }
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

  if (!requireBitStoreSetup()) {
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

async function setBurnrate() {
  const currentBurnrate = state.burnrate ? String(state.burnrate) : "";
  const typed = window.prompt("Burnrate kcal per day?", currentBurnrate);
  if (typed === null) {
    setStatus("Burnrate unchanged.");
    return;
  }

  const burnrate = Math.round(Number(typed));
  if (!Number.isFinite(burnrate) || burnrate < 0 || String(burnrate).length + BURNRATE_PREFIX.length > MAX_VALUE_LENGTH) {
    setStatus("Enter a burnrate from 0 to 9,999,999 kcal.", true);
    return;
  }

  if (!requireBitStoreSetup()) {
    return;
  }

  setStatus("Saving burnrate...");
  try {
    await saveBurnrateRecord(burnrate);
    state.burnrate = burnrate;
    if (burnrate > 0) {
      localStorage.setItem(BURNRATE_STORAGE, String(burnrate));
      const balance = state.dailyGoal ? state.dailyGoal - state.burnrate : 0;
      const balanceText = state.dailyGoal ? ` (${formatSignedNumber(balance)} kcal/day at current intake)` : "";
      setStatus(`Burnrate set to ${formatNumber(burnrate)} kcal/day${balanceText}.`);
    } else {
      localStorage.removeItem(BURNRATE_STORAGE);
      setStatus("Burnrate cleared.");
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

async function saveBurnrateRecord(burnrate) {
  return bitstoreFetch("/records", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BitStore-Key": state.writeKey
    },
    body: JSON.stringify({ value: `${BURNRATE_PREFIX}${burnrate}` })
  });
}

async function createCalorieRecord(value) {
  return bitstoreFetch("/records", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BitStore-Key": state.writeKey
    },
    body: JSON.stringify({ value })
  });
}

async function updateCalorieRecord(id, value) {
  return bitstoreFetch(`/records/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-BitStore-Key": state.writeKey
    },
    body: JSON.stringify({ value })
  });
}

async function bitstoreFetch(path, options = {}) {
  if (!state.bucketSlug) {
    throw new Error("BitStore bucket is not set up.");
  }

  const response = await fetch(`${getApiBase()}${path}`, {
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

function requireBitStoreSetup() {
  if (hasBitStoreSetup()) {
    return true;
  }
  window.alert(
    "Set up your BitStore bucket slug and API write key first to store data.\n\nOpen the setup guide:\nhttps://bitstore.mrcheng.se/HowTo"
  );
  openSettingsModal();
  setStatus("BitStore setup is required to store data.", true);
  return false;
}

function openSettingsModal() {
  els.bucketSlugInput.value = state.bucketSlug;
  els.writeKeyInput.value = state.writeKey;
  els.settingsModal.hidden = false;
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => {
    (state.bucketSlug ? els.writeKeyInput : els.bucketSlugInput).focus();
  });
}

function closeSettingsModal() {
  els.settingsModal.hidden = true;
  document.body.classList.remove("modal-open");
}

function hasBitStoreSetup() {
  return Boolean(state.bucketSlug && state.writeKey);
}

function getApiBase() {
  return `${BITSTORE_BASE}/api/buckets/${encodeURIComponent(state.bucketSlug)}`;
}

function normalizeBucketSlug(value) {
  return String(value || "").trim().toLowerCase();
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
      const dailyRecord = parseDailyValue(record.value);
      if (dailyRecord) {
        return {
          ...record,
          id: record.id ?? record.recordId ?? record.recordID,
          kind: "daily",
          dayKey: dailyRecord.dayKey,
          value: dailyRecord.calories,
          createdAt: dateFromDayKey(dailyRecord.dayKey),
          updatedAt: getRecordDate(record)
        };
      }

      const value = Math.round(Number(record.value));
      const createdAt = getRecordDate(record);
      return {
        ...record,
        id: record.id ?? record.recordId ?? record.recordID,
        kind: "legacy",
        value,
        createdAt
      };
    })
    .filter((record) => Number.isFinite(record.value) && record.value > 0 && record.createdAt)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function mergeRecords(records, week) {
  const byKey = new Map(
    state.records
      .filter((record) => !week || !isRecordInWeek(record, week))
      .map((record) => [getRecordCacheKey(record), record])
  );
  records.forEach((record) => {
    byKey.set(getRecordCacheKey(record), record);
  });
  state.records = [...byKey.values()].sort((a, b) => b.createdAt - a.createdAt);
}

function removeRecordsFromCache(records) {
  const removedKeys = new Set(records.map(getRecordCacheKey));
  state.records = state.records.filter((record) => !removedKeys.has(getRecordCacheKey(record)));
}

async function ensureWeekForDate(date) {
  const week = getWeekForDate(date);
  if (!state.syncedWeekKeys.has(getWeekKey(week.start))) {
    await loadRecords({ week });
  }
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

function syncBurnrateFromRecords(records) {
  const burnrateRecords = records
    .map((record) => ({
      value: parsePrefixedValue(record.value, BURNRATE_PREFIX),
      createdAt: getRecordDate(record)
    }))
    .filter((record) => record.value !== null && record.createdAt)
    .sort((a, b) => b.createdAt - a.createdAt);

  if (!burnrateRecords.length) {
    return false;
  }

  state.burnrate = burnrateRecords[0].value;
  if (state.burnrate > 0) {
    localStorage.setItem(BURNRATE_STORAGE, String(state.burnrate));
  } else {
    localStorage.removeItem(BURNRATE_STORAGE);
  }
  return true;
}

function parseGoalValue(value) {
  return parsePrefixedValue(value, GOAL_PREFIX);
}

function parsePrefixedValue(value, prefix) {
  const match = String(value || "").match(new RegExp(`^${prefix}(\\d+)$`, "i"));
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
  const calorieRecords = getEffectiveCalorieRecords(state.records);
  const dailyTotals = week.days.map((day) => totalForDay(day, calorieRecords));
  const weekTotal = dailyTotals.reduce((sum, value) => sum + value, 0);
  const todayTotal = totalForDay(new Date(), calorieRecords);

  els.weekTotal.textContent = formatNumber(weekTotal);
  els.todayTotal.textContent = formatNumber(todayTotal);
  renderGoalDelta(weekTotal);
  els.weekRange.textContent = `Mon-Sun, ${formatShortDate(week.start)} - ${formatShortDate(week.end)}`;

  renderChart(week.days, dailyTotals);
}

function renderGoalDelta(weekTotal) {
  els.goalDelta.classList.remove("is-under", "is-over");

  if (!state.burnrate) {
    els.goalDelta.textContent = "Set burnrate";
    return;
  }

  const weeklyBurnrate = getWeeklyBurnrate();
  const burnrateDifference = weekTotal - weeklyBurnrate;
  const weightLossText = getWeightLossText(burnrateDifference);
  if (burnrateDifference === 0) {
    els.goalDelta.textContent = `0 kcal from burnrate this week - ${weightLossText}`;
    els.goalDelta.classList.add("is-under");
    return;
  }

  if (burnrateDifference < 0) {
    els.goalDelta.textContent = `${formatNumber(Math.abs(burnrateDifference))} kcal under burnrate this week - ${weightLossText}`;
    els.goalDelta.classList.add("is-under");
    return;
  }

  els.goalDelta.textContent = `${formatNumber(burnrateDifference)} kcal over burnrate this week - ${weightLossText}`;
  els.goalDelta.classList.add("is-over");
}

function getWeightLossText(burnrateDifference) {
  const weeklyWeightLoss = -burnrateDifference / KCAL_PER_KG;
  return `weightloss this week ${weeklyWeightLoss.toFixed(1)} Kg`;
}

function renderChart(days, totals) {
  state.chartDays = days;
  const labels = days.map((date) => date.toLocaleDateString(undefined, { weekday: "short" }));
  const cumulativeTotals = totals.reduce((values, total, index) => {
    values.push((values[index - 1] || 0) + total);
    return values;
  }, []);
  const weeklyGoal = getWeeklyGoal();
  const dailyGoalLine = days.map(() => state.dailyGoal || null);
  const burnrateLine = days.map(() => state.burnrate || null);
  const weeklyGoalLine = days.map(() => weeklyGoal || null);
  const scaleConfig = getChartScaleConfig([...totals, ...cumulativeTotals, state.dailyGoal, state.burnrate, weeklyGoal]);
  const scaledTotals = totals.map((value) => scaleChartValue(value, scaleConfig));
  const scaledCumulativeTotals = cumulativeTotals.map((value) => scaleChartValue(value, scaleConfig));
  const scaledDailyGoalLine = dailyGoalLine.map((value) => scaleChartValue(value, scaleConfig));
  const scaledBurnrateLine = burnrateLine.map((value) => scaleChartValue(value, scaleConfig));
  const scaledWeeklyGoalLine = weeklyGoalLine.map((value) => scaleChartValue(value, scaleConfig));

  if (!window.Chart) {
    return;
  }

  if (state.chart) {
    state.chart.data.labels = labels;
    state.chart.data.datasets[0].data = scaledTotals;
    state.chart.data.datasets[0].rawData = totals;
    state.chart.data.datasets[1].data = scaledCumulativeTotals;
    state.chart.data.datasets[1].rawData = cumulativeTotals;
    state.chart.data.datasets[2].data = scaledDailyGoalLine;
    state.chart.data.datasets[2].rawData = dailyGoalLine;
    state.chart.data.datasets[3].data = scaledBurnrateLine;
    state.chart.data.datasets[3].rawData = burnrateLine;
    state.chart.data.datasets[4].data = scaledWeeklyGoalLine;
    state.chart.data.datasets[4].rawData = weeklyGoalLine;
    state.chart.options.scales.y.max = scaleConfig.displayMax;
    state.chart.options.scales.y.ticks.callback = (value) => formatNumber(unscaleChartValue(value, scaleConfig));
    state.chart.options.plugins.tooltip.callbacks.label = (item) => {
      const rawValue = item.dataset.rawData?.[item.dataIndex] ?? unscaleChartValue(item.raw, scaleConfig);
      return `${item.dataset.label}: ${formatNumber(rawValue)} kcal`;
    };
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
          data: scaledTotals,
          rawData: totals,
          borderRadius: 8,
          backgroundColor: "rgba(60, 109, 240, 0.62)",
          borderColor: "#3c6df0",
          borderWidth: 1,
          maxBarThickness: 30
        },
        {
          type: "line",
          label: "Week total",
          data: scaledCumulativeTotals,
          rawData: cumulativeTotals,
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
          label: "Daily goal",
          data: scaledDailyGoalLine,
          rawData: dailyGoalLine,
          borderColor: "#e53935",
          borderWidth: 2,
          borderDash: [3, 5],
          pointRadius: 0,
          tension: 0,
          fill: false
        },
        {
          type: "line",
          label: "Burnrate",
          data: scaledBurnrateLine,
          rawData: burnrateLine,
          borderColor: "#ffb33f",
          borderWidth: 3,
          borderDash: [2, 5],
          pointRadius: 0,
          tension: 0,
          fill: false
        },
        {
          type: "line",
          label: "Weekly goal",
          data: scaledWeeklyGoalLine,
          rawData: weeklyGoalLine,
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
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => item.datasetIndex === 0,
          callbacks: {
            label: (item) => {
              const rawValue = item.dataset.rawData?.[item.dataIndex] ?? unscaleChartValue(item.raw, scaleConfig);
              return `${item.dataset.label}: ${formatNumber(rawValue)} kcal`;
            }
          }
        }
      },
      onClick: (_event, elements) => {
        const element = elements.find((item) => item.datasetIndex === 0) || elements[0];
        const day = state.chartDays[element?.index];
        if (day) {
          clearChartInteraction();
          editCaloriesForDate(day).finally(clearChartInteraction);
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
          max: scaleConfig.displayMax,
          grid: { color: "#e7e1d8" },
          ticks: {
            color: "#69707c",
            precision: 0,
            callback: (value) => formatNumber(unscaleChartValue(value, scaleConfig))
          }
        }
      }
    }
  });
}

function clearChartInteraction() {
  if (!state.chart) {
    return;
  }

  state.chart.setActiveElements([]);
  state.chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
  state.chart.update("none");
}

function getChartScaleConfig(values) {
  const weeklyGoalTop = getWeeklyGoal() ? getWeeklyGoal() + 2000 : 0;
  const dataMax = Math.max(0, ...values.filter((value) => Number.isFinite(value)));
  let rawMax = Math.max(4000, weeklyGoalTop, dataMax);
  const rawMid = state.burnrate || 0;

  if (rawMid > 0 && rawMax <= rawMid) {
    rawMax = rawMid * 2;
  }

  return {
    displayMax: rawMax,
    displayMid: rawMax / 2,
    rawMax,
    rawMid
  };
}

function scaleChartValue(value, config) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  if (!config.rawMid || config.rawMid >= config.rawMax) {
    return value;
  }

  if (value <= config.rawMid) {
    return (value / config.rawMid) * config.displayMid;
  }

  return config.displayMid + ((value - config.rawMid) / (config.rawMax - config.rawMid)) * config.displayMid;
}

function unscaleChartValue(value, config) {
  if (!config.rawMid || config.rawMid >= config.rawMax) {
    return Math.round(value);
  }

  if (value <= config.displayMid) {
    return Math.round((value / config.displayMid) * config.rawMid);
  }

  return Math.round(config.rawMid + ((value - config.displayMid) / config.displayMid) * (config.rawMax - config.rawMid));
}

function getCurrentWeek() {
  const now = new Date();
  const week = getWeekForDate(now);
  week.start.setDate(week.start.getDate() + state.weekOffset * 7);
  week.days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(week.start);
    date.setDate(week.start.getDate() + index);
    return date;
  });
  week.end = new Date(week.start);
  week.end.setDate(week.start.getDate() + 6);
  return week;
}

function getWeekForDate(date) {
  const now = date;
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

function getWeekKey(date) {
  return getDayKey(startOfDay(date));
}

function isRecordInWeek(record, week) {
  const endExclusive = new Date(week.end);
  endExclusive.setDate(endExclusive.getDate() + 1);
  return record.createdAt >= week.start && record.createdAt < endExclusive;
}

function getWeeklyGoal() {
  return state.dailyGoal ? state.dailyGoal * 7 : 0;
}

function getWeeklyBurnrate() {
  return state.burnrate ? state.burnrate * 7 : 0;
}

function findDailyRecordForDate(date) {
  const dayKey = getDayKey(date);
  return state.records
    .filter((record) => record.kind === "daily" && record.dayKey === dayKey)
    .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))[0];
}

function getEffectiveCalorieRecords(records) {
  const dailyByKey = new Map();
  records
    .filter((record) => record.kind === "daily")
    .forEach((record) => {
      const existing = dailyByKey.get(record.dayKey);
      if (!existing || (record.updatedAt || record.createdAt) > (existing.updatedAt || existing.createdAt)) {
        dailyByKey.set(record.dayKey, record);
      }
    });

  const effective = [...dailyByKey.values()];
  records
    .filter((record) => record.kind !== "daily")
    .forEach((record) => {
      if (!dailyByKey.has(getDayKey(record.createdAt))) {
        effective.push(record);
      }
    });

  return effective.sort((a, b) => b.createdAt - a.createdAt);
}

function getRecordCacheKey(record) {
  if (record.id !== undefined && record.id !== null) {
    return `id:${record.id}`;
  }
  if (record.kind === "daily") {
    return `daily:${record.dayKey}`;
  }
  return `legacy:${record.createdAt.toISOString()}:${record.value}`;
}

function formatDailyValue(date, calories) {
  return `${getDayKey(date)}:${calories}`;
}

function parseDailyValue(value) {
  const match = String(value || "").match(/^([0-9a-z]{3}):(\d{1,4})$/i);
  if (!match) {
    return null;
  }

  return {
    dayKey: match[1].toLowerCase(),
    calories: Number(match[2])
  };
}

function getDayKey(date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000).toString(36);
}

function dateFromDayKey(dayKey) {
  const dayNumber = parseInt(dayKey, 36);
  const date = new Date(dayNumber * 86400000);
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
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

function getStoredBurnrate() {
  const storedBurnrate = Number(localStorage.getItem(BURNRATE_STORAGE));
  return Number.isFinite(storedBurnrate) && storedBurnrate > 0 ? storedBurnrate : 0;
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

function formatShortDate(date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatSignedNumber(value) {
  if (value > 0) {
    return `+${formatNumber(value)}`;
  }
  if (value < 0) {
    return `-${formatNumber(Math.abs(value))}`;
  }
  return "0";
}

function setStatus(message, isError = false) {
  els.statusMessage.textContent = message;
  els.statusMessage.classList.toggle("is-error", isError);
  els.statusMessage.classList.toggle("is-syncing", !isError && message === "Syncing...");
}
