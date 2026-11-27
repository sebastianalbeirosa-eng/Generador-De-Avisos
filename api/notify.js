/**
 * Vercel Serverless Function · /api/notify
 * Envía alertas por Email (Resend) y sincroniza la fila en Google Sheets (Apps Script)
 * desde el servidor, sin exponer API Keys ni Webhooks en el navegador.
 *
 * Variables de entorno recomendadas en Vercel:
 *  - RESEND_API_KEY
 *  - RESEND_FROM              (ej: "AVISO EN LINEA <avisos@tudominio.com>")
 *  - GOOGLE_SHEETS_WEBHOOK_URL
 *  - GOOGLE_SHEETS_SECRET     (opcional, debe coincidir con google-apps-script.gs)
 *  - SUPABASE_URL             (opcional; usa la del proyecto por defecto)
 *  - SUPABASE_ANON_KEY        (opcional; usa la publishable key por defecto)
 *  - PUBLIC_APP_URL           (ej: "https://tu-app.vercel.app")
 */

const DEFAULT_SUPABASE_URL = "https://yixkwiczpsamrejtqodk.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_FiUMwaQ9mJdUafVYoBw2nQ_gUzwJY5C";
const BUCKET = "avisos-fotos";

function escHtml(val) {
  return String(val == null ? "" : val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateAR(isoStr) {
  if (!isoStr) return "";
  try {
    return new Intl.DateTimeFormat("es-AR", {
      timeZone: "America/Argentina/San_Juan",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(isoStr));
  } catch (e) {
    return String(isoStr);
  }
}

async function sbSelect(supabaseUrl, supabaseKey, path) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Accept: "application/json"
    }
  });
  if (!res.ok) return null;
  return res.json();
}

function buildEmailHtml(report, trackingUrl, photoUrls) {
  const typeLabels = { mantenimiento: "Mantenimiento", "5s": "5S / Orden", seguridad: "Seguridad" };
  const sevLabels = { baja: "Baja", media: "Media", alta: "Alta", critica: "Crítica" };
  const sevColors = { baja: "#64748b", media: "#0284c7", alta: "#d97706", critica: "#dc2626" };

  const typeText = typeLabels[report.type] || report.type;
  const sevText = sevLabels[report.severity] || report.severity;
  const sevColor = sevColors[report.severity] || "#14304e";

  const photosBlock = photoUrls.length
    ? `<div style="margin-top:16px;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#4b5563;text-transform:uppercase;">Evidencia fotográfica</p>
        ${photoUrls.map((u, i) => `<a href="${escHtml(u)}" target="_blank" rel="noopener" style="display:inline-block;margin:0 8px 8px 0;"><img src="${escHtml(u)}" alt="Foto ${i + 1}" style="width:180px;height:130px;object-fit:cover;border-radius:8px;border:1px solid #d2ccc0;" /></a>`).join("")}
      </div>`
    : "";

  return `
  <div style="font-family:Segoe UI,Roboto,Arial,sans-serif;background:#f7f6f3;padding:24px;color:#0d2137;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e4e0d8;border-radius:14px;overflow:hidden;">
      <div style="background:#0d2137;color:#ffffff;padding:18px 22px;">
        <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#ffbe45;font-weight:800;">AVISO EN LÍNEA · CERÁMICA SAN LORENZO</div>
        <h1 style="margin:6px 0 0;font-size:20px;line-height:1.2;">Nuevo aviso de ${escHtml(typeText)} · ${escHtml(report.code)}</h1>
      </div>
      <div style="padding:20px 22px;">
        <div style="margin-bottom:14px;">
          <span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;background:${sevColor};color:#ffffff;">Prioridad: ${escHtml(sevText)}</span>
          <span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;background:#f1efea;color:#0d2137;margin-left:6px;">${escHtml(report.equipment)}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr><td style="padding:7px 0;color:#64748b;width:150px;border-bottom:1px solid #f1efea;">Sector del evento</td><td style="padding:7px 0;font-weight:700;border-bottom:1px solid #f1efea;">${escHtml(report.equipment)}${report.location ? " · " + escHtml(report.location) : ""}</td></tr>
          <tr><td style="padding:7px 0;color:#64748b;border-bottom:1px solid #f1efea;">Reportado por</td><td style="padding:7px 0;font-weight:600;border-bottom:1px solid #f1efea;">${escHtml(report.employee_name)} (Legajo ${escHtml(report.employee_id)})</td></tr>
          <tr><td style="padding:7px 0;color:#64748b;border-bottom:1px solid #f1efea;">Sector / Turno</td><td style="padding:7px 0;font-weight:600;border-bottom:1px solid #f1efea;">${escHtml(report.operator_sector)} · ${escHtml(report.shift)}</td></tr>
          <tr><td style="padding:7px 0;color:#64748b;border-bottom:1px solid #f1efea;">Fecha de carga</td><td style="padding:7px 0;font-weight:600;border-bottom:1px solid #f1efea;">${escHtml(formatDateAR(report.created_at))}</td></tr>
        </table>
        <div style="margin-top:16px;padding:12px 14px;background:#f7f6f3;border-radius:10px;border:1px solid #e4e0d8;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:4px;">Detalle del hallazgo</div>
          <div style="font-size:14px;line-height:1.5;white-space:pre-line;">${escHtml(report.description)}</div>
        </div>
        ${photosBlock}
        <div style="margin-top:20px;">
          <a href="${escHtml(trackingUrl)}" style="display:inline-block;background:#ffbe45;color:#0d2137;font-weight:800;text-decoration:none;padding:11px 18px;border-radius:10px;font-size:13px;">Ver seguimiento en AVISO EN LÍNEA</a>
        </div>
      </div>
      <div style="background:#f1efea;padding:12px 22px;font-size:11px;color:#64748b;">
        Planta San Juan · Notificación automática del sistema AVISO EN LÍNEA.
      </div>
    </div>
  </div>`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const code = String(body.code || "").trim().toUpperCase();
  const action = body.action === "updated" ? "updated" : "created";

  if (!/^PR-\d{4}-\d{4,8}$/.test(code)) {
    res.status(400).json({ ok: false, error: "Código de aviso inválido." });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY;

  try {
    // 1. Verificar existencia real del aviso en Supabase (anti-spam / anti-open-relay)
    const rows = await sbSelect(supabaseUrl, supabaseKey, `reports?code=eq.${encodeURIComponent(code)}&select=*&limit=1`);
    if (!Array.isArray(rows) || !rows.length) {
      res.status(404).json({ ok: false, error: "Aviso no encontrado en Supabase." });
      return;
    }
    const report = rows[0];

    // Solo permitir envío de email para avisos recientes (< 30 min desde creación)
    const createdAgeMs = Date.now() - new Date(report.created_at).getTime();
    const allowEmail = action === "created" && createdAgeMs >= -60000 && createdAgeMs <= 30 * 60 * 1000;

    // 2. Obtener fotos y supervisores registrados en DB
    const [photos, supervisors] = await Promise.all([
      sbSelect(supabaseUrl, supabaseKey, `report_photos?report_id=eq.${encodeURIComponent(report.id)}&select=storage_path,kind`),
      sbSelect(supabaseUrl, supabaseKey, `supervisors?select=id,name,email,area`)
    ]);

    const photoUrls = Array.isArray(photos)
      ? photos.map(p => `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${p.storage_path}`)
      : [];

    const originHeader = req.headers.origin || (req.headers.host ? `https://${req.headers.host}` : "");
    const baseUrl = (process.env.PUBLIC_APP_URL || originHeader || "").replace(/\/$/, "");
    const trackingUrl = baseUrl ? `${baseUrl}/#/aviso/${encodeURIComponent(report.code)}` : `#/aviso/${encodeURIComponent(report.code)}`;

    // Resolver emails ÚNICAMENTE desde los supervisores registrados en Supabase que coincidan con report.recipients
    const supEmailMap = new Map();
    if (Array.isArray(supervisors)) {
      supervisors.forEach(s => {
        if (s && s.id && s.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email)) {
          supEmailMap.set(String(s.id), String(s.email).trim().toLowerCase());
        }
      });
    }

    const recipientsArr = Array.isArray(report.recipients) ? report.recipients : [];
    const targetEmails = Array.from(new Set(
      recipientsArr
        .map(r => supEmailMap.get(String(r && r.id ? r.id : "")))
        .filter(Boolean)
    ));

    const results = { emailSent: false, emailCount: 0, sheetsSynced: false };
    const jobs = [];

    // 3. Envío de correo por Resend en segundo plano
    const resendKey = process.env.RESEND_API_KEY;
    const resendFrom = process.env.RESEND_FROM || "AVISO EN LINEA <onboarding@resend.dev>";
    if (allowEmail && resendKey && targetEmails.length) {
      const typeNames = { mantenimiento: "Mantenimiento", "5s": "5S / Orden", seguridad: "Seguridad" };
      const subject = `[${report.code}] Aviso de ${typeNames[report.type] || report.type} · ${report.equipment} (${String(report.severity).toUpperCase()})`;
      const html = buildEmailHtml(report, trackingUrl, photoUrls);

      jobs.push(
        fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: resendFrom,
            to: targetEmails,
            subject,
            html
          })
        }).then(async r => {
          if (r.ok) {
            results.emailSent = true;
            results.emailCount = targetEmails.length;
          } else {
            const errTxt = await r.text().catch(() => "");
            console.warn("[Resend] error:", r.status, errTxt);
          }
        }).catch(err => console.warn("[Resend] exception:", err))
      );
    }

    // 4. Sincronización automática con Google Sheets (Apps Script Webhook)
    const sheetsUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
    if (sheetsUrl) {
      const sheetPayload = {
        secret: process.env.GOOGLE_SHEETS_SECRET || "",
        action,
        report: {
          code: report.code,
          createdAt: formatDateAR(report.created_at),
          updatedAt: formatDateAR(report.updated_at),
          status: report.status,
          severity: report.severity,
          type: report.type,
          equipment: report.equipment,
          location: report.location || "",
          description: report.description,
          employeeName: report.employee_name,
          employeeId: report.employee_id,
          operatorSector: report.operator_sector,
          shift: report.shift,
          assignedTo: report.assigned_to || "",
          resolution: report.resolution || "",
          resolvedAt: formatDateAR(report.resolved_at),
          trackingUrl,
          photos: photoUrls.join(" | ")
        }
      };

      jobs.push(
        fetch(sheetsUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sheetPayload)
        }).then(r => {
          results.sheetsSynced = r.ok;
          if (!r.ok) console.warn("[Sheets] webhook status:", r.status);
        }).catch(err => console.warn("[Sheets] exception:", err))
      );
    }

    await Promise.all(jobs);
    res.status(200).json(Object.assign({ ok: true }, results));
  } catch (err) {
    console.error("[api/notify] error:", err);
    res.status(500).json({ ok: false, error: "Error interno de notificación." });
  }
};
