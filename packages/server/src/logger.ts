import pino from "pino";

export const logger = pino({
  level: process.env.BOTHREAD_LOG ?? "info",
});

export type Logger = typeof logger;
