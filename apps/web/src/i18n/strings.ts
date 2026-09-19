/**
 * Interface copy (PROMPT §10.1). Marathi leads (Constitution §17), then Hindi, then English: three
 * complete interfaces, not a translation of labels. The type below requires every string in all
 * three, so a missing translation fails the build. Bengali and Punjabi keep their place in
 * `@fasal/shared`'s locale list (the architecture carries them to other states), but they are
 * not offered until their tables are written.
 *
 * No model terminology on a farmer screen (Constitution §8): no "model", "AI", "prediction",
 * "confidence", "score". `design/interface.test.ts` scans this table for them.
 *
 * The Marathi and Hindi were written for this build and are flagged for a native speaker's review
 * before the demonstration (ARCHITECTURE gap G-5).
 */
import type { ConditionId, Headline } from '@fasal/shared';

export type Locale = 'mr' | 'hi' | 'en';
export const LOCALES: readonly Locale[] = ['mr', 'hi', 'en'];

const STRINGS = {
  "app.name": { mr: "फसल रक्षा", hi: "फसल रक्षा", en: "Fasal Raksha" },
  "app.tagline": { mr: "शेताच्या बांधावरून बाजारभाव आणि खात्रीचे खरेदीदार", hi: "खेत की मेड़ से मंडी भाव और भरोसेमंद ख़रीदार", en: "Market prices and verified buyers, from the field gate" },
  "signin.title": { mr: "सुरुवात करा", hi: "शुरू करें", en: "Get started" },
  "signin.phone": { mr: "मोबाईल नंबर", hi: "मोबाइल नंबर", en: "Mobile number" },
  "signin.sendCode": { mr: "कोड पाठवा", hi: "कोड भेजें", en: "Send code" },
  "signin.code": { mr: "एसएमएसमधील ६ अंकी कोड", hi: "एसएमएस में आया 6 अंकों का कोड", en: "The 6-digit code from the SMS" },
  "signin.devCode": { mr: "चाचणी आवृत्ती — एसएमएस पाठवला जात नाही. कोड: {code}", hi: "टेस्ट बिल्ड — एसएमएस नहीं भेजा जाता। कोड: {code}", en: "Test build — no SMS is sent. Code: {code}" },
  "signin.name": { mr: "तुमचे नाव", hi: "आपका नाम", en: "Your name" },
  "signin.continue": { mr: "पुढे", hi: "आगे", en: "Continue" },
  "signin.offline": { mr: "साइन इन करण्यासाठी नेटवर्क लागते. नेटवर्क आल्यावर पुन्हा प्रयत्न करा.", hi: "साइन इन के लिए नेटवर्क चाहिए। नेटवर्क आने पर फिर कोशिश करें।", en: "Signing in needs a network. Please try again when you have one." },
  "verify.title": { mr: "तुमची शेतकरी नोंद", hi: "आपका किसान रिकॉर्ड", en: "Your farmer record" },
  "verify.explain": { mr: "तुमचा जिल्हा आणि गाव तुमच्या पीएम-किसान नोंदीवरून घेतले जातात.", hi: "आपका ज़िला और गाँव आपके पीएम-किसान रिकॉर्ड से लिया जाता है।", en: "Your district and village are taken from your PM-KISAN record." },
  "verify.id": { mr: "पीएम-किसान नोंदणी क्रमांक", hi: "पीएम-किसान पंजीकरण संख्या", en: "PM-KISAN registration number" },
  "verify.submit": { mr: "नोंद तपासा", hi: "रिकॉर्ड जाँचें", en: "Check my record" },
  "home.perQtl": { mr: "प्रति क्विंटल", hi: "प्रति क्विंटल", en: "per quintal" },
  "home.range": { mr: "किमान {min} · कमाल {max}", hi: "न्यूनतम {min} · अधिकतम {max}", en: "Low {min} · High {max}" },
  "home.msp": { mr: "हमीभाव {amount} ({season})", hi: "एमएसपी {amount} ({season})", en: "MSP {amount} ({season})" },
  "home.asOf": { mr: "{date} चे भाव", hi: "{date} के भाव", en: "Prices of {date}" },
  "home.stale": { mr: "हे भाव जुने आहेत. जुन्या भावांवर सल्ला दिला जात नाही.", hi: "ये भाव पुराने हैं। पुराने भावों पर सलाह नहीं दी जाती।", en: "These prices are old. No advice is given on old prices." },
  "home.computed": { mr: "या फोनवर {time} ला मोजले", hi: "इस फ़ोन पर {time} बजे गिना गया", en: "Calculated on this phone at {time}" },
  "home.synthetic": { mr: "प्रात्यक्षिक आवृत्ती: भाव कृत्रिम माहितीवरून आहेत, खऱ्या बाजाराचे नाहीत.", hi: "प्रदर्शन बिल्ड: भाव कृत्रिम आँकड़ों से हैं, असली मंडी के नहीं।", en: "Demonstration build: prices come from synthetic data, not a real market." },
  "home.empty": { mr: "या फोनवर अजून भाव नाहीत. नेटवर्क आल्यावर ते येतील.", hi: "इस फ़ोन पर अभी भाव नहीं हैं। नेटवर्क आने पर आ जाएँगे।", en: "No prices on this phone yet. They will arrive when there is a network." },
  "home.lot": { mr: "{qty} क्विंटल मालासाठी", hi: "{qty} क्विंटल माल के लिए", en: "For a lot of {qty} quintals" },
  "home.signOut": { mr: "बाहेर पडा", hi: "बाहर निकलें", en: "Sign out" },
  "headline.SELL_NOW": { mr: "आता विकणे योग्य", hi: "अभी बेचना ठीक है", en: "Selling now is sound" },
  "headline.WAIT_MAY_BE_POSSIBLE": { mr: "थांबणे शक्य असू शकते", hi: "रुकना संभव हो सकता है", en: "Waiting may be possible" },
  "headline.NOT_ENOUGH_EVIDENCE_TO_WAIT": { mr: "थांबण्यासाठी पुरेसा पुरावा नाही", hi: "रुकने के लिए पर्याप्त सबूत नहीं", en: "Not enough evidence to wait" },
  "refusal.GR-1": { mr: "सल्ला देण्यासाठी पुरेशी ताजी माहिती नाही.", hi: "सलाह देने के लिए पर्याप्त ताज़ा जानकारी नहीं है।", en: "Not enough current data to advise you." },
  "refusal.GR-2": { mr: "अंदाज नेहमीच्या हंगामी पातळीपेक्षा चांगला ठरत नाही.", hi: "अनुमान सामान्य मौसमी स्तर से बेहतर साबित नहीं होता।", en: "The forecast does not beat the normal seasonal baseline." },
  "refusal.GR-3": { mr: "थांबण्याचा सल्ला देण्याइतका पुरावा भक्कम नाही.", hi: "रुकने की सलाह देने लायक सबूत मज़बूत नहीं है।", en: "The evidence is not strong enough to suggest waiting." },
  "refusal.GR-4": { mr: "बाजारातील संकेत पुरेसे एकाच दिशेला नाहीत.", hi: "संकेत पर्याप्त रूप से एक दिशा में नहीं हैं।", en: "The signals do not agree strongly enough." },
  "refusal.GR-5": { mr: "हंगाम उलट दिशेला दाखवतो.", hi: "मौसम उलटी दिशा दिखाता है।", en: "The season points the other way." },
  "refusal.GR-6": { mr: "अपेक्षित वाढ साठवण आणि नासाडीचा खर्चही भरून काढत नाही.", hi: "अपेक्षित बढ़त भंडारण और ख़राबी का ख़र्च भी नहीं निकालती।", en: "Expected upside does not cover storage and spoilage costs." },
  "refusal.GR-7": { mr: "या मालासाठी थांबणे व्यवहार्य नसू शकते.", hi: "इस माल के लिए रुकना व्यावहारिक नहीं हो सकता।", en: "Waiting may not be practical for this lot." },
  "refusal.RK-7": { mr: "संभाव्य तोटा तुम्ही सहन करू शकता त्यापेक्षा जास्त आहे.", hi: "संभावित नुकसान आपकी सहने की सीमा से ज़्यादा है।", en: "The possible loss is more than you can afford to risk." },
  "alert.title": { mr: "भावाची सूचना", hi: "भाव की सूचना", en: "Price alert" },
  "alert.crop": { mr: "पीक", hi: "फ़सल", en: "Crop" },
  "alert.explain": { mr: "{crop} चा दर इतका झाल्यावर कळवा (₹ प्रति क्विंटल)", hi: "{crop} का भाव इतना होने पर बताएँ (₹ प्रति क्विंटल)", en: "Tell me when {crop} reaches (₹ per quintal)" },
  "alert.set": { mr: "सूचना ठेवा", hi: "सूचना लगाएँ", en: "Set alert" },
  "alert.queued": { mr: "फोनवर जतन केले. नेटवर्क आल्यावर पाठवले जाईल.", hi: "इस फ़ोन पर सहेजा गया। नेटवर्क आने पर भेजा जाएगा।", en: "Saved on this phone. It will be sent when there is a network." },
  "alert.sent": { mr: "सर्व्हरला मिळाले.", hi: "सर्वर को मिल गया।", en: "Received by the server." },
  "alert.rejected": { mr: "स्वीकारले नाही: {reason}", hi: "स्वीकार नहीं हुआ: {reason}", en: "Not accepted: {reason}" },
  "error.generic": { mr: "हे पूर्ण झाले नाही: {reason}", hi: "यह पूरा नहीं हुआ: {reason}", en: "That did not go through: {reason}" },
  "spine.district": { mr: "जिल्हा", hi: "ज़िला", en: "District" },
  "spine.language": { mr: "भाषा बदला", hi: "भाषा बदलें", en: "Change language" },
  "spine.theme": { mr: "रंगसंगती", hi: "रंग-योजना", en: "Theme" },
  "spine.asOf": { mr: "भावांची तारीख", hi: "भावों की तारीख़", en: "Prices as of" },
  "theme.night": { mr: "गडद", hi: "गहरा", en: "NIGHT" },
  "theme.field": { mr: "उजळ", hi: "उजला", en: "FIELD" },
  "theme.offer": { mr: "उन्हात वापरणार आहात? उजळ रंगसंगती उन्हात वाचायला सोपी आहे.", hi: "बाहर धूप में इस्तेमाल करेंगे? उजली रंग-योजना धूप में पढ़ने में आसान है।", en: "Using this outdoors? The Field theme is easier to read in sunlight." },
  "theme.bright": { mr: "इथे खूप उजेड आहे. उजळ रंगसंगती वापरायची?", hi: "यहाँ बहुत रोशनी है। उजली रंग-योजना अपनाएँ?", en: "It is very bright here. Switch to the Field theme?" },
  "theme.useField": { mr: "उजळ वापरा", hi: "उजली अपनाएँ", en: "Use Field" },
  "theme.keepNight": { mr: "गडदच ठेवा", hi: "गहरी ही रखें", en: "Keep Night" },
  "nav.label": { mr: "मुख्य मेनू", hi: "मुख्य मेनू", en: "Main menu" },
  "nav.home": { mr: "मुख्य", hi: "मुख्य", en: "HOME" },
  "strip.live": { mr: "जोडलेले", hi: "जुड़ा हुआ", en: "LIVE" },
  "strip.field": { mr: "फील्ड मोड", hi: "फ़ील्ड मोड", en: "FIELD MODE" },
  "strip.lastSync": { mr: "शेवटचा संपर्क {time}", hi: "आख़िरी संपर्क {time}", en: "LAST SYNC {time}" },
  "strip.never": { mr: "अजून संपर्क नाही", hi: "अभी संपर्क नहीं हुआ", en: "NOT YET SYNCED" },
  "strip.checking": { mr: "तपासत आहे", hi: "जाँच रहे हैं", en: "CHECKING" },
  "strip.waiting": { mr: "पाठवायचे बाकी {n}", hi: "भेजना बाक़ी {n}", en: "{n} WAITING TO SEND" },
  "strip.explain": { mr: "नेटवर्क नसतानाही सर्व भाव आणि निर्णय या फोनवर मोजले जातात.", hi: "नेटवर्क न होने पर भी हर भाव और फ़ैसला इसी फ़ोन पर गिना जाता है।", en: "With no network, every price and decision is calculated on this phone." },
  "landing.title": { mr: "आधी आजचा दर. मग तुमचा सुरक्षित निर्णय.", hi: "पहले आज का भाव। फिर आपका सुरक्षित फ़ैसला।", en: "Today's rate first. Then your decision, protected." },
  "landing.thesis": { mr: "खरेदीदार भाव सांगण्याआधीच फसल रक्षा तुमचा निर्णय सुरक्षित ठेवते — आणि शेतात नेटवर्क नसतानाही चालते.", hi: "ख़रीदार के भाव बोलने से पहले ही फसल रक्षा आपके फ़ैसले की रक्षा करती है — और खेत में बिना नेटवर्क के भी चलती है।", en: "Fasal Raksha protects your decision before the buyer names the price — and keeps working in the field without a network." },
  "landing.language": { mr: "भाषा निवडा", hi: "अपनी भाषा चुनें", en: "Choose your language" },
  "landing.how": { mr: "हे कसे काम करते", hi: "यह कैसे काम करता है", en: "How it works" },
  "step.label": { mr: "पायरी {n}", hi: "चरण {n}", en: "STEP {n}" },
  "step.1.title": { mr: "आजचा जिल्ह्याचा दर", hi: "आज का ज़िले का भाव", en: "Today's district rate" },
  "step.1.body": { mr: "तुमच्या जिल्ह्यातील बाजार समितीचा आजचा भाव, हमीभाव आणि सात दिवसांचा कल.", hi: "आपके ज़िले की मंडी का आज का भाव, एमएसपी और सात दिन का रुख़।", en: "Your district market rate, the MSP floor and the seven-day movement." },
  "step.2.title": { mr: "थांबावं की विकावं", hi: "रुकें या बेचें", en: "Wait or sell" },
  "step.2.body": { mr: "साठवण, नासाडी आणि व्याजाचा खर्च धरून. पुरावा पुरेसा नसेल तर तसं स्पष्ट सांगितलं जातं.", hi: "भंडारण, ख़राबी और ब्याज घटाकर। सबूत काफ़ी न हो तो साफ़ बताया जाता है।", en: "Net of storage, spoilage and interest. When the evidence is not enough, it says so plainly." },
  "step.3.title": { mr: "नेटवर्कशिवायही", hi: "बिना नेटवर्क के भी", en: "Without a network" },
  "step.3.body": { mr: "शेतात नेटवर्क नसलं तरी दर आणि निर्णय तुमच्या फोनवरच मोजले जातात.", hi: "खेत में सिग्नल न हो तब भी भाव और फ़ैसला आपके फ़ोन पर ही गिने जाते हैं।", en: "In the field with no signal, the rate and the decision are still calculated on your phone." },
  "signin.verifyNote": { mr: "चाचणी आवृत्ती: पडताळणी एका छोट्या नमुना नोंदवहीवर चालते.", hi: "टेस्ट बिल्ड: जाँच एक छोटी नमूना रजिस्ट्री पर चलती है।", en: "Test build: verification runs against a small sample registry." },
  "signin.back": { mr: "नंबर बदला", hi: "नंबर बदलें", en: "Change number" },
  "brief.today": { mr: "आजचा बाजार", hi: "आज की मंडी", en: "TODAY'S MARKET" },
  "brief.head": { mr: "{crop} · {district}", hi: "{crop} · {district}", en: "{crop} · {district}" },
  "brief.change": { mr: "सात दिवसांत {delta}", hi: "सात दिनों में {delta}", en: "{delta} over seven days" },
  "brief.flat": { mr: "सात दिवसांत बदल नाही", hi: "सात दिनों में कोई बदलाव नहीं", en: "No change over seven days" },
  "brief.noTrend": { mr: "सात दिवसांत पुरेसे व्यवहार नाहीत", hi: "इस हफ़्ते रुख़ दिखाने लायक कारोबार के दिन कम हैं", en: "Too few trading days this week to show a movement" },
  "brief.msp": { mr: "हमीभाव {amount} · {season}", hi: "एमएसपी {amount} · {season}", en: "MSP floor {amount} · {season}" },
  "brief.vsMsp.above": { mr: "हमीभावापेक्षा {amount} जास्त", hi: "एमएसपी से {amount} ज़्यादा", en: "{amount} above the MSP floor" },
  "brief.vsMsp.below": { mr: "हमीभावापेक्षा {amount} कमी", hi: "एमएसपी से {amount} कम", en: "{amount} below the MSP floor" },
  "brief.vsMsp.at": { mr: "हमीभावाइतका", hi: "एमएसपी के बराबर", en: "At the MSP floor" },
  "brief.noMsp": { mr: "या पिकाला हमीभाव नाही", hi: "इस फ़सल का एमएसपी घोषित नहीं है", en: "No MSP is declared for this crop" },
  "brief.season.above": { mr: "या आठवड्याच्या नेहमीच्या भावापेक्षा जास्त", hi: "इस हफ़्ते के सामान्य भाव से ऊपर", en: "Above this week's usual range" },
  "brief.season.within": { mr: "या आठवड्याच्या नेहमीच्या पातळीत", hi: "इस हफ़्ते के सामान्य दायरे में", en: "Within this week's usual range" },
  "brief.season.below": { mr: "या आठवड्याच्या नेहमीच्या भावापेक्षा कमी", hi: "इस हफ़्ते के सामान्य भाव से नीचे", en: "Below this week's usual range" },
  "brief.season.none": { mr: "या आठवड्याची मागील वर्षांची माहिती नाही", hi: "इस हफ़्ते की पिछले सालों से तुलना के लिए जानकारी नहीं", en: "No earlier years to compare this week with" },
  "brief.arrivals": { mr: "आवक नेहमीच्या {pct}", hi: "आवक सामान्य की {pct}", en: "Arrivals {pct} of usual" },
  "brief.trendLabel": { mr: "सात दिवसांचा भाव", hi: "सात दिन का भाव", en: "Seven-day price" },
  "brief.otherCrops": { mr: "{district} मधील इतर पिके", hi: "{district} की दूसरी फ़सलें", en: "Other crops in {district}" },
  "raksha.lean.up": { mr: "बाजाराचा कल वाढीकडे आहे.", hi: "बाज़ार का रुख़ ऊपर की ओर है।", en: "Market is leaning upward." },
  "raksha.lean.down": { mr: "बाजाराचा कल घसरणीकडे आहे.", hi: "बाज़ार का रुख़ नीचे की ओर है।", en: "Market is leaning downward." },
  "raksha.lean.flat": { mr: "बाजार स्थिर दिसतो.", hi: "बाज़ार स्थिर दिखता है।", en: "Market looks steady." },
  "raksha.outlook": { mr: "पुढील {h} दिवस", hi: "अगले {h} दिन", en: "{h}-DAY OUTLOOK" },
  "raksha.direction": { mr: "संभाव्य दिशा", hi: "संभावित दिशा", en: "Likely direction" },
  "raksha.dir.up": { mr: "वर", hi: "ऊपर", en: "UP" },
  "raksha.dir.down": { mr: "खाली", hi: "नीचे", en: "DOWN" },
  "raksha.dir.flat": { mr: "स्थिर", hi: "स्थिर", en: "FLAT" },
  "raksha.range": { mr: "अपेक्षित पट्टा", hi: "अपेक्षित दायरा", en: "Expected range" },
  "raksha.rangeValue": { mr: "{low} — {high}", hi: "{low} — {high}", en: "{low} — {high}" },
  "raksha.strength": { mr: "पुराव्याचे बळ", hi: "सबूत की मज़बूती", en: "Evidence strength" },
  "raksha.strength.weak": { mr: "कमकुवत", hi: "कमज़ोर", en: "Weak" },
  "raksha.strength.moderate": { mr: "मध्यम", hi: "मध्यम", en: "Moderate" },
  "raksha.strength.strong": { mr: "भक्कम", hi: "मज़बूत", en: "Strong" },
  "raksha.asOf": { mr: "भावांची तारीख", hi: "भावों की तारीख़", en: "As of" },
  "raksha.today": { mr: "आज", hi: "आज", en: "today" },
  "raksha.bandLabel": { mr: "पुढील भावाचा अपेक्षित पट्टा {low} ते {high}, आजचा दर {today}", hi: "अगले भाव का अपेक्षित दायरा {low} से {high}, आज का भाव {today}", en: "Expected price range {low} to {high}; today {today}" },
  "raksha.net": { mr: "साठवण, नासाडी आणि व्याज धरून थांबल्यास: प्रति क्विंटल {amount}", hi: "रुकने पर, भंडारण, ख़राबी और ब्याज घटाकर: प्रति क्विंटल {amount}", en: "Waiting, after storage, spoilage and interest: {amount} per quintal" },
  "raksha.widened": { mr: "भाव {days} दिवस जुने आहेत, म्हणून पट्टा रुंद दाखवला आहे.", hi: "भाव {days} दिन पुराने हैं, इसलिए दायरा चौड़ा दिखाया गया है।", en: "Prices are {days} days old, so the range is shown wider." },
  "raksha.why": { mr: "का?", hi: "क्यों?", en: "Why?" },
  "lot.title": { mr: "तुमचा माल", hi: "आपका माल", en: "Your lot" },
  "lot.quantity": { mr: "क्विंटल", hi: "क्विंटल", en: "Quintals" },
  "lot.less": { mr: "एक क्विंटल कमी", hi: "एक क्विंटल कम", en: "One quintal less" },
  "lot.more": { mr: "एक क्विंटल जास्त", hi: "एक क्विंटल ज़्यादा", en: "One quintal more" },
  "lot.value": { mr: "आजच्या दराने किंमत {amount}", hi: "आज के भाव से क़ीमत {amount}", en: "Worth {amount} at today's rate" },
  "lot.storage": { mr: "जवळचे योग्य गोदाम: {name}, सुमारे {km} किमी", hi: "पास का उपयुक्त गोदाम: {name}, लगभग {km} किमी", en: "Nearest suitable storage: {name}, about {km} km" },
  "lot.noStorage": { mr: "60 किमीच्या आत या मालासाठी योग्य गोदाम नाही", hi: "60 किमी के भीतर इस माल के लिए उपयुक्त गोदाम नहीं", en: "No suitable storage for this lot within 60 km" },
  "lot.from.market": { mr: "अंतर {place} पासून मोजले", hi: "दूरी {place} से मापी गई", en: "Distances measured from {place}" },
  "lot.from.centroid": { mr: "अंतर जिल्ह्याच्या मुख्यालयापासून मोजले", hi: "दूरी ज़िला मुख्यालय से मापी गई", en: "Distances measured from the district headquarters" },
  "lot.private": { mr: "हे आकडे फक्त या फोनवर राहतात.", hi: "ये आँकड़े सिर्फ़ इसी फ़ोन पर रहते हैं।", en: "These figures stay on this phone." },
  "evidence.title": { mr: "हा निर्णय का?", hi: "यह फ़ैसला क्यों?", en: "Why this signal?" },
  "evidence.RK-1": { mr: "अलीकडचे भाव", hi: "हाल के भाव", en: "Market prices" },
  "evidence.RK-2": { mr: "हंगामातील स्थान", hi: "मौसमी स्थिति", en: "Seasonal position" },
  "evidence.RK-3": { mr: "बाजारातील आवक", hi: "मंडी में आवक", en: "Arrivals" },
  "evidence.RK-4": { mr: "पाऊस आणि हवामान", hi: "बारिश और मौसम", en: "Weather" },
  "evidence.RK-5": { mr: "अचानक हालचाल", hi: "अचानक उतार-चढ़ाव", en: "Unusual moves" },
  "evidence.RK-6": { mr: "पुढील भावाचा पट्टा", hi: "आगे के भाव का दायरा", en: "Range ahead" },
  "evidence.RK-7": { mr: "तुमचा संभाव्य तोटा", hi: "आपका संभावित नुकसान", en: "Your downside" },
  "evidence.RK-8": { mr: "संकेतांची सहमती", hi: "संकेतों की सहमति", en: "Evidence agreement" },
  "evidence.RK-9": { mr: "सात तपासण्या", hi: "सात जाँचें", en: "The seven checks" },
  "evidence.supporting": { mr: "समर्थनात", hi: "पक्ष में", en: "supporting" },
  "evidence.against": { mr: "विरोधात", hi: "विरोध में", en: "against" },
  "evidence.neutral": { mr: "तटस्थ", hi: "तटस्थ", en: "neutral" },
  "evidence.silent": { mr: "मोजलेला प्रभाव नाही", hi: "मापा गया असर नहीं", en: "no measured say" },
  "evidence.downside.pass": { mr: "कमी भाव आला तरी तोटा {loss} — तुमच्या {limit} मर्यादेत", hi: "कम भाव आने पर भी नुकसान {loss} — आपकी {limit} सीमा के भीतर", en: "At the low end: {loss} lost, within your {limit} limit" },
  "evidence.downside.fail": { mr: "कमी भाव आला तर तोटा {loss} — तुमच्या {limit} मर्यादेपेक्षा जास्त", hi: "कम भाव आने पर नुकसान {loss} — आपकी {limit} सीमा से ज़्यादा", en: "At the low end: {loss} lost, more than your {limit} limit" },
  "evidence.downside.na": { mr: "पोहोचण्याजोगे गोदाम नसल्याने मोजता आले नाही", hi: "पहुँच में गोदाम न होने से गिना नहीं जा सका", en: "Cannot be worked out without reachable storage" },
  "evidence.checks": { mr: "7 पैकी {n} तपासण्या पूर्ण", hi: "7 में से {n} जाँचें पूरी", en: "{n} of 7 checks pass" },
  "evidence.foot": { mr: "{date} च्या भावांवरून, या फोनवर मोजले", hi: "{date} के भावों से, इस फ़ोन पर गिना गया", en: "From prices of {date}, calculated on this phone" },
  "evidence.gate.GR-1": { mr: "भाव ताजे आहेत", hi: "भाव ताज़ा हैं", en: "Prices are fresh" },
  "evidence.gate.GR-2": { mr: "अंदाज नेहमीच्या पातळीपेक्षा चांगला", hi: "सामान्य मौसमी स्तर से बेहतर", en: "Beats the usual seasonal level" },
  "evidence.gate.GR-3": { mr: "पुरावा पुरेसा भक्कम", hi: "सबूत काफ़ी मज़बूत", en: "Evidence strong enough" },
  "evidence.gate.GR-4": { mr: "संकेत एकाच दिशेला", hi: "संकेत एक दिशा में", en: "Signals agree" },
  "evidence.gate.GR-5": { mr: "हंगाम विरोधात नाही", hi: "मौसम विरोध में नहीं", en: "Season does not contradict" },
  "evidence.gate.GR-6": { mr: "खर्चानंतरही फायदा", hi: "ख़र्च के बाद भी फ़ायदा", en: "Gain covers the costs" },
  "evidence.gate.GR-7": { mr: "गोदाम पोहोचण्याजोगे", hi: "गोदाम पहुँच में", en: "Storage within reach" },
  "evidence.gate.pass": { mr: "होय", hi: "हाँ", en: "yes" },
  "evidence.gate.fail": { mr: "नाही", hi: "नहीं", en: "no" },
  "evidence.gate.not-evaluated": { mr: "तपासता आले नाही", hi: "जाँचा नहीं जा सका", en: "not checked" },
  "tech.toggle": { mr: "तांत्रिक तपशील", hi: "तकनीकी विवरण", en: "Technical details" },
  "tech.layer": { mr: "{id}: दिशा {direction} · वजन {weight} · मूल्य {value}", hi: "{id}: दिशा {direction} · वज़न {weight} · मान {value}", en: "{id}: reading {direction} · weight {weight} · value {value}" },
  "tech.naive": { mr: "\"उद्या = आज\" पेक्षा चूक {pct} कमी (मागील माहितीवर तपासले)", hi: "\"कल = आज\" से ग़लती {pct} कम (पिछले आँकड़ों पर जाँचा गया)", en: "Error {pct} lower than \"tomorrow = today\" (checked on past data)" },
  "tech.seasonal": { mr: "हंगामी पातळीपेक्षा चूक {pct} कमी", hi: "मौसमी स्तर से ग़लती {pct} कम", en: "Error {pct} lower than the seasonal level" },
  "tech.coverage": { mr: "मागील माहितीवर खरा भाव पट्ट्यात {pct} वेळा", hi: "पिछले आँकड़ों में असली भाव {pct} बार दायरे के भीतर रहा", en: "On past data the actual price fell inside the range {pct} of the time" },
  "tech.kappa": { mr: "माहिती जुनी झाल्यावर पट्टा दररोज {pct} रुंद होतो", hi: "जानकारी पुरानी होने पर दायरा हर दिन {pct} चौड़ा होता है", en: "The range widens {pct} for each day the data ages" },
  "tech.agreement": { mr: "सहमतीचा वाटा {pct}", hi: "सहमति का हिस्सा {pct}", en: "Agreement share {pct}" },
  "tech.gate": { mr: "{id} {status} · मोजले {measured} · मर्यादा {threshold}", hi: "{id} {status} · मापा गया {measured} · सीमा {threshold}", en: "{id} {status} · measured {measured} · threshold {threshold}" },
  "tech.release": { mr: "माहिती आवृत्ती {version} · {source}", hi: "आँकड़ों का संस्करण {version} · {source}", en: "Data release {version} · {source}" },
  "tech.synthetic": { mr: "कृत्रिम", hi: "कृत्रिम", en: "synthetic" },
  "nav.sell": { mr: "विका", hi: "बेचें", en: "SELL" },
  "nav.deals": { mr: "माझा माल", hi: "मेरा माल", en: "MY DEALS" },
  "sell.title": { mr: "काय विकायचं आहे?", hi: "क्या बेचना है?", en: "What are you selling?" },
  "sell.prompt": { mr: "बोला किंवा लिहा", hi: "बोलें या लिखें", en: "Speak or type" },
  "sell.placeholder": { mr: "मला ५ क्विंटल कांदा विकायचा आहे", hi: "मेरे पास 5 क्विंटल प्याज़ है, बेचना है", en: "I want to sell 5 quintals of onion" },
  "sell.understand": { mr: "समजून घ्या", hi: "समझें", en: "Understand" },
  "sell.structured": { mr: "किंवा थेट भरा", hi: "या सीधे भरें", en: "Or fill it in directly" },
  "mic.speak": { mr: "बोला", hi: "बोलें", en: "SPEAK" },
  "mic.listening": { mr: "ऐकत आहे…", hi: "सुन रहे हैं…", en: "LISTENING…" },
  "mic.record": { mr: "आवाज जतन करा", hi: "आवाज़ सहेजें", en: "RECORD" },
  "mic.recording": { mr: "रेकॉर्ड होत आहे…", hi: "रिकॉर्ड हो रहा है…", en: "RECORDING…" },
  "mic.offlineNote": { mr: "नेटवर्क नाही: आवाज फोनवर जतन होईल आणि नेटवर्क आल्यावर लिहून घेतला जाईल. तोपर्यंत खालची माहिती भरा.", hi: "नेटवर्क नहीं: आवाज़ फ़ोन पर सहेजी जाएगी और नेटवर्क आने पर लिखी जाएगी। तब तक नीचे की जानकारी भरें।", en: "No network: your voice is saved on this phone and written down when the network returns. Meanwhile, fill in the details below." },
  "mic.unsupported": { mr: "या फोनवर आवाज ओळखता येत नाही; लिहून सांगा.", hi: "इस फ़ोन पर आवाज़ पहचानी नहीं जा सकती; लिखकर बताएँ।", en: "This phone cannot recognise speech; please type." },
  "mic.denied": { mr: "मायक्रोफोनला परवानगी मिळाली नाही. तुम्ही लिहून सांगू शकता.", hi: "माइक्रोफ़ोन की अनुमति नहीं मिली। आप लिखकर बता सकते हैं।", en: "The microphone was not allowed. You can type instead." },
  "mic.saved": { mr: "आवाज फोनवर जतन केला", hi: "आवाज़ फ़ोन पर सहेजी गई", en: "Recording saved on this phone" },
  "mic.transcribed": { mr: "तुमचा आवाज लिहून घेतला: “{text}”", hi: "आपकी आवाज़ लिखी गई: “{text}”", en: "Your recording was written down: “{text}”" },
  "mic.unrecognised": { mr: "रेकॉर्डिंग स्पष्ट ऐकू आलं नाही", hi: "रिकॉर्डिंग साफ़ सुनाई नहीं दी", en: "The recording could not be made out" },
  "confirm.title": { mr: "आम्हाला हे समजलं", hi: "हमने यह समझा", en: "Here's what we understood" },
  "confirm.crop": { mr: "पीक", hi: "फ़सल", en: "CROP" },
  "confirm.quantity": { mr: "प्रमाण", hi: "मात्रा", en: "QUANTITY" },
  "confirm.price": { mr: "अपेक्षित भाव", hi: "अपेक्षित भाव", en: "EXPECTED PRICE" },
  "confirm.place": { mr: "ठिकाण", hi: "जगह", en: "LOCATION" },
  "confirm.fromRecord": { mr: "तुमच्या नोंदीवरून", hi: "आपके रिकॉर्ड से", en: "from your record" },
  "confirm.fromMessage": { mr: "तुमच्या संदेशातून", hi: "आपके संदेश से", en: "from your message" },
  "confirm.whichCrop": { mr: "कोणतं पीक?", hi: "कौन-सी फ़सल?", en: "Which crop?" },
  "confirm.howMuch": { mr: "किती माल?", hi: "कितना माल?", en: "How much?" },
  "confirm.noPrice": { mr: "भाव सांगितला नाही — ऐच्छिक", hi: "भाव नहीं बताया — वैकल्पिक", en: "No price named — optional" },
  "confirm.addPrice": { mr: "अपेक्षित भाव (ऐच्छिक)", hi: "अपेक्षित भाव (वैकल्पिक)", en: "Expected price (optional)" },
  "confirm.priceFor": { mr: "{amount} कशासाठी?", hi: "{amount} किसके लिए?", en: "{amount} — for what?" },
  "confirm.priceUnitNeeded": { mr: "भाव कशासाठी आहे ते निवडा: प्रति क्विंटल, प्रति किलो की पूर्ण माल.", hi: "भाव किसके लिए है, चुनें: प्रति क्विंटल, प्रति किलो या पूरी खेप।", en: "Choose what the price is for: per quintal, per kilo or the whole lot." },
  "confirm.vsBenchmark.above": { mr: "आजच्या {market} दरापेक्षा {amount} जास्त", hi: "आज के {market} भाव से {amount} ज़्यादा", en: "{amount} above today's {market} rate" },
  "confirm.vsBenchmark.below": { mr: "आजच्या {market} दरापेक्षा {amount} कमी", hi: "आज के {market} भाव से {amount} कम", en: "{amount} below today's {market} rate" },
  "confirm.vsBenchmark.at": { mr: "आजच्या {market} दराइतका", hi: "आज के {market} भाव के बराबर", en: "The same as today's {market} rate" },
  "confirm.implausible": { mr: "{price} म्हणजे प्रति क्विंटल {perQtl} — आजच्या दराच्या {times} पट. एकक बरोबर आहे का?", hi: "{price} मतलब प्रति क्विंटल {perQtl} — आज के भाव का {times} गुना। इकाई सही है?", en: "{price} is {perQtl} per quintal — {times} times today's rate. Is the unit right?" },
  "confirm.crateWeight": { mr: "एका {unit} मध्ये किती किलो?", hi: "एक {unit} में कितने किलो?", en: "How many kilos in one {unit}?" },
  "confirm.change": { mr: "बदला", hi: "बदलें", en: "Change" },
  "unit.per.quintal": { mr: "प्रति क्विंटल", hi: "प्रति क्विंटल", en: "per quintal" },
  "unit.per.kg": { mr: "प्रति किलो", hi: "प्रति किलो", en: "per kilo" },
  "unit.per.tonne": { mr: "प्रति टन", hi: "प्रति टन", en: "per tonne" },
  "unit.per.crate": { mr: "प्रति क्रेट", hi: "प्रति क्रेट", en: "per crate" },
  "unit.per.lot": { mr: "पूर्ण मालासाठी", hi: "पूरी खेप के लिए", en: "for the whole lot" },
  "unit.q.kg": { mr: "किलो", hi: "किलो", en: "kg" },
  "unit.q.quintal": { mr: "क्विंटल", hi: "क्विंटल", en: "quintals" },
  "unit.q.tonne": { mr: "टन", hi: "टन", en: "tonnes" },
  "unit.q.crate": { mr: "क्रेट", hi: "क्रेट", en: "crates" },
  "unit.q.bag": { mr: "पोती", hi: "बोरी", en: "bags" },
  "review.title": { mr: "विक्रीसाठी ठेवण्याआधी", hi: "बिक्री पर लगाने से पहले", en: "Before you list" },
  "review.from": { mr: "कधीपासून उपलब्ध", hi: "कब से उपलब्ध", en: "Available from" },
  "review.until": { mr: "कधीपर्यंत", hi: "कब तक", en: "Available until" },
  "review.pool": { mr: "लहान मालासाठी गट विक्रीत सहभागी व्हायला तयार", hi: "छोटे माल के लिए समूह बिक्री में शामिल होने को तैयार", en: "Open to joining a group sale for a small lot" },
  "review.note": { mr: "टीप (ऐच्छिक)", hi: "टिप्पणी (वैकल्पिक)", en: "Note (optional)" },
  "review.submit": { mr: "विक्रीसाठी ठेवा", hi: "बिक्री पर लगाएँ", en: "List for sale" },
  "review.blocked": { mr: "आधी वरचे प्रश्न पूर्ण करा", hi: "पहले ऊपर के सवाल पूरे करें", en: "Answer the questions above first" },
  "listings.title": { mr: "माझा माल", hi: "मेरा माल", en: "My listings" },
  "listings.empty": { mr: "अजून काही विक्रीसाठी ठेवलेलं नाही.", hi: "अभी कुछ बिक्री पर नहीं लगाया।", en: "Nothing listed yet." },
  "listings.state.saved-here": { mr: "फोनवर जतन", hi: "फ़ोन पर सहेजा", en: "Saved on this phone" },
  "listings.state.waiting": { mr: "पाठवायचे बाकी", hi: "भेजना बाक़ी", en: "Waiting to send" },
  "listings.state.sent": { mr: "सर्वरला मिळाले", hi: "सर्वर को मिला", en: "Received by the server" },
  "listings.state.rejected": { mr: "स्वीकारले नाही: {reason}", hi: "स्वीकार नहीं हुआ: {reason}", en: "Not accepted: {reason}" },
  "listings.available": { mr: "{from} ते {until}", hi: "{from} से {until}", en: "{from} to {until}" },
  "listings.new": { mr: "आणखी माल विक्रीसाठी", hi: "और माल बेचें", en: "List another crop" },
  "listings.created": { mr: "विक्रीसाठी ठेवलं. नेटवर्क असेल तेव्हा सर्वरला पाठवलं जाईल.", hi: "बिक्री पर लगाया गया। नेटवर्क होने पर सर्वर को भेजा जाएगा।", en: "Listed. It goes to the server whenever there is a network." },
  "speak.read": { mr: "ऐका", hi: "सुनें", en: "LISTEN" },
  "speak.stop": { mr: "थांबा", hi: "रोकें", en: "STOP" },
  "speak.summary": { mr: "{crop}, {district}. आजचा दर प्रति क्विंटल {price}. {answer}", hi: "{crop}, {district}. आज का भाव प्रति क्विंटल {price}. {answer}", en: "{crop}, {district}. Today's rate is {price} per quintal. {answer}" },
  "lang.name.mr": { mr: "मराठी", hi: "मराठी", en: "मराठी" },
  "lang.name.hi": { mr: "हिन्दी", hi: "हिन्दी", en: "हिन्दी" },
  "lang.name.en": { mr: "English", hi: "English", en: "English" },
} as const satisfies Record<string, Record<Locale, string>>;

export type StringKey = keyof typeof STRINGS;

/** The template itself, for components that set inserted values apart (see Tx.tsx). */
export function raw(locale: Locale, key: StringKey): string {
  return STRINGS[key][locale];
}

export function t(locale: Locale, key: StringKey, values: Record<string, string | number> = {}): string {
  return STRINGS[key][locale].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
}

export const headlineKey = (h: Headline): StringKey => `headline.${h}`;
export const refusalKey = (c: ConditionId): StringKey => `refusal.${c}`;

/**
 * Figures use Latin digits with Indian grouping in every language: every figure is set in DM Mono
 * for tabular alignment (§9.5), and DM Mono has no Devanagari digits. The words around them stay
 * Marathi or Hindi. (`-u-nu-latn` keeps Marathi month names with Latin digits.)
 */
const intlLocale = (locale: Locale) => (locale === 'mr' ? 'mr-IN-u-nu-latn' : locale === 'hi' ? 'hi-IN-u-nu-latn' : 'en-IN');

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
