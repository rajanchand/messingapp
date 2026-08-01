import "server-only";
import nodemailer from "nodemailer";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "welcome-email" });

export interface WelcomeEmailInput {
  to: string;
  displayName: string;
  matrixUserId: string;
  localpart: string;
  password: string;
  department?: string | null;
  subdepartment?: string | null;
  employeeId?: string | null;
}

export interface WelcomeEmailResult {
  sent: boolean;
  skippedReason?: string;
  error?: string;
}

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

/**
 * Sends a welcome email with Matrix credentials and Element X password-change
 * guidance. Never throws — caller decides whether to surface a soft warning.
 * Passwords are only present in the outbound message body, never logged.
 */
export async function sendUserWelcomeEmail(
  input: WelcomeEmailInput,
): Promise<WelcomeEmailResult> {
  if (!smtpConfigured()) {
    return {
      sent: false,
      skippedReason:
        "SMTP is not configured (set SMTP_HOST and SMTP_FROM to enable welcome emails).",
    };
  }

  const env = getEnv();
  const host = process.env.SMTP_HOST!;
  const port = Number.parseInt(process.env.SMTP_PORT ?? "587", 10);
  const secure =
    process.env.SMTP_SECURE === "true" ||
    process.env.SMTP_SECURE === "1" ||
    port === 465;
  const from = process.env.SMTP_FROM!;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const homeserver = env.MATRIX_HOMESERVER;
  const appName = env.APP_NAME;
  const support = env.SUPPORT_EMAIL;
  const elementHint =
    process.env.ELEMENT_X_HINT_URL ??
    "https://element.io/download";

  const subject = `Your ${appName} Matrix account is ready`;
  const orgLines = [
    input.employeeId ? `Employee ID: ${input.employeeId}` : null,
    input.department ? `Department: ${input.department}` : null,
    input.subdepartment ? `Sub-department: ${input.subdepartment}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    `Hello ${input.displayName},`,
    "",
    `An administrator created your Matrix account on ${env.MATRIX_SERVER_NAME}.`,
    "",
    "Sign-in details:",
    `  Homeserver: ${homeserver}`,
    `  Username:   ${input.localpart}`,
    `  Full ID:    ${input.matrixUserId}`,
    `  Password:   ${input.password}`,
    orgLines ? `\n${orgLines}` : "",
    "",
    "Important — change your password after first login:",
    "  1. Install Element X (iOS / Android) or Element Web from:",
    `     ${elementHint}`,
    `  2. Sign in with homeserver ${homeserver} using the username and password above.`,
    "  3. Open Settings → Account / Security and set a new password immediately.",
    "  4. Do not share this email; delete it after you have changed your password.",
    "",
    `If you did not expect this account, contact ${support}.`,
    "",
    `— ${appName}`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const html = `
    <p>Hello <strong>${escapeHtml(input.displayName)}</strong>,</p>
    <p>An administrator created your Matrix account on <strong>${escapeHtml(env.MATRIX_SERVER_NAME)}</strong>.</p>
    <p><strong>Sign-in details</strong></p>
    <ul>
      <li>Homeserver: <code>${escapeHtml(homeserver)}</code></li>
      <li>Username: <code>${escapeHtml(input.localpart)}</code></li>
      <li>Full ID: <code>${escapeHtml(input.matrixUserId)}</code></li>
      <li>Password: <code>${escapeHtml(input.password)}</code></li>
      ${input.employeeId ? `<li>Employee ID: ${escapeHtml(input.employeeId)}</li>` : ""}
      ${input.department ? `<li>Department: ${escapeHtml(input.department)}</li>` : ""}
      ${input.subdepartment ? `<li>Sub-department: ${escapeHtml(input.subdepartment)}</li>` : ""}
    </ul>
    <p><strong>Important — change your password after first login</strong></p>
    <ol>
      <li>Install <a href="${escapeHtml(elementHint)}">Element X</a> (iOS / Android) or Element Web.</li>
      <li>Sign in with homeserver <code>${escapeHtml(homeserver)}</code> using the username and password above.</li>
      <li>Open <em>Settings → Account / Security</em> and set a new password immediately.</li>
      <li>Do not share this email; delete it after you have changed your password.</li>
    </ol>
    <p>If you did not expect this account, contact <a href="mailto:${escapeHtml(support)}">${escapeHtml(support)}</a>.</p>
    <p>— ${escapeHtml(appName)}</p>
  `.trim();

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });

    await transporter.sendMail({
      from,
      to: input.to,
      subject,
      text,
      html,
    });

    log.info({ to: input.to, matrixUserId: input.matrixUserId }, "Welcome email sent");
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Email send failed";
    log.error({ err: message, to: input.to }, "Welcome email failed");
    return { sent: false, error: message };
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
