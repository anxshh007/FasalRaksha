# Phase-1 study — `reference/phase1/FasalRakshak_1.html`

A single-file vanilla-JS app (1,575 lines, 89 KB): `localStorage` as the database,
string-concatenated `innerHTML` as the renderer, a mock government registry, a local rule-based
parser, a computed match percentage, and Web Speech voice input. It is a prototype of the
**interface**, not of the architecture (PROMPT §3.2). This page is the inventory P9–P11 port from:
what carries forward as-is, what is promoted, what is corrected, and what is deleted.

Read with PROMPT PART IX and IX-B beside it.

---

## 1 · Identity that survives (PROMPT §9.1)

| Phase-1 | Value | Phase-2 destination |
|---|---|---|
| `--bg` | `#07110c` | NIGHT `--ground` |
| `--bg-soft` | `#0b1710` | NIGHT `--ground-soft` |
| `--card` | `#0e1b13` | NIGHT `--surface` |
| `--border` | `rgba(255,255,255,.09)` | NIGHT `--rule` `#1C2B22` (opaque hairline) |
| `--text` | `#f4f7f3` | NIGHT `--text` |
| `--muted` | `#91a097` | NIGHT `--text-muted` (kept exactly) |
| `--green` | `#b9e879` | NIGHT `--farmer` — the brand |
| `--blue` | `#7ec4ff` | NIGHT `--buyer` |
| `.buyer-theme` subtree swap | lime → sky | role theming, extended to a third role: FPO `#D2C09E` |
| Manrope 500–800 | display, `-2px`/`-3px` tracking | kept (Latin only; Devanagari tracking 0) |
| DM Sans 400–700 | interface | kept; DM Mono + Noto Sans Devanagari added |
| Breakpoints | 900 / 700 / 430 | kept; 360 becomes the design origin |

Hard-coded greys scattered through the file (`#718078 #78877e #65736b #738078 #6f7d74 #68756d
#526059 #5e6c64 #647069 #4e5953 #7d8b83 #c1cbc5 #b6c0ba #9ca8a1 …`) collapse into
`--text-muted` / `--text-faint`. `#4e5953` and `#526059` on `#07110c` fail WCAG AA and are not
carried (PROMPT §9.10).

## 2 · Component inventory

Legend: **KEEP** port the component and copy · **PROMOTE** keep its DNA, give it a bigger job ·
**CORRECT** keep the component, fix the behaviour (a P1-xx row) · **DELETE** remove (with reason).

### Chrome
| Component | Verdict | Notes |
|---|---|---|
| `.navbar` sticky, `backdrop-filter: blur(18px)` | CORRECT | Opaque `--ground` + bottom hairline; no blur (§9.6) |
| `.brand` + `.brand-icon` 🌾 | CORRECT | Wordmark + drawn glyph; emoji removed |
| `.brand-subtitle` "SMART AGRICULTURE" 8px | CORRECT | Below the 13px floor; rewrite or drop |
| `.nav-pill` row (Home · Farmer · Buyer · Sign in) | KEEP | Reduced to `HOME · SELL · BUYERS · MY DEALS` (§9.7) |
| `.nav-cta` "Get Started →" | KEEP | Landing only |
| `✅ <first name>` verified pill in nav | DELETE | Security/verification signalling chip (P1-07) |
| — | NEW | Record spine: district · language · theme · sync · as-of (§9.6) |

### Landing (`renderHome`)
| Component | Verdict | Notes |
|---|---|---|
| `.eyebrow` "✦ AI-POWERED AGRICULTURE" | DELETE | Constitution §8, §17 |
| `h1` "Better crops. Better buyers. Better outcomes." | CORRECT | Keep the three-beat display type; rewrite to the thesis ("protects the decision before the buyer names the price") |
| `.hero-text` marketplace/"language understanding" framing | CORRECT | Not a marketplace (§2.1) |
| `.primary-button` / `.blue` / `.secondary-button` | KEEP | Radius 10 → 4; hover lift kept, shadow bloom removed |
| `.trust-row` 🤖 AI Matching · 🌐 · 📍 | DELETE | AI signifier + emoji iconography |
| `.glow` blur(70px) orb | DELETE | Generic AI-product grammar |
| `.farmer-visual-card` gradient + 35/90 shadow | PROMOTE | Becomes a real benchmark preview computed from the bundle — never a static mock (Constitution §1) |
| `LIVE MATCHING` + `AI` chip, `BEST MATCH 94%` | DELETE | P1-01, Constitution §6/§8 |
| `.floating-stat` ×2 | DELETE | Decoration carrying no data (§9.2) |
| `.steps` / `.step-card` / `.step-number` | KEEP | Step number = field-label treatment; emoji icons → glyphs |
| `.feature-grid` / `.feature-card` | KEEP | Copy rewritten to the six leaks |
| `.language-pills` हिन्दी বাংলা ਪੰਜਾਬੀ English | PROMOTE | Marathi leads; becomes the pre-login language choice (§10.1) |
| `.role-card` farmer / buyer | KEEP | + FPO card in `--fpo` |
| `.final-cta` radial gradient | CORRECT | Flat ground |
| `footer` "About this build" | PROMOTE | Ancestor of Judge Mode, generated from live state (§14.4) |
| "Reset demo data" | KEEP | Resets the local cache only; server seed reset is an ops script |

### Verification (`renderAuth`) — P1-09
| Component | Verdict | Notes |
|---|---|---|
| `.auth-tabs` Sign Up / Sign In | KEEP | |
| `.verify-note` 🛡️ "Only farmers verified…" | CORRECT | Re-pointed at the **buyer** (GSTIN/Udyam); shield removed |
| Simulated 1,100 ms registry round-trip + spinner "Checking government records…" | KEEP | Now a real server round-trip through `FarmerRegistryAdapter` / `BuyerRegistryAdapter` |
| `.info-message` "✅ Verified against government records: <name> — district, state" | KEEP | Without the tick emoji; the verified district becomes the parser's location fallback (P1-04) |
| "Not you? Re-check ID" (`.advanced-toggle`) | KEEP | 44px touch target |
| Error "This Farmer ID was not found in government farmer records…" | KEEP | Already a domain explanation (§10.4) |
| `.demo-disclaimer` "🔒 Demo build — verification runs against a small sample registry…" | CORRECT | Keep the honest sentence, drop the padlock chip framing (P1-07) |
| Demo IDs `PMK-WB-…`, `PMK-UP-…` | CORRECT | Reseed Maharashtra: `PMK-MH-…`, Nashik/Latur (§16.1) |
| Farmer gated before dashboard; buyer ungated | CORRECT | **Inverted** (P1-09) |

### Farmer dashboard (`renderFarmer`)
| Component | Verdict | Notes |
|---|---|---|
| Centred `.dashboard-intro` "Find the right buyer for your crop." | CORRECT | Home becomes a morning briefing: benchmark first, before any input (§9.7) |
| `.panel` 20px radius + 30/80 shadow | CORRECT | 4px, hairline rule, no shadow |
| `.verified-card` + `.v-badge` ✅ | CORRECT | Identity line without the badge |
| `.badge-soft` "🔒 Runs locally" | DELETE | P1-07 |
| "Choose your language" `<select>` inside the dashboard that changes only speech | CORRECT | Moved **before login** into the spine; drives all six things (§10.1) |
| `.field-label-row` + `.mic-button` + `mic-pulse` | KEEP **exactly** | + offline "recording only" state + speech synthesis (§10.2) |
| `textarea#f-message` natural-language box | KEEP | Placeholder re-seeded: `मला ५ क्विंटल कांदा विकायचा आहे` |
| "🤖 Find Best Buyers" | CORRECT | No robot, no "AI" |
| `.understanding-card` "🤖 AI Understanding" + `Live AI` / `Local parser` | PROMOTE ×2 | → parse-confirm card (§9.9-3) and → evidence panel (§9.9-1). Title "Here's what we understood" / `आम्हाला हे समजलं` |
| `.understanding-grid` 4-up CROP · QUANTITY · EXPECTED PRICE · LOCATION | CORRECT | Quantity in the farmer's own unit (P1-02); price with an established unit (P1-03); district from the verified record (P1-04); unresolved fields become inline questions, never "Not detected" |
| `.understanding-note` "Parsed locally… no message data leaves your device unless you enable live AI" | DELETE | Security/AI signalling |
| `.advanced-toggle` + `.advanced-box` Groq key | CORRECT | Key input deleted (P1-10); the toggle component is repurposed as "Technical details" |
| `.matches-header` "SMART MATCHING / 🎯 Best Buyer Matches / Ranked by crop, price, quantity and location fit" | CORRECT | Ranked by net realisation, with reasons |
| `.listing-card` + `.best` gradient + `.best-badge` "⭐ BEST MATCH" | CORRECT | No award badge, no gradient; the ordering explains itself |
| `.match-score` `<strong>94</strong><span>MATCH</span>` | **DELETE** | P1-01 — the most important visual change |
| `.listing-info-grid` 💰 Offered · 📍 Location · 📦 Required | PROMOTE | → the net-realisation ledger: gross, vs today's district rate, distance, quantity overlap, after freight, completed deals, days-to-pay (§6.5) |
| `.contact-button` "Contact Buyer →" → `openContactModal` with raw email/phone | CORRECT | Modal shape kept; gate = offer + farmer acknowledgement; masked channel (P1-08) |
| `.empty-state` 📭 "No buyers listed yet" | CORRECT | Honest emptiness with alternatives: nearest mandi, today's rate, watchlist, pool, price revision (§10.4) |
| "📋 List your crop for sale" form: free-text name, crop, **Quantity (kg)**, **price ₹/quintal**, free-text location, contact | CORRECT | Name = verified identity (immutable); quantity with unit; price with unit; district from registry; contact out of the listing (P1-02/03/04/08) |
| `.mini-listing` "My listings" + Remove | KEEP | + sync state per listing (outbox) |

### Buyer dashboard (`renderBuyer`)
| Component | Verdict | Notes |
|---|---|---|
| `.buyer-theme` sky subtree | KEEP | |
| One "buying profile" per device, with contact | CORRECT | Several concurrent requirements with grade floor, radius (FR-02/03); contact in its own table |
| Browse listings + `#b-search` | KEEP | Unverified buyers may browse and see prices; may not offer (§8.3) |
| `matchScore` percentages on the buyer side too | DELETE | P1-01 applies to both sides |

### Shared UI
| Component | Verdict | Notes |
|---|---|---|
| `.action-button` + `.secondary` `.blue` `.danger`, `:disabled`, `.spinner` | KEEP | Radius 4; no shadow bloom |
| `.error-message` ⚠️ | CORRECT | Every string a domain explanation (§10.4) |
| `.info-message` | PROMOTE | Starting point of the refusal card (§9.9-5), which must be more substantial |
| `#toast-wrap` / `.toast` + `toast-in` | KEEP | Shadow → the single floating token |
| `.modal-overlay` `blur(4px)` / `.modal-box` 20px | CORRECT | No blur; radius 4; single shadow token |
| `.role-modal-grid` | KEEP | + FPO |
| `.about-list` | PROMOTE | → Judge Mode |

## 3 · Behaviour inventory (what the code actually does)

| Phase-1 function | What it does | Verdict / row |
|---|---|---|
| `loadDB/saveDB` (`fasalraksha_db_v2`), `loadSettings`, `loadSession` | `localStorage` JSON blobs | Replaced by Dexie + PostgreSQL (P1-11) |
| `loadSession()` unconditional | Accidentally survives connectivity loss | Made deliberate: distinguish *server reached → rejected* from *network unavailable* (PROMPT §XI) |
| `GOV_FARMER_REGISTRY` + honest comment block | Bundled sample registry; comment says lookups must move server-side | Formalised as `FarmerRegistryAdapter` (Mock/Live), server-side only (§3.4) |
| `CROPS[]` with `syn[]` | 15 crops, Latin synonyms, emoji icons | Structure kept; Devanagari synonyms added; moved to `crops.json` in the data bundle (§6.1) |
| `findCropInText` using `new RegExp("\\b"+syn+"\\b")` | Word-boundary match | **Latent bug for Phase 2**: JS `\b` is ASCII-only, so it can never match a Devanagari word boundary. The Phase-2 tokenizer must not rely on `\b` |
| `CITIES[]` flat list (Kolkata, Delhi…) | Location by substring | Replaced by a district registry keyed to the verified district (P1-04) |
| `parseCropMessage(text, fallbackLocation)` | qty regex → **×100 for quintal**, ×1000 for tonne → kg integer | P1-02 |
| … price regex `₹/rs/inr` or `rupees/rupaye/rupaya/taka` | Bare integer, later shown as `/qtl` | P1-03 |
| … called as `parseCropMessage(message, "Kolkata")` | **Hard-coded fallback district at the call site** | P1-04 |
| … `urgent` from `urgent/jaldi/turant/asap/today/abhi` | Flag rendered as "Sounds urgent" | Not in the v3 contract. Candidate input to RK-7 (cash position / cannot wait); decided in P11 — dropped if it feeds nothing |
| `matchScore(sell, buy)` | +45 exact / +25 substring / +5 mismatch; +20 same city / +8; `buy.price/sell.price·20`; qty ratio; `Math.max(55, Math.min(98, …))` | P1-01, P1-05, P1-06 |
| `esc()` / `escJsAttr()` | Careful HTML + JS-attribute escaping, with a correct comment on ordering | Discipline kept; React removes the class; `dangerouslySetInnerHTML` never used (§8.5) |
| `inr()` `toLocaleString("en-IN")` | Currency formatting, English only | Locale-driven formatting in `@fasal/shared` i18n (§10.1) |
| `kg()` | Always renders kg | Echo the farmer's unit (P1-02) |
| `handleFindBuyers` → Groq `fetch` with browser key | LLM summary, falls back to local | Deleted from the browser; `ModelFallbackAdapter` server-side, only for what the cascade cannot resolve (P1-10, Constitution §14) |
| `toggleVoiceInput` + `VOICE_LANG_MAP` | `en-IN / hi-IN / bn-IN / pa-IN` — **no `mr-IN`** | Marathi added and leading; locale from the pre-login choice |
| `recognition.onerror` copy | "Microphone access was blocked — please allow mic permission…" | Domain-voiced error style worth keeping |
| `go('farmer')` redirect to auth | Farmer gated | Inverted (P1-09) |
| `handleAddListing` | Requires name, crop, qty, price, location | Name/district from identity; unit explicit; outbox-backed |
| `resetDemo()` | Clears everything behind a `confirm()` | Kept for the local cache |
| Inline `onclick="window.__fr…"` handlers | Global dispatch | Incompatible with a CSP without `unsafe-inline` — React event handlers only |

## 4 · Accessibility and performance defects to fix

- Text sizes 8–11px throughout (`.brand-subtitle` 8px, `.match-score span` 8px, `.tagline` 10px,
  `.hint` 9px, `.voice-hint` 9.5px) — floor is 13px, body 15px (§9.5).
- `#4e5953` (`.footer-copy`) and `#526059` (`.step-number`) on `#07110c` fail AA.
- `.icon-btn` (✕, ~24px) and `.advanced-toggle` (text link) below 44×44.
- No visible focus styles defined; focus relies on browser defaults, and the inputs replace the
  outline with a 3px 6%-alpha ring that is effectively invisible.
- `@import` of Google Fonts inside `<style>`: render-blocking, fails offline (P1-12).
- Emoji favicon and emoji iconography render differently per Android version.
- No `lang` attribute switching; Devanagari would fall back to a system face mid-line.

## 5 · Copy worth carrying (re-voiced into Marathi/Hindi/English in P11)

- "Tell us about your crop" / "Describe your crop" — the invitation.
- "Checking government records…" — the honest wait.
- "This Farmer ID was not found in government farmer records. Double-check the ID or contact
  your local agriculture office." — already a model domain error.
- "Not you? Re-check ID" — the escape hatch.
- "Voice input transcribes what you say directly into this box, in the language selected above."
- The `About this build` modal's candour — becomes Judge Mode, generated from live system state.
