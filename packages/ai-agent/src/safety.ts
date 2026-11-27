import type { Language } from "./types.js";

const emergencyPatterns = [
  /\b(severe chest pain|chest pain|can't breathe|cannot breathe|difficulty breathing|trouble breathing|heavy bleeding|uncontrolled bleeding|unconscious|not breathing|stroke symptoms|seizure|suicidal|kill myself)\b/i,
  /ಉಸಿರಾಡಲು ಆಗುತ್ತಿಲ್ಲ|ಉಸಿರಾಟದ ತೊಂದರೆ|ತೀವ್ರ ಎದೆ ನೋವು|ಎದೆ ನೋವು|ತೀವ್ರ ರಕ್ತಸ್ರಾವ|ಪ್ರಜ್ಞೆ ತಪ್ಪಿ|ಪ್ರಜ್ಞಾಹೀನ/i,
  /सांस नहीं ले पा|सांस लेने में दिक्कत|तेज़ सीने में दर्द|सीने में दर्द|बहुत खून बह|बेहोश|आत्महत्या|खुद को मार/i,
];

export function isPossibleEmergency(message: string): boolean {
  return emergencyPatterns.some((pattern) => pattern.test(message));
}

export function isBriefingConsent(message: string, language: Language): boolean {
  const normalized = message.trim().toLocaleLowerCase();
  const patterns: Record<Language, RegExp> = {
    en: /^(yes|i consent|i agree|yes, share|yes, create)([.! ]*)$/i,
    kn: /^(ಹೌದು|ನಾನು ಒಪ್ಪುತ್ತೇನೆ|ಹಂಚಲು ಒಪ್ಪಿಗೆ)([.! ]*)$/i,
    hi: /^(हाँ|मैं सहमत हूँ|साझा करने की सहमति)([.! ]*)$/i,
  };
  return patterns[language].test(normalized);
}
