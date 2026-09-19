<!-- PART I of PROMPT.md, copied verbatim (PROMPT.md lines 59-84). Re-read at the start of every phase. -->

# PART I — THE CONSTITUTION

**Copy this into `CONSTITUTION.md`. Re-read before every phase. Violating any line is a build failure, not a style disagreement.**

1. **Nothing is for show.** Every button does what it says. Every number is computed by real code from real inputs. I will change an input and watch the output move.
2. **No hardcoded results.** No fixture array pretending to be computation. No `if (demo) return 1950`.
3. **One implementation of every domain rule**, in `@fasal/shared`. Parser, units, benchmark, decision, matching, aggregation, deal state, dispute, vision post-processing, staleness. Imported by frontend, backend, WhatsApp, SMS, IVR; mirrored by the Python pipeline under parity tests. **A WhatsApp reply and an offline home screen must produce the identical number.**
4. **The model never receives farmer-identifying input.** It predicts `crop × district × horizon`, never `farmer × crop × district`. Anything needing lot size, storage access or cash position runs **on the device**. This boundary is what makes the output space enumerable and the whole offline architecture possible.
5. **The refusal path is the product, not an error state.** "Evidence is not strong enough to suggest waiting." "Not enough current data to advise you." "Waiting may not be practical for this lot." A system that always has an answer is lying some of the time.
6. **No fake precision.** No `71.234%`. No point price without a band. No "AI Vision Score 83%". **No buyer match percentage.** Categories and bands only.
7. **Security is deep in the backend and invisible in the farmer UI.** No badges, no shields, no "encrypted", no "RLS enabled", no "zero trust", no padlock chips. The farmer experiences a verified buyer, a private contact, a trustworthy record. That is all.
8. **No model terminology on a farmer screen.** Never: model, algorithm, AI, ML, inference, prediction, confidence interval, quantile, score. Judge Mode (§14.4) is the only exception.
9. **Offline is enforced by the type system.** Deal-state transitions are **absent from the outbox union type**, so constructing an offline offer-acceptance is a **compile error**, not a runtime guard a missed conditional could reintroduce.
10. **Staleness governs advice, not just display.** Every price and forecast carries `asOf`. Bands widen with age. Recommendations are **suppressed entirely** past 7 days (perishables) / 14 days (grains). No code path lets a stale forecast reach a farmer wearing a recommendation.
11. **Explain first, rank second.** Never a bare score. Every ranked buyer carries a sentence a farmer can act on without trusting an algorithm they cannot inspect.
12. **Benchmark before price.** Every screen where a number is named or accepted shows today's district rate, the MSP floor and the 7-day trend. No exceptions.
13. **Marathi leads, and language is chosen before login.** It drives interface strings, number and currency formatting, speech-recognition locale, speech-synthesis voice **and the parser**. A selector that changes only the speech locale is a claim the product does not honour.
14. **Deterministic first, model second, never the reverse.** The crop parser is a rule cascade. A server-side model exists only as a fallback for what the cascade cannot resolve.
15. **Never fake a live integration.** Never display "Connected to Agmarknet" unless it is. Every external dependency sits behind an adapter with `mock` and `live` implementations of the identical interface; switching is **environment configuration, not code change**.
16. **Every error is a domain explanation.** Never "Something went wrong." Always what happened, in the farmer's terms, and what they can do.
17. **AI appears only where it creates real value**: quantile price forecasting, agricultural signal fusion, camera-assisted grading, language fallback. Never to make the product *appear* intelligent.
18. **Do not hide unfinished functionality behind impressive UI.** Do not substitute animation for function, mock buttons for real flows, or "AI-looking" graphics for actual algorithms.

**Do not build, under any circumstances:** chatbot-first interface · AI farming assistant · AI-generated agronomic advice · blockchain · cryptocurrency · tokens · social feed · follower system · gamification · points · fake AI confidence scores · fake point price predictions · fake security badges · a weather *prediction* model · public farmer phone numbers · government API credentials in the browser · offline deal finalisation · fake field-validated vision claims · moisture detection from RGB imagery · **generic buyer "match percentage"** · generic dashboard design.

**If a proposed feature does not answer a real failure mode, remove it and log it in `CUTS.md`.**
