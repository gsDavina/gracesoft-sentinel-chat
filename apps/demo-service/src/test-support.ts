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
  FindRecipesInput,
  GetAvailabilityInput,
  GetBusinessHoursInput,
  RecipeSourceProvider,
  RecipeSourceResult,
  SessionStore,
  TranscribeAudioInput,
  TranscribeAudioResult,
  UpdateBookingInput,
  VisionAnalyzeInput,
  VisionAnalyzeResult,
} from "@gracesoft-sentinel/core";
import type { FaqGroundingBlueprint } from "@gracesoft-sentinel/agent-concierge";
import type { BookingLogEntry, ConversationLogger, ConversationMessageLogEntry } from "@gracesoft-sentinel/logging-postgres";
import { createLogger, type Logger } from "@gracesoft-sentinel/logging";

/** A working structured logger that writes nowhere — keeps test output clean without stubbing the whole interface. */
export function createSilentTestLogger(): Logger {
  return createLogger("test", { write: () => {} });
}

export const TEST_BUSINESS_CONFIG: BusinessConfig = {
  businessId: "test-biz",
  timezone: "Asia/Singapore",
  faqBlueprintPath: "./faq.json",
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

export const TEST_FAQ_BLUEPRINT: FaqGroundingBlueprint = {
  system_prompt: "unused",
  ai_disclosure: { required: false, opening_message: "unused" },
  knowledge_base: {},
  guardrails: [],
  escalation_policy: { conditions: [], handoff_instruction: "", example_handoff_response: "" },
};

export class FakeCalendarProvider implements CalendarProvider {
  public createBookingCalls: CreateBookingInput[] = [];
  private nextId = 1;
  private readonly bookingsById = new Map<string, Booking>();

  async getAvailability(input: GetAvailabilityInput): Promise<AvailabilitySlot[]> {
    return [{ start: input.from, end: input.to }];
  }
  async createBooking(input: CreateBookingInput): Promise<Booking> {
    this.createBookingCalls.push(input);
    const booking: Booking = { id: `booking-${this.nextId++}`, appointmentId: input.appointmentId, start: input.start, end: input.end };
    this.bookingsById.set(booking.id, booking);
    return booking;
  }
  async findBookingByAppointmentId(input: FindBookingByAppointmentIdInput): Promise<Booking | null> {
    for (const booking of this.bookingsById.values()) {
      if (booking.appointmentId === input.appointmentId) return booking;
    }
    return null;
  }
  async updateBooking(input: UpdateBookingInput): Promise<Booking> {
    const existing = this.bookingsById.get(input.id);
    if (!existing) throw new Error(`No booking with id ${input.id}`);
    const updated: Booking = { ...existing, start: input.start, end: input.end };
    this.bookingsById.set(updated.id, updated);
    return updated;
  }
  async getBusinessHours(_input: GetBusinessHoursInput): Promise<BusinessHours> {
    return TEST_BUSINESS_CONFIG.businessHours;
  }
  async cancelBooking(input: CancelBookingInput): Promise<void> {
    this.bookingsById.delete(input.id);
  }
}

/**
 * A single fake AI provider that answers usefully for both agents: valid
 * JSON for Concierge's FAQ path, valid recipe-shaped JSON for Cook's
 * chat/vision paths — good enough for an end-to-end switch-and-forward
 * test without needing two separate fakes.
 */
export class FakeAiProvider implements AIProvider {
  public calls: ChatCompleteInput[] = [];

  async chatComplete(input: ChatCompleteInput): Promise<ChatCompleteResult> {
    this.calls.push(input);
    return {
      text: JSON.stringify({
        answer: "fake answer",
        escalate: false,
        // agent-assistant's own JSON tool-use protocol — a single shared
        // fake can satisfy Concierge/Cook's `{answer,escalate}` shape and
        // the Assistant's `{action,text}` shape at once, since each parser
        // only reads its own known keys and ignores the rest.
        action: "final_answer",
        text: "fake answer",
        dishName: "Chicken Rice",
        servings: 2,
        ingredients: ["chicken", "rice"],
        steps: ["cook"],
        substitutions: [],
        servingSuggestions: [],
        nutrition: { calories: 500, protein: "30g", carbohydrates: "60g", fat: "12g", fiber: "2g" },
      }),
    };
  }
  async visionAnalyze(_input: VisionAnalyzeInput): Promise<VisionAnalyzeResult> {
    return { text: JSON.stringify({ dishName: "Chicken Rice" }) };
  }
  async embed(_input: EmbedInput): Promise<EmbedResult> {
    return { vectors: [[0, 0, 0]] };
  }
  async transcribeAudio(_input: TranscribeAudioInput): Promise<TranscribeAudioResult> {
    return { text: "fake transcription" };
  }
}

export class FakeRecipeSourceProvider implements RecipeSourceProvider {
  public findRecipesCalls: FindRecipesInput[] = [];

  constructor(private readonly results: RecipeSourceResult[]) {}

  async findRecipes(input: FindRecipesInput): Promise<RecipeSourceResult[]> {
    this.findRecipesCalls.push(input);
    return this.results;
  }
}

export class FakeSessionStore implements SessionStore {
  readonly sessions = new Map<string, ConversationState>();

  async get(sessionId: string): Promise<ConversationState | null> {
    return this.sessions.get(sessionId) ?? null;
  }
  async set(state: ConversationState): Promise<void> {
    this.sessions.set(state.sessionId, state);
  }
  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

export class FakeConversationLogger implements ConversationLogger {
  public messages: ConversationMessageLogEntry[] = [];
  public bookings: BookingLogEntry[] = [];

  async logMessage(entry: ConversationMessageLogEntry): Promise<void> {
    this.messages.push(entry);
  }
  async logBooking(entry: BookingLogEntry): Promise<void> {
    this.bookings.push(entry);
  }
  async deleteSessionData(sessionIds: string[]): Promise<{ messages: number; bookings: number }> {
    const before = { messages: this.messages.length, bookings: this.bookings.length };
    this.messages = this.messages.filter((m) => !sessionIds.includes(m.sessionId));
    this.bookings = this.bookings.filter((b) => !sessionIds.includes(b.sessionId));
    return { messages: before.messages - this.messages.length, bookings: before.bookings - this.bookings.length };
  }
}
