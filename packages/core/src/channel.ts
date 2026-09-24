/**
 * Known channel identifiers, kept open (`string & {}`) so a future channel
 * package can introduce its own id without a core release blocking it.
 */
export type ChannelId = "whatsapp" | "telegram" | "web" | (string & {});
