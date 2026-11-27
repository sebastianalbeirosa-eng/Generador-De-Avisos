/**
 * ============================================================================
 * AVISO EN LÍNEA · Google Apps Script para trazabilidad en Google Sheets
 * ============================================================================
 * INSTRUCCIONES:
 * 1. Abrí tu planilla en Google Sheets.
 * 2. Menú Extensiones -> Apps Script.
 * 3. Pegá todo este código y guardá.
 * 4. (Opcional pero recomendado) En Configuración del proyecto -> Propiedades
 *    del script agregá:  WEBHOOK_SECRET  =  tu_clave_secreta
 *    (la misma que pongas en GOOGLE_SHEETS_SECRET dentro de Vercel).
 * 5. Botón "Implementar" -> "Nueva implementación" -> Tipo: "Aplicación web".
 *    - Ejecutar como: "Yo"
 *    - Quién tiene acceso: "Cualquier persona"
 * 6. Copiá la URL terminada en /exec y pegala en Vercel como:
 *    GOOGLE_SHEETS_WEBHOOK_URL
 * ============================================================================
 */

const SHEET_NAME = "Avisos";

const HEADERS = [
  "Código",
  "Fecha de Carga",
  "Estado",
  "Prioridad",
  "Tipo",
  "Sector del Problema",
  "Equipo / Ubicación",
  "Descripción",
  "Operario",
  "Legajo",
  "Sector del Operario",
  "Turno",
  "Responsable Asignado",
  "Resolución / Cierre",
  "Fecha de Cierre",
  "Última Actualización",
  "Link Seguimiento",
  "Fotos (URLs)"
];

const STATUS_LABELS = {
  abierto: "Abierto",
  en_proceso: "En proceso",
  resuelto: "Resuelto",
  cerrado: "Cerrado"
};

const TYPE_LABELS = {
  mantenimiento: "Mantenimiento",
  "5s": "5S / Orden",
  seguridad: "Seguridad"
};

const SEV_LABELS = {
  baja: "Baja",
  media: "Media",
  alta: "Alta",
  critica: "Crítica"
};

function getOrCreateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange
      .setBackground("#0d2137")
      .setFontColor("#ffffff")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function styleStatusCell_(cell, status) {
  if (status === "cerrado" || status === "resuelto") {
    cell.setBackground("#ecfdf5").setFontColor("#047857").setFontWeight("bold");
  } else if (status === "en_proceso") {
    cell.setBackground("#fffbeb").setFontColor("#b45309").setFontWeight("bold");
  } else {
    cell.setBackground("#f0f9ff").setFontColor("#0369a1").setFontWeight("bold");
  }
}

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";
    const payload = JSON.parse(raw);

    const expectedSecret = PropertiesService.getScriptProperties().getProperty("WEBHOOK_SECRET") || "";
    if (expectedSecret && payload.secret !== expectedSecret) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "Unauthorized" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const r = payload.report || {};
    if (!r.code) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "Missing report code" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);

    try {
      const sheet = getOrCreateSheet_();
      const rowValues = [
        r.code,
        r.createdAt || "",
        STATUS_LABELS[r.status] || r.status || "Abierto",
        SEV_LABELS[r.severity] || r.severity || "",
        TYPE_LABELS[r.type] || r.type || "",
        r.equipment || "",
        r.location || "",
        r.description || "",
        r.employeeName || "",
        r.employeeId || "",
        r.operatorSector || "",
        r.shift || "",
        r.assignedTo || "",
        r.resolution || "",
        r.resolvedAt || "",
        r.updatedAt || "",
        r.trackingUrl || "",
        r.photos || ""
      ];

      const lastRow = sheet.getLastRow();
      let targetRow = -1;
      if (lastRow >= 2) {
        const codes = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (let i = 0; i < codes.length; i++) {
          if (String(codes[i][0]).trim().toUpperCase() === String(r.code).trim().toUpperCase()) {
            targetRow = i + 2;
            break;
          }
        }
      }

      if (targetRow === -1) {
        sheet.insertRowBefore(2);
        targetRow = 2;
      }

      sheet.getRange(targetRow, 1, 1, HEADERS.length).setValues([rowValues]);
      styleStatusCell_(sheet.getRange(targetRow, 3), r.status);
    } finally {
      lock.releaseLock();
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
