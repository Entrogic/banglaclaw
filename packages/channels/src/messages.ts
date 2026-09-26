import type { Language } from "@entrogic-net/shared";

export type NoticeKey =
  | "welcome"
  | "newSession"
  | "notAllowed"
  | "rateLimited"
  | "failed"
  | "textOnly"
  | "textOrVoice"
  | "voiceTooLong"
  | "voiceFailed"
  | "documentsOff"
  | "documentTooLarge"
  | "documentUnsupported"
  | "documentFailed";

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
  documentsOff: {
    bn: "দুঃখিত, এখানে ফাইল গ্রহণ করা চালু নেই। লেখাটি বার্তায় পাঠান।",
    "bn-en": "Sorry, ekhane file neya chalu nei. Lekhata message e pathan.",
    en: "Sorry, files aren't accepted here. Please paste the text in a message.",
  },
  documentTooLarge: {
    bn: "ফাইলটি অনেক বড়। ছোট একটি ফাইল পাঠান।",
    "bn-en": "File ta onek boro. Choto ekta file pathan.",
    en: "That file is too large. Please send a smaller one.",
  },
  documentUnsupported: {
    bn: "এই ধরনের ফাইল পড়তে পারি না। PDF, DOCX, TXT, Markdown, CSV বা JSON পাঠান।",
    "bn-en": "Ei dhoroner file porte pari na. PDF, DOCX, TXT, Markdown, CSV ba JSON pathan.",
    en: "I can't read that kind of file. Please send a PDF, DOCX, TXT, Markdown, CSV or JSON file.",
  },
  documentFailed: {
    bn: "দুঃখিত, ফাইলটি সংরক্ষণ করতে পারিনি। একটু পরে আবার চেষ্টা করুন।",
    "bn-en": "Sorry, file ta save korte parini. Ektu pore abar try korun.",
    en: "Sorry, I couldn't save that file. Please try again shortly.",
  },
};

export function notice(key: NoticeKey, language: Language): string {
  return NOTICES[key][language];
}

/** What the agent is told when a file arrived and was stored in the workspace (the caption, if any, follows). */
export function documentNote(path: string, original: string, characters: number, language: Language): string {
  if (language === "en") return `[The user sent the file "${original}". It was saved in the workspace as ${path} (${characters} characters); read it with workspace_read.]`;
  if (language === "bn-en") return `[User "${original}" file pathiyeche. Workspace e ${path} hisebe save hoyeche (${characters} character); workspace_read diye porun.]`;
  return `[ব্যবহারকারী "${original}" ফাইলটি পাঠিয়েছেন। এটি workspace-এ ${path} নামে সংরক্ষিত হয়েছে (${characters} অক্ষর); workspace_read দিয়ে পড়ুন।]`;
}
