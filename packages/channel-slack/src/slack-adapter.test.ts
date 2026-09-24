import { describe, expect, it } from "vitest";
import { runChannelAdapterContractTests } from "@gracesoft-sentinel/core/testing";
import { SlackChannelAdapter, isActionableSlackEvent, slackChannelOf } from "./slack-adapter.js";
import type { SlackBlockActionsPayload, SlackEventCallbackPayload } from "./slack-types.js";

function dmEvent(overrides: Partial<SlackEventCallbackPayload["event"]> = {}): SlackEventCallbackPayload {
  return {
    type: "event_callback",
    team_id: "T1",
    event_id: "Ev1",
    event: { type: "message", channel_type: "im", user: "U1", channel: "D1", text: "hello", ts: "1746000000.000100", ...overrides },
  };
}

runChannelAdapterContractTests("SlackChannelAdapter", () => ({
  adapter: new SlackChannelAdapter(),
  sampleInboundPayload: dmEvent(),
  sampleResponse: { text: "hello back", quickReplies: [{ id: "a", label: "A" }] },
  recipientId: "D1:U1",
}));

describe("SlackChannelAdapter.parseInbound — events", () => {
  it("normalizes a DM, keying the sender by channel+user and the tenant by team", async () => {
    const message = await new SlackChannelAdapter().parseInbound(dmEvent());
    expect(message.senderId).toBe("D1:U1");
    expect(message.text).toBe("hello");
    expect(message.businessChannelId).toBe("T1");
    expect(message.timestamp).toBe(new Date(1746000000.0001 * 1000).toISOString());
  });

  it("strips the leading bot mention from an app_mention", async () => {
    const message = await new SlackChannelAdapter().parseInbound(
      dmEvent({ type: "app_mention", channel_type: "channel", channel: "C9", text: "<@UBOT> what's on today?" })
    );
    expect(message.text).toBe("what's on today?");
    expect(message.senderId).toBe("C9:U1");
  });

  it("resolves the first private file through resolveMedia", async () => {
    const adapter = new SlackChannelAdapter({ resolveMedia: async (_url, mimeType) => ({ url: "data:image/png;base64,eA==", mimeType }) });
    const message = await adapter.parseInbound(
      dmEvent({ subtype: "file_share", text: "", files: [{ id: "F1", mimetype: "image/png", url_private: "https://files.slack.com/x" }] })
    );
    expect(message.media).toEqual([{ type: "image", url: "data:image/png;base64,eA==", mimeType: "image/png" }]);
    expect(message.text).toBeUndefined();
  });

  it("rejects a bot-authored event rather than normalizing it", async () => {
    await expect(new SlackChannelAdapter().parseInbound(dmEvent({ bot_id: "B1" }))).rejects.toThrow(/not a user message/);
  });
});

describe("isActionableSlackEvent", () => {
  it("ignores channel messages (only mentions count there), edits, and bot posts", () => {
    expect(isActionableSlackEvent(dmEvent().event)).toBe(true);
    expect(isActionableSlackEvent(dmEvent({ channel_type: "channel" }).event)).toBe(false);
    expect(isActionableSlackEvent(dmEvent({ subtype: "message_changed" }).event)).toBe(false);
    expect(isActionableSlackEvent(dmEvent({ bot_id: "B1" }).event)).toBe(false);
  });
});

describe("SlackChannelAdapter.parseInbound — block_actions", () => {
  it("maps a tapped button to quickReplyId (value) and text (label)", async () => {
    const payload: SlackBlockActionsPayload = {
      type: "block_actions",
      user: { id: "U1" },
      channel: { id: "D1" },
      team: { id: "T1" },
      trigger_id: "trig-1",
      actions: [{ action_id: "quick_reply_0", value: "slot-2", text: { type: "plain_text", text: "Mon 10am" } }],
    };
    const message = await new SlackChannelAdapter().parseInbound(payload);
    expect(message.quickReplyId).toBe("slot-2");
    expect(message.text).toBe("Mon 10am");
    expect(message.senderId).toBe("D1:U1");
  });
});

describe("SlackChannelAdapter.formatOutbound", () => {
  const adapter = new SlackChannelAdapter();

  it("posts plain text to the channel half of the sender id", () => {
    expect(adapter.formatOutbound({ text: "Hi" }, { recipientId: "D1:U1" })).toEqual({ channel: "D1", text: "Hi" });
  });

  it("renders quick replies as buttons carrying the reply id in `value`", () => {
    const out = adapter.formatOutbound({ text: "Pick one", quickReplies: [{ id: "slot-1", label: "9am" }] }, { recipientId: "D1:U1" });
    expect(out.blocks?.[1]).toEqual({
      type: "actions",
      elements: [{ type: "button", action_id: "quick_reply_0", text: { type: "plain_text", text: "9am" }, value: "slot-1" }],
    });
  });

  it("includes an https image but skips a data: URI Slack couldn't fetch", () => {
    const withHttps = adapter.formatOutbound({ text: "pic", media: [{ type: "image", url: "https://example.com/a.jpg" }] }, { recipientId: "D1" });
    expect(withHttps.blocks?.some((b) => b.type === "image")).toBe(true);
    const withData = adapter.formatOutbound({ text: "pic", media: [{ type: "image", url: "data:image/png;base64,eA==" }] }, { recipientId: "D1" });
    expect(withData.blocks).toBeUndefined();
  });

  it("extracts the channel from a sender id", () => {
    expect(slackChannelOf("C1:U1")).toBe("C1");
    expect(slackChannelOf("C1")).toBe("C1");
  });
});
