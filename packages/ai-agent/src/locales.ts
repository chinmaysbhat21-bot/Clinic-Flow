import type { Language } from "./types.js";

type CopyKey =
  | "chooseService" | "chooseDoctor" | "askDate" | "askTime" | "chooseSlot"
  | "noSlots" | "clinicInfoMissing" | "handoff" | "medicalBoundary"
  | "emergency" | "bookingStatusNeedId" | "bookingStatus" | "faqNotFound"
  | "cancelHandoff" | "rescheduleHandoff" | "serviceList" | "doctorList"
  | "generic" | "needMore" | "slotAndConsent" | "toolFailure" | "faqTranslationUnavailable";

export const copy: Record<Language, Record<CopyKey, string>> = {
  en: {
    chooseService: "Which service would you like to book?",
    chooseDoctor: "Which doctor would you prefer?",
    askDate: "What date would you prefer? You can say a day such as tomorrow or Friday.",
    askTime: "What time of day works for you: morning, afternoon, or evening?",
    chooseSlot: "These are the available times. Please choose one.",
    noSlots: "I couldn’t find an available time for those preferences. Would you like to try another date or doctor?",
    clinicInfoMissing: "I don’t have that clinic information. I can connect you with the clinic team.",
    handoff: "I’ll connect you with the clinic team for help.",
    medicalBoundary: "I can’t diagnose or recommend treatment. I can help book an appointment or connect you with qualified clinic staff.",
    emergency: "This may need urgent medical attention. Please contact local emergency services or go to the nearest emergency department now. Do not wait for a routine appointment.",
    bookingStatusNeedId: "Please provide your booking reference so I can check its status.",
    bookingStatus: "I found your booking. Please check the booking details shown by the clinic.",
    faqNotFound: "I couldn’t find that in the clinic’s information. I can connect you with the clinic team.",
    cancelHandoff: "I can’t safely complete cancellation in this system yet. I’ll connect you with the clinic team.",
    rescheduleHandoff: "I can’t safely complete rescheduling in this system yet. I’ll connect you with the clinic team.",
    serviceList: "Here are the clinic’s services:",
    doctorList: "Here are the clinic’s doctors:",
    generic: "I can help with appointments, clinic services, doctors, or clinic information. What would you like to do?",
    needMore: "Could you share a little more detail so I can help?",
    slotAndConsent: "Choose a time below. The booking form will ask for your consent before reserving it.",
    toolFailure: "I couldn’t reach the clinic system. I’ll connect you with the clinic team.",
    faqTranslationUnavailable: "I found the clinic’s information, but can’t translate it safely right now. I can connect you with the clinic team.",
  },
  kn: {
    chooseService: "ಯಾವ ಸೇವೆಗೆ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬೇಕು?",
    chooseDoctor: "ನಿಮಗೆ ಯಾವ ವೈದ್ಯರು ಬೇಕು?",
    askDate: "ಯಾವ ದಿನಾಂಕ ನಿಮಗೆ ಅನುಕೂಲ? ನಾಳೆ ಅಥವಾ ಶುಕ್ರವಾರದಂತಹ ದಿನವನ್ನು ಹೇಳಬಹುದು.",
    askTime: "ಯಾವ ಸಮಯ ಅನುಕೂಲ: ಬೆಳಿಗ್ಗೆ, ಮಧ್ಯಾಹ್ನ ಅಥವಾ ಸಂಜೆ?",
    chooseSlot: "ಇವು ಲಭ್ಯವಿರುವ ಸಮಯಗಳು. ಒಂದನ್ನು ಆಯ್ಕೆಮಾಡಿ.",
    noSlots: "ನಿಮ್ಮ ಆಯ್ಕೆಗೆ ಸಮಯ ಲಭ್ಯವಿಲ್ಲ. ಬೇರೆ ದಿನ ಅಥವಾ ವೈದ್ಯರನ್ನು ಪ್ರಯತ್ನಿಸಬೇಕೇ?",
    clinicInfoMissing: "ಆ ಕ್ಲಿನಿಕ್ ಮಾಹಿತಿ ಲಭ್ಯವಿಲ್ಲ. ಕ್ಲಿನಿಕ್ ಸಿಬ್ಬಂದಿಯೊಂದಿಗೆ ಸಂಪರ್ಕಿಸಬಹುದು.",
    handoff: "ಸಹಾಯಕ್ಕಾಗಿ ಕ್ಲಿನಿಕ್ ಸಿಬ್ಬಂದಿಯೊಂದಿಗೆ ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತೇನೆ.",
    medicalBoundary: "ನಾನು ರೋಗನಿರ್ಣಯ ಅಥವಾ ಚಿಕಿತ್ಸೆಯ ಸಲಹೆ ನೀಡಲು ಸಾಧ್ಯವಿಲ್ಲ. ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡಲು ಅಥವಾ ಅರ್ಹ ಸಿಬ್ಬಂದಿಯೊಂದಿಗೆ ಸಂಪರ್ಕಿಸಲು ಸಹಾಯ ಮಾಡುತ್ತೇನೆ.",
    emergency: "ಇದಕ್ಕೆ ತುರ್ತು ವೈದ್ಯಕೀಯ ಸಹಾಯ ಬೇಕಾಗಿರಬಹುದು. ದಯವಿಟ್ಟು ಈಗಲೇ ಸ್ಥಳೀಯ ತುರ್ತು ಸೇವೆಗಳನ್ನು ಸಂಪರ್ಕಿಸಿ ಅಥವಾ ಹತ್ತಿರದ ತುರ್ತು ಚಿಕಿತ್ಸಾ ವಿಭಾಗಕ್ಕೆ ಹೋಗಿ. ಸಾಮಾನ್ಯ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್‌ಗಾಗಿ ಕಾಯಬೇಡಿ.",
    bookingStatusNeedId: "ಬುಕಿಂಗ್ ಸ್ಥಿತಿ ಪರಿಶೀಲಿಸಲು ನಿಮ್ಮ ಬುಕಿಂಗ್ ಉಲ್ಲೇಖ ಸಂಖ್ಯೆಯನ್ನು ನೀಡಿ.",
    bookingStatus: "ನಿಮ್ಮ ಬುಕಿಂಗ್ ಕಂಡುಬಂದಿದೆ. ಕ್ಲಿನಿಕ್ ತೋರಿಸುವ ಬುಕಿಂಗ್ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಿ.",
    faqNotFound: "ಕ್ಲಿನಿಕ್ ಮಾಹಿತಿಯಲ್ಲಿ ಅದು ಕಂಡುಬಂದಿಲ್ಲ. ಕ್ಲಿನಿಕ್ ಸಿಬ್ಬಂದಿಯೊಂದಿಗೆ ಸಂಪರ್ಕಿಸಬಹುದು.",
    cancelHandoff: "ಈ ವ್ಯವಸ್ಥೆಯಲ್ಲಿ ರದ್ದತಿಯನ್ನು ಸುರಕ್ಷಿತವಾಗಿ ಪೂರ್ಣಗೊಳಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ. ಕ್ಲಿನಿಕ್ ಸಿಬ್ಬಂದಿಯೊಂದಿಗೆ ಸಂಪರ್ಕಿಸುತ್ತೇನೆ.",
    rescheduleHandoff: "ಈ ವ್ಯವಸ್ಥೆಯಲ್ಲಿ ಸಮಯ ಬದಲಾವಣೆಯನ್ನು ಸುರಕ್ಷಿತವಾಗಿ ಪೂರ್ಣಗೊಳಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ. ಕ್ಲಿನಿಕ್ ಸಿಬ್ಬಂದಿಯೊಂದಿಗೆ ಸಂಪರ್ಕಿಸುತ್ತೇನೆ.",
    serviceList: "ಕ್ಲಿನಿಕ್‌ನ ಸೇವೆಗಳು:",
    doctorList: "ಕ್ಲಿನಿಕ್‌ನ ವೈದ್ಯರು:",
    generic: "ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್, ಸೇವೆಗಳು, ವೈದ್ಯರು ಅಥವಾ ಕ್ಲಿನಿಕ್ ಮಾಹಿತಿಗೆ ನಾನು ಸಹಾಯ ಮಾಡಬಹುದು. ನಿಮಗೆ ಏನು ಬೇಕು?",
    needMore: "ಸಹಾಯ ಮಾಡಲು ಸ್ವಲ್ಪ ಹೆಚ್ಚಿನ ವಿವರ ನೀಡುತ್ತೀರಾ?",
    slotAndConsent: "ಕೆಳಗಿನ ಸಮಯವನ್ನು ಆಯ್ಕೆಮಾಡಿ. ಕಾಯ್ದಿರಿಸುವ ಮೊದಲು ಬುಕಿಂಗ್ ಫಾರ್ಮ್ ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಕೇಳುತ್ತದೆ.",
    toolFailure: "ಕ್ಲಿನಿಕ್ ವ್ಯವಸ್ಥೆಯನ್ನು ಸಂಪರ್ಕಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ಕ್ಲಿನಿಕ್ ಸಿಬ್ಬಂದಿಯೊಂದಿಗೆ ಸಂಪರ್ಕಿಸುತ್ತೇನೆ.",
    faqTranslationUnavailable: "ಕ್ಲಿನಿಕ್ ಮಾಹಿತಿ ಸಿಕ್ಕಿದೆ, ಆದರೆ ಈಗ ಅದನ್ನು ಸುರಕ್ಷಿತವಾಗಿ ಅನುವಾದಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ. ಕ್ಲಿನಿಕ್ ಸಿಬ್ಬಂದಿಯೊಂದಿಗೆ ಸಂಪರ್ಕಿಸಬಹುದು.",
  },
  hi: {
    chooseService: "आप कौन-सी सेवा बुक करना चाहते हैं?",
    chooseDoctor: "आप किस डॉक्टर को पसंद करेंगे?",
    askDate: "आपके लिए कौन-सी तारीख ठीक रहेगी? आप कल या शुक्रवार कह सकते हैं।",
    askTime: "आपके लिए कौन-सा समय ठीक है: सुबह, दोपहर या शाम?",
    chooseSlot: "ये उपलब्ध समय हैं। कृपया एक चुनें।",
    noSlots: "आपकी पसंद के अनुसार कोई समय नहीं मिला। क्या आप दूसरी तारीख या डॉक्टर आज़माना चाहेंगे?",
    clinicInfoMissing: "क्लिनिक की यह जानकारी उपलब्ध नहीं है। मैं आपको क्लिनिक टीम से जोड़ सकता हूँ।",
    handoff: "मैं मदद के लिए आपको क्लिनिक टीम से जोड़ता हूँ।",
    medicalBoundary: "मैं बीमारी का निदान या इलाज की सलाह नहीं दे सकता। मैं अपॉइंटमेंट बुक करने या योग्य क्लिनिक स्टाफ से जुड़ने में मदद कर सकता हूँ।",
    emergency: "इसमें तुरंत चिकित्सा सहायता की ज़रूरत हो सकती है। कृपया अभी स्थानीय आपातकालीन सेवा से संपर्क करें या नज़दीकी आपातकालीन विभाग जाएँ। सामान्य अपॉइंटमेंट का इंतज़ार न करें।",
    bookingStatusNeedId: "स्थिति देखने के लिए कृपया अपना बुकिंग संदर्भ दें।",
    bookingStatus: "आपकी बुकिंग मिल गई है। कृपया क्लिनिक में दिखाए गए बुकिंग विवरण देखें।",
    faqNotFound: "क्लिनिक की जानकारी में यह नहीं मिला। मैं आपको क्लिनिक टीम से जोड़ सकता हूँ।",
    cancelHandoff: "मैं इस सिस्टम में रद्दीकरण सुरक्षित रूप से पूरा नहीं कर सकता। मैं आपको क्लिनिक टीम से जोड़ता हूँ।",
    rescheduleHandoff: "मैं इस सिस्टम में समय बदलना सुरक्षित रूप से पूरा नहीं कर सकता। मैं आपको क्लिनिक टीम से जोड़ता हूँ।",
    serviceList: "क्लिनिक की सेवाएँ:",
    doctorList: "क्लिनिक के डॉक्टर:",
    generic: "मैं अपॉइंटमेंट, सेवाओं, डॉक्टरों या क्लिनिक की जानकारी में मदद कर सकता हूँ। आप क्या करना चाहेंगे?",
    needMore: "मदद के लिए थोड़ी और जानकारी देंगे?",
    slotAndConsent: "नीचे से समय चुनें। उसे सुरक्षित करने से पहले बुकिंग फ़ॉर्म आपकी सहमति माँगेगा।",
    toolFailure: "मैं क्लिनिक सिस्टम तक नहीं पहुँच पाया। मैं आपको क्लिनिक टीम से जोड़ता हूँ।",
    faqTranslationUnavailable: "क्लिनिक की जानकारी मिली, लेकिन अभी उसका सुरक्षित अनुवाद नहीं कर सकता। मैं आपको क्लिनिक टीम से जोड़ सकता हूँ।",
  },
};

export function text(language: Language, key: CopyKey): string {
  return copy[language][key];
}

const bookingStates: Record<Language, Record<string, string>> = {
  en: {
    HELD: "Your time is temporarily held. Complete the verification and payment steps shown by the clinic.",
    OTP_VERIFIED: "Your phone is verified. Please continue with the secure payment step.",
    PAYMENT_PENDING: "Your payment is pending. Please follow the status shown by the clinic before retrying.",
    PAYMENT_VERIFIED: "Your payment is verified. The clinic is completing confirmation.",
    CONFIRMATION_PENDING: "Your booking is being confirmed. Please contact the clinic before trying again.",
    CANCELLED: "This booking is cancelled.", REFUND_PENDING: "A refund is pending. Please contact the clinic for an update.",
    REFUNDED: "The clinic reports that this booking was refunded.", EXPIRED: "This booking time has expired. Please choose a new available time.",
  },
  kn: {
    HELD: "ನಿಮ್ಮ ಸಮಯವನ್ನು ತಾತ್ಕಾಲಿಕವಾಗಿ ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ. ಕ್ಲಿನಿಕ್ ತೋರಿಸುವ ಪರಿಶೀಲನೆ ಮತ್ತು ಪಾವತಿ ಹಂತಗಳನ್ನು ಪೂರ್ಣಗೊಳಿಸಿ.",
    OTP_VERIFIED: "ನಿಮ್ಮ ಫೋನ್ ಪರಿಶೀಲಿಸಲಾಗಿದೆ. ಸುರಕ್ಷಿತ ಪಾವತಿ ಹಂತವನ್ನು ಮುಂದುವರಿಸಿ.",
    PAYMENT_PENDING: "ನಿಮ್ಮ ಪಾವತಿ ಬಾಕಿಯಿದೆ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸುವ ಮೊದಲು ಕ್ಲಿನಿಕ್ ತೋರಿಸುವ ಸ್ಥಿತಿಯನ್ನು ಪರಿಶೀಲಿಸಿ.",
    PAYMENT_VERIFIED: "ನಿಮ್ಮ ಪಾವತಿ ಪರಿಶೀಲಿಸಲಾಗಿದೆ. ಕ್ಲಿನಿಕ್ ದೃಢೀಕರಣವನ್ನು ಪೂರ್ಣಗೊಳಿಸುತ್ತಿದೆ.",
    CONFIRMATION_PENDING: "ನಿಮ್ಮ ಬುಕಿಂಗ್ ದೃಢೀಕರಣದಲ್ಲಿದೆ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸುವ ಮೊದಲು ಕ್ಲಿನಿಕ್ ಅನ್ನು ಸಂಪರ್ಕಿಸಿ.",
    CANCELLED: "ಈ ಬುಕಿಂಗ್ ರದ್ದಾಗಿದೆ.", REFUND_PENDING: "ಮರುಪಾವತಿ ಬಾಕಿಯಿದೆ. ಮಾಹಿತಿ ಪಡೆಯಲು ಕ್ಲಿನಿಕ್ ಅನ್ನು ಸಂಪರ್ಕಿಸಿ.",
    REFUNDED: "ಈ ಬುಕಿಂಗ್‌ಗೆ ಮರುಪಾವತಿ ಆಗಿದೆ ಎಂದು ಕ್ಲಿನಿಕ್ ತಿಳಿಸಿದೆ.", EXPIRED: "ಈ ಸಮಯದ ಅವಧಿ ಮುಗಿದಿದೆ. ಹೊಸ ಸಮಯವನ್ನು ಆಯ್ಕೆಮಾಡಿ.",
  },
  hi: {
    HELD: "आपका समय कुछ देर के लिए रोका गया है। क्लिनिक में दिखाए गए सत्यापन और भुगतान के चरण पूरे करें।",
    OTP_VERIFIED: "आपका फ़ोन सत्यापित है। सुरक्षित भुगतान चरण आगे बढ़ाएँ।",
    PAYMENT_PENDING: "आपका भुगतान लंबित है। दोबारा कोशिश करने से पहले क्लिनिक में दिखा स्थिति देखें।",
    PAYMENT_VERIFIED: "आपका भुगतान सत्यापित है। क्लिनिक पुष्टि पूरी कर रहा है।",
    CONFIRMATION_PENDING: "आपकी बुकिंग की पुष्टि हो रही है। दोबारा कोशिश करने से पहले क्लिनिक से संपर्क करें।",
    CANCELLED: "यह बुकिंग रद्द है।", REFUND_PENDING: "रिफंड लंबित है। जानकारी के लिए क्लिनिक से संपर्क करें।",
    REFUNDED: "क्लिनिक के अनुसार इस बुकिंग का रिफंड हो गया है।", EXPIRED: "इस समय की अवधि समाप्त हो गई है। नया समय चुनें।",
  },
};

export function bookingStateText(language: Language, state: string): string | undefined {
  return bookingStates[language][state];
}

export function emergencyGuidancePrefix(language: Language): string {
  return language === "kn" ? "ಕ್ಲಿನಿಕ್ ತುರ್ತು ಸೂಚನೆ: " : language === "hi" ? "क्लिनिक का आपातकालीन निर्देश: " : "Clinic emergency guidance: ";
}
