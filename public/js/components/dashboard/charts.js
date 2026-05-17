
window.DashboardCharts = window.DashboardCharts || {};

const getThemeColor = (name) => window.utils.getThemeColor(name);

const FAMILY_COLORS = {
  get claude() {
    return getThemeColor("--color-neon-purple");
  },
  get gemini() {
    return getThemeColor("--color-neon-green");
  },
  get other() {
    return getThemeColor("--color-neon-cyan");
  },
};

const MODEL_COLORS = Array.from({ length: 16 }, (_, i) =>
  getThemeColor(`--color-chart-${i + 1}`)
);

window.DashboardConstants = { FAMILY_COLORS, MODEL_COLORS };

let _trendChartUpdateLock = false;

window.DashboardCharts.hexToRgba = function (hex, alpha) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return `rgba(${parseInt(result[1], 16)}, ${parseInt(
      result[2],
      16
    )}, ${parseInt(result[3], 16)}, ${alpha})`;
  }
  return hex;
};

function isCanvasReady(canvas) {
  if (!canvas || !canvas.isConnected) return false;
  if (canvas.offsetWidth === 0 || canvas.offsetHeight === 0) return false;

  try {
    const ctx = canvas.getContext("2d");
    return !!ctx;
  } catch (e) {
    return false;
  }
}

window.DashboardCharts.createDataset = function (label, data, color, canvas) {
  let gradient;

  try {
    
    if (canvas && canvas.getContext) {
      const ctx = canvas.getContext("2d");
      if (ctx && ctx.createLinearGradient) {
        gradient = ctx.createLinearGradient(0, 0, 0, 200);
        gradient.addColorStop(0, window.DashboardCharts.hexToRgba(color, 0.12));
        gradient.addColorStop(
          0.6,
          window.DashboardCharts.hexToRgba(color, 0.05)
        );
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
      }
    }
  } catch (e) {
    if (window.UILogger) window.UILogger.debug("Gradient fallback:", e.message);
    gradient = null;
  }

  const backgroundColor =
    gradient || window.DashboardCharts.hexToRgba(color, 0.08);

  return {
    label,
    data,
    borderColor: color,
    backgroundColor: backgroundColor,
    borderWidth: 2.5,
    tension: 0.35,
    fill: true,
    pointRadius: 2.5,
    pointHoverRadius: 6,
    pointBackgroundColor: color,
    pointBorderColor: "rgba(9, 9, 11, 0.8)",
    pointBorderWidth: 1.5,
  };
};

window.DashboardCharts.updateCharts = function (component) {
  const canvas = document.getElementById("quotaChart");

  if (!canvas) {
    console.debug("quotaChart canvas not found");
    return;
  }

  if (canvas._chartInstance) {
    console.debug("Destroying existing quota chart from canvas property");
    try {
        canvas._chartInstance.destroy();
    } catch(e) { if (window.UILogger) window.UILogger.debug(e); }
    canvas._chartInstance = null;
  }

  if (component.charts.quotaDistribution) {
     try {
         component.charts.quotaDistribution.destroy();
     } catch(e) { }
     component.charts.quotaDistribution = null;
  }

  if (typeof Chart !== "undefined" && Chart.getChart) {
      const regChart = Chart.getChart(canvas);
      if (regChart) {
          try { regChart.destroy(); } catch(e) {}
      }
  }

  if (typeof Chart === "undefined") {
    if (window.UILogger) window.UILogger.warn("Chart.js not loaded");
    return;
  }
  if (!isCanvasReady(canvas)) {
    if (window.UILogger) window.UILogger.debug("quotaChart canvas not ready, skipping update");
    return;
  }

  const rows = Alpine.store("data").getUnfilteredQuotaData();
  if (!rows || rows.length === 0) return;

  const healthByFamily = {};
  let totalHealthSum = 0;
  let totalModelCount = 0;

  rows.forEach((row) => {
    const family = row.family || "unknown";
    if (!healthByFamily[family]) {
      healthByFamily[family] = { total: 0, weighted: 0 };
    }

    const quotaInfo = row.quotaInfo || [];
    let avgHealth = 0;

    if (quotaInfo.length > 0) {
      avgHealth = quotaInfo.reduce((sum, q) => sum + (q.pct || 0), 0) / quotaInfo.length;
    }

    healthByFamily[family].total++;
    healthByFamily[family].weighted += avgHealth;
    totalHealthSum += avgHealth;
    totalModelCount++;
  });

  component.stats.overallHealth = totalModelCount > 0
    ? Math.round(totalHealthSum / totalModelCount)
    : 0;

  const familyColors = {
    claude: getThemeColor("--color-neon-purple") || "#a855f7",
    gemini: getThemeColor("--color-neon-green") || "#22c55e",
    unknown: getThemeColor("--color-neon-cyan") || "#06b6d4",
  };

  const data = [];
  const colors = [];
  const labels = [];

  const totalFamilies = Object.keys(healthByFamily).length;
  const segmentSize = 100 / totalFamilies;

  Object.entries(healthByFamily).forEach(([family, { total, weighted }]) => {
    const health = weighted / total;
    const activeVal = (health / 100) * segmentSize;
    const inactiveVal = segmentSize - activeVal;

    const familyColor = familyColors[family] || familyColors["unknown"];

    const store = Alpine.store("global");
    const familyKey =
      "family" + family.charAt(0).toUpperCase() + family.slice(1);
    const familyName = store.t(familyKey);

    const activeLabel =
      family === "claude"
        ? store.t("claudeActive")
        : family === "gemini"
        ? store.t("geminiActive")
        : `${familyName} ${store.t("activeSuffix")}`;

    const depletedLabel =
      family === "claude"
        ? store.t("claudeEmpty")
        : family === "gemini"
        ? store.t("geminiEmpty")
        : `${familyName} ${store.t("depleted")}`;

    data.push(activeVal);
    colors.push(familyColor);
    labels.push(activeLabel);

    data.push(inactiveVal);
    
    colors.push(window.DashboardCharts.hexToRgba(familyColor, 0.6));
    labels.push(depletedLabel);
  });

  try {
    const newChart = new Chart(canvas, {
       
       type: "doughnut",
       data: {
         labels: labels,
         datasets: [
           {
             data: data,
             backgroundColor: colors,
             borderColor: getThemeColor("--color-space-950"),
             borderWidth: 0,
             hoverOffset: 0,
             borderRadius: 0,
           },
         ],
       },
       options: {
         responsive: true,
         maintainAspectRatio: false,
         cutout: "85%",
         rotation: -90,
         circumference: 360,
         plugins: {
           legend: { display: false },
           tooltip: { enabled: false },
           title: { display: false },
         },
         animation: {
           
           duration: 0
         },
       },
    });

    canvas._chartInstance = newChart;
    component.charts.quotaDistribution = newChart;

  } catch (e) {
    console.error("Failed to create quota chart:", e);
  }
};

window.DashboardCharts.updateTrendChart = function (component) {
  
  if (_trendChartUpdateLock) {
    if (window.UILogger) window.UILogger.debug("[updateTrendChart] Update already in progress, skipping");
    return;
  }
  _trendChartUpdateLock = true;

  const logger = window.UILogger || console;
  logger.debug("[updateTrendChart] Starting update...");

  const canvas = document.getElementById("usageTrendChart");

  if (canvas) {
      if (canvas._chartInstance) {
        console.debug("Destroying existing trend chart from canvas property");
        try {
            canvas._chartInstance.stop();
            canvas._chartInstance.destroy();
        } catch(e) { if (window.UILogger) window.UILogger.debug(e); }
        canvas._chartInstance = null;
      }

      if (typeof Chart !== "undefined" && Chart.getChart) {
          const regChart = Chart.getChart(canvas);
          if (regChart) {
              try { regChart.stop(); regChart.destroy(); } catch(e) {}
          }
      }
  }

  if (component.charts.usageTrend) {
    try {
      component.charts.usageTrend.stop();
      component.charts.usageTrend.destroy();
    } catch (e) { }
    component.charts.usageTrend = null;
  }

  if (!canvas) {
    if (window.UILogger) window.UILogger.debug("[updateTrendChart] Canvas not found in DOM");
    _trendChartUpdateLock = false;
    return;
  }
  if (typeof Chart === "undefined") {
    if (window.UILogger) window.UILogger.warn("[updateTrendChart] Chart.js not loaded");
    _trendChartUpdateLock = false;
    return;
  }

  if (window.UILogger) window.UILogger.debug("[updateTrendChart] Canvas element:", {
    exists: !!canvas,
    isConnected: canvas.isConnected,
    width: canvas.offsetWidth,
    height: canvas.offsetHeight,
    parentElement: canvas.parentElement?.tagName,
  });

  if (!isCanvasReady(canvas)) {
    if (window.UILogger) window.UILogger.debug("[updateTrendChart] Canvas not ready", {
      isConnected: canvas.isConnected,
      width: canvas.offsetWidth,
      height: canvas.offsetHeight,
    });
    _trendChartUpdateLock = false;
    return;
  }

  try {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  } catch (e) {
    if (window.UILogger) window.UILogger.debug("[updateTrendChart] Failed to clear canvas:", e.message);
  }

  if (window.UILogger) window.UILogger.debug(
    "[updateTrendChart] Canvas is ready, proceeding with chart creation"
  );

  const history = window.DashboardFilters.getFilteredHistoryData(component);
  if (!history || Object.keys(history).length === 0) {
    if (window.UILogger) window.UILogger.debug("No history data available for trend chart (after filtering)");
    component.hasFilteredTrendData = false;
    _trendChartUpdateLock = false;
    return;
  }

  component.hasFilteredTrendData = true;

  const sortedEntries = Object.entries(history).sort(
    ([a], [b]) => new Date(a).getTime() - new Date(b).getTime()
  );

  const timestamps = sortedEntries.map(([iso]) => new Date(iso));
  const isMultiDay = timestamps.length > 1 &&
    timestamps[0].toDateString() !== timestamps[timestamps.length - 1].toDateString();

  const formatLabel = (date) => {
    const timeRange = component.timeRange || '24h';

    if (timeRange === '7d') {
      
      return date.toLocaleDateString([], { month: '2-digit', day: '2-digit' });
    } else if (isMultiDay || timeRange === 'all') {
      
      return date.toLocaleDateString([], { month: '2-digit', day: '2-digit' }) + ' ' +
             date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  };

  const labels = [];
  const datasets = [];

  if (component.displayMode === "family") {
    
    const dataByFamily = {};
    component.selectedFamilies.forEach((family) => {
      dataByFamily[family] = [];
    });

    sortedEntries.forEach(([iso, hourData]) => {
      const date = new Date(iso);
      labels.push(formatLabel(date));

      component.selectedFamilies.forEach((family) => {
        const familyData = hourData[family];
        const count = familyData?._subtotal || 0;
        dataByFamily[family].push(count);
      });
    });

    component.selectedFamilies.forEach((family) => {
      const color = window.DashboardFilters.getFamilyColor(family);
      const familyKey =
        "family" + family.charAt(0).toUpperCase() + family.slice(1);
      const label = Alpine.store("global").t(familyKey);
      datasets.push(
        window.DashboardCharts.createDataset(
          label,
          dataByFamily[family],
          color,
          canvas
        )
      );
    });
  } else {
    
    const dataByModel = {};

    component.families.forEach((family) => {
      (component.selectedModels[family] || []).forEach((model) => {
        const key = `${family}:${model}`;
        dataByModel[key] = [];
      });
    });

    sortedEntries.forEach(([iso, hourData]) => {
      const date = new Date(iso);
      labels.push(formatLabel(date));

      component.families.forEach((family) => {
        const familyData = hourData[family] || {};
        (component.selectedModels[family] || []).forEach((model) => {
          const key = `${family}:${model}`;
          dataByModel[key].push(familyData[model] || 0);
        });
      });
    });

    component.families.forEach((family) => {
      (component.selectedModels[family] || []).forEach((model, modelIndex) => {
        const key = `${family}:${model}`;
        const color = window.DashboardFilters.getModelColor(family, modelIndex);
        datasets.push(
          window.DashboardCharts.createDataset(
            model,
            dataByModel[key],
            color,
            canvas
          )
        );
      });
    });
  }

  try {
    const newChart = new Chart(canvas, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 300, 
        },
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor:
              getThemeColor("--color-space-950") || "rgba(24, 24, 27, 0.9)",
            titleColor: getThemeColor("--color-text-main"),
            bodyColor: getThemeColor("--color-text-bright"),
            borderColor: getThemeColor("--color-space-border"),
            borderWidth: 1,
            padding: 10,
            displayColors: true,
            callbacks: {
              label: function (context) {
                return context.dataset.label + ": " + context.parsed.y;
              },
            },
          },
        },
        scales: {
          x: {
            display: true,
            grid: { display: false },
            ticks: {
              color: getThemeColor("--color-text-muted"),
              font: { size: 10 },
            },
          },
          y: {
            display: true,
            beginAtZero: true,
            grid: {
              display: true,
              color:
                getThemeColor("--color-space-border") + "1a" ||
                "rgba(255,255,255,0.05)",
            },
            ticks: {
              color: getThemeColor("--color-text-muted"),
              font: { size: 10 },
            },
          },
        },
      },
    });

    canvas._chartInstance = newChart;
    component.charts.usageTrend = newChart;

  } catch (e) {
    console.error("Failed to create trend chart:", e);
  } finally {
    
    _trendChartUpdateLock = false;
  }
};
