/** A clean, agent-readable error. `code` is stable; `message` is for the model. */
export class BothreadError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "BothreadError";
  }
}
