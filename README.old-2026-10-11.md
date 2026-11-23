# PocketStory — App Architecture aur Backend

PocketStory ek Hindi audio-story app hai. Saari kahaniyan free hain, kamaai ads se hogi.
Ye file poore system ka plan hai: app (React Native), backend (is repo mein), audio storage (Cloudflare R2), aur content pipeline.

Status (2026-10-11):

| Hissa | Status |
|---|---|
| Audio storage (R2 + CDN) | ✅ Live. 11 books, 278 SFX parts, 2.75 GB |
| CDN settings (cache, rate limit) | ✅ Live |
| Backend: Google + Apple login | ✅ Code likha, ❌ abhi deploy nahi, ❌ abhi test nahi (laptop pe Node nahi hai) |
| Backend: progress, analytics, parts table | ⏳ Plan (neeche) |
| `catalog.json` / `book.json` generator | ⏳ Plan |
| Covers (11) | ✅ Bane hue: `~/Desktop/Qwen/covers/final/` (1024×1024 JPEG). R2 pe upload baaki |
| React Native app | 🚧 Ban rahi hai |

---

## 1. Ek nazar mein

```
                    ┌──────────────────────────────┐
                    │   React Native App (Android/iOS) │
                    └──────┬───────────────┬───────────┘
          audio, covers,   │               │  login, progress, analytics
          catalog JSON     │               │
                           ▼               ▼
        ┌──────────────────────────┐   ┌────────────────────────────────┐
        │ cdn.technoplatsolution.  │   │ api.<domain>  (Cloudflare proxy)│
        │ online  (Cloudflare CDN) │   │        ↓                        │
        │        ↓                 │   │ VPS: nginx → Node API (PM2)     │
        │ R2 bucket "pocketstory"  │   │      → PostgreSQL 14            │
        └──────────────────────────┘   └────────────────────────────────┘
                           ▲
                           │ upload script (laptop)
              ┌────────────┴─────────────┐
              │ PsdCastStory (content)   │
              │ script → TTS → SFX → MP3 │
              └──────────────────────────┘
```

**Sabse zaroori niyam:**
- **Audio kabhi backend se nahi jaata.** App seedha CDN se stream karti hai. Backend sirf chhote JSON calls sambhalta hai (login, progress, events). Isse VPS pe load nahi padta, aur bandwidth ka paisa zero.
- **Content static hai.** Story list aur part list JSON files hain jo R2 pe padi hain. Naya part daalna = file upload + JSON update. App update ki zaroorat nahi.
- **Login optional hai.** Bina login ke bhi sab sun sakte hain. Login sirf progress sync ke liye.
- **Login do tarah ka: Google aur Apple.** Android pe Google (Apple optional). iPhone pe dono. App Store ka niyam (guideline 4.8): agar Google login hai, to "Sign in with Apple" bhi dena zaroori hai, warna app reject.

---

## 2. Audio storage: Cloudflare R2

| Cheez | Value |
|---|---|
| Account | Cloudflare (`technoplatsolution.online` wala) |
| Bucket | `pocketstory` (location APAC) |
| Public URL | `https://cdn.technoplatsolution.online/` |
| `r2.dev` URL | Band (production mein kabhi nahi) |

### 2.1 Folder structure

```
catalog.json                                   ← saari books ki list
books/<book-slug>/book.json                    ← ek book ke saare parts
books/<book-slug>/cover.jpg
books/<book-slug>/sfx/part-0001-<sha8>.mp3     ← SFX wala audio (app default)
books/<book-slug>/original/part-0001-<sha8>.mp3 ← bina SFX (optional, abhi upload nahi)
```

- **Slug** kabhi nahi badalta (progress aur analytics isi pe tike hain). Example: `saat-pheron-ka-sauda`, `sherlock-holmes`.
- **4 digit part number** (`0001`), taaki 1000+ parts ki series bhi sahi order mein rahe.
- **`<sha8>`** = file ka chhota hash. Audio dobara bana to naya naam banega, purana cache kabhi galat audio nahi chalayega.
- Har MP3: 96 kbps, mono, -16 LUFS, `Cache-Control: public, max-age=31536000, immutable`.

Abhi upload hui books (sfx): ashtam-chakra 50, sherlock-holmes 36, around-the-world-in-eighty-days 26, mahadarar 25, rathore-ka-waaris 25, saat-pheron-ka-sauda 25, twenty-two-goblins 24, the-great-gatsby 20, the-hungry-stones 20, the-jungle-book 18, dr-jekyll-and-mr-hyde 9.

### 2.2 JSON format

`catalog.json` (cache 5 minute):
```json
{
  "version": 1,
  "updated": "2026-10-11T18:00:00Z",
  "books": [
    {
      "id": "saat-pheron-ka-sauda",
      "title": "सात फेरों का सौदा",
      "cover": "books/saat-pheron-ka-sauda/cover.jpg",
      "genre": "romance",
      "language": "hi",
      "parts": 25,
      "totalSec": 13140,
      "status": "ongoing",
      "order": 1
    }
  ]
}
```

`books/<slug>/book.json` (cache 5 minute):
```json
{
  "id": "saat-pheron-ka-sauda",
  "title": "सात फेरों का सौदा",
  "description": "गाँव की अनाया, एक साल की कॉन्ट्रैक्ट शादी...",
  "cover": "books/saat-pheron-ka-sauda/cover.jpg",
  "parts": [
    {
      "n": 1,
      "title": "कर्ज़",
      "durationSec": 548,
      "audio": "books/saat-pheron-ka-sauda/sfx/part-0001-f3db6b6f.mp3",
      "sizeBytes": 6577000
    }
  ]
}
```

- JSON mein **sirf path**, poora URL nahi. App `CDN_BASE + path` jodti hai. Domain badle to JSON nahi badalni padti.
- 1000+ parts wali series: `book.json` mein pehle 200, aur `book-2.json`, `book-3.json` ... (field `"next": "books/<slug>/book-2.json"`).

### 2.3 Spam aur kharcha

Cloudflare pe ye settings lagi hain (sirf `cdn.` host pe, baaki domain pe asar nahi):

| Setting | Kaam |
|---|---|
| Cache rule | Sab cache, **query string ignore** (`?x=123` wala trick bekaar) |
| Rate limit | Ek IP se 10 second mein 50+ request → 10 second block |
| Bot Fight Mode | **Band rakha hai** (mobile audio player ko bot samajh ke rok deta hai) |

Kharcha: storage ~$0.015/GB/mahina (account pe pehle se ~21 GB doosre apps ka hai), download/bandwidth **free**, reads 10 lakh = $0.36 (aur cache wali request R2 tak jaati hi nahi). 5000+ parts (~40 GB) pe bhi ~$1/mahina.

**Emergency:** R2 bucket se custom domain hata do → saare link turant band, files safe.

---

## 3. Content pipeline (laptop: `~/Desktop/PsdCastStory`)

```
part-NN.md (script)
  → story_tts.py              → audio/<Book>/part-NN.wav        (Qwen3 TTS)
  → part-NN.sfx + story_sfx.py → audio/<Book>/part-NN_sfx_mix.mp3 (heavy SFX)
  → MP3 convert (96k mono -16 LUFS) → audio-final/<Book>/sfx/part-NN.mp3
  → tools_r2_upload.py        → R2 + r2_manifest.json
  → (todo) tools_build_catalog.py → catalog.json + book.json → R2
  → (todo) POST /admin/parts sync → Postgres "parts" table
```

- `r2_manifest.json` = laptop pe register: kaun si local file R2 mein kis key se gayi (key, sha, size). **Haath se edit mat karo, delete mat karo.** Upload script isi se skip karta hai aur `book.json` isi se banegi.
- Upload ke liye R2 API token chahiye (sirf `pocketstory` bucket, Object Read & Write). Token **kabhi git mein nahi**.

**Todo script `tools_build_catalog.py`:**
1. `r2_manifest.json` padho (har part ka R2 key).
2. Part ka title script ki pehli line se (`[m1n] <series>। भाग <n>। <title>।`).
3. Duration `audio/<Book>/part-NN.timeline.json` se.
4. `catalog.json` + har `book.json` banao, R2 pe upload (cache 5 min).

---

## 4. Backend (ye repo)

### 4.1 Stack

| Cheez | Choice | Kyun |
|---|---|---|
| Runtime | Node 20 (VPS pe yahi hai) | |
| Framework | Express 4 + TypeScript | VPS ke baaki 4 apps jaisa |
| DB | PostgreSQL 14 (VPS pe pehle se) + Prisma | Naya DB `pocketstory`, alag server nahi |
| Auth | Google ID token ya Apple identity token → apna JWT (`jose`, HS256, 30 din) | Password kabhi store nahi |
| Validation | `zod` | |
| Process | PM2 (`ecosystem.config.cjs`, max 200 MB) | |
| Proxy | nginx → `127.0.0.1:4100` | API sirf localhost pe sunti hai |

### 4.2 Folder

```
src/
  server.ts            app, cors, json limit 20kb, /health, error handler
  env.ts               .env ko zod se check karta hai
  lib/db.ts            Prisma client
  lib/google.ts        Google ID token verify (google-auth-library)
  lib/apple.ts         Apple identity token verify (jose + Apple ki public keys)
  lib/jwt.ts           apna JWT sign/verify
  lib/requireAuth.ts   "Authorization: Bearer <jwt>" middleware
  routes/auth.ts       /auth/google, /auth/apple, /me
prisma/schema.prisma
deploy/nginx.conf
ecosystem.config.cjs
.env.example
```

### 4.3 API (abhi bani hui)

| Method | Path | Auth | Kaam |
|---|---|---|---|
| GET | `/health` | — | DB ping. `{ok:true}` |
| POST | `/auth/google` | — | Body `{idToken}`. Google se verify, user banao/update karo. Jawab `{token, user}`. Rate limit: 15 min mein 30/IP |
| POST | `/auth/apple` | — | Body `{identityToken, fullName?}`. Apple ki public keys se verify (issuer `https://appleid.apple.com`, audience = `APPLE_CLIENT_IDS`). Jawab `{token, user}`. Wahi rate limit |
| GET | `/me` | JWT | `{user:{id,email,name,photoUrl,providers:{google,apple}}}` |
| DELETE | `/me` | JWT | Account delete (Play Store ka niyam) |

Error format hamesha: `{ "error": "<code>" }` jaise `login_required`, `invalid_token`, `invalid_google_token`, `invalid_apple_token`, `idToken_required`, `identityToken_required`.

**Ek user, do login:** `loginWith()` pehle provider ki id se user dhoondta hai (`googleId` / `appleId`). Nahi mila to **verified email** se dhoondta hai aur naya provider usi user se jod deta hai (Google se pehle aaya, baad mein Apple se, to ek hi account, ek hi progress). Naya user tab banta hai jab dono na milein.

**Apple ki 3 khaas baatein:**
1. **Naam sirf pehli baar:** Apple user ka naam sirf pehli login pe app ko deta hai, token mein nahi. App wahi `fullName` bhejti hai. Baad ki logins mein naam khaali aata hai, backend purana naam nahi mitata.
2. **Hide my email:** user email chhupa sakta hai, tab `xyz@privaterelay.appleid.com` aata hai. Aise email se kisi Google account ko link nahi karte (`linkByEmail: false`).
3. **Account delete pe token revoke (agla phase):** App Store niyam hai ki Apple login wale account ko delete karte waqt Apple ka token bhi revoke ho. Iske liye app login ke waqt `authorizationCode` bhejegi, backend Apple se refresh token lega (client secret = Apple ki `.p8` key se bana JWT), aur `DELETE /me` pe `https://appleid.apple.com/auth/revoke` call karega.

Example:
```
POST /auth/google
{"idToken":"eyJhbGciOi..."}
→ 200 {"token":"<jwt>","user":{"id":"uuid","email":"a@b.com","name":"Jay","photoUrl":"https://..."}}

POST /auth/apple
{"identityToken":"eyJraWQiOi...","fullName":"Jay Shah"}
→ 200 {"token":"<jwt>","user":{"id":"uuid","email":"abc@privaterelay.appleid.com","name":"Jay Shah","photoUrl":null}}
```

### 4.4 API (agla phase)

| Method | Path | Auth | Kaam |
|---|---|---|---|
| GET | `/progress` | JWT | User ki saari books ki progress |
| PUT | `/progress/:bookId` | JWT | `{part, positionSec, finished}` — app har 30 sec / pause / band hone pe bhejti hai |
| POST | `/events` | optional | Analytics batch: `[{type, bookId, part, positionSec, at}]`. Type: `play_start`, `play_50`, `play_done`, `ad_shown`. Bina login ke `deviceId` ke saath |
| GET | `/config` | — | Remote config ka backup (CDN base URL, ad frequency, min app version) |
| POST | `/admin/parts/sync` | admin key | Upload script parts table bharta hai |

Progress conflict: jo `updatedAt` naya ho wahi jeetega (phone offline tha to bhi).

### 4.5 Database (Prisma)

Abhi:
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
}
```

Agla phase:
```prisma
model Book {           // catalog ka record (JSON isi se banegi)
  slug      String @id
  title     String
  genre     String
  status    String   // live | hidden
  order     Int
}

model Part {
  bookSlug    String
  n           Int
  title       String
  durationSec Int
  sfxKey      String   // R2 key
  sizeBytes   Int
  uploadedAt  DateTime @default(now())
  @@id([bookSlug, n])
}

model Progress {
  userId      String
  bookSlug    String
  part        Int
  positionSec Int
  finished    Boolean  @default(false)
  updatedAt   DateTime @updatedAt
  @@id([userId, bookSlug])
}

model Event {         // analytics (bada hoga, 90 din baad purane rollup karke hatao)
  id        BigInt   @id @default(autoincrement())
  userId    String?
  deviceId  String
  type      String
  bookSlug  String
  part      Int
  at        DateTime
  @@index([bookSlug, part, type])
}
```

### 4.6 Environment (`.env`, git mein kabhi nahi)

| Var | Example |
|---|---|
| `PORT` | `4100` |
| `DATABASE_URL` | `postgresql://pocketstory:<pass>@localhost:5432/pocketstory` |
| `GOOGLE_CLIENT_IDS` | Web, Android, iOS client IDs, comma se |
| `APPLE_CLIENT_IDS` | iOS bundle id (jaise `com.pocketstory.app`) + Services ID (Android/web pe Apple login ho to), comma se |
| `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | Agla phase: token revoke ke liye (`.p8` key, git mein kabhi nahi) |
| `JWT_SECRET` | `openssl rand -base64 48` |
| `JWT_EXPIRES_DAYS` | `30` |
| `CORS_ORIGINS` | Khaali (mobile app ko CORS nahi chahiye) |

### 4.7 Deploy (VPS)

VPS pe pehle se: Node 20, PM2 (4 apps), nginx, PostgreSQL 14. Free RAM ~1.3 GB, ye API ~80-100 MB legi.

```bash
# 1. Postgres mein DB + user
sudo -u postgres psql -c "CREATE USER pocketstory WITH PASSWORD '<strong>';"
sudo -u postgres psql -c "CREATE DATABASE pocketstory OWNER pocketstory;"

# 2. Code
cd /var/www && git clone <repo> pocketstory-api && cd pocketstory-api
cp .env.example .env   # bharo
npm ci && npm run build && npx prisma migrate deploy

# 3. PM2
pm2 start ecosystem.config.cjs && pm2 save

# 4. nginx
cp deploy/nginx.conf /etc/nginx/sites-available/pocketstory-api   # server_name badlo
ln -s /etc/nginx/sites-available/pocketstory-api /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# 5. DNS: Cloudflare mein api.<domain> → A record VPS IP, proxy ON (orange)
#    SSL: Cloudflare "Full (strict)" + VPS pe Cloudflare Origin Certificate
```

**VPS security (pending, karna zaroori):** root password badlo, SSH key lagao, password login band, `ufw` se sirf 22/80/443 khule, Postgres sirf localhost.

**Backup:** roz raat `pg_dump pocketstory | gzip` → R2 (alag private bucket), 14 din rakho.

---

## 5. React Native app

### 5.1 Libraries (sujhaav)

| Kaam | Library |
|---|---|
| Navigation | `@react-navigation/native` (stack + bottom tabs) |
| Audio (background, lock screen, notification controls) | `react-native-track-player` |
| Google login | `@react-native-google-signin/google-signin` |
| Apple login | `@invertase/react-native-apple-authentication` (iOS native; Android pe web flow) |
| Ads | `react-native-google-mobile-ads` (AdMob) |
| API cache / fetch | `@tanstack/react-query` |
| Local storage | `react-native-mmkv` (tez) |
| Offline download | `react-native-fs` (ya `react-native-blob-util`) |
| Remote config | `@react-native-firebase/remote-config` |
| Crash report | `@react-native-firebase/crashlytics` |

### 5.2 Screens

| Screen | Data | Notes |
|---|---|---|
| Splash | Remote config | `cdn_base`, `api_base`, ad settings, min version |
| Home | `catalog.json` | Genre rows, "continue listening" (local progress se) |
| Book | `book.json` | Cover, description, parts list, har part pe ✓ / % |
| Player | Track player | Play/pause, ±10 sec, speed 0.75-1.5×, next part auto, sleep timer |
| Downloads | Local | Offline parts, delete |
| Profile / Login | `/me` | "Continue with Google" + "Sign in with Apple" (iOS pe dono button barabar size, Apple wala upar ya barabar), logout, account delete |

### 5.3 Flows

**App khulna:**
1. Remote config laao (fail ho to app mein likha default).
2. `catalog.json` laao. Phone mein cache. Agli baar purana turant dikhao, peeche se naya laao.
3. Local progress se "continue listening".

**Part chalana:**
```
URL = cdn_base + part.audio
TrackPlayer.add({id, url, title, artist: bookTitle, artwork: cdn_base + cover, duration})
```
- Stream: R2 range request support karta hai, 1-2 sec mein shuru, seek turant.
- Downloaded hai to `file://` path chalao.
- Har 10 sec local progress save. Login ho to har 30 sec / pause / app background pe `PUT /progress`.

**Login (Google):**
```
GoogleSignin.signIn() → idToken
POST api_base/auth/google {idToken} → {token, user}
```

**Login (Apple, iOS):**
```
appleAuth.performRequest({requestedOperation: LOGIN, requestedScopes: [EMAIL, FULL_NAME]})
  → {identityToken, fullName, authorizationCode}
POST api_base/auth/apple {identityToken, fullName: "<given> <family>"} → {token, user}
(fullName sirf pehli baar aata hai — tabhi bhej do)
```

**Dono ke baad:**
```
token MMKV mein (secure), har API call mein "Authorization: Bearer <token>"
401 aaye → logout karke dobara login maango
```
Login ke baad: `GET /progress` → local se merge (naya `updatedAt` jeete).

**Ads (AdMob):**
- Banner: Home aur Book screen ke neeche.
- Interstitial: har 2-3 part ke beech (part khatam → ad → agla part). Frequency remote config se.
- Rewarded (optional): "ad dekho, 5 part offline download unlock".
- Player ke beech (part ke andar) kabhi ad nahi.
- Pehle din test ad IDs, release se pehle asli.

**Offline:**
- Download button → file app ke private folder mein. Size `book.json` mein hai, disk check karo.
- Downloaded list MMKV mein.

### 5.4 Config jo app mein hardcode NAHI hona chahiye

| Key | Default | Kahan se |
|---|---|---|
| `cdn_base` | `https://cdn.technoplatsolution.online/` | Remote config |
| `api_base` | `https://api.<domain>/` | Remote config |
| `ad_interstitial_every` | `3` | Remote config |
| `min_app_version` | `1.0.0` | Remote config |

**Kyun:** domain kabhi badalna pada (expire, naya brand) to bas remote config badlo. Purane app versions bhi naye domain pe aa jaayenge. Domain ko kabhi expire mat hone do (auto-renew), warna koi aur kharid ke purane apps ko apna content dikha sakta hai.

---

## 6. Scale (5000+ audio ke liye pehle se tayyar)

| Cheez | 278 parts | 5000+ parts |
|---|---|---|
| R2 storage | 2.75 GB | ~40 GB (~$0.6/mahina) |
| Bandwidth | Free | Free |
| `catalog.json` | Chhoti | Books hi hain, chhoti rahegi |
| `book.json` | 1 file | 200 parts per file (pages) |
| Upload | 8 parallel, skip same sha | Wahi |
| Backend | Audio se koi lena dena nahi | Sirf users × progress rows |
| Postgres events | Chhota | Mahine ka rollup table, raw 90 din |

---

## 7. Domain badalna ho to (10-15 minute)

1. Naya domain Cloudflare pe add karo.
2. Usi bucket `pocketstory` pe naya custom domain jodo (ek bucket pe kai domain chal sakte hain, files dobara upload nahi).
3. Cache rule + rate limit naye host pe bhi.
4. Remote config mein `cdn_base` badlo.
5. Purana domain kuch hafte saath chalne do, phir hatao.

---

## 8. Kya kya baaki hai (order mein)

1. [ ] VPS security: password badlo, SSH key, password login band
2. [ ] Google Cloud Console: OAuth consent screen + Web/Android/iOS client IDs
2b. [ ] Apple Developer: App ID pe "Sign in with Apple" capability on, (Android ke liye) Services ID + return URL, aur ek Sign in with Apple key (`.p8`) token revoke ke liye
3. [ ] API domain tay karo (`api.technoplatsolution.online` ya naya)
4. [ ] Backend deploy (section 4.7) + `/health` aur login test
5. [ ] Covers R2 pe (`books/<slug>/cover.jpg`)
6. [ ] `tools_build_catalog.py` → `catalog.json` + `book.json`
7. [ ] RN app: Home → Book → Player (stream) pehle, phir login, phir progress sync
8. [ ] AdMob account + ad units
9. [ ] Progress + events API
10. [ ] Naye parts aate rahenge (Saat Pheron 26-75, Rathore 26-50, Monte Cristo ...): TTS → SFX → MP3 → upload → catalog
