<!-- DRAFT: prepared as scaffolding for WhatsApp Business verification and
     PDPA notice obligations. Review by qualified legal counsel before this
     is treated as the business's final, binding policy. -->

# Sentinel Demo — Privacy Policy

**Effective date:** 24 September 2026
**Version:** 1.1.0

Sentinel Demo ("Demo", "we", "us") is a demonstration chat assistant built by GraceSoft that lets you try both Sentinel Concierge (FAQ answers and appointment booking) and Sentinel Cook (dish recognition and recipe generation) in one conversation, over WhatsApp or Telegram. This policy explains what we collect when you message the demo, why, and how to exercise your rights over that data.

## 1. This is a demonstration, not a live business channel

Sentinel Demo exists to showcase GraceSoft's Sentinel product line. It is not a production customer-service channel for any specific business — appointments made through the demo are demonstration bookings, not real commitments from a real business, and its underlying data (conversation history, session state) may be reset at any time without notice. Please don't send real sensitive information through the demo.

## 2. You're talking to an AI

Every reply in Sentinel Demo — whichever of the two services you're currently talking to — comes from an AI assistant, not a human team member. It tells you this at the start of every new conversation, and will confirm it directly any time you ask.

## 3. What we collect

- **Your phone number or chat identifier** — whichever your messaging app (WhatsApp or Telegram) provides us as your sender ID, so we know who to reply to.
- **The content of your messages** — the text you send us, so the currently-active service can answer your question, process a demo booking, or generate a recipe.
- **Photos you send** — if you're demoing Sentinel Cook, a photo of a dish is analyzed to identify it and generate a recipe.
- **Demo booking details** — if you're demoing Sentinel Concierge, the date, time, and duration of any appointment you request, written to a demo calendar.
- **Which service you're currently talking to** — Demo tracks whether you've switched to Concierge or Cook, so it knows which one should answer your next message.

We do not ask for or knowingly collect payment details, government ID numbers, or other sensitive personal data through this chat.

## 4. Why we collect it

- To answer your questions, using the same FAQ knowledge base Sentinel Concierge uses in production.
- To demonstrate the booking flow, including finding and confirming available demo appointment slots.
- To demonstrate the recipe flow, including identifying a dish from a photo and generating a recipe for it.
- To remember which of the two services you're currently demoing, so the right one responds.

## 5. How your data is processed

- Message text and photos are sent to our AI provider (OpenAI) to generate a response. OpenAI processes this under its own data-handling terms; we do not send them your phone number.
- Demo booking requests are sent to a Google Calendar to check availability and create appointments.
- Your conversation state (including which service is currently active, and any in-progress booking) is held in a short-lived session store and expires automatically after a limited period of inactivity.
- A record of message text, direction (inbound/outbound), and which service handled each turn is kept for demo troubleshooting purposes. We do not store the raw technical payload your messaging app sends us — only the message content described above.

## 6. Who we share it with

- **OpenAI** — processes message text and photos to generate responses.
- **Google Calendar** — stores demo appointment bookings made through the Concierge half of the demo.
- **WhatsApp (Meta) / Telegram** — the messaging platform you're using delivers your messages to us and our replies to you, under its own privacy terms.

We do not sell your data, and we do not share it with anyone else for marketing purposes.

## 7. Retention

Session/conversation state (including which service you're demoing and any in-progress booking) expires automatically after a short period of inactivity. Message and demo-booking records are kept only as long as reasonably necessary for demo troubleshooting, and are deleted on request (see below) or when the demo environment is reset.

## 8. Your rights

Under Singapore's Personal Data Protection Act (PDPA), you can ask us what personal data we hold about you, ask us to correct it, or ask us to delete it. To do any of these, contact:

**Email:** hello@gracesoft.dev
**Contact form:** https://gracesoft.dev/contact

We'll respond to reasonable requests within a reasonable time.

You can also delete your data yourself, straight from the chat: send **/deletemydata** and confirm when asked. That permanently deletes your conversation history with every agent in the demo and your saved chat state. Appointments already booked on the calendar stay booked — ask Sentinel Concierge to cancel them first if you want them gone. If anything can't be deleted automatically, you'll be told so and pointed to the contacts above.

## 9. Changes to this policy

We may update this policy as the demo's features change. The version and effective date at the top of this page will always reflect the current version.
