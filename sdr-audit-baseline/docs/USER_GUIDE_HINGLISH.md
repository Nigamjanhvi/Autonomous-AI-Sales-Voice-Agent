# Carla Project Guide — Hinglish

Yeh guide current repository ke working screens aur APIs ke mutabiq hai. Jahan live provider setup
ya full browser test nahi hua hai, wahan clearly bataya gaya hai. Phase 5 ke RAG/API changes aur
Phase 0–4 ke already existing calling, booking, summaries, qualification aur Vapi code ko mila kar
project ka current status neeche hai.

## 1. Project mein kya hai

- **Dashboard:** Overview, Live Calls, Leads, Call History, Knowledge Base, Appointments, Analytics,
  aur Agent Settings.
- **Carla call modes:** `Predefined` deterministic scripted demo (OpenAI key ke baghair),
  `AI (Scripted)` (OpenAI), `AI (Interactive)` (OpenAI ke saath typed ya browser mic replies), aur
  `Vapi Live Voice` (browser se two-way audio; Vapi Custom LLM backend Carla ko call karta hai).
- **RAG/Knowledge Base:** PDF, DOCX, TXT upload backend ko jata hai. Text extract/chunk karke MongoDB
  mein rakha jata hai; Carla source excerpt par answer karti hai ya kehti hai verified jawab nahi hai.
- **Appointments:** Carla pehle available numbered slots offer karti hai. Lead ka usi slot ko confirm
  karna zaroori hai. Booking MongoDB mein reserve hoti hai; calendar invite/email send nahi hota.
- **Call close:** Transcript, summary, outcome, qualification evidence, sentiment aur booking backend
  mein persist hote hain. Call summary ka browser dashboard record bhi browser local storage mein
  rakhta hai.
- **Analytics/appointments UI note:** Kuch dashboard reporting/calendar views browser mein recorded
  calls se calculate/render hote hain. MongoDB APIs mein appointments/calls saved rehte hain, lekin
  dashboard har screen par server se saari historical calls reload nahi karta. API se backend data
  directly check karne ka tareeqa section 8 mein hai.
- **Workspace:** Abhi ek server-controlled local workspace hai. Login ya multi-tenant authentication
  implement nahi ki gayi.

## 2. Pehli dafa run karna

PowerShell mein repository ke app folder mein jaayein:

```powershell
Set-Location C:\Users\janhv\Downloads\AI-VoiceAgent\sdr-audit-baseline
npm.cmd ci
```

App ko MongoDB replica set/sharded cluster chahiye, kyunki calls/bookings transactions use karte hain.
Atlas URI use kar rahe hain to `.env` mein yeh configure karein:

```env
MONGODB_URI=mongodb+srv://<db-user>:<password>@<cluster>/<db-name>?retryWrites=true&w=majority
MONGODB_DB=sdr_agent
SEED_DEMO_DATA=true
```

`<...>` ko apne Atlas values se replace karein; apne keys/passwords kisi ko share na karein. Atlas
database user ko app database par `readWrite` access aur Atlas Network Access mein apne laptop ka
IP allow hona chahiye. URI mein special characters hon to password URL-encode karein.

`.env` pehle se hai to usay overwrite na karein. Agar nahi hai:

```powershell
Copy-Item .env.example .env
```

Ab dono app processes ek saath start karein:

```powershell
npm.cmd run dev
```

Browser mein `http://localhost:5173` kholein. API `http://localhost:3001` par hai. Health check:

```powershell
Invoke-RestMethod http://localhost:3001/health/db
```

`ok : True` aur `database : up` aaye to app MongoDB se connected hai. `.env` change karne ke baad
dev process rok kar (`Ctrl+C`) `npm.cmd run dev` dobara chalaayein; Vite browser variables startup
par load karta hai.

## 3. UI features ko kaise check karein

### 3.1 Dashboard aur Leads

1. Sidebar se **Overview** kholein. Lead data load hona chahiye; connection failure par API/MongoDB
   check karein.
2. **Leads** kholein. `SEED_DEMO_DATA=true` par Sarah Johnson / Growthly jaise demo leads milenge.
3. Lead record khol kar existing CRM details dekhein. Naya lead banane ka button/form use karke
   record save karein; refresh ke baad lead wapas aana chahiye.

### 3.2 No-cost deterministic call (pehla smoke test)

1. **Live Calls** kholein, Sarah Johnson jaisa seeded lead chunein, **Start call** dabayein.
2. Modal mein **Predefined** chunein. Is mode mein AI model/provider call nahi hota; fixed lead
   scenario ke saath poora sample flow chalta hai.
3. Call khatam hone par transcript/outcome/summary panel dekhein.
4. **Call History**, **Leads**, **Appointments**, aur **Analytics** mein naya record check karein.

Yeh scripted demo hai, asli prospect ki live awaaz nahi. `AI (Scripted)` bhi scenario-based demo hai,
lekin Carla ke jawab OpenAI model generate karta hai.

### 3.3 AI Interactive typed conversation

1. `.env` mein valid `OPENAI_API_KEY` rakhein. **AI (Interactive)** LLM mode hai, chahe general
   `AGENT_MODE` default deterministic ho; real key zaroori hai.
2. Restart karke Live Calls kholein, lead chunein, **Start call → AI (Interactive)**.
3. Carla ka intro aane par **Lead reply** box mein customer ka jawab type karke **Send reply** karein.
4. Is test conversation ke liye examples:
   - `We need to reduce manual follow-up. I am the decision maker. We want to start next month. We have an approved budget.`
   - Product/RAG check ke liye section 4 ke sawaal.
   - Booking check ke liye: `Can we book a meeting?` phir Carla ke offer ke baad exact `Option 1 works` (ya jo option aap choose karein).
5. **End call** dabayein. Call outcome aur summary dekh lein.

LLM answer provider response aur saved documents ke hisaab se badal sakta hai. Browser Microphone
button sirf supported browser speech-recognition implementation mein kaam karta hai; typed reply
har haal mein fallback hai.

### 3.4 English/Hindi conversation

1. Real OpenAI API key ke saath **AI (Interactive)** start karein.
2. English message bhejein, phir agla message Hindi mein type karein, misal: `इस प्रोडक्ट की कीमत क्या है?`
3. Carla se Hindi jawab expect karein. Vapi voice test mein Vapi assistant ke transcriber/voice
  providers mein Hindi support select karna bhi zaroori hai.

Prompt Hindi/English matching maangta hai aur Hindi product questions retrieval detector mein hain;
real model/Hindi audio result is run mein verify nahi hua.

## 4. Phase 5 — Knowledge Base / RAG check

1. Sidebar **Knowledge Base** kholein.
2. **Choose files** se text-readable `.txt`, `.pdf`, ya `.docx` upload karein. Max 10 MB per file.
   Transfer progress aur phir backend processing wait status dikhna chahiye.
3. **Documents** table mein file `indexed` ho. `failed` status aaye to error dekhein, phir **Reprocess**.
4. **Test knowledge search** mein aisa sawaal likhein jiska jawab file ke andar ho. Source document
   aur matching excerpt results mein aana chahiye.
5. File mein na hone wala sawaal search karein; relevant source nahi aana chahiye. Carla ke interactive
   call mein unsupported product facts par woh verified answer na hone ki baat kare.
6. Document delete karke list se hatna verify karein.

`Retrieval mode: mongodb_text_search_fallback` ka matlab MongoDB text index se lexical matching hai,
semantic vector search nahi. Atlas semantic retrieval ke liye pehle [Atlas index](ARCHITECTURE.md)
create karein, `.env` mein real `OPENAI_API_KEY`, `RAG_EMBEDDINGS_ENABLED=true`, aur sahi
`MONGODB_VECTOR_INDEX=knowledge_chunks_vector` set karke restart karein. Search ke baad UI/API mode
`atlas_vector_search` aaye tabhi vector query successfully chali. Is project session mein Atlas
index/query verify nahi hua.

Scanned/image-only PDF mein selectable text na ho to OCR ke baghair extract nahi hoga. Yeh files
`failed`/empty extraction dikhani chahiye; system unko jhoota `indexed` nahi batata.

## 5. Phase 6 — Qualification, appointment, summary, analytics

### Qualification aur sentiment

AI Interactive call mein customer se actual need, decision authority, timeline, budget ke baare mein
natural jawab lein. Carla ki scoring confirmed conversation evidence se hoti hai; unknown detail ko
confirmed nahi maana jata. Call ke baad outcome/score aur Lead profile dekhein. `Hot/Warm/Cold` exact
labels UI mein har jagah nahi; existing UI qualification status/score, lead outcome, interest aur
sentiment dikhata hai. Sentiment Positive/Neutral/Negative LLM analysis se aata hai. Predefined
scenario result scripted evaluation hota hai, asli customer sentiment nahi.

### Appointment ko safe tareeqe se verify karna

1. Interactive call mein lead ke taur par `Can we book a meeting?` bhejein.
2. Carla do available numbered options batayegi. `Option 1 works` ya `Option 2 works` jaisa exact
   selection bhejein.
3. Carla booking confirmation de; arbitrary option/pehle se offer na hua slot accept nahi hona chahiye.
4. **Appointments** page, call outcome, ya backend endpoint se booking dekhein.

UI Appointments page call ke locally displayed records se calendar banata hai. Backend MongoDB source
check ke liye:

```powershell
Invoke-RestMethod 'http://localhost:3001/api/appointments?status=booked'
Invoke-RestMethod 'http://localhost:3001/api/calendar/availability'
```

Booked slot availability response mein nahi aana chahiye. Backend same slot dobara book hone par
`409 SLOT_UNAVAILABLE` return karta hai. Booking internal hai; Google Calendar invite/email nahi jata.

### Call summary aur persistence

Call ko normally **End call** se finish karein. Summary, transcript, classification, analysis aur
booking MongoDB mein save hote hain. UI Call History local browser state mein recorded summaries
rakhta hai. Backend record APIs:

```powershell
Invoke-RestMethod 'http://localhost:3001/api/calls?limit=10'
```

Response se `callId` copy karke:

```powershell
Invoke-RestMethod 'http://localhost:3001/api/calls/<CALL_ID>'
```

Call details response mein transcript, summary, qualification analysis aur outcome honge. Backend
restart karke wahi API request dobara karein; MongoDB record rehna chahiye. Dashboard history browser
localStorage use karti hai, is liye doosre browser/device par uski local list automatically sync nahi
hoti.

### Analytics

**Overview** aur **Analytics** par total leads/calls, qualification, appointments, outcomes, sentiment,
conversion jaise cards check karein. Lead count API/backend se load hota hai; call analytics dashboard
ke browser mein record hui calls se calculate hote hain. Backend saved call list `GET /api/calls` se
verify karein. Dashboard ko alag browser mein kholna backend analytics aggregation ka test nahi hai.

## 6. Vapi setup — browser se Carla se baat karna

Yeh app ke **Live Calls → Vapi Live Voice** mode ke liye hai. Ismein laptop browser microphone aur
speaker Vapi browser SDK use karte hain. Carla ka prompt/tool logic backend par rehta hai. Localhost
backend ko Vapi ke server callbacks ke liye public HTTPS URL par reachable hona zaroori hai. Owner
reports Carla assistant v3 published hai aur Vapi URLs/credential configured hain, lekin yeh
dashboard state ya live tunnel is source inspection se independently verify nahi hui.

### 6.1 `.env` mein kaun sa Vapi value kahan se aata hai

| `.env` variable | Vapi setup mein source/maqsad | Browser ko secret? |
|---|---|---|
| `VITE_VAPI_PUBLIC_KEY` | Vapi dashboard ka browser/public key | Public key, browser mein use hoti hai |
| `VITE_VAPI_ASSISTANT_ID` | Vapi mein banaye assistant ka ID | Public config ID |
| `VITE_VAPI_MAX_CALL_DURATION_SECONDS` | Browser call ka local limit, default 300 | Nahi |
| `VAPI_PUBLIC_BASE_URL` | Vapi se reachable backend ka HTTPS base URL; localhost Vapi callback ko nahi milta | Nahi |
| `VAPI_SHARED_SECRET` | Aapka banaya lamba random secret; Vapi server credential isay Bearer token ke taur par bheje | Secret, backend only |
| `VAPI_SERVER_CREDENTIAL_ID` | Vapi mein banaye credential ka ID (webhook override ke liye) | Secret nahi, server config |
| `VAPI_API_KEY` | Vapi server API key; provider-side server/outbound features ke liye | Secret, backend only |
| `VAPI_ASSISTANT_ID` | Server-side assistant ID; outbound call planning/creation ke liye | Backend config |
| `VAPI_PHONE_NUMBER_ID` | Vapi phone number resource ID; outbound telephony ke liye | Backend config |
| `VAPI_ALLOW_OUTBOUND_CALLS` | Sirf outbound phone calling enable karta hai; default false rakhein | Nahi |

**Voice testing ke liye** `VITE_VAPI_PUBLIC_KEY` aur `VITE_VAPI_ASSISTANT_ID` required hain. Backend
Custom LLM/webhook endpoints par secret auth enforced hai: `VAPI_SHARED_SECRET` set karein aur
Vapi credential mein `Authorization: Bearer <same secret>` configure karein. Real outbound PSTN
call test nahi kar rahe to `VAPI_ALLOW_OUTBOUND_CALLS=false` hi rakhein; browser voice ke liye
outbound dialing enable karne ki zaroorat nahi.

`VITE_` sirf public values ke liye hai. `OPENAI_API_KEY`, `VAPI_API_KEY`, aur `VAPI_SHARED_SECRET`
ko `VITE_` naam na dein aur browser code/source mein paste na karein.

### 6.2 Vapi dashboard assistant setup

#### Aapki reported Vapi v3 configuration

Yeh settings owner ne report ki hain; inhein Vapi dashboard ya successful live test se independently
verify nahi kiya gaya:

| Vapi field | Reported value |
|---|---|
| Assistant | Carla |
| Published version / traffic | v3 / 100%; v2 / 0% |
| Custom LLM provider/model | Custom LLM / `gpt-4.1-mini` |
| Custom LLM base URL | `https://YOUR_NGROK_DOMAIN/api/vapi` |
| Endpoint suffix | `/chat/completions` |
| Resolved chat URL | `https://YOUR_NGROK_DOMAIN/api/vapi/chat/completions` |
| Vapi temperature / maximum tokens | `0.5` / `250` (backend does not read these request settings) |
| Assistant Server URL | `https://YOUR_NGROK_DOMAIN/api/vapi/webhook` |
| Server credential / auth / timeout | `Carla Backend Auth` / Bearer / 20 seconds |

Backend route `POST /api/vapi/chat/completions` uses backend `OPENAI_MODEL` and
`MAX_OUTPUT_TOKENS`; Vapi model/temperature/max-token fields are not passed into the backend model
request. Set `OPENAI_MODEL=gpt-4.1-mini` if you want the backend model to match the Vapi label, and
`MAX_OUTPUT_TOKENS=250` if you want that backend token cap. Backend temperature is not currently
settable. The endpoint returns regular JSON, not an SSE stream. `AGENT_TURN_TIMEOUT_MS` defaults to
20 seconds, matching the reported Vapi timeout; this leaves little time for network overhead, so if
the Vapi setting permits, use a larger upstream timeout and keep the backend timeout bounded.

Reported assistant published/traffic values are configuration status only. The live Vapi request,
current ngrok URL, and successful call have not been confirmed by repository tests.

1. Vapi dashboard mein assistant banayein aur apne supported STT/transcriber aur voice provider
   select karein. Assistant language/transcriber mein English aur Hindi enable karein agar providers
   support karte hon.
2. Assistant ke model/provider ko **Custom LLM** ya compatible custom OpenAI endpoint par set karein.
   URL:
   `https://<aapka-public-backend-host>/api/vapi/chat/completions`
3. Is endpoint ke request headers ke liye Vapi server credential select karein jisme
   `Authorization: Bearer <VAPI_SHARED_SECRET>` hai.
4. Assistant server/webhook URL set karein:
   `https://<aapka-public-backend-host>/api/vapi/webhook`
   Wahan bhi configured server credential set karein. `.env` ka `VAPI_SERVER_CREDENTIAL_ID` Vapi
   credential ID ho sakta hai.
5. Assistant ka prompt minimal rakhein; backend Carla prompt aur tools ka source hai. Vapi assistant
   mein alag sales policy likh kar backend se conflict na banayein.
6. `.env` mein backend URL aur browser key/assistant ID values set karke app servers restart karein.

### 6.2.1 Teen terminals start karein

`sdr-audit-baseline` folder se:

```powershell
# Terminal 1: backend
npm.cmd run dev:server
```

```powershell
# Terminal 2: local frontend
npm.cmd run dev:client
```

```powershell
# Terminal 3: ngrok external CLI, npm script nahi
ngrok http 3001
```

Alternative: `npm.cmd run dev` ek hi terminal mein frontend + backend chalata hai; phir doosre
terminal mein ngrok chalayein. Frontend `http://localhost:5173` aur backend `http://localhost:3001`
par hain. `ngrok http 3001` backend ke local port ko public HTTPS URL deta hai. Ngrok URL badle to
`VAPI_PUBLIC_BASE_URL`, Custom LLM base URL, aur Assistant Server URL sab update karein; phir app
restart karein.

Remote Vapi ko laptop ke `http://localhost:3001` ka access nahi hota. Local demo ke liye aapko apne
approved HTTPS tunnel/proxy se backend expose karna hoga aur uska URL `VAPI_PUBLIC_BASE_URL` mein
dena hoga. URL change hone par Vapi Custom LLM URL, webhook URL, aur `.env` teeno match karein.

### 6.3 Pehli voice conversation

1. Pehle `http://localhost:3001/health/db` check karein; OpenAI key/LLM mode bhi working ho.
2. Browser mein app kholein, **Live Calls** → seeded lead select → **Start call** → **Vapi Live Voice**.
3. Browser prompt aaye to microphone permission **Allow** karein. Headphones use karna echo/feedback
   kam karta hai.
4. Status `Provider connected`/listening dikhaye tab bolna start karein. Assistant `assistant-waits-for-user`
   mode mein start hota hai; pehle aap kahen, misal: “Hi Carla, we need help with manual sales follow-up.”
5. Carla ka jawab sunein. UI ke transcript mein user aur Carla ke final transcript lines dekh lein.
6. Hindi try karne ke liye kahen: `नमस्ते Carla, हमारे sales follow-up में बहुत समय लगता है।`
   Vapi transcriber Hindi configure na ho to pehle provider language settings theek karein.
7. Mute/unmute aur interruption controls check karein. **End call** se call close karein.
8. Call History mein completed call/summary dekhein. Backend API se bhi `GET /api/calls` phir
   `GET /api/calls/<CALL_ID>` check karein.

### 6.4 Agar voice connect nahi hoti

- `VITE_VAPI_PUBLIC_KEY` / `VITE_VAPI_ASSISTANT_ID` missing/placeholder: browser UI `.env` message
  dikhayegi. Values set karke Vite restart karein.
- Microphone prompt nahi aata: browser site permissions mein microphone allow karein. Browser ko
  localhost par ya HTTPS secure context mein kholein.
- Vapi `call-start` nahi aata: key/assistant ID, Vapi account, network, assistant provider setup
  check karein.
- Assistant backend se jawab nahi deta: Vapi Custom LLM URL exact `/api/vapi/chat/completions`
  ho, backend public HTTPS se reachable ho, Vapi credential Bearer secret se match kare, valid
  `OPENAI_API_KEY` ho, aur backend log mein API/model issue check karein. `leadId` call metadata mein
  forward hona chahiye; browser integration selected lead ko metadata/variables mein bhejta hai.
- Call connect ho lekin transcript/summary na save ho: webhook URL/auth aur end-of-call report event
  check karein; `GET /api/calls` mein provider call record inspect karein.
- Real phone par outbound call alag feature hai. Uske liye Vapi server API key, phone number ID,
  server assistant ID, shared credential, valid lead phone aur explicit outbound enable chahiye.
  Testing mein `VAPI_ALLOW_OUTBOUND_CALLS=false` rakhein.

### 6.5 Vapi verification status

| Status label | Current evidence |
|---|---|
| Configured | Custom LLM URL/model/tuning values aur Bearer webhook credential owner-reported hain; dashboard independently inspect nahi hua |
| Published | Carla v3 / 100% traffic owner-reported hai; source se verify nahi ho sakta |
| Locally tested successfully | Integration test mein Vapi route auth aur JSON response test credential/model stub ke saath pass hue; yeh live provider test nahi |
| Not yet verified | Current ngrok tunnel se real browser call, actual Custom LLM request, actual end-of-call webhook, Hindi voice, transcript/summary finalization |

Pehli live successful voice call aur backend record check ke baad hi Vapi ko locally tested mark karein.

## 7. Useful URLs aur APIs

- Dashboard: `http://localhost:5173`
- Backend DB health: `http://localhost:3001/health/db`
- Leads: `GET /api/leads`
- Knowledge list/search: `GET /api/knowledge/documents`, `GET /api/knowledge/search?q=...`
- Appointment availability/bookings: `GET /api/calendar/availability`, `GET /api/appointments`
- Calls: `GET /api/calls`, `GET /api/calls/<CALL_ID>`
- Vapi config state (secret reveal nahi karta): `GET /api/vapi/config`

PowerShell example:

```powershell
Invoke-RestMethod 'http://localhost:3001/api/vapi/config'
Invoke-RestMethod 'http://localhost:3001/api/calendar/availability'
Invoke-RestMethod 'http://localhost:3001/api/calls?limit=10'
```

## 8. Project checks aur honest current status

App folder se:

```powershell
npm.cmd run build
npm.cmd run lint
npm.cmd test
```

Current checked status: TypeScript build PASSED, lint PASSED, 10 integration tests PASSED (MongoDB
replica-set fixture + model stub). TXT multipart upload/retrieval aur workspace isolation automated
test hue. PDF/DOCX extraction, full browser walkthrough, real OpenAI responses, Hindi speech, live
Vapi connection, Atlas index/vector query abhi live account ke saath verify nahi hue. `npm test`
configured local `mongod` ya dedicated `MONGODB_TEST_URI` use karta hai; production/app DB ko test
URI na banayein.

## 9. Known limitations

- Single local workspace; login/multi-organization auth nahi.
- Default MongoDB retrieval text-search fallback hai jab tak actual Atlas vector query configured na ho.
- Analytics/appointments UI kuch had tak browser-local call records par based hai; MongoDB APIs ko
  persisted source verify karne ke liye use karein.
- Calendar booking MongoDB ke internal slots hain; koi external calendar invite/email nahi.
- Vapi integration code/config maujood hai, par real provider voice setup verify karna aapke keys,
  assistant, auth credential aur public HTTPS callback ke baad hoga.
