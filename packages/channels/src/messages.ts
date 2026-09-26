import type { Language } from "@entrogic-net/shared";

export type NoticeKey = "welcome" | "newSession" | "notAllowed" | "rateLimited" | "failed" | "textOnly" | "textOrVoice" | "voiceTooLong" | "voiceFailed";

const NOTICES: Record<NoticeKey, Record<Language, string>> = {
  welcome: {
    bn: "আসসালামু আলাইকুম! আমি BanglaClaw। বাংলা, Banglish বা ইংরেজিতে প্রশ্ন করুন। নতুন কথোপকথন শুরু করতে /new লিখুন।",
    "bn-en": "Assalamu alaikum! Ami BanglaClaw. Bangla, Banglish ba English e proshno korun. Notun conversation er jonno /new likhun.",
    en: "Hello! I'm BanglaClaw. Ask me anything in Bangla, Banglish or English. Send /new to start a fresh conversation.",
  },
  newSession: {
    bn: "নতুন কথোপকথন শুরু হলো।",
    "bn-en": "Notun conversation shuru holo.",
    en: "Started a new conversation.",
  },
  notAllowed: {
    bn: "দুঃখিত, এই বট ব্যবহারের অনুমতি আপনার নেই।",
    "bn-en": "Sorry, ei bot use korar permission apnar nei.",
    en: "Sorry, you are not allowed to use this bot.",
  },
  rateLimited: {
    bn: "অনেক বেশি বার্তা এসেছে। একটু পরে আবার চেষ্টা করুন।",
    "bn-en": "Onek beshi message eseche. Ektu pore abar try korun.",
    en: "Too many messages. Please try again in a moment.",
  },
  failed: {
    bn: "দুঃখিত, এখন উত্তর দিতে পারছি না। একটু পরে আবার চেষ্টা করুন।",
    "bn-en": "Sorry, ekhon uttor dite parchi na. Ektu pore abar try korun.",
    en: "Sorry, I couldn't answer right now. Please try again shortly.",
  },
  textOnly: {
    bn: "আপাতত শুধু লেখা বার্তা বুঝতে পারি।",
    "bn-en": "Apatoto shudhu text message bujhte pari.",
    en: "For now I can only read text messages.",
  },
  textOrVoice: {
    bn: "আপাতত শুধু লেখা বা ভয়েস বার্তা বুঝতে পারি।",
    "bn-en": "Apatoto shudhu text ba voice message bujhte pari.",
    en: "For now I can only understand text and voice messages.",
  },
  voiceTooLong: {
    bn: "ভয়েস বার্তাটি অনেক লম্বা। ছোট করে আবার পাঠান, অথবা লিখে পাঠান।",
    "bn-en": "Voice message ta onek lomba. Choto kore abar pathan, othoba likhe pathan.",
    en: "That voice message is too long. Please send a shorter one or type your message.",
  },
  voiceFailed: {
    bn: "দুঃখিত, ভয়েস বার্তাটি বুঝতে পারিনি। অনুগ্রহ করে আবার বলুন বা লিখে পাঠান।",
    "bn-en": "Sorry, voice message ta bujhte parini. Abar bolun ba likhe pathan.",
    en: "Sorry, I couldn't understand that voice message. Please try again or type it.",
  },
};

export function notice(key: NoticeKey, language: Language): string {
  return NOTICES[key][language];
}
