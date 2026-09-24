import { describe, expect, it } from "vitest";
import type {
  AIProvider,
  AvailabilitySlot,
  Booking,
  BusinessConfig,
  BusinessHours,
  CalendarProvider,
  CancelBookingInput,
  ChatCompleteInput,
  ChatCompleteResult,
  ConversationState,
  CreateBookingInput,
  EmbedInput,
  EmbedResult,
  FindBookingByAppointmentIdInput,
  GetAvailabilityInput,
  GetBusinessHoursInput,
  TranscribeAudioInput,
  TranscribeAudioResult,
  UpdateBookingInput,
  VisionAnalyzeInput,
  VisionAnalyzeResult,
} from "@gracesoft-sentinel/core";
import { handleMessage, type FaqGroundingBlueprint } from "@gracesoft-sentinel/agent-concierge";
import { WhatsAppChannelAdapter } from "@gracesoft-sentinel/channel-whatsapp";
import { TelegramChannelAdapter } from "@gracesoft-sentinel/channel-telegram";
import { SlackChannelAdapter } from "@gracesoft-sentinel/channel-slack";
import { LineChannelAdapter } from "@gracesoft-sentinel/channel-line";
import { WebChatChannelAdapter } from "@gracesoft-sentinel/web-chat-kit";

/**
 * Proves the "platform-agnostic" claim end to end: the same booking
 * scenario, delivered through two entirely different channel wire
 * formats, produces the same agent response content — and each channel's
 * `formatOutbound` renders that shared content correctly in its own
 * envelope. `agent-concierge`, `channel-whatsapp`, and `channel-telegram`
 * are each independently forbidden from importing one another (boundary
 * lint), so this test — needing all three at once — necessarily lives
 * outside `packages/`.
 */

class FullyAvailableCalendarProvider implements CalendarProvider {
  async getAvailability(input: GetAvailabilityInput): Promise<AvailabilitySlot[]> {
    return [{ start: input.from, end: input.to }];
  }
  async createBooking(input: CreateBookingInput): Promise<Booking> {
    return { id: "booking-1", appointmentId: input.appointmentId, start: input.start, end: input.end };
  }
  async findBookingByAppointmentId(_input: FindBookingByAppointmentIdInput): Promise<Booking | null> {
    throw new Error("not expected to be called for this scenario");
  }
  async updateBooking(_input: UpdateBookingInput): Promise<Booking> {
    throw new Error("not expected to be called for this scenario");
  }
  async getBusinessHours(_input: GetBusinessHoursInput): Promise<BusinessHours> {
    // Not called by this scenario — handleMessage reads business hours from
    // BusinessConfig directly, not via the calendar provider.
    throw new Error("not expected to be called for this scenario");
  }
  async cancelBooking(_input: CancelBookingInput): Promise<void> {
    throw new Error("not expected to be called for this scenario");
  }
}

class UnusedAiProvider implements AIProvider {
  async chatComplete(_input: ChatCompleteInput): Promise<ChatCompleteResult> {
    throw new Error("not expected to be called for this scenario");
  }
  async visionAnalyze(_input: VisionAnalyzeInput): Promise<VisionAnalyzeResult> {
    throw new Error("not expected to be called for this scenario");
  }
  async embed(_input: EmbedInput): Promise<EmbedResult> {
    throw new Error("not expected to be called for this scenario");
  }
  async transcribeAudio(_input: TranscribeAudioInput): Promise<TranscribeAudioResult> {
    throw new Error("not expected to be called for this scenario");
  }
}

const BUSINESS_CONFIG: BusinessConfig = {
  businessId: "test-biz",
  timezone: "Asia/Singapore",
  faqBlueprintPath: "./fixtures/faq.json",
  calendarId: "test-calendar",
  businessHours: {
    timezone: "Asia/Singapore",
    weekly: {
      mon: { open: "09:00", close: "18:00" },
      tue: { open: "09:00", close: "18:00" },
      wed: { open: "09:00", close: "18:00" },
      thu: { open: "09:00", close: "18:00" },
      fri: { open: "09:00", close: "18:00" },
      sat: { open: "09:00", close: "13:00" },
      sun: null,
    },
    exceptions: [],
  },
};

const FAQ_BLUEPRINT: FaqGroundingBlueprint = {
  system_prompt: "unused for this scenario",
  ai_disclosure: { required: false, opening_message: "unused" },
  knowledge_base: {},
  guardrails: [],
  escalation_policy: { conditions: [], handoff_instruction: "", example_handoff_response: "" },
};

function freshState(channel: string, senderId: string): ConversationState {
  return {
    sessionId: `session-${channel}`,
    channel,
    userId: senderId,
    agent: "concierge",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    context: { aiDisclosedAt: new Date().toISOString() },
  };
}

describe("cross-channel parity: WhatsApp vs Telegram through agent-concierge", () => {
  const now = new Date("2026-05-01T02:00:00Z"); // Friday 10:00 Asia/Singapore

  it("parseInbound extracts equivalent text content from each channel's own wire format", async () => {
    const whatsappAdapter = new WhatsAppChannelAdapter();
    const telegramAdapter = new TelegramChannelAdapter();

    const whatsappMessage = await whatsappAdapter.parseInbound({
      entry: [
        {
          id: "e1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                messages: [{ id: "wamid.1", from: "6591234567", timestamp: "1746064800", type: "text", text: { body: "I'd like to book something" } }],
              },
            },
          ],
        },
      ],
    });

    const telegramMessage = await telegramAdapter.parseInbound({
      update_id: 1,
      message: { message_id: 1, date: 1746064800, chat: { id: 999 }, text: "I'd like to book something" },
    });

    expect(whatsappMessage.text).toBe(telegramMessage.text);
    expect(whatsappMessage.channel).toBe("whatsapp");
    expect(telegramMessage.channel).toBe("telegram");
  });

  it("the same booking scenario produces equivalent agent responses regardless of originating channel", async () => {
    const commonInput = {
      businessConfig: BUSINESS_CONFIG,
      calendarProvider: new FullyAvailableCalendarProvider(),
      aiProvider: new UnusedAiProvider(),
      faqBlueprint: FAQ_BLUEPRINT,
      now,
    };

    const whatsappResult = await handleMessage({
      ...commonInput,
      message: {
        id: "wa-1",
        channel: "whatsapp",
        senderId: "6591234567",
        timestamp: now.toISOString(),
        text: "I'd like to book something",
        raw: {},
      },
      state: freshState("whatsapp", "6591234567"),
    });

    const telegramResult = await handleMessage({
      ...commonInput,
      message: {
        id: "tg-1",
        channel: "telegram",
        senderId: "999",
        timestamp: now.toISOString(),
        text: "I'd like to book something",
        raw: {},
      },
      state: freshState("telegram", "999"),
    });

    // Same offer text, same number/labels of slots — the content a chatter
    // actually sees is identical, independent of which channel they used.
    expect(whatsappResult.response.text).toBe(telegramResult.response.text);
    expect(whatsappResult.response.quickReplies).toEqual(telegramResult.response.quickReplies);
  });

  it("each adapter renders the same NormalizedResponse correctly in its own envelope", () => {
    const sharedResponse = {
      text: "Here are the next available slots:",
      quickReplies: [
        { id: "slot-1", label: "Mon, 4 May, 9:00am" },
        { id: "slot-2", label: "Mon, 4 May, 9:30am" },
        { id: "slot-3", label: "Mon, 4 May, 10:00am" },
      ],
    };

    const whatsappOutput = new WhatsAppChannelAdapter().formatOutbound(sharedResponse, { recipientId: "6591234567" }) as {
      interactive: { action: { buttons: { reply: { id: string; title: string } }[] } };
    };
    const telegramOutput = new TelegramChannelAdapter().formatOutbound(sharedResponse, { recipientId: "999" }) as {
      body: { reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] } };
    };

    const whatsappIds = whatsappOutput.interactive.action.buttons.map((b) => b.reply.id);
    const telegramIds = telegramOutput.body.reply_markup.inline_keyboard.map((row) => row[0]!.callback_data);
    expect(whatsappIds).toEqual(telegramIds);
    expect(whatsappIds).toEqual(["slot-1", "slot-2", "slot-3"]);

    const whatsappLabels = whatsappOutput.interactive.action.buttons.map((b) => b.reply.title);
    const telegramLabels = telegramOutput.body.reply_markup.inline_keyboard.map((row) => row[0]!.text);
    expect(whatsappLabels).toEqual(telegramLabels);
  });
});

describe("cross-channel parity: the newer channels (Slack, LINE, web chat)", () => {
  const offer = {
    text: "Here are the next available slots:",
    quickReplies: [
      { id: "slot-1", label: "Mon, 4 May, 9:00am" },
      { id: "slot-2", label: "Mon, 4 May, 9:30am" },
    ],
  };

  it("each renders the same slot offer with every slot id intact", () => {
    const slack = new SlackChannelAdapter().formatOutbound(offer, { recipientId: "D1:U1" });
    const slackActions = slack.blocks?.find((b) => b.type === "actions");
    expect(slackActions && "elements" in slackActions ? slackActions.elements.map((e) => e.value) : []).toEqual(["slot-1", "slot-2"]);

    const line = new LineChannelAdapter().formatOutbound(offer, { recipientId: "U1" });
    expect(line.messages[0]!.quickReply!.items.map((i) => i.action.data)).toEqual(["slot-1", "slot-2"]);

    const web = new WebChatChannelAdapter({ channel: "web-gracesoft" }).formatOutbound(offer, { recipientId: "abcdefabcdefabcdef" });
    expect(web.quickReplies?.map((q) => q.id)).toEqual(["slot-1", "slot-2"]);
  });

  it("a tapped slot comes back as the same quickReplyId on every channel — what agent-concierge keys its booking on", async () => {
    const slack = await new SlackChannelAdapter().parseInbound({
      type: "block_actions",
      user: { id: "U1" },
      channel: { id: "D1" },
      actions: [{ action_id: "quick_reply_1", value: "slot-2", text: { type: "plain_text", text: "Mon, 4 May, 9:30am" } }],
    });
    const line = await new LineChannelAdapter().parseInbound({
      destination: "Ubot",
      event: { type: "postback", timestamp: 1746064800000, source: { type: "user", userId: "U1" }, postback: { data: "slot-2" } },
    });
    const web = new WebChatChannelAdapter({ channel: "web-davdevs" }).parseInbound({ sessionId: "abcdefabcdefabcdef", text: "Mon, 4 May, 9:30am", quickReplyId: "slot-2" });

    expect([slack.quickReplyId, line.quickReplyId, web.quickReplyId]).toEqual(["slot-2", "slot-2", "slot-2"]);
  });
});
