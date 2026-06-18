import { Injectable, Logger } from '@nestjs/common';

/** Transactional email via Brevo (Sendinblue) HTTP API. */
@Injectable()
export class EmailService {
  private readonly log = new Logger('Email');

  async send(to: string, subject: string, html: string): Promise<boolean> {
    const key = process.env.BREVO_API_KEY;
    if (!key) {
      this.log.warn('BREVO_API_KEY not set — skipping email');
      return false;
    }
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': key, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: {
            email: process.env.BREVO_SENDER_EMAIL || 'info@patienceai.in',
            name: process.env.BREVO_SENDER_NAME || 'Nexus Exchange',
          },
          to: [{ email: to }],
          subject,
          htmlContent: html,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        this.log.warn(`Brevo ${res.status}: ${await res.text()}`);
        return false;
      }
      this.log.log(`Email sent to ${to}: ${subject}`);
      return true;
    } catch (e) {
      this.log.warn(`Email failed: ${e}`);
      return false;
    }
  }
}
