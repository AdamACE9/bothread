import { nanoid } from "nanoid";

/** Prefixed, URL-safe entity id, e.g. "msg_V1StGXR8_Z5jdHi6B". */
export const newId = (prefix: string): string => `${prefix}_${nanoid(16)}`;

/** The room join credential — long, secret, pasted live by the human. */
export const newSessionId = (): string => nanoid(32);
