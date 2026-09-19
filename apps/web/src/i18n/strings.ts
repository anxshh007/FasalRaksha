/**
 * Interface copy. Marathi leads (Constitution §17); English follows. No model terminology on a
 * farmer screen (Constitution §8): no "model", "AI", "prediction", "confidence", "score".
 *
 * The Marathi here is written for this build and is flagged for a native speaker's review before
 * the demonstration (ARCHITECTURE gap G-5). P11 extends this table to Hindi and the channels.
 */
import type { ConditionId, Headline } from '@fasal/shared';

export type Locale = 'mr' | 'en';

const STRINGS = {
  'app.name': { mr: 'फसल रक्षा', en: 'Fasal Raksha' },
  'app.tagline': { mr: 'शेताच्या बांधावरून बाजारभाव आणि खात्रीचे खरेदीदार', en: 'Market prices and verified buyers, from the field gate' },
  'lang.switch': { mr: 'English', en: 'मराठी' },

  'field.live': { mr: 'सर्व्हरशी जोडलेले', en: 'Connected' },
  'field.checking': { mr: 'नेटवर्क तपासत आहे…', en: 'Checking the network…' },
  'field.offline': { mr: 'फील्ड मोड — नेटवर्क नाही. सर्व भाव या फोनवरून मोजले जात आहेत.', en: 'Field mode — no network. Every figure is being calculated on this phone.' },
  'field.lastReached': { mr: 'शेवटचा संपर्क: {time}', en: 'Last connected: {time}' },
  'field.never': { mr: 'अजून सर्व्हरशी संपर्क झालेला नाही', en: 'Not yet connected to the server' },
  'field.waiting': { mr: 'पाठवायचे बाकी: {n}', en: 'Waiting to send: {n}' },

  'signin.title': { mr: 'सुरुवात करा', en: 'Get started' },
  'signin.phone': { mr: 'मोबाईल नंबर', en: 'Mobile number' },
  'signin.sendCode': { mr: 'कोड पाठवा', en: 'Send code' },
  'signin.code': { mr: 'एसएमएसमधील ६ अंकी कोड', en: 'The 6-digit code from the SMS' },
  'signin.devCode': { mr: 'चाचणी आवृत्ती — एसएमएस पाठवला जात नाही. कोड: {code}', en: 'Test build — no SMS is sent. Code: {code}' },
  'signin.name': { mr: 'तुमचे नाव', en: 'Your name' },
  'signin.continue': { mr: 'पुढे', en: 'Continue' },
  'signin.offline': { mr: 'साइन इन करण्यासाठी नेटवर्क लागते. नेटवर्क आल्यावर पुन्हा प्रयत्न करा.', en: 'Signing in needs a network. Please try again when you have one.' },

  'verify.title': { mr: 'तुमची शेतकरी नोंद', en: 'Your farmer record' },
  'verify.explain': { mr: 'तुमचा जिल्हा आणि गाव तुमच्या पीएम-किसान नोंदीवरून घेतले जातात.', en: 'Your district and village are taken from your PM-KISAN record.' },
  'verify.id': { mr: 'पीएम-किसान नोंदणी क्रमांक', en: 'PM-KISAN registration number' },
  'verify.submit': { mr: 'नोंद तपासा', en: 'Check my record' },

  'home.title': { mr: '{district} बाजार', en: '{district} market' },
  'home.rate': { mr: 'आजचा दर', en: "Today's rate" },
  'home.perQtl': { mr: 'प्रति क्विंटल', en: 'per quintal' },
  'home.range': { mr: 'किमान {min} · कमाल {max}', en: 'Low {min} · High {max}' },
  'home.msp': { mr: 'हमीभाव {amount} ({season})', en: 'MSP {amount} ({season})' },
  'home.asOf': { mr: '{date} चे भाव', en: 'Prices of {date}' },
  'home.stale': { mr: 'हे भाव जुने आहेत. जुन्या भावांवर सल्ला दिला जात नाही.', en: 'These prices are old. No advice is given on old prices.' },
  'home.computed': { mr: 'या फोनवर {time} ला मोजले', en: 'Calculated on this phone at {time}' },
  'home.synthetic': { mr: 'प्रात्यक्षिक आवृत्ती: भाव कृत्रिम माहितीवरून आहेत, खऱ्या बाजाराचे नाहीत.', en: 'Demonstration build: prices come from synthetic data, not a real market.' },
  'home.empty': { mr: 'या फोनवर अजून भाव नाहीत. नेटवर्क आल्यावर ते येतील.', en: 'No prices on this phone yet. They will arrive when there is a network.' },
  'home.lot': { mr: '{qty} क्विंटल मालासाठी', en: 'For a lot of {qty} quintals' },
  'home.why': { mr: 'कारण', en: 'Why' },
  'home.signOut': { mr: 'बाहेर पडा', en: 'Sign out' },

  'headline.SELL_NOW': { mr: 'आता विकणे योग्य', en: 'Selling now is sound' },
  'headline.WAIT_MAY_BE_POSSIBLE': { mr: 'थांबणे शक्य असू शकते', en: 'Waiting may be possible' },
  'headline.NOT_ENOUGH_EVIDENCE_TO_WAIT': { mr: 'थांबण्यासाठी पुरेसा पुरावा नाही', en: 'Not enough evidence to wait' },

  'refusal.GR-1': { mr: 'सल्ला देण्यासाठी पुरेशी ताजी माहिती नाही.', en: 'Not enough current data to advise you.' },
  'refusal.GR-2': { mr: 'अंदाज नेहमीच्या हंगामी पातळीपेक्षा चांगला ठरत नाही.', en: 'The forecast does not beat the normal seasonal baseline.' },
  'refusal.GR-3': { mr: 'थांबण्याचा सल्ला देण्याइतका पुरावा भक्कम नाही.', en: 'The evidence is not strong enough to suggest waiting.' },
  'refusal.GR-4': { mr: 'बाजारातील संकेत पुरेसे एकाच दिशेला नाहीत.', en: 'The signals do not agree strongly enough.' },
  'refusal.GR-5': { mr: 'हंगाम उलट दिशेला दाखवतो.', en: 'The season points the other way.' },
  'refusal.GR-6': { mr: 'अपेक्षित वाढ साठवण आणि नासाडीचा खर्चही भरून काढत नाही.', en: 'Expected upside does not cover storage and spoilage costs.' },
  'refusal.GR-7': { mr: 'या मालासाठी थांबणे व्यवहार्य नसू शकते.', en: 'Waiting may not be practical for this lot.' },
  'refusal.RK-7': { mr: 'संभाव्य तोटा तुम्ही सहन करू शकता त्यापेक्षा जास्त आहे.', en: 'The possible loss is more than you can afford to risk.' },

  'alert.title': { mr: 'भावाची सूचना', en: 'Price alert' },
  'alert.crop': { mr: 'पीक', en: 'Crop' },
  'alert.explain': { mr: '{crop} चा दर इतका झाल्यावर कळवा (₹ प्रति क्विंटल)', en: 'Tell me when {crop} reaches (₹ per quintal)' },
  'alert.set': { mr: 'सूचना ठेवा', en: 'Set alert' },
  'alert.queued': { mr: 'फोनवर जतन केले. नेटवर्क आल्यावर पाठवले जाईल.', en: 'Saved on this phone. It will be sent when there is a network.' },
  'alert.sent': { mr: 'सर्व्हरला मिळाले.', en: 'Received by the server.' },
  'alert.rejected': { mr: 'स्वीकारले नाही: {reason}', en: 'Not accepted: {reason}' },

  'error.generic': { mr: 'हे पूर्ण झाले नाही: {reason}', en: 'That did not go through: {reason}' },

  'spine.brand': { mr: 'फसल रक्षा — सुरुवात', en: 'Fasal Raksha — start' },
  'spine.district': { mr: 'जिल्हा', en: 'District' },
  'spine.language': { mr: 'भाषा बदला', en: 'Change language' },
  'spine.theme': { mr: 'रंगसंगती', en: 'Theme' },
  'spine.asOf': { mr: 'भावांची तारीख', en: 'Prices as of' },
  'theme.night': { mr: 'गडद', en: 'NIGHT' },
  'theme.field': { mr: 'उजळ', en: 'FIELD' },
  'theme.offer': { mr: 'उन्हात वापरणार आहात? उजळ रंगसंगती उन्हात वाचायला सोपी आहे.', en: 'Using this outdoors? The Field theme is easier to read in sunlight.' },
  'theme.bright': { mr: 'इथे खूप उजेड आहे. उजळ रंगसंगती वापरायची?', en: 'It is very bright here. Switch to the Field theme?' },
  'theme.useField': { mr: 'उजळ वापरा', en: 'Use Field' },
  'theme.keepNight': { mr: 'गडदच ठेवा', en: 'Keep Night' },

  'nav.label': { mr: 'मुख्य मेनू', en: 'Main menu' },
  'nav.home': { mr: 'मुख्य', en: 'HOME' },

  'strip.live': { mr: 'जोडलेले', en: 'LIVE' },
  'strip.field': { mr: 'फील्ड मोड', en: 'FIELD MODE' },
  'strip.lastSync': { mr: 'शेवटचा संपर्क {time}', en: 'LAST SYNC {time}' },
  'strip.never': { mr: 'अजून संपर्क नाही', en: 'NOT YET SYNCED' },
  'strip.checking': { mr: 'तपासत आहे', en: 'CHECKING' },
  'strip.waiting': { mr: 'पाठवायचे बाकी {n}', en: '{n} WAITING TO SEND' },
  'strip.explain': { mr: 'नेटवर्क नसतानाही सर्व भाव आणि निर्णय या फोनवर मोजले जातात.', en: 'With no network, every price and decision is calculated on this phone.' },

  'landing.title': { mr: 'आधी आजचा दर. मग तुमचा सुरक्षित निर्णय.', en: "Today's rate first. Then your decision, protected." },
  'landing.thesis': {
    mr: 'खरेदीदार भाव सांगण्याआधीच फसल रक्षा तुमचा निर्णय सुरक्षित ठेवते — आणि शेतात नेटवर्क नसतानाही चालते.',
    en: 'Fasal Raksha protects your decision before the buyer names the price — and keeps working in the field without a network.',
  },
  'landing.language': { mr: 'भाषा निवडा', en: 'Choose your language' },
  'landing.how': { mr: 'हे कसे काम करते', en: 'How it works' },
  'step.label': { mr: 'पायरी {n}', en: 'STEP {n}' },
  'step.1.title': { mr: 'आजचा जिल्ह्याचा दर', en: "Today's district rate" },
  'step.1.body': { mr: 'तुमच्या जिल्ह्यातील बाजार समितीचा आजचा भाव, हमीभाव आणि सात दिवसांचा कल.', en: 'Your district market rate, the MSP floor and the seven-day movement.' },
  'step.2.title': { mr: 'थांबावं की विकावं', en: 'Wait or sell' },
  'step.2.body': { mr: 'साठवण, नासाडी आणि व्याजाचा खर्च धरून. पुरावा पुरेसा नसेल तर तसं स्पष्ट सांगितलं जातं.', en: 'Net of storage, spoilage and interest. When the evidence is not enough, it says so plainly.' },
  'step.3.title': { mr: 'नेटवर्कशिवायही', en: 'Without a network' },
  'step.3.body': { mr: 'शेतात नेटवर्क नसलं तरी दर आणि निर्णय तुमच्या फोनवरच मोजले जातात.', en: 'In the field with no signal, the rate and the decision are still calculated on your phone.' },
  'signin.verifyNote': { mr: 'चाचणी आवृत्ती: पडताळणी एका छोट्या नमुना नोंदवहीवर चालते.', en: 'Test build: verification runs against a small sample registry.' },
  'signin.back': { mr: 'नंबर बदला', en: 'Change number' },
} as const satisfies Record<string, Record<Locale, string>>;

export type StringKey = keyof typeof STRINGS;

export function t(locale: Locale, key: StringKey, values: Record<string, string | number> = {}): string {
  return STRINGS[key][locale].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
}

export const headlineKey = (h: Headline): StringKey => `headline.${h}`;
export const refusalKey = (c: ConditionId): StringKey => `refusal.${c}`;

/**
 * Figures use Latin digits with Indian grouping in every language: every figure is set in DM Mono
 * for tabular alignment (§9.5), and DM Mono has no Devanagari digits. The words around them stay
 * Marathi. (`-u-nu-latn` keeps Marathi month names with Latin digits.)
 */
const intlLocale = (locale: Locale) => (locale === 'mr' ? 'mr-IN-u-nu-latn' : 'en-IN');

export function rupees(locale: Locale, amount: number): string {
  return new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

export function number(locale: Locale, value: number): string {
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 1 }).format(value);
}

export function clock(locale: Locale, epochMs: number): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(epochMs);
}

export function day(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

export function shortDay(locale: Locale, iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

export function shortTime(locale: Locale, epochMs: number, sameDay: boolean): string {
  const options: Intl.DateTimeFormatOptions = sameDay ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : { day: '2-digit', month: 'short' };
  return new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone: 'Asia/Kolkata' }).format(epochMs);
}
