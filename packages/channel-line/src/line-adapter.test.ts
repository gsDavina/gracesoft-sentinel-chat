import { describe, expect, it } from "vitest";
import { runChannelAdapterContractTests } from "@gracesoft-sentinel/core/testing";
import { LineChannelAdapter, isActionableLineEvent, lineRecipientOf } from "./line-adapter.js";
import type { LineEvent, LineInboundEvent } from "./line-types.js";

function textEvent(overrides: Partial<LineEvent> = {}): LineEvent {
  return {
    type: "message",
    mode: "active",
    timestamp: 1746000000000,
    source: { type: "user", userId: "U1" },
    webhookEventId: "ev-1",
    replyToken: "rt-1",
    message: { id: "m-1", type: "text", text: "hello" },
    ...overrides,
  };
}

function inbound(event: LineEvent): LineInboundEvent {
  return { destination: "Ubot", event };
}

runChannelAdapterContractTests("LineChannelAdapter", () => ({
  adapter: new LineChannelAdapter(),
  sampleInboundPayload: inbound(textEvent()),
  sampleResponse: { text: "hello back" },
  recipientId: "U1",
}));

describe("LineChannelAdapter.parseInbound", () => {
  it("normalizes a 1:1 text message, with the bot's own id as the tenant", async () => {
    const message = await new LineChannelAdapter().parseInbound(inbound(textEvent()));
    expect(message.senderId).toBe("U1");
    expect(message.text).toBe("hello");
    expect(message.businessChannelId).toBe("Ubot");
    expect(message.timestamp).toBe(new Date(1746000000000).toISOString());
  });

  it("keys a group message by group and member", async () => {
    const message = await new LineChannelAdapter().parseInbound(inbound(textEvent({ source: { type: "group", groupId: "G1", userId: "U1" } })));
    expect(message.senderId).toBe("G1:U1");
  });

  it("maps a postback (tapped quick reply) to quickReplyId", async () => {
    const message = await new LineChannelAdapter().parseInbound(inbound(textEvent({ type: "postback", message: undefined, postback: { data: "slot-2" } })));
    expect(message.quickReplyId).toBe("slot-2");
  });

  it("downloads image content through resolveMedia", async () => {
    const adapter = new LineChannelAdapter({ resolveMedia: async (id, mimeType) => ({ url: `data:${mimeType};base64,${id}`, mimeType }) });
    const message = await adapter.parseInbound(inbound(textEvent({ message: { id: "img-1", type: "image" } })));
    expect(message.media).toEqual([{ type: "image", url: "data:image/jpeg;base64,img-1", mimeType: "image/jpeg" }]);
  });
});

describe("isActionableLineEvent", () => {
  it("skips follow events, stickers, standby mode, and redeliveries", () => {
    expect(isActionableLineEvent(textEvent())).toBe(true);
    expect(isActionableLineEvent(textEvent({ type: "follow", message: undefined }))).toBe(false);
    expect(isActionableLineEvent(textEvent({ message: { id: "s", type: "sticker" } }))).toBe(false);
    expect(isActionableLineEvent(textEvent({ mode: "standby" }))).toBe(false);
    expect(isActionableLineEvent(textEvent({ deliveryContext: { isRedelivery: true } }))).toBe(false);
  });
});

describe("LineChannelAdapter.formatOutbound", () => {
  const adapter = new LineChannelAdapter();

  it("pushes to the group half of a group sender id", () => {
    expect(adapter.formatOutbound({ text: "hi" }, { recipientId: "G1:U1" })).toEqual({ to: "G1", messages: [{ type: "text", text: "hi" }] });
    expect(lineRecipientOf("U1")).toBe("U1");
  });

  it("attaches quick replies as postback actions, truncating labels to LINE's 20-char limit", () => {
    const out = adapter.formatOutbound(
      { text: "Pick one", quickReplies: [{ id: "slot-1", label: "Monday 4 May, 10:00am" }] },
      { recipientId: "U1" }
    );
    const action = out.messages[0]!.quickReply!.items[0]!.action;
    expect(action.data).toBe("slot-1");
    expect(action.label).toHaveLength(20);
    expect(action.displayText).toBe("Monday 4 May, 10:00am");
  });

  it("sends an https image but never a data: URI, and never an empty batch", () => {
    const withImage = adapter.formatOutbound({ text: "pic", media: [{ type: "image", url: "https://example.com/a.jpg" }] }, { recipientId: "U1" });
    expect(withImage.messages).toHaveLength(2);
    const dataOnly = adapter.formatOutbound({ media: [{ type: "image", url: "data:image/png;base64,eA==" }] }, { recipientId: "U1" });
    expect(dataOnly.messages).toEqual([{ type: "text", text: "…" }]);
  });
});
