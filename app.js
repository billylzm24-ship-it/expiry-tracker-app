const STORAGE_KEY = "expiry-tracker-products-v1";
const NOTIFIED_KEY = "expiry-tracker-notified-v1";
const DAILY_FRESH_THRESHOLD_DAYS = 30;
const REMINDER_STAGES = [
  { id: "3m", label: "3 months", days: 90 },
  { id: "2m", label: "2 months", days: 60 },
  { id: "1m", label: "1 month", days: 30 },
  { id: "2w", label: "2 weeks", days: 14 },
  { id: "1w", label: "1 week", days: 7 }
];

const els = {
  form: document.querySelector("#productForm"),
  editingId: document.querySelector("#editingId"),
  productName: document.querySelector("#productName"),
  purchaseDate: document.querySelector("#purchaseDate"),
  expiryDate: document.querySelector("#expiryDate"),
  productionDate: document.querySelector("#productionDate"),
  notes: document.querySelector("#notes"),
  submitBtn: document.querySelector("#submitBtn"),
  resetFormBtn: document.querySelector("#resetFormBtn"),
  productList: document.querySelector("#productList"),
  template: document.querySelector("#productTemplate"),
  emptyState: document.querySelector("#emptyState"),
  searchInput: document.querySelector("#searchInput"),
  filterSelect: document.querySelector("#filterSelect"),
  urgentCount: document.querySelector("#urgentCount"),
  soonCount: document.querySelector("#soonCount"),
  totalCount: document.querySelector("#totalCount"),
  enableNotificationsBtn: document.querySelector("#enableNotificationsBtn"),
  notificationNotice: document.querySelector("#notificationNotice"),
  exportCalendarBtn: document.querySelector("#exportCalendarBtn"),
  exportJsonBtn: document.querySelector("#exportJsonBtn"),
  importJsonInput: document.querySelector("#importJsonInput"),
  installBtn: document.querySelector("#installBtn")
};

let products = loadProducts();
let deferredInstallPrompt = null;

init();

function init() {
  const today = toDateInput(new Date());
  els.purchaseDate.value = today;
  els.expiryDate.min = today;

  els.form.addEventListener("submit", saveProduct);
  els.resetFormBtn.addEventListener("click", resetForm);
  els.searchInput.addEventListener("input", render);
  els.filterSelect.addEventListener("change", render);
  els.enableNotificationsBtn.addEventListener("click", enableNotifications);
  els.exportCalendarBtn.addEventListener("click", exportCalendar);
  els.exportJsonBtn.addEventListener("click", exportJson);
  els.importJsonInput.addEventListener("change", importJson);
  els.installBtn.addEventListener("click", installApp);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    els.installBtn.hidden = false;
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  updateNotificationUi();
  render();
  checkDueNotifications();
}

function loadProducts() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
}

function saveProduct(event) {
  event.preventDefault();

  const product = {
    id: els.editingId.value || crypto.randomUUID(),
    name: els.productName.value.trim(),
    purchaseDate: els.purchaseDate.value,
    expiryDate: els.expiryDate.value,
    productionDate: els.productionDate.value,
    notes: els.notes.value.trim(),
    updatedAt: new Date().toISOString()
  };

  if (!product.name || !product.purchaseDate || !product.expiryDate) {
    alert("Please fill in product name, purchase date, and expiry date.");
    return;
  }

  if (product.expiryDate < product.purchaseDate) {
    alert("Expiry date cannot be earlier than the date of purchase.");
    return;
  }

  if (product.productionDate && product.productionDate > product.purchaseDate) {
    alert("Production date should not be later than the purchase date.");
    return;
  }

  const existingIndex = products.findIndex((item) => item.id === product.id);
  if (existingIndex >= 0) {
    products[existingIndex] = { ...products[existingIndex], ...product };
  } else {
    products.push({ ...product, createdAt: new Date().toISOString() });
  }

  persist();
  resetForm();
  render();
  checkDueNotifications();
}

function resetForm() {
  els.form.reset();
  els.purchaseDate.value = toDateInput(new Date());
  els.editingId.value = "";
  els.submitBtn.textContent = "Save product";
}

function render() {
  const query = els.searchInput.value.trim().toLowerCase();
  const filter = els.filterSelect.value;

  const sorted = [...products].sort((a, b) => daysUntil(a.expiryDate) - daysUntil(b.expiryDate));
  const visible = sorted.filter((product) => {
    const status = getStatus(product.expiryDate);
    const matchesSearch = product.name.toLowerCase().includes(query);
    const matchesFilter =
      filter === "all" ||
      status.key === filter ||
      (filter === "soon" && daysUntil(product.expiryDate) <= 90 && daysUntil(product.expiryDate) >= 0);
    return matchesSearch && matchesFilter;
  });

  els.productList.innerHTML = "";
  visible.forEach((product) => {
    els.productList.appendChild(renderProduct(product));
  });

  els.emptyState.hidden = products.length > 0;
  updateSummary();
}

function renderProduct(product) {
  const card = els.template.content.firstElementChild.cloneNode(true);
  const status = getStatus(product.expiryDate);
  card.classList.add(status.key);
  card.querySelector("h3").textContent = product.name;
  card.querySelector(".date-line").textContent = [
    `Purchased ${formatDate(product.purchaseDate)}`,
    `Expires ${formatDate(product.expiryDate)}`,
    product.productionDate ? `Produced ${formatDate(product.productionDate)}` : ""
  ].filter(Boolean).join(" • ");

  const notes = card.querySelector(".notes-line");
  notes.textContent = product.notes || "";
  notes.hidden = !product.notes;

  const pill = card.querySelector(".status-pill");
  pill.textContent = status.label;
  pill.classList.add(status.key);

  const strip = card.querySelector(".reminder-strip");
  if (isFreshShortLifeProduct(product)) {
    const chip = document.createElement("span");
    chip.className = "reminder-chip active";
    chip.textContent = "Daily countdown";
    strip.appendChild(chip);
  }
  REMINDER_STAGES.forEach((stage) => {
    const chip = document.createElement("span");
    const remaining = daysUntil(product.expiryDate);
    chip.className = "reminder-chip";
    chip.textContent = stage.label;
    if (remaining <= stage.days && remaining >= 0) chip.classList.add("active");
    if (remaining < 0) chip.classList.add("passed");
    strip.appendChild(chip);
  });

  card.querySelector(".edit-btn").addEventListener("click", () => editProduct(product.id));
  card.querySelector(".delete-btn").addEventListener("click", () => deleteProduct(product.id));
  return card;
}

function editProduct(id) {
  const product = products.find((item) => item.id === id);
  if (!product) return;
  els.editingId.value = product.id;
  els.productName.value = product.name;
  els.purchaseDate.value = product.purchaseDate;
  els.expiryDate.value = product.expiryDate;
  els.productionDate.value = product.productionDate || "";
  els.notes.value = product.notes || "";
  els.submitBtn.textContent = "Update product";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function deleteProduct(id) {
  const product = products.find((item) => item.id === id);
  if (!product || !confirm(`Delete ${product.name}?`)) return;
  products = products.filter((item) => item.id !== id);
  persist();
  render();
}

function updateSummary() {
  const urgent = products.filter((product) => {
    const days = daysUntil(product.expiryDate);
    return days >= 0 && days <= 14;
  }).length;
  const soon = products.filter((product) => {
    const days = daysUntil(product.expiryDate);
    return days >= 0 && days <= 90;
  }).length;
  els.urgentCount.textContent = urgent;
  els.soonCount.textContent = soon;
  els.totalCount.textContent = products.length;
}

function getStatus(expiryDate) {
  const days = daysUntil(expiryDate);
  if (days < 0) return { key: "expired", label: `Expired ${Math.abs(days)}d ago` };
  if (days === 0) return { key: "urgent", label: "Expires today" };
  if (days <= 14) return { key: "urgent", label: `${days}d left` };
  if (days <= 90) return { key: "soon", label: `${days}d left` };
  return { key: "safe", label: `${days}d left` };
}

function daysUntil(dateString) {
  const today = startOfDay(new Date());
  const date = startOfDay(fromDateInput(dateString));
  return Math.ceil((date - today) / 86400000);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function fromDateInput(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateInput(date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
}

function formatDate(value) {
  return fromDateInput(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    alert("This browser does not support notifications.");
    return;
  }
  const permission = await Notification.requestPermission();
  updateNotificationUi();
  if (permission === "granted") {
    checkDueNotifications(true);
  }
}

function updateNotificationUi() {
  if (!("Notification" in window)) {
    els.enableNotificationsBtn.textContent = "Unavailable";
    els.enableNotificationsBtn.disabled = true;
    return;
  }
  if (Notification.permission === "granted") {
    els.enableNotificationsBtn.textContent = "Enabled";
    els.enableNotificationsBtn.disabled = true;
  } else if (Notification.permission === "denied") {
    els.enableNotificationsBtn.textContent = "Blocked";
    els.enableNotificationsBtn.disabled = true;
  }
}

function checkDueNotifications(force = false) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const notified = loadNotified();
  const due = [];
  products.forEach((product) => {
    const remaining = daysUntil(product.expiryDate);
    if (isFreshShortLifeProduct(product) && remaining >= 0) {
      const todayKey = toDateInput(new Date());
      const key = `${product.id}:daily:${product.expiryDate}:${todayKey}`;
      if (!notified[key] || force) {
        due.push({
          product,
          stage: {
            id: "daily",
            label: formatRemainingDays(remaining),
            daily: true
          }
        });
        notified[key] = new Date().toISOString();
      }
    }
    REMINDER_STAGES.forEach((stage) => {
      const key = `${product.id}:${stage.id}:${product.expiryDate}`;
      if ((remaining === stage.days || (force && remaining <= stage.days && remaining >= 0)) && !notified[key]) {
        due.push({ product, stage });
        notified[key] = new Date().toISOString();
      }
    });
  });

  if (due.length > 0) {
    const title = due.length === 1 ? "Expiry reminder" : `${due.length} expiry reminders`;
    const body = due.slice(0, 4).map(({ product, stage }) => {
      if (stage.daily) return `${product.name}: ${stage.label}`;
      return `${product.name}: ${stage.label} left`;
    }).join("\n");
    new Notification(title, { body, tag: `expiry-${toDateInput(new Date())}` });
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(notified));
  }
}

function loadNotified() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_KEY)) || {};
  } catch {
    return {};
  }
}

function exportCalendar() {
  if (products.length === 0) {
    alert("Add at least one product before exporting calendar reminders.");
    return;
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Expiry Tracker//Personal Reminders//EN",
    "CALSCALE:GREGORIAN"
  ];

  products.forEach((product) => {
    if (isFreshShortLifeProduct(product)) {
      const today = startOfDay(new Date());
      const expiry = fromDateInput(product.expiryDate);
      const start = fromDateInput(product.purchaseDate) > today ? fromDateInput(product.purchaseDate) : today;
      for (let day = start; day <= expiry; day = addDays(day, 1)) {
        const remaining = Math.ceil((startOfDay(expiry) - startOfDay(day)) / 86400000);
        addCalendarEvent(
          lines,
          `${product.id}-daily-${toIcsDay(day)}`,
          day,
          `${product.name}: ${formatRemainingDays(remaining)}`,
          `Daily fresh product reminder. Expiry date: ${formatDate(product.expiryDate)}`
        );
      }
      return;
    }

    REMINDER_STAGES.forEach((stage) => {
      const reminderDate = addDays(fromDateInput(product.expiryDate), -stage.days);
      if (reminderDate < startOfDay(new Date())) return;
      addCalendarEvent(
        lines,
        `${product.id}-${stage.id}`,
        reminderDate,
        `${product.name} expires in ${stage.label}`,
        `Expiry date: ${formatDate(product.expiryDate)}`
      );
    });
  });

  lines.push("END:VCALENDAR");
  downloadFile("expiry-reminders.ics", lines.join("\r\n"), "text/calendar");
}

function exportJson() {
  downloadFile(
    `expiry-tracker-backup-${toDateInput(new Date())}.json`,
    JSON.stringify({ version: 1, products }, null, 2),
    "application/json"
  );
}

function importJson(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      const imported = Array.isArray(payload) ? payload : payload.products;
      if (!Array.isArray(imported)) throw new Error("Invalid file");
      products = imported.filter((item) => item.name && item.purchaseDate && item.expiryDate);
      persist();
      render();
      alert(`Restored ${products.length} products.`);
    } catch {
      alert("Could not restore this backup file.");
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function daysBetween(startDateString, endDateString) {
  const start = startOfDay(fromDateInput(startDateString));
  const end = startOfDay(fromDateInput(endDateString));
  return Math.ceil((end - start) / 86400000);
}

function isFreshShortLifeProduct(product) {
  return daysBetween(product.purchaseDate, product.expiryDate) < DAILY_FRESH_THRESHOLD_DAYS;
}

function formatRemainingDays(days) {
  if (days === 0) return "expires today";
  if (days === 1) return "1 day remaining";
  return `${days} days remaining`;
}

function addCalendarEvent(lines, uid, date, summary, description) {
  const stamp = toIcsDate(new Date());
  const day = toIcsDay(date);
  lines.push(
    "BEGIN:VEVENT",
    `UID:${uid}@expiry-tracker`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${day}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    "BEGIN:VALARM",
    "TRIGGER:PT9H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcs(summary)}`,
    "END:VALARM",
    "END:VEVENT"
  );
}

function toIcsDate(date) {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function toIcsDay(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function escapeIcs(text) {
  return String(text).replace(/[\\,;]/g, "\\$&").replace(/\n/g, "\\n");
}

async function installApp() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  els.installBtn.hidden = true;
}
