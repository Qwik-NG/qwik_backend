import { Resend } from "resend";
import { env } from "../config/env";

const resendClient = env.resendApiKey ? new Resend(env.resendApiKey) : null;

type SendEmailInput = {
  to: string;
  subject: string;
  html?: string | null;
  text?: string | null;
};

export type SendEmailResult = {
  sent: boolean;
  dryRun: boolean;
  providerMessageId: string | null;
  errorMessage: string | null;
  responsePayload?: unknown;
};

export async function sendEmailWithResend(input: SendEmailInput): Promise<SendEmailResult> {
  if (!env.engagementEmailsEnabled || env.engagementEmailDryRun) {
    return {
      sent: false,
      dryRun: true,
      providerMessageId: null,
      errorMessage: null,
    };
  }

  if (!resendClient) {
    return {
      sent: false,
      dryRun: false,
      providerMessageId: null,
      errorMessage: "Resend is not configured",
    };
  }

  if (!input.html && !input.text) {
    return {
      sent: false,
      dryRun: false,
      providerMessageId: null,
      errorMessage: "Email body is required",
    };
  }

  const response = input.html && input.text
    ? await resendClient.emails.send({
      from: env.resendFromEmail,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    })
    : input.html
      ? await resendClient.emails.send({
        from: env.resendFromEmail,
        to: input.to,
        subject: input.subject,
        html: input.html,
      })
      : await resendClient.emails.send({
        from: env.resendFromEmail,
        to: input.to,
        subject: input.subject,
        text: input.text as string,
      });

  if (response.error) {
    return {
      sent: false,
      dryRun: false,
      providerMessageId: null,
      errorMessage: response.error.message || "Failed to send email",
      responsePayload: response,
    };
  }

  return {
    sent: true,
    dryRun: false,
    providerMessageId: response.data?.id ?? null,
    errorMessage: null,
    responsePayload: response,
  };
}
