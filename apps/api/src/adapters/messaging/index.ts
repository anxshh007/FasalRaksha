/**
 * MessagingAdapter — how the API reaches a phone (OTP codes, masked-relay notices, alerts).
 * Mock and Live implement one interface; the contract suite that runs against both lands with
 * the other adapters (P4). The mock keeps what it "sent" in memory so a demonstration can show
 * it and a test can read it; nothing is delivered anywhere.
 */
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
