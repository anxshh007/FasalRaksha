/**
 * MessagingAdapter — how the API reaches a phone: sign-in codes, masked-relay notices, price
 * alerts. (Two-way WhatsApp / SMS / IVR conversations are the channels in apps/channels, P19.)
 *
 *   MockMessagingAdapter — keeps what it "sent" in memory, so a demonstration can show it and a
 *                          test can read it; nothing is delivered anywhere
 *   LiveSmsMessagingAdapter — an Indian DLT-registered SMS gateway (MSG91-style flow API):
 *                          POST {SMS_GATEWAY_URL}  { template_id, recipients: [{ mobiles, body }] }
 *                          header authkey: {SMS_GATEWAY_KEY}  →  { type: 'success', message: <request id> }
 */
import { AdapterError, fetchJson, type Transport } from '../http.js';

export interface OutgoingMessage {
  id: string;
  to: string;
  text: string;
  at: string;
}

export interface MessagingAdapter {
  readonly mode: 'mock' | 'live';
  send(to: string, text: string, at: Date): Promise<{ id: string }>;
}

export class MockMessagingAdapter implements MessagingAdapter {
  readonly mode = 'mock' as const;
  private readonly sent: OutgoingMessage[] = [];
  private counter = 0;

  async send(to: string, text: string, at: Date): Promise<{ id: string }> {
    if (!/^\+91[6-9]\d{9}$/.test(to)) throw new AdapterError('MockMessagingAdapter', 'upstream-rejected', 'Messages go only to Indian mobile numbers in +91 form.');
    this.counter += 1;
    const id = `mock-msg-${this.counter}`;
    this.sent.push({ id, to, text, at: at.toISOString() });
    return { id };
  }

  /** Messages sent to a number, newest last. */
  outbox(to?: string): readonly OutgoingMessage[] {
    return to === undefined ? this.sent : this.sent.filter((m) => m.to === to);
  }
}

export interface SmsGatewayConfig {
  url: string;
  authKey: string;
  /** DLT-registered template the text is sent under (Indian TRAI rules require one). */
  templateId: string;
  transport?: Transport;
}

export class LiveSmsMessagingAdapter implements MessagingAdapter {
  readonly mode = 'live' as const;
  private readonly transport: Transport;

  constructor(private readonly config: SmsGatewayConfig) {
    this.transport = config.transport ?? fetch;
  }

  async send(to: string, text: string, _at?: Date): Promise<{ id: string }> {
    if (!/^\+91[6-9]\d{9}$/.test(to)) throw new AdapterError('SMS gateway', 'upstream-rejected', 'Messages go only to Indian mobile numbers in +91 form.');
    const body = (await fetchJson(this.transport, {
      adapter: 'SMS gateway',
      url: this.config.url,
      method: 'POST',
      headers: { authkey: this.config.authKey },
      body: { template_id: this.config.templateId, recipients: [{ mobiles: to.slice(1), body: text }] },
    })) as { type?: unknown; message?: unknown };
    if (body.type !== 'success' || typeof body.message !== 'string') throw new AdapterError('SMS gateway', 'upstream-rejected', 'The SMS gateway did not accept the message.');
    return { id: body.message };
  }
}
