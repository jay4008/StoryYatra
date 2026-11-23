# Story Yatra — Backend + App Integration (poori guide)

Story Yatra ek Hindi audio-story app hai (React Native, Android + iOS). Saari kahaniyan free hain. Kamaai ads (AdMob) se hogi.

Ye file **akeli kaafi honi chahiye**. Ye folder (`PocketStoryBE`) doosre laptop pe jaayega. Audio wala laptop (`PsdCastStory`) sirf audio banane ke liye hai. Is file mein sab kuch hai: kya kya lagega, backend kaise chalta hai, React Native UI backend aur CDN se kaise baat karegi, deploy kaise hoga, aur kya kya baaki hai.

> Purani file (2026-10-11 wali plan) yahan rakhi hai: `README.old-2026-10-11.md`. Uski saari info is file mein aa chuki hai.

---

## Index

0. [Status](#0-status-2026-10-17)
1. [Do laptop — kaun kya karega](#1-do-laptop--kaun-kya-karega)
2. [Poora system ek nazar mein](#2-poora-system-ek-nazar-mein)
3. [Kya kya lagega (accounts, keys, tools)](#3-kya-kya-lagega)
4. [CDN (Cloudflare R2) — audio aur JSON](#4-cdn-cloudflare-r2--audio-aur-json)
5. [Backend — code, API, database](#5-backend)
6. [React Native app ↔ Backend: kaise baat karegi](#6-react-native-app--backend-kaise-baat-karegi)
7. [Naye laptop pe backend setup (local)](#7-naye-laptop-pe-backend-setup-local)
8. [VPS pe deploy](#8-vps-pe-deploy)
9. [Content pipeline (audio laptop)](#9-content-pipeline-audio-laptop)
10. [Scale, kharcha, domain badalna](#10-scale-kharcha-domain-badalna)
11. [Testing checklist](#11-testing-checklist)
12. [Kya kya baaki hai (order mein)](#12-kya-kya-baaki-hai-order-mein)

---

## 0. Status (2026-10-17)

| Hissa | Status |
|---|---|
| Audio storage (R2 + CDN) | ✅ Live. **12 books, 612 SFX parts, ~6.3 GB** |
| CDN settings (cache rule, rate limit) | ✅ Live |
| Backend: Google + Apple login, `/me`, account delete | ✅ Code likha. ❌ Deploy nahi. ❌ Test nahi |
| Backend: progress, events, config, admin sync | ⏳ Sirf plan (section 5.5) — code likhna baaki |
| `catalog.json` + 12 `book.json` | ✅ **Live on CDN** (2026-10-17). Audio laptop ka `tools_build_catalog.py` banata hai |
| Covers | ❌ Laptop pe kahin nahi mile (purana `~/Desktop/Qwen/covers/out/` khaali). Abhi JSON mein `cover: null` — app placeholder dikhaye. Images `PsdCastStory/covers/<slug>.jpg` mein daal ke script dobara chalao, khud upload ho jaayenge |
| React Native UI | ✅ UI ready (user ne banaya). Data/API jodna baaki |
| VPS security | ❌ Root password chat mein share hua tha — **badalna zaroori** |
| Git | ❌ Ye folder abhi git repo nahi hai (section 7.1) |

R2 pe abhi ye books hain (sab `sfx` version):

| Slug (kabhi nahi badalna) | Book | Parts | Size |
|---|---|---|---|
| `the-count-of-monte-cristo` | The Count of Monte Cristo | 119 | 1.94 GB |
| `saat-pheron-ka-sauda` | सात फेरों का सौदा | 110 | 0.79 GB |
| `rathore-ka-waaris` | राठौर का वारिस (complete) | 105 | 0.88 GB |
| `ashtam-chakra` | अष्टम चक्र | 100 | 0.67 GB |
| `sherlock-holmes` | Adventures of Sherlock Holmes | 36 | 0.50 GB |
| `around-the-world-in-eighty-days` | Around the World in Eighty Days | 26 | 0.34 GB |
| `mahadarar` | महादरार | 25 | 0.16 GB |
| `twenty-two-goblins` | Twenty-Two Goblins | 24 | 0.15 GB |
| `the-great-gatsby` | The Great Gatsby | 20 | 0.25 GB |
| `the-hungry-stones` | The Hungry Stones | 20 | 0.25 GB |
| `the-jungle-book` | The Jungle Book | 18 | 0.25 GB |
| `dr-jekyll-and-mr-hyde` | Dr Jekyll and Mr Hyde | 9 | 0.13 GB |

---

## 1. Do laptop — kaun kya karega

| | **Audio laptop** (`~/Desktop/PsdCastStory`) | **Dev laptop** (ye folder `PocketStoryBE` + RN app) |
|---|---|---|
| Kaam | Script → TTS → SFX → MP3 → R2 upload | Backend code, RN app, VPS deploy |
| Files jo sirf yahan hain | `r2_manifest.json` (kaun si file R2 pe kis key se gayi), `~/.r2cred.json` (R2 upload token), `tools_r2_upload.py` | `.env` (backend secrets), Apple `.p8` key, Google client IDs, keystore |
| R2 se rishta | Audio + (aage) `catalog.json`/`book.json` upload karta hai | Kuch upload nahi karta. App sirf CDN se **padhti** hai |
| VPS se rishta | Aage: `POST /admin/parts/sync` (parts table bharne ke liye, optional) | Deploy karta hai |

**Niyam:**
- `r2_manifest.json` sirf audio laptop pe. Haath se edit/delete kabhi nahi. Catalog generator isi se `book.json` banayega, isliye **catalog generator bhi audio laptop pe chalega**.
- Dev laptop ko R2 ka write token nahi chahiye (sirf DB backup ke liye alag private bucket ka token, section 8.6).
- Koi bhi secret (R2 token, `.env`, `.p8`, keystore, VPS password) **kabhi git mein nahi**, kabhi chat mein nahi.

---

## 2. Poora system ek nazar mein

```
                 ┌──────────────────────────────────────┐
                 │  React Native App (Android / iOS)     │
                 └───────┬──────────────────────┬────────┘
     audio, covers,      │                      │  login, progress,
     catalog/book JSON   │ (GET, public)        │  events (JSON, chhote)
                         ▼                      ▼
   ┌───────────────────────────────┐   ┌───────────────────────────────────┐
   │ https://cdn.technoplatsolution│   │ https://api.<domain>  (Cloudflare) │
   │ .online/   (Cloudflare CDN)   │   │        ↓                           │
   │        ↓                      │   │ VPS: nginx → Node API :4100 (PM2)  │
   │ R2 bucket "pocketstory"       │   │        ↓                           │
   └───────────────▲───────────────┘   │ PostgreSQL 14 (DB "storyyatra")    │
                   │                   └───────────────────────────────────┘
                   │ upload (audio laptop)
     ┌─────────────┴──────────────┐
     │ PsdCastStory pipeline      │
     │ script → TTS → SFX → MP3   │
     └────────────────────────────┘
```

**4 sabse zaroori niyam:**
1. **Audio kabhi backend se nahi jaata.** App seedha CDN se stream karti hai. Backend sirf chhote JSON calls sambhalta hai. VPS pe load nahi, bandwidth ka paisa zero.
2. **Content static hai.** Story list aur part list JSON files hain jo R2 pe padi hain. Naya part = MP3 upload + JSON update. App update nahi chahiye.
3. **Login optional hai.** Bina login sab sun sakte hain. Login sirf progress sync (doosre phone pe bhi wahi jagah) ke liye.
4. **Login do tarah: Google aur Apple.** iOS pe dono button zaroori (App Store guideline 4.8: Google login hai to "Sign in with Apple" bhi dena padega, warna reject). Android pe sirf Google kaafi.

**App kahan se kya leti hai (yaad rakhne ka tareeka):**

| Data | Kahan se | Login chahiye? |
|---|---|---|
| Story list (home) | CDN `catalog.json` | Nahi |
| Ek book ke parts | CDN `books/<slug>/book.json` | Nahi |
| Cover image | CDN `books/<slug>/cover.jpg` | Nahi |
| Audio | CDN `books/<slug>/sfx/part-0001-<sha8>.mp3` | Nahi |
| Config (cdn/api base, ads) | Firebase Remote Config (backup: API `/config`) | Nahi |
| Login | API `/auth/google`, `/auth/apple` | — |
| Profile | API `/me` | Haan |
| Progress sync | API `/progress` | Haan |
| Analytics | API `/events` | Nahi (deviceId se) |

---

## 3. Kya kya lagega

### 3.1 Accounts (ek baar banane hain)

| Account | Kis liye | Kharcha | Status |
|---|---|---|---|
| Cloudflare (`technoplatsolution.online`) | R2 + CDN + API ka DNS/SSL | R2 ~$0.1/mahina abhi | ✅ Hai |
| VPS (root access) | Backend + Postgres | Pehle se chal raha hai (4 apps) | ✅ Hai |
| Google Cloud Console | OAuth client IDs (Google login) | Free | ❌ Banana hai |
| Firebase project | Remote Config, Crashlytics, (Android Google login ka SHA-1 bhi yahin) | Free | ❌ Banana hai |
| Apple Developer Program | iOS app, Sign in with Apple | $99/saal | ❓ Check karo |
| Google Play Console | Android app publish | $25 ek baar | ❓ Check karo |
| AdMob | Ads (Android + iOS app alag register) | Free | ❌ Banana hai |
| Domain | Auto-renew ON rakhna (expire hua to koi aur kharid ke purane app ko apna content dikha sakta hai) | — | ✅ Hai |

### 3.2 Keys / IDs jo banani hain (aur kahan jaayengi)

| Cheez | Kahan banegi | Backend `.env` mein | RN app mein |
|---|---|---|---|
| Google **Web** client ID | Google Cloud → APIs & Services → Credentials → OAuth client (Web) | `GOOGLE_CLIENT_IDS` mein **zaroor** | `GoogleSignin.configure({webClientId})` |
| Google **Android** client ID | Same jagah, type Android, package name + **SHA-1** (debug + release + Play App Signing teeno) | `GOOGLE_CLIENT_IDS` mein (optional, safe) | Kuch nahi (auto) |
| Google **iOS** client ID | Same jagah, type iOS, bundle id | `GOOGLE_CLIENT_IDS` mein | `iosClientId` + reversed client ID as URL scheme in `Info.plist` |
| OAuth consent screen | Google Cloud → OAuth consent screen (app name, logo, privacy URL) | — | — |
| Apple bundle id (`com.storyyatra.app` jaisa) | Apple Developer → Identifiers → App ID, "Sign in with Apple" capability ON | `APPLE_CLIENT_IDS` | Xcode → Signing & Capabilities → + Sign in with Apple |
| Apple Services ID | Sirf agar Android pe bhi Apple login dena ho (optional) | `APPLE_CLIENT_IDS` mein add | Android web flow |
| Apple Sign-in key (`.p8`) + Key ID + Team ID | Apple Developer → Keys | `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (agla phase: account delete pe token revoke) | — |
| JWT secret | `openssl rand -base64 48` | `JWT_SECRET` | — |
| Postgres password | Khud banao (lamba random) | `DATABASE_URL` | — |
| AdMob App ID (Android + iOS) | AdMob console | — | `app.json` / `AndroidManifest` / `Info.plist` |
| AdMob ad unit IDs (banner, interstitial, rewarded) | AdMob console | — | Code / Remote Config |
| `google-services.json` / `GoogleService-Info.plist` | Firebase console | — | `android/app/` / iOS project |
| Android release keystore | `keytool` | — | `android/app/` (git mein nahi, **backup zaroor** — kho gaya to app update nahi kar paoge) |
| Admin key (parts sync ke liye) | `openssl rand -hex 32` | `ADMIN_KEY` (agla phase) | — (sirf audio laptop script) |

**Sabse common galti:** Google login mein app ka `idToken` ka audience **Web client ID** hota hai (Android/iOS wala nahi). Agar `.env` ke `GOOGLE_CLIENT_IDS` mein Web client ID nahi daala, to har login `invalid_google_token` dega.

**Doosri common galti:** Android release build pe Google login nahi chalta kyunki **Play App Signing ka SHA-1** Google Cloud/Firebase mein add nahi kiya. Play Console → Setup → App signing se SHA-1 copy karke add karo.

### 3.3 Software

| Kahan | Kya |
|---|---|
| Dev laptop | Node 20 LTS (VPS jaisa; `nvm install 20`), npm, Postgres 14+ (local test ke liye: `brew install postgresql@16` ya Docker), git, Xcode + CocoaPods (iOS), Android Studio + JDK 17 |
| VPS | Node 20, PM2, nginx, PostgreSQL 14 — sab pehle se hai |

### 3.4 RN app ke liye libraries

| Kaam | Library | Note |
|---|---|---|
| Navigation | `@react-navigation/native` (+ native-stack, bottom-tabs) | |
| Audio (background, lock screen, notification controls) | `react-native-track-player` | Background mode iOS mein ON (Audio), Android foreground service |
| Google login | `@react-native-google-signin/google-signin` | |
| Apple login | `@invertase/react-native-apple-authentication` | iOS native |
| Ads | `react-native-google-mobile-ads` | |
| Data fetch + cache | `@tanstack/react-query` | |
| Fast local storage (progress, downloads list, cache) | `react-native-mmkv` | |
| **Token storage (secure)** | `react-native-keychain` | JWT yahan rakho, MMKV mein plain nahi |
| Offline download | `react-native-blob-util` (ya `react-native-fs`) | |
| Device ID (analytics) | `react-native-get-random-values` + `uuid` → ek baar bana ke MMKV mein | Advertising ID mat use karo |
| Remote config | `@react-native-firebase/app` + `remote-config` | |
| Crash report | `@react-native-firebase/crashlytics` | |
| Network status | `@react-native-community/netinfo` | Offline pe queue |

---

## 4. CDN (Cloudflare R2) — audio aur JSON

| Cheez | Value |
|---|---|
| Account | Cloudflare (`technoplatsolution.online` wala) |
| Bucket | `pocketstory` (location APAC) — **naam purana hi rahega**: app ka naam Story Yatra hai, par bucket user ko kabhi nahi dikhta. Badalne ka matlab 6.3 GB dobara upload + naya CDN binding |
| Public base URL | `https://cdn.technoplatsolution.online/` |
| `r2.dev` URL | Band (production mein kabhi nahi) |

### 4.1 Folder structure

```
catalog.json                                     ← saari books ki list (home)
books/<slug>/book.json                           ← ek book ke saare parts
books/<slug>/book-2.json, book-3.json ...        ← 200+ parts wali book ke agle page
books/<slug>/cover.jpg                           ← 1024×1024
books/<slug>/cover-thumb.jpg                     ← ~300×300 (home list ke liye, halka)
books/<slug>/sfx/part-0001-<sha8>.mp3            ← SFX wala audio (app default)
books/<slug>/original/part-0001-<sha8>.mp3       ← bina SFX (optional, abhi upload nahi)
```

- **Slug kabhi nahi badalta.** Progress aur analytics isi pe tike hain.
- **4 digit part number** (`0001`) taaki 1000+ parts bhi order mein rahein.
- **`<sha8>`** = file ka hash. Audio dobara bana to naya naam, purana cache galat audio nahi chalayega. Isliye app ko **file ka naam khud nahi banana** — hamesha `book.json` ka `audio` path use karo.
- Har MP3: 96 kbps, mono, -16 LUFS, `Cache-Control: public, max-age=31536000, immutable`.
- Har JSON: `Cache-Control: public, max-age=300` (5 minute). Naya part upload ke 5 min mein app ko dikhega.

### 4.2 `catalog.json` (home screen) — LIVE

Abhi ka asli URL: `https://cdn.technoplatsolution.online/catalog.json` (browser mein khol ke dekh sakte ho).

```json
{
  "version": 1,
  "updated": "2026-10-17T04:58:40Z",
  "rows": [
    { "id": "originals", "title": "Story Yatra ओरिजिनल्स", "books": ["saat-pheron-ka-sauda", "rathore-ka-waaris", "ashtam-chakra", "mahadarar"] },
    { "id": "new", "title": "नई कहानियाँ", "books": ["the-count-of-monte-cristo", "..."] }
  ],
  "books": [
    {
      "id": "saat-pheron-ka-sauda",
      "title": "सात फेरों का सौदा",
      "author": "Story Yatra ओरिजिनल",
      "cover": null,
      "thumb": null,
      "genre": "romance",
      "tags": ["रोमांस", "परिवार", "रहस्य"],
      "language": "hi",
      "parts": 110,
      "totalSec": 66067,
      "status": "complete",
      "order": 1
    }
  ]
}
```

- `rows` = home ki horizontal lines (7 rows abhi: originals, new, mystery, adventure, fantasy, classics, indian). Ek book kai rows mein ho sakti hai. Books ka poora data `books` array mein ek hi baar — row ke `books` id se dhoondo.
- `cover` / `thumb` abhi `null` (covers nahi mile). **App ko null handle karna hai** (placeholder image + title). Cover aate hi path aa jaayega, app badalni nahi padegi.
- `status`: `ongoing` (naye parts aayenge: mahadarar, the-count-of-monte-cristo) | `complete`.
- `genre` values: `romance`, `drama`, `fantasy`, `scifi`, `adventure`, `mystery`, `folk`, `literature`, `horror`.
- `totalSec` = saare parts ki duration jod ke (MP3 header se exact).

### 4.3 `books/<slug>/book.json` (book screen) — LIVE

Example URL: `https://cdn.technoplatsolution.online/books/mahadarar/book.json`

```json
{
  "id": "mahadarar",
  "title": "महादरार",
  "author": "Story Yatra ओरिजिनल",
  "description": "सूरत की चॉल का अठारह साल का ईशान राणा...",
  "cover": null,
  "genre": "scifi",
  "tags": ["साइंस फ़िक्शन", "सर्वाइवल", "रहस्य"],
  "status": "ongoing",
  "totalParts": 25,
  "totalSec": 13598,
  "page": 1,
  "parts": [
    {
      "n": 1,
      "title": "रेत का आसमान",
      "durationSec": 495,
      "audio": "books/mahadarar/sfx/part-0001-5fe74240.mp3",
      "sizeBytes": 5934959
    }
  ]
}
```

- JSON mein **sirf path**, poora URL nahi. App `CDN_BASE + path` jodti hai. Domain badle to JSON nahi badalni.
- 200 parts per file. `next` ho (`"next": "books/<slug>/book-2.json"`) to scroll ke end pe agla page laao. Agle page mein sirf `{id, page, parts, next?}` hota hai. `next` na ho = aakhri page. Abhi koi book 200 se upar nahi, to `next` kahin nahi hai — par app mein handle zaroor karo.
- Part `title` script ki pehli line se aata hai. Lambe parts mein jaise `"बोहेमिया का स्कैंडल — पहला हिस्सा"`, aakhri part mein `"सात जन्म — आख़िरी भाग"`.
- Part durations: 4.5 min se 36 min tak. Ek part ka size ~6–20 MB.

### 4.4 Spam aur kharcha

Sirf `cdn.` host pe lagi settings:

| Setting | Kaam |
|---|---|
| Cache rule | Sab cache, **query string ignore** (`?x=123` se cache todne wala trick bekaar) |
| Rate limit | Ek IP se 10 sec mein 50+ request → 10 sec block |
| Bot Fight Mode | **Jaan-bujh ke band** (mobile audio player ko bot samajh ke rok deta hai) |

**Dhyaan:** rate limit 50/10s hai. App mein home pe 50+ images ek saath mat maango — `FlatList` lazy load + `thumb` use karo.

**Emergency:** R2 bucket se custom domain hata do → saare link turant band, files safe.

---

## 5. Backend

### 5.1 Stack

| Cheez | Choice | Kyun |
|---|---|---|
| Runtime | Node 20 | VPS pe yahi hai |
| Framework | Express 4 + TypeScript | VPS ke baaki apps jaisa |
| DB | PostgreSQL 14 (VPS pe pehle se) + Prisma 6 | Naya DB `storyyatra`, alag server nahi |
| Auth | Google ID token / Apple identity token verify → apna JWT (`jose`, HS256, 30 din) | Password kabhi store nahi |
| Validation | `zod` | |
| Rate limit | `express-rate-limit` | Login pe 30 / 15 min / IP |
| Process | PM2 (`ecosystem.config.cjs`, 200 MB pe restart) | |
| Proxy | nginx → `127.0.0.1:4100` | API sirf localhost pe sunti hai, bahar se seedha nahi |

### 5.2 Folder

```
src/
  server.ts            Express app: trust proxy, json limit 20kb, cors, /health, 404, error handler
  env.ts               .env ko zod se check karta hai (galat ho to start hi nahi hoga)
  lib/db.ts            Prisma client
  lib/google.ts        Google ID token verify (google-auth-library), email_verified zaroori
  lib/apple.ts         Apple identity token verify (jose + https://appleid.apple.com/auth/keys)
  lib/jwt.ts           apna JWT sign/verify (sub = user id)
  lib/requireAuth.ts   "Authorization: Bearer <jwt>" middleware → req.userId
  routes/auth.ts       /auth/google, /auth/apple, GET /me, DELETE /me
prisma/schema.prisma   DB tables
deploy/nginx.conf      nginx site (server_name badalna)
ecosystem.config.cjs   PM2 config (cwd /var/www/storyyatra-api)
.env.example           env ka template
package.json           scripts: dev, build, start, typecheck, db:migrate, db:deploy
```

npm scripts:

| Script | Kaam |
|---|---|
| `npm run dev` | Local, auto-reload (`tsx watch`) |
| `npm run build` | `prisma generate` + `tsc` → `dist/` |
| `npm start` | `node dist/server.js` (production) |
| `npm run typecheck` | Sirf type check |
| `npm run db:migrate` | Local: schema badla to naya migration banao (`prisma migrate dev`) |
| `npm run db:deploy` | VPS: migrations lagao (`prisma migrate deploy`) |

> Abhi `prisma/migrations/` folder nahi hai. Pehli baar local pe `npm run db:migrate -- --name init` chalao, banne wala `prisma/migrations/` folder git mein commit karo. VPS pe phir `db:deploy` wahi lagayega.

### 5.3 API contract — abhi bani hui

Base URL: `https://api.<domain>` (abhi tay nahi; `api.technoplatsolution.online` ya naya).
Sab request/response JSON. Error hamesha `{ "error": "<code>" }`.

#### `GET /health`
Auth nahi. DB ping.
```
200 {"ok":true}
503 {"ok":false}        ← DB band
```

#### `POST /auth/google`
Auth nahi. Rate limit: 30 / 15 min / IP.
```
Request:  {"idToken":"eyJhbGciOi..."}
200       {"token":"<jwt>","user":{"id":"uuid","email":"a@b.com","name":"Jay","photoUrl":"https://..."}}
400       {"error":"idToken_required"}
401       {"error":"invalid_google_token"}     ← galat/expire token, galat audience, email verified nahi
429       (rate limit)
```

#### `POST /auth/apple`
Auth nahi. Same rate limit.
```
Request:  {"identityToken":"eyJraWQiOi...","fullName":"Jay Shah"}    ← fullName optional (sirf pehli baar milta hai)
200       {"token":"<jwt>","user":{"id":"uuid","email":"abc@privaterelay.appleid.com","name":"Jay Shah","photoUrl":null}}
400       {"error":"identityToken_required"}
401       {"error":"invalid_apple_token"}
```

#### `GET /me`
Header `Authorization: Bearer <jwt>`.
```
200 {"user":{"id":"uuid","email":"a@b.com","name":"Jay","photoUrl":"https://...","providers":{"google":true,"apple":false}}}
401 {"error":"login_required"}     ← header nahi
401 {"error":"invalid_token"}      ← jwt galat/expire (30 din)
401 {"error":"user_not_found"}     ← account delete ho chuka
```

#### `DELETE /me`
Header `Authorization: Bearer <jwt>`. Account delete (Play Store + App Store dono ka niyam: app ke andar delete option hona chahiye).
```
204 (khaali)
```

#### Login ka logic (backend andar kya karta hai)

**Ek user, do login:** `loginWith()`:
1. Provider ki id se user dhoondo (`googleId` / `appleId`).
2. Nahi mila → **verified email** se dhoondo, mila to naya provider usi user se jod do (pehle Google, baad mein Apple = ek hi account, ek hi progress).
3. Dono nahi → naya user.

**Apple ki 3 khaas baatein:**
1. **Naam sirf pehli baar:** Apple naam sirf pehli login pe app ko deta hai, token mein nahi. App wahi `fullName` bhejti hai. Baad mein khaali aaye to backend purana naam nahi mitata.
2. **Hide my email:** `xyz@privaterelay.appleid.com` aata hai. Aise email se kisi Google account ko link nahi karte (`linkByEmail: false`).
3. **Account delete pe token revoke (agla phase):** App Store chahta hai ki Apple login wala account delete ho to Apple token bhi revoke ho. Plan: app login pe `authorizationCode` bhi bheje → backend Apple se refresh token le (client secret = `.p8` key se bana JWT) → DB mein rakhe → `DELETE /me` pe `https://appleid.apple.com/auth/revoke` call kare.

### 5.4 Database — abhi

```prisma
model User {
  id          String   @id @default(uuid())
  googleId    String?  @unique
  appleId     String?  @unique
  email       String?  @unique   // Apple relay email bhi ho sakta hai, ya kabhi nahi bhi
  name        String?
  photoUrl    String?
  createdAt   DateTime @default(now())
  lastLoginAt DateTime @default(now())
  @@map("users")
}
```

### 5.5 Agla phase — API jo likhni hai (contract pehle se tay)

RN app isi contract pe banao. Backend baad mein yahi implement karega.

#### `GET /progress` (JWT)
User ki saari books ki progress.
```
200 {"progress":[
  {"bookId":"saat-pheron-ka-sauda","part":12,"positionSec":233,"finished":false,"updatedAt":"2026-10-17T10:00:00.000Z"},
  {"bookId":"sherlock-holmes","part":36,"positionSec":0,"finished":true,"updatedAt":"2026-10-15T09:12:00.000Z"}
]}
```

#### `PUT /progress/:bookId` (JWT)
Ek book ki "abhi kahan tak suna". App bhejti hai: har 30 sec chalte waqt, pause pe, part khatam pe, app background mein jaane pe.
```
Request: {"part":12,"positionSec":233,"finished":false,"updatedAt":"2026-10-17T10:00:00.000Z"}
200      {"progress":{...jo DB mein ab hai...}}
400      {"error":"invalid_body"}
```
- `updatedAt` **phone ka time** hai jab user ne suna. Server tabhi likhega jab ye DB wale se naya ho (**naya jeetega**). Purana aaya (phone offline tha, baad mein bheja) to ignore karke DB wala lauta dega. App jawab wala data local mein rakh le.
- `bookId` = slug. `part` 1 se shuru.

#### `PUT /progress` (JWT) — batch (offline ke baad ek saath)
```
Request: {"items":[{"bookId":"...","part":3,"positionSec":10,"finished":false,"updatedAt":"..."}]}   ← max 50
200      {"progress":[...saari books ki final progress...]}
```

#### `POST /events` (login optional)
Analytics. App events jama karke 20-20 ya har 60 sec mein bhejti hai.
```
Request: {
  "deviceId":"8f1c...uuid",
  "events":[
    {"type":"play_start","bookId":"ashtam-chakra","part":3,"positionSec":0,"at":"2026-10-17T10:00:00Z"},
    {"type":"play_50","bookId":"ashtam-chakra","part":3,"positionSec":290,"at":"..."},
    {"type":"play_done","bookId":"ashtam-chakra","part":3,"positionSec":580,"at":"..."},
    {"type":"ad_shown","bookId":"ashtam-chakra","part":3,"positionSec":0,"at":"...","ad":"interstitial"}
  ]
}
202 (khaali)          ← max 50 events per request, baaki drop
```
JWT header ho to `userId` bhi jud jaata hai. Rate limit: 60 / min / IP.

#### `GET /config` (auth nahi)
Remote Config ka backup (Firebase fail ho to).
```
200 {"cdn_base":"https://cdn.technoplatsolution.online/","api_base":"https://api.<domain>/","ad_interstitial_every":3,"min_app_version":"1.0.0"}
```

#### `POST /admin/parts/sync` (header `X-Admin-Key`)
Audio laptop ka script parts table bharta hai (stats/admin ke liye; app isko kabhi call nahi karti).
```
Request: {"books":[{"slug":"...","title":"...","genre":"...","parts":[{"n":1,"title":"...","durationSec":548,"sfxKey":"books/.../part-0001-xxxx.mp3","sizeBytes":6577000}]}]}
200      {"ok":true,"books":12,"parts":612}
```

#### Agla phase ke tables

```prisma
model Book {             // catalog ka record (stats/admin ke liye)
  slug      String @id
  title     String
  genre     String
  status    String       // live | hidden
  order     Int
  parts     Part[]
}

model Part {
  bookSlug    String
  n           Int
  title       String
  durationSec Int
  sfxKey      String     // R2 key
  sizeBytes   Int
  uploadedAt  DateTime @default(now())
  book        Book @relation(fields: [bookSlug], references: [slug])
  @@id([bookSlug, n])
}

model Progress {
  userId      String
  bookSlug    String
  part        Int
  positionSec Int
  finished    Boolean  @default(false)
  updatedAt   DateTime             // phone ka time (app bhejti hai), "naya jeetega" isi pe
  user        User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([userId, bookSlug])
}

model Event {            // analytics (bada hoga: 90 din baad rollup karke purane hatao)
  id        BigInt   @id @default(autoincrement())
  userId    String?
  deviceId  String
  type      String
  bookSlug  String
  part      Int
  at        DateTime
  @@index([bookSlug, part, type])
  @@index([at])
}
```
(`User` mein `progress Progress[]` relation jodna hoga. `onDelete: Cascade` = account delete pe progress bhi hatega.)

**Redis?** Abhi nahi chahiye. Metadata CDN JSON mein hai. Baad mein zaroorat pade to sirf counters / progress buffer / rate limit ke liye.

### 5.6 Environment (`.env`, git mein kabhi nahi)

| Var | Example | Note |
|---|---|---|
| `PORT` | `4100` | |
| `NODE_ENV` | `production` | local pe `development` |
| `DATABASE_URL` | `postgresql://storyyatra:<pass>@localhost:5432/storyyatra` | |
| `GOOGLE_CLIENT_IDS` | `xxx-web.apps.googleusercontent.com,xxx-android...,xxx-ios...` | Comma se. **Web wala zaroori** |
| `APPLE_CLIENT_IDS` | `com.storyyatra.app` | iOS bundle id (+ Services ID agar Android pe Apple login) |
| `JWT_SECRET` | `openssl rand -base64 48` | Kam se kam 32 akshar. Badla to sab users logout |
| `JWT_EXPIRES_DAYS` | `30` | |
| `CORS_ORIGINS` | khaali | Mobile app ko CORS nahi chahiye. Website bane to uska origin |
| `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | — | Agla phase (token revoke) |
| `ADMIN_KEY` | `openssl rand -hex 32` | Agla phase (parts sync) |

---

## 6. React Native app ↔ Backend: kaise baat karegi

UI ready hai. Ab bas ye data layer jodna hai. Neeche har cheez ka code-sketch hai (TypeScript).

### 6.1 Config (hardcode NAHI)

| Key | Default (app mein fallback) | Kahan se |
|---|---|---|
| `cdn_base` | `https://cdn.technoplatsolution.online/` | Firebase Remote Config → fail ho to `/config` → fail ho to default |
| `api_base` | `https://api.<domain>/` | Same |
| `ad_interstitial_every` | `3` | Same |
| `min_app_version` | `1.0.0` | Same (isse chhota version = "update karo" screen) |

Kyun: domain kabhi badla to sirf remote config badlo, purane app versions bhi naye domain pe aa jaayenge.

```ts
// src/config.ts
import remoteConfig from '@react-native-firebase/remote-config';

export const config = {
  cdnBase: 'https://cdn.technoplatsolution.online/',
  apiBase: 'https://api.<domain>/',
  adInterstitialEvery: 3,
  minAppVersion: '1.0.0',
};

export async function loadConfig() {
  try {
    await remoteConfig().setDefaults({
      cdn_base: config.cdnBase, api_base: config.apiBase,
      ad_interstitial_every: config.adInterstitialEvery, min_app_version: config.minAppVersion,
    });
    await remoteConfig().fetchAndActivate();
    config.cdnBase = remoteConfig().getValue('cdn_base').asString();
    config.apiBase = remoteConfig().getValue('api_base').asString();
    config.adInterstitialEvery = remoteConfig().getValue('ad_interstitial_every').asNumber();
    config.minAppVersion = remoteConfig().getValue('min_app_version').asString();
  } catch { /* default hi chalega */ }
}

export const cdn = (path: string) => config.cdnBase + path;   // path JSON se aata hai
```

### 6.2 CDN se data (login nahi chahiye)

```ts
// src/content.ts
import { useQuery } from '@tanstack/react-query';
import { cdn } from './config';

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(cdn(path));
  if (!r.ok) throw new Error(`cdn ${r.status}`);
  return r.json();
}

export const useCatalog = () =>
  useQuery({ queryKey: ['catalog'], queryFn: () => getJson<Catalog>('catalog.json'), staleTime: 5 * 60_000 });

export const useBook = (slug: string) =>
  useQuery({ queryKey: ['book', slug], queryFn: () => getJson<Book>(`books/${slug}/book.json`), staleTime: 5 * 60_000 });
```
- Pichhla `catalog.json` MMKV mein rakho (react-query persist ya khud). App khule to purana turant dikhao, peeche se naya laao.
- `next` field ho to `useInfiniteQuery` se agle pages.

Types (JSON jaisa):
```ts
type CatalogBook = { id: string; title: string; author: string; cover: string | null; thumb: string | null; genre: string; tags: string[]; language: string; parts: number; totalSec: number; status: 'ongoing' | 'complete'; order: number };
type Catalog = { version: number; updated: string; rows: { id: string; title: string; books: string[] }[]; books: CatalogBook[] };
type Part = { n: number; title: string; durationSec: number; audio: string; sizeBytes: number };
type Book = { id: string; title: string; author: string; description: string; cover: string | null; genre: string; tags: string[]; status: 'ongoing' | 'complete'; totalParts: number; totalSec: number; page: number; parts: Part[]; next?: string };
type BookPage = { id: string; page: number; parts: Part[]; next?: string };   // book-2.json, book-3.json ...
// cover null ho to placeholder: book.cover ? { uri: cdn(book.cover) } : require('./assets/cover-placeholder.png')
```

### 6.3 API client (ek hi jagah se saari backend calls)

```ts
// src/api.ts
import * as Keychain from 'react-native-keychain';
import { config } from './config';

let token: string | null = null;
let onLoggedOut: () => void = () => {};
export const setOnLoggedOut = (fn: () => void) => (onLoggedOut = fn);

export async function loadToken() {
  const c = await Keychain.getGenericPassword({ service: 'storyyatra.jwt' });
  token = c ? c.password : null;
  return token;
}
export async function saveToken(t: string) {
  token = t;
  await Keychain.setGenericPassword('jwt', t, { service: 'storyyatra.jwt' });
}
export async function clearToken() {
  token = null;
  await Keychain.resetGenericPassword({ service: 'storyyatra.jwt' });
}
export const isLoggedIn = () => !!token;

export async function api<T>(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(config.apiBase + path.replace(/^\//, ''), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401 && opts.auth !== false) {   // jwt expire / user delete
    await clearToken();
    onLoggedOut();                                  // UI: "dobara login karo"
  }
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data.error ?? 'unknown');
  return data as T;
}
export class ApiError extends Error { constructor(public status: number, public code: string) { super(code); } }
```

### 6.4 Login — Google

```ts
import { GoogleSignin } from '@react-native-google-signin/google-signin';

GoogleSignin.configure({
  webClientId: '<WEB client ID>',      // yahi idToken ka audience banega — backend GOOGLE_CLIENT_IDS mein hona zaroori
  iosClientId: '<iOS client ID>',
});

export async function loginGoogle() {
  await GoogleSignin.hasPlayServices();
  const res: any = await GoogleSignin.signIn();
  const idToken = res?.data?.idToken ?? res?.idToken;   // naye version mein res.data.idToken, purane mein res.idToken
  if (!idToken) throw new Error('cancelled');
  const { token, user } = await api<{ token: string; user: User }>('auth/google', { method: 'POST', body: { idToken }, auth: false });
  await saveToken(token);
  await afterLogin();
  return user;
}
```

### 6.5 Login — Apple (iOS)

```ts
import { appleAuth } from '@invertase/react-native-apple-authentication';

export async function loginApple() {
  const r = await appleAuth.performRequest({
    requestedOperation: appleAuth.Operation.LOGIN,
    requestedScopes: [appleAuth.Scope.EMAIL, appleAuth.Scope.FULL_NAME],
  });
  if (!r.identityToken) throw new Error('cancelled');
  const fullName = [r.fullName?.givenName, r.fullName?.familyName].filter(Boolean).join(' ') || undefined; // sirf pehli baar milta hai
  const { token, user } = await api<{ token: string; user: User }>('auth/apple', {
    method: 'POST', body: { identityToken: r.identityToken, fullName }, auth: false,
  });
  await saveToken(token);
  await afterLogin();
  return user;
}
```
- iOS pe login screen pe **dono button barabar size**, Apple ka official button style (`AppleButton`).
- `r.authorizationCode` agle phase mein body mein bhejna (token revoke ke liye) — backend tayyar hone pe.

### 6.6 Login ke baad / logout / delete

```ts
type User = { id: string; email: string | null; name: string | null; photoUrl: string | null };

export async function afterLogin() {
  const { progress } = await api<{ progress: ServerProgress[] }>('progress');   // agla phase
  mergeProgress(progress);          // section 6.7 — naya updatedAt jeetega
  await pushAllLocalProgress();     // local jo naya hai wo server pe
}

export const getMe = () => api<{ user: User & { providers: { google: boolean; apple: boolean } } }>('me');

export async function logout() {
  await GoogleSignin.signOut().catch(() => {});
  await clearToken();
  // local progress rehne do (bina login bhi chalti hai)
}

export async function deleteAccount() {           // Profile → "Account delete karo" (confirm dialog ke saath)
  await api('me', { method: 'DELETE' });
  await logout();
}
```

App start pe:
```ts
await loadConfig();
await loadToken();
if (isLoggedIn()) getMe().catch(() => {});   // 401 aaya to api() khud logout kar dega
```

### 6.7 Progress (local pehle, server baad mein)

**Local hamesha source** — bina login bhi "continue listening" chale.

```ts
// MMKV key: "progress" → { [bookId]: {part, positionSec, finished, updatedAt} }
type P = { part: number; positionSec: number; finished: boolean; updatedAt: string };

export function saveLocal(bookId: string, p: Omit<P, 'updatedAt'>) {
  const all = readAll();
  all[bookId] = { ...p, updatedAt: new Date().toISOString() };
  writeAll(all);
  markDirty(bookId);                      // "server pe bhejna baaki" list
}

export function mergeProgress(server: (P & { bookId: string })[]) {
  const all = readAll();
  for (const s of server) {
    const l = all[s.bookId];
    if (!l || s.updatedAt > l.updatedAt) all[s.bookId] = s;   // ISO string compare chalta hai
  }
  writeAll(all);
}

export async function syncDirty() {       // har 30 sec (chalte waqt), pause, part end, app background
  if (!isLoggedIn()) return;
  const items = dirtyIds().map(id => ({ bookId: id, ...readAll()[id] }));
  if (!items.length) return;
  try {
    const { progress } = await api<{ progress: any[] }>('progress', { method: 'PUT', body: { items: items.slice(0, 50) } });
    mergeProgress(progress);
    clearDirty(items.map(i => i.bookId));
  } catch { /* offline — agli baar */ }
}
```
- Local save: har **10 sec** (track player progress event).
- Server sync: har **30 sec** + pause + part khatam + `AppState` → `background`.
- Internet wapas aaya (`NetInfo`) → `syncDirty()`.

### 6.8 Player (react-native-track-player)

```ts
import TrackPlayer, { Event, Capability } from 'react-native-track-player';

await TrackPlayer.setupPlayer();
await TrackPlayer.updateOptions({
  capabilities: [Capability.Play, Capability.Pause, Capability.SeekTo, Capability.JumpForward, Capability.JumpBackward, Capability.SkipToNext],
  forwardJumpInterval: 10, backwardJumpInterval: 10,
  progressUpdateEventInterval: 10,                  // har 10 sec event → local progress save
});

export async function playPart(book: Book, part: Part, startAt = 0) {
  const local = downloadedPath(book.id, part.n);    // section 6.10
  await TrackPlayer.reset();
  await TrackPlayer.add({
    id: `${book.id}:${part.n}`,
    url: local ? `file://${local}` : cdn(part.audio),
    title: part.title,
    artist: book.title,
    artwork: cdn(book.cover),
    duration: part.durationSec,
  });
  if (startAt) await TrackPlayer.seekTo(startAt);
  await TrackPlayer.play();
  track('play_start', book.id, part.n, startAt);
}
```
- Stream: R2 range request support karta hai → 1-2 sec mein shuru, seek turant.
- Controls: play/pause, ±10 sec, speed 0.75–1.5×, part khatam → (ad) → agla part auto, sleep timer.
- `PlaybackService` (background) mein `Event.PlaybackProgressUpdated` → `saveLocal()`, 50% pe `play_50`, end pe `play_done` + `finished` agar aakhri part.
- iOS: Xcode → Background Modes → **Audio** ON. Android: track-player khud foreground service chalata hai.
- Ek hi part ek baar mein queue mein (simple). Agla part `PlaybackQueueEnded` pe khud add karo (beech mein ad dikhana hai isliye).

### 6.9 Analytics (events)

```ts
// deviceId: pehli baar uuid banao, MMKV mein hamesha ke liye
const queue: any[] = [];
export function track(type: string, bookId: string, part: number, positionSec: number, extra = {}) {
  queue.push({ type, bookId, part, positionSec, at: new Date().toISOString(), ...extra });
  if (queue.length >= 20) flush();
}
export async function flush() {                        // har 60 sec + app background
  if (!queue.length) return;
  const events = queue.splice(0, 50);
  try { await api('events', { method: 'POST', body: { deviceId: getDeviceId(), events }, auth: false }); }
  catch { queue.unshift(...events); }                   // fail → wapas queue (max 500 rakho, purane drop)
}
```

### 6.10 Offline download

```ts
import ReactNativeBlobUtil from 'react-native-blob-util';
const dir = ReactNativeBlobUtil.fs.dirs.DocumentDir + '/audio';

export async function download(book: Book, part: Part) {
  const path = `${dir}/${book.id}/part-${part.n}.mp3`;
  // disk space check: part.sizeBytes
  await ReactNativeBlobUtil.config({ path }).fetch('GET', cdn(part.audio));
  setDownloaded(book.id, part.n, path, part.audio);    // MMKV list (audio path bhi rakho — sha badle to "update" dikha sakte ho)
}
```
- File app ke private folder mein. Downloads screen pe list + delete.
- `book.json` mein `audio` path badal gaya (naya sha) to purana download bhi chalega, chaaho to "naya version" dikhao.

### 6.11 Ads (AdMob)

| Ad | Kahan | Rule |
|---|---|---|
| Banner | Home aur Book screen ke neeche | Player screen pe nahi |
| Interstitial | Part khatam → ad → agla part | Har `ad_interstitial_every` (default 3) part pe ek. Pehla part bina ad |
| Rewarded (optional) | "Ad dekho → 5 part download unlock" | |
| Kabhi nahi | Part ke **beech** mein | |

- Development mein **test ad IDs** (`TestIds.BANNER` etc.). Release se pehle asli IDs (Remote Config se dena better).
- iOS: ATT (App Tracking Transparency) prompt + `NSUserTrackingUsageDescription`. EU users ke liye UMP consent (library mein hai).
- Interstitial show hone pe `track('ad_shown', ..., {ad:'interstitial'})`.

### 6.12 Screens aur unka data

| Screen | Data | Kya dikhana |
|---|---|---|
| Splash | `loadConfig()`, `loadToken()` | `min_app_version` se chhota → "Update karo" |
| Home | `catalog.json` + local progress | Rows (`rows`), "Continue listening" (local progress, `updatedAt` desc), `thumb` images |
| Book | `book.json` + local progress | Cover, description, parts list, har part pe ✓ (suna) / % / download icon |
| Player | Track player | Upar wale controls, next part, speed, sleep timer |
| Downloads | MMKV list | Offline parts, size, delete |
| Profile / Login | `GET /me` | Google + Apple button, naam/photo, logout, **account delete**, privacy policy link |

### 6.13 Store ke liye zaroori cheezein

- **Privacy policy URL** (Play + App Store + Google OAuth consent screen teeno maangte hain). Ek simple page bana do (kaun sa data: email, naam, listening progress, ads ID).
- **Account delete** app ke andar (✅ `DELETE /me` bana hai) + Play Console ke liye ek web URL bhi chahiye jahan delete request ho sake.
- Play "Data safety" form aur App Store "Privacy nutrition label" bharna.
- iOS: Sign in with Apple (✅ backend ready), ATT prompt (ads).

---

## 7. Naye laptop pe backend setup (local)

### 7.1 Folder le jaana

Ye folder abhi **git repo nahi hai**. Sabse safe tareeka:
```bash
cd PocketStoryBE
git init && git add . && git commit -m "Story Yatra backend"
# GitHub pe PRIVATE repo banao, phir:
git remote add origin git@github.com:<user>/storyyatra-api.git
git push -u origin main
```
`.gitignore` mein `node_modules`, `dist`, `.env` hone chahiye (check karo). Naye laptop pe `git clone`. VPS pe bhi isi repo se deploy hoga.

### 7.2 Chalana

```bash
# 1. Node 20
nvm install 20 && nvm use 20

# 2. Local Postgres (koi ek)
brew install postgresql@16 && brew services start postgresql@16
createuser storyyatra -P          # password do
createdb storyyatra -O storyyatra
# ya Docker:
# docker run -d --name pg -e POSTGRES_USER=storyyatra -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=storyyatra -p 5432:5432 postgres:16

# 3. Code
npm install
cp .env.example .env               # DATABASE_URL, GOOGLE_CLIENT_IDS, APPLE_CLIENT_IDS, JWT_SECRET bharo
npm run db:migrate -- --name init  # pehli baar: tables + prisma/migrations/ banega (commit karo)
npm run dev                        # http://127.0.0.1:4100
curl http://127.0.0.1:4100/health  # {"ok":true}
```

### 7.3 Phone/emulator se local backend

Server `127.0.0.1` pe sunta hai (production ke liye sahi). Local test ke liye:
- **Android emulator:** `api_base = http://10.0.2.2:4100/` (emulator ka 10.0.2.2 = laptop ka localhost, isliye 127.0.0.1 wala server chal jaata hai).
- **Asli phone / iOS device:** `src/server.ts` mein host temporary `0.0.0.0` karo ya `ngrok http 4100` / `cloudflared tunnel --url http://localhost:4100` use karo (HTTPS bhi milega — iOS ko HTTPS chahiye).
- Android pe `http://` ke liye debug build mein cleartext allow karna padta hai.

---

## 8. VPS pe deploy

VPS pe pehle se: Node 20, PM2 (4 apps), nginx, PostgreSQL 14. Free RAM ~1.3 GB, ye API ~80-100 MB legi.

### 8.1 Pehle security (zaroori, pending)

```bash
passwd                                        # root password badlo (purana chat mein share hua tha)
# laptop se: ssh-copy-id root@<vps-ip>         # SSH key lagao
# /etc/ssh/sshd_config: PasswordAuthentication no, PermitRootLogin prohibit-password
systemctl restart ssh
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
# Postgres sirf localhost: postgresql.conf → listen_addresses = 'localhost'
```

### 8.2 DB

```bash
sudo -u postgres psql -c "CREATE USER storyyatra WITH PASSWORD '<strong>';"
sudo -u postgres psql -c "CREATE DATABASE storyyatra OWNER storyyatra;"
```

### 8.3 Code + PM2

```bash
cd /var/www && git clone <private-repo> storyyatra-api && cd storyyatra-api
cp .env.example .env && nano .env      # production values
npm ci && npm run build && npm run db:deploy
pm2 start ecosystem.config.cjs && pm2 save
pm2 logs storyyatra-api               # check
curl http://127.0.0.1:4100/health
```

### 8.4 nginx + DNS + SSL

```bash
cp deploy/nginx.conf /etc/nginx/sites-available/storyyatra-api   # server_name api.<domain> karo
ln -s /etc/nginx/sites-available/storyyatra-api /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```
- Cloudflare DNS: `api.<domain>` → A record VPS IP, **proxy ON** (orange).
- SSL: Cloudflare "Full (strict)" + VPS pe Cloudflare Origin Certificate (nginx mein `listen 443 ssl` + cert path). Abhi `deploy/nginx.conf` sirf port 80 ka hai — 443 block add karna hai.
- Cloudflare ke peeche asli user IP: `trust proxy` set hai. Rate limit sahi chale iske liye nginx mein `CF-Connecting-IP` ko `X-Forwarded-For` bana do (ya `set_real_ip_from` Cloudflare ranges + `real_ip_header CF-Connecting-IP`).

### 8.5 Update (naya code)

```bash
cd /var/www/storyyatra-api && git pull && npm ci && npm run build && npm run db:deploy && pm2 restart storyyatra-api
```

### 8.6 Backup

Roz raat cron: `pg_dump storyyatra | gzip` → R2 ke **alag private bucket** mein (audio wale public bucket mein kabhi nahi). 14 din rakho. Iske liye us private bucket ka alag token (sirf usi bucket, write).

---

## 9. Content pipeline (audio laptop)

Ye dev laptop pe nahi chalta. Sirf jaankari ke liye:

```
part-NN.md (script)
  → story_tts.py               → audio/<Book>/part-NN.wav            (Qwen3 TTS)
  → part-NN.sfx + story_sfx.py → audio/<Book>/part-NN_sfx_mix.mp3    (heavy SFX)
  → MP3 convert (96k mono -16 LUFS) → audio-final/<Book>/sfx/part-NN.mp3
  → tools_r2_upload.py         → R2 + r2_manifest.json  (har file ke baad manifest update)
  → tools_build_catalog.py ~/.r2cred.json --upload → catalog.json + book.json (+ covers agar hain) → R2
  → (TODO, optional) POST /admin/parts/sync → Postgres parts table
```

`r2_manifest.json` ka format (ek entry):
```json
"Dr Jekyll and Mr Hyde/sfx/part-01.mp3": {
  "book": "dr-jekyll-and-mr-hyde", "part": 1,
  "key": "books/dr-jekyll-and-mr-hyde/sfx/part-0001-f3db6b6f.mp3",
  "sha": "<sha256>", "size": 12769533
}
```

**`tools_build_catalog.py` (✅ bana, 2026-10-17 chala, live):**
1. `r2_manifest.json` se har part ka R2 key + size.
2. Part ka title script ki pehli line se (`[m1n] <series>। भाग <n>। <title>।`).
3. Duration: R2 se har MP3 ke pehle 64 KB (header) padh ke exact nikalta hai. Cache `catalog_durations.json` mein — agli baar sirf naye parts padhta hai.
4. Book ka title/author/description/genre/tags/status/order aur home ki rows: `books_meta.json` (haath se likhi, audio laptop pe). **Nayi book aaye to pehle isme entry daalo**, warna script ruk jaayegi.
5. Cover: `PsdCastStory/covers/<slug>.jpg` (ya `.png`) pada ho to `cover.jpg` (1024) + `cover-thumb.jpg` (300) bana ke upload. Na ho to JSON mein `null`.
6. Parts mein gap ho (jaise 1-25 aur 27) to script ruk jaati hai.
7. Upload order: pehle saari `book.json`, `catalog.json` sabse aakhir (app ko kabhi adhoori list na mile). JSON pe `max-age=300`, cover pe `max-age=86400`.

**Naya part upload karne ka poora kram (audio laptop):**
```bash
python3 tools_r2_upload.py ~/.r2cred.json            # MP3 → R2, manifest update
python3 tools_build_catalog.py ~/.r2cred.json --upload   # JSON update → 5 min mein app mein dikhega
```

---

## 10. Scale, kharcha, domain badalna

| Cheez | Abhi (612 parts) | 5000+ parts |
|---|---|---|
| R2 storage | ~6.3 GB (~$0.1/mahina) | ~50 GB (~$0.75/mahina) |
| Bandwidth | Free | Free |
| R2 reads | 10 lakh = $0.36 (cache wali request R2 tak jaati hi nahi) | Wahi |
| `catalog.json` | Chhoti | Books hi hain, chhoti rahegi |
| `book.json` | 1 file per book | 200 parts per file (pages) |
| Backend | Audio se koi lena-dena nahi | Sirf users × progress rows |
| Postgres events | Chhota | Mahine ka rollup table, raw 90 din |

**Domain badalna (10-15 min):**
1. Naya domain Cloudflare pe add karo.
2. Usi bucket `pocketstory` pe naya custom domain jodo (ek bucket pe kai domain chalte hain, files dobara upload nahi).
3. Cache rule + rate limit naye host pe bhi.
4. Remote config mein `cdn_base` badlo.
5. Purana domain kuch hafte saath chalne do, phir hatao.

---

## 11. Testing checklist

**Backend (curl):**
```bash
curl https://api.<domain>/health                                       # {"ok":true}
curl -X POST https://api.<domain>/auth/google -H 'Content-Type: application/json' -d '{"idToken":"<app se log kiya token>"}'
curl https://api.<domain>/me -H 'Authorization: Bearer <jwt>'
curl -X DELETE https://api.<domain>/me -H 'Authorization: Bearer <jwt>'   # 204
curl https://api.<domain>/me -H 'Authorization: Bearer <same jwt>'        # 401 user_not_found
```
(Test idToken ke liye app mein login karke `console.log(idToken)` karo. Wo ~1 ghante chalta hai.)

**App:**
- [ ] Bina login: home → book → part chala → lock screen controls dikhe → app band karke khola → "continue listening" sahi jagah
- [ ] Seek, speed, next part auto, sleep timer
- [ ] Google login (debug build **aur** release build — SHA-1 alag hote hain)
- [ ] Apple login (asli iPhone pe; pehli baar naam aaya, doosri baar naam nahi mita)
- [ ] Google se login → logout → Apple se same email → ek hi account (`providers` dono true)
- [ ] Phone A pe suna → Phone B pe login → wahi jagah
- [ ] Airplane mode: downloaded part chale, progress local save, internet aane pe sync
- [ ] Token expire / account delete → app khud logout
- [ ] Ad: test IDs, interstitial har 3 part, part ke beech kabhi nahi
- [ ] CDN rate limit: home tez scroll pe images block na hon

---

## 12. Kya kya baaki hai (order mein)

1. [ ] **VPS security**: root password badlo, SSH key, password login band, ufw (section 8.1)
2. [ ] Ye folder git mein + private GitHub repo (section 7.1)
3. [x] ~~`tools_build_catalog.py` + catalog R2 pe~~ (2026-10-17 done)
3b. [ ] **Covers**: 12 images banao/dhoondho → `PsdCastStory/covers/<slug>.jpg` → `tools_build_catalog.py --upload`. Tab tak app placeholder dikhaye
4. [ ] RN: config + CDN data layer jodo (section 6.1-6.2) → Home → Book → Player (stream) chalao
5. [ ] Google Cloud: OAuth consent screen + Web/Android/iOS client IDs (section 3.2)
6. [ ] Apple Developer: App ID pe Sign in with Apple ON, `.p8` key
7. [ ] Firebase project: Remote Config, Crashlytics, `google-services.json`
8. [ ] API domain tay karo (`api.technoplatsolution.online` ya naya)
9. [ ] Backend local pe chalao + pehla migration (section 7.2) → deploy (section 8) → `/health` + login test
10. [ ] RN: login (6.3-6.6)
11. [ ] Backend: progress + events + config API likho (section 5.5 contract) → RN: progress sync (6.7) + events (6.9)
12. [ ] RN: offline download (6.10)
13. [ ] AdMob account + ad units → RN ads (6.11)
14. [ ] Privacy policy page + account delete web URL + store forms (6.13)
15. [ ] Apple token revoke on delete (5.3)
16. [ ] DB backup cron (8.6)
17. [ ] Naye parts aate rahenge (audio laptop): TTS → SFX → MP3 → upload → catalog
