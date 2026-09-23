import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildBrandedEmailHtml, QWIK_LOGO_URL } from "../lib/emailBranding";

describe("emailBranding", () => {
  it("defaults QWIK_LOGO_URL to the dedicated email logo URL", () => {
    expect(QWIK_LOGO_URL).toBe("https://www.qwik.ng/images/logo-email.png");
  });

  it("renders a full HTML document with table layout and container", () => {
    const html = buildBrandedEmailHtml("<p>Hello world</p>");

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<html lang=\"en\">");
    expect(html).toContain("<table role=\"presentation\"");
    expect(html).toContain("<p>Hello world</p>");
  });

  it("renders the official Qwik logo with correct dimensions and alt text", () => {
    const html = buildBrandedEmailHtml("<p>Test content</p>");

    expect(html).toContain(`src="${QWIK_LOGO_URL}"`);
    expect(html).toContain('width="160"');
    expect(html).toContain('height="40"');
    expect(html).toContain('alt="Qwik.ng"');
    expect(html).toContain('href="https://www.qwik.ng"');
  });

  it("renders preheader text and sanitizes special characters", () => {
    const html = buildBrandedEmailHtml("<p>Content</p>", "Welcome <to> Qwik & friends '2026' \"now\"");

    expect(html).toContain("Welcome &lt;to&gt; Qwik &amp; friends &#39;2026&#39; &quot;now&quot;");
    // Preheader should be in a hidden element
    expect(html).toContain("display:none;max-height:0;overflow:hidden");
  });

  it("supports subtitle option for admin communication emails", () => {
    const html = buildBrandedEmailHtml("<p>Admin notice</p>", {
      preheader: "Important announcement",
      subtitle: "Admin Panel — Communications",
    });

    expect(html).toContain("Admin Panel — Communications");
    expect(html).toContain("Important announcement");
    expect(html).toContain("<p>Admin notice</p>");
  });

  it("supports legacy subtitle argument signature", () => {
    const html = buildBrandedEmailHtml("<p>Broadcast notice</p>", "Preheader notice", "Admin Communication");

    expect(html).toContain("Admin Communication");
    expect(html).toContain("Preheader notice");
    expect(html).toContain("<p>Broadcast notice</p>");
  });

  it("omits subtitle div when no subtitle is provided", () => {
    const html = buildBrandedEmailHtml("<p>Regular notification</p>", "Weekly update");

    expect(html).not.toContain("Admin Communication");
    expect(html).not.toContain("Admin Panel");
    expect(html).toContain("<p>Regular notification</p>");
  });
});
