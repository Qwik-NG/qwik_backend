const QWIK_LOGO_URL = process.env.EMAIL_LOGO_URL?.trim() || "https://www.qwik.ng/images/logo-email.png";

function sanitizeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type BrandedEmailOptions = {
  preheader?: string;
  subtitle?: string;
};

export function buildBrandedEmailHtml(
  contentHtml: string,
  optionsOrPreheader?: string | BrandedEmailOptions,
  legacySubtitle?: string
) {
  const preheaderText = typeof optionsOrPreheader === "string"
    ? optionsOrPreheader
    : optionsOrPreheader?.preheader;
  const subtitleText = typeof optionsOrPreheader === "object"
    ? optionsOrPreheader?.subtitle
    : legacySubtitle;

  const preheader = sanitizeHtml(preheaderText?.trim() || "Qwik.ng update");
  const subtitle = subtitleText?.trim() ? sanitizeHtml(subtitleText.trim()) : "";

  return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Qwik.ng</title>
</head>
<body style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,sans-serif;color:#1f2937;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb;padding:24px 0;">
    <tr>
      <td align="center" style="padding:0 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
          <tr>
            <td align="center" style="padding:24px 20px 16px;border-bottom:1px solid #f1f5f9;">
              <a href="https://www.qwik.ng" target="_blank" style="text-decoration:none;display:inline-block;">
                <img src="${QWIK_LOGO_URL}" width="160" height="40" alt="Qwik.ng" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:160px;" />
              </a>
              ${subtitle ? `<div style="margin-top:8px;font-size:12px;line-height:16px;color:#6b7280;font-weight:500;">${subtitle}</div>` : ""}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 20px;font-size:14px;line-height:1.6;color:#1f2937;">
              ${contentHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

export { QWIK_LOGO_URL };