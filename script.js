
"use strict";

const SUPABASE_URL = "https://ipjosaqgsfcbcmbzgfto.supabase.co";
const SUPABASE_KEY = "sb_publishable_GQQ97Zug8ej20S15I5crOQ_GGhBjHrt";

if (!window.supabase) {
  alert("Не загрузилась библиотека Supabase. Проверь интернет и подключение в index.html.");
  throw new Error("Supabase library not loaded");
}

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const state = {
  user: null,
  families: [],
  activeFamily: null,
  relatives: [],
  memories: [],
  authMode: "login"
};

const $ = (id) => document.getElementById(id);

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showToast(message) {
  const toast = $("toast");

  if (!toast) {
    alert(message);
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 4500);
}

function showAuthMessage(message, success = false) {
  const element = $("authMessage");

  if (element) {
    element.textContent = message;
    element.style.color = success ? "#d6b36a" : "#ff9eaf";
  }
}

function errorMessage(error) {
  return error?.message || "Неизвестная ошибка.";
}

function requireFamily() {
  if (!state.activeFamily) {
    showToast("Сначала создай или выбери семью.");
    return false;
  }

  return true;
}

function showAuth() {
  if ($("authScreen")) $("authScreen").hidden = false;
  if ($("appContent")) $("appContent").hidden = true;
  if ($("logoutButton")) $("logoutButton").hidden = true;
}

function showApp(user) {
  state.user = user;

  if ($("authScreen")) $("authScreen").hidden = true;
  if ($("appContent")) $("appContent").hidden = false;
  if ($("logoutButton")) $("logoutButton").hidden = false;
  if ($("userLabel")) $("userLabel").textContent = user.email || "";

  loadFamilies();
}

function setAuthMode(mode) {
  state.authMode = mode;

  if ($("authSubmit")) {
    $("authSubmit").textContent =
      mode === "login" ? "Войти" : "Зарегистрироваться";
  }

  if ($("authSwitch")) {
    $("authSwitch").textContent =
      mode === "login"
        ? "Нет аккаунта? Зарегистрироваться"
        : "Уже есть аккаунт? Войти";
  }

  showAuthMessage("");
}

async function handleAuth(event) {
  event.preventDefault();

  const email = $("authEmail")?.value.trim();
  const password = $("authPassword")?.value;
  const button = $("authSubmit");

  if (!email || !password) {
    showAuthMessage("Заполни электронную почту и пароль.");
    return;
  }

  if (password.length < 6) {
    showAuthMessage("Пароль должен содержать минимум 6 символов.");
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Подожди...";
  }

  try {
    let result;

    if (state.authMode === "login") {
      result = await db.auth.signInWithPassword({ email, password });
    } else {
      result = await db.auth.signUp({ email, password });
    }

    if (result.error) {
      console.error("Auth error:", result.error);
      showAuthMessage(errorMessage(result.error));
      return;
    }

    if (result.data.session && result.data.user) {
      showApp(result.data.user);
      showAuthMessage("");
    } else {
      showAuthMessage(
        "Регистрация выполнена. Если требуется подтверждение почты, подтверди её по ссылке из письма, затем войди.",
        true
      );
    }
  } catch (error) {
    console.error(error);
    showAuthMessage("Ошибка подключения: " + errorMessage(error));
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent =
        state.authMode === "login" ? "Войти" : "Зарегистрироваться";
    }
  }
}

async function logout() {
  const { error } = await db.auth.signOut();

  if (error) {
    showToast("Не удалось выйти: " + errorMessage(error));
    return;
  }

  state.user = null;
  state.families = [];
  state.activeFamily = null;
  state.relatives = [];
  state.memories = [];

  showAuth();
  setAuthMode("login");
}

function showPage(pageId) {
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("active", page.id === pageId);
  });

  document.querySelectorAll("[data-page]").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === pageId);
  });

  const names = {
    relativesPage: "Родственники",
    treePage: "Семейное древо",
    memoriesPage: "Воспоминания",
    calendarPage: "Календарь"
  };

  if ($("pageTitle")) {
    $("pageTitle").textContent = names[pageId] || "Семейное пространство";
  }
}

/* =========================
   СЕМЬИ
========================= */

async function loadFamilies() {
  if (!state.user) return;

  const list = $("familyList");
  if (list) list.innerHTML = '<p class="empty">Загружаем семьи...</p>';

  const { data, error } = await db
    .from("families")
    .select("*")
    .eq("owner_id", state.user.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Load families:", error);

    if (list) {
      list.innerHTML =
        '<p class="message">Не удалось загрузить семьи: ' +
        escapeHTML(error.message) +
        "</p>";
    }

    showToast("Ошибка загрузки семей: " + error.message);
    return;
  }

  state.families = data || [];

  if (
    state.activeFamily &&
    !state.families.some((family) => family.id === state.activeFamily.id)
  ) {
    state.activeFamily = null;
  }

  if (!state.activeFamily && state.families.length) {
    state.activeFamily = state.families[0];
  }

  renderFamilies();
  updateStats();

  if (state.activeFamily) {
    await loadFamilyData();
  } else {
    state.relatives = [];
    state.memories = [];
    renderRelatives();
    renderTree();
    renderMemories();
    renderCalendar();
    updateStats();
  }
}

function renderFamilies() {
  const list = $("familyList");
  if (!list) return;

  if (!state.families.length) {
    list.innerHTML = '<p class="empty">Пока нет семей. Создай первую выше.</p>';
    if ($("activeFamily")) $("activeFamily").textContent = "Не выбрана";
    return;
  }

  list.innerHTML = state.families.map((family) => {
    const selected = state.activeFamily?.id === family.id;

    return `
      <div class="item">
        <div class="item-head">
          <div>
            <h3>${escapeHTML(family.name)}</h3>
            <p class="muted">${selected ? "Активная семья" : "Семейное пространство"}</p>
          </div>
          <div class="row">
            <button
              class="btn small ${selected ? "" : "secondary"}"
              type="button"
              data-action="select-family"
              data-id="${escapeHTML(family.id)}"
            >${selected ? "Выбрана" : "Открыть"}</button>
            <button
              class="btn danger small"
              type="button"
              data-action="delete-family"
              data-id="${escapeHTML(family.id)}"
            >Удалить</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  if ($("activeFamily")) {
    $("activeFamily").textContent = state.activeFamily?.name || "Не выбрана";
  }
}

async function createFamily(event) {
  event.preventDefault();

  if (!state.user) {
    showToast("Сначала войди в аккаунт.");
    return;
  }

  const input = $("familyName");
  const button = $("createFamilyButton");
  const name = input?.value.trim();

  if (!name) {
    showToast("Введи название семьи.");
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Создаём...";
  }

  try {
    const { data, error } = await db
      .from("families")
      .insert({
        name,
        owner_id: state.user.id
      })
      .select("*")
      .single();

    if (error) {
      console.error("Create family:", error);
      showToast("Не удалось создать семью: " + error.message);
      return;
    }

    if (!data) {
      showToast("База данных не вернула созданную семью.");
      return;
    }

    input.value = "";
    state.activeFamily = data;

    showToast("Семья создана!");
    await loadFamilies();
  } catch (error) {
    console.error(error);
    showToast("Ошибка: " + errorMessage(error));
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "+ Создать семью";
    }
  }
}

async function selectFamily(id) {
  const family = state.families.find((item) => String(item.id) === String(id));

  if (!family) {
    showToast("Семья не найдена.");
    return;
  }

  state.activeFamily = family;
  renderFamilies();
  await loadFamilyData();
}

async function deleteFamily(id) {
  const family = state.families.find((item) => String(item.id) === String(id));
  if (!family) return;

  const confirmed = confirm(
    `Удалить семью «${family.name}» и её родственников и воспоминания? Это действие нельзя отменить.`
  );

  if (!confirmed) return;

  /*
    Удаляем дочерние записи перед семьёй, чтобы не нарушить
    внешние ключи. Если политика доступа запрещает удаление,
    операция остановится и покажет ошибку.
  */

  try {
    for (const table of ["family_relatives", "family_memories", "family_members"]) {
      const { error } = await db
        .from(table)
        .delete()
        .eq("family_id", family.id);

      if (error) {
        console.error(`Delete from ${table}:`, error);
        showToast(
          `Не удалось удалить данные из ${table}: ${error.message}. Проверь RLS-политики.`
        );
        return;
      }
    }

    const { data, error } = await db
      .from("families")
      .delete()
      .eq("id", family.id)
      .eq("owner_id", state.user.id)
      .select("id");

    if (error) {
      console.error("Delete family:", error);
      showToast("Не удалось удалить семью: " + error.message);
      return;
    }

    if (!data?.length) {
      showToast("Семья не удалена. Проверь права доступа в Supabase.");
      return;
    }

    if (state.activeFamily?.id === family.id) {
      state.activeFamily = null;
    }

    showToast("Семья удалена.");
    await loadFamilies();
  } catch (error) {
    console.error(error);
    showToast("Ошибка удаления: " + errorMessage(error));
  }
}

/* =========================
   ДАННЫЕ АКТИВНОЙ СЕМЬИ
========================= */

async function loadFamilyData() {
  if (!state.activeFamily) return;

  const familyId = state.activeFamily.id;

  const [relativesResult, memoriesResult] = await Promise.all([
    db.from("family_relatives")
      .select("*")
      .eq("family_id", familyId)
      .order("created_at", { ascending: true }),

    db.from("family_memories")
      .select("*")
      .eq("family_id", familyId)
      .order("created_at", { ascending: false })
  ]);

  if (relativesResult.error) {
    console.error("Load relatives:", relativesResult.error);
    showToast("Не удалось загрузить родственников: " + relativesResult.error.message);
  }

  if (memoriesResult.error) {
    console.error("Load memories:", memoriesResult.error);
    showToast("Не удалось загрузить воспоминания: " + memoriesResult.error.message);
  }

  state.relatives = relativesResult.data || [];
  state.memories = memoriesResult.data || [];

  renderFamilies();
  renderRelatives();
  renderTree();
  renderMemories();
  renderCalendar();
  updateStats();
}

function updateStats() {
  if ($("statFamilies")) $("statFamilies").textContent = state.families.length;
  if ($("statRelatives")) $("statRelatives").textContent = state.relatives.length;
  if ($("statMemories")) $("statMemories").textContent = state.memories.length;
}

/* =========================
   РОДСТВЕННИКИ И ДРЕВО
========================= */

function renderRelatives() {
  const list = $("relativesList");
  if (!list) return;

  if (!state.activeFamily) {
    list.innerHTML = '<p class="empty">Сначала создай или выбери семью.</p>';
    return;
  }

  if (!state.relatives.length) {
    list.innerHTML = '<p class="empty">Пока нет родственников. Добавь первого выше.</p>';
    return;
  }

  list.innerHTML = state.relatives.map((person) => `
    <div class="item">
      <div class="item-head">
        <div>
          <h3>${escapeHTML(person.name)}</h3>
          <p class="muted">${escapeHTML(person.relationship || "Родственник")}</p>
          ${person.birth_date ? `<p class="muted">Дата рождения: ${escapeHTML(person.birth_date)}</p>` : ""}
        </div>
        <button
          class="btn danger small"
          type="button"
          data-action="delete-relative"
          data-id="${escapeHTML(person.id)}"
        >Удалить</button>
      </div>
    </div>
  `).join("");
}

function renderTree() {
  const tree = $("treeContainer");
  if (!tree) return;

  if (!state.activeFamily) {
    tree.innerHTML = '<p class="empty">Сначала выбери семью.</p>';
    return;
  }

  if (!state.relatives.length) {
    tree.innerHTML = '<p class="empty">Добавь родственников, и они появятся здесь.</p>';
    return;
  }

  tree.innerHTML = `
    <div class="tree-level">
      <div class="tree-card">
        <strong>${escapeHTML(state.activeFamily.name)}</strong>
        <span>Семья</span>
      </div>
    </div>
    <div class="tree-level">
      ${state.relatives.map((person) => `
        <div class="tree-card">
          <strong>${escapeHTML(person.name)}</strong>
          <span>${escapeHTML(person.relationship || "Родственник")}</span>
          ${person.birth_date ? `<p class="muted">${escapeHTML(person.birth_date)}</p>` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

async function addRelative(event) {
  event.preventDefault();
  if (!requireFamily()) return;

  const name = $("relativeName")?.value.trim();
  const relationship = $("relativeRelationship")?.value.trim();
  const birthDate = $("relativeBirthDate")?.value || null;

  if (!name || !relationship) {
    showToast("Введи имя и степень родства.");
    return;
  }

  const button = $("relativeForm")?.querySelector('button[type="submit"]');
  if (button) button.disabled = true;

  try {
    const { error } = await db.from("family_relatives").insert({
      family_id: state.activeFamily.id,
      name,
      relationship,
      birth_date: birthDate
    });

    if (error) {
      console.error("Add relative:", error);
      showToast("Не удалось добавить родственника: " + error.message);
      return;
    }

    $("relativeForm").reset();
    showToast("Родственник добавлен.");
    await loadFamilyData();
  } catch (error) {
    console.error(error);
    showToast("Ошибка: " + errorMessage(error));
  } finally {
    if (button) button.disabled = false;
  }
}

async function deleteRelative(id) {
  if (!requireFamily()) return;
  if (!confirm("Удалить этого родственника?")) return;

  const { data, error } = await db
    .from("family_relatives")
    .delete()
    .eq("id", id)
    .eq("family_id", state.activeFamily.id)
    .select("id");

  if (error) {
    console.error("Delete relative:", error);
    showToast("Не удалось удалить родственника: " + error.message);
    return;
  }

  if (!data?.length) {
    showToast("Родственник не удалён. Проверь права доступа.");
    return;
  }

  showToast("Родственник удалён.");
  await loadFamilyData();
}

/* =========================
   ВОСПОМИНАНИЯ
========================= */

function safePhotoURL(value) {
  if (!value) return "";

  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return url.href;
    }
  } catch (_) {}

  return "";
}

function renderMemories() {
  const grid = $("memoryGrid");
  if (!grid) return;

  if (!state.activeFamily) {
    grid.innerHTML = '<p class="empty">Сначала выбери семью.</p>';
    return;
  }

  if (!state.memories.length) {
    grid.innerHTML = '<p class="empty">Пока нет воспоминаний. Сохрани свою первую историю выше.</p>';
    return;
  }

  grid.innerHTML = state.memories.map((memory) => {
    const photo = safePhotoURL(memory.photo_url);

    return `
      <article class="item">
        <div class="item-head">
          <h3>${escapeHTML(memory.title)}</h3>
          <button
            class="btn danger small"
            type="button"
            data-action="delete-memory"
            data-id="${escapeHTML(memory.id)}"
          >Удалить</button>
        </div>
        <p>${escapeHTML(memory.content || "")}</p>
        ${photo ? `
          <img
            class="memory-image"
            src="${escapeHTML(photo)}"
            alt="Фотография к воспоминанию"
            loading="lazy"
            onerror="this.hidden=true"
          >
        ` : ""}
      </article>
    `;
  }).join("");
}

async function addMemory(event) {
  event.preventDefault();
  if (!requireFamily()) return;

  const title = $("memoryTitle")?.value.trim();
  const content = $("memoryContent")?.value.trim() || "";
  const rawPhoto = $("memoryPhoto")?.value.trim() || "";
  const photoURL = safePhotoURL(rawPhoto);

  if (!title) {
    showToast("Введи название воспоминания.");
    return;
  }

  if (rawPhoto && !photoURL) {
    showToast("Ссылка на фото должна начинаться с http:// или https://.");
    return;
  }

  const button = $("memoryForm")?.querySelector('button[type="submit"]');
  if (button) button.disabled = true;

  try {
    const { error } = await db.from("family_memories").insert({
      family_id: state.activeFamily.id,
      title,
      content,
      photo_url: photoURL || null,
      created_by: state.user.id
    });

    if (error) {
      console.error("Add memory:", error);
      showToast("Не удалось сохранить воспоминание: " + error.message);
      return;
    }

    $("memoryForm").reset();
    showToast("Воспоминание сохранено.");
    await loadFamilyData();
  } catch (error) {
    console.error(error);
    showToast("Ошибка: " + errorMessage(error));
  } finally {
    if (button) button.disabled = false;
  }
}

async function deleteMemory(id) {
  if (!requireFamily()) return;
  if (!confirm("Удалить это воспоминание?")) return;

  const { data, error } = await db
    .from("family_memories")
    .delete()
    .eq("id", id)
    .eq("family_id", state.activeFamily.id)
    .select("id");

  if (error) {
    console.error("Delete memory:", error);
    showToast("Не удалось удалить воспоминание: " + error.message);
    return;
  }

  if (!data?.length) {
    showToast("Воспоминание не удалено. Проверь права доступа.");
    return;
  }

  showToast("Воспоминание удалено.");
  await loadFamilyData();
}

/* =========================
   КАЛЕНДАРЬ
   События хранятся в localStorage браузера
========================= */

function eventStorageKey() {
  if (!state.user || !state.activeFamily) return null;

  return `family-universe-events-${state.user.id}-${state.activeFamily.id}`;
}

function getLocalEvents() {
  const key = eventStorageKey();
  if (!key) return [];

  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch (error) {
    console.error("Read calendar:", error);
    return [];
  }
}

function saveLocalEvents(events) {
  const key = eventStorageKey();
  if (!key) return false;

  try {
    localStorage.setItem(key, JSON.stringify(events));
    return true;
  } catch (error) {
    console.error("Save calendar:", error);
    showToast("Браузер не смог сохранить событие.");
    return false;
  }
}

function formatDateTime(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function renderCalendar() {
  const list = $("eventList");
  if (!list) return;

  if (!state.activeFamily) {
    list.innerHTML = '<p class="empty">Сначала выбери семью.</p>';
    return;
  }

  const events = getLocalEvents().sort((a, b) => a.date.localeCompare(b.date));

  if (!events.length) {
    list.innerHTML = '<p class="empty">Пока нет событий. Добавь первое выше.</p>';
    return;
  }

  list.innerHTML = events.map((item) => `
    <div class="item">
      <div class="item-head">
        <div>
          <h3>${escapeHTML(item.title)}</h3>
          <p class="muted">${escapeHTML(formatDateTime(item.date))}</p>
        </div>
        <button
          class="btn danger small"
          type="button"
          data-action="delete-event"
          data-id="${escapeHTML(item.id)}"
        >Удалить</button>
      </div>
      ${item.description ? `<p>${escapeHTML(item.description)}</p>` : ""}
    </div>
  `).join("");
}

function addEvent(event) {
  event.preventDefault();
  if (!requireFamily()) return;

  const title = $("eventTitle")?.value.trim();
  const date = $("eventDate")?.value;
  const description = $("eventDescription")?.value.trim() || "";

  if (!title || !date) {
    showToast("Заполни название и дату события.");
    return;
  }

  const events = getLocalEvents();

  events.push({
    id: crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
    title,
    date,
    description
  });

  if (!saveLocalEvents(events)) return;

  $("eventForm").reset();
  showToast("Событие добавлено.");
  renderCalendar();
}

function deleteEvent(id) {
  if (!confirm("Удалить это событие?")) return;

  const events = getLocalEvents();
  const updated = events.filter((item) => String(item.id) !== String(id));

  if (updated.length === events.length) {
    showToast("Событие не найдено.");
    return;
  }

  if (!saveLocalEvents(updated)) return;

  showToast("Событие удалено.");
  renderCalendar();
}

/* =========================
   ОБРАБОТЧИКИ КНОПОК
========================= */

function bindEvents() {
  $("authForm")?.addEventListener("submit", handleAuth);

  $("authSwitch")?.addEventListener("click", () => {
    setAuthMode(state.authMode === "login" ? "signup" : "login");
  });

  $("logoutButton")?.addEventListener("click", logout);
  $("familyForm")?.addEventListener("submit", createFamily);
  $("relativeForm")?.addEventListener("submit", addRelative);
  $("memoryForm")?.addEventListener("submit", addMemory);
  $("eventForm")?.addEventListener("submit", addEvent);

  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.page));
  });

  $("familyList")?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const id = button.dataset.id;

    if (button.dataset.action === "select-family") {
      await selectFamily(id);
    }

    if (button.dataset.action === "delete-family") {
      await deleteFamily(id);
    }
  });

  $("relativesList")?.addEventListener("click", async (event) => {
    const button = event.target.closest('button[data-action="delete-relative"]');
    if (button) await deleteRelative(button.dataset.id);
  });

  $("memoryGrid")?.addEventListener("click", async (event) => {
    const button = event.target.closest('button[data-action="delete-memory"]');
    if (button) await deleteMemory(button.dataset.id);
  });

  $("eventList")?.addEventListener("click", (event) => {
    const button = event.target.closest('button[data-action="delete-event"]');
    if (button) deleteEvent(button.dataset.id);
  });
}

/* =========================
   ЗАПУСК ПРИЛОЖЕНИЯ
========================= */

async function init() {
  bindEvents();
  showAuth();

  const { data, error } = await db.auth.getSession();

  if (error) {
    console.error("Session error:", error);
    showAuthMessage("Не удалось проверить сессию: " + error.message);
    return;
  }

  if (data.session?.user) {
    showApp(data.session.user);
  } else {
    setAuthMode("login");
  }

  db.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session?.user) {
      showApp(session.user);
    }

    if (event === "SIGNED_OUT") {
      state.user = null;
      state.families = [];
      state.activeFamily = null;
      state.relatives = [];
      state.memories = [];
      showAuth();
    }
  });
}

document.addEventListener("DOMContentLoaded", init);


if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        "./service-worker.js"
      );

      console.log(
        "Семейная вселенная PRO: service worker подключён",
        registration.scope
      );
    } catch (error) {
      console.error("Ошибка подключения service worker:", error);
    }
  });
}








