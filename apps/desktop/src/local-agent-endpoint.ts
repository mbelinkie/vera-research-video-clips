export class LocalAgentEndpointRegistry {
  #port: number | undefined;

  currentPort(): number | undefined {
    return this.#port;
  }

  activate(port: number): void {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
      throw new RangeError("Invalid local-agent endpoint.");
    }
    this.#port = port;
  }

  clear(port: number): void {
    if (this.#port === port) this.#port = undefined;
  }
}
