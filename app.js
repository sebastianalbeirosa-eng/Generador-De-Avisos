/* ==========================================================================
   AVISO EN LÍNEA · app.js
   App estática (HTML + CSS + JS).
   Sin servidor ni base de datos: los avisos se guardan en el dispositivo
   (localStorage para datos + IndexedDB para fotos) y se comparten por
   WhatsApp o con un link de importación.
   ========================================================================== */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* 1. CONSTANTES                                                       */
  /* ------------------------------------------------------------------ */

  var LS_KEY = "prensaalerta.v1";
  var LS_OPERATOR = "prensaalerta.operario";
  var SS_SESSION = "prensaalerta.session";
  var DB_NAME = "prensaalerta";
  var DB_STORE = "fotos";
  var VERSION = 1;
  var SESSION_HOURS = 8;
  var MAX_PHOTOS = 2;

  var TYPES = {
    mantenimiento: {
      label: "Mantenimiento", short: "Mantenimiento", icon: "mant",
      desc: "Pérdidas de aceite, fugas, ruidos, fallas de equipos o frenos.",
      wa: "mantenimiento"
    },
    "5s": {
      label: "5S / Orden", short: "5S", icon: "5s",
      desc: "Polvo, desorden, pérdidas de material, limpieza y estándares.",
      wa: "5s"
    },
    seguridad: {
      label: "Seguridad", short: "Seguridad", icon: "seg",
      desc: "Riesgos de accidente, peldaños dañados, resguardos, señalización.",
      wa: "seguridad"
    }
  };

  var SEVERITIES = {
    baja: { label: "Baja", sla: 72, color: "#94a3b8", desc: "Se puede planificar" },
    media: { label: "Media", sla: 48, color: "#0ea5e9", desc: "Afecta el orden" },
    alta: { label: "Alta", sla: 24, color: "#f59e0b", desc: "Puede frenar la línea" },
    critica: { label: "Crítica", sla: 8, color: "#dc2626", desc: "Riesgo de parada / atender urgente" }
  };

  var STATUSES = {
    abierto: { label: "Abierto", cls: "b-abierto" },
    en_proceso: { label: "En proceso", cls: "b-proceso" },
    resuelto: { label: "Resuelto", cls: "b-resuelto" },
    cerrado: { label: "Cerrado", cls: "b-cerrado" }
  };
  var STATUS_ORDER = ["abierto", "en_proceso", "resuelto", "cerrado"];

  var ROLES = {
    admin: { label: "Administrador", desc: "Todo + configuración", types: "all" },
    mantenimiento: { label: "Mantenimiento", desc: "Cierra avisos de mantenimiento", types: ["mantenimiento"] },
    produccion: { label: "Producción", desc: "Cierra avisos de 5S / orden", types: ["5s"] },
    seguridad: { label: "Seguridad", desc: "Cierra avisos de seguridad", types: ["seguridad"] }
  };
  var ROLE_ORDER = ["admin", "mantenimiento", "produccion", "seguridad"];

  var SECTORS = [
    "Prensas y Secaderos", "Preparación de Esmaltes / Moliendas", "Esmaltado / Decorado", "Hornos y Selección", "Mantenimiento / Matricería", "Calidad / Laboratorio",
    "Logística / Almacén", "Seguridad e higiene", "Servicios generales", "Otro"
  ];

  var SHIFTS = ["Turno Mañana", "Turno Tarde", "Turno Noche", "Turno Central"];

  var TAGS = [
    "Pérdida de aceite", "Fuga de agua", "Pérdida de polvo", "Ruido anormal", "Vibración",
    "Fuga de aire comprimido", "Peldaño / escalón dañado", "Falta de señalización",
    "Resguardo fuera de lugar", "Cable expuesto", "Derrame / mancha", "Equipo fuera de servicio"
  ];

  var EQUIPMENT_GROUPS = [
    {
      group: "Prensas y Secaderos",
      items: ["Prensa 1", "Prensa 2", "Prensa 3", "Prensa 4", "Prensa 5", "Secadero 1", "Secadero 2",
        "Puente de prensas", "Tolvas de Polvo / Prensas", "Estación de cambio de moldes"]
    },
    {
      group: "Preparación de Esmaltes / Moliendas",
      items: ["Compostage", "Molinos Esmalte", "Piletas de Esmalte", "Molienda Húmeda", "Molienda Seca", "Molinos de Polvo", "Atomizadores", "Silos de polvo atomizado", "Cintas transportadoras de Polvo"]
    },
    {
      group: "Esmaltado / Decorado",
      items: ["Línea de esmaltado 1", "Línea de esmaltado 2", "Impresoras / Decoradoras", "Maxi SIMA / SITI", "Entrada de Hornos"]
    },
    {
      group: "Hornos y Selección",
      items: ["Horno 1", "Horno 2", "QNG / Clasificadores", "Líneas de clasificación", "Apiladoras automáticas", "Encartonadoras", "Robot paletizador", "OMS / Flejadora Automática"]
    },
    {
      group: "Mantenimiento / Matricería",
      items: ["Taller mecánico", "Taller eléctrico", "Área de matricería", "Banco de prueba", "Soldadura", "Depósito de aceite hidráulico"]
    },
    {
      group: "Calidad / Laboratorio",
      items: ["Laboratorio de barbotinas", "Laboratorio de esmaltes", "Mesa de rotura y flexión", "Control dimensional / Calibres"]
    },
    {
      group: "Logística / Almacén",
      items: ["Depósito de producto terminado", "Playa de carga y despacho", "Almacén de repuestos e insumos", "Zorra / Autoelevador"]
    },
    {
      group: "Seguridad e higiene",
      items: ["Pasarelas y accesos", "Salidas de emergencia", "Puntos de hidratación", "Estaciones de lavaojos / primeros auxilios", "Señalización y matafuegos"]
    },
    {
      group: "Servicios generales",
      items: ["Sala de compresores", "Subestación eléctrica", "Tratamiento y recuperación de agua", "Pasillos y accesos", "Taller de mantenimiento", "Comedor / Vestuarios", "Otros"]
    }
  ];
  var ALL_EQUIPMENT = EQUIPMENT_GROUPS.reduce(function (acc, g) { return acc.concat(g.items); }, []);

  var QR_EQUIPMENT = SECTORS.filter(function (s) { return s !== "Otro"; });

  var ACTION_LABEL = {
    creado: "Aviso creado",
    aviso: "Derivado por WhatsApp",
    asignacion: "Asignación de responsable",
    comentario: "Comentario de seguimiento",
    estado: "Cambio de estado",
    evidencia: "Evidencia adjunta",
    importado: "Importado desde link",
    compartido: "Link para el panel copiado"
  };

  /* ------------------------------------------------------------------ */
  /* 2. UTILIDADES                                                       */
  /* ------------------------------------------------------------------ */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(value) {
    return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }

  function uid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID().slice(0, 18);
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function iso(date) { return (date instanceof Date ? date : new Date(date)).toISOString(); }
  function hoursAgo(h) { return iso(new Date(Date.now() - h * 3600 * 1000)); }
  function addHours(date, h) { return iso(new Date(new Date(date).getTime() + h * 3600 * 1000)); }

  var DT_FMT = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  var D_FMT = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric" });
  function fmtDT(v) { return v ? DT_FMT.format(new Date(v)) : "—"; }
  function fmtD(v) { return v ? D_FMT.format(new Date(v)) : "—"; }
  function rel(v) {
    if (!v) return "—";
    var diff = Date.now() - new Date(v).getTime();
    var min = Math.round(diff / 60000);
    if (min < 1) return "ahora";
    if (min < 60) return "hace " + min + " min";
    var h = Math.round(min / 60);
    if (h < 24) return "hace " + h + " h";
    var d = Math.round(h / 24);
    if (d < 30) return "hace " + d + " d";
    return fmtD(v);
  }

  var BASE_SUPERVISOR_AREAS = {
    mantenimiento: { label: "Mantenimiento", badge: "b-mant" },
    "5s": { label: "Producción (5S)", badge: "b-5s" },
    seguridad: { label: "Seguridad e Higiene", badge: "b-seg" }
  };

  function getAreaInfo(areaKey) {
    if (BASE_SUPERVISOR_AREAS[areaKey]) return BASE_SUPERVISOR_AREAS[areaKey];
    var customs = (state && state.settings && Array.isArray(state.settings.customAreas)) ? state.settings.customAreas : [];
    var found = customs.filter(function (c) { return c.id === areaKey; })[0];
    if (found) return { label: found.label, badge: "b-proceso" };
    return { label: areaKey, badge: "b-neutral" };
  }

  function getAllAreaOptions() {
    var base = [
      { id: "mantenimiento", label: "Mantenimiento (Avisos de Mantenimiento)" },
      { id: "5s", label: "Producción (Avisos de 5S)" },
      { id: "seguridad", label: "Seguridad e Higiene (Avisos de Seguridad)" }
    ];
    var customs = (state && state.settings && Array.isArray(state.settings.customAreas)) ? state.settings.customAreas : [];
    customs.forEach(function (c) {
      base.push({ id: c.id, label: c.label });
    });
    return base;
  }

  function emptyState() {
    return {
      version: VERSION,
      settings: {
        pin: "Sanjuan1",
        rolePins: {
          admin: "Sanjuan1",
          mantenimiento: "Sanjuan1",
          produccion: "Sanjuan1",
          seguridad: "Sanjuan1"
        },
        planta: "Cerámica San Lorenzo · Planta San Juan",
        wa: { mantenimiento: "", "5s": "", seguridad: "", supervisor: "" },
        supervisors: [],
        customAreas: []
      },
      reports: [],
      meta: { nextId: 1, cleanStart1: true }
    };
  }

  /* ------------------------------------------------------------------ */
  /* 3. ALMACENAMIENTO                                                   */
  /* ------------------------------------------------------------------ */

  var pendingCleanStart = false;
  var state = loadState();

  function loadState() {
    var base = emptyState();
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return base;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return base;
      var merged = {
        version: VERSION,
        settings: Object.assign({}, base.settings, parsed.settings || {}),
        reports: Array.isArray(parsed.reports) ? parsed.reports : [],
        meta: Object.assign({ nextId: 1 }, parsed.meta || {})
      };
      merged.settings.wa = Object.assign({ mantenimiento: "", "5s": "", seguridad: "", supervisor: "" }, merged.settings.wa || {});
      var fallbackPin = String(merged.settings.pin || "sanjuan");
      merged.settings.rolePins = Object.assign({
        admin: fallbackPin,
        mantenimiento: fallbackPin,
        produccion: fallbackPin,
        seguridad: fallbackPin
      }, merged.settings.rolePins || {});
      if (!Array.isArray(merged.settings.customAreas)) merged.settings.customAreas = [];
      if (!Array.isArray(merged.settings.supervisors)) {
        merged.settings.supervisors = [];
        var legacyMap = [
          { key: "mantenimiento", name: "Supervisor de Mantenimiento", area: "mantenimiento" },
          { key: "5s", name: "Supervisor de Producción (5S)", area: "5s" },
          { key: "seguridad", name: "Supervisor Seguridad e Higiene", area: "seguridad" },
          { key: "supervisor", name: "Supervisor de Producción (5S)", area: "5s" }
        ];
        legacyMap.forEach(function (m) {
          var ph = String(merged.settings.wa[m.key] || "").replace(/[^\d]/g, "");
          if (ph) {
            merged.settings.supervisors.push({
              id: "sup-" + m.key, name: m.name, area: m.area, shift: "Todos los turnos", phone: ph
            });
          }
        });
      } else {
        merged.settings.supervisors = merged.settings.supervisors.map(function (s) {
          if (s.area === "produccion") return Object.assign({}, s, { area: "5s" });
          if (s.area === "jefatura") {
            if (!merged.settings.customAreas.some(function (c) { return c.id === "cat-jefatura"; })) {
              merged.settings.customAreas.push({ id: "cat-jefatura", label: "Jefatura / Guardia" });
            }
            return Object.assign({}, s, { area: "cat-jefatura" });
          }
          return s;
        });
      }
      merged.reports = merged.reports.map(normalizeReport);
      delete merged.meta.seeded;
      // Arranque limpio (una sola vez): borra los avisos de prueba cargados durante el desarrollo
      if (!merged.meta.cleanStart1) {
        merged.reports = [];
        merged.meta.nextId = 1;
        merged.meta.cleanStart1 = true;
        pendingCleanStart = true;
        try {
          localStorage.removeItem(LS_OPERATOR);
          localStorage.setItem(LS_KEY, JSON.stringify(merged));
        } catch (cleanErr) { /* sin persistencia */ }
      }
      var maxId = merged.reports.reduce(function (acc, r) { return Math.max(acc, Number(r.id) || 0); }, 0);
      merged.meta.nextId = Math.max(Number(merged.meta.nextId) || 1, maxId + 1);
      return merged;
    } catch (err) {
      console.warn("[AvisoEnLinea] no se pudo leer el almacenamiento", err);
      return base;
    }
  }

  function normalizeReport(r) {
    var out = Object.assign({}, r);
    out.photos = Array.isArray(r.photos) ? r.photos : [];
    out.events = Array.isArray(r.events) ? r.events : [];
    out.recipients = Array.isArray(r.recipients) ? r.recipients : [];
    out.status = STATUSES[out.status] ? out.status : "abierto";
    out.type = TYPES[out.type] ? out.type : "mantenimiento";
    out.severity = SEVERITIES[out.severity] ? out.severity : "media";
    out.createdAt = out.createdAt || iso(new Date());
    out.updatedAt = out.updatedAt || out.createdAt;
    out.dueAt = out.dueAt || addHours(out.createdAt, SEVERITIES[out.severity].sla);
    return out;
  }

  function saveState(silent) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      console.error("[AvisoEnLinea] almacenamiento lleno", err);
      toast("No pudimos guardar: el almacenamiento del navegador está lleno. Exportá un respaldo y liberá espacio.", "error");
      return false;
    }
  }

  /* -------------------------- IndexedDB (fotos) --------------------- */

  var idbPromise = null;
  var photoCache = {};
  var FALLBACK_PHOTO = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  function idbOpen() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error("Este navegador no soporta IndexedDB")); return; }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("No se pudo abrir IndexedDB")); };
    });
    return idbPromise;
  }

  function idbPut(key, value) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put(value, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    }).catch(function (err) { console.warn("[AvisoEnLinea] foto no guardada en IndexedDB", err); return false; });
  }

  function idbGet(key) {
    if (photoCache[key]) return Promise.resolve(photoCache[key]);
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readonly");
        var req = tx.objectStore(DB_STORE).get(key);
        req.onsuccess = function () {
          if (req.result) photoCache[key] = req.result;
          resolve(req.result || "");
        };
        req.onerror = function () { reject(req.error); };
      });
    }).catch(function () { return ""; });
  }

  function idbDel(key) {
    delete photoCache[key];
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).delete(key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      });
    }).catch(function () { return false; });
  }

  function idbClear() {
    photoCache = {};
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).clear();
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      });
    }).catch(function () { return false; });
  }

  /* ------------------------------------------------------------------ */
  /* 4. DOMINIO: AVISOS                                                  */
  /* ------------------------------------------------------------------ */

  function getReport(code) {
    var clean = String(code || "").trim().toUpperCase();
    return state.reports.filter(function (r) { return r.code === clean; })[0] || null;
  }

  function nextCode() {
    var id = state.meta.nextId++;
    return "PR-" + new Date().getFullYear() + "-" + String(id).padStart(4, "0");
  }

  function createReport(input, photos) {
    var now = new Date();
    var code = nextCode();
    while (getReport(code)) { code = nextCode(); }
    var report = normalizeReport({
      id: state.meta.nextId - 1,
      code: code,
      employeeName: input.employeeName,
      employeeId: input.employeeId,
      operatorSector: input.operatorSector,
      shift: input.shift,
      phone: input.phone || "",
      type: input.type,
      severity: input.severity,
      equipment: input.equipment,
      location: input.location || "",
      description: input.description,
      status: "abierto",
      assignedTo: "",
      resolution: "",
      resolvedAt: null,
      whatsappSentAt: null,
      createdAt: iso(now),
      updatedAt: iso(now),
      dueAt: addHours(now, SEVERITIES[input.severity].sla),
      recipients: Array.isArray(input.recipients) ? input.recipients : [],
      photos: photos || [],
      events: [{
        action: "creado",
        author: input.employeeName,
        note: "Aviso cargado desde el QR del sector · Prioridad " + SEVERITIES[input.severity].label,
        toStatus: "abierto",
        at: iso(now)
      }]
    });
    state.reports.unshift(report);
    saveState();
    return report;
  }

  function addEvent(report, action, author, note, toStatus) {
    report.events.push({ action: action, author: author || "Sistema", note: note || "", toStatus: toStatus || null, at: iso(new Date()) });
    report.updatedAt = iso(new Date());
  }

  function updateReport(code, patch, event) {
    var report = getReport(code);
    if (!report) return null;
    Object.assign(report, patch);
    report.updatedAt = iso(new Date());
    if (event) addEvent(report, event.action, event.author, event.note, event.toStatus);
    saveState();
    return report;
  }

  function dueInfo(report) {
    if (report.status === "resuelto" || report.status === "cerrado") return { text: "Gestionado", tone: "ok" };
    var diff = new Date(report.dueAt).getTime() - Date.now();
    if (diff < 0) {
      var h = Math.round(Math.abs(diff) / 3600000);
      return { text: h >= 24 ? "Vencido " + Math.round(h / 24) + " d" : "Vencido " + h + " h", tone: "late" };
    }
    var hh = Math.round(diff / 3600000);
    return { text: hh >= 24 ? "Vence en " + Math.round(hh / 24) + " d" : "Vence en " + hh + " h", tone: hh <= 8 ? "warn" : "ok" };
  }

  function stats() {
    var byStatus = { abierto: 0, en_proceso: 0, resuelto: 0, cerrado: 0 };
    var byType = { mantenimiento: 0, "5s": 0, seguridad: 0 };
    var bySeverity = { baja: 0, media: 0, alta: 0, critica: 0 };
    var overdue = 0, whatsapp = 0, resolved30 = 0, durations = [], equipmentCount = {}, recurrence = {};
    var since90 = Date.now() - 90 * 24 * 3600 * 1000;
    var since30 = Date.now() - 30 * 24 * 3600 * 1000;

    state.reports.forEach(function (r) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
      var created = new Date(r.createdAt).getTime();
      if (created >= since90) byType[r.type] = (byType[r.type] || 0) + 1;
      if ((r.status === "abierto" || r.status === "en_proceso") && new Date(r.dueAt).getTime() < Date.now()) overdue++;
      if (r.whatsappSentAt) whatsapp++;
      if (r.resolvedAt) {
        durations.push((new Date(r.resolvedAt).getTime() - created) / 3600000);
        if (new Date(r.resolvedAt).getTime() >= since30) resolved30++;
      }
      if (created >= since90) equipmentCount[r.equipment] = (equipmentCount[r.equipment] || 0) + 1;
      if (created >= since30 && (r.status === "abierto" || r.status === "en_proceso")) {
        var key = r.equipment + "||" + r.type;
        recurrence[key] = (recurrence[key] || 0) + 1;
      }
    });

    var avg = durations.length ? Math.round((durations.reduce(function (a, b) { return a + b; }, 0) / durations.length) * 10) / 10 : null;
    var topEquipment = Object.keys(equipmentCount).map(function (k) { return { equipment: k, total: equipmentCount[k] }; })
      .sort(function (a, b) { return b.total - a.total; }).slice(0, 5);
    var recurring = Object.keys(recurrence).filter(function (k) { return recurrence[k] >= 2; }).map(function (k) {
      var parts = k.split("||");
      return { equipment: parts[0], type: parts[1], total: recurrence[k] };
    }).sort(function (a, b) { return b.total - a.total; }).slice(0, 4);

    return {
      total: state.reports.length,
      byStatus: byStatus, byType: byType, bySeverity: bySeverity,
      active: byStatus.abierto + byStatus.en_proceso,
      overdue: overdue, resolved30: resolved30, avgHours: avg, whatsapp: whatsapp,
      topEquipment: topEquipment, recurring: recurring
    };
  }

  /* ------------------------------------------------------------------ */
  /* 5. SESIÓN / PERMISOS                                                */
  /* ------------------------------------------------------------------ */

  function session() {
    try {
      var raw = sessionStorage.getItem(SS_SESSION);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.role || !ROLES[data.role]) return null;
      if (!data.exp || new Date(data.exp).getTime() < Date.now()) { sessionStorage.removeItem(SS_SESSION); return null; }
      return data;
    } catch (err) { return null; }
  }

  function login(role) {
    var data = { role: role, exp: new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString() };
    sessionStorage.setItem(SS_SESSION, JSON.stringify(data));
    renderSessionBox();
  }

  function logout() {
    sessionStorage.removeItem(SS_SESSION);
    renderSessionBox();
    toast("Sesión cerrada.");
    location.hash = "#/";
  }

  function canManage(type) {
    var s = session();
    if (!s) return false;
    var role = ROLES[s.role];
    if (!role) return false;
    return role.types === "all" || role.types.indexOf(type) !== -1;
  }

  function isAdmin() {
    var s = session();
    return !!s && s.role === "admin";
  }

  function renderSessionBox() {
    var box = $("#session-box");
    if (!box) return;
    var s = session();
    if (!s) {
      box.innerHTML = '<a class="btn btn-ghost btn-sm" href="#/login">Ingresar</a>';
      return;
    }
    box.innerHTML =
      '<span class="session-user"><i></i>' + esc(ROLES[s.role].label) + "</span>" +
      '<button class="btn btn-ghost btn-sm" type="button" data-action="logout">Salir</button>';
  }

  /* ------------------------------------------------------------------ */
  /* 6. WHATSAPP / LINKS                                                 */
  /* ------------------------------------------------------------------ */

  function appBaseUrl() {
    if (location.protocol === "http:" || location.protocol === "https:") {
      var url = new URL(location.href);
      url.hash = "";
      url.search = "";
      return url.href.replace(/index\.html$/i, "");
    }
    return "";
  }

  function trackingUrl(code) {
    var base = appBaseUrl() || location.href.split("#")[0];
    return base + "#/aviso/" + encodeURIComponent(code);
  }

  function importLink(code) {
    var report = getReport(code);
    if (!report) return "";
    var base = appBaseUrl() || location.href.split("#")[0];
    return base + "#/importar/" + encodeShare(report);
  }

  function waPhone(type) {
    var key = TYPES[type] ? TYPES[type].wa : "mantenimiento";
    var sups = (state.settings && state.settings.supervisors) || [];
    var match = sups.filter(function (s) { return s.area === key && s.phone; })[0];
    if (match) return match.phone;
    return (state.settings.wa && state.settings.wa[key]) || "";
  }

  function waMessage(report, recipientName) {
    var type = TYPES[report.type];
    var sev = SEVERITIES[report.severity];
    var lines = [
      "*AVISO DE " + type.label.toUpperCase() + " · AVISO EN LÍNEA*",
      "N° " + report.code + (recipientName ? " · Para: " + recipientName : ""),
      "",
      "*Sector del problema:* " + report.equipment + (report.location ? " (" + report.location + ")" : ""),
      "*Prioridad:* " + sev.label,
      "*Reportado por:* " + report.employeeName + " · Legajo " + report.employeeId,
      "*Sector del operario:* " + report.operatorSector + " · " + report.shift,
      "",
      "*Detalle:* " + report.description,
      report.photos && report.photos.length ? "*Evidencia:* " + report.photos.length + " foto(s) registrada(s)" : "",
      "",
      "Plazo de atención: " + fmtDT(report.dueAt),
      "Trazabilidad y fotos: " + trackingUrl(report.code),
      "",
      "_Generado desde AVISO EN LÍNEA · Cerámica San Lorenzo._"
    ].filter(function (l, idx, arr) { return !(l === "" && arr[idx - 1] === ""); });
    return lines.join("\n");
  }

  function openWhatsappToRecipient(report, recId) {
    var rec = null;
    if (recId && Array.isArray(report.recipients)) {
      rec = report.recipients.filter(function (r) { return r.id === recId; })[0] || null;
    }
    var phone = rec ? String(rec.phone || "").replace(/[^\d]/g, "") : waPhone(report.type).replace(/[^\d]/g, "");
    var recName = rec ? rec.name : TYPES[report.type].label;
    var text = encodeURIComponent(waMessage(report, rec ? rec.name : ""));
    if (phone) {
      window.open("https://wa.me/" + phone + "?text=" + text, "_blank", "noopener");
    } else {
      window.open("https://wa.me/?text=" + text, "_blank", "noopener");
    }
    var nowIso = iso(new Date());
    if (rec) rec.sentAt = nowIso;
    report.whatsappSentAt = report.whatsappSentAt || nowIso;
    addEvent(report, "aviso", "Notificación WhatsApp", "Alerta enviada por WhatsApp a " + recName + ".", null);
    saveState();
    if ($("#success") && !$("#success").hidden && $("#success-wa-extra")) {
      var pending = (report.recipients || []).filter(function (r) { return !r.sentAt; });
      if (!pending.length) { $("#success-wa-extra").hidden = true; $("#success-wa-extra").innerHTML = ""; }
      else {
        $("#success-wa-extra").innerHTML = '<div class="wa-queue-list">' + pending.map(function (r) {
          return '<div class="wa-queue-row"><div><strong>' + esc(r.name) + '</strong><small>Pendiente de abrir chat</small></div>' +
            '<button class="btn btn-wa btn-sm" type="button" data-action="wa-rec" data-code="' + esc(report.code) + '" data-rec="' + esc(r.id) + '">Enviar WhatsApp</button></div>';
        }).join("") + "</div>";
      }
    }
    refresh();
  }

  function openWhatsapp(report) {
    openWhatsappToRecipient(report, report.recipients && report.recipients[0] ? report.recipients[0].id : "");
  }

  function dataUrlToFile(dataUrl, filename) {
    try {
      var parts = dataUrl.split(",");
      var mime = (parts[0].match(/:(.*?);/) || [])[1] || "image/jpeg";
      var bin = atob(parts[1]);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new File([arr], filename, { type: mime });
    } catch (err) { return null; }
  }

  function shareReportWithPhotos(report) {
    var jobs = (report.photos || []).map(function (p, idx) {
      if (p.inline) return Promise.resolve(dataUrlToFile(p.inline, report.code + "-foto-" + (idx + 1) + ".jpg"));
      return idbGet(p.id).then(function (src) {
        return src ? dataUrlToFile(src, report.code + "-foto-" + (idx + 1) + ".jpg") : null;
      });
    });
    Promise.all(jobs).then(function (files) {
      var validFiles = files.filter(Boolean);
      var msg = waMessage(report);
      if (validFiles.length && navigator.canShare && navigator.canShare({ files: validFiles })) {
        navigator.share({ title: "Aviso " + report.code, text: msg, files: validFiles }).then(function () {
          report.whatsappSentAt = report.whatsappSentAt || iso(new Date());
          addEvent(report, "aviso", "WhatsApp con foto", "Se compartió el aviso con foto(s) adjunta(s).", null);
          saveState();
          refresh();
        }).catch(function () {});
      } else if (validFiles.length) {
        validFiles.forEach(function (file) {
          var url = URL.createObjectURL(file);
          var a = document.createElement("a");
          a.href = url;
          a.download = file.name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
        });
        copyText(msg, "Foto descargada y resumen copiado para adjuntar en WhatsApp.");
      } else {
        copyText(msg, "Resumen copiado para pegar en WhatsApp.");
      }
    });
  }

  /* ------- compartir / importar sin servidor ------- */

  function b64urlEncode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function b64urlDecode(str) {
    var clean = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
    while (clean.length % 4) clean += "=";
    var bin = atob(clean);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function encodeShare(report) {
    return b64urlEncode(JSON.stringify({
      c: report.code, t: report.type, s: report.severity, eq: report.equipment,
      lo: report.location, de: report.description, n: report.employeeName, lg: report.employeeId,
      sec: report.operatorSector, sh: report.shift, ca: report.createdAt, du: report.dueAt, st: report.status
    }));
  }

  var pendingImport = null;

  function decodeShare(payload) {
    try {
      var data = JSON.parse(b64urlDecode(payload));
      if (!data || !data.c || !data.n) return null;
      return {
        code: String(data.c).toUpperCase(),
        type: TYPES[data.t] ? data.t : "mantenimiento",
        severity: SEVERITIES[data.s] ? data.s : "media",
        equipment: String(data.eq || "Prensas - General"),
        location: String(data.lo || ""),
        description: String(data.de || ""),
        employeeName: String(data.n || ""),
        employeeId: String(data.lg || ""),
        operatorSector: String(data.sec || "Prensas"),
        shift: String(data.sh || ""),
        createdAt: data.ca || iso(new Date()),
        dueAt: data.du || addHours(data.ca || new Date(), 48),
        status: STATUSES[data.st] ? data.st : "abierto"
      };
    } catch (err) {
      return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* 7. UI BASE: toast, modal, copiar, descargar                         */
  /* ------------------------------------------------------------------ */

  function toast(message, tone) {
    var root = $("#toasts");
    if (!root) return;
    var el = document.createElement("div");
    el.className = "toast " + (tone || "");
    el.textContent = message;
    root.appendChild(el);
    setTimeout(function () {
      el.style.transition = "opacity .3s";
      el.style.opacity = "0";
      setTimeout(function () { el.remove(); }, 320);
    }, 3600);
  }

  function openModal(opts) {
    var root = $("#modal-root");
    if (!root) return;
    root.innerHTML =
      '<div class="modal rise" role="dialog" aria-modal="true" aria-label="' + esc(opts.title || "Diálogo") + '">' +
      '<div class="modal-head"><strong>' + esc(opts.title || "") + "</strong>" +
      '<button class="modal-close" type="button" data-modal-close aria-label="Cerrar">×</button></div>' +
      '<div class="modal-body">' + (opts.body || "") + "</div>" +
      '<div class="modal-foot">' +
      '<button class="btn btn-light" type="button" data-modal-close>Cancelar</button>' +
      (opts.confirmText ? '<button class="btn ' + (opts.danger ? "btn-danger" : "btn-primary") + '" type="button" data-modal-confirm>' + esc(opts.confirmText) + "</button>" : "") +
      "</div></div>";
    root.hidden = false;
    var confirm = $("[data-modal-confirm]", root);
    if (confirm) {
      confirm.addEventListener("click", function () {
        var keepOpen = false;
        if (typeof opts.onConfirm === "function") {
          if (opts.onConfirm() === false) keepOpen = true;
        }
        if (!keepOpen) closeModal();
      });
    }
  }

  function closeModal() {
    var root = $("#modal-root");
    if (!root) return;
    root.hidden = true;
    root.innerHTML = "";
  }

  function copyText(text, okMessage) {
    function fallback() {
      try {
        var area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        var ok = document.execCommand("copy");
        area.remove();
        if (ok) toast(okMessage || "Copiado.", "ok");
        else toast("No pudimos copiar. Seleccioná el texto manualmente.", "error");
      } catch (err) {
        toast("No pudimos copiar el texto.", "error");
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMessage || "Copiado.", "ok"); }).catch(fallback);
    } else {
      fallback();
    }
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function compressImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !file.type || file.type.indexOf("image/") !== 0) { reject(new Error("El archivo debe ser una imagen.")); return; }
      if (file.size > 14 * 1024 * 1024) { reject(new Error("La foto supera los 14 MB. Sacá una con menor resolución.")); return; }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("No pudimos leer la foto.")); };
      reader.onload = function () {
        var dataUrl = String(reader.result || "");
        var img = new Image();
        img.onerror = function () {
          if (dataUrl.length < 1800000) resolve(dataUrl);
          else reject(new Error("No pudimos procesar la imagen."));
        };
        img.onload = function () {
          try {
            var maxDim = 1000;
            var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            var canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            var ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", 0.62));
          } catch (err) {
            resolve(dataUrl);
          }
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  function hydratePhotos(root) {
    var imgs = $$("img[data-photo]", root || document);
    imgs.forEach(function (img) {
      var id = img.getAttribute("data-photo");
      if (!id || img.getAttribute("data-loaded") === "1") return;
      img.setAttribute("data-loaded", "1");
      idbGet(id).then(function (src) {
        if (src) img.src = src;
      });
    });
  }

  function photoHtml(photo, cls) {
    if (!photo) return "";
    var klass = cls ? ' class="' + esc(cls) + '"' : "";
    var alt = esc(photo.caption || "Evidencia del aviso");
    if (photo.inline) return '<img src="' + esc(photo.inline) + '" alt="' + alt + '"' + klass + " />";
    return '<img data-photo="' + esc(photo.id) + '" src="' + FALLBACK_PHOTO + '" alt="' + alt + '"' + klass + " />";
  }

  function badgeType(type) { var t = TYPES[type]; return '<span class="badge b-' + (type === "5s" ? "5s" : type === "seguridad" ? "seg" : "mant") + '">' + esc(t.short) + "</span>"; }
  function badgeSeverity(sev) { return '<span class="badge b-' + sev + '"><i></i>' + esc(SEVERITIES[sev].label) + "</span>"; }
  function badgeStatus(status) { var s = STATUSES[status]; return '<span class="badge ' + s.cls + '"><i></i>' + esc(s.label) + "</span>"; }

  function notifyBlock(report) {
    var recs = Array.isArray(report.recipients) && report.recipients.length ? report.recipients : [];
    var waIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20.5 11.6a8.4 8.4 0 0 1-12.4 7.4L3.5 20.5l1.6-4.6a8.4 8.4 0 1 1 15.4-4.3Z"/><path d="M9 8.7c.3-.6.7-.6 1-.6h.5c.2 0 .4 0 .5.4l.7 1.6c.1.2 0 .4-.1.5l-.5.6c-.1.2-.2.3 0 .6.4.7 1 1.3 1.8 1.7.3.1.4 0 .6-.1l.6-.7c.2-.2.3-.2.5-.1l1.6.8c.2.1.3.2.3.4 0 .5-.2 1.3-.8 1.7-.5.4-1.2.6-2 .4-1.1-.2-2.7-1-4-2.4-1.1-1.2-1.7-2.6-1.8-3.4-.1-.6 0-1.1.1-1.4Z"/></svg>';
    if (!recs.length) {
      return '<div class="notify"><div class="notify-actions">' +
        '<button class="btn btn-wa" type="button" data-action="wa" data-code="' + esc(report.code) + '">' + waIcon +
        "Enviar por WhatsApp</button></div></div>";
    }
    return '<div class="notify"><div class="wa-queue-list" style="margin-top:0">' + recs.map(function (r) {
      var areaInfo = getAreaInfo(r.area);
      var sub = areaInfo.label + (r.shift ? " · " + r.shift : "");
      return '<div class="wa-queue-row">' +
        '<div><strong>' + esc(r.name) + (r.sentAt ? ' <span class="badge b-ok">✓ Enviado</span>' : "") + "</strong>" +
        "<small>" + esc(sub) + "</small></div>" +
        '<button class="btn ' + (r.sentAt ? "btn-light" : "btn-wa") + ' btn-sm" type="button" data-action="wa-rec" data-code="' + esc(report.code) + '" data-rec="' + esc(r.id) + '">' +
        waIcon + (r.sentAt ? "Reenviar" : "Enviar WhatsApp") + "</button></div>";
    }).join("") + "</div></div>";
  }

  /* ------------------------------------------------------------------ */
  /* 8. ROUTER                                                           */
  /* ------------------------------------------------------------------ */

  function parseHash() {
    var raw = location.hash.replace(/^#\/?/, "");
    var parts = raw.split("?");
    var segments = parts[0].split("/").filter(Boolean);
    var query = {};
    if (parts[1]) {
      parts[1].split("&").forEach(function (pair) {
        var kv = pair.split("=");
        if (kv[0]) query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
      });
    }
    return { name: segments[0] || "landing", param: segments[1] ? decodeURIComponent(segments[1]) : "", query: query };
  }

  function showView(name) {
    $$(".view").forEach(function (view) { view.hidden = view.getAttribute("data-view") !== name; });
    var navMap = { landing: "#/", reportar: "#/reportar", trazabilidad: "#/trazabilidad", aviso: "#/trazabilidad", panel: "#/panel", gestion: "#/panel", config: "#/panel", qr: "#/qr", ayuda: "#/ayuda" };
    $$("#mainnav a").forEach(function (a) {
      var href = a.getAttribute("href");
      a.classList.toggle("active", href === navMap[name]);
    });
    var nav = $("#mainnav");
    if (nav) nav.classList.remove("open");
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function route() {
    var h = parseHash();
    var name = h.name;

    if (name === "landing" || name === "inicio") { showView("landing"); renderLanding(); return; }
    if (name === "reportar") {
      showView("reportar");
      if (h.query.equipo && (ALL_EQUIPMENT.indexOf(h.query.equipo) !== -1 || SECTORS.indexOf(h.query.equipo) !== -1)) {
        applyPresetEquipment(h.query.equipo);
      }
      return;
    }
    if (name === "trazabilidad") { showView("trazabilidad"); renderTrazabilidad(); return; }
    if (name === "aviso") { showView("aviso"); renderTracking(h.param); return; }
    if (name === "login") { showView("login"); renderLogin(); return; }
    if (name === "panel") {
      if (h.param) {
        if (!session()) { location.hash = "#/login"; toast("Ingresá con tu contraseña para gestionar el aviso.", "warn"); return; }
        showView("gestion"); renderGestion(h.param); return;
      }
      if (!session()) { location.hash = "#/login"; toast("Ingresá con tu contraseña para ver el panel.", "warn"); return; }
      showView("panel"); renderPanel(); return;
    }
    if (name === "qr") { showView("qr"); renderQR(); return; }
    if (name === "config") {
      if (!isAdmin()) {
        location.hash = session() ? "#/panel" : "#/login";
        toast("Solo el Administrador puede acceder a Configuración.", "warn");
        return;
      }
      showView("config");
      renderConfig();
      return;
    }
    if (name === "ayuda") { showView("ayuda"); return; }
    if (name === "importar") { showView("importar"); renderImport(h.param); return; }
    showView("landing");
    renderLanding();
  }

  function refresh() {
    var h = parseHash();
    if (h.name === "landing" || h.name === "inicio") renderLanding();
    else if (h.name === "trazabilidad") renderTrazabilidad();
    else if (h.name === "panel" && !h.param) renderPanel();
    else if (h.name === "panel" && h.param) renderGestion(h.param);
    else if (h.name === "aviso") renderTracking(h.param);
    else if (h.name === "config") renderConfig();
    renderSessionBox();
  }

  /* ------------------------------------------------------------------ */
  /* 9. VISTA: LANDING                                                   */
  /* ------------------------------------------------------------------ */

  function renderLanding() {
    var s = stats();
    var kpis = [
      { label: "Avisos registrados", value: s.total, hint: "Historial en este dispositivo", tone: "" },
      { label: "Pendientes de cierre", value: s.active, hint: s.byStatus.abierto + " abiertos · " + s.byStatus.en_proceso + " en proceso", tone: "" },
      { label: "Fuera de plazo", value: s.overdue, hint: "Requieren escalamiento", tone: s.overdue ? "is-danger" : "is-ok" },
      { label: "Cierre promedio", value: s.avgHours === null ? "—" : s.avgHours + " h", hint: s.resolved30 + " resueltos en 30 días", tone: "" }
    ];
    var kpiRoot = $("#landing-kpis");
    if (kpiRoot) {
      kpiRoot.innerHTML = kpis.map(function (k) {
        return '<div class="kpi-cell ' + k.tone + '"><small>' + esc(k.label) + "</small><b>" + esc(k.value) + "</b><span>" + esc(k.hint) + "</span></div>";
      }).join("");
    }

    var recentRoot = $("#landing-recent");
    if (recentRoot) {
      var recent = state.reports.slice(0, 3);
      recentRoot.innerHTML = recent.length ? recent.map(recentCard).join("") : '<div class="empty"><strong>Sin avisos todavía</strong><p>Cargá el primer aviso del sector para verlo acá.</p></div>';
      hydratePhotos(recentRoot);
    }
  }

  function recentCard(r) {
    var img = r.photos.length ? photoHtml(r.photos[0], "report-thumb-img") : "";
    return '<a class="card" href="#/aviso/' + encodeURIComponent(r.code) + '" style="overflow:hidden;display:block">' +
      (img ? '<div style="height:130px;overflow:hidden;border-radius:0">' + img + "</div>" :
        '<div style="height:130px;display:grid;place-items:center;background:var(--concrete-100);color:var(--concrete-400)"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3.5 22 20H2L12 3.5Z"/><path d="M12 9v5M12 17.2h.01"/></svg></div>') +
      '<div style="padding:14px"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
      '<span class="report-code">' + esc(r.code) + "</span>" + badgeType(r.type) + "</div>" +
      '<div class="report-title" style="margin-top:6px">' + esc(r.equipment) + "</div>" +
      '<p class="mini-desc" style="margin-top:4px">' + esc(r.description) + "</p>" +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:9px">' + badgeStatus(r.status) +
      '<span class="mini-meta">' + esc(rel(r.createdAt)) + "</span></div></div></a>";
  }

  /* ------------------------------------------------------------------ */
  /* 10. VISTA: FORMULARIO DEL OPERARIO                                  */
  /* ------------------------------------------------------------------ */

  var form = {
    employeeName: "", employeeId: "", operatorSector: "Prensas y Secaderos", shift: "",
    phone: "", type: "", severity: "", equipment: "", location: "",
    description: "", photos: [], selectedRecipients: [], recipientsSeedKey: ""
  };
  var wizardStep = 1;

  function initWizard() {
    var sectorSelect = $("#f-sector");
    if (sectorSelect) {
      sectorSelect.innerHTML = SECTORS.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + "</option>"; }).join("");
    }
    var equipSelect = $("#f-equipment");
    if (equipSelect) {
      equipSelect.innerHTML = '<option value="" selected>Seleccione el sector del evento</option>' +
        SECTORS.map(function (s) {
          return '<option value="' + esc(s) + '">' + esc(s) + "</option>";
        }).join("");
      equipSelect.value = "";
      equipSelect.selectedIndex = 0;
    }
    var shiftRoot = $("#shift-chips");
    if (shiftRoot) {
      shiftRoot.innerHTML = SHIFTS.map(function (s) {
        return '<button class="chip" type="button" data-shift="' + esc(s) + '" aria-pressed="false">' + esc(s) + "</button>";
      }).join("");
    }
    var typeRoot = $("#type-cards");
    if (typeRoot) {
      typeRoot.innerHTML = Object.keys(TYPES).map(function (key) {
        var t = TYPES[key];
        return '<button class="type-card" type="button" data-type="' + key + '" aria-pressed="false">' +
          '<span class="tc-icon icon-' + t.icon + '">' + typeIconSvg(key) + "</span>" +
          '<span class="tc-text"><strong>' + esc(t.label) + "</strong><small>" + esc(t.desc) + "</small></span>" +
          '<span class="tc-check">✓</span></button>';
      }).join("");
    }
    var sevRoot = $("#severity-chips");
    if (sevRoot) {
      sevRoot.innerHTML = Object.keys(SEVERITIES).map(function (key) {
        var s = SEVERITIES[key];
        return '<button class="sev" type="button" data-severity="' + key + '" aria-pressed="false">' +
          '<b><i style="background:' + s.color + '"></i>' + esc(s.label) + "</b>" +
          "<span>" + esc(s.desc) + "</span></button>";
      }).join("");
    }
    var tagRoot = $("#tag-list");
    if (tagRoot) {
      tagRoot.innerHTML = TAGS.map(function (t) {
        return '<button class="chip chip-tag" type="button" data-tag="' + esc(t) + '">+ ' + esc(t) + "</button>";
      }).join("");
    }
    restoreOperator();
    syncWizard();
    renderPhotos();
  }

  function typeIconSvg(type) {
    if (type === "mantenimiento") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 1 0 5 5L21 10l-7 7-3-3 7-7 1.7-1.7Z"/><path d="m11 13-7 7"/></svg>';
    if (type === "5s") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4l6 6"/><path d="M16.5 6.5 9 14l-4 1 1-4 7.5-7.5"/><path d="m7 13 4 4"/><path d="M4 20c1.5-1 3-1 4.5 0"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3Z"/><path d="M12 8v4"/><path d="M12 15.5h.01"/></svg>';
  }

  function restoreOperator() {
    try {
      var raw = localStorage.getItem(LS_OPERATOR);
      if (!raw) return;
      var saved = JSON.parse(raw);
      form.employeeName = saved.employeeName || "";
      form.employeeId = saved.employeeId || "";
      form.operatorSector = saved.operatorSector || "Prensas";
      form.shift = saved.shift || "";
      form.phone = saved.phone || "";
      if (!form.equipment) form.equipment = saved.equipment || "";
      form.location = saved.location || "";
      if ($("#f-name")) $("#f-name").value = form.employeeName;
      if ($("#f-legajo")) $("#f-legajo").value = form.employeeId;
      if ($("#f-sector")) $("#f-sector").value = form.operatorSector;
      if ($("#f-phone")) $("#f-phone").value = form.phone;
      if ($("#f-equipment")) {
        $("#f-equipment").value = form.equipment || "";
        if (!form.equipment) $("#f-equipment").selectedIndex = 0;
      }
      if ($("#f-location")) $("#f-location").value = form.location;
    } catch (err) { /* sin datos guardados */ }
  }

  function saveOperator() {
    try {
      localStorage.setItem(LS_OPERATOR, JSON.stringify({
        employeeName: form.employeeName, employeeId: form.employeeId,
        operatorSector: form.operatorSector, shift: form.shift, phone: form.phone,
        equipment: form.equipment, location: form.location
      }));
    } catch (err) { /* sin persistencia */ }
  }

  function applyPresetEquipment(equipment) {
    form.equipment = equipment;
    if ($("#f-equipment")) $("#f-equipment").value = equipment;
    var banner = $("#operator-preset");
    if (banner) {
      banner.hidden = false;
      banner.innerHTML = "Sector preseleccionado desde el QR: <b>" + esc(equipment) + "</b>. Podés cambiarlo si el evento es en otro lado.";
    }
  }

  function syncWizard() {
    $$(".step").forEach(function (step) {
      step.hidden = Number(step.getAttribute("data-step")) !== wizardStep;
    });
    $$(".progress i").forEach(function (bar, index) { bar.classList.toggle("on", index < wizardStep); });
    var labels = ["Quién reporta", "Tipo de aviso", "Evidencia", "Confirmar"];
    if ($("#step-label")) $("#step-label").textContent = "Paso " + wizardStep + " de 4 · " + labels[wizardStep - 1];
    if ($("#step-percent")) $("#step-percent").textContent = Math.round((wizardStep / 4) * 100) + " %";
    if ($("#btn-back")) $("#btn-back").hidden = wizardStep === 1;
    if ($("#btn-next")) $("#btn-next").hidden = wizardStep === 4;
    if ($("#btn-submit")) $("#btn-submit").hidden = wizardStep !== 4;
    if (wizardStep === 2 && !form.equipment) {
      var eqSel = $("#f-equipment");
      if (eqSel) { eqSel.value = ""; eqSel.selectedIndex = 0; }
    }
    if (wizardStep === 4) renderSummary();
    // estados visuales
    $$("#shift-chips .chip").forEach(function (btn) {
      var on = btn.getAttribute("data-shift") === form.shift;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $$("#type-cards .type-card").forEach(function (btn) {
      var on = btn.getAttribute("data-type") === form.type;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    $$("#severity-chips .sev").forEach(function (btn) {
      var on = btn.getAttribute("data-severity") === form.severity;
      btn.classList.toggle("on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function showErrors(errors) {
    $$(".error[data-error-for]").forEach(function (el) {
      el.textContent = "";
      el.classList.remove("visible");
    });
    $$(".invalid").forEach(function (el) { el.classList.remove("invalid"); });
    var inputMap = { employeeName: "#f-name", employeeId: "#f-legajo", operatorSector: "#f-sector", description: "#f-description", equipment: "#f-equipment" };
    Object.keys(errors).forEach(function (field) {
      var el = $('.error[data-error-for="' + field + '"]');
      if (el) { el.textContent = errors[field]; el.classList.add("visible"); }
      var input = inputMap[field] ? $(inputMap[field]) : null;
      if (input) input.classList.add("invalid");
    });
  }

  function validateStep(step) {
    var errors = {};
    if (step >= 1) {
      if (form.employeeName.trim().length < 3) errors.employeeName = "Escribí tu nombre y apellido.";
      if (!form.employeeId.trim()) errors.employeeId = "Ingresá tu legajo.";
      if (!form.operatorSector) errors.operatorSector = "Elegí tu sector.";
      if (!form.shift) errors.shift = "Elegí tu turno.";
    }
    if (step >= 2) {
      if (!form.type) errors.type = "Elegí el tipo de aviso.";
      if (!form.severity) errors.severity = "Elegí la prioridad.";
      if (!form.equipment) errors.equipment = "Elegí el equipo o sector del evento.";
    }
    if (step >= 3) {
      if (form.description.trim().length < 10) errors.description = "Contanos qué pasó (mínimo 10 caracteres).";
    }
    showErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function getCandidateRecipients() {
    var primaryArea = form.type === "5s" ? "5s" : form.type === "seguridad" ? "seguridad" : "mantenimiento";
    var sups = (state.settings && Array.isArray(state.settings.supervisors)) ? state.settings.supervisors.slice() : [];
    var sortByShift = function (a, b) {
      var aMatch = (a.shift === form.shift) ? 0 : (a.shift === "Todos los turnos" ? 1 : 2);
      var bMatch = (b.shift === form.shift) ? 0 : (b.shift === "Todos los turnos" ? 1 : 2);
      return aMatch - bMatch;
    };

    var candidates = [];
    var primarySups = sups.filter(function (s) { return s.area === primaryArea; }).sort(sortByShift);
    if (primarySups.length) {
      primarySups.forEach(function (s) { candidates.push(Object.assign({ group: "primary" }, s)); });
    } else {
      candidates.push({
        id: "default-" + primaryArea,
        name: "Supervisor de " + getAreaInfo(primaryArea).label + (form.shift ? " (" + form.shift + ")" : ""),
        area: primaryArea,
        shift: form.shift || "De turno",
        phone: "",
        group: "primary"
      });
    }

    var otherSups = sups.filter(function (s) { return s.area !== primaryArea; }).sort(sortByShift);
    if (otherSups.length) {
      otherSups.forEach(function (s) { candidates.push(Object.assign({ group: "otros" }, s)); });
    } else if (primaryArea !== "5s") {
      candidates.push({
        id: "default-5s",
        name: "Supervisor de Producción (5S)" + (form.shift ? " (" + form.shift + ")" : ""),
        area: "5s",
        shift: form.shift || "De turno",
        phone: "",
        group: "otros"
      });
    }

    return candidates;
  }

  function ensureDefaultRecipients() {
    var supsCount = (state.settings.supervisors || []).length + "|" + ((state.settings.customAreas || []).length);
    var seedKey = (form.type || "") + "|" + (form.shift || "") + "|" + supsCount;
    var candidates = getCandidateRecipients();
    if (form.recipientsSeedKey !== seedKey) {
      form.recipientsSeedKey = seedKey;
      var firstPrimary = candidates.filter(function (c) { return c.group === "primary"; })[0];
      form.selectedRecipients = firstPrimary ? [firstPrimary.id] : [];
    } else {
      var validIds = candidates.map(function (c) { return c.id; });
      form.selectedRecipients = form.selectedRecipients.filter(function (id) { return validIds.indexOf(id) !== -1; });
    }
    return candidates;
  }

  function renderStep4Recipients() {
    var listEl = $("#wa-rec-list");
    if (!listEl) return;
    var candidates = ensureDefaultRecipients();
    var primaryArea = form.type === "5s" ? "5s" : form.type === "seguridad" ? "seguridad" : "mantenimiento";
    var primaryLabel = getAreaInfo(primaryArea).label;

    var renderCard = function (c) {
      var on = form.selectedRecipients.indexOf(c.id) !== -1;
      var areaInfo = getAreaInfo(c.area);
      var phoneNote = c.phone ? ("+" + c.phone) : "Sin número cargado";
      var isShiftMatch = c.shift && form.shift && c.shift === form.shift;
      return '<button class="wa-rec-card' + (on ? " on" : "") + '" type="button" data-toggle-recipient="' + esc(c.id) + '" aria-pressed="' + (on ? "true" : "false") + '">' +
        '<span class="wa-rec-check">✓</span>' +
        '<span class="wa-rec-info"><strong>' + esc(c.name) + "</strong>" +
        "<small>" + esc(c.shift || "Todos los turnos") + " · " + esc(phoneNote) + "</small></span>" +
        '<span class="wa-rec-badges">' +
        (isShiftMatch ? '<span class="badge b-ok">De turno</span>' : "") +
        '<span class="badge ' + areaInfo.badge + '">' + esc(areaInfo.label) + "</span>" +
        "</span></button>";
    };

    var prim = candidates.filter(function (c) { return c.group === "primary"; });
    var otros = candidates.filter(function (c) { return c.group === "otros"; });

    var html = '<div class="wa-rec-group-label">Responsable directo · ' + esc(primaryLabel) + "</div>" + prim.map(renderCard).join("");
    if (otros.length) {
      html += '<div class="wa-rec-group-label">Otros supervisores / sectores (opcional)</div>' + otros.map(renderCard).join("");
    }
    listEl.innerHTML = html;
  }

  function renderSummary() {
    var root = $("#summary");
    if (!root) return;
    var rows = [
      ["Operario", form.employeeName + " · Legajo " + form.employeeId],
      ["Sector / turno", form.operatorSector + " · " + form.shift],
      ["Tipo", form.type ? TYPES[form.type].label : "—"],
      ["Prioridad", form.severity ? SEVERITIES[form.severity].label + " · " + SEVERITIES[form.severity].desc : "—"],
      ["Sector evento", form.equipment + (form.location ? " · " + form.location : "")],
      ["Evidencia", form.photos.length ? form.photos.length + " foto(s) adjunta(s)" : "Sin foto"],
      ["Detalle", form.description || "—"]
    ];
    root.innerHTML = rows.map(function (row) {
      return '<div class="summary-row"><dt>' + esc(row[0]) + "</dt><dd>" + esc(row[1]) + "</dd></div>";
    }).join("") +
      (form.photos.length ? '<div class="summary-photos">' + form.photos.map(function (p) { return '<img src="' + esc(p.dataUrl) + '" alt="Evidencia" />'; }).join("") + "</div>" : "");
    renderStep4Recipients();
  }

  function renderPhotos() {
    var grid = $("#photo-grid");
    if (!grid) return;
    grid.classList.toggle("has-photos", form.photos.length > 0);
    var items = form.photos.map(function (photo, index) {
      return '<div class="photo-item"><img src="' + esc(photo.dataUrl) + '" alt="Evidencia ' + (index + 1) + '" />' +
        '<button class="photo-remove" type="button" data-remove-photo="' + index + '">Quitar</button></div>';
    }).join("");
    var add = form.photos.length < MAX_PHOTOS
      ? '<button class="photo-add" id="photo-add" type="button"><span class="photo-add-icon">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 8h2.5l1.3-2h8.4l1.3 2H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13.5" r="3.4"/></svg>' +
        "</span><strong>" + (form.photos.length ? "Agregar otra foto" : "Sacar foto o elegir imagen") + "</strong>" +
        "<small>Se comprime antes de guardarse</small></button>"
      : "";
    grid.innerHTML = items + add;
  }

  function handlePhotoFiles(files) {
    if (!files || !files.length) return;
    var remaining = MAX_PHOTOS - form.photos.length;
    var list = Array.prototype.slice.call(files).slice(0, Math.max(0, remaining));
    if (!list.length) { toast("Máximo " + MAX_PHOTOS + " fotos por aviso.", "warn"); return; }
    $$(".error[data-error-for='photos']").forEach(function (el) { el.classList.remove("visible"); });
    var buttons = $$(".photo-add");
    buttons.forEach(function (b) { b.disabled = true; });
    Promise.all(list.map(function (file) { return compressImage(file).catch(function (err) { toast(err.message, "error"); return null; }); }))
      .then(function (results) {
        results.filter(Boolean).forEach(function (dataUrl) { form.photos.push({ dataUrl: dataUrl }); });
        form.photos = form.photos.slice(0, MAX_PHOTOS);
        renderPhotos();
        if ($("#photo-input")) $("#photo-input").value = "";
      });
  }

  function nextStep() {
    if (!validateStep(wizardStep)) return;
    wizardStep = Math.min(wizardStep + 1, 4);
    syncWizard();
  }

  function prevStep() {
    wizardStep = Math.max(wizardStep - 1, 1);
    syncWizard();
  }

  function firstInvalidStep() {
    if (form.employeeName.trim().length < 3 || !form.employeeId.trim() || !form.operatorSector || !form.shift) return 1;
    if (!form.type || !form.severity || !form.equipment) return 2;
    return 3;
  }

  function readFormInputs() {
    form.employeeName = ($("#f-name") || {}).value || "";
    form.employeeId = ($("#f-legajo") || {}).value || "";
    form.operatorSector = ($("#f-sector") || {}).value || "Prensas";
    form.phone = ($("#f-phone") || {}).value || "";
    form.equipment = ($("#f-equipment") || {}).value || "";
    form.location = ($("#f-location") || {}).value || "";
    form.description = ($("#f-description") || {}).value || "";
  }

  function submitReport() {
    readFormInputs();
    var badStep = firstInvalidStep();
    if (!validateStep(3)) {
      toast("Revisá los datos: faltan campos obligatorios.", "error");
      wizardStep = badStep;
      syncWizard();
      return;
    }
    var errorBox = $("#form-error");
    if (errorBox) errorBox.hidden = true;

    var photoEntries = form.photos.map(function (photo) {
      return { id: "ph-" + uid(), dataUrl: photo.dataUrl };
    });
    var initialPhotos = photoEntries.map(function (pe) {
      return { id: pe.id, kind: "reporte", caption: "" };
    });

    var candidates = getCandidateRecipients();
    var chosenRecipients = candidates.filter(function (c) {
      return form.selectedRecipients.indexOf(c.id) !== -1;
    }).map(function (c) {
      return { id: c.id, name: c.name, area: c.area, shift: c.shift || "", phone: c.phone || "", sentAt: null };
    });

    var report = createReport({
      employeeName: form.employeeName, employeeId: form.employeeId,
      operatorSector: form.operatorSector, shift: form.shift, phone: form.phone,
      type: form.type, severity: form.severity, equipment: form.equipment,
      location: form.location, description: form.description,
      recipients: chosenRecipients
    }, initialPhotos);

    saveOperator();
    if (photoEntries.length) {
      addEvent(report, "evidencia", form.employeeName, photoEntries.length + " foto(s) adjuntada(s) como prueba visual.", null);
    }

    // Disparo automático sincrónico de WhatsApp al registrar (evita bloqueo de ventanas emergentes)
    if (chosenRecipients.length) {
      chosenRecipients.forEach(function (rec, idx) {
        var phone = String(rec.phone || "").replace(/[^\d]/g, "");
        var text = encodeURIComponent(waMessage(report, rec.name));
        var url = phone ? ("https://wa.me/" + phone + "?text=" + text) : ("https://wa.me/?text=" + text);
        var win = window.open(url, "_blank", "noopener");
        if (win || idx === 0) {
          rec.sentAt = iso(new Date());
          report.whatsappSentAt = report.whatsappSentAt || rec.sentAt;
          addEvent(report, "aviso", "Notificación WhatsApp", "Alerta enviada automáticamente a " + rec.name + ".", null);
        }
      });
    }

    saveState();
    showSuccess(report);

    var submitBtn = $("#btn-submit");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Registrando…"; }
    Promise.all(photoEntries.map(function (pe, idx) {
      return idbPut(pe.id, pe.dataUrl).then(function (ok) {
        if (!ok && report.photos[idx]) report.photos[idx].inline = pe.dataUrl;
      });
    })).then(function () {
      saveState();
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Registrar aviso"; }
    });
  }

  function showSuccess(report) {
    var wizard = $("#wizard");
    var success = $("#success");
    if (wizard) wizard.hidden = true;
    if (success) success.hidden = false;
    if ($("#success-code")) $("#success-code").textContent = report.code;
    if ($("#success-badges")) $("#success-badges").innerHTML = badgeType(report.type) + badgeSeverity(report.severity) + badgeStatus(report.status);
    var recNames = (report.recipients || []).map(function (r) { return r.name; });
    if ($("#success-subtitle")) {
      $("#success-subtitle").textContent = recNames.length
        ? "Aviso guardado y derivado por WhatsApp a: " + recNames.join(", ") + "."
        : "Quedó guardado en AVISO EN LÍNEA con su evidencia y trazabilidad.";
    }
    if ($("#success-data")) {
      var rows = [
        ["Sector evento", report.equipment + (report.location ? " · " + report.location : "")],
        ["Prioridad", SEVERITIES[report.severity].label + " · " + SEVERITIES[report.severity].desc],
        ["Operario", report.employeeName + " · Legajo " + report.employeeId],
        ["Sector / turno", report.operatorSector + " · " + report.shift]
      ];
      if (recNames.length) rows.push(["WhatsApp enviado a", recNames.join(", ")]);
      $("#success-data").innerHTML = rows.map(function (row) { return "<div><dt>" + esc(row[0]) + "</dt><dd>" + esc(row[1]) + "</dd></div>"; }).join("");
    }
    var pendingRecs = (report.recipients || []).filter(function (r) { return !r.sentAt; });
    var extraBox = $("#success-wa-extra");
    if (extraBox) {
      if (pendingRecs.length) {
        extraBox.hidden = false;
        extraBox.innerHTML = '<div class="wa-queue-list">' + pendingRecs.map(function (r) {
          return '<div class="wa-queue-row"><div><strong>' + esc(r.name) + '</strong><small>Pendiente de abrir chat</small></div>' +
            '<button class="btn btn-wa btn-sm" type="button" data-action="wa-rec" data-code="' + esc(report.code) + '" data-rec="' + esc(r.id) + '">Enviar WhatsApp</button></div>';
        }).join("") + "</div>";
      } else {
        extraBox.hidden = true;
        extraBox.innerHTML = "";
      }
    }
    if ($("#success-tracking")) $("#success-tracking").setAttribute("href", "#/aviso/" + encodeURIComponent(report.code));
    renderPhotos();
    saveState();
    success.scrollIntoView({ behavior: "smooth", block: "start" });
    toast("Aviso " + report.code + " registrado.", "ok");
  }

  function resetWizard() {
    form.description = "";
    form.photos = [];
    form.type = "";
    form.severity = "";
    form.selectedRecipients = [];
    form.recipientsSeedKey = "";
    if ($("#f-description")) $("#f-description").value = "";
    if ($("#char-count")) $("#char-count").textContent = "0/2000";
    wizardStep = 1;
    if ($("#wizard")) $("#wizard").hidden = false;
    if ($("#success")) $("#success").hidden = true;
    renderPhotos();
    syncWizard();
    renderMyReports();
  }

  var trazaFilters = { q: "", status: "", type: "" };

  function initTrazaSelects() {
    var statusSel = $("#traza-filter-status");
    if (statusSel) {
      statusSel.innerHTML = '<option value="">Todos los estados</option>' + STATUS_ORDER.map(function (k) {
        return '<option value="' + k + '">' + esc(STATUSES[k].label) + "</option>";
      }).join("");
    }
    var typeSel = $("#traza-filter-type");
    if (typeSel) {
      typeSel.innerHTML = '<option value="">Todos los tipos</option>' + Object.keys(TYPES).map(function (k) {
        return '<option value="' + k + '">' + esc(TYPES[k].label) + "</option>";
      }).join("");
    }
  }

  function renderTrazabilidad() {
    renderTrazabilidadList();
  }

  function renderTrazabilidadList() {
    var list = state.reports.filter(function (r) {
      if (trazaFilters.status && r.status !== trazaFilters.status) return false;
      if (trazaFilters.type && r.type !== trazaFilters.type) return false;
      if (trazaFilters.q) {
        var q = trazaFilters.q.toLowerCase();
        var hay = [r.code, r.equipment, r.location, r.description, r.employeeName, r.employeeId, r.assignedTo].join(" ").toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    }).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });

    var count = $("#traza-count");
    if (count) count.textContent = list.length + (list.length === 1 ? " aviso registrado" : " avisos registrados");

    var quick = $("#traza-quick");
    if (quick) {
      var bySt = stats().byStatus;
      quick.innerHTML = '<button class="badge" type="button" data-action="traza-status" data-status="">Todos ' + state.reports.length + "</button>" +
        STATUS_ORDER.map(function (k) {
          return '<button class="badge" type="button" data-action="traza-status" data-status="' + k + '">' + esc(STATUSES[k].label) + " " + bySt[k] + "</button>";
        }).join("");
    }

    var root = $("#traza-list");
    if (!root) return;
    if (!list.length) {
      root.innerHTML = '<div class="empty"><strong>No encontramos avisos con esos criterios</strong><p>Verificá el número buscado, limpiá los filtros o cargá un nuevo aviso.</p>' +
        '<div class="row-actions mt-3" style="justify-content:center"><button class="btn btn-light" type="button" data-action="clear-traza">Ver todos</button>' +
        '<a class="btn btn-primary" href="#/reportar">Cargar aviso</a></div></div>';
      return;
    }
    root.innerHTML = list.map(trackingRow).join("");
    hydratePhotos(root);
  }

  function trackingRow(r) {
    var due = dueInfo(r);
    var thumb = r.photos.length
      ? '<div class="report-thumb">' + photoHtml(r.photos[0]) + (r.photos.length > 1 ? '<span class="thumb-count">' + r.photos.length + " fotos</span>" : "") + "</div>"
      : '<div class="report-thumb"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3.5 22 20H2L12 3.5Z"/><path d="M12 9v5M12 17.2h.01"/></svg></div>';
    return '<a class="report-row" href="#/aviso/' + encodeURIComponent(r.code) + '">' + thumb +
      '<div class="report-main"><div class="report-flags"><span class="report-code">' + esc(r.code) + "</span>" +
      badgeType(r.type) + badgeSeverity(r.severity) + (due.tone === "late" ? '<span class="badge b-late">Vencido</span>' : "") + "</div>" +
      '<div class="report-title">' + esc(r.equipment) + (r.location ? ' <span>· ' + esc(r.location) + "</span>" : "") + "</div>" +
      '<div class="report-desc">' + esc(r.description) + "</div>" +
      '<div class="report-who">' + esc(r.employeeName) + " · Legajo " + esc(r.employeeId) + " · " + esc(r.shift) + " · " + esc(rel(r.createdAt)) +
      (r.assignedTo ? " · Resp.: " + esc(r.assignedTo) : "") + "</div></div>" +
      '<div class="report-side">' + badgeStatus(r.status) +
      '<span class="sla ' + (due.tone === "late" ? "late" : due.tone === "warn" ? "warn" : "") + '">' + esc(due.text) + "</span>" +
      '<span class="report-open">Ver trazabilidad →</span></div></a>';
  }

  function renderMyReports() {
    var root = $("#my-reports");
    if (!root) return;
    var mine = state.reports.filter(function (r) { return r.employeeId === form.employeeId && form.employeeId; });
    var list = (mine.length ? mine : state.reports).slice(0, 4);
    if (!list.length) { root.innerHTML = ""; return; }
    root.innerHTML = '<p class="mini-line">' + (mine.length ? "Tus avisos en este dispositivo" : "Últimos avisos de este dispositivo") + "</p>" +
      list.map(function (r) {
        var due = dueInfo(r);
        return '<a class="my-report" href="#/aviso/' + encodeURIComponent(r.code) + '">' +
          '<span><span class="report-code">' + esc(r.code) + "</span> " + badgeType(r.type) + "</span>" +
          '<span class="rec-meta">' + esc(r.equipment) + " · " + esc(due.text) + "</span></a>";
      }).join("");
  }

  /* ------------------------------------------------------------------ */
  /* 11. VISTA: SEGUIMIENTO                                              */
  /* ------------------------------------------------------------------ */

  function reportPhotosBlock(report) {
    if (!report.photos.length) return '<div class="photo-empty">Sin evidencia fotográfica adjunta.</div>';
    return '<div class="photos' + (report.photos.length > 1 ? " two" : "") + '">' +
      report.photos.map(function (photo) {
        return '<a class="photo-link" href="#" data-action="open-photo" data-photo-id="' + esc(photo.id) + '" data-inline="' + (photo.inline ? "1" : "") + '">' +
          photoHtml(photo) + "<span>" + (photo.kind === "cierre" ? "Cierre" : "Reporte") + "</span></a>";
      }).join("") + "</div>";
  }

  function timelineBlock(report) {
    if (!report.events.length) return '<p class="muted-sm">Sin movimientos registrados.</p>';
    var events = report.events.slice().sort(function (a, b) { return new Date(a.at) - new Date(b.at); });
    return '<ol class="timeline">' + events.map(function (ev) {
      return "<li><div class=\"timeline-head\"><strong>" + esc(ACTION_LABEL[ev.action] || ev.action) + "</strong>" +
        (ev.toStatus && STATUSES[ev.toStatus] ? badgeStatus(ev.toStatus) : "") +
        "<time>" + esc(fmtDT(ev.at)) + "</time></div>" +
        (ev.note ? "<p>" + esc(ev.note) + "</p>" : "") +
        "<small>" + esc(ev.author || "Sistema") + " · " + esc(rel(ev.at)) + "</small></li>";
    }).join("") + "</ol>";
  }

  function progressBlock(report) {
    var index = STATUS_ORDER.indexOf(report.status);
    return '<ol class="progress-track">' + STATUS_ORDER.map(function (status, i) {
      var done = index >= i;
      var current = report.status === status;
      return '<li class="' + (done ? "done " : "") + (current ? "current" : "") + '"><b>' + (done ? "✓" : i + 1) + "</b>" +
        esc(STATUSES[status].label) + (current ? '<span class="badge b-neutral">Actual</span>' : "") + "</li>";
    }).join("") + "</ol>";
  }

  function dataList(report) {
    var rows = [
      ["Tipo", TYPES[report.type].label],
      ["Prioridad", SEVERITIES[report.severity].label + " · " + SEVERITIES[report.severity].desc],
      ["Operario", report.employeeName],
      ["Legajo", report.employeeId],
      ["Sector / turno", report.operatorSector + " · " + report.shift],
      ["Registrado", fmtDT(report.createdAt)],
      ["Responsable", report.assignedTo || "Sin asignar"],
      ["Última actualización", fmtDT(report.updatedAt)]
    ];
    if (report.phone) rows.push(["Teléfono", report.phone]);
    return '<dl class="data-list">' + rows.map(function (row) {
      return "<div><dt>" + esc(row[0]) + "</dt><dd>" + esc(row[1]) + "</dd></div>";
    }).join("") + "</dl>";
  }

  function renderTracking(code) {
    var root = $("#aviso-root");
    if (!root) return;
    var report = getReport(code);
    if (!report) {
      root.innerHTML = '<div class="card card-pad"><h1 class="h2">No encontramos el aviso</h1>' +
        '<p class="muted">Revisá el número (formato PR-2026-0000). Si lo cargó otro celular, pedile el link de seguimiento.</p>' +
        '<div class="row-actions mt-3"><a class="btn btn-primary" href="#/trazabilidad">Volver a Trazabilidad</a>' +
        '<a class="btn btn-light" href="#/reportar">Cargar un aviso</a></div></div>';
      return;
    }
    var due = dueInfo(report);
    var s = session();
    root.innerHTML =
      '<a class="link-arrow" href="#/trazabilidad">← Volver a Trazabilidad</a>' +
      '<div class="detail-head mt-3"><div><div class="detail-flags">' + badgeType(report.type) + badgeSeverity(report.severity) + badgeStatus(report.status) +
      (report.whatsappSentAt ? '<span class="badge b-wa">WhatsApp avisado</span>' : "") + "</div>" +
      '<h1>' + esc(report.code) + "</h1>" +
      '<p class="muted">' + esc(report.equipment) + (report.location ? " · " + esc(report.location) : "") + "</p></div>" +
      '<div class="sla-box ' + due.tone + '">' + esc(due.text) + "<span>Plazo: " + esc(fmtDT(report.dueAt)) + "</span></div></div>" +
      '<div class="detail-grid"><div class="detail-stack">' +
      '<section class="card card-pad"><h2 class="h4">Descripción del evento</h2>' +
      '<p class="muted" style="white-space:pre-line">' + esc(report.description) + "</p>" +
      (report.resolution ? '<div class="note note-ok mt-3"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.3 2.5 2.5 4.5-5"/></svg><span><strong>Resolución:</strong> ' + esc(report.resolution) + (report.resolvedAt ? "<br />Cerrado el " + esc(fmtDT(report.resolvedAt)) : "") + "</span></div>" : "") +
      '<p class="label" style="margin-top:14px">Evidencia fotográfica</p>' + reportPhotosBlock(report) + "</section>" +
      '<section class="card card-pad"><h2 class="h4">Trazabilidad del aviso</h2>' +
      '<p class="muted-sm">Todo lo que pasó con este evento, con fecha, autor y respaldo.</p>' + timelineBlock(report) + "</section>" +
      "</div><aside class=\"detail-stack\">" +
      '<section class="card card-pad"><h2 class="h4">Estado del circuito</h2>' + progressBlock(report) + "</section>" +
      '<section class="card card-pad"><h2 class="h4">Datos del aviso</h2>' + dataList(report) + "</section>" +
      '<section class="card card-pad"><h2 class="h4">Aviso al área</h2><div style="margin-top:8px">' + notifyBlock(report) + "</div>" +
      '<div class="mt-2">' + (s
        ? (canManage(report.type)
          ? '<a class="btn btn-dark btn-block" href="#/panel/' + encodeURIComponent(report.code) + '">Gestionar este aviso</a>'
          : '<div class="locked-note">Tu rol (' + esc(ROLES[s.role].label) + ") no puede gestionar avisos de " + esc(TYPES[report.type].label) + ". Podés verlos y sumar comentarios desde la gestión.</div>")
        : '<a class="btn btn-light btn-block" href="#/login">Ingresar al panel de gestión</a>') + "</div></section>" +
      "</aside></div>";
    hydratePhotos(root);
  }

  /* ------------------------------------------------------------------ */
  /* 12. VISTA: LOGIN                                                    */
  /* ------------------------------------------------------------------ */

  var loginRole = "admin";

  function renderLogin() {
    var root = $("#role-cards");
    if (!root) return;
    root.innerHTML = ROLE_ORDER.map(function (key) {
      return '<button class="role-card' + (key === loginRole ? " on" : "") + '" type="button" data-role="' + key + '" aria-pressed="' + (key === loginRole) + '">' +
        "<b>" + esc(ROLES[key].label) + "</b><small>" + esc(ROLES[key].desc) + "</small></button>";
    }).join("");
    if ($("#login-error")) { $("#login-error").textContent = ""; $("#login-error").classList.remove("visible"); }
    if ($("#login-pin")) $("#login-pin").value = "";
  }

  function validateRolePassword(pwd) {
    var clean = String(pwd || "").trim();
    if (clean.length <= 6) {
      return "Debe tener más de 6 caracteres (mínimo 7).";
    }
    if (!/[A-ZÁÉÍÓÚÑ]/.test(clean)) {
      return "Debe incluir al menos una letra mayúscula.";
    }
    if (!/\d/.test(clean)) {
      return "Debe incluir al menos un número.";
    }
    return "";
  }

  function doLogin() {
    var role = loginRole;
    var pin = (($("#login-pin") || {}).value || "").trim();
    var errorEl = $("#login-error");
    var rolePins = (state.settings && state.settings.rolePins) || {};
    var expected = String(rolePins[role] || state.settings.pin || "Sanjuan1").trim();

    var isMatch = false;
    if (pin) {
      // Si la contraseña guardada tiene mayúsculas/formato nuevo, validar respetando mayúsculas
      if (/[A-ZÁÉÍÓÚÑ]/.test(expected)) {
        isMatch = (pin === expected);
      } else {
        isMatch = (pin.toLowerCase() === expected.toLowerCase());
      }
      // Llaves de rescate solo para Administrador
      if (!isMatch && role === "admin") {
        var rescues = ["sanjuan1", "sanjuan", "admin", "1234"];
        if (rescues.indexOf(pin.toLowerCase()) !== -1) isMatch = true;
      }
    }

    if (!isMatch) {
      if (errorEl) {
        errorEl.textContent = role === "admin"
          ? "Contraseña de Administrador incorrecta."
          : "Contraseña incorrecta para " + ROLES[role].label + ". Respetá mayúsculas y números (si la olvidaste, pedile recuperación al Administrador).";
        errorEl.classList.add("visible");
      }
      return;
    }
    login(role);
    toast("Bienvenido: " + ROLES[role].label, "ok");
    location.hash = "#/panel";
  }

  function openChangeMyPinModal() {
    var s = session();
    if (!s) return;
    var roleLabel = ROLES[s.role].label;
    openModal({
      title: "Cambiar contraseña · " + roleLabel,
      body: '<p>Definí la nueva contraseña para <strong>' + esc(roleLabel) + '</strong>.</p>' +
        '<div class="field mt-3"><label for="modal-new-pin">Nueva contraseña</label>' +
        '<input id="modal-new-pin" type="text" maxlength="32" autocomplete="off" placeholder="Ej.: Produccion1" />' +
        '<small class="help">Debe tener más de 6 caracteres, al menos 1 mayúscula y 1 número.</small>' +
        '<small class="error" id="modal-pin-error"></small></div>',
      confirmText: "Guardar contraseña",
      onConfirm: function () {
        var input = $("#modal-new-pin");
        var errEl = $("#modal-pin-error");
        var val = ((input || {}).value || "").trim();
        var msg = validateRolePassword(val);
        if (msg) {
          if (errEl) { errEl.textContent = msg; errEl.classList.add("visible"); }
          if (input) { input.classList.add("invalid"); input.focus(); }
          toast(msg, "error");
          return false;
        }
        if (!state.settings.rolePins) state.settings.rolePins = {};
        state.settings.rolePins[s.role] = val;
        if (s.role === "admin") state.settings.pin = val;
        saveState();
        toast("Contraseña de " + roleLabel + " guardada correctamente.", "ok");
        return true;
      }
    });
    setTimeout(function () {
      var inp = $("#modal-new-pin");
      if (inp) {
        inp.focus();
        inp.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter") {
            ev.preventDefault();
            var confirmBtn = $("[data-modal-confirm]");
            if (confirmBtn) confirmBtn.click();
          }
        });
      }
    }, 60);
  }

  /* ------------------------------------------------------------------ */
  /* 13. VISTA: PANEL                                                    */
  /* ------------------------------------------------------------------ */

  var filters = { q: "", type: "", status: "", severity: "", equipment: "", overdue: false };

  function initPanelSelects() {
    var typeSel = $("#f-filter-type");
    if (typeSel) {
      typeSel.innerHTML = '<option value="">Todos los tipos</option>' + Object.keys(TYPES).map(function (k) {
        return '<option value="' + k + '">' + esc(TYPES[k].label) + "</option>";
      }).join("");
    }
    var statusSel = $("#f-filter-status");
    if (statusSel) {
      statusSel.innerHTML = '<option value="">Todos los estados</option>' + STATUS_ORDER.map(function (k) {
        return '<option value="' + k + '">' + esc(STATUSES[k].label) + "</option>";
      }).join("");
    }
    var sevSel = $("#f-filter-severity");
    if (sevSel) {
      sevSel.innerHTML = '<option value="">Toda prioridad</option>' + Object.keys(SEVERITIES).map(function (k) {
        return '<option value="' + k + '">' + esc(SEVERITIES[k].label) + "</option>";
      }).join("");
    }
    var eqSel = $("#f-filter-equipment");
    if (eqSel) {
      eqSel.innerHTML = '<option value="">Todos los equipos</option>' + ALL_EQUIPMENT.map(function (e) {
        return '<option value="' + esc(e) + '">' + esc(e) + "</option>";
      }).join("");
    }
  }

  function filterReports() {
    return state.reports.filter(function (r) {
      if (filters.type && r.type !== filters.type) return false;
      if (filters.status && r.status !== filters.status) return false;
      if (filters.severity && r.severity !== filters.severity) return false;
      if (filters.equipment && r.equipment !== filters.equipment) return false;
      if (filters.overdue) {
        var open = r.status === "abierto" || r.status === "en_proceso";
        if (!open || new Date(r.dueAt).getTime() >= Date.now()) return false;
      }
      if (filters.q) {
        var q = filters.q.toLowerCase();
        var haystack = [r.code, r.equipment, r.location, r.description, r.employeeName, r.employeeId, r.assignedTo].join(" ").toLowerCase();
        if (haystack.indexOf(q) === -1) return false;
      }
      return true;
    }).sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  }

  function renderPanel() {
    var s = session();
    var roleNote = $("#panel-role-note");
    if (roleNote && s) {
      var managed = ROLES[s.role].types === "all" ? "todos los tipos de aviso" : ROLES[s.role].types.map(function (t) { return TYPES[t].label; }).join(", ");
      var adminBtn = isAdmin()
        ? '<a class="btn btn-primary btn-sm" href="#/config">⚙ Configuración (Admin)</a>'
        : "";
      roleNote.hidden = false;
      roleNote.innerHTML =
        '<div class="role-bar-text">Sesión: <b>' + esc(ROLES[s.role].label) + "</b> · podés gestionar y cerrar avisos de " + esc(managed) + ".</div>" +
        '<div class="role-bar-actions">' +
        adminBtn +
        '<button class="btn btn-ghost btn-sm" type="button" data-action="change-my-pin">🔑 Mi contraseña</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-action="logout">Cambiar de usuario</button>' +
        "</div>";
    }

    var data = stats();
    var kpis = [
      { label: "Pendientes de cierre", value: data.active, hint: data.byStatus.abierto + " abiertos · " + data.byStatus.en_proceso + " en proceso", tone: "", href: "" },
      { label: "Fuera de plazo", value: data.overdue, hint: "Escalar en la reunión de turno", tone: data.overdue ? "is-danger" : "is-ok", href: "" },
      { label: "Resueltos (30 días)", value: data.resolved30, hint: "Cierre promedio: " + (data.avgHours === null ? "sin datos" : data.avgHours + " h"), tone: "is-ok", href: "" },
      { label: "Derivados por WhatsApp", value: data.whatsapp, hint: data.total + " avisos registrados", tone: "", href: "" }
    ];
    var kpiRoot = $("#panel-kpis");
    if (kpiRoot) {
      kpiRoot.innerHTML = kpis.map(function (k) {
        return '<div class="kpi-card ' + k.tone + '"><small>' + esc(k.label) + "</small><b>" + esc(k.value) + "</b><span>" + esc(k.hint) + "</span></div>";
      }).join("");
    }

    var analysisRoot = $("#panel-analysis");
    if (analysisRoot) {
      var typeColors = { mantenimiento: "#1d4ed8", "5s": "#0f766e", seguridad: "#c2410c" };
      var typeTotal = Object.keys(data.byType).reduce(function (a, k) { return a + data.byType[k]; }, 0) || 1;
      var sevColors = { baja: "#94a3b8", media: "#0ea5e9", alta: "#f59e0b", critica: "#dc2626" };
      var sevTotal = Object.keys(data.bySeverity).reduce(function (a, k) { return a + data.bySeverity[k]; }, 0) || 1;
      var typeBars = Object.keys(data.byType).map(function (k) { return '<span style="width:' + (data.byType[k] / typeTotal) * 100 + "%;background:" + typeColors[k] + '"></span>'; }).join("");
      var sevBars = Object.keys(data.bySeverity).map(function (k) { return '<span style="width:' + (data.bySeverity[k] / sevTotal) * 100 + "%;background:" + sevColors[k] + '"></span>'; }).join("");
      analysisRoot.innerHTML =
        '<div class="analysis-card"><h3>Avisos por tipo (90 días)</h3><div class="bar">' + typeBars + "</div><ul class=\"legend\">" +
        Object.keys(data.byType).map(function (k) {
          return "<li><span><i style=\"background:" + typeColors[k] + '"></i>' + esc(TYPES[k].short) + "</span><b>" + data.byType[k] + "<em>" + Math.round((data.byType[k] / typeTotal) * 100) + "%</em></b></li>";
        }).join("") + "</ul></div>" +
        '<div class="analysis-card"><h3>Prioridad de los avisos</h3><div class="bar">' + sevBars + "</div><ul class=\"legend\">" +
        Object.keys(data.bySeverity).map(function (k) {
          return "<li><span><i style=\"background:" + sevColors[k] + '"></i>' + esc(SEVERITIES[k].label) + "</span><b>" + data.bySeverity[k] + "</b></li>";
        }).join("") + '</ul><p class="mini-line">Crítica vence en 8 h</p></div>' +
        '<div class="analysis-card"><h3>Alertas de recurrencia</h3>' +
        (data.recurring.length
          ? '<ul class="recurrence">' + data.recurring.map(function (r) {
            return '<li><a href="#" data-action="filter-recurrence" data-equipment="' + esc(r.equipment) + '" data-type="' + esc(r.type) + '">' +
              '<div class="rec-eq">' + esc(r.equipment) + '</div><div class="rec-meta">' + r.total + " avisos de " + esc(TYPES[r.type].short) + " abiertos en 30 días</div></a></li>";
          }).join("") + "</ul>"
          : '<p class="muted-sm">Sin equipos con avisos repetidos abiertos en los últimos 30 días.</p>') +
        '<p class="mini-line">Equipos con más avisos</p><ul class="recurrence">' +
        (data.topEquipment.length ? data.topEquipment.map(function (t) {
          return '<li><div style="display:flex;justify-content:space-between;gap:8px"><span class="rec-eq">' + esc(t.equipment) + '</span><b class="rec-meta">' + t.total + "</b></div></li>";
        }).join("") : '<li class="rec-meta">Sin datos todavía.</li>') + "</ul></div>";
    }

    renderPanelList();
  }

  function renderPanelList() {
    var list = filterReports();
    var count = $("#panel-count");
    if (count) count.textContent = list.length + (list.length === 1 ? " aviso" : " avisos") + " con los filtros actuales";

    var quick = $("#panel-quick");
    if (quick) {
      quick.innerHTML = STATUS_ORDER.map(function (k) {
        return '<button class="badge" type="button" data-action="quick-status" data-status="' + k + '">' + esc(STATUSES[k].label) + " " + stats().byStatus[k] + "</button>";
      }).join("");
    }

    var root = $("#panel-list");
    if (!root) return;
    if (!list.length) {
      root.innerHTML = '<div class="empty"><strong>No hay avisos con estos filtros</strong><p>Probá limpiar los filtros o cargar un aviso nuevo.</p>' +
        '<div class="row-actions mt-3" style="justify-content:center"><button class="btn btn-light" type="button" data-action="clear-filters">Ver todos</button>' +
        '<a class="btn btn-primary" href="#/reportar">Cargar aviso</a></div></div>';
      return;
    }
    root.innerHTML = list.map(reportRow).join("");
    hydratePhotos(root);
  }

  function reportRow(r) {
    var due = dueInfo(r);
    var thumb = r.photos.length
      ? '<div class="report-thumb">' + photoHtml(r.photos[0]) + (r.photos.length > 1 ? '<span class="thumb-count">' + r.photos.length + " fotos</span>" : "") + "</div>"
      : '<div class="report-thumb"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3.5 22 20H2L12 3.5Z"/><path d="M12 9v5M12 17.2h.01"/></svg></div>';
    return '<a class="report-row" href="#/panel/' + encodeURIComponent(r.code) + '">' + thumb +
      '<div class="report-main"><div class="report-flags"><span class="report-code">' + esc(r.code) + "</span>" +
      badgeType(r.type) + badgeSeverity(r.severity) + (due.tone === "late" ? '<span class="badge b-late">Vencido</span>' : "") + "</div>" +
      '<div class="report-title">' + esc(r.equipment) + (r.location ? ' <span>· ' + esc(r.location) + "</span>" : "") + "</div>" +
      '<div class="report-desc">' + esc(r.description) + "</div>" +
      '<div class="report-who">' + esc(r.employeeName) + " · Legajo " + esc(r.employeeId) + " · " + esc(r.shift) + " · " + esc(rel(r.createdAt)) + "</div></div>" +
      '<div class="report-side">' + badgeStatus(r.status) +
      '<span class="sla ' + (due.tone === "late" ? "late" : due.tone === "warn" ? "warn" : "") + '">' + esc(due.text) + "</span>" +
      '<span class="report-open">Gestionar →</span></div></a>';
  }

  /* ------------------------------------------------------------------ */
  /* 14. VISTA: GESTIÓN DEL AVISO                                        */
  /* ------------------------------------------------------------------ */

  var pickedStatus = null;
  var closePhotoData = null;

  function renderGestion(code) {
    var root = $("#gestion-root");
    if (!root) return;
    var report = getReport(code);
    if (!report) {
      root.innerHTML = '<div class="card card-pad"><h1 class="h2">Aviso no encontrado</h1><p class="muted">El aviso ' + esc(code) + " no existe en este dispositivo.</p>" +
        '<a class="btn btn-primary mt-3" href="#/panel">Volver al panel</a></div>';
      return;
    }
    var s = session();
    var allowed = canManage(report.type);
    var due = dueInfo(report);
    pickedStatus = report.status;
    closePhotoData = null;

    var managePanel = allowed
      ? '<div class="manage-card"><h2>Gestionar estado</h2><p>Cada cambio queda firmado en la bitácora.</p>' +
        '<div class="status-picker" id="status-picker">' + STATUS_ORDER.map(function (k) {
          return '<button type="button" data-action="pick-status" data-status="' + k + '" class="' + (report.status === k ? "on" : "") + '">' + esc(STATUSES[k].label) + "</button>";
        }).join("") + "</div>" +
        '<div class="field mt-2" id="resolution-field" hidden><label for="g-resolution">Acción realizada <b>*</b></label>' +
        '<textarea id="g-resolution" rows="3" maxlength="2000" placeholder="Ej.: Se reemplazó el retén del cilindro y se limpió el piso.">' + esc(report.resolution || "") + "</textarea></div>" +
        '<div class="field mt-2"><label for="g-note">Nota de seguimiento (opcional)</label><input id="g-note" type="text" maxlength="2000" placeholder="Ej.: Se inspecciona en el cambio de turno." /></div>' +
        '<div class="field mt-2" id="close-photo-field" hidden><label for="g-photo">Foto de cierre (opcional)</label>' +
        '<input id="g-photo" type="file" accept="image/*" /></div>' +
        '<div class="field mt-2"><label for="g-author">Tu nombre (queda en la bitácora)</label><input id="g-author" type="text" maxlength="90" value="' + esc(ROLES[s.role].label) + '" /></div>' +
        '<button class="btn btn-dark btn-block" type="button" data-action="save-status" data-code="' + esc(report.code) + '">Guardar estado</button></div>' +
        '<div class="manage-card"><h2>Responsable</h2><p>Asigná quién toma el aviso.</p>' +
        '<div class="field mt-2"><input id="g-assignee" type="text" maxlength="90" placeholder="Ej.: Mantenimiento - José Ríos" value="' + esc(report.assignedTo || "") + '" /></div>' +
        '<div class="field"><input id="g-assign-note" type="text" maxlength="2000" placeholder="Nota de asignación (opcional)" /></div>' +
        '<button class="btn btn-light btn-block" type="button" data-action="assign" data-code="' + esc(report.code) + '">Asignar responsable</button></div>' +
        '<div class="manage-card"><h2>Agregar a la bitácora</h2><p>Documentá avances, pedidos de repuesto o inspecciones.</p>' +
        '<div class="field mt-2"><textarea id="g-comment" rows="3" maxlength="2000" placeholder="Ej.: Se pidió repuesto al pañol. Llega el jueves."></textarea></div>' +
        '<button class="btn btn-light btn-block" type="button" data-action="comment" data-code="' + esc(report.code) + '">Registrar comentario</button></div>' +
        (isAdmin()
          ? '<div class="manage-card"><h2>Administración</h2><p>Solo el Administrador puede eliminar avisos.</p>' +
            '<button class="btn btn-danger btn-block mt-2" type="button" data-action="delete-report" data-code="' + esc(report.code) + '">Eliminar aviso</button></div>'
          : "")
      : '<div class="manage-card"><h2>Solo lectura</h2><div class="locked-note mt-2">Tu rol (' + esc(s ? ROLES[s.role].label : "sin sesión") + ") no puede cerrar avisos de " +
        esc(TYPES[report.type].label) + '. <a href="#" data-action="logout">Cambiar de usuario</a> o pedile al área responsable que lo gestione.</div></div>';

    root.innerHTML =
      '<a class="link-arrow" href="#/panel">← Volver al panel</a>' +
      '<div class="detail-head mt-3"><div><div class="detail-flags">' + badgeType(report.type) + badgeSeverity(report.severity) + badgeStatus(report.status) +
      (report.whatsappSentAt ? '<span class="badge b-wa">WhatsApp avisado</span>' : "") + "</div>" +
      "<h1>" + esc(report.code) + "</h1>" +
      '<p class="muted">' + esc(report.equipment) + (report.location ? " · " + esc(report.location) : "") + " · registrado " + esc(rel(report.createdAt)) + "</p></div>" +
      '<div class="row-actions"><a class="btn btn-light" href="#/aviso/' + encodeURIComponent(report.code) + '">Ver seguimiento</a>' +
      '<div class="sla-box ' + due.tone + '">' + esc(due.text) + "<span>Plazo " + esc(fmtDT(report.dueAt)) + "</span></div></div></div>" +
      '<div class="detail-grid"><div class="detail-stack">' +
      '<section class="card card-pad"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><h2 class="h4">Evento reportado</h2>' +
      '<span class="badge b-neutral">Prioridad ' + esc(SEVERITIES[report.severity].label) + " · SLA " + SEVERITIES[report.severity].sla + " h</span></div>" +
      '<p class="muted" style="white-space:pre-line;margin-top:8px">' + esc(report.description) + "</p>" +
      (report.resolution ? '<div class="note note-ok mt-3"><span><strong>Resolución:</strong> ' + esc(report.resolution) + "</span></div>" : "") +
      '<p class="label" style="margin-top:14px">Evidencia (' + report.photos.length + ")</p>" + reportPhotosBlock(report) + "</section>" +
      '<section class="card card-pad"><h2 class="h4">Bitácora / trazabilidad</h2>' + timelineBlock(report) + "</section>" +
      '<section class="card card-pad"><h2 class="h4">Historial del equipo</h2>' + equipmentHistory(report) + "</section>" +
      "</div><aside class=\"detail-stack\">" +
      '<section class="card card-pad"><h2 class="h4">Aviso al área</h2><div style="margin-top:8px">' + notifyBlock(report) + "</div>" +
      '<div class="share-box mt-2"><strong style="font-size:11.5px">Pasar este aviso a otro dispositivo</strong>' +
      '<p class="muted-xs" style="margin-top:3px">Copiá el link y enviálo por WhatsApp. Al abrirlo, el aviso se importa en el panel de ese dispositivo.</p>' +
      '<button class="btn btn-light btn-sm mt-2" type="button" data-action="copy-import" data-code="' + esc(report.code) + '">Copiar link de importación</button></div></section>' +
      '<section class="card card-pad"><h2 class="h4">Datos del aviso</h2>' + dataList(report) + "</section>" +
      managePanel + "</aside></div>";

    hydratePhotos(root);
    wireGestion(report);
  }

  function equipmentHistory(report) {
    var others = state.reports.filter(function (r) { return r.equipment === report.equipment && r.code !== report.code; }).slice(0, 5);
    if (!others.length) return '<p class="muted-sm">Es el primer aviso registrado para este equipo.</p>';
    return '<ul class="recurrence">' + others.map(function (r) {
      return '<li><a href="#/panel/' + encodeURIComponent(r.code) + '"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center">' +
        '<span><span class="report-code">' + esc(r.code) + "</span> " + badgeType(r.type) + '</span><span class="rec-meta">' + esc(rel(r.createdAt)) + "</span></div>" +
        '<div class="rec-meta" style="margin-top:2px">' + esc(r.description.slice(0, 90)) + "</div></a></li>";
    }).join("") + "</ul>";
  }

  function wireGestion(report) {
    var picker = $("#status-picker");
    if (!picker) return;
    function syncStatusFields() {
      var needsResolution = pickedStatus === "resuelto" || pickedStatus === "cerrado";
      var resField = $("#resolution-field");
      var photoField = $("#close-photo-field");
      if (resField) resField.hidden = !needsResolution;
      if (photoField) photoField.hidden = !needsResolution;
      $$("#status-picker button").forEach(function (btn) {
        btn.classList.toggle("on", btn.getAttribute("data-status") === pickedStatus);
      });
    }
    picker.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-status]");
      if (!btn) return;
      pickedStatus = btn.getAttribute("data-status");
      syncStatusFields();
    });
    var photoInput = $("#g-photo");
    if (photoInput) {
      photoInput.addEventListener("change", function () {
        var file = photoInput.files && photoInput.files[0];
        if (!file) return;
        compressImage(file).then(function (dataUrl) { closePhotoData = dataUrl; toast("Foto de cierre lista para guardar.", "ok"); })
          .catch(function (err) { toast(err.message, "error"); });
      });
    }
    syncStatusFields();
  }

  function saveStatus(code) {
    var report = getReport(code);
    if (!report) return;
    if (!canManage(report.type)) { toast("Tu rol no puede gestionar este tipo de aviso.", "error"); return; }
    var author = ($("#g-author") || {}).value || ROLES[session().role].label;
    var note = ($("#g-note") || {}).value || "";
    var resolution = ($("#g-resolution") || {}).value || "";
    if ((pickedStatus === "resuelto" || pickedStatus === "cerrado") && resolution.trim().length < 5) {
      toast("Describí la acción realizada para resolver o cerrar el aviso.", "error");
      return;
    }
    var patch = { status: pickedStatus };
    var event = { action: "estado", author: author, toStatus: pickedStatus, note: note };
    if (pickedStatus === "resuelto" || pickedStatus === "cerrado") {
      patch.resolution = resolution;
      patch.resolvedAt = report.resolvedAt || iso(new Date());
      event.note = "Resolución: " + resolution + (note ? " · " + note : "");
    } else {
      patch.resolvedAt = null;
    }
    if (closePhotoData) {
      var photoId = "ph-" + uid();
      idbPut(photoId, closePhotoData).then(function () {
        report.photos.push({ id: photoId, kind: "cierre", caption: "Evidencia de cierre" });
        addEvent(report, "evidencia", author, "Se adjuntó la foto de cierre.", null);
        updateReport(code, patch, event);
        renderGestion(code);
        toast("Estado y foto de cierre guardados.", "ok");
      });
      return;
    }
    updateReport(code, patch, event);
    renderGestion(code);
    toast("Estado actualizado: " + STATUSES[pickedStatus].label, "ok");
  }

  function saveAssign(code) {
    var report = getReport(code);
    if (!report) return;
    if (!canManage(report.type)) { toast("Tu rol no puede gestionar este aviso.", "error"); return; }
    var assignedTo = ($("#g-assignee") || {}).value || "";
    var note = ($("#g-assign-note") || {}).value || "";
    updateReport(code, { assignedTo: assignedTo }, {
      action: "asignacion",
      author: ($("#g-author") || {}).value || ROLES[session().role].label,
      note: assignedTo ? "Responsable asignado: " + assignedTo + (note ? " · " + note : "") : "Se quitó el responsable asignado."
    });
    renderGestion(code);
    toast("Responsable actualizado.", "ok");
  }

  function saveComment(code) {
    var report = getReport(code);
    if (!report) return;
    var comment = ($("#g-comment") || {}).value || "";
    if (comment.trim().length < 3) { toast("Escribí el comentario.", "error"); return; }
    updateReport(code, {}, {
      action: "comentario",
      author: ($("#g-author") || {}).value || (session() ? ROLES[session().role].label : "Sector"),
      note: comment
    });
    renderGestion(code);
    toast("Comentario agregado a la bitácora.", "ok");
  }

  function deleteReport(code) {
    if (!isAdmin()) { toast("Solo el Administrador puede eliminar avisos.", "error"); return; }
    var report = getReport(code);
    if (!report) return;
    openModal({
      title: "Eliminar aviso " + report.code,
      body: "<p>Se va a eliminar el aviso y sus fotos de este dispositivo. Esta acción no se puede deshacer.</p>",
      confirmText: "Eliminar aviso",
      danger: true,
      onConfirm: function () {
        report.photos.forEach(function (p) { if (p.id) idbDel(p.id); });
        state.reports = state.reports.filter(function (r) { return r.code !== report.code; });
        saveState();
        toast("Aviso eliminado.", "ok");
        location.hash = "#/panel";
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* 15. VISTA: QR                                                       */
  /* ------------------------------------------------------------------ */

  function qrSrc(url, size) {
    return "https://api.qrserver.com/v1/create-qr-code/?size=" + (size || 320) + "x" + (size || 320) + "&margin=10&data=" + encodeURIComponent(url);
  }

  function renderQR() {
    var base = appBaseUrl();
    var reportUrl = base ? base + "#/reportar" : "";
    if ($("#qr-base-url")) $("#qr-base-url").textContent = reportUrl || "Publicá la app para obtener la URL definitiva";
    if ($("#qr-poster-url")) $("#qr-poster-url").textContent = reportUrl || "—";
    var img = $("#qr-poster-img");
    if (img) {
      if (reportUrl) img.src = qrSrc(reportUrl, 360);
      else img.removeAttribute("src");
    }
    if (!base) toast("Abrí la app desde su URL publicada para que el QR funcione.", "warn");

    var grid = $("#qr-equipment-grid");
    if (grid) {
      grid.innerHTML = QR_EQUIPMENT.map(function (equipment) {
        var url = reportUrl ? reportUrl + "?equipo=" + encodeURIComponent(equipment) : "";
        return '<div class="qr-item">' +
          (url ? '<img loading="lazy" src="' + qrSrc(url, 240) + '" alt="QR para ' + esc(equipment) + '" />' : '<div style="height:110px;display:grid;place-items:center;color:var(--concrete-400);font-size:11px">Sin URL</div>') +
          "<strong>" + esc(equipment) + "</strong>" +
          '<div class="qr-actions">' +
          (url ? '<a class="btn btn-light btn-sm" href="' + qrSrc(url, 520) + '" download="qr-' + esc(equipment.replace(/\s+/g, "-").toLowerCase()) + '.png" target="_blank" rel="noopener">PNG</a>' +
            '<button class="btn btn-light btn-sm" type="button" data-action="copy-url" data-url="' + esc(url) + '">Link</button>' : "") +
          "</div></div>";
      }).join("");
    }

    var tips = $("#qr-tips");
    if (tips) {
      tips.innerHTML = [
        { t: "Laminá el póster", d: "El sector tiene polvo y humedad. Plastificá la hoja antes de pegarla." },
        { t: "Altura de lectura", d: "Pegalo a la altura de los ojos, cerca del tablero del turno." },
        { t: "Probalo en el turno", d: "Escaneá el QR delante del operario y mostrale el flujo una vez." }
      ].map(function (tip) {
        return '<div class="card card-pad"><strong style="font-size:12.5px">' + esc(tip.t) + '</strong><p class="muted-sm">' + esc(tip.d) + "</p></div>";
      }).join("");
    }
  }

  /* ------------------------------------------------------------------ */
  /* 16. VISTA: CONFIGURACIÓN                                            */
  /* ------------------------------------------------------------------ */

  function populateSupAreaSelect() {
    var sel = $("#sup-area");
    if (!sel) return;
    var current = sel.value;
    var opts = getAllAreaOptions();
    sel.innerHTML = opts.map(function (o) {
      return '<option value="' + esc(o.id) + '">' + esc(o.label) + "</option>";
    }).join("");
    if (current && opts.some(function (o) { return o.id === current; })) sel.value = current;
  }

  function renderCustomAreasList() {
    var root = $("#custom-areas-list");
    if (!root) return;
    var customs = state.settings.customAreas || [];
    if (!customs.length) { root.innerHTML = ""; return; }
    root.innerHTML = customs.map(function (c) {
      return '<span class="badge b-neutral" style="padding:4px 9px;gap:6px">' + esc(c.label) +
        ' <button type="button" data-remove-area="' + esc(c.id) + '" style="border:0;background:transparent;cursor:pointer;font-weight:800;color:var(--red-500);padding:0 2px" aria-label="Quitar rol">×</button></span>';
    }).join("");
  }

  function addCustomArea(event) {
    if (event) event.preventDefault();
    var input = $("#custom-area-name");
    var label = ((input || {}).value || "").trim();
    if (label.length < 3) { toast("Escribí el nombre del nuevo rol o categoría.", "error"); return; }
    if (!Array.isArray(state.settings.customAreas)) state.settings.customAreas = [];
    var exists = state.settings.customAreas.some(function (c) { return c.label.toLowerCase() === label.toLowerCase(); });
    if (exists) { toast("Esa categoría ya existe.", "warn"); return; }
    var newId = "cat-" + uid();
    state.settings.customAreas.push({ id: newId, label: label });
    saveState();
    if (input) input.value = "";
    populateSupAreaSelect();
    if ($("#sup-area")) $("#sup-area").value = newId;
    renderCustomAreasList();
    toast("Rol guardado: " + label, "ok");
  }

  function renderSupervisorsList() {
    var root = $("#supervisors-list");
    if (!root) return;
    var sups = state.settings.supervisors || [];
    if (!sups.length) {
      root.innerHTML = '<div class="empty" style="padding:20px"><strong style="font-size:13px">Todavía no hay supervisores cargados</strong><p>Agregá arriba los números de Mantenimiento, Producción (5S), Seguridad e Higiene o los roles personalizados que crees.</p></div>';
      return;
    }
    root.innerHTML = sups.map(function (s) {
      var areaInfo = getAreaInfo(s.area);
      return '<div class="sup-item">' +
        '<div class="sup-item-main"><strong>' + esc(s.name) + ' <span class="badge ' + areaInfo.badge + '">' + esc(areaInfo.label) + "</span></strong>" +
        "<small>" + esc(s.shift || "Todos los turnos") + " · WhatsApp: +" + esc(s.phone) + "</small></div>" +
        '<button class="btn btn-danger btn-sm" type="button" data-remove-sup="' + esc(s.id) + '">Quitar</button></div>';
    }).join("");
  }

  function addSupervisor(event) {
    if (event) event.preventDefault();
    var name = (($("#sup-name") || {}).value || "").trim();
    var phone = (($("#sup-phone") || {}).value || "").replace(/[^\d]/g, "");
    var area = (($("#sup-area") || {}).value || "mantenimiento");
    var shift = (($("#sup-shift") || {}).value || "Todos los turnos");
    if (name.length < 3) { toast("Ingresá el nombre o cargo del supervisor.", "error"); return; }
    if (phone.length < 8) { toast("Ingresá un número de WhatsApp válido (ej.: 5492645550101).", "error"); return; }
    if (!Array.isArray(state.settings.supervisors)) state.settings.supervisors = [];
    state.settings.supervisors.push({
      id: "sup-" + uid(),
      name: name,
      area: area,
      shift: shift,
      phone: phone
    });
    saveState();
    if ($("#sup-name")) $("#sup-name").value = "";
    if ($("#sup-phone")) $("#sup-phone").value = "";
    renderSupervisorsList();
    renderConfig();
    toast("Supervisor agregado: " + name, "ok");
  }

  function renderConfig() {
    if (!isAdmin()) return;
    var set = state.settings;
    var rp = set.rolePins || {};
    populateSupAreaSelect();
    renderCustomAreasList();
    renderSupervisorsList();
    if ($("#cfg-planta")) $("#cfg-planta").value = set.planta || "";
    if ($("#cfg-pin-admin")) $("#cfg-pin-admin").value = rp.admin || set.pin || "sanjuan";
    if ($("#cfg-pin-produccion")) $("#cfg-pin-produccion").value = rp.produccion || "sanjuan";
    if ($("#cfg-pin-mantenimiento")) $("#cfg-pin-mantenimiento").value = rp.mantenimiento || "sanjuan";
    if ($("#cfg-pin-seguridad")) $("#cfg-pin-seguridad").value = rp.seguridad || "sanjuan";
    var note = $("#config-role-note");
    if (note) {
      note.hidden = false;
      note.innerHTML = "Sesión exclusiva de <b>Administrador</b>: desde acá cargás los números de supervisores y podés ver o recuperar las contraseñas de todos los sectores.";
    }
    var photoCount = state.reports.reduce(function (acc, r) { return acc + r.photos.length; }, 0);
    var bytes = 0;
    try { bytes = new Blob([JSON.stringify(state)]).size; } catch (err) { bytes = 0; }
    if ($("#storage-info")) {
      $("#storage-info").innerHTML = [
        ["Supervisores configurados", (set.supervisors || []).length],
        ["Avisos guardados", state.reports.length],
        ["Fotos guardadas", photoCount],
        ["Datos (sin fotos)", (bytes / 1024).toFixed(1) + " KB"]
      ].map(function (row) { return "<div><span>" + esc(row[0]) + "</span><b>" + esc(row[1]) + "</b></div>"; }).join("");
    }
  }

  function saveConfig(event) {
    if (event) event.preventDefault();
    if (!isAdmin()) { toast("Solo el Administrador puede modificar la configuración.", "error"); return; }
    state.settings.planta = ($("#cfg-planta") || {}).value || "";
    var pAdmin = (($("#cfg-pin-admin") || {}).value || "").trim();
    var pProd = (($("#cfg-pin-produccion") || {}).value || "").trim();
    var pMant = (($("#cfg-pin-mantenimiento") || {}).value || "").trim();
    var pSeg = (($("#cfg-pin-seguridad") || {}).value || "").trim();
    var checkEntries = [
      { label: "Administrador", val: pAdmin, cur: (state.settings.rolePins || {}).admin, el: "#cfg-pin-admin" },
      { label: "Producción (5S)", val: pProd, cur: (state.settings.rolePins || {}).produccion, el: "#cfg-pin-produccion" },
      { label: "Mantenimiento", val: pMant, cur: (state.settings.rolePins || {}).mantenimiento, el: "#cfg-pin-mantenimiento" },
      { label: "Seguridad", val: pSeg, cur: (state.settings.rolePins || {}).seguridad, el: "#cfg-pin-seguridad" }
    ];
    for (var i = 0; i < checkEntries.length; i++) {
      var item = checkEntries[i];
      // Validar toda contraseña nueva o modificada (o cualquiera que no sea el valor inicial heredado sin tocar)
      if (item.val !== item.cur || validateRolePassword(item.val) === "") {
        var pwdErr = validateRolePassword(item.val);
        if (pwdErr) {
          if ($(item.el)) { $(item.el).classList.add("invalid"); $(item.el).focus(); }
          toast("Contraseña de " + item.label + ": " + pwdErr, "error");
          return;
        }
      }
    }
    state.settings.rolePins = {
      admin: pAdmin,
      produccion: pProd,
      mantenimiento: pMant,
      seguridad: pSeg
    };
    state.settings.pin = pAdmin;
    saveState();
    if ($("#config-saved")) {
      $("#config-saved").textContent = "Guardado el " + fmtDT(new Date());
      setTimeout(function () { if ($("#config-saved")) $("#config-saved").textContent = ""; }, 4000);
    }
    toast("Contraseñas y configuración guardadas.", "ok");
    renderConfig();
  }

  /* ------------------------------------------------------------------ */
  /* 17. RESPALDOS / CSV                                                 */
  /* ------------------------------------------------------------------ */

  function exportCsv() {
    var header = ["Codigo", "Fecha", "Tipo", "Prioridad", "Estado", "Equipo", "Ubicacion", "Descripcion",
      "Operario", "Legajo", "Sector", "Turno", "Responsable", "Plazo", "Resuelto", "Resolucion", "WhatsApp"];
    var rows = state.reports.slice().sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); }).map(function (r) {
      return [r.code, fmtDT(r.createdAt), TYPES[r.type].label, SEVERITIES[r.severity].label, STATUSES[r.status].label,
        r.equipment, r.location, r.description, r.employeeName, r.employeeId, r.operatorSector, r.shift,
        r.assignedTo || "", fmtDT(r.dueAt), fmtDT(r.resolvedAt), r.resolution || "", r.whatsappSentAt ? "SI" : "NO"];
    });
    var csv = "\uFEFF" + [header].concat(rows).map(function (row) {
      return row.map(function (cell) { return '"' + String(cell === null || cell === undefined ? "" : cell).replace(/"/g, '""') + '"'; }).join(";");
    }).join("\r\n");
    download("aviso-en-linea-" + new Date().toISOString().slice(0, 10) + ".csv", csv, "text/csv;charset=utf-8");
    toast("CSV exportado. Se abre en Excel.", "ok");
  }

  function exportJson() {
    var photos = {};
    var pending = [];
    state.reports.forEach(function (r) {
      r.photos.forEach(function (p) {
        if (p.inline) return;
        pending.push(idbGet(p.id).then(function (dataUrl) { if (dataUrl) photos[p.id] = dataUrl; }));
      });
    });
    Promise.all(pending).then(function () {
      var payload = {
        app: "AVISO EN LÍNEA", version: VERSION, exportedAt: iso(new Date()),
        settings: state.settings, reports: state.reports, photos: photos
      };
      download("aviso-en-linea-respaldo-" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify(payload), "application/json");
      toast("Respaldo descargado (incluye fotos).", "ok");
    });
  }

  function importJsonFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function () { toast("No pudimos leer el archivo.", "error"); };
    reader.onload = function () {
      var data;
      try { data = JSON.parse(String(reader.result || "{}")); } catch (err) { toast("El archivo no es un respaldo válido.", "error"); return; }
      var incoming = Array.isArray(data.reports) ? data.reports : (Array.isArray(data) ? data : null);
      if (!incoming) { toast("El archivo no contiene avisos.", "error"); return; }
      openModal({
        title: "Importar respaldo",
        body: "<p>El archivo tiene <strong>" + incoming.length + "</strong> aviso(s). Se van a sumar a los " + state.reports.length +
          " avisos de este dispositivo, sin duplicar los números existentes.</p>",
        confirmText: "Importar",
        onConfirm: function () {
          var photos = data.photos || {};
          var imported = 0;
          var photoJobs = [];
          incoming.forEach(function (raw) {
            var report = normalizeReport(raw);
            if (!report.code || getReport(report.code)) return;
            report.photos = (report.photos || []).map(function (p) {
              if (p.inline || !p.id) return p;
              if (photos[p.id]) { photoJobs.push(idbPut(p.id, photos[p.id])); }
              return p;
            });
            state.reports.push(report);
            imported++;
          });
          state.reports.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
          var maxId = state.reports.reduce(function (acc, r) { return Math.max(acc, Number(r.id) || 0); }, 0);
          state.meta.nextId = Math.max(state.meta.nextId, maxId + 1);
          saveState();
          Promise.all(photoJobs).then(function () {
            toast("Importados " + imported + " aviso(s).", "ok");
            refresh();
          });
        }
      });
    };
    reader.readAsText(file);
  }

  /* ------------------------------------------------------------------ */
  /* 18. VISTA: IMPORTAR LINK                                            */
  /* ------------------------------------------------------------------ */

  function renderImport(payload) {
    var root = $("#import-root");
    if (!root) return;
    var data = decodeShare(payload);
    if (!data) {
      root.innerHTML = '<div class="card card-pad"><h1 class="h2">Link inválido</h1><p class="muted">El link de importación está incompleto o dañado. Pedile al operario que lo copie de nuevo.</p>' +
        '<a class="btn btn-primary mt-3" href="#/panel">Ir al panel</a></div>';
      return;
    }
    var existing = getReport(data.code);
    pendingImport = data;
    root.innerHTML =
      '<p class="eyebrow">Importar aviso</p><h1 class="h2">' + esc(data.code) + "</h1>" +
      '<div class="detail-flags mt-2">' + badgeType(data.type) + badgeSeverity(data.severity) + badgeStatus(data.status) + "</div>" +
      '<div class="card card-pad mt-3"><dl class="data-list">' +
      [["Equipo", data.equipment + (data.location ? " · " + data.location : "")], ["Operario", data.employeeName + " · Legajo " + data.employeeId],
        ["Sector / turno", data.operatorSector + " · " + data.shift], ["Registrado", fmtDT(data.createdAt)], ["Plazo", fmtDT(data.dueAt)],
        ["Detalle", data.description]]
        .map(function (row) { return "<div><dt>" + esc(row[0]) + "</dt><dd>" + esc(row[1]) + "</dd></div>"; }).join("") + "</dl></div>" +
      (existing
        ? '<div class="note note-soft mt-3"><span>Este aviso ya está en este dispositivo. <a href="#/aviso/' + encodeURIComponent(existing.code) + '">Ver seguimiento</a></span></div>'
        : '<div class="row-actions mt-3"><button class="btn btn-primary" type="button" data-action="save-import">Guardar en este dispositivo</button>' +
          '<a class="btn btn-light" href="#/panel">Cancelar</a></div>' +
          '<div class="note note-soft mt-3"><span>Importante: el link no incluye las fotos (por tamaño). Las fotos originales quedan en el celular que registró el aviso y pueden enviarse por WhatsApp.</span></div>');
  }

  function saveImport() {
    if (!pendingImport) return;
    if (getReport(pendingImport.code)) { toast("El aviso ya existe en este dispositivo.", "warn"); return; }
    var now = new Date();
    var report = normalizeReport({
      id: state.meta.nextId++, code: pendingImport.code, employeeName: pendingImport.employeeName,
      employeeId: pendingImport.employeeId, operatorSector: pendingImport.operatorSector, shift: pendingImport.shift,
      phone: "", type: pendingImport.type, severity: pendingImport.severity, equipment: pendingImport.equipment,
      location: pendingImport.location, description: pendingImport.description, status: pendingImport.status,
      assignedTo: "", resolution: "", resolvedAt: null, whatsappSentAt: null,
      createdAt: pendingImport.createdAt, updatedAt: iso(now), dueAt: pendingImport.dueAt, photos: [],
      events: [{ action: "importado", author: "Panel de sector", note: "Aviso importado desde el link compartido por el operario.", toStatus: pendingImport.status, at: iso(now) }]
    });
    state.reports.unshift(report);
    saveState();
    toast("Aviso importado: " + report.code, "ok");
    pendingImport = null;
    location.hash = "#/panel/" + encodeURIComponent(report.code);
  }

  /* ------------------------------------------------------------------ */
  /* 19. ACCIONES DELEGADAS                                              */
  /* ------------------------------------------------------------------ */

  function handleClick(event) {
    var target = event.target;

    var quickType = target.closest("[data-quick-type]");
    if (quickType) {
      form.type = quickType.getAttribute("data-quick-type");
      wizardStep = 1;
      syncWizard();
      location.hash = "#/reportar";
      toast("Tipo seleccionado: " + TYPES[form.type].label + ". Completá tus datos.", "ok");
      return;
    }

    var roleBtn = target.closest("[data-role]");
    if (roleBtn) {
      loginRole = roleBtn.getAttribute("data-role");
      renderLogin();
      return;
    }

    var shiftBtn = target.closest("[data-shift]");
    if (shiftBtn) {
      form.shift = shiftBtn.getAttribute("data-shift");
      var shiftErr = $('.error[data-error-for="shift"]');
      if (shiftErr) { shiftErr.textContent = ""; shiftErr.classList.remove("visible"); }
      syncWizard();
      return;
    }

    var typeBtn = target.closest("[data-type]");
    if (typeBtn && typeBtn.classList.contains("type-card")) {
      form.type = typeBtn.getAttribute("data-type");
      var typeErr = $('.error[data-error-for="type"]');
      if (typeErr) { typeErr.textContent = ""; typeErr.classList.remove("visible"); }
      syncWizard();
      return;
    }

    var sevBtn = target.closest("[data-severity]");
    if (sevBtn && sevBtn.classList.contains("sev")) {
      form.severity = sevBtn.getAttribute("data-severity");
      var sevErr = $('.error[data-error-for="severity"]');
      if (sevErr) { sevErr.textContent = ""; sevErr.classList.remove("visible"); }
      syncWizard();
      return;
    }

    var tagBtn = target.closest("[data-tag]");
    if (tagBtn) {
      var tag = tagBtn.getAttribute("data-tag");
      var area = $("#f-description");
      if (area) {
        var value = area.value.trim();
        if (value.toLowerCase().indexOf(tag.toLowerCase()) === -1) {
          area.value = (value ? value.replace(/\.$/, "") + ". " : "") + tag + ".";
          form.description = area.value;
          if ($("#char-count")) $("#char-count").textContent = area.value.length + "/2000";
        }
        area.focus();
      }
      return;
    }

    var toggleRec = target.closest("[data-toggle-recipient]");
    if (toggleRec) {
      var recId = toggleRec.getAttribute("data-toggle-recipient");
      var idxRec = form.selectedRecipients.indexOf(recId);
      if (idxRec === -1) form.selectedRecipients.push(recId);
      else form.selectedRecipients.splice(idxRec, 1);
      renderStep4Recipients();
      return;
    }

    var removeArea = target.closest("[data-remove-area]");
    if (removeArea) {
      var areaId = removeArea.getAttribute("data-remove-area");
      var used = (state.settings.supervisors || []).some(function (s) { return s.area === areaId; });
      if (used) { toast("Primero quitá los supervisores asignados a este rol.", "warn"); return; }
      state.settings.customAreas = (state.settings.customAreas || []).filter(function (c) { return c.id !== areaId; });
      saveState();
      populateSupAreaSelect();
      renderCustomAreasList();
      toast("Categoría eliminada.", "ok");
      return;
    }

    var removeSup = target.closest("[data-remove-sup]");
    if (removeSup) {
      var supId = removeSup.getAttribute("data-remove-sup");
      state.settings.supervisors = (state.settings.supervisors || []).filter(function (s) { return s.id !== supId; });
      saveState();
      renderSupervisorsList();
      renderConfig();
      toast("Supervisor eliminado.", "ok");
      return;
    }

    var removePhoto = target.closest("[data-remove-photo]");
    if (removePhoto) {
      var index = Number(removePhoto.getAttribute("data-remove-photo"));
      form.photos.splice(index, 1);
      renderPhotos();
      return;
    }

    if (target.closest("#photo-add")) {
      var input = $("#photo-input");
      if (input) input.click();
      return;
    }

    if (target.closest("#nav-toggle")) {
      var nav = $("#mainnav");
      if (nav) {
        nav.classList.toggle("open");
        $("#nav-toggle").setAttribute("aria-expanded", nav.classList.contains("open") ? "true" : "false");
      }
      return;
    }

    if (target.closest("[data-modal-close]")) { closeModal(); return; }
    if (target.id === "modal-root") { closeModal(); return; }

    var actionEl = target.closest("[data-action]");
    if (!actionEl) return;
    var action = actionEl.getAttribute("data-action");
    var code = actionEl.getAttribute("data-code") || "";

    if (action === "logout") { event.preventDefault(); logout(); return; }
    if (action === "change-my-pin") { event.preventDefault(); openChangeMyPinModal(); return; }
    if (action === "wa") {
      var report = getReport(code);
      if (report) openWhatsapp(report);
      return;
    }
    if (action === "wa-rec") {
      var repRec = getReport(code);
      var recTargetId = actionEl.getAttribute("data-rec") || "";
      if (repRec) openWhatsappToRecipient(repRec, recTargetId);
      return;
    }
    if (action === "share-photos") {
      var repPh = getReport(code);
      if (repPh) shareReportWithPhotos(repPh);
      return;
    }
    if (action === "copy-msg") {
      var r1 = getReport(code);
      if (r1) copyText(waMessage(r1), "Resumen copiado. Pegalo en WhatsApp.");
      return;
    }
    if (action === "copy-import") {
      var r2 = getReport(code);
      if (r2) {
        copyText(importLink(code), "Link de importación copiado. Enviálo al panel del sector.");
        addEvent(r2, "compartido", session() ? ROLES[session().role].label : "Operario", "Se copió el link de importación para centralizar el aviso.", null);
        saveState();
      }
      return;
    }
    if (action === "copy-link") {
      copyText(trackingUrl(code), "Link de seguimiento copiado.");
      return;
    }
    if (action === "copy-url") {
      copyText(actionEl.getAttribute("data-url") || "", "Link copiado.");
      return;
    }
    if (action === "open-photo") {
      event.preventDefault();
      var inline = actionEl.getAttribute("data-inline") === "1";
      var photoId = actionEl.getAttribute("data-photo-id");
      var show = function (src) {
        openModal({ title: "Evidencia fotográfica", body: src ? '<img src="' + esc(src) + '" alt="Evidencia" style="width:100%;border-radius:10px" />' : "<p>No pudimos cargar la foto.</p>" });
      };
      if (inline) {
        var img = actionEl.querySelector("img");
        show(img ? img.src : "");
      } else {
        idbGet(photoId).then(show);
      }
      return;
    }
    if (action === "pick-status") {
      var status = actionEl.getAttribute("data-status");
      pickedStatus = status;
      var resField = $("#resolution-field");
      var photoField = $("#close-photo-field");
      var needs = status === "resuelto" || status === "cerrado";
      if (resField) resField.hidden = !needs;
      if (photoField) photoField.hidden = !needs;
      $$("#status-picker button").forEach(function (btn) { btn.classList.toggle("on", btn.getAttribute("data-status") === status); });
      return;
    }
    if (action === "save-status") { saveStatus(code); return; }
    if (action === "assign") { saveAssign(code); return; }
    if (action === "comment") { saveComment(code); return; }
    if (action === "delete-report") { deleteReport(code); return; }
    if (action === "save-import") { saveImport(); return; }
    if (action === "traza-status") {
      trazaFilters.status = actionEl.getAttribute("data-status") || "";
      if ($("#traza-filter-status")) $("#traza-filter-status").value = trazaFilters.status;
      renderTrazabilidadList();
      return;
    }
    if (action === "clear-traza") {
      trazaFilters = { q: "", status: "", type: "" };
      if ($("#traza-search")) $("#traza-search").value = "";
      if ($("#traza-filter-status")) $("#traza-filter-status").value = "";
      if ($("#traza-filter-type")) $("#traza-filter-type").value = "";
      renderTrazabilidadList();
      return;
    }
    if (action === "quick-status") {
      filters.status = actionEl.getAttribute("data-status") || "";
      if ($("#f-filter-status")) $("#f-filter-status").value = filters.status;
      renderPanelList();
      return;
    }
    if (action === "clear-filters") {
      filters = { q: "", type: "", status: "", severity: "", equipment: "", overdue: false };
      if ($("#f-search")) $("#f-search").value = "";
      ["#f-filter-type", "#f-filter-status", "#f-filter-severity", "#f-filter-equipment"].forEach(function (sel) { if ($(sel)) $(sel).value = ""; });
      if ($("#f-filter-overdue")) $("#f-filter-overdue").checked = false;
      renderPanelList();
      return;
    }
    if (action === "filter-recurrence") {
      event.preventDefault();
      filters.equipment = actionEl.getAttribute("data-equipment") || "";
      filters.type = actionEl.getAttribute("data-type") || "";
      filters.status = "";
      if ($("#f-filter-equipment")) $("#f-filter-equipment").value = filters.equipment;
      if ($("#f-filter-type")) $("#f-filter-type").value = filters.type;
      if ($("#f-filter-status")) $("#f-filter-status").value = "";
      renderPanelList();
      document.getElementById("panel-list").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
  }

  /* ------------------------------------------------------------------ */
  /* 20. INICIALIZACIÓN                                                  */
  /* ------------------------------------------------------------------ */

  function wireStatic() {
    var submitBtn = $("#btn-submit");
    if (submitBtn) submitBtn.addEventListener("click", submitReport);
    if ($("#btn-next")) $("#btn-next").addEventListener("click", function () { readFormInputs(); nextStep(); });
    if ($("#btn-back")) $("#btn-back").addEventListener("click", prevStep);
    if ($("#btn-new-report")) $("#btn-new-report").addEventListener("click", resetWizard);

    var photoInput = $("#photo-input");
    if (photoInput) photoInput.addEventListener("change", function () { handlePhotoFiles(photoInput.files); });

    ["f-name", "f-legajo", "f-sector", "f-phone", "f-equipment", "f-location", "f-description"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", function () {
        el.classList.remove("invalid");
        if (id === "f-description" && $("#char-count")) $("#char-count").textContent = el.value.length + "/2000";
      });
      el.addEventListener("change", function () { if (id === "f-equipment" || id === "f-sector") readFormInputs(); });
    });

    var trazaForm = $("#traza-filters");
    if (trazaForm) {
      var syncTraza = function () {
        trazaFilters.q = (($("#traza-search") || {}).value || "").trim();
        trazaFilters.status = ($("#traza-filter-status") || {}).value || "";
        trazaFilters.type = ($("#traza-filter-type") || {}).value || "";
        if ($("#lookup-error")) $("#lookup-error").classList.remove("visible");
        renderTrazabilidadList();
      };
      trazaForm.addEventListener("input", syncTraza);
      trazaForm.addEventListener("change", syncTraza);
      trazaForm.addEventListener("submit", function (event) {
        event.preventDefault();
        syncTraza();
        var rawCode = (($("#traza-search") || {}).value || "").trim().toUpperCase();
        var exact = rawCode.match(/^PR-\d{4}-\d{1,4}$/);
        if (exact && getReport(exact[0])) {
          location.hash = "#/aviso/" + encodeURIComponent(exact[0]);
        }
      });
    }
    if ($("#btn-traza-clear")) {
      $("#btn-traza-clear").addEventListener("click", function () {
        trazaFilters = { q: "", status: "", type: "" };
        if ($("#traza-search")) $("#traza-search").value = "";
        if ($("#traza-filter-status")) $("#traza-filter-status").value = "";
        if ($("#traza-filter-type")) $("#traza-filter-type").value = "";
        renderTrazabilidadList();
      });
    }

    var loginForm = $("#login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", function (event) { event.preventDefault(); doLogin(); });
    }

    var filtersForm = $("#panel-filters");
    if (filtersForm) {
      var syncFilters = function () {
        filters.q = ($("#f-search") || {}).value || "";
        filters.type = ($("#f-filter-type") || {}).value || "";
        filters.status = ($("#f-filter-status") || {}).value || "";
        filters.severity = ($("#f-filter-severity") || {}).value || "";
        filters.equipment = ($("#f-filter-equipment") || {}).value || "";
        filters.overdue = !!($("#f-filter-overdue") || {}).checked;
        renderPanelList();
      };
      filtersForm.addEventListener("input", syncFilters);
      filtersForm.addEventListener("change", syncFilters);
      filtersForm.addEventListener("submit", function (event) { event.preventDefault(); syncFilters(); });
    }
    if ($("#btn-clear-filters")) {
      $("#btn-clear-filters").addEventListener("click", function () {
        filters = { q: "", type: "", status: "", severity: "", equipment: "", overdue: false };
        if ($("#f-search")) $("#f-search").value = "";
        ["#f-filter-type", "#f-filter-status", "#f-filter-severity", "#f-filter-equipment"].forEach(function (sel) { if ($(sel)) $(sel).value = ""; });
        if ($("#f-filter-overdue")) $("#f-filter-overdue").checked = false;
        renderPanelList();
      });
    }

    var exportHandlers = function (id) { return document.getElementById(id); };
    if (exportHandlers("btn-export-csv")) exportHandlers("btn-export-csv").addEventListener("click", exportCsv);
    if (exportHandlers("btn-export-csv-2")) exportHandlers("btn-export-csv-2").addEventListener("click", exportCsv);
    if (exportHandlers("btn-json-backup")) exportHandlers("btn-json-backup").addEventListener("click", exportJson);
    if (exportHandlers("btn-json-backup-2")) exportHandlers("btn-json-backup-2").addEventListener("click", exportJson);

    [["btn-import-trigger", "import-file"], ["btn-import-trigger-2", "import-file-2"]].forEach(function (pair) {
      var trigger = document.getElementById(pair[0]);
      var inputEl = document.getElementById(pair[1]);
      if (trigger && inputEl) {
        trigger.addEventListener("click", function () { inputEl.click(); });
        inputEl.addEventListener("change", function () {
          if (inputEl.files && inputEl.files[0]) importJsonFile(inputEl.files[0]);
          inputEl.value = "";
        });
      }
    });

    if ($("#btn-paste-link")) {
      $("#btn-paste-link").addEventListener("click", function () {
        var value = window.prompt("Pegá el link de importación o el número de aviso (PR-2026-0001):");
        if (!value) return;
        if (value.indexOf("#/importar/") !== -1) {
          location.hash = "#/importar/" + value.split("#/importar/")[1].split("?")[0];
          return;
        }
        var match = value.toUpperCase().match(/PR-\d{4}-\d{1,4}/);
        if (match) location.hash = "#/panel/" + match[0];
        else toast("No reconocimos el link ni el número de aviso.", "error");
      });
    }

    if ($("#btn-change-my-pin")) {
      $("#btn-change-my-pin").addEventListener("click", openChangeMyPinModal);
    }
    var supAddForm = $("#sup-add-form");
    if (supAddForm) supAddForm.addEventListener("submit", addSupervisor);

    var customAreaForm = $("#custom-area-form");
    if (customAreaForm) customAreaForm.addEventListener("submit", addCustomArea);

    var configForm = $("#config-form");
    if (configForm) configForm.addEventListener("submit", saveConfig);

    if ($("#btn-reset")) {
      $("#btn-reset").addEventListener("click", function () {
        if (!isAdmin()) { toast("Ingresá como Administrador para borrar los datos.", "error"); return; }
        openModal({
          title: "Borrar todos los datos",
          body: "<p>Se eliminarán todos los avisos y fotos de este dispositivo. Descargá un respaldo antes de continuar.</p>",
          confirmText: "Borrar todo",
          danger: true,
          onConfirm: function () {
            localStorage.removeItem(LS_KEY);
            localStorage.removeItem(LS_OPERATOR);
            idbClear().then(function () {
              state = emptyState();
              saveState();
              toast("Datos eliminados.", "ok");
              location.hash = "#/";
              route();
            });
          }
        });
      });
    }

    if ($("#qr-print")) $("#qr-print").addEventListener("click", function () { window.print(); });
    if ($("#qr-copy")) {
      $("#qr-copy").addEventListener("click", function () {
        var base = appBaseUrl();
        if (!base) { toast("Abrí la app desde su URL publicada para copiar el link.", "warn"); return; }
        copyText(base + "#/reportar", "Link del formulario copiado.");
      });
    }

    document.addEventListener("input", function (event) {
      if (event.target && event.target.classList) event.target.classList.remove("invalid");
    });
  }

  function init() {
    if (pendingCleanStart) idbClear();
    wireStatic();
    initWizard();
    initTrazaSelects();
    initPanelSelects();
    renderSessionBox();
    if (!location.hash) location.hash = "#/";
    route();
    window.addEventListener("hashchange", route);
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeModal();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
